import test from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { SyncTracker } from '../src/ingestion/tracker';

test('SyncTracker', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnimind-tracker-test-'));

  await t.test('initializes and saves state', () => {
    const tracker = new SyncTracker(tmpDir);
    tracker.markZoteroComplete('TEST_KEY');
    assert.strictEqual(tracker.hasZotero('TEST_KEY'), true);
    assert.strictEqual(tracker.hasZotero('OTHER_KEY'), false);
  });

  await t.test('loads saved state correctly', () => {
    // Creating a new tracker instance for the same directory should load the saved state
    const tracker2 = new SyncTracker(tmpDir);
    assert.strictEqual(tracker2.hasZotero('TEST_KEY'), true);
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
