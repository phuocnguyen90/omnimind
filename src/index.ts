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
import { ZoteroExtractor } from "./ingestion/zotero/extractor";
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

    const contextDocs = (finalState.documents || []).map((doc: any) => ({
      path: doc.path,
      source: doc.source,
      text: doc.text,
      links_to: doc.links_to
    }));

    return JSON.stringify(contextDocs);
  },
});

const getPaperInfoTool = tool({
  name: "get_paper_info",
  description: "Fetch exact metadata (Title, Authors, Year, DOI, Abstract, PDF path) for a specific Zotero paper using a title fragment, author, or DOI.",
  parameters: {
    query: z.string().describe("Title fragment, author's last name, or DOI to search in Zotero.")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] get_paper_info called with query: ${params.query}`);
    if (!zoteroExtractor) return JSON.stringify({ error: "Zotero Extractor not initialized." });
    const info = await zoteroExtractor.getPaperInfo(params.query);
    return JSON.stringify(info);
  }
});

const searchAcademicReferencesTool = tool({
  name: "search_academic_references",
  description: "Semantic vector search specifically restricted to Zotero academic papers.",
  parameters: {
    query: z.string().describe("The search query."),
    limit: z.number().optional().describe("Number of results to return (default 5).")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] search_academic_references called with query: ${params.query}`);
    const limit = params.limit || 5;
    const queryVector = await embedder.generateEmbedding(params.query);
    const results = await vectorStore.search(queryVector, { sourceFilter: 'zotero', limit });
    return JSON.stringify(results.map(r => ({ path: r.path, text: r.text })));
  }
});

const searchPersonalNotesTool = tool({
  name: "search_personal_notes",
  description: "Semantic vector search specifically restricted to local Obsidian personal notes.",
  parameters: {
    query: z.string().describe("The search query."),
    limit: z.number().optional().describe("Number of results to return (default 5).")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] search_personal_notes called with query: ${params.query}`);
    const limit = params.limit || 5;
    const queryVector = await embedder.generateEmbedding(params.query);
    const results = await vectorStore.search(queryVector, { sourceFilter: 'obsidian', limit });
    return JSON.stringify(results.map(r => ({ path: r.path, text: r.text, links_to: r.links_to })));
  }
});

const clusterPapersTool = tool({
  name: "cluster_papers",
  description: "Semantically cluster papers based on a broad topic or query to find common themes.",
  parameters: {
    query: z.string().describe("The broad topic to fetch papers for clustering."),
    k: z.number().optional().describe("Number of clusters to generate (default 3).")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] cluster_papers called with query: ${params.query}, k: ${params.k}`);
    const k = params.k || 3;
    const queryVector = await embedder.generateEmbedding(params.query);
    // Fetch top 50 results to cluster
    const results = await vectorStore.search(queryVector, { sourceFilter: 'zotero', limit: 50 });
    
    if (results.length < k) {
      return JSON.stringify({ error: `Not enough papers found (${results.length}) to form ${k} clusters.` });
    }

    // Dynamic import to avoid loading unless called
    const { kmeans } = await import("./vectorstore/cluster");
    
    const vectors = results.map(r => r.vector);
    const assignments = kmeans(vectors, k);
    
    const clusters: Record<number, any[]> = {};
    for (let i = 0; i < k; i++) clusters[i] = [];
    
    for (let i = 0; i < results.length; i++) {
      const clusterId = assignments[i];
      clusters[clusterId].push({
        path: results[i].path,
        text: results[i].text.substring(0, 200) + "..." // Truncate text to avoid massive JSON
      });
    }

    return JSON.stringify(clusters);
  }
});

export const toolsProvider = {
  tools: [searchGraphTool, getPaperInfoTool, searchAcademicReferencesTool, searchPersonalNotesTool, clusterPapersTool],
};

// LM Studio plugin entry point
export async function main(context: any) {
  console.log("OmniMind plugin activated with LangGraph orchestration!");
  
  const workspaceDir = path.join(os.homedir(), ".omnimind");
  vectorStore = new VectorStore(workspaceDir);
  await vectorStore.initialize();
  console.log("Vector Store initialized successfully!");
  
  syncTracker = new SyncTracker(workspaceDir);
  
  // Initialize the proper JobQueue
  const maxConcurrentWorkers = parseInt(process.env.MAX_CONCURRENT_WORKERS || "4", 10);
  const jobQueue = new JobQueue(maxConcurrentWorkers);

  // 5. Start HTTP Control Server
  if ((global as any).controlServer) {
    try { (global as any).controlServer.close(); } catch (e) {}
  }
  
  const server = http.createServer(async (req, res) => {
    try {
      // Handle API routes
      if (req.url?.startsWith('/api/')) {
        if (req.method === 'POST' && req.url === '/api/pause') {
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
        } else if (req.method === 'GET' && req.url === '/api/knowledge/stats') {
          const stats = await vectorStore.getStats();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(stats));
        } else if (req.method === 'GET' && req.url === '/api/knowledge/sources') {
          const sources = await vectorStore.getSources();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sources));
        } else if (req.method === 'GET' && req.url.startsWith('/api/knowledge/chunks?path=')) {
          const urlPath = new URL(req.url, 'http://localhost');
          const targetPath = urlPath.searchParams.get('path');
          if (!targetPath) {
            res.writeHead(400); res.end('Missing path param');
            return;
          }
          const chunks = await vectorStore.getChunksByPath(targetPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(chunks));
        } else {
          res.writeHead(404); res.end();
        }
        return;
      }

      // Handle static files
      let filePath = req.url === '/' ? '/index.html' : req.url;
      filePath = (filePath || '').split('?')[0];
      const absPath = path.join(process.cwd(), 'ui', 'dist', filePath);
      
      const ext = String(path.extname(absPath)).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.svg': 'image/svg+xml'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      fs.readFile(absPath, (error, content) => {
        if (error) {
          if (error.code === 'ENOENT') {
            fs.readFile(path.join(process.cwd(), 'ui', 'dist', 'index.html'), (err, content) => {
              if (err) {
                res.writeHead(500); res.end('UI not built. Run npm run build in ui/ folder.');
              } else {
                res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(content, 'utf-8');
              }
            });
          } else {
            res.writeHead(500); res.end('Server error: ' + error.code);
          }
        } else {
          res.writeHead(200, { 'Content-Type': contentType }); res.end(content, 'utf-8');
        }
      });
    } catch (err: any) {
      console.error("[Control Server] Unhandled error:", err);
      if (!res.headersSent) {
        res.writeHead(500); res.end('Internal Server Error');
      }
    }
  });

  server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.warn("[Control Server] Port 4733 is in use, assuming server is already running.");
    } else {
      console.error("[Control Server] Server error:", e);
    }
  });

  server.listen(4733, () => {
    console.log("OmniMind Control Panel running at http://localhost:4733");
  });
  (global as any).controlServer = server;

  // Register the tool provider so it shows up in LM Studio's chat UI
  if (context && context.withToolsProvider) {
    context.withToolsProvider(async (controller: any) => {
      console.log("Successfully grabbed LMStudioClient from withToolsProvider!");
      lmClient = controller.client; // Save globally for LangGraph to use!
      
      // Initialize embedder with the injected client from the controller
      embedder = new EmbeddingPipeline(lmClient);


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
