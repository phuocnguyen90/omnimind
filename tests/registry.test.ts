import test from 'node:test';
import assert from 'node:assert';
import { toolsProvider } from '../src/tools/registry';

test('Tools Registry', async (t) => {
  await t.test('exports toolsProvider array', () => {
    assert.strictEqual(Array.isArray(toolsProvider.tools), true);
  });

  await t.test('contains required tools', () => {
    const toolNames = toolsProvider.tools.map(t => (t as any).name);
    
    assert.strictEqual(toolNames.includes("search_knowledge_graph"), true);
    assert.strictEqual(toolNames.includes("get_paper_info"), true);
    assert.strictEqual(toolNames.includes("search_academic_references"), true);
    assert.strictEqual(toolNames.includes("search_personal_notes"), true);
    assert.strictEqual(toolNames.includes("cluster_papers"), true);
    assert.strictEqual(toolNames.includes("write_obsidian_note"), true);
    assert.strictEqual(toolNames.includes("read_obsidian_note"), true);
    assert.strictEqual(toolNames.includes("edit_obsidian_note"), true);
  });
});
