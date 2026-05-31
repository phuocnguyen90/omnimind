import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { SyncTracker } from '../tracker';
import { JobQueue } from '../queue';

export class ZoteroDB {
  private dbPath: string;
  private storagePath: string;
  private syncTracker: SyncTracker;

  constructor(dbPath: string, storagePath: string, syncTracker: SyncTracker) {
    this.dbPath = dbPath;
    this.storagePath = storagePath;
    this.syncTracker = syncTracker;
  }

  /**
   * Fast discovery phase: Scans the SQLite DB and populates the JobQueue with pending PDFs.
   * Extracts rich metadata (Authors, Year, Title) to perfectly ground LLM embeddings.
   */
  public async discoverJobs(jobQueue: JobQueue): Promise<void> {
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`Zotero database not found at ${this.dbPath}`);
    }

    const SQL = await initSqlJs();
    const filebuffer = fs.readFileSync(this.dbPath);
    const db = new SQL.Database(filebuffer);

    // 1. Resolve Zotero dynamic field IDs
    const fieldQuery = `SELECT fieldName, fieldID FROM fields WHERE fieldName IN ('title','date')`;
    const fStmt = db.prepare(fieldQuery);
    const fids: Record<string, number> = {};
    while (fStmt.step()) {
      const row = fStmt.getAsObject();
      fids[row.fieldName as string] = row.fieldID as number;
    }
    fStmt.free();

    const authorQuery = `SELECT creatorTypeID FROM creatorTypes WHERE creatorType = 'author'`;
    const aStmt = db.prepare(authorQuery);
    let authorTypeId = 1;
    if (aStmt.step()) {
      authorTypeId = aStmt.getAsObject().creatorTypeID as number;
    }
    aStmt.free();

    // 2. Extract PDF attachments along with Parent Metadata
    const query = `
      SELECT
          i.key AS item_key,
          tv.value  AS title,
          GROUP_CONCAT(c.lastName || ', ' || c.firstName, '; ') AS authors,
          dv.value  AS year,
          att.path  AS file_name,
          atti.key  AS storage_key
      FROM items i
      LEFT JOIN itemData    td   ON td.itemID   = i.itemID AND td.fieldID   = ${fids['title'] || -1}
      LEFT JOIN itemDataValues tv ON tv.valueID = td.valueID
      LEFT JOIN itemData    dd   ON dd.itemID   = i.itemID AND dd.fieldID   = ${fids['date'] || -1}
      LEFT JOIN itemDataValues dv ON dv.valueID = dd.valueID
      LEFT JOIN itemCreators ic ON ic.itemID = i.itemID AND ic.creatorTypeID = ${authorTypeId}
      LEFT JOIN creators c ON c.creatorID = ic.creatorID
      JOIN (
          SELECT parentItemID, MIN(itemID) AS itemID, path
          FROM itemAttachments
          WHERE contentType IN ('application/pdf', 'application/epub+zip', 'text/html') 
            AND path LIKE 'storage:%'
          GROUP BY parentItemID
      ) att ON att.parentItemID = i.itemID
      JOIN items atti ON atti.itemID = att.itemID
      WHERE i.itemTypeID NOT IN (14, 26)
        AND tv.value IS NOT NULL
      GROUP BY i.itemID
    `;

    const stmt = db.prepare(query);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const key = row.storage_key as string;
      const fileName = (row.file_name as string).replace('storage:', '');
      
      // Format the Title as a BibTeX-style citation string
      let richTitle = fileName;
      if (row.title) {
        const yearMatch = row.year ? String(row.year).substring(0,4) : "n.d.";
        let authorStr = "Unknown";
        if (row.authors) {
           const authorsList = String(row.authors).split(';');
           if (authorsList.length === 1) {
             authorStr = authorsList[0].split(',')[0].trim();
           } else if (authorsList.length === 2) {
             authorStr = `${authorsList[0].split(',')[0].trim()} & ${authorsList[1].split(',')[0].trim()}`;
           } else {
             authorStr = `${authorsList[0].split(',')[0].trim()} et al.`;
           }
        }
        richTitle = `${authorStr} (${yearMatch}) - ${row.title}`;
      }

      if (!this.syncTracker.hasZotero(key)) {
        jobQueue.addJob({
          id: key,
          type: 'zotero',
          title: richTitle,
          payload: { ...row, rich_title: richTitle }
        });
      }
    }
    stmt.free();
    db.close();
    
    console.log(`[Zotero] Discovery complete. Pending jobs added to queue.`);
  }

  /**
   * Look up specific paper metadata from the Zotero database by a query string.
   */
  public async getPaperInfo(queryStr: string): Promise<any[]> {
    if (!fs.existsSync(this.dbPath)) return [];

    const SQL = await initSqlJs();
    const filebuffer = fs.readFileSync(this.dbPath);
    const db = new SQL.Database(filebuffer);

    const fieldQuery = `SELECT fieldName, fieldID FROM fields WHERE fieldName IN ('title','date','DOI','abstractNote')`;
    const fStmt = db.prepare(fieldQuery);
    const fids: Record<string, number> = {};
    while (fStmt.step()) {
      const row = fStmt.getAsObject();
      fids[row.fieldName as string] = row.fieldID as number;
    }
    fStmt.free();

    const authorQuery = `SELECT creatorTypeID FROM creatorTypes WHERE creatorType = 'author'`;
    const aStmt = db.prepare(authorQuery);
    let authorTypeId = 1;
    if (aStmt.step()) authorTypeId = aStmt.getAsObject().creatorTypeID as number;
    aStmt.free();

    const query = `
      SELECT
          i.key AS item_key,
          tv.value  AS title,
          GROUP_CONCAT(c.lastName || ', ' || c.firstName, '; ') AS authors,
          dv.value  AS year,
          doiv.value AS doi,
          av.value AS abstract,
          att.path  AS file_name,
          atti.key  AS storage_key
      FROM items i
      LEFT JOIN itemData    td   ON td.itemID   = i.itemID AND td.fieldID   = ${fids['title'] || -1}
      LEFT JOIN itemDataValues tv ON tv.valueID = td.valueID
      LEFT JOIN itemData    dd   ON dd.itemID   = i.itemID AND dd.fieldID   = ${fids['date'] || -1}
      LEFT JOIN itemDataValues dv ON dv.valueID = dd.valueID
      LEFT JOIN itemData    doid ON doid.itemID   = i.itemID AND doid.fieldID   = ${fids['DOI'] || -1}
      LEFT JOIN itemDataValues doiv ON doiv.valueID = doid.valueID
      LEFT JOIN itemData    ad   ON ad.itemID   = i.itemID AND ad.fieldID   = ${fids['abstractNote'] || -1}
      LEFT JOIN itemDataValues av ON av.valueID = ad.valueID
      LEFT JOIN itemCreators ic ON ic.itemID = i.itemID AND ic.creatorTypeID = ${authorTypeId}
      LEFT JOIN creators c ON c.creatorID = ic.creatorID
      LEFT JOIN (
          SELECT parentItemID, MIN(itemID) AS itemID, path
          FROM itemAttachments
          WHERE contentType = 'application/pdf' AND path LIKE 'storage:%.pdf'
          GROUP BY parentItemID
      ) att ON att.parentItemID = i.itemID
      LEFT JOIN items atti ON atti.itemID = att.itemID
      WHERE i.itemTypeID NOT IN (14, 26)
        AND tv.value IS NOT NULL
        AND (tv.value LIKE '%' || $query || '%' OR c.lastName LIKE '%' || $query || '%' OR doiv.value LIKE '%' || $query || '%')
      GROUP BY i.itemID
      LIMIT 5
    `;

    const stmt = db.prepare(query);
    stmt.bind({ $query: queryStr });
    
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    
    stmt.free();
    db.close();
    
    return results.map(row => {
      const fileName = row.file_name ? (row.file_name as string).replace('storage:', '') : null;
      let pdfPath = null;
      if (fileName && row.storage_key) {
         pdfPath = path.join(this.storagePath, row.storage_key as string, fileName);
      }
      return {
        key: row.storage_key || row.item_key,
        title: row.title,
        authors: row.authors ? String(row.authors).split(';') : [],
        year: row.year ? String(row.year).substring(0,4) : "",
        doi: row.doi,
        abstract: row.abstract,
        pdfPath
      };
    });
  }
}
