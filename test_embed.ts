import { LMStudioClient } from "@lmstudio/sdk";

async function test() {
  const client = new LMStudioClient();
  const model = await client.embedding.model();
  
  try {
    console.log("Testing array of strings...");
    const result = await model.embed(["chunk 1", "chunk 2"]);
    console.log("Success! Array embedding returned length:", result.length || result.embeddings?.length || (result as any).length);
  } catch(e) {
    console.error("Array embed failed:", e);
  }
}
test();
