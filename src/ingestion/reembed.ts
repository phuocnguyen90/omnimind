import fs from 'fs';
import path from 'path';
import os from 'os';
import { vectorStore, embedder, obsidianWatcher, zoteroExtractor, syncTracker } from '../index';

export let reembedStatus = {
  inProgress: false,
  statusText: "Idle",
  succeededCount: 0,
  failedCount: 0,
  totalCount: 0
};

export async function runReembedding(onProgress?: (status: string) => void): Promise<{ success: boolean; message: string }> {
  if (reembedStatus.inProgress) {
    return { success: false, message: "Re-embedding is already in progress." };
  }

  reembedStatus.inProgress = true;
  reembedStatus.statusText = "Starting re-embedding...";
  reembedStatus.succeededCount = 0;
  reembedStatus.failedCount = 0;
  reembedStatus.totalCount = 0;
  
  if (onProgress) onProgress(reembedStatus.statusText);

  try {
    // 1. Gather all documents currently in the system
    const sources = new Map<string, { path: string; source: 'obsidian' | 'zotero'; title: string }>();

    // Get from vector store first
    try {
      const dbSources = await vectorStore.getSources();
      for (const s of dbSources) {
        sources.set(s.path, s);
      }
    } catch (e) {
      console.warn("[Re-embed] Failed to get sources from database:", e);
    }

    // Also check the sync tracker to ensure no missing documents
    try {
      const trackerZoteroKeys = syncTracker.getAllZoteroKeys();
      for (const key of trackerZoteroKeys) {
        if (!sources.has(key)) {
          sources.set(key, { path: key, source: 'zotero', title: `Zotero Paper: ${key}` });
        }
      }
      
      const trackerObsidianPaths = Object.keys((syncTracker as any).state?.obsidian || {});
      for (const p of trackerObsidianPaths) {
        if (!sources.has(p)) {
          sources.set(p, { path: p, source: 'obsidian', title: path.basename(p) });
        }
      }
    } catch (e) {
      console.warn("[Re-embed] Failed to read sync tracker keys:", e);
    }

    const docList = Array.from(sources.values());
    reembedStatus.totalCount = docList.length;

    if (docList.length === 0) {
      reembedStatus.statusText = "No documents found to re-embed.";
      if (onProgress) onProgress(reembedStatus.statusText);
      return { success: true, message: "No documents found to re-embed." };
    }

    reembedStatus.statusText = `Found ${docList.length} documents. Resolving active model...`;
    if (onProgress) onProgress(reembedStatus.statusText);

    // 2. Clear metadata to bypass mismatch check and reload model
    const workspaceDir = path.join(os.homedir(), ".omnimind");
    const metadataPath = path.join(workspaceDir, "embedding_model.json");
    if (fs.existsSync(metadataPath)) {
      try {
        fs.unlinkSync(metadataPath);
      } catch (err) {
        console.warn("[Re-embed] Failed to delete embedding_model.json", err);
      }
    }

    // Drop database table to ensure dimension/schema update
    reembedStatus.statusText = "Resetting database table...";
    if (onProgress) onProgress(reembedStatus.statusText);
    await vectorStore.resetDatabase();

    // Now resolve active model
    const activeModel = await embedder.resolveEmbeddingModel();
    const activeModelId = activeModel.identifier;

    reembedStatus.statusText = `Using active embedding model: ${activeModelId}. Starting re-embedding...`;
    if (onProgress) onProgress(reembedStatus.statusText);

    for (let i = 0; i < docList.length; i++) {
      const doc = docList[i];
      reembedStatus.statusText = `Re-embedding [${i + 1}/${docList.length}]: ${doc.title}`;
      if (onProgress) onProgress(reembedStatus.statusText);

      try {
        if (doc.source === 'obsidian') {
          if (fs.existsSync(doc.path)) {
            const note = obsidianWatcher.parseNote(doc.path);
            if (note) {
              await embedder.processDocument("obsidian", note.filePath, note.title, note.content, note.links, async (batch) => {
                await vectorStore.upsertChunks(batch);
              });
              reembedStatus.succeededCount++;
            } else {
              reembedStatus.failedCount++;
            }
          } else {
            console.warn(`[Re-embed] Obsidian note file not found: ${doc.path}`);
            reembedStatus.failedCount++;
          }
        } else if (doc.source === 'zotero') {
          const cachePath = path.join(workspaceDir, "ocr_cache", `${doc.path}.md`);
          let textContent: string | null = null;

          if (fs.existsSync(cachePath)) {
            textContent = fs.readFileSync(cachePath, 'utf-8');
            console.log(`[Re-embed] Cache hit for Zotero item ${doc.path}, using cached text.`);
          } else {
            console.log(`[Re-embed] Cache miss for Zotero item ${doc.path}. Querying metadata to re-parse...`);
            const payload = await zoteroExtractor.getPayloadByKey(doc.path);
            if (payload) {
              const item = await zoteroExtractor.executeJob(payload);
              textContent = item.textContent;
            }
          }

          if (textContent) {
            await embedder.processDocument("zotero", doc.path, doc.title, textContent, [], async (batch) => {
              await vectorStore.upsertChunks(batch);
            });
            reembedStatus.succeededCount++;
          } else {
            console.warn(`[Re-embed] Could not retrieve text content for Zotero item: ${doc.path}`);
            reembedStatus.failedCount++;
          }
        }
      } catch (err: any) {
        console.error(`[Re-embed] Failed to re-embed ${doc.title}:`, err);
        reembedStatus.failedCount++;
      }
    }

    reembedStatus.statusText = `Re-embedding complete! Succeeded: ${reembedStatus.succeededCount}, Failed: ${reembedStatus.failedCount}`;
    if (onProgress) onProgress(reembedStatus.statusText);
    return { success: true, message: reembedStatus.statusText };

  } catch (error: any) {
    console.error("[Re-embed] Fatal error during re-embedding:", error);
    reembedStatus.statusText = `Re-embedding failed: ${error.message || error}`;
    if (onProgress) onProgress(reembedStatus.statusText);
    return { success: false, message: error.message || "Unknown error during re-embedding" };
  } finally {
    reembedStatus.inProgress = false;
  }
}
