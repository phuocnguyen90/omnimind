import { LMStudioClient } from "@lmstudio/sdk";
import { DocumentChunk } from "../vectorstore/db";
import crypto from "crypto";

export class EmbeddingPipeline {
  private client: any; // Using any to bypass strict type for now, it's LMStudioClient
  private embedModelIdentifier: string | undefined;
  private cachedModel: any = null;

  constructor(client: any, modelIdentifier?: string) {
    this.client = client;
    this.embedModelIdentifier = modelIdentifier;
  }

  /**
   * Generates an embedding for a single text chunk.
   * Caches the model instance to prevent spamming LM Studio's getModelInfo endpoint.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    if (!this.client || !this.client.embedding) {
      throw new Error("LM Studio client not fully initialized.");
    }
    
    if (!this.cachedModel) {
      try {
        this.cachedModel = this.embedModelIdentifier 
          ? await this.client.embedding.model(this.embedModelIdentifier)
          : await this.client.embedding.model();
      } catch (err: any) {
        if (err.title?.includes("No model found") || err.message?.includes("No loaded model satisfies")) {
          console.warn("[Embedder] No embedding model loaded! Attempting to auto-load one from disk...");
          const downloadedModels = await this.client.system.listDownloadedModels();
          const embeddingModels = downloadedModels.filter((m: any) => m.type === "embedding");
          
          if (embeddingModels.length > 0) {
            const targetModel = embeddingModels[0].path;
            console.log(`[Embedder] Auto-loading embedding model: ${targetModel}`);
            this.cachedModel = await this.client.embedding.load(targetModel);
            console.log(`[Embedder] Successfully loaded embedding model!`);
          } else {
            throw new Error("No embedding models found on disk. Please download one (e.g., embeddinggemma-300m) in LM Studio.");
          }
        } else {
          throw err;
        }
      }
    }
      
    try {
      const embeddingResult = await (this.cachedModel as any).embed(text);
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
    // Prepend the title to every chunk. This drastically improves both semantic search 
    // relevance and gives the LLM context of where the text came from!
    const textChunks = this.chunkText(rawText).map(chunk => `Source: ${title}\n\n${chunk}`);
    const linksString = links.join(",");
    let totalProcessed = 0;

    if (!this.client || !this.client.embedding) {
      throw new Error("LM Studio client not fully initialized.");
    }

    if (!this.cachedModel) {
      try {
        this.cachedModel = this.embedModelIdentifier 
          ? await this.client.embedding.model(this.embedModelIdentifier)
          : await this.client.embedding.model();
      } catch (err: any) {
        if (err.title?.includes("No model found") || err.message?.includes("No loaded model satisfies")) {
          console.warn("[Embedder] No embedding model loaded! Attempting to auto-load one from disk...");
          const downloadedModels = await this.client.system.listDownloadedModels();
          const embeddingModels = downloadedModels.filter((m: any) => m.type === "embedding");
          
          if (embeddingModels.length > 0) {
            const targetModel = embeddingModels[0].path;
            console.log(`[Embedder] Auto-loading embedding model: ${targetModel}`);
            this.cachedModel = await this.client.embedding.load(targetModel);
            console.log(`[Embedder] Successfully loaded embedding model!`);
          } else {
            throw new Error("No embedding models found on disk. Please download one (e.g., embeddinggemma-300m) in LM Studio.");
          }
        } else {
          throw err;
        }
      }
    }

    // Process in batches of 20 to prevent overwhelming LM Studio API
    const BATCH_SIZE = 20;
    
    for (let i = 0; i < textChunks.length; i += BATCH_SIZE) {
      const chunkBatch = textChunks.slice(i, i + BATCH_SIZE);
      
      let embeddingResults;
      try {
        embeddingResults = await (this.cachedModel as any).embed(chunkBatch);
      } catch (err) {
        this.cachedModel = null;
        throw err;
      }

      const lancedbBatch: DocumentChunk[] = [];
      
      for (let j = 0; j < chunkBatch.length; j++) {
        const text = chunkBatch[j];
        // In array embed, LM Studio SDK returns an array of objects
        const vector = embeddingResults[j].embedding;
        
        // Generate deterministic ID
        const id = crypto.createHash('sha256').update(`${source}:${path}:${i + j}`).digest('hex');

        lancedbBatch.push({
          id,
          vector,
          source,
          path,
          text,
          links_to: linksString
        });
      }

      await onBatch(lancedbBatch);
      totalProcessed += lancedbBatch.length;
    }

    return totalProcessed;
  }
}
