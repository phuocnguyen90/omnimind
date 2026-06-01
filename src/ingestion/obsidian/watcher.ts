import fs from 'fs';
import path from 'path';
import chokidar, { FSWatcher } from 'chokidar';

export interface ObsidianNote {
  filePath: string;
  title: string;
  content: string;
  frontmatter: Record<string, any>;
  links: string[]; // extracted [[wikilinks]]
}

export class ObsidianVaultWatcher {
  private vaultPath: string;
  private watcher: FSWatcher | null = null;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  /**
   * Starts watching the Obsidian vault for changes.
   * @param onNoteChanged Callback fired when a note is added or updated
   * @param onNoteRemoved Callback fired when a note is deleted
   */
  public watch(
    onNoteChanged: (filePath: string) => Promise<void>,
    onNoteRemoved: (filePath: string) => Promise<void>
  ) {
    if (!fs.existsSync(this.vaultPath)) {
      throw new Error(`Vault path does not exist: ${this.vaultPath}`);
    }

    this.watcher = chokidar.watch(this.vaultPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: false, // Must be false to discover all existing notes on startup. Deduplication is handled by syncTracker.
    });

    this.watcher
      .on('add', async (filePath: string) => {
        if (!filePath.endsWith('.md')) return;
        await onNoteChanged(filePath);
      })
      .on('change', async (filePath: string) => {
        if (!filePath.endsWith('.md')) return;
        await onNoteChanged(filePath);
      })
      .on('unlink', async (filePath: string) => {
        if (!filePath.endsWith('.md')) return;
        await onNoteRemoved(filePath);
      });
      
    console.log(`Started watching Obsidian vault: ${this.vaultPath}`);
  }

  public stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  public parseNote(filePath: string): ObsidianNote | null {
    try {
      const rawContent = fs.readFileSync(filePath, 'utf-8');
      const title = path.basename(filePath, '.md');
      
      // Extract basic frontmatter (YAML between --- and ---)
      let content = rawContent;
      let frontmatter: Record<string, any> = {};
      const frontmatterMatch = rawContent.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        // Very basic parsing for tags/aliases (could be improved with a real YAML parser)
        const yamlStr = frontmatterMatch[1];
        yamlStr.split('\n').forEach(line => {
          const [key, ...values] = line.split(':');
          if (key && values.length > 0) {
            frontmatter[key.trim()] = values.join(':').trim();
          }
        });
        // Remove frontmatter from the main content
        content = rawContent.slice(frontmatterMatch[0].length).trim();
      }

      // Extract [[wikilinks]]
      const links: string[] = [];
      const linkRegex = /\[\[(.*?)\]\]/g;
      let match;
      while ((match = linkRegex.exec(content)) !== null) {
        // match[1] contains the text inside the brackets. Split by '|' to get the actual note name if an alias is used.
        const linkTarget = match[1].split('|')[0].trim();
        if (linkTarget) {
          links.push(linkTarget);
        }
      }

      return {
        filePath,
        title,
        content,
        frontmatter,
        links: [...new Set(links)] // deduplicate links
      };
    } catch (err) {
      console.error(`Error parsing Obsidian note at ${filePath}:`, err);
      return null;
    }
  }
}
