import { tool } from "@lmstudio/sdk";
import { z } from "zod";
import * as path from "path";
import * as os from "os";
import dotenv from "dotenv";
import { omniMindGraph } from "./orchestrator/graph";
import { HumanMessage } from "@langchain/core/messages";
import { VectorStore } from "./vectorstore/db";
import { EmbeddingPipeline } from "./ingestion/embedder";
import { ObsidianVaultWatcher } from "./ingestion/obsidian";
import { ZoteroExtractor } from "./ingestion/zotero";
import { SyncTracker } from "./ingestion/tracker";
import { JobQueue, Job } from "./ingestion/queue";
import * as http from "http";
import * as fs from "fs";

export let ingestionState: 'RUNNING' | 'PAUSED' = 'RUNNING';

dotenv.config();

// Global instances for the plugin
export let vectorStore: VectorStore;
export let embedder: EmbeddingPipeline;
export let obsidianWatcher: ObsidianVaultWatcher;
export let zoteroExtractor: ZoteroExtractor;
export let syncTracker: SyncTracker;
export let lmClient: any;

const searchGraphTool = tool({
  name: "search_knowledge_graph",
  description: "Search the local Obsidian and Zotero knowledge graph for relevant context. Use this whenever the user asks about their notes or papers.",
  parameters: {
    query: z.string().describe("The search query to retrieve relevant notes and papers.")
  },
  implementation: async (params: any) => {
    console.log("Triggering LangGraph workflow for query:", params.query);
    
    const finalState = await omniMindGraph.invoke({
      messages: [new HumanMessage(params.query)]
    });

    // Remove the massive vector arrays before returning to the Chat LLM to save tokens and prevent context overflow!
    const contextDocs = (finalState.documents || []).map((doc: any) => ({
      path: doc.path,
      source: doc.source,
      text: doc.text,
      links_to: doc.links_to
    }));

    return JSON.stringify(contextDocs);
  },
});

export const toolsProvider = {
  tools: [searchGraphTool],
};

// LM Studio plugin entry point
export async function main(context: any) {
  console.log("OmniMind plugin activated with LangGraph orchestration!");
  
  const workspaceDir = path.join(os.homedir(), ".omnimind");
  vectorStore = new VectorStore(workspaceDir);
  await vectorStore.initialize();
  console.log("Vector Store initialized successfully!");
  
  syncTracker = new SyncTracker(workspaceDir);
  
  // Register the tool provider so it shows up in LM Studio's chat UI
  if (context && context.withToolsProvider) {
    context.withToolsProvider(async (controller: any) => {
      console.log("Successfully grabbed LMStudioClient from withToolsProvider!");
      lmClient = controller.client; // Save globally for LangGraph to use!
      
      // Initialize embedder with the injected client from the controller
      embedder = new EmbeddingPipeline(lmClient);
      // Initialize the proper JobQueue
      const maxConcurrentWorkers = parseInt(process.env.MAX_CONCURRENT_WORKERS || "4", 10);
      const jobQueue = new JobQueue(maxConcurrentWorkers);

      // Handle the Execution Phase dynamically as jobs are popped from the queue
      jobQueue.on('process_job', async (job: Job, done: (err?: Error) => void) => {
        try {
          if (job.type === 'zotero') {
            console.log(`[JobQueue] Executing Zotero Job: ${job.title}`);
            const item = await zoteroExtractor.executeJob(job.payload);
            
            if (item.textContent) {
              await vectorStore.deleteByPath(item.key); // deduplicate
              await embedder.processDocument("zotero", item.key, item.textContent, [], async (batch) => {
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
              await embedder.processDocument("obsidian", note.filePath, note.content, note.links, async (batch) => {
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

      // 3. Start Obsidian Ingestion
      const vaultPath = process.env.OBSIDIAN_VAULT_PATH || "C:\\Users\\PC\\AppData\\Local\\SynologyDrive\\SystemFolders\\4\\Obsidian\\research";
      obsidianWatcher = new ObsidianVaultWatcher(vaultPath);

      // 4. Start Zotero Ingestion (Discovery Phase)
      const zoteroDbPath = process.env.ZOTERO_DB_PATH || "E:\\Zotero\\zotero.sqlite";
      const zoteroStoragePath = process.env.ZOTERO_STORAGE_PATH || "E:\\Zotero\\storage";
      
      zoteroExtractor = new ZoteroExtractor(zoteroDbPath, zoteroStoragePath, lmClient, syncTracker);

      console.log("Started watching Obsidian vault:", vaultPath);
      console.log("Starting Zotero database extraction:", zoteroDbPath);

      // Instantly populate the Queue with Pending Jobs
      zoteroExtractor.discoverJobs(jobQueue).catch(err => console.error("Zotero Discovery Failed:", err));

      // 5. Start HTTP Control Server
      const server = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/') {
          const stats = jobQueue.getStats();
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
            <head>
              <title>OmniMind Control Panel</title>
              <style>
                body { font-family: system-ui; background: #1e1e1e; color: #fff; text-align: center; padding: 50px; }
                button { padding: 15px 30px; margin: 10px; font-size: 18px; cursor: pointer; border: none; border-radius: 8px; font-weight: bold; }
                .pause { background: #e74c3c; color: white; }
                .resume { background: #2ecc71; color: white; }
                .retry { background: #f39c12; color: white; }
                .status { font-size: 24px; margin-top: 30px; font-weight: bold; }
                .paused-text { color: #e74c3c; }
                .running-text { color: #2ecc71; }
                .stats { display: flex; justify-content: center; gap: 20px; font-size: 20px; margin: 30px 0; }
                .stat-box { background: #2c3e50; padding: 20px; border-radius: 10px; width: 120px; }
              </style>
            </head>
            <body>
              <h1>OmniMind Job Queue</h1>
              <div class="stats">
                <div class="stat-box">Total<br><b id="st-total">${stats.total}</b></div>
                <div class="stat-box">Pending<br><b id="st-pending">${stats.pending}</b></div>
                <div class="stat-box">Processing<br><b id="st-processing">${stats.processing}</b></div>
                <div class="stat-box">Completed<br><b id="st-completed">${stats.completed}</b></div>
                <div class="stat-box" style="color:#e74c3c;">Failed<br><b id="st-failed">${stats.failed}</b></div>
              </div>
              
              <div class="status">Status: <span id="stateText" class="${jobQueue.getState() === 'PAUSED' ? 'paused-text' : 'running-text'}">${jobQueue.getState()}</span></div>
              <br/>
              <button class="pause" onclick="fetch('/api/pause', {method:'POST'})">⏸️ Pause Queue</button>
              <button class="resume" onclick="fetch('/api/resume', {method:'POST'})">▶️ Resume Queue</button>
              <button class="retry" onclick="fetch('/api/retry', {method:'POST'})">🔄 Retry Failed</button>
              <script>
                setInterval(() => {
                  fetch('/api/status').then(r => r.json()).then(data => {
                    document.getElementById('st-total').innerText = data.stats.total;
                    document.getElementById('st-pending').innerText = data.stats.pending;
                    document.getElementById('st-processing').innerText = data.stats.processing;
                    document.getElementById('st-completed').innerText = data.stats.completed;
                    document.getElementById('st-failed').innerText = data.stats.failed;
                    
                    const st = document.getElementById('stateText');
                    st.innerText = data.state;
                    st.className = data.state === 'PAUSED' ? 'paused-text' : 'running-text';
                  });
                }, 1000);
              </script>
            </body>
            </html>
          `);
        } else if (req.method === 'POST' && req.url === '/api/pause') {
          jobQueue.pause();
          res.writeHead(200); res.end('PAUSED');
        } else if (req.method === 'POST' && req.url === '/api/resume') {
          jobQueue.resume();
          res.writeHead(200); res.end('RUNNING');
        } else if (req.method === 'POST' && req.url === '/api/retry') {
          jobQueue.retryFailed();
          res.writeHead(200); res.end('RETRIED');
        } else if (req.method === 'GET' && req.url === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ state: jobQueue.getState(), stats: jobQueue.getStats() }));
        } else {
          res.writeHead(404); res.end();
        }
      });
      server.listen(4733, () => {
        console.log("OmniMind Control Panel running at http://localhost:4733");
      });

      // 6. Watch Obsidian Vault
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
      
      // LM Studio expects an array of tools to map over
      return toolsProvider.tools;
    });
    console.log("Registered knowledge graph search tool!");
    
    // Automated test is available via export, but we disable the auto-run 
    // so it doesn't fire before LM Studio connects to the plugin!
  } else {
    console.warn("Could not find withToolsProvider on context object.");
  }
}

/**
 * An automated test to verify LangGraph and LM Studio LLM inference without needing the Chat UI.
 */
export async function runAutomatedTest(query: string) {
  console.log(`\n==================================================`);
  console.log(`[AUTOMATED TEST] Starting query: "${query}"`);
  console.log(`==================================================\n`);
  
  if (!lmClient) {
    console.error("[AUTOMATED TEST] ERROR: lmClient is null! LM Studio did not inject the tools provider.");
    return;
  }

  try {
    const finalState = await omniMindGraph.invoke({
      messages: [new HumanMessage(query)]
    });
    
    console.log(`\n==================================================`);
    console.log(`[AUTOMATED TEST] Result successfully generated!`);
    console.log(`==================================================`);
    const finalMessage = finalState.messages[finalState.messages.length - 1];
    console.log(finalMessage?.content || "No response generated.");
    console.log(`\n==================================================\n`);
  } catch (err) {
    console.error("[AUTOMATED TEST] LangGraph Execution Failed:", err);
  }
}
