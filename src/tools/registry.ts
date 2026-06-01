import { tool } from "@lmstudio/sdk";
import { z } from "zod";
import { getPaperInfoTool, clusterPapersTool } from "./zoteroTools";
import { writeObsidianNoteTool, readObsidianNoteTool, editObsidianNoteTool, appendObsidianNoteTool } from "./obsidianTools";
import { vectorStore, embedder } from "../index";

export const searchKnowledgeGraphTool = tool({
  name: "search_knowledge_graph",
  description: "Perform a semantic search across both Obsidian and Zotero to answer complex questions. Returns the raw vector chunks for synthesis.",
  parameters: {
    query: z.string().describe("The search query to retrieve relevant notes and papers."),
    limit: z.number().optional().describe("Number of results to return (default 5, max 10)."),
    source: z.enum(['all', 'obsidian', 'zotero']).optional().describe("Restrict search to a specific source. Defaults to 'all'."),
    algorithm: z.enum(['vector', 'bm25', 'hybrid', 'mmr']).optional().describe("Search algorithm. Use 'hybrid' or 'bm25' for exact names/keywords (e.g. authors, acronyms). Defaults to UI settings.")
  },
  implementation: async (params: any) => {
    console.log("[Tool] search_knowledge_graph invoked with query:", params.query);
    
    if (!vectorStore || !embedder) {
      return JSON.stringify({ error: "Vector database or embedder is not initialized." });
    }

    const limit = Math.min(params.limit || 5, 10);
    const queryVector = await embedder.generateEmbedding(params.query);
    
    const searchOptions: any = { limit };
    if (params.source === 'obsidian' || params.source === 'zotero') {
      searchOptions.sourceFilter = params.source;
    }
    if (params.algorithm) {
      searchOptions.algorithm = params.algorithm;
    }
    
    const retrievedDocs = await vectorStore.search(params.query, queryVector, searchOptions);

    if (!retrievedDocs || retrievedDocs.length === 0) {
      return JSON.stringify({ message: "No relevant documents found." });
    }

    const contextDocs = retrievedDocs.map((doc: any) => ({
      path: doc.path,
      source: doc.source,
      text: doc.text,
    }));

    return JSON.stringify(contextDocs);
  },
});

export const toolsProvider = {
  tools: [
    searchKnowledgeGraphTool, 
    getPaperInfoTool, 
    clusterPapersTool,
    writeObsidianNoteTool,
    readObsidianNoteTool,
    editObsidianNoteTool,
    appendObsidianNoteTool
  ],
};
