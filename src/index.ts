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
      
      const processingQueue: (() => Promise<void>)[] = [];
      let isProcessing = false;

      async function processQueue() {
        if (isProcessing) return;
        isProcessing = true;
        while (processingQueue.length > 0) {
          if (ingestionState === 'PAUSED') {
            break;
          }
          const task = processingQueue.shift();
          if (task) {
            try { await task(); } 
            catch (e) { console.error(e); }
          }
        }
        isProcessing = false;
      }

      // 3. Start Obsidian Ingestion
      const vaultPath = process.env.OBSIDIAN_VAULT_PATH || "C:\\Users\\PC\\AppData\\Local\\SynologyDrive\\SystemFolders\\4\\Obsidian\\research";
      obsidianWatcher = new ObsidianVaultWatcher(vaultPath);

      // 4. Start Zotero Ingestion
      const zoteroDbPath = process.env.ZOTERO_DB_PATH || "E:\\Zotero\\zotero.sqlite";
      const zoteroStoragePath = process.env.ZOTERO_STORAGE_PATH || "E:\\Zotero\\storage";
      
      zoteroExtractor = new ZoteroExtractor(
        zoteroDbPath, 
        zoteroStoragePath, 
        lmClient, 
        syncTracker,
        () => ingestionState
      );

      console.log("Started watching Obsidian vault:", vaultPath);
      console.log("Starting Zotero database extraction:", zoteroDbPath);

      // Kick off Zotero Extraction asynchronously
      zoteroExtractor.extractLibrary(async (item) => {
        // Enqueue the Zotero PDF for processing
        processingQueue.push(async () => {
          if (!item.textContent) return;
          console.log(`Processing Zotero PDF: ${item.title}`);
          
          await vectorStore.deleteByPath(item.key); // delete any existing vectors for this cite key

          await embedder.processDocument(
            "zotero",
            item.key, // We use citation key as path/reference
            item.textContent, 
            [],
            async (batch) => {
              await vectorStore.upsertChunks(batch);
            }
          );

          syncTracker.markZoteroComplete(item.key);
        });
      }).then(() => { processQueue(); }).catch(err => console.error("Zotero extraction failed:", err));

      // 5. Start HTTP Control Server
      const server = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/') {
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
                .status { font-size: 24px; margin-top: 30px; font-weight: bold; }
                .paused-text { color: #e74c3c; }
                .running-text { color: #2ecc71; }
              </style>
            </head>
            <body>
              <h1>OmniMind Ingestion Control</h1>
              <p>Current Queue Length: <span id="queueLen">${processingQueue.length}</span></p>
              <div class="status">Status: <span id="stateText" class="${ingestionState === 'PAUSED' ? 'paused-text' : 'running-text'}">${ingestionState}</span></div>
              <br/>
              <button class="pause" onclick="fetch('/api/pause', {method:'POST'}).then(() => location.reload())">⏸️ Pause Extraction</button>
              <button class="resume" onclick="fetch('/api/resume', {method:'POST'}).then(() => location.reload())">▶️ Resume Extraction</button>
              <script>
                setInterval(() => {
                  fetch('/api/status').then(r => r.json()).then(data => {
                    document.getElementById('queueLen').innerText = data.queueLength;
                    const st = document.getElementById('stateText');
                    st.innerText = data.state;
                    st.className = data.state === 'PAUSED' ? 'paused-text' : 'running-text';
                  });
                }, 2000);
              </script>
            </body>
            </html>
          `);
        } else if (req.method === 'POST' && req.url === '/api/pause') {
          ingestionState = 'PAUSED';
          res.writeHead(200); res.end('PAUSED');
          console.log("[Control Server] Ingestion PAUSED by user.");
        } else if (req.method === 'POST' && req.url === '/api/resume') {
          ingestionState = 'RUNNING';
          processQueue(); // Kick off the queue again!
          res.writeHead(200); res.end('RUNNING');
          console.log("[Control Server] Ingestion RESUMED by user.");
        } else if (req.method === 'GET' && req.url === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ state: ingestionState, queueLength: processingQueue.length }));
        } else {
          res.writeHead(404); res.end();
        }
      });
      server.listen(4733, () => {
        console.log("OmniMind Control Panel running at http://localhost:4733");
      });

      // 5. Watch Obsidian Vault
      obsidianWatcher.watch(
        async (filePath: string) => {
          processingQueue.push(async () => {
            let mtimeMs = 0;
            try {
              mtimeMs = fs.statSync(filePath).mtimeMs;
            } catch (e) {
              return; // File deleted before stat
            }

            if (syncTracker.getObsidianMtime(filePath) === mtimeMs) {
              return; // Already processed!
            }

            const note = obsidianWatcher.parseNote(filePath);
            if (!note) return;

            console.log(`Processing Obsidian note: ${note.title}`);
            
            // Delete old vectors before upserting the new edited note
            await vectorStore.deleteByPath(note.filePath);

            await embedder.processDocument(
              "obsidian",
              note.filePath,
              note.content,
              note.links,
              async (batch) => {
                await vectorStore.upsertChunks(batch);
              }
            );

            syncTracker.markObsidianComplete(filePath, mtimeMs);
          });
          processQueue();
        },
        async (filePath: string) => {
          // File was deleted
          processingQueue.push(async () => {
            console.log(`Removing deleted Obsidian note: ${filePath}`);
            await vectorStore.deleteByPath(filePath);
            syncTracker.markObsidianDeleted(filePath);
          });
          processQueue();
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
