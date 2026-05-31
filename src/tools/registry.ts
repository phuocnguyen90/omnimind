import { tool } from "@lmstudio/sdk";
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
import { omniMindGraph } from "../orchestrator/graph";
import { getPaperInfoTool, searchAcademicReferencesTool, clusterPapersTool } from "./zoteroTools";
import { writeObsidianNoteTool, readObsidianNoteTool, editObsidianNoteTool, searchPersonalNotesTool } from "./obsidianTools";

export const searchGraphTool = tool({
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

export const toolsProvider = {
  tools: [
    searchGraphTool, 
    getPaperInfoTool, 
    searchAcademicReferencesTool, 
    searchPersonalNotesTool, 
    clusterPapersTool,
    writeObsidianNoteTool,
    readObsidianNoteTool,
    editObsidianNoteTool
  ],
};
