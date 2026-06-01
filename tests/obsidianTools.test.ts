import test from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Import index so we can mutate the global exported variables
import * as index from '../src/index';

import { 
  writeObsidianNoteTool, 
  readObsidianNoteTool, 
  editObsidianNoteTool,
  searchPersonalNotesTool
} from '../src/tools/obsidianTools';

test('Obsidian Tools', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnimind-obsidian-test-'));
  
  // Mutate the active path using the injection helper
  index._testInjectObsidianVaultPath(tmpDir);

  await t.test('write_obsidian_note successfully creates note', async () => {
    const res = await writeObsidianNoteTool.implementation({
      filename: 'Test Note',
      content: '# Hello World'
    });
    
    const parsed = JSON.parse(res as string);
    assert.strictEqual(parsed.success, true);
    
    const fileContent = fs.readFileSync(path.join(tmpDir, 'Test Note.md'), 'utf-8');
    assert.strictEqual(fileContent, '# Hello World');
  });

  await t.test('write_obsidian_note rejects duplicates', async () => {
    const res = await writeObsidianNoteTool.implementation({
      filename: 'Test Note.md',
      content: 'Different content'
    });
    
    const parsed = JSON.parse(res as string);
    assert.match(parsed.error, /already exists/);
  });

  await t.test('read_obsidian_note reads correct content', async () => {
    const res = await readObsidianNoteTool.implementation({
      filename: 'Test Note'
    });
    
    const parsed = JSON.parse(res as string);
    assert.strictEqual(parsed.content, '# Hello World');
  });

  await t.test('edit_obsidian_note replaces content exactly', async () => {
    const res = await editObsidianNoteTool.implementation({
      filename: 'Test Note',
      target_content: '# Hello World',
      replacement_content: '# Goodbye World\nNew paragraph'
    });
    
    const parsed = JSON.parse(res as string);
    assert.strictEqual(parsed.success, true);
    
    const fileContent = fs.readFileSync(path.join(tmpDir, 'Test Note.md'), 'utf-8');
    assert.strictEqual(fileContent, '# Goodbye World\nNew paragraph');
  });
  
  await t.test('search_personal_notes filters by obsidian source', async () => {
    // Mock the embedder and vectorStore
    let searchSourceFilter = '';
    
    index._testInjectEmbedder({
      generateEmbedding: async () => [0.5, 0.5]
    });
    
    index._testInjectVectorStore({
      search: async (vector: number[], options: any) => {
        searchSourceFilter = options.sourceFilter;
        return [
          { path: 'some_note.md', text: 'Match 1', links_to: '' }
        ];
      }
    });
    
    const res = await searchPersonalNotesTool.implementation({
      query: 'something',
      limit: 3
    });
    
    const parsed = JSON.parse(res as string);
    assert.strictEqual(searchSourceFilter, 'obsidian');
    assert.strictEqual(parsed[0].path, 'some_note.md');
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
