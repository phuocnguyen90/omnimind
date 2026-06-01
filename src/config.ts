import { createConfigSchematics } from "@lmstudio/sdk";

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "obsidianVaultPath",
    "string",
    {
      displayName: "Obsidian Vault Path",
      hint: "The absolute path to your Obsidian vault directory on your local machine.",
    },
    ""
  )
  .field(
    "zoteroDbPath",
    "string",
    {
      displayName: "Zotero Database Path",
      hint: "The absolute path to your Zotero zotero.sqlite database file.",
    },
    ""
  )
  .field(
    "zoteroStoragePath",
    "string",
    {
      displayName: "Zotero Storage Path",
      hint: "The absolute path to your Zotero storage folder (where PDFs are kept).",
    },
    ""
  )
  .field(
    "maxConcurrentWorkers",
    "numeric",
    {
      displayName: "Max Concurrent Workers",
      hint: "Number of concurrent background jobs for ingestion.",
      int: true,
      min: 1,
      max: 16,
      slider: {
        min: 1,
        max: 16,
        step: 1
      }
    },
    4
  )
  .build();
