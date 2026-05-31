import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { DocumentChunk } from "../vectorstore/db";
import { vectorStore, embedder, lmClient } from "../index";

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
  
  if (!vectorStore || !embedder) {
    console.error("VectorStore or Embedder not initialized!");
    return { documents: [] };
  }
  
  // Embed the query and search LanceDB
  const queryVector = await embedder.generateEmbedding(state.query);
  console.log(`Embedded query into vector of length: ${queryVector.length}`);
  const retrievedDocs = await vectorStore.search(queryVector, 5); // top 5
  console.log(`Raw LanceDB search results length: ${retrievedDocs?.length}`);
  
  return { documents: retrievedDocs };
}

async function graderNode(state: typeof GraphState.State) {
  console.log("--- GRADING DOCUMENTS ---");
  // Call the LLM to grade relevance of state.documents against state.query
  // For now, assume relevant
  return { isRelevant: true };
}

async function synthesizerNode(state: typeof GraphState.State) {
  console.log("--- SYNTHESIZING RESPONSE ---");
  
  if (!lmClient) {
    return { messages: [new AIMessage("LM Studio Client not available.")] };
  }

  const docs = (Array.isArray(state.documents) ? state.documents : Array.from(state.documents || [])) as DocumentChunk[];
  console.log("Documents retrieved:", docs.length);

  // Format documents into context
  const context = docs.map((doc, idx) => `[Source ${idx + 1} - ${doc.path}]:\n${doc.text}`).join('\n\n');
  
  // DEADLOCK PREVENTION: 
  // When LM Studio Chat invokes this tool, it locks the Chat LLM.
  // If we try to call lmClient.llm.model().respond() here, we will cause a "Model is busy" deadlock!
  // Instead, this node should just prepare the documents, and we let the LM Studio Chat LLM synthesize the final response natively!
  
  return { 
    messages: [new AIMessage(`I have retrieved the following context. Please synthesize an answer for the user:\n\n${context}`)] 
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
