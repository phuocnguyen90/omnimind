import * as lancedb from '@lancedb/lancedb';
import path from 'path';

export interface DocumentChunk {
  id: string; // Unique ID (e.g. hash of content or source path + index)
  vector: number[]; // The embedding vector
  source: 'obsidian' | 'zotero';
  path: string; // File path or citation key
  text: string; // The raw text content
  links_to: string; // Comma separated list of wikilinks (LanceDB has limited support for string arrays depending on schema, storing as string is safer)
}

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
   * Performs a vector similarity search.
   */
  public async search(queryVector: number[], limit: number = 5): Promise<DocumentChunk[]> {
    if (!this.db) throw new Error("Database not initialized");
    
    const tableNames = await this.db.tableNames();
    if (!tableNames.includes(this.tableName)) {
      return []; // Table hasn't been created yet (no data)
    }

    const table = await this.db.openTable(this.tableName);
    const results = await table.search(queryVector).limit(limit).execute();
    
    return results as unknown as DocumentChunk[];
  }
}
