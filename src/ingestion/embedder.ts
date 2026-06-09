import { LMStudioClient } from "@lmstudio/sdk";
import { DocumentChunk } from "../vectorstore/db";
import crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export class EmbeddingPipeline {
  private client: any; // Using any to bypass strict type for now, it's LMStudioClient
  private embedModelIdentifier: string | undefined;
  private cachedModel: any = null;
  private workspaceDir: string;

  constructor(client: any, modelIdentifier?: string, workspaceDir?: string) {
    this.client = client;
    this.embedModelIdentifier = modelIdentifier;
    this.workspaceDir = workspaceDir || path.join(os.homedir(), ".omnimind");
  }

  /**
   * Returns the identifier of the currently loaded embedding model.
   */
  public getActiveModelIdentifier(): string | undefined {
    return this.cachedModel?.identifier;
  }

  /**
   * Resolves the embedding model. Enforces that the model used for inference
   * matches the model used during database creation/indexing.
   */
  public async resolveEmbeddingModel(): Promise<any> {
    if (this.cachedModel) {
      return this.cachedModel;
    }

    if (!this.client || !this.client.embedding) {
      throw new Error("LM Studio client not fully initialized.");
    }

    const metadataPath = path.join(this.workspaceDir, "embedding_model.json");
    let savedModelIdentifier: string | undefined;
    let savedModelPath: string | undefined;

    if (fs.existsSync(metadataPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
        savedModelIdentifier = meta.identifier;
        savedModelPath = meta.path;
      } catch (e) {
        console.warn("[Embedder] Failed to read embedding_model.json", e);
      }
    }

    let modelToLoad: any = null;

    // 1. Try to load/resolve the saved model if database metadata exists
    if (savedModelIdentifier || savedModelPath) {
      try {
        console.log(`[Embedder] Database was built with model: ${savedModelIdentifier || savedModelPath}. Resolving...`);
        modelToLoad = await this.client.embedding.model(savedModelIdentifier || savedModelPath);
      } catch (err: any) {
        console.warn(`[Embedder] Saved model ${savedModelIdentifier || savedModelPath} not active. Attempting to load from disk...`);
        try {
          if (this.client.system && typeof this.client.system.listDownloadedModels === "function") {
            const downloadedModels = await this.client.system.listDownloadedModels();
            const target = downloadedModels.find((m: any) => m.identifier === savedModelIdentifier || m.path === savedModelPath);
            if (target) {
              console.log(`[Embedder] Loading saved embedding model: ${target.path}`);
              modelToLoad = await this.client.embedding.load(target.path);
            }
          }
        } catch (loadErr) {
          console.error(`[Embedder] Failed to load saved embedding model:`, loadErr);
        }
      }
    }

    // 2. If no saved model was loaded, try resolving the model selected in search_config.json
    let chosenModelFromUI: string | undefined;
    const configPath = path.join(this.workspaceDir, "search_config.json");
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (config.embeddingModel) {
          chosenModelFromUI = config.embeddingModel;
        }
      } catch (e) {
        console.warn("[Embedder] Failed to read search_config.json", e);
      }
    }

    if (!modelToLoad && chosenModelFromUI) {
      try {
        console.log(`[Embedder] Loading chosen model from search_config.json: ${chosenModelFromUI}`);
        modelToLoad = await this.client.embedding.model(chosenModelFromUI);
      } catch (err: any) {
        console.warn(`[Embedder] Chosen model ${chosenModelFromUI} not active. Attempting to load...`);
        try {
          if (this.client.system && typeof this.client.system.listDownloadedModels === "function") {
            const downloadedModels = await this.client.system.listDownloadedModels();
            const target = downloadedModels.find((m: any) => m.identifier === chosenModelFromUI || m.path === chosenModelFromUI);
            if (target) {
              console.log(`[Embedder] Loading chosen embedding model from disk: ${target.path}`);
              modelToLoad = await this.client.embedding.load(target.path);
            }
          }
        } catch (loadErr) {
          console.error(`[Embedder] Failed to load chosen embedding model:`, loadErr);
        }
      }
    }

    // 3. If no saved model or chosen model was loaded, try resolving the constructor identifier
    if (!modelToLoad && this.embedModelIdentifier) {
      try {
        modelToLoad = await this.client.embedding.model(this.embedModelIdentifier);
      } catch (err) {
        console.warn(`[Embedder] Constructor model identifier ${this.embedModelIdentifier} not found/loaded.`);
      }
    }

    // 4. Try to load/resolve the default 'embeddinggemma-300m-qat-GGUF' if downloaded
    if (!modelToLoad) {
      try {
        if (this.client.system && typeof this.client.system.listDownloadedModels === "function") {
          const downloadedModels = await this.client.system.listDownloadedModels();
          const target = downloadedModels.find((m: any) => 
            m.identifier?.includes('embeddinggemma-300m-qat-GGUF') || 
            m.path?.includes('embeddinggemma-300m-qat-GGUF')
          );
          if (target) {
            try {
              console.log(`[Embedder] Attempting to resolve preferred default model: ${target.identifier || target.path}`);
              modelToLoad = await this.client.embedding.model(target.identifier || target.path);
            } catch (err) {
              console.log(`[Embedder] Preferred default model not active. Loading from disk: ${target.path}`);
              modelToLoad = await this.client.embedding.load(target.path);
            }
          }
        }
      } catch (err) {
        console.warn("[Embedder] Failed to resolve preferred default model embeddinggemma-300m-qat-GGUF:", err);
      }
    }

    // 5. Fallback to active model or auto-load one from disk
    if (!modelToLoad) {
      try {
        modelToLoad = await this.client.embedding.model();
      } catch (err: any) {
        if (err.title?.includes("No model found") || err.message?.includes("No loaded model satisfies") || err.message?.includes("No active model")) {
          console.warn("[Embedder] No embedding model loaded! Attempting to auto-load one from disk...");
          if (this.client.system && typeof this.client.system.listDownloadedModels === "function") {
            const downloadedModels = await this.client.system.listDownloadedModels();
            const embeddingModels = downloadedModels.filter((m: any) => m.type === "embedding");
            
            if (embeddingModels.length > 0) {
              const preferred = embeddingModels.find((m: any) => 
                m.identifier?.includes('embeddinggemma-300m-qat-GGUF') || 
                m.path?.includes('embeddinggemma-300m-qat-GGUF')
              );
              const targetModel = preferred ? preferred.path : embeddingModels[0].path;
              console.log(`[Embedder] Auto-loading embedding model: ${targetModel}`);
              modelToLoad = await this.client.embedding.load(targetModel);
              console.log(`[Embedder] Successfully loaded embedding model!`);
            } else {
              throw new Error("No embedding models found on disk. Please download one (e.g., embeddinggemma-300m) in LM Studio.");
            }
          } else {
            throw new Error("No embedding model is loaded. Please load one in LM Studio.");
          }
        } else {
          throw err;
        }
      }
    }

    if (modelToLoad) {
      const currentIdentifier = modelToLoad.identifier;
      const currentPath = modelToLoad.path;
      
      const tablePath = path.join(this.workspaceDir, ".lancedb", "knowledge_graph.lance");
      const isNewDatabase = !fs.existsSync(tablePath);

      if (savedModelIdentifier && savedModelIdentifier !== currentIdentifier && !isNewDatabase) {
        throw new Error(
          `Embedding model mismatch! The database was built with '${savedModelIdentifier}' (or path '${savedModelPath}'), but the active model is '${currentIdentifier}'. ` +
          `Please load the correct model in LM Studio to prevent corrupted queries. To start fresh with this new model, delete your database files in ${path.join(this.workspaceDir, ".lancedb")}`
        );
      }

      // Record/Update metadata if new database or metadata is missing
      if (!savedModelIdentifier || isNewDatabase) {
        try {
          if (!fs.existsSync(this.workspaceDir)) {
            fs.mkdirSync(this.workspaceDir, { recursive: true });
          }
          fs.writeFileSync(metadataPath, JSON.stringify({
            identifier: currentIdentifier,
            path: currentPath,
            timestamp: new Date().toISOString()
          }, null, 2));
          console.log(`[Embedder] Saved/Updated embedding model metadata to ${metadataPath}`);
        } catch (e) {
          console.warn("[Embedder] Failed to write embedding_model.json", e);
        }
      }

      this.cachedModel = modelToLoad;
    }

    return this.cachedModel;
  }

  /**
   * Generates an embedding for a single text chunk.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const model = await this.resolveEmbeddingModel();
    try {
      const embeddingResult = await (model as any).embed(text);
      return embeddingResult.embedding; 
    } catch (err) {
      this.cachedModel = null;
      throw err;
    }
  }

  /**
   * Splits a long text into smaller chunks of approx `chunkSize` characters
   * with an overlap of `overlap` characters.
   */
  private chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
    const chunks: string[] = [];
    let startIndex = 0;

    while (startIndex < text.length) {
      let endIndex = startIndex + chunkSize;
      
      // Try not to split words, but only if the space is near the end of the chunk to prevent infinite loops
      if (endIndex < text.length) {
        const minEndIndex = startIndex + (chunkSize / 2);
        const lastSpace = text.lastIndexOf(" ", endIndex);
        if (lastSpace > minEndIndex) {
          endIndex = lastSpace;
        }
      }

      chunks.push(text.slice(startIndex, endIndex).trim());
      
      // Ensure we always advance forward, even if overlap is larger than the chunk advancement
      const nextStart = endIndex - overlap;
      startIndex = nextStart > startIndex ? nextStart : startIndex + 1;
    }

    return chunks.filter(c => c.length > 0);
  }

  /**
   * Takes a raw Obsidian note or Zotero PDF text, chunks it, embeds it in batches,
   * and returns an array of DocumentChunks ready for LanceDB.
   */
  public async processDocument(
    source: 'obsidian' | 'zotero',
    path: string,
    title: string,
    rawText: string,
    links: string[] = [],
    onBatch: (chunks: DocumentChunk[]) => Promise<void>
  ): Promise<number> {
    const textChunks = this.chunkText(rawText).map(chunk => `Source: ${title}\n\n${chunk}`);
    const linksString = links.join(",");
    let totalProcessed = 0;

    const model = await this.resolveEmbeddingModel();
    const modelId = model.identifier;

    // Process in batches of 20 to prevent overwhelming LM Studio API
    const BATCH_SIZE = 20;
    
    for (let i = 0; i < textChunks.length; i += BATCH_SIZE) {
      const chunkBatch = textChunks.slice(i, i + BATCH_SIZE);
      
      let embeddingResults;
      try {
        embeddingResults = await (model as any).embed(chunkBatch);
      } catch (err) {
        this.cachedModel = null;
        throw err;
      }

      const lancedbBatch: DocumentChunk[] = [];
      
      for (let j = 0; j < chunkBatch.length; j++) {
        const text = chunkBatch[j];
        const vector = embeddingResults[j].embedding;
        
        // Generate deterministic ID
        const id = crypto.createHash('sha256').update(`${source}:${path}:${i + j}`).digest('hex');

        lancedbBatch.push({
          id,
          vector,
          source,
          path,
          text,
          links_to: linksString,
          model: modelId
        });
      }

      await onBatch(lancedbBatch);
      totalProcessed += lancedbBatch.length;
    }

    return totalProcessed;
  }
}
