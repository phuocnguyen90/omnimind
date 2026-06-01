import { tool } from "@lmstudio/sdk";
import { z } from "zod";
import { getPaperInfoTool, searchAcademicReferencesTool, clusterPapersTool } from "./zoteroTools";
import { writeObsidianNoteTool, readObsidianNoteTool, editObsidianNoteTool, searchPersonalNotesTool } from "./obsidianTools";
import { vectorStore, embedder } from "../index";

export const searchVectorDatabaseTool = tool({
  name: "search_vector_database",
  description: "Perform a semantic search across both Obsidian and Zotero simultaneously to answer complex questions. Returns the raw vector chunks for synthesis.",
  parameters: {
    query: z.string().describe("The search query to retrieve relevant notes and papers."),
    limit: z.number().optional().describe("Number of results to return (default 5, max 10).")
  },
  implementation: async (params: any) => {
    console.log("[Tool] search_vector_database invoked with query:", params.query);
    
    if (!vectorStore || !embedder) {
      return JSON.stringify({ error: "Vector database or embedder is not initialized." });
    }

    const limit = Math.min(params.limit || 5, 10);
    const queryVector = await embedder.generateEmbedding(params.query);
    const retrievedDocs = await vectorStore.search(queryVector, { limit });

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
    searchVectorDatabaseTool, 
    getPaperInfoTool, 
    searchAcademicReferencesTool, 
    searchPersonalNotesTool, 
    clusterPapersTool,
    writeObsidianNoteTool,
    readObsidianNoteTool,
    editObsidianNoteTool
  ],
};
