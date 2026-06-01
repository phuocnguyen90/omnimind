import { tool } from "@lmstudio/sdk";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { activeObsidianVaultPath, embedder, vectorStore } from "../index";

export const writeObsidianNoteTool = tool({
  name: "write_obsidian_note",
  description: "Create a new Markdown note in the user's Obsidian vault. SYSTEM INSTRUCTIONS: When writing for Obsidian, 1) Always use [[WikiLinks]] to link to other notes. 2) Place metadata in YAML frontmatter (between --- blocks) at the very top of the file.",
  parameters: {
    filename: z.string().describe("The name of the note (e.g., 'Research Summary.md'). Must end in .md."),
    content: z.string().describe("The raw Markdown content of the note."),
    overwrite: z.boolean().optional().describe("Set to true to overwrite the file if it already exists.")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] write_obsidian_note called with filename: ${params.filename}`);
    if (!activeObsidianVaultPath) return JSON.stringify({ error: "Obsidian vault path not configured." });
    
    let filename = params.filename;
    if (!filename.endsWith('.md')) filename += '.md';
    filename = filename.replace(/(\.\.\/|\.\.\\)/g, '');
    
    const filePath = path.join(activeObsidianVaultPath, filename);
    if (fs.existsSync(filePath) && !params.overwrite) {
      return JSON.stringify({ error: `File ${filename} already exists. Please choose a different name, set overwrite to true, or use edit/append tools.` });
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
  description: "Edit an existing Obsidian note by precisely finding and replacing a block of text. SYSTEM INSTRUCTIONS: 1) ALWAYS use read_obsidian_note first to fetch the exact text you want to change. 2) Copy the exact text you want to replace into target_content. Do not summarize it. 3) Provide the new text in replacement_content. 4) Use [[WikiLinks]] and YAML frontmatter.",
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
        return JSON.stringify({ error: "The target_content was not found exactly in the file. You MUST use read_obsidian_note first to copy the exact text, character-for-character (including whitespace)." });
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
  description: "Perform a semantic vector search restricted exclusively to the user's local Obsidian Markdown notes. Use this to find specific personal thoughts, logs, or drafts.",
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

export const appendObsidianNoteTool = tool({
  name: "append_obsidian_note",
  description: "Add new text to the very end of an existing Obsidian note. This is much easier and safer than edit_obsidian_note if you just want to add new information.",
  parameters: {
    filename: z.string().describe("The exact name of the note to append to."),
    content: z.string().describe("The text to append to the bottom of the note.")
  },
  implementation: async (params: any) => {
    console.log(`[Tool] append_obsidian_note called for filename: ${params.filename}`);
    if (!activeObsidianVaultPath) return JSON.stringify({ error: "Obsidian vault path not configured." });
    
    let filename = params.filename;
    if (!filename.endsWith('.md')) filename += '.md';
    filename = filename.replace(/(\.\.\/|\.\.\\)/g, '');
    
    const filePath = path.join(activeObsidianVaultPath, filename);
    if (!fs.existsSync(filePath)) {
      return JSON.stringify({ error: `File ${filename} not found in vault.` });
    }
    
    try {
      fs.appendFileSync(filePath, "\n" + params.content);
      return JSON.stringify({ success: true, message: `Successfully appended to ${filename}.` });
    } catch (e: any) {
      return JSON.stringify({ error: `Failed to append to note: ${e.message}` });
    }
  }
});
