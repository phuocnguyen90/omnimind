import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';

export interface ObsidianNote {
  filePath: string;
  title: string;
  content: string;
  frontmatter: Record<string, any>;
  links: string[]; // extracted [[wikilinks]]
}

export class ObsidianVaultWatcher {
  private vaultPath: string;
  private watcher: chokidar.FSWatcher | null = null;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  /**
   * Starts watching the Obsidian vault for changes.
   * @param onNoteChanged Callback fired when a note is added or updated
   * @param onNoteRemoved Callback fired when a note is deleted
   */
  public watch(
    onNoteChanged: (note: ObsidianNote) => Promise<void>,
    onNoteRemoved: (filePath: string) => Promise<void>
  ) {
    if (!fs.existsSync(this.vaultPath)) {
      throw new Error(`Vault path does not exist: ${this.vaultPath}`);
    }

    this.watcher = chokidar.watch(path.join(this.vaultPath, '**/*.md'), {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: false, // ensure we process all existing files on startup
    });

    this.watcher
      .on('add', async (filePath: string) => {
        const note = this.parseNote(filePath);
        if (note) await onNoteChanged(note);
      })
      .on('change', async (filePath: string) => {
        const note = this.parseNote(filePath);
        if (note) await onNoteChanged(note);
      })
      .on('unlink', async (filePath: string) => {
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

  private parseNote(filePath: string): ObsidianNote | null {
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
