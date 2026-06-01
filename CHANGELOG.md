# Changelog

All notable changes to this project will be documented in this file.
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
