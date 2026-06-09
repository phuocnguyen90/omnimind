# Changelog

All notable changes to this project will be documented in this file.

## [0.5.0] - 2026-06-09

### ⚠️ Breaking Changes
- **Embedding Database Schema Upgrade**: Upgraded the LanceDB chunk schema to include a `model` column. Old databases will trigger a model mismatch warning/error and must be re-indexed using the new "Re-embed All Documents" action.

### 🚀 Features
- **Intelligent Embedding Mismatch Validation**: Added active model verification when executing search queries. If any database chunks mismatch the active model, the query aborts with a descriptive error to prevent garbage similarity scores.
- **Unified Re-embedding Pipeline**: Added a "Re-embed All Documents" background task accessible via the API and Control Panel settings page. This drops the table and re-indexes all files using the active embedding model.
- **OCR Text Reuse**: The re-embedding worker intelligently reads from local OCR cache files (`ocr_cache/${key}.md`) for Zotero PDFs. This completely skips running expensive Vision LLM OCR from scratch on existing documents.
- **Dynamic OCR Fallback Loading**: The Zotero OCR module will now search downloaded models on disk and auto-load `DeepSeek-OCR` or any ocr/vision-capable LLM if no LLM is currently running in LM Studio.
- **Default Fallback Model Prioritization**: When resolving embedding models without explicit search config, the system now prioritizes loading `embeddinggemma-300m-qat-GGUF` if it is present in the downloaded models folder.
- **Verbose Startup Sequence Logging**: Replaced generic logs with step-by-step debug logging at each stage of registration, schematics setup, and LM Studio server activation.

## [0.4.2] - 2026-06-09

### 🚀 Features
- **Full Document Viewer**: Added ability to view the full text content of Obsidian notes and Zotero PDF/HTML attachments directly in the Knowledge Base Browser.
- **Search & Filter Sidebar**: Added a search bar to filter the ingested sources list by filename, path, source type, and rich parsed document titles.
- **Title Extraction**: Automatically parses and extracts rich document titles (e.g. author and year metadata) from LanceDB chunk headers to display in the UI and make searchable.
- **Ingestion Fallback for Abstracts**: Automatically processes and embeds Zotero entries without PDF attachments by ingesting their abstracts (if available), fallback routing them seamlessly to the vector store.
- **Startup Sequence Optimizations**: Reordered plugin initialization so the control server UI starts listening before running intensive Zotero databases discovery and Obsidian watcher processes.

### 🐛 Bug Fixes
- **UI Poll Loop Refreshing**: Resolved a React dependency issue where background polling of ingested sources caused the active full document viewer to continuously reload and show the loading spinner every 2 seconds.
- **Test Suite Isolation**: Isolated embedding pipeline unit tests to run inside temporary workspace directories, preventing model dimension mismatch errors caused by live database metadata contamination on local developer machines.

## [0.4.1] - 2026-06-02

### 🚀 Features
- **UI Model Configuration**: Exposed select dropdowns for preferred **Embedding Model** and **Vision/LLM Model (for OCR)** in the Settings tab of the control panel UI (port 4733).
- **Backend Model Discovery**: Implemented a new `/api/models` GET endpoint mapping active downloaded models in LM Studio.

### 🐛 Bug Fixes
- **Embedding Model Verification**: Enforced matching check between query embedding model and index embedding model, automatically creating/checking `embedding_model.json` database metadata to prevent dimension mismatches and search query corruption.
- **Vision OCR Model Selection**: Updated OCR processing to respect the user-selected vision model from settings, with automatic download loading and LLM fallback logic.

## [0.4.0] - 2026-06-01

### 🚀 Features
- **Advanced Search Algorithms**: Introduced robust support for MMR (Maximal Marginal Relevance) and BM25 search options inside `search_knowledge_graph`.
- **Search Parameter Override**: The `search_knowledge_graph` tool now accepts an explicit `algorithm` parameter (`vector`, `bm25`, `hybrid`, `mmr`) allowing agents to dynamically pick the best algorithm for exact keyword/author matching vs conceptual search.
- **Dynamic FTS Indexing**: LanceDB FTS index is now created automatically on-the-fly if missing when `bm25` or `hybrid` searches are performed.
- **Advanced Search UI Settings**: A new Search Settings tab inside the Vite Control Panel allows users to set default `searchAlgorithm` and `mmrDiversity` preferences globally, communicating with a newly implemented `POST /api/config` backend endpoint.

### 🐛 Bug Fixes
- **LanceDB Apache Arrow Compatibility**: Converted raw Apache Arrow Vectors into native JavaScript arrays before performing MMR and K-Means cosine similarity calculations. Fixes fatal `NaN` distance ranking crash causing "Cannot read properties of undefined (reading 'vector')" errors.
- **Control Panel CSS**: Fixed a CSS styling issue where dropdown text within the Search Settings menu was rendering invisibly (white text on white background).
- **Documentation Overhaul**: Updated `README.md` and `DEVELOPING.md` to properly separate end-user benefits from developer architecture, and added a critical section regarding "Best Practices & Local Model Quirks" (pronoun binding, helpfulness bias/hallucinations, and tiny model rigidness).

## [0.3.0] - 2026-06-01
### 🚀 Features
- **Native Configuration UI**: Completely migrated away from `.env` files to LM Studio's native `createConfigSchematics()`. End users can now visually configure their Obsidian vault and Zotero database paths natively inside the LM Studio plugin settings menu!
- **Native Orchestration**: Removed `LangGraph` and migrated the plugin to utilize the LM Studio `.act()` multi-round native orchestration loop.
- **Improved Embedding UX**: `EmbeddingPipeline` now gracefully auto-loads models from disk via `client.embedding.load()` if they are missing from memory, preventing execution halts.
- **Robust Tools**: Drastically improved the reliability of Obsidian editing tools for smaller models. Introduced an `append_obsidian_note` tool and added strict exact-match chain-of-thought system prompts for `edit_obsidian_note`.

### 🐛 Bug Fixes
- **Build System**: Fixed an esbuild `ES2024` unhandled target warning by properly bumping the `tsconfig.json` target to `ES2022`.
- **Git Ignore**: Flattened `ui/.gitignore` into the root `.gitignore` to resolve nested ignore file errors during `lms push` bundling.

## [0.2.1] - 2026-06-01
### 🐛 Bug Fixes
- **Build Isolation**: Reverted the `ncc` standalone bundler logic. `@lancedb` requires platform-specific native `.node` binaries loaded dynamically. Shipping `node_modules` and utilizing standard `tsc` ensures the plugin doesn't crash on Windows/Mac/Linux with `MODULE_NOT_FOUND` errors for native bindings.

## [0.2.0] - 2026-06-01

### 🚀 Features
- **Standalone Builds**: Implemented `@vercel/ncc` to bundle all dependencies natively. The plugin `.zip` release now automatically bundles required WebAssembly (`.wasm`) and LanceDB Rust binaries (`.node`), meaning users **do not** need to install Node.js or run `npm install` to use the plugin!
- **Developer Unit Testing**: Added a comprehensive, zero-dependency unit test suite using the native `node:test` runner and `tsx`.
- **Dependency Injection Mocks**: Built a clean test-injection framework in `src/index.ts` to mock out heavy components (LanceDB, Zotero Extractor, and LM Studio Embedder) without needing heavy mocking libraries.

### 🛠️ Improvements
- **Extracted Diagnostics**: Refactored the `runAutomatedTest` functionality out of `src/index.ts` and into `src/diagnostics/` for cleaner module segregation.
- **Documentation**: Added a "Quickstart: Recommended Models" section to the `README.md` advising users to load DeepSeek-OCR, EmbeddingGemma, and Granite-4-h-tiny concurrently for optimal 10-12GB VRAM usage.

### 🐛 Bug Fixes
- **Build Isolation**: Fixed a bug where `tsc` was attempting to compile root-level `tests/` during the production build step by adding it to `tsconfig.json`'s exclude block.
- **Cleanups**: Completely removed tracking of legacy files (`failed.json`, test scripts, `.vscode/`) and corrected `.gitignore` UTF-16 encoding corruption.
