import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { DocumentChunk } from "../vectorstore/db";

// Define the Graph State
export const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
  query: Annotation<string>(),
  documents: Annotation<DocumentChunk[]>({
    reducer: (x, y) => y, // Overwrite documents on new retrieval
  }),
  isRelevant: Annotation<boolean>(),
});

// Define Nodes
async function queryRewriterNode(state: typeof GraphState.State) {
  console.log("--- REWRITING QUERY ---");
  // In a real implementation, call the LLM here to rewrite state.messages into a single search query
  const latestMessage = state.messages[state.messages.length - 1];
  return { query: latestMessage.content.toString() };
}

async function retrieverNode(state: typeof GraphState.State) {
  console.log(`--- RETRIEVING DOCUMENTS FOR: ${state.query} ---`);
  // Here we will call VectorStore.search() using an embedding of state.query
  const mockDocs: DocumentChunk[] = []; 
  return { documents: mockDocs };
}

async function graderNode(state: typeof GraphState.State) {
  console.log("--- GRADING DOCUMENTS ---");
  // Call the LLM to grade relevance of state.documents against state.query
  // For now, assume relevant
  return { isRelevant: true };
}

async function synthesizerNode(state: typeof GraphState.State) {
  console.log("--- SYNTHESIZING RESPONSE ---");
  // Call LLM to generate the final Markdown response or Obsidian note
  // using state.documents and state.query
  return { 
    messages: [/* new AIMessage("Final response") */] 
  };
}

// Edge logic
function decideToGenerate(state: typeof GraphState.State) {
  if (state.isRelevant) {
    return "synthesizer";
  }
  // If not relevant, loop back to rewrite query or fall back
  return "queryRewriter"; 
}

// Build the Graph
const builder = new StateGraph(GraphState)
  .addNode("queryRewriter", queryRewriterNode)
  .addNode("retriever", retrieverNode)
  .addNode("grader", graderNode)
  .addNode("synthesizer", synthesizerNode)

  .addEdge(START, "queryRewriter")
  .addEdge("queryRewriter", "retriever")
  .addEdge("retriever", "grader")
  .addConditionalEdges("grader", decideToGenerate)
  .addEdge("synthesizer", END);

export const omniMindGraph = builder.compile();
