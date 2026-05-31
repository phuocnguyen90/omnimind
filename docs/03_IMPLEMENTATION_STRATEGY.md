# Implementation Strategy & Technical Anticipations

## 1. Implementation Phases

### Phase 1: Extension Scaffolding & Configuration
- **Task:** Scaffold the Node.js project, install `@lmstudio/sdk` and `@langchain/langgraph`.
- **Task:** Build the configuration interface. Register the directory inputs (`obsidian_vault_path`, `zotero_db_path`) in LM Studio's UI.

### Phase 2: Ingestion & Parsing Engines
- **Task:** Implement `obsidian.ts`. Set up `chokidar` to scan the vault. Extract `[[wikilinks]]`.
- **Task:** Implement `zotero.ts`. Set up `better-sqlite3` to connect to Zotero, query attachments, and parse PDFs via `pdf-parse`.

### Phase 3: Vector Store & Embedding Pipeline
- **Task:** Initialize `LanceDB` (or a Pure-JS alternative if cross-OS compilation fails). Define the schema explicitly to include `links_to` and `source` metadata.
- **Task:** Hook up the embedding model. Ensure the pipeline correctly calls LM Studio's embedding mechanism.
- **Task:** Write the background sync loop that populates the vector store.

### Phase 4: LangGraph Orchestrator Implementation
- **Task:** Define the LangGraph `State` object to hold conversation history, intermediate documents, and routing status.
- **Task:** Build the specific nodes (Query Rewriter, Vector Retriever, Document Grader, Synthesizer).
- **Task:** Compile the StateGraph. Hook the graph's entry point up to the LM Studio Chat UI.
- **Task:** Implement UI streaming. Ensure that as LangGraph transitions between nodes (e.g., "Grading documents..."), status updates are streamed to the LM Studio chat window so the user sees the agent's progress.

---

## 2. Technical Challenges & Mitigations

### 2.1 Cross-OS Development (WSL2 Host -> Windows LM Studio)
**Problem 1 (Connectivity):** The plugin code is developed and served from WSL2 Linux, but needs to be loaded into LM Studio running on Windows.
**Mitigation 1:** This is actually straightforward! When you run `npx lms dev` inside WSL2, it spins up a local development server on `localhost`. Because WSL2 natively shares network ports with the Windows host, your Windows LM Studio application can connect directly to `localhost` to hot-reload the plugin without any manual IP routing.

**Problem 2 (Native Binary Mismatch):** This is the dangerous one. If you run `npm install` inside WSL2, npm will download Linux (`linux-x64`) binaries for native modules like `better-sqlite3` and `@lancedb/lancedb`. When the Windows LM Studio runtime tries to execute this code, it will crash because it expects Windows (`win32-x64`) binaries.
**Mitigation 2:** 
- For development, we must configure our package bundler (or `npm`) to explicitly download and bundle the `win32-x64` prebuilds for `better-sqlite3` and `lancedb`, even though we are installing them from Linux.
- **Safer Fallback:** If cross-compiling native modules becomes too frictionless, we will pivot to pure-JavaScript alternatives. We can swap `better-sqlite3` for `sql.js` (WebAssembly) and `LanceDB` for a pure-JS vector DB like `voy` or `hnswlib-node` (WASM). Pure JS/WASM modules are OS-agnostic and will run perfectly in both WSL2 and Windows.

### 2.2 SQLite Locking with Zotero
**Problem:** Zotero locks its `zotero.sqlite` database when the application is open.
**Mitigation:** Connect to the database using a strict read-only flag or periodically copy the database to a temporary location to query the copy safely.

### 2.3 LanceDB Node Bindings in LM Studio Sandbox
**Problem:** Even ignoring WSL2, `@lancedb/lancedb` relies on native Rust/C++ bindings (Node-API). When running inside a sandboxed runtime like LM Studio extensions, native modules can sometimes fail to load.
**Mitigation:** We must ensure we pull the correct prebuilds. If LanceDB fails to load, pivot to a pure-JS vector store as mentioned above.

### 2.4 Streaming LangGraph Progress to LM Studio UI
**Problem:** A LangGraph workflow runs in the background. If the model takes 30 seconds to retrieve, grade, and rewrite a query, the LM Studio UI will appear frozen, causing terrible user friction.
**Mitigation:** The LangGraph execution loop must be asynchronous. We will use LangGraph's streaming capabilities (`graph.streamEvents()`) to intercept node transitions and send intermediate status messages (e.g., "🔍 Searching Obsidian...", "⚖️ Evaluating relevance...") to the LM Studio chat UI.

### 2.5 Context Window Overflow During Graph Traversal
**Problem:** Passing retrieved documents through a Grader node and then to a Synthesizer node can quickly blow up the token context window of smaller models (8k-16k tokens), causing OOM errors.
**Mitigation:** 
- Strict `top_k = 3` limits on retrieval.
- Implement a "Document Compression" or "Summarization" node in LangGraph if the retrieved text exceeds a certain token threshold, before passing it to the final Synthesizer.

### 2.6 Local Model Formatting Failures (JSON/Schema matching)
**Problem:** Smaller models frequently fail to output clean JSON, which LangGraph nodes often require to make routing decisions (e.g., outputting `{"relevant": true}`).
**Mitigation:** 
- Use robust parsing (like LangChain's Output Fixers or LM Studio's structural JSON generation enforcement if available).
- Keep grading instructions incredibly binary and simple.
