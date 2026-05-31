import { tool } from "@lmstudio/sdk";
import { z } from "zod";
import { omniMindGraph } from "./orchestrator/graph";
import { HumanMessage } from "@langchain/core/messages";

const searchGraphTool = tool({
  name: "search_knowledge_graph",
  description: "Search the local Obsidian and Zotero knowledge graph for relevant context. Use this whenever the user asks about their notes or papers.",
  parameters: z.object({
    query: z.string().describe("The search query to retrieve relevant notes and papers."),
  }),
  handler: async (params) => {
    console.log("Triggering LangGraph workflow for query:", params.query);
    
    // Invoke the compiled LangGraph state machine
    const finalState = await omniMindGraph.invoke({
      messages: [new HumanMessage(params.query)]
    });

    // In a real implementation with streamEvents, we would stream status back to LM Studio here.
    // For now, we return the final synthesized response or documents.
    return JSON.stringify(finalState.documents);
  },
});

export const toolsProvider = {
  tools: [searchGraphTool],
};

// LM Studio extension entry point
export function activate(context: any) {
  console.log("OmniMind extension activated with LangGraph orchestration!");
  // context.withToolsProvider(toolsProvider);
}
