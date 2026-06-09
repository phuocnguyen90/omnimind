import fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class ZoteroOCR {
  private lmClient: any;

  constructor(lmClient: any) {
    this.lmClient = lmClient;
  }

  /**
   * Determines if a PDF needs Vision OCR based on extracted text heuristics.
   */
  public needsOCR(text: string, numPages: number): boolean {
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
  public async runVisionOCR(pdfFilePath: string, fileName: string, cacheFilePath: string): Promise<string> {
    if (!this.lmClient) {
      console.warn(`[Hybrid OCR] lmClient not provided. Cannot run OCR on ${fileName}.`);
      return "";
    }

    // Dynamically import mupdf to bypass CommonJS 'require' errors for ESM modules with top-level await
    let mupdf: any;
    try {
      // @ts-ignore
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

    let model: any = null;
    try {
      const configPath = path.join(os.homedir(), ".omnimind", "search_config.json");
      let chosenVisionModel: string | undefined;
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          if (config.visionModel) {
            chosenVisionModel = config.visionModel;
          }
        } catch (e) {
          console.warn("[OCR] Failed to read search_config.json", e);
        }
      }

      // 1. Try resolving chosen vision model from config
      if (chosenVisionModel) {
        try {
          console.log(`[OCR] Attempting to get active chosen Vision model: ${chosenVisionModel}`);
          model = await this.lmClient.llm.model(chosenVisionModel);
        } catch (err) {
          console.warn(`[OCR] Chosen vision model ${chosenVisionModel} not currently active. Trying to load from disk...`);
          try {
            if (this.lmClient.system && typeof this.lmClient.system.listDownloadedModels === "function") {
              const downloaded = await this.lmClient.system.listDownloadedModels();
              const target = downloaded.find((m: any) => m.identifier === chosenVisionModel || m.path === chosenVisionModel);
              if (target) {
                console.log(`[OCR] Loading chosen vision model from disk: ${target.path}`);
                model = await this.lmClient.llm.load(target.path);
              }
            }
          } catch (loadErr) {
            console.error(`[OCR] Failed to load chosen vision model from disk:`, loadErr);
          }
        }
      }

      // 2. Try resolving any active LLM model if chosen model is not loaded
      if (!model) {
        try {
          model = await this.lmClient.llm.model();
        } catch (err) {
          console.warn("[OCR] No active LLM model found in LM Studio.");
        }
      }

      // 3. Try to auto-load DeepSeek-OCR or any downloaded ocr/vision LLM from disk
      if (!model) {
        try {
          if (this.lmClient.system && typeof this.lmClient.system.listDownloadedModels === "function") {
            const downloaded = await this.lmClient.system.listDownloadedModels();
            const llmModels = downloaded.filter((m: any) => m.type === "llm");
            if (llmModels.length > 0) {
              const preferred = llmModels.find((m: any) => 
                m.identifier?.toLowerCase().includes("ocr") ||
                m.path?.toLowerCase().includes("ocr") ||
                m.identifier?.toLowerCase().includes("vision") ||
                m.path?.toLowerCase().includes("vision")
              );
              const target = preferred || llmModels[0];
              console.log(`[OCR] Auto-loading fallback LLM model from disk: ${target.path}`);
              model = await this.lmClient.llm.load(target.path);
            }
          }
        } catch (err) {
          console.error("[OCR] Failed to auto-load fallback LLM model from disk:", err);
        }
      }
    } catch (e) {
      console.warn("[Hybrid OCR] Exception during vision model resolution:", e);
    }

    if (!model) {
      console.warn("[Hybrid OCR] No vision model loaded or available in LM Studio! Falling back to raw text.");
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
}
