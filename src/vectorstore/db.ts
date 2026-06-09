import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * IMPORTANT: This must remain a `type` and NOT an `interface`.
 * LanceDB's TypeScript definitions expect arrays of `Record<string, unknown>`.
 * `type` aliases implicitly satisfy index signatures, while `interface` declarations do not.
 * Changing this to an `interface` will cause fatal TypeScript compiler errors during `table.add()`.
 */
export type DocumentChunk = {
  id: string; // Unique ID (e.g. hash of content or source path + index)
  vector: number[]; // The embedding vector
  source: 'obsidian' | 'zotero';
  path: string; // File path or citation key
  text: string; // The raw text content
  links_to: string; // Comma separated list of wikilinks (LanceDB has limited support for string arrays depending on schema, storing as string is safer)
  model?: string; // The embedding model identifier that generated this chunk
};

export class VectorStore {
  private dbPath: string;
  private workspaceDir: string;
  private db: lancedb.Connection | null = null;
  private tableName = 'knowledge_graph';
  private writeLock: Promise<void> = Promise.resolve();
  private lastMismatchCheck: { timestamp: number; result: boolean; dbModel: string | null; activeModelId: string } | null = null;

  private async acquireWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previousLock = this.writeLock;
    let releaseLock: () => void;
    this.writeLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    try {
      await previousLock;
      return await operation();
    } finally {
      releaseLock!();
    }
  }

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
    // Store the LanceDB data within the plugin's workspace or a dedicated directory
    this.dbPath = path.join(workspaceDir, '.lancedb');
  }

  public async initialize() {
    this.db = await lancedb.connect(this.dbPath);
    console.log(`Connected to LanceDB at ${this.dbPath}`);
  }

  /**
   * Upserts chunks into the LanceDB table.
   */
  public async upsertChunks(chunks: DocumentChunk[]) {
    if (!this.db) throw new Error("Database not initialized");
    if (chunks.length === 0) return;

    await this.acquireWriteLock(async () => {
      const tableNames = await this.db!.tableNames();

      // If table exists, open it. Otherwise create it.
      let table: lancedb.Table;
      if (tableNames.includes(this.tableName)) {
        table = await this.db!.openTable(this.tableName);
        await table.add(chunks);
      } else {
        table = await this.db!.createTable(this.tableName, chunks);
        // Create a BM25 Full Text Search index on the 'text' column
        try {
          await table.createIndex("text", { config: lancedb.Index.fts() });
          console.log("Created FTS index on 'text' column.");
        } catch (e) {
          console.warn("Could not create FTS index:", e);
        }
      }
    });
  }

  /**
   * Deletes all chunks associated with a specific file path or citation key.
   */
  public async deleteByPath(path: string) {
    if (!this.db) throw new Error("Database not initialized");

    await this.acquireWriteLock(async () => {
      const tableNames = await this.db!.tableNames();
      if (tableNames.includes(this.tableName)) {
        const table = await this.db!.openTable(this.tableName);
        // Ensure we escape quotes just in case, LanceDB SQL uses backticks or standard SQL quoting depending on schema, usually standard SQL string literal ''
        const safePath = path.replace(/'/g, "''");
        try {
          await table.delete(`path = '${safePath}'`);
        } catch (e) {
          console.error(`Failed to delete old chunks for path: ${path}`, e);
        }
      }
    });
  }

  /**
   * Helper to calculate cosine similarity
   */
  private cosineSimilarity(a: number[], b: any): number {
    // LanceDB returns vectors as Apache Arrow Vector objects, we need to convert to array
    const bArray = b && typeof b.toArray === 'function' ? b.toArray() : b;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * bArray[i];
      normA += a[i] * a[i];
      normB += bArray[i] * bArray[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Performs advanced search (Vector, BM25, Hybrid, MMR).
   */
  public async search(queryString: string, queryVector: number[], options?: { sourceFilter?: 'obsidian' | 'zotero', limit?: number, algorithm?: 'vector' | 'bm25' | 'hybrid' | 'mmr', activeModelId?: string }): Promise<DocumentChunk[]> {
    if (!this.db) throw new Error("Database not initialized");

    const tableNames = await this.db.tableNames();
    if (!tableNames.includes(this.tableName)) {
      console.warn(`Table ${this.tableName} not found!`);
      return []; // Table hasn't been created yet (no data)
    }

    const limit = options?.limit || 5;
    const table = await this.db.openTable(this.tableName);

    // Validate embedding model mismatch if activeModelId is provided
    if (options?.activeModelId) {
      const isMismatch = await this.checkModelMismatch(options.activeModelId);
      if (isMismatch) {
        const storedModel = await this.getDatabaseModel();
        throw new Error(
          `Embedding model mismatch! Database contains chunks generated by model '${storedModel || 'unknown'}', but the active model is '${options.activeModelId}'. ` +
          `Please re-embed your documents or load the matching model in LM Studio.`
        );
      }
    }

    // Read dynamic search config
    let searchAlgorithm = 'vector';
    let mmrDiversity = 0.5;
    try {
      const configPath = path.join(os.homedir(), '.omnimind', 'search_config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.algorithm) searchAlgorithm = config.algorithm;
        if (typeof config.mmrDiversity === 'number') mmrDiversity = config.mmrDiversity;
      }
    } catch (e) {
      console.warn("Failed to read search config, falling back to defaults", e);
    }
    
    // Allow tool override
    if (options?.algorithm) {
      searchAlgorithm = options.algorithm;
    }

    console.log(`[VectorStore] Searching with algorithm: ${searchAlgorithm}`);

    const ensureFts = async () => {
      console.log("FTS Index missing. Creating now...");
      try {
        await table.createIndex("text", { config: lancedb.Index.fts() });
        console.log("Successfully created FTS index.");
      } catch (e) {
        console.warn("Could not create FTS index on the fly:", e);
      }
    };

    if (searchAlgorithm === 'bm25') {
      const runQuery = async () => {
        let query = table.search(queryString).fullTextSearch(queryString).limit(limit);
        if (options?.sourceFilter) query = query.where(`source = '${options.sourceFilter}'`);
        return (await query.toArray()) as unknown as DocumentChunk[];
      };
      
      try {
        return await runQuery();
      } catch (e: any) {
        if (e.message && e.message.includes('INVERTED index')) {
          await ensureFts();
          return await runQuery();
        }
        throw e;
      }
    }

    if (searchAlgorithm === 'hybrid') {
      // Fetch both and merge using basic score normalization
      let vQuery = table.search(queryVector).limit(limit * 2);
      let ftsQuery = table.search(queryString).fullTextSearch(queryString).limit(limit * 2);

      if (options?.sourceFilter) {
        vQuery = vQuery.where(`source = '${options.sourceFilter}'`);
        ftsQuery = ftsQuery.where(`source = '${options.sourceFilter}'`);
      }

      let vResults: any[];
      let ftsResults: any[];
      
      try {
        [vResults, ftsResults] = await Promise.all([vQuery.toArray(), ftsQuery.toArray()]);
      } catch (e: any) {
        if (e.message && e.message.includes('INVERTED index')) {
          await ensureFts();
          [vResults, ftsResults] = await Promise.all([vQuery.toArray(), ftsQuery.toArray()]);
        } else {
          throw e;
        }
      }

      // Simple Reciprocal Rank Fusion
      const scores = new Map<string, { doc: any, score: number }>();
      const RRF_K = 60;

      vResults.forEach((doc, idx) => {
        const id = (doc as any).id;
        scores.set(id, { doc, score: 1 / (RRF_K + idx + 1) });
      });

      ftsResults.forEach((doc, idx) => {
        const id = (doc as any).id;
        const existing = scores.get(id);
        if (existing) {
          existing.score += 1 / (RRF_K + idx + 1);
        } else {
          scores.set(id, { doc, score: 1 / (RRF_K + idx + 1) });
        }
      });

      const merged = Array.from(scores.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(i => i.doc);

      return merged as unknown as DocumentChunk[];
    }

    if (searchAlgorithm === 'mmr') {
      // Fetch 3x results for MMR selection
      let query = table.search(queryVector).limit(limit * 3);
      if (options?.sourceFilter) query = query.where(`source = '${options.sourceFilter}'`);
      const results = await query.toArray();

      if (results.length === 0) return [];

      // MMR Implementation
      const selected: any[] = [];
      const unselected = [...results];

      // First select the most relevant
      selected.push(unselected.shift());

      while (selected.length < limit && unselected.length > 0) {
        let bestScore = -Infinity;
        let bestIndex = -1;

        for (let i = 0; i < unselected.length; i++) {
          const doc = unselected[i];
          const relevance = this.cosineSimilarity(queryVector, doc.vector as unknown as number[]);

          let maxDiversityPenalty = 0;
          for (const sDoc of selected) {
            const similarity = this.cosineSimilarity(doc.vector as unknown as number[], sDoc.vector as unknown as number[]);
            if (similarity > maxDiversityPenalty) {
              maxDiversityPenalty = similarity;
            }
          }

          const mmrScore = (1 - mmrDiversity) * relevance - mmrDiversity * maxDiversityPenalty;

          if (mmrScore > bestScore) {
            bestScore = mmrScore;
            bestIndex = i;
          }
        }

        if (bestIndex === -1) {
          console.warn("MMR failed to find a valid bestIndex (possibly due to NaN vectors). Breaking loop.");
          break;
        }

        selected.push(unselected[bestIndex]);
        unselected.splice(bestIndex, 1);
      }

      return selected as unknown as DocumentChunk[];
    }

    // Default: Vector Search
    let query = table.search(queryVector).limit(limit);

    if (options?.sourceFilter) {
      // Use standard SQL string literal quotes for LanceDB
      query = query.where(`source = '${options.sourceFilter}'`);
    }

    const results = await query.toArray();
    return results as unknown as DocumentChunk[];
  }

  public async getStats() {
    if (!this.db) return { totalChunks: 0, sources: { obsidian: 0, zotero: 0 } };
    const tableNames = await this.db.tableNames();
    if (!tableNames.includes(this.tableName)) return { totalChunks: 0, sources: { obsidian: 0, zotero: 0 } };
    const table = await this.db.openTable(this.tableName);
    // Fetch a small subset of fields to compute stats. LanceDB JS doesn't have aggregate COUNT yet.
    let results: any[] = [];
    const stats = { totalChunks: 0, sources: { obsidian: 0, zotero: 0 } };
    try {
      stats.totalChunks = await table.countRows();
      results = await table.query().select(['source', 'path']).limit(100000).toArray();
    } catch (e) {
      console.warn("Schema mismatch, returning empty stats.");
      return stats;
    }

    const uniquePaths = { obsidian: new Set<string>(), zotero: new Set<string>() };

    for (const row of results) {
      if (row.source === 'obsidian') uniquePaths.obsidian.add(row.path as string);
      else if (row.source === 'zotero') uniquePaths.zotero.add(row.path as string);
    }

    stats.sources.obsidian = uniquePaths.obsidian.size;
    stats.sources.zotero = uniquePaths.zotero.size;
    return stats;
  }

  public async getSources() {
    if (!this.db) return [];
    const tableNames = await this.db.tableNames();
    if (!tableNames.includes(this.tableName)) return [];
    const table = await this.db.openTable(this.tableName);
    let results: any[] = [];
    try {
      results = await table.query().select(['source', 'path', 'text']).limit(100000).toArray();
    } catch (e) {
      console.warn("Schema mismatch, returning empty sources.");
      return [];
    }

    const unique = new Map<string, any>();
    for (const row of results) {
      if (!unique.has(row.path as string)) {
        const text = row.text as string || '';
        const titleMatch = text.match(/^Source:\s*([\s\S]+?)\n\n/);
        const title = titleMatch ? titleMatch[1].trim() : (row.path as string).split(/\\|\//).pop() || '';
        
        unique.set(row.path as string, { 
          path: row.path, 
          source: row.source,
          title: title
        });
      }
    }
    return Array.from(unique.values());
  }

  public async getChunksByPath(path: string) {
    if (!this.db) return [];
    const tableNames = await this.db.tableNames();
    if (!tableNames.includes(this.tableName)) return [];
    const table = await this.db.openTable(this.tableName);
    const safePath = path.replace(/'/g, "''");
    let results: any[] = [];
    try {
      results = await table.query().where(`path = '${safePath}'`).select(['id', 'text']).toArray();
    } catch (e) {
      console.warn(`Failed to query chunks for ${path}`, e);
      return [];
    }
    return results;
  }

  /**
   * Reset database by dropping the table to clean up or switch model dimensions.
   */
  public async resetDatabase() {
    if (!this.db) throw new Error("Database not initialized");
    const tableNames = await this.db.tableNames();
    if (tableNames.includes(this.tableName)) {
      await this.db.dropTable(this.tableName);
    }
    this.lastMismatchCheck = null;
  }

  /**
   * Check if the database contains any chunks generated by a different model.
   * Caches the result for 5 seconds to avoid excessive DB queries.
   */
  public async checkModelMismatch(activeModelId: string): Promise<boolean> {
    if (!this.db) return false;

    const now = Date.now();
    if (this.lastMismatchCheck && (now - this.lastMismatchCheck.timestamp) < 5000 && this.lastMismatchCheck.activeModelId === activeModelId) {
      return this.lastMismatchCheck.result;
    }

    const tableNames = await this.db.tableNames();
    if (!tableNames.includes(this.tableName)) {
      return false;
    }

    try {
      const table = await this.db.openTable(this.tableName);
      const rowCount = await table.countRows();
      if (rowCount === 0) {
        this.lastMismatchCheck = { timestamp: now, result: false, dbModel: null, activeModelId };
        return false;
      }

      // Query the first row to check its model
      const firstRows = await table.query().select(['model']).limit(1).toArray();
      if (firstRows.length > 0) {
        const storedModel = firstRows[0].model;
        const mismatch = !!(storedModel && storedModel !== activeModelId);
        this.lastMismatchCheck = { timestamp: now, result: mismatch, dbModel: storedModel || null, activeModelId };
        return mismatch;
      }
    } catch (err: any) {
      // If model column doesn't exist, and we have rows, it's a mismatch (old database schema)
      try {
        const table = await this.db.openTable(this.tableName);
        const rowCount = await table.countRows();
        const mismatch = rowCount > 0;
        this.lastMismatchCheck = { timestamp: now, result: mismatch, dbModel: 'Untracked/Old Model', activeModelId };
        return mismatch;
      } catch (e) {
        return false;
      }
    }

    return false;
  }

  /**
   * Get the embedding model identifier used by the database chunks.
   */
  public async getDatabaseModel(): Promise<string | null> {
    if (this.lastMismatchCheck) {
      return this.lastMismatchCheck.dbModel;
    }
    if (!this.db) return null;
    const tableNames = await this.db.tableNames();
    if (!tableNames.includes(this.tableName)) return null;
    try {
      const table = await this.db.openTable(this.tableName);
      const firstRows = await table.query().select(['model']).limit(1).toArray();
      if (firstRows.length > 0) {
        return firstRows[0].model || null;
      }
    } catch (e) {}
    return null;
  }
}
