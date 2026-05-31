import { tool } from "@lmstudio/sdk";
import { z } from "zod";
import { omniMindGraph } from "./orchestrator/graph";
import { HumanMessage } from "@langchain/core/messages";
import { VectorStore } from "./vectorstore/db";
import { EmbeddingPipeline } from "./ingestion/embedder";
import path from "path";
import os from "os";
import { ObsidianVaultWatcher } from "./ingestion/obsidian";
import { ZoteroExtractor } from "./ingestion/zotero";

// Global instances for the plugin
export let vectorStore: VectorStore;
export let embedder: EmbeddingPipeline;
export let obsidianWatcher: ObsidianVaultWatcher;
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
  
  // The embedder will be initialized when the tools provider factory is called by LM Studio.
  
  // 2. Initialize LanceDB inside the user's home directory (cross-OS safe)
  const dbPath = path.join(os.homedir(), ".omnimind");
  vectorStore = new VectorStore(dbPath);
  await vectorStore.initialize();
  console.log("Vector Store initialized successfully!");

  // 3. Start Obsidian Ingestion (Replace this path with your actual vault path!)
  const mockVaultPath = "C:\\Users\\PC\\AppData\\Local\\SynologyDrive\\SystemFolders\\4\\Obsidian\\research";
  obsidianWatcher = new ObsidianVaultWatcher(mockVaultPath);
  
  // Register the tool provider so it shows up in LM Studio's chat UI
  if (context && context.withToolsProvider) {
    context.withToolsProvider(async (controller: any) => {
      console.log("Successfully grabbed LMStudioClient from withToolsProvider!");
      lmClient = controller.client; // Save globally for LangGraph to use!
      
      // Initialize embedder with the injected client from the controller
      embedder = new EmbeddingPipeline(lmClient);
      
      // Add a simple async queue to prevent Out-Of-Memory errors when Chokidar floods us with files on initial scan
      const processingQueue: (() => Promise<void>)[] = [];
      let isProcessing = false;

      async function processQueue() {
        if (isProcessing) return;
        isProcessing = true;
        while (processingQueue.length > 0) {
          const task = processingQueue.shift();
          if (task) {
            try { await task(); } 
            catch (e) { console.error(e); }
          }
        }
        isProcessing = false;
      }

      // Now start the watcher since we have the client to do embeddings
      obsidianWatcher.watch(async (filePath: string) => {
        processingQueue.push(async () => {
          const note = obsidianWatcher.parseNote(filePath);
          if (!note) return;
          
          console.log(`Embedding updated note: ${note.title}`);
          const totalChunks = await embedder.processDocument(
            "obsidian", 
            note.filePath, 
            note.content, 
            note.links,
            async (batch) => {
              await vectorStore.upsertChunks(batch);
            }
          );
          console.log(`Saved ${totalChunks} chunks to LanceDB for ${note.title}`);
        });
        processQueue();
      }, async (filePath) => {
        console.log(`Note removed (deletion from vector store not yet implemented): ${filePath}`);
      });
      
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
