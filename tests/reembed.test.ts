import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { VectorStore, DocumentChunk } from '../src/vectorstore/db';
import { EmbeddingPipeline } from '../src/ingestion/embedder';
import { runReembedding, reembedStatus } from '../src/ingestion/reembed';
import * as index from '../src/index';

test('Re-embedding & Mismatch Validation', async (t) => {
  const testWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnimind-test-reembed-'));
  
  const cleanUp = () => {
    try {
      fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
    } catch (e) {}
  };

  t.after(cleanUp);

  await t.test('VectorStore mismatch checks and model queries', async () => {
    const vectorStore = new VectorStore(testWorkspaceDir);
    await vectorStore.initialize();

    // Add a chunk with model 'model-alpha'
    const chunks: DocumentChunk[] = [
      {
        id: 'chunk-1',
        vector: [0.1, 0.2, 0.3],
        source: 'obsidian',
        path: '/path/to/note1.md',
        text: 'Hello world',
        links_to: '',
        model: 'model-alpha'
      }
    ];

    await vectorStore.upsertChunks(chunks);

    // Mismatch check with same model should return false
    const matchResult = await vectorStore.checkModelMismatch('model-alpha');
    assert.strictEqual(matchResult, false);

    // Mismatch check with different model should return true
    const mismatchResult = await vectorStore.checkModelMismatch('model-beta');
    assert.strictEqual(mismatchResult, true);

    // Get database model should return 'model-alpha'
    const dbModel = await vectorStore.getDatabaseModel();
    assert.strictEqual(dbModel, 'model-alpha');

    // Reset database should drop the table
    await vectorStore.resetDatabase();
    
    // Mismatch check should now return false since table is dropped
    const postResetMismatch = await vectorStore.checkModelMismatch('model-beta');
    assert.strictEqual(postResetMismatch, false);
  });

  await t.test('runReembedding executes full migration', async () => {
    const vectorStore = new VectorStore(testWorkspaceDir);
    await vectorStore.initialize();

    // Inject VectorStore
    index._testInjectVectorStore(vectorStore);

    // Inject mock Embedder
    const mockEmbedder = {
      resolveEmbeddingModel: async () => ({
        identifier: 'active-model-gamma',
        path: '/path/gamma'
      }),
      processDocument: async (source: string, docPath: string, title: string, content: string, links: string[], onBatch: any) => {
        await onBatch([
          {
            id: `new-${docPath}`,
            vector: [0.5, 0.5, 0.5],
            source,
            path: docPath,
            text: content,
            links_to: links.join(','),
            model: 'active-model-gamma'
          }
        ]);
        return 1;
      }
    };
    index._testInjectEmbedder(mockEmbedder);

    // Inject mock ObsidianWatcher
    const mockWatcher = {
      parseNote: (filePath: string) => ({
        filePath,
        title: 'Mock Obsidian',
        content: 'Clean markdown note text content',
        frontmatter: {},
        links: []
      })
    };
    index._testInjectObsidianWatcher(mockWatcher);

    // Inject mock ZoteroExtractor
    const mockExtractor = {
      getPayloadByKey: async (key: string) => ({
        storage_key: key,
        file_name: 'storage:paper.pdf',
        rich_title: 'Zotero Paper Payload'
      }),
      executeJob: async (payload: any) => ({
        key: payload.storage_key,
        title: payload.rich_title,
        pdfPath: '/path/to/pdf',
        textContent: 'Scanned paper OCR or fast text content parsed'
      })
    };
    index._testInjectZoteroExtractor(mockExtractor);

    const dummyObsidianPath = path.join(testWorkspaceDir, 'note1.md');
    fs.writeFileSync(dummyObsidianPath, 'Hello Obsidian content');

    // Inject mock SyncTracker
    const mockSyncTracker = {
      getAllZoteroKeys: () => ['zotero-key-1'],
      state: {
        obsidian: {
          [dummyObsidianPath]: 12345
        }
      }
    };
    index._testInjectSyncTracker(mockSyncTracker);

    // Run re-embedding
    const result = await runReembedding();
    assert.strictEqual(result.success, true);
    assert.strictEqual(reembedStatus.succeededCount, 2);
    assert.strictEqual(reembedStatus.failedCount, 0);
    assert.strictEqual(reembedStatus.totalCount, 2);

    // Verify database contains the re-embedded chunks under active-model-gamma
    const dbModel = await vectorStore.getDatabaseModel();
    assert.strictEqual(dbModel, 'active-model-gamma');
  });
});
