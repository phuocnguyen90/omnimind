import * as fs from 'fs';
import * as path from 'path';

export interface SyncState {
  zotero: Record<string, boolean>; // cite_key -> true
  obsidian: Record<string, number>; // filepath -> mtimeMs
}

export class SyncTracker {
  private stateFilePath: string;
  private state: SyncState;
  private pendingSave: boolean = false;

  constructor(workspaceDir: string) {
    this.stateFilePath = path.join(workspaceDir, 'sync_state.json');
    this.state = this.loadState();
  }

  private loadState(): SyncState {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const data = fs.readFileSync(this.stateFilePath, 'utf-8');
        return JSON.parse(data);
      } catch (e) {
        console.error("Failed to parse sync_state.json. Starting fresh.");
      }
    }
    return { zotero: {}, obsidian: {} };
  }

  private saveState() {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.error("[SyncTracker] Failed to write sync_state.json:", e);
    }
  }

  // --- Zotero ---

  public hasZotero(key: string): boolean {
    return !!this.state.zotero[key];
  }

  public markZoteroComplete(key: string) {
    this.state.zotero[key] = true;
    this.saveState();
  }

  public getAllZoteroKeys(): string[] {
    return Object.keys(this.state.zotero);
  }

  public removeZoteroKey(key: string) {
    delete this.state.zotero[key];
    this.saveState();
  }

  // --- Obsidian ---

  public getObsidianMtime(filepath: string): number | undefined {
    return this.state.obsidian[filepath];
  }

  public markObsidianComplete(filepath: string, mtimeMs: number) {
    this.state.obsidian[filepath] = mtimeMs;
    this.saveState();
  }

  public markObsidianDeleted(filepath: string) {
    delete this.state.obsidian[filepath];
    this.saveState();
  }
}
