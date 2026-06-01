import { lmClient } from "../index";

/**
 * An automated test to verify LangGraph and LM Studio LLM inference without needing the Chat UI.
 * Now includes a full System Diagnostics Report for model state validation.
 */
export async function runAutomatedTest(query: string) {
  console.log(`\n==================================================`);
  console.log(`[DIAGNOSTICS] Starting System Diagnosis...`);
  console.log(`==================================================\n`);
  
  if (!lmClient) {
    console.error("[DIAGNOSTICS] ERROR: lmClient is null! LM Studio did not inject the tools provider.");
    return;
  }

  try {
    // 1. Fetch currently loaded models
    const loadedLLMs = await lmClient.llm.listLoaded();
    const loadedEmbeddings = await lmClient.embedding.listLoaded();

    console.log(`--- Loaded LLMs ---`);
    if (loadedLLMs.length === 0) {
      console.warn("⚠️  No LLMs currently loaded in memory. Ensure a model is loaded for Chat.");
    } else {
      loadedLLMs.forEach((m: any) => console.log(`✅ ${m.identifier} (${m.path})`));
    }

    console.log(`\n--- Loaded Embedding Models ---`);
    if (loadedEmbeddings.length === 0) {
      console.warn("⚠️  No Embedding Models currently loaded in memory.");
      console.log("Attempting to auto-load an embedding model from local disk...");
      
      const downloadedModels = await lmClient.system.listDownloadedModels();
      const embeddingModels = downloadedModels.filter((m: any) => m.type === "embedding");
      
      if (embeddingModels.length > 0) {
        const targetModel = embeddingModels[0].path;
        console.log(`Found local embedding model: ${targetModel}. Loading...`);
        await lmClient.embedding.load(targetModel);
        console.log(`✅ Successfully loaded embedding model!`);
      } else {
        console.error("❌ FAILED: No embedding models found on disk. Please download one (e.g., nomic-embed-text) in LM Studio.");
        return; // Abort test since embeddings are strictly required
      }
    } else {
      loadedEmbeddings.forEach((m: any) => console.log(`✅ ${m.identifier} (${m.path})`));
    }

    console.log(`\n==================================================`);
    console.log(`[AUTOMATED TEST] Executing query: "${query}"`);
    console.log(`==================================================\n`);

    const llm = await lmClient.llm.model();
    const { toolsProvider } = await import("../tools/registry");
    
    await llm.act(query, toolsProvider.tools, {
      onMessage: (message: any) => console.log(message.toString()),
    });
    
    console.log(`\n==================================================`);
    console.log(`[AUTOMATED TEST] Result successfully generated!`);
    console.log(`==================================================\n`);
  } catch (err) {
    console.error("[AUTOMATED TEST] Execution Failed:", err);
  }
}
