import { SyncTracker } from './src/ingestion/tracker';
import * as path from 'path';
import * as os from 'os';

const workspaceDir = path.join(os.homedir(), ".omnimind");
const tracker = new SyncTracker(workspaceDir);
tracker.markZoteroComplete("TEST_KEY");
console.log("hasZotero:", tracker.hasZotero("TEST_KEY"));
