import test from 'node:test';
import assert from 'node:assert';
import * as index from '../src/index';

import { 
  getPaperInfoTool,
  clusterPapersTool
} from '../src/tools/zoteroTools';

// We mock the kmeans function dynamically imported in clusterPapersTool
// by overriding the node require/import mechanism or simply mocking the vector store.
// Since `kmeans` is a dynamic import `await import("../vectorstore/cluster")`, 
// we will let it load the real kmeans but give it mock vectors.

test('Zotero Tools', async (t) => {
  
  await t.test('get_paper_info uses zoteroExtractor', async () => {
    let requestedQuery = '';
    index._testInjectZoteroExtractor({
      getPaperInfo: async (query: string) => {
        requestedQuery = query;
        return { title: 'Mock Paper', key: 'XYZ123' };
      }
    });
    
    const res = await getPaperInfoTool.implementation({ query: 'Smith 2024' });
    const parsed = JSON.parse(res as string);
    
    assert.strictEqual(requestedQuery, 'Smith 2024');
    assert.strictEqual(parsed.title, 'Mock Paper');
  });

  await t.test('cluster_papers returns clusters', async () => {
    index._testInjectEmbedder({
      generateEmbedding: async () => [0.1, 0.2]
    });
    
    index._testInjectVectorStore({
      search: async () => {
        // Return mock results so k-means can run
        return [
          { path: 'A', text: 'Paper A', vector: [1.0, 0.0] },
          { path: 'B', text: 'Paper B', vector: [1.0, 0.0] },
          { path: 'C', text: 'Paper C', vector: [0.0, 1.0] },
          { path: 'D', text: 'Paper D', vector: [0.0, 1.0] }
        ];
      }
    });
    
    const res = await clusterPapersTool.implementation({
      query: 'AI',
      k: 2
    });
    
    const parsed = JSON.parse(res as string);
    
    // We should have 2 clusters
    assert.ok(parsed['0']);
    assert.ok(parsed['1']);
    
    // Total items across clusters should be 4
    const totalItems = parsed['0'].length + parsed['1'].length;
    assert.strictEqual(totalItems, 4);
  });
});
