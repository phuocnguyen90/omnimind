import { tool } from "@lmstudio/sdk";
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
import { omniMindGraph } from "../orchestrator/graph";
import { getPaperInfoTool, searchAcademicReferencesTool, clusterPapersTool } from "./zoteroTools";
import { writeObsidianNoteTool, readObsidianNoteTool, editObsidianNoteTool, searchPersonalNotesTool } from "./obsidianTools";

export const searchGraphTool = tool({
  name: "search_knowledge_graph",
  description: "Perform a semantic LangGraph search across both Obsidian and Zotero simultaneously to answer complex, multi-hop questions. Do NOT use this if you need to read, write, edit, or fetch specific paper metadata; use the dedicated specialized tools instead.",
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
