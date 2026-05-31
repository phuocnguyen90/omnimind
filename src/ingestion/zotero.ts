import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { SyncTracker } from './tracker';
import { JobQueue } from './queue';

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
  private cacheDir: string;

  constructor(dbPath: string, storagePath: string, lmClient: any, syncTracker: SyncTracker) {
    this.dbPath = dbPath;
    this.storagePath = storagePath;
    this.lmClient = lmClient;
    this.syncTracker = syncTracker;

    const workspaceDir = path.join(require('os').homedir(), ".omnimind");
    this.cacheDir = path.join(workspaceDir, "ocr_cache");
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
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
   * Caches progress to disk page-by-page so it can resume mid-way.
   */
  private async runVisionOCR(pdfFilePath: string, fileName: string, cacheFilePath: string): Promise<string> {
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
    let startPage = 0;

    // PAGE-LEVEL RESUMPTION LOGIC
    if (fs.existsSync(cacheFilePath)) {
      fullMarkdown = fs.readFileSync(cacheFilePath, 'utf-8');
      
      // Look for all <!-- Page X --> markers to find the highest completed page
      const pageRegex = /<!-- Page (\d+) -->/g;
      let match;
      let highestPage = 0;
      while ((match = pageRegex.exec(fullMarkdown)) !== null) {
        const pageNum = parseInt(match[1], 10);
        if (pageNum > highestPage) highestPage = pageNum;
      }
      
      startPage = highestPage;
      if (startPage >= numPages) {
        console.log(`[Cache Hit] Skipping OCR for ${fileName}, fully completed in cache.`);
        return fullMarkdown;
      } else if (startPage > 0) {
        console.log(`[Hybrid OCR] Resuming ${fileName} from page ${startPage + 1}/${numPages}...`);
      }
    } else {
      console.log(`[Hybrid OCR] ${fileName} failed heuristics. Extracting ${numPages} pages using Vision OCR...`);
    }

    const systemPrompt = "You are an advanced academic OCR system. Convert this PDF page to exact Markdown. Preserve all headers, tables, mathematical equations (as LaTeX), and text. Do not add any conversational text or formatting outside of the actual document content.";

    let model;
    try {
      // We grab any loaded model (hopefully a Vision capable model like DeepSeek-OCR)
      model = await this.lmClient.llm.model(); 
    } catch (e) {
      console.warn("[Hybrid OCR] No model loaded in LM Studio! Falling back to raw text.", e);
      return fullMarkdown;
    }

    for (let i = startPage; i < numPages; i++) {
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

          const pageMarkdown = `\n\n<!-- Page ${i+1} -->\n\n` + response.content;
          fullMarkdown += pageMarkdown;
          
          // Stream safely to disk page-by-page
          fs.appendFileSync(cacheFilePath, pageMarkdown);
          
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
   * Fast discovery phase: Scans the SQLite DB and populates the JobQueue with pending PDFs.
   * Extracts rich metadata (Authors, Year, Title) to perfectly ground LLM embeddings.
   */
  public async discoverJobs(jobQueue: JobQueue): Promise<void> {
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`Zotero database not found at ${this.dbPath}`);
    }

    const SQL = await initSqlJs();
    const filebuffer = fs.readFileSync(this.dbPath);
    const db = new SQL.Database(filebuffer);

    // 1. Resolve Zotero dynamic field IDs
    const fieldQuery = `SELECT fieldName, fieldID FROM fields WHERE fieldName IN ('title','date')`;
    const fStmt = db.prepare(fieldQuery);
    const fids: Record<string, number> = {};
    while (fStmt.step()) {
      const row = fStmt.getAsObject();
      fids[row.fieldName as string] = row.fieldID as number;
    }
    fStmt.free();

    const authorQuery = `SELECT creatorTypeID FROM creatorTypes WHERE creatorType = 'author'`;
    const aStmt = db.prepare(authorQuery);
    let authorTypeId = 1;
    if (aStmt.step()) {
      authorTypeId = aStmt.getAsObject().creatorTypeID as number;
    }
    aStmt.free();

    // 2. Extract PDF attachments along with Parent Metadata
    const query = `
      SELECT
          i.key AS item_key,
          tv.value  AS title,
          GROUP_CONCAT(c.lastName || ', ' || c.firstName, '; ') AS authors,
          dv.value  AS year,
          att.path  AS file_name,
          atti.key  AS storage_key
      FROM items i
      LEFT JOIN itemData    td   ON td.itemID   = i.itemID AND td.fieldID   = ${fids['title'] || -1}
      LEFT JOIN itemDataValues tv ON tv.valueID = td.valueID
      LEFT JOIN itemData    dd   ON dd.itemID   = i.itemID AND dd.fieldID   = ${fids['date'] || -1}
      LEFT JOIN itemDataValues dv ON dv.valueID = dd.valueID
      LEFT JOIN itemCreators ic ON ic.itemID = i.itemID AND ic.creatorTypeID = ${authorTypeId}
      LEFT JOIN creators c ON c.creatorID = ic.creatorID
      JOIN (
          SELECT parentItemID, MIN(itemID) AS itemID, path
          FROM itemAttachments
          WHERE contentType = 'application/pdf' AND path LIKE 'storage:%.pdf'
          GROUP BY parentItemID
      ) att ON att.parentItemID = i.itemID
      JOIN items atti ON atti.itemID = att.itemID
      WHERE i.itemTypeID NOT IN (14, 26)
        AND tv.value IS NOT NULL
      GROUP BY i.itemID
    `;

    const stmt = db.prepare(query);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const key = row.storage_key as string;
      const fileName = (row.file_name as string).replace('storage:', '');
      
      // Format the Title as a BibTeX-style citation string
      let richTitle = fileName;
      if (row.title) {
        const yearMatch = row.year ? String(row.year).substring(0,4) : "n.d.";
        let authorStr = "Unknown";
        if (row.authors) {
           const authorsList = String(row.authors).split(';');
           if (authorsList.length === 1) {
             authorStr = authorsList[0].split(',')[0].trim();
           } else if (authorsList.length === 2) {
             authorStr = `${authorsList[0].split(',')[0].trim()} & ${authorsList[1].split(',')[0].trim()}`;
           } else {
             authorStr = `${authorsList[0].split(',')[0].trim()} et al.`;
           }
        }
        richTitle = `${authorStr} (${yearMatch}) - ${row.title}`;
      }

      if (!this.syncTracker.hasZotero(key)) {
        jobQueue.addJob({
          id: key,
          type: 'zotero',
          title: richTitle,
          payload: { ...row, rich_title: richTitle }
        });
      }
    }
    stmt.free();
    db.close();
    
    console.log(`[Zotero] Discovery complete. Pending jobs added to queue.`);
  }

  /**
   * Execution Phase: Processes a single job and returns the text content.
   */
  public async executeJob(jobPayload: any): Promise<ZoteroItem> {
    const key = jobPayload.storage_key as string;
    const fileName = (jobPayload.file_name as string).replace('storage:', '');
    const richTitle = jobPayload.rich_title || fileName;
    
    const storageDir = path.join(this.storagePath, key);
    const pdfFilePath = path.join(storageDir, fileName);

    let textContent: string | null = null;
    const cacheFilePath = path.join(this.cacheDir, `${key}.md`);

    // 1. Check if we have a full cache hit without OCR (fallback for pdf-parse)
    if (fs.existsSync(cacheFilePath)) {
      // If the file exists, we read it. If it doesn't have Page markers, it's a pdf-parse cache.
      // If it does have Page markers, we pass it to runVisionOCR anyway to resume it.
      const cachedContent = fs.readFileSync(cacheFilePath, 'utf-8');
      if (!cachedContent.includes("<!-- Page ")) {
         console.log(`[Cache Hit] Skipping extraction for ${fileName}, reading pdf-parse from cache.`);
         textContent = cachedContent;
      }
    }
    
    if (!textContent) {
      // 2. Perform Extraction
      if (!fs.existsSync(pdfFilePath)) {
        throw new Error(`PDF not found: ${pdfFilePath}`);
      }

      try {
        const dataBuffer = fs.readFileSync(pdfFilePath);
        const pdfParseFn = (pdfParse as any).default || pdfParse;
        
        const originalWarn = console.warn;
        console.warn = () => {};
        const data = await pdfParseFn(dataBuffer);
        console.warn = originalWarn;
        
        textContent = data.text;

        // --- HYBRID OCR PIPELINE ---
        if (this.needsOCR(textContent || "", data.numpages || 1)) {
          // Pass the cache file path so it can stream progress and resume!
          const visionMarkdown = await this.runVisionOCR(pdfFilePath, fileName, cacheFilePath);
          if (visionMarkdown.trim().length > 0) {
            textContent = visionMarkdown;
          }
        } else {
          // Save standard PDF-Parse to cache so we never OCR this again
          if (textContent && textContent.trim().length > 0) {
            fs.writeFileSync(cacheFilePath, textContent);
          }
        }
      } catch (err: any) {
        throw new Error(`Failed to parse PDF at ${pdfFilePath}: ${err.message}`);
      }
    }

    return {
      key,
      title: richTitle,
      pdfPath: pdfFilePath,
      textContent,
    };
  }
}
