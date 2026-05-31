import { tool } from "@lmstudio/sdk";
import { z } from "zod";
import { zoteroExtractor, embedder, vectorStore } from "../index";

export const getPaperInfoTool = tool({
  name: "get_paper_info",
  description: "Fetch exact metadata (Title, Authors, Year, DOI, Abstract, PDF path) for a specific Zotero paper using a title fragment, author, or DOI. Use this ONLY when you need exact reference data.",
  parameters: {
    query: z.string().describe("Title fragment, author's last name, or DOI to search in Zotero.")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] get_paper_info called with query: ${params.query}`);
    if (!zoteroExtractor) return JSON.stringify({ error: "Zotero Extractor not initialized." });
    const info = await zoteroExtractor.getPaperInfo(params.query);
    return JSON.stringify(info);
  }
});

export const searchAcademicReferencesTool = tool({
  name: "search_academic_references",
  description: "Perform a semantic vector search restricted exclusively to Zotero academic papers. Use this when the user is specifically asking to find academic literature, studies, or papers.",
  parameters: {
    query: z.string().describe("The search query."),
    limit: z.number().optional().describe("Number of results to return (default 5).")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] search_academic_references called with query: ${params.query}`);
    const limit = params.limit || 5;
    const queryVector = await embedder.generateEmbedding(params.query);
    const results = await vectorStore.search(queryVector, { sourceFilter: 'zotero', limit });
    return JSON.stringify(results.map(r => ({ path: r.path, text: r.text })));
  }
});

export const clusterPapersTool = tool({
  name: "cluster_papers",
  description: "Semantically cluster academic papers based on a broad topic or query to find common themes and groupings.",
  parameters: {
    query: z.string().describe("The broad topic to fetch papers for clustering."),
    k: z.number().optional().describe("Number of clusters to generate (default 3).")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] cluster_papers called with query: ${params.query}, k: ${params.k}`);
    const k = params.k || 3;
    const queryVector = await embedder.generateEmbedding(params.query);
    // Fetch top 50 results to cluster
    const results = await vectorStore.search(queryVector, { sourceFilter: 'zotero', limit: 50 });
    
    if (results.length < k) {
      return JSON.stringify({ error: `Not enough papers found (${results.length}) to form ${k} clusters.` });
    }

    // Dynamic import to avoid loading unless called
    const { kmeans } = await import("../vectorstore/cluster");
    
    const vectors = results.map(r => r.vector);
    const assignments = kmeans(vectors, k);
    
    const clusters: Record<number, any[]> = {};
    for (let i = 0; i < k; i++) clusters[i] = [];
    
    for (let i = 0; i < results.length; i++) {
      const clusterId = assignments[i];
      clusters[clusterId].push({
        path: results[i].path,
        text: results[i].text.substring(0, 200) + "..." // Truncate text to avoid massive JSON
      });
    }

    return JSON.stringify(clusters);
  }
});
