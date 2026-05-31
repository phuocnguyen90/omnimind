import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { SyncTracker } from './tracker';

export interface ZoteroItem {
  key: string;       // The unique citation key (e.g. 8-character hash)
  title: string;
  pdfPath: string | null;
  textContent: string | null; // Extracted from PDF
}

export class ZoteroExtractor {
  private dbPath: string;
  private storagePath: string;
  private lmClient: any;
  private syncTracker: SyncTracker;
  private getState?: () => 'RUNNING' | 'PAUSED';

  constructor(dbPath: string, storagePath: string, lmClient: any, syncTracker: SyncTracker, getState?: () => 'RUNNING' | 'PAUSED') {
    this.dbPath = dbPath;
    this.storagePath = storagePath;
    this.lmClient = lmClient;
    this.syncTracker = syncTracker;
    this.getState = getState;
  }

  /**
   * Determines if a PDF needs Vision OCR based on extracted text heuristics.
   */
  private needsOCR(text: string, numPages: number): boolean {
    if (numPages === 0 || !text) return true;
    
    const charsPerPage = text.length / numPages;
    if (charsPerPage < 800) return true; // Sparse text, likely heavy tables/diagrams or broken extraction
    
    // Check for gibberish (e.g. broken font encodings)
    const alphaNumeric = text.match(/[a-zA-Z0-9]/g)?.length || 0;
    const alphaRatio = alphaNumeric / Math.max(text.length, 1);
    if (alphaRatio < 0.6) return true; // Too many weird characters
    
    return false;
  }

  /**
   * Runs the PDF through a Vision Model via LM Studio for high-fidelity OCR extraction.
   */
  private async runVisionOCR(pdfFilePath: string, fileName: string): Promise<string> {
    if (!this.lmClient) {
      console.warn(`[Hybrid OCR] lmClient not provided. Cannot run OCR on ${fileName}.`);
      return "";
    }

    // Dynamically import mupdf to bypass CommonJS 'require' errors for ESM modules with top-level await
    let mupdf: any;
    try {
      mupdf = await import('mupdf');
    } catch (err) {
      console.error(`[Hybrid OCR] Failed to load mupdf dynamically:`, err);
      return "";
    }

    const docData = fs.readFileSync(pdfFilePath);
    let document;
    try {
      // In mupdf.js 1.27+, the class is PDFDocument or Document. 
      // We safely try both depending on the exact build exported.
      const docAPI = (mupdf as any).PDFDocument || (mupdf as any).Document;
      document = docAPI.openDocument(docData, "application/pdf");
    } catch (e) {
      console.error(`[Hybrid OCR] Failed to open document ${fileName} with mupdf:`, e);
      return "";
    }

    const numPages = document.countPages();
    let fullMarkdown = "";

    console.log(`[Hybrid OCR] ${fileName} failed heuristics. Extracting ${numPages} pages using Vision OCR...`);

    const systemPrompt = "You are an advanced academic OCR system. Convert this PDF page to exact Markdown. Preserve all headers, tables, mathematical equations (as LaTeX), and text. Do not add any conversational text or formatting outside of the actual document content.";

    let model;
    try {
      // We grab any loaded model (hopefully a Vision capable model like DeepSeek-OCR)
      model = await this.lmClient.llm.model(); 
    } catch (e) {
      console.warn("[Hybrid OCR] No model loaded in LM Studio! Falling back to raw text.", e);
      return "";
    }

    for (let i = 0; i < numPages; i++) {
      let success = false;
      let scale = 2; // start with high resolution
      let retryCount = 0;

      while (!success && retryCount < 3) {
        try {
          console.log(`[Hybrid OCR] Processing page ${i+1}/${numPages} for ${fileName} at scale ${scale}x...`);
          const page = document.loadPage(i);
          
          const matrix = mupdf.Matrix.scale(scale, scale);
          const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
          
          const pngData = pixmap.asPNG();
          const base64Image = Buffer.from(pngData).toString('base64');
          
          const fileHandle = await this.lmClient.files.prepareImageBase64(`page_${i}.png`, base64Image);

          const response = await model.respond([
            { role: "system", content: systemPrompt },
            { role: "user", content: "Extract this page as Markdown." }
          ], {
            images: [fileHandle],
            temperature: 0.1
          });

          fullMarkdown += `\n\n<!-- Page ${i+1} -->\n\n` + response.content;
          success = true;

        } catch (e: any) {
           const errMsg = e.message || e.toString();
           if (errMsg.includes("Context size") || errMsg.includes("exceeded")) {
             console.warn(`[Hybrid OCR] Context size exceeded on page ${i+1} at scale ${scale}x. Downgrading resolution...`);
             scale = scale * 0.5; // Half the resolution to drastically reduce image tokens
             retryCount++;
           } else {
             console.warn(`[Hybrid OCR] Failed to OCR page ${i+1} of ${fileName}:`, e);
             break; // Unknown error, skip this page
           }
        }
      }
      
      if (!success) {
        console.warn(`[Hybrid OCR] Abandoned page ${i+1} of ${fileName} after multiple resolution downgrades.`);
      }
    }

    return fullMarkdown;
  }

  /**
   * Connects to the SQLite database in read-only mode to prevent locking issues
   * with the active Zotero client. Yields items sequentially to prevent OOM.
   */
  public async extractLibrary(onItemParsed: (item: ZoteroItem) => Promise<void>): Promise<void> {
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`Zotero database not found at ${this.dbPath}`);
    }

    // Initialize the WASM SQLite engine (completely bypasses OS native bindings!)
    const SQL = await initSqlJs();
    const filebuffer = fs.readFileSync(this.dbPath);
    const db = new SQL.Database(filebuffer);

    const query = `
      SELECT 
        items.key AS storage_key, 
        itemAttachments.path AS file_name,
        items.itemID
      FROM itemAttachments 
      JOIN items ON itemAttachments.itemID = items.itemID
      WHERE itemAttachments.path LIKE 'storage:%.pdf'
    `;

    const stmt = db.prepare(query);
    const rows: any[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    db.close();

    // Parse each PDF concurrently based on parameterized limit
    const maxConcurrentWorkers = parseInt(process.env.MAX_CONCURRENT_WORKERS || "4", 10);
    console.log(`[Zotero] Starting extraction with ${maxConcurrentWorkers} concurrent workers...`);
    
    let activeWorkers = 0;
    let index = 0;

    await new Promise<void>((resolve, reject) => {
      const next = () => {
        // Respect Global Pause State
        if (this.getState && this.getState() === 'PAUSED') {
          setTimeout(next, 1000);
          return;
        }

        if (index >= rows.length && activeWorkers === 0) {
          resolve();
          return;
        }
        
        while (activeWorkers < maxConcurrentWorkers && index < rows.length) {
          const row = rows[index++];
          activeWorkers++;
          
          this.processRow(row, onItemParsed)
            .then(() => {
              activeWorkers--;
              next();
            })
            .catch((err) => {
              console.error(`[Zotero] Worker failed on row ${row.file_name}`, err);
              activeWorkers--;
              next();
            });
        }
      };
      
      next();
    });
  }

  private async processRow(row: any, onItemParsed: (item: ZoteroItem) => Promise<void>) {
    const key = row.storage_key as string;
    
    // Resume Tracking / Deduplication Check
    if (this.syncTracker.hasZotero(key)) {
      return; // Skip this file!
    }

    const fileName = (row.file_name as string).replace('storage:', '');
    const storageDir = path.join(this.storagePath, key);
    const pdfFilePath = path.join(storageDir, fileName);

    let textContent: string | null = null;
    let pdfPathToStore: string | null = null;

    if (fs.existsSync(pdfFilePath)) {
      pdfPathToStore = pdfFilePath;
      try {
        const dataBuffer = fs.readFileSync(pdfFilePath);
        const pdfParseFn = (pdfParse as any).default || pdfParse;
        
        // Suppress pdf-parse warnings to keep the terminal clean
        const originalWarn = console.warn;
        console.warn = () => {};
        
        const data = await pdfParseFn(dataBuffer);
        
        // Restore console.warn
        console.warn = originalWarn;
        
        textContent = data.text;

        // --- HYBRID OCR PIPELINE ---
        if (this.needsOCR(textContent || "", data.numpages || 1)) {
          const visionMarkdown = await this.runVisionOCR(pdfFilePath, fileName);
          if (visionMarkdown.trim().length > 0) {
            textContent = visionMarkdown;
          }
        }
        // ---------------------------

      } catch (err) {
        console.error(`Failed to parse PDF at ${pdfFilePath}`, err);
      }
    }

    if (textContent) {
      await onItemParsed({
        key: row.storage_key as string,
        title: fileName,
        pdfPath: pdfPathToStore,
        textContent,
      });
    }
  }
}
