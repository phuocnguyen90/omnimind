import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EmbeddingPipeline } from '../src/ingestion/embedder';

test('Embedding Model Resolution & Verification', async (t) => {
  // Create a clean temporary directory for this test run
  const testWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnimind-test-'));

  const cleanUp = () => {
    try {
      fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
    } catch (e) {}
  };

  t.after(cleanUp);

  await t.test('loads model from search_config.json if database is new', async () => {
    // 1. Create a search_config.json in the test workspace
    const searchConfigPath = path.join(testWorkspaceDir, 'search_config.json');
    fs.writeFileSync(
      searchConfigPath,
      JSON.stringify({ embeddingModel: 'my-custom-ui-embedding-model' }, null, 2)
    );

    const loadedModels: string[] = [];

    const mockClient = {
      embedding: {
        model: async (id?: string) => {
          loadedModels.push(id || 'default-active-model');
          return {
            identifier: id || 'my-custom-ui-embedding-model',
            path: `/path/to/${id || 'my-custom-ui-embedding-model'}`,
            embed: async () => ({ embedding: [0.1, 0.2, 0.3] })
          };
        }
      }
    };

    const pipeline = new EmbeddingPipeline(mockClient, undefined, testWorkspaceDir);
    const result = await pipeline.generateEmbedding('test query');

    assert.deepStrictEqual(result, [0.1, 0.2, 0.3]);
    assert.strictEqual(loadedModels.includes('my-custom-ui-embedding-model'), true, 'Should try to load the model from search_config.json');

    // Verify metadata was written
    const metadataPath = path.join(testWorkspaceDir, 'embedding_model.json');
    assert.strictEqual(fs.existsSync(metadataPath), true, 'Metadata file should be created');
    const savedMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    assert.strictEqual(savedMetadata.identifier, 'my-custom-ui-embedding-model');
  });

  await t.test('throws mismatch error if active model differs from saved metadata on existing database', async () => {
    // Write database metadata representing an existing database
    const metadataPath = path.join(testWorkspaceDir, 'embedding_model.json');
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({ identifier: 'original-embedding-model', path: '/original' }, null, 2)
    );

    // Mock existing database folder so it is not treated as a new database
    const lancedbDir = path.join(testWorkspaceDir, '.lancedb');
    fs.mkdirSync(lancedbDir, { recursive: true });
    fs.writeFileSync(path.join(lancedbDir, 'knowledge_graph.lance'), 'fake lancedb data');

    const mockClient = {
      embedding: {
        model: async (id?: string) => {
          // Say it returned another model because original is inactive
          return {
            identifier: 'different-model-active',
            path: '/path/different',
            embed: async () => ({ embedding: [0.9, 0.9, 0.9] })
          };
        }
      }
    };

    const pipeline = new EmbeddingPipeline(mockClient, undefined, testWorkspaceDir);
    
    // Attempting to embed should throw mismatch error
    await assert.rejects(
      async () => {
        await pipeline.generateEmbedding('test query');
      },
      /Embedding model mismatch!/
    );
  });

  await t.test('overwrites metadata and succeeds if database is new/deleted', async () => {
    // Write metadata file
    const metadataPath = path.join(testWorkspaceDir, 'embedding_model.json');
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({ identifier: 'original-embedding-model', path: '/original' }, null, 2)
    );

    // Ensure database folder does NOT exist (new or deleted database)
    const lancedbDir = path.join(testWorkspaceDir, '.lancedb');
    try {
      fs.rmSync(lancedbDir, { recursive: true, force: true });
    } catch (e) {}

    const mockClient = {
      embedding: {
        model: async (id?: string) => {
          return {
            identifier: 'new-model-loaded',
            path: '/path/new',
            embed: async () => ({ embedding: [0.5, 0.5, 0.5] })
          };
        }
      }
    };

    const pipeline = new EmbeddingPipeline(mockClient, undefined, testWorkspaceDir);
    const result = await pipeline.generateEmbedding('test query');

    assert.deepStrictEqual(result, [0.5, 0.5, 0.5]);

    // Metadata file should be updated with new model info
    const savedMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    assert.strictEqual(savedMetadata.identifier, 'new-model-loaded');
  });
});
