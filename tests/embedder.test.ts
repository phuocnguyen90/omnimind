import test from 'node:test';
import assert from 'node:assert';
import { EmbeddingPipeline } from '../src/ingestion/embedder';

test('EmbeddingPipeline', async (t) => {
  const mockClient = {
    embedding: {
      model: async () => ({
        embed: async (textOrArray: string | string[]) => {
          if (Array.isArray(textOrArray)) {
            return textOrArray.map(() => ({ embedding: [0.1, 0.2, 0.3] }));
          }
          return { embedding: [0.1, 0.2, 0.3] };
        }
      })
    }
  };

  await t.test('generateEmbedding returns vector array', async () => {
    const pipeline = new EmbeddingPipeline(mockClient);
    const result = await pipeline.generateEmbedding("Test string");
    assert.deepStrictEqual(result, [0.1, 0.2, 0.3]);
  });

  await t.test('processDocument chunks and batches correctly', async () => {
    const pipeline = new EmbeddingPipeline(mockClient);
    const batches: any[] = [];
    
    const longText = "word ".repeat(500); // 2500 chars

    const processedChunks = await pipeline.processDocument(
      'obsidian',
      'path/to/file.md',
      'Test Doc',
      longText,
      [],
      async (batch) => {
        batches.push(batch);
      }
    );

    // chunkText defaults to 1000 chars with 200 overlap. 
    // 2500 chars should result in around 3-4 chunks
    assert.strictEqual(processedChunks > 1, true, 'Should produce multiple chunks');
    assert.strictEqual(batches.length > 0, true, 'Should process at least one batch');
    
    // Check structure of a processed chunk
    const firstChunk = batches[0][0];
    assert.strictEqual(firstChunk.source, 'obsidian');
    assert.strictEqual(firstChunk.path, 'path/to/file.md');
    assert.deepStrictEqual(firstChunk.vector, [0.1, 0.2, 0.3]);
    assert.strictEqual(firstChunk.text.startsWith('Source: Test Doc\n\n'), true);
  });
});
