import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { ZoteroDB } from './db';
import { ZoteroOCR } from './ocr';
import { parseHTML } from "./parsers/htmlParser";
import { parseEPUB } from "./parsers/epubParser";
import { ZoteroItem } from './types';
import { SyncTracker } from '../tracker';
import { JobQueue } from '../queue';

export class ZoteroExtractor {
  private zoteroDB: ZoteroDB;
  private zoteroOCR: ZoteroOCR;
  private storagePath: string;
  private cacheDir: string;
  private lmClient: any;

  constructor(dbPath: string, storagePath: string, lmClient: any, syncTracker: SyncTracker) {
    this.zoteroDB = new ZoteroDB(dbPath, storagePath, syncTracker);
    this.zoteroOCR = new ZoteroOCR(lmClient);
    this.storagePath = storagePath;
    this.lmClient = lmClient;

    const workspaceDir = path.join(require('os').homedir(), ".omnimind");
    this.cacheDir = path.join(workspaceDir, "ocr_cache");
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  public async discoverJobs(jobQueue: JobQueue): Promise<string[]> {
    return this.zoteroDB.discoverJobs(jobQueue);
  }

  public async getPaperInfo(queryStr: string): Promise<any[]> {
    return this.zoteroDB.getPaperInfo(queryStr);
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
      const cachedContent = fs.readFileSync(cacheFilePath, 'utf-8');
      if (!cachedContent.includes("<!-- Page ")) {
         console.log(`[Cache Hit] Skipping extraction for ${fileName}, reading pdf-parse from cache.`);
         textContent = cachedContent;
      }
    }
    
    if (!textContent) {
      // 2. Perform Extraction
      if (!fs.existsSync(pdfFilePath)) {
        throw new Error(`File not found: ${pdfFilePath}`);
      }
      
      const ext = path.extname(fileName).toLowerCase();

      try {
        if (ext === '.html' || ext === '.htm') {
          textContent = await parseHTML(pdfFilePath);
          if (textContent) fs.writeFileSync(cacheFilePath, textContent);
        } else if (ext === '.epub') {
          textContent = await parseEPUB(pdfFilePath);
          if (textContent) fs.writeFileSync(cacheFilePath, textContent);
        } else {
          // Default to PDF parsing logic
          // Stage 1: Fast path using LM Studio's native document parser
          try {
            if (this.lmClient && this.lmClient.files) {
            const fileHandle = await this.lmClient.files.prepareFile(pdfFilePath);
            const parseResult = await this.lmClient.files.parseDocument(fileHandle);
            const text = parseResult.content;
            if (text && text.trim().length > 50) {
              console.log(`[Fast Parser] Successfully extracted ${text.length} chars from ${fileName} via LM Studio`);
              textContent = text;
              fs.writeFileSync(cacheFilePath, text);
            }
          }
        } catch (lmErr: any) {
          console.warn(`[Fast Parser] LM Studio parse failed for ${fileName}: ${lmErr.message || 'Unknown error'}. Falling back to local OCR.`);
        }

        if (!textContent) {
          // Stage 2: Fallback to pdf-parse
          const dataBuffer = fs.readFileSync(pdfFilePath);
          const pdfParseFn = (pdfParse as any).default || pdfParse;
          
          const originalWarn = console.warn;
          console.warn = () => {};
          const data = await pdfParseFn(dataBuffer);
          console.warn = originalWarn;
          
          textContent = data.text;

          // Stage 3: HYBRID OCR PIPELINE
          if (this.zoteroOCR.needsOCR(textContent || "", data.numpages || 1)) {
            // Pass the cache file path so it can stream progress and resume!
            const visionMarkdown = await this.zoteroOCR.runVisionOCR(pdfFilePath, fileName, cacheFilePath);
            if (visionMarkdown.trim().length > 0) {
              textContent = visionMarkdown;
            }
          } else {
            // Save standard PDF-Parse to cache so we never OCR this again
            if (textContent && textContent.trim().length > 0) {
              fs.writeFileSync(cacheFilePath, textContent);
            }
            }
          }
        } // End of PDF parsing logic
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
