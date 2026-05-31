import { LMStudioClient } from "@lmstudio/sdk";
import { DocumentChunk } from "../vectorstore/db";
import crypto from "crypto";

export class EmbeddingPipeline {
  private client: any; // Using any to bypass strict type for now, it's LMStudioClient
  private embedModelIdentifier: string | undefined;

  constructor(client: any, modelIdentifier?: string) {
    this.client = client;
    this.embedModelIdentifier = modelIdentifier;
  }

  /**
   * Generates an embedding for a single text chunk.
   * If modelIdentifier is not specified, LM Studio will use any loaded embedding model.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    try {
      if (!this.client || !this.client.embedding) {
        throw new Error("LM Studio client not fully initialized.");
      }
      
      const model = this.embedModelIdentifier 
        ? await this.client.embedding.model(this.embedModelIdentifier)
        : await this.client.embedding.model();
        
      const embeddingResult = await (model as any).embed(text);
      
      // LM Studio SDK typically returns an object containing the embedding vector
      return embeddingResult.embedding; 
    } catch (e: any) {
      if (e.message?.includes("No model found")) {
        throw new Error("No embedding model is currently loaded in LM Studio! Please load an embedding model alongside your chat model (ensure 'Keep multiple models in memory' is enabled) and try again.");
      }
      console.error("Failed to generate embedding:", e);
      throw e;
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
   * Takes a raw Obsidian note or Zotero PDF text, chunks it, embeds it,
   * and returns an array of DocumentChunks ready for LanceDB.
   */
  public async processDocument(
    source: 'obsidian' | 'zotero',
    path: string,
    rawText: string,
    links: string[] = [],
    onBatch: (chunks: DocumentChunk[]) => Promise<void>
  ): Promise<number> {
    const textChunks = this.chunkText(rawText);
    const linksString = links.join(",");
    let batch: DocumentChunk[] = [];
    let totalProcessed = 0;

    for (let i = 0; i < textChunks.length; i++) {
      const text = textChunks[i];
      const vector = await this.generateEmbedding(text);
      
      // Generate a deterministic ID based on the source path and chunk index
      const id = crypto.createHash('sha256').update(`${source}:${path}:${i}`).digest('hex');

      batch.push({
        id,
        vector,
        source,
        path,
        text,
        links_to: linksString
      });

      // Flush batch every 20 chunks to prevent memory bloat on giant files
      if (batch.length >= 20 || i === textChunks.length - 1) {
        if (batch.length > 0) {
          await onBatch(batch);
          totalProcessed += batch.length;
          batch = []; // Clear array for garbage collection
        }
      }
    }

    return totalProcessed;
  }
}
