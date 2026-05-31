import * as lancedb from '@lancedb/lancedb';
import path from 'path';

export type DocumentChunk = {
  id: string; // Unique ID (e.g. hash of content or source path + index)
  vector: number[]; // The embedding vector
  source: 'obsidian' | 'zotero';
  path: string; // File path or citation key
  text: string; // The raw text content
  links_to: string; // Comma separated list of wikilinks (LanceDB has limited support for string arrays depending on schema, storing as string is safer)
};

export class VectorStore {
  private dbPath: string;
  private db: lancedb.Connection | null = null;
  private tableName = 'knowledge_graph';

  constructor(workspaceDir: string) {
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

    const tableNames = await this.db.tableNames();
    
    // If table exists, open it. Otherwise create it.
    let table: lancedb.Table;
    if (tableNames.includes(this.tableName)) {
      table = await this.db.openTable(this.tableName);
      await table.add(chunks);
    } else {
      table = await this.db.createTable(this.tableName, chunks);
    }
  }

  /**
   * Deletes all chunks associated with a specific file path or citation key.
   */
  public async deleteByPath(path: string) {
    if (!this.db) throw new Error("Database not initialized");
    const tableNames = await this.db.tableNames();
    if (tableNames.includes(this.tableName)) {
      const table = await this.db.openTable(this.tableName);
      // Ensure we escape quotes just in case, LanceDB SQL uses backticks or standard SQL quoting depending on schema, usually standard SQL string literal ''
      const safePath = path.replace(/'/g, "''");
      try {
        await table.delete(`path = '${safePath}'`);
      } catch (e) {
        console.error(`Failed to delete old chunks for path: ${path}`, e);
      }
    }
  }

  /**
   * Performs a vector similarity search.
   */
  public async search(queryVector: number[], options?: { sourceFilter?: 'obsidian' | 'zotero', limit?: number }): Promise<DocumentChunk[]> {
    if (!this.db) throw new Error("Database not initialized");
    
    const tableNames = await this.db.tableNames();
    console.log(`LanceDB tables found: ${tableNames.join(", ")}`);
    if (!tableNames.includes(this.tableName)) {
      console.warn(`Table ${this.tableName} not found!`);
      return []; // Table hasn't been created yet (no data)
    }

    const limit = options?.limit || 5;
    const table = await this.db.openTable(this.tableName);
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
      results = await table.query().select(['source', 'path']).toArray();
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
      results = await table.query().select(['source', 'path']).toArray();
    } catch (e) {
      console.warn("Schema mismatch, returning empty sources.");
      return [];
    }
    
    const unique = new Map<string, any>();
    for (const row of results) {
      if (!unique.has(row.path as string)) {
        unique.set(row.path as string, { path: row.path, source: row.source });
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
}
