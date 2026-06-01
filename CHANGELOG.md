# Changelog

All notable changes to this project will be documented in this file.

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
