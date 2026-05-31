import { tool } from "@lmstudio/sdk";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { activeObsidianVaultPath, embedder, vectorStore } from "../index";

export const writeObsidianNoteTool = tool({
  name: "write_obsidian_note",
  description: "Create a new Markdown note in the user's Obsidian vault.",
  parameters: {
    filename: z.string().describe("The name of the note (e.g., 'Research Summary.md'). Must end in .md."),
    content: z.string().describe("The raw Markdown content of the note.")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] write_obsidian_note called with filename: ${params.filename}`);
    if (!activeObsidianVaultPath) return JSON.stringify({ error: "Obsidian vault path not configured." });
    
    let filename = params.filename;
    if (!filename.endsWith('.md')) filename += '.md';
    filename = filename.replace(/(\.\.\/|\.\.\\)/g, '');
    
    const filePath = path.join(activeObsidianVaultPath, filename);
    if (fs.existsSync(filePath)) {
      return JSON.stringify({ error: `File ${filename} already exists. Please choose a different name or use edit_obsidian_note.` });
    }
    
    try {
      fs.writeFileSync(filePath, params.content);
      return JSON.stringify({ success: true, message: `Created note: ${filename}` });
    } catch (e: any) {
      return JSON.stringify({ error: `Failed to write note: ${e.message}` });
    }
  }
});

export const readObsidianNoteTool = tool({
  name: "read_obsidian_note",
  description: "Read the exact raw Markdown contents of an existing Obsidian note. Use this before editing to ensure you target the exact text.",
  parameters: {
    filename: z.string().describe("The exact name of the note to read (e.g., 'Research Summary.md').")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] read_obsidian_note called with filename: ${params.filename}`);
    if (!activeObsidianVaultPath) return JSON.stringify({ error: "Obsidian vault path not configured." });
    
    let filename = params.filename;
    if (!filename.endsWith('.md')) filename += '.md';
    filename = filename.replace(/(\.\.\/|\.\.\\)/g, '');
    
    const filePath = path.join(activeObsidianVaultPath, filename);
    if (!fs.existsSync(filePath)) {
      return JSON.stringify({ error: `File ${filename} not found in vault.` });
    }
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.stringify({ filename, content });
    } catch (e: any) {
      return JSON.stringify({ error: `Failed to read note: ${e.message}` });
    }
  }
});

export const editObsidianNoteTool = tool({
  name: "edit_obsidian_note",
  description: "Edit an existing Obsidian note by precisely finding and replacing a block of text.",
  parameters: {
    filename: z.string().describe("The exact name of the note to edit."),
    target_content: z.string().describe("The exact string block to remove or replace. Must match the file exactly."),
    replacement_content: z.string().describe("The new string to insert in place of the target_content.")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] edit_obsidian_note called for filename: ${params.filename}`);
    if (!activeObsidianVaultPath) return JSON.stringify({ error: "Obsidian vault path not configured." });
    
    let filename = params.filename;
    if (!filename.endsWith('.md')) filename += '.md';
    filename = filename.replace(/(\.\.\/|\.\.\\)/g, '');
    
    const filePath = path.join(activeObsidianVaultPath, filename);
    if (!fs.existsSync(filePath)) {
      return JSON.stringify({ error: `File ${filename} not found in vault.` });
    }
    
    try {
      let content = fs.readFileSync(filePath, 'utf-8');
      if (!content.includes(params.target_content)) {
        return JSON.stringify({ error: "The target_content was not found exactly in the file. Use read_obsidian_note to verify the exact text." });
      }
      
      content = content.replace(params.target_content, params.replacement_content);
      fs.writeFileSync(filePath, content);
      return JSON.stringify({ success: true, message: `Successfully edited ${filename}.` });
    } catch (e: any) {
      return JSON.stringify({ error: `Failed to edit note: ${e.message}` });
    }
  }
});

export const searchPersonalNotesTool = tool({
  name: "search_personal_notes",
  description: "Semantic vector search specifically restricted to local Obsidian personal notes.",
  parameters: {
    query: z.string().describe("The search query."),
    limit: z.number().optional().describe("Number of results to return (default 5).")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] search_personal_notes called with query: ${params.query}`);
    const limit = params.limit || 5;
    const queryVector = await embedder.generateEmbedding(params.query);
    const results = await vectorStore.search(queryVector, { sourceFilter: 'obsidian', limit });
    return JSON.stringify(results.map(r => ({ path: r.path, text: r.text, links_to: r.links_to })));
  }
});
