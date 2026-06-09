import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import dotenv from "dotenv";

import { VectorStore } from "./vectorstore/db";
import { EmbeddingPipeline } from "./ingestion/embedder";
import { ObsidianVaultWatcher } from "./ingestion/obsidian/watcher";
import { ZoteroExtractor } from "./ingestion/zotero/extractor";
import { SyncTracker } from "./ingestion/tracker";
import { JobQueue, Job } from "./ingestion/queue";
import { startControlServer } from "./server/api";
import { toolsProvider } from "./tools/registry";
import { globalConfigSchematics } from "./config";
export let ingestionState: 'RUNNING' | 'PAUSED' = 'RUNNING';

dotenv.config();

// Global instances for the plugin
export let vectorStore: VectorStore;
export let embedder: EmbeddingPipeline;
export let obsidianWatcher: ObsidianVaultWatcher;
export let zoteroExtractor: ZoteroExtractor;
export let syncTracker: SyncTracker;
export let lmClient: any;
export let activeObsidianVaultPath = "";

// Test injection helpers
export function _testInjectObsidianVaultPath(p: string) { activeObsidianVaultPath = p; }
export function _testInjectEmbedder(e: any) { embedder = e; }
export function _testInjectVectorStore(v: any) { vectorStore = v; }
export function _testInjectZoteroExtractor(z: any) { zoteroExtractor = z; }
export function _testInjectSyncTracker(s: any) { syncTracker = s; }
export function _testInjectObsidianWatcher(o: any) { obsidianWatcher = o; }

// LM Studio plugin entry point
export async function main(context: any) {
  console.log("OmniMind plugin activated with native LM Studio orchestration!");
  
  const workspaceDir = path.join(os.homedir(), ".omnimind");
  vectorStore = new VectorStore(workspaceDir);
  await vectorStore.initialize();
  console.log("Vector Store initialized successfully!");
  
  console.log("[Startup] Loading SyncTracker...");
  syncTracker = new SyncTracker(workspaceDir);
  console.log("[Startup] SyncTracker loaded successfully.");

  // Register the configuration schematics with LM Studio
  if (context && context.withGlobalConfigSchematics) {
    console.log("[Startup] Registering configuration schematics...");
    context.withGlobalConfigSchematics(globalConfigSchematics);
    console.log("[Startup] Configuration schematics registered successfully.");
  }

  let isInitialized = false;

  // Register the tool provider so it shows up in LM Studio's chat UI
  if (context && context.withToolsProvider) {
    console.log("[Startup] Registering tools provider with LM Studio...");
    context.withToolsProvider(async (controller: any) => {
      console.log("[Startup] withToolsProvider callback triggered! LM Studio client has connected to the plugin.");
      lmClient = controller.client; // Save globally for LangGraph to use!
      
      // Initialize embedder with the injected client from the controller
      embedder = new EmbeddingPipeline(lmClient);

      // Guard against multiple invocations
      if (!isInitialized) {
        isInitialized = true;
        
        const globalConfig = controller.getGlobalPluginConfig(globalConfigSchematics);
        
        const maxConcurrentWorkers = globalConfig.get("maxConcurrentWorkers") || 4;
        const jobQueue = new JobQueue(maxConcurrentWorkers);
        
        // Start in paused state so the UI is ready before processing starts
        jobQueue.pause();

        // Handle the Execution Phase dynamically as jobs are popped from the queue
        jobQueue.on('process_job', async (job: Job, done: (err?: Error) => void) => {
          try {
            if (job.type === 'zotero') {
              console.log(`[JobQueue] Executing Zotero Job: ${job.title}`);
              const item = await zoteroExtractor.executeJob(job.payload);
              
              if (item.textContent) {
                await vectorStore.deleteByPath(item.key); // deduplicate
                await embedder.processDocument("zotero", item.key, item.title, item.textContent, [], async (batch: any[]) => {
                  await vectorStore.upsertChunks(batch);
                });
                syncTracker.markZoteroComplete(item.key);
                console.log(`[Success] Saved vectors to LanceDB and marked ${item.title} as complete!`);
              }
            } else if (job.type === 'obsidian') {
              console.log(`[JobQueue] Executing Obsidian Job: ${job.title}`);
              const note = obsidianWatcher.parseNote(job.id);
              if (note) {
                await vectorStore.deleteByPath(note.filePath);
                await embedder.processDocument("obsidian", note.filePath, note.title, note.content, note.links, async (batch: any[]) => {
                  await vectorStore.upsertChunks(batch);
                });
                syncTracker.markObsidianComplete(job.id, job.payload.mtimeMs);
              }
            }
            done();
          } catch (err: any) {
            done(err);
          }
        });

        // Initialize Obsidian Ingestion
        const vaultPath = globalConfig.get("obsidianVaultPath") || "C:\\Users\\PC\\AppData\\Local\\SynologyDrive\\SystemFolders\\4\\Obsidian\\research";
        activeObsidianVaultPath = vaultPath;
        obsidianWatcher = new ObsidianVaultWatcher(vaultPath);

        // Initialize Zotero Ingestion
        const zoteroDbPath = globalConfig.get("zoteroDbPath") || "E:\\Zotero\\zotero.sqlite";
        const zoteroStoragePath = globalConfig.get("zoteroStoragePath") || "E:\\Zotero\\storage";
        zoteroExtractor = new ZoteroExtractor(zoteroDbPath, zoteroStoragePath, lmClient, syncTracker);

        // Launch the control server and then begin execution
        console.log("[Startup] Launching Control Panel server, watchers, and queue processing...");
        startControlServer(jobQueue, vectorStore).then(() => {
          console.log("[Startup] Control Panel running at http://localhost:4733");
          console.log("[Startup] Watching Obsidian vault:", vaultPath);
          console.log("[Startup] Reading Zotero database:", zoteroDbPath);

          // Instantly populate the Queue with Pending Jobs
          console.log("[Startup] Discovering Zotero ingestion jobs...");
          zoteroExtractor.discoverJobs(jobQueue).then(async (validKeys: string[]) => {
            console.log(`[Startup] Discovered ${validKeys.length} items in Zotero DB.`);
            const validKeySet = new Set(validKeys);
            const trackedKeys = syncTracker.getAllZoteroKeys();
            
            let orphanCount = 0;
            for (const key of trackedKeys) {
              if (!validKeySet.has(key)) {
                console.log(`[Zotero Cleanup] Deleting stale vectors for orphaned item: ${key}`);
                await vectorStore.deleteByPath(key);
                syncTracker.removeZoteroKey(key);
                orphanCount++;
              }
            }
            if (orphanCount > 0) {
              console.log(`[Zotero Cleanup] Cleaned up ${orphanCount} orphaned papers from LanceDB.`);
            }
          }).catch(err => console.error("Zotero Discovery Failed:", err));

          // Watch Obsidian Vault
          obsidianWatcher.watch(
            async (filePath: string) => {
              let mtimeMs = 0;
              try {
                mtimeMs = fs.statSync(filePath).mtimeMs;
              } catch (e) {
                return; // File deleted before stat
              }

              if (syncTracker.getObsidianMtime(filePath) === mtimeMs) {
                return; // Already processed!
              }

              jobQueue.addJob({
                id: filePath,
                type: 'obsidian',
                title: path.basename(filePath),
                payload: { mtimeMs }
              });
            },
            async (filePath: string) => {
              // File was deleted
              console.log(`[Obsidian Watcher] Deleting stale vectors for ${filePath}`);
              await vectorStore.deleteByPath(filePath);
              syncTracker.markObsidianDeleted(filePath);
            }
          );

          // Resume the queue to start processing discovered jobs
          jobQueue.resume();
        });
      }


      
      // LM Studio expects an array of tools to map over
      console.log("[Startup] Tool definitions mapping complete.");
      return toolsProvider.tools;
    });
    console.log("Registered knowledge graph search tool!");
    console.log("[Startup] Tools registered with LM Studio. Awaiting chat session connection to activate control server and watch handlers...");
    
    // Automated test is available via export, but we disable the auto-run 
    // so it doesn't fire before LM Studio connects to the plugin!
  } else {
    console.warn("Could not find withToolsProvider on context object.");
  }
}

export { runAutomatedTest } from './diagnostics/runAutomatedTest';
