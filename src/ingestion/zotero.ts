import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';

export interface ZoteroItem {
  key: string;       // The unique citation key (e.g. 8-character hash)
  title: string;
  pdfPath: string | null;
  textContent: string | null; // Extracted from PDF
}

export class ZoteroExtractor {
  private dbPath: string;
  private storagePath: string;

  constructor(dbPath: string, storagePath: string) {
    this.dbPath = dbPath;
    this.storagePath = storagePath;
  }

  /**
   * Connects to the SQLite database in read-only mode to prevent locking issues
   * with the active Zotero client.
   */
  public async extractLibrary(): Promise<ZoteroItem[]> {
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`Zotero database not found at ${this.dbPath}`);
    }

    const db = new Database(this.dbPath, { readonly: true, fileMustExist: true });

    // We join itemAttachments and items to find PDF attachments
    // The path in itemAttachments usually looks like 'storage:filename.pdf'
    const stmt = db.prepare(`
      SELECT 
        items.key AS storage_key, 
        itemAttachments.path AS file_name,
        items.itemID
      FROM itemAttachments 
      JOIN items ON itemAttachments.itemID = items.itemID
      WHERE itemAttachments.path LIKE 'storage:%.pdf'
    `);

    const rows = stmt.all() as any[];
    db.close();

    const items: ZoteroItem[] = [];

    // Parse each PDF
    for (const row of rows) {
      const fileName = row.file_name.replace('storage:', '');
      const storageDir = path.join(this.storagePath, row.storage_key);
      const pdfFilePath = path.join(storageDir, fileName);

      let textContent: string | null = null;
      let pdfPathToStore: string | null = null;

      if (fs.existsSync(pdfFilePath)) {
        pdfPathToStore = pdfFilePath;
        try {
          const dataBuffer = fs.readFileSync(pdfFilePath);
          const pdfParseFn = (pdfParse as any).default || pdfParse;
          const data = await pdfParseFn(dataBuffer);
          textContent = data.text;
        } catch (err) {
          console.error(`Failed to parse PDF at ${pdfFilePath}`, err);
        }
      }

      items.push({
        key: row.storage_key,
        title: fileName, // Fallback title, ideally we join the Zotero metadata table for the real title
        pdfPath: pdfPathToStore,
        textContent,
      });
    }

    return items;
  }
}
