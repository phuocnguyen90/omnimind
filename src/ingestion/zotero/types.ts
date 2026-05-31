export interface ZoteroItem {
  key: string;       // The unique citation key (e.g. 8-character hash)
  title: string;
  pdfPath: string | null;
  textContent: string | null; // Extracted from PDF
}
