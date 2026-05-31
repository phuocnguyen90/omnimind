# OmniMind 🧠

OmniMind is a powerful local-first Retrieval-Augmented Generation (RAG) plugin built on top of [LM Studio](https://lmstudio.ai/). It acts as a bridge between your local LLMs and your personal knowledge base, seamlessly ingesting your **Obsidian Vault** and **Zotero Library** into a local vector database for instant, private semantic search and chat.

---

## ✨ Features

*   **100% Local Privacy**: Everything—from your academic PDFs and personal notes to the embedding models and vector database—runs locally on your machine.
*   **Dual Ingestion Engine**:
    *   **Obsidian Sync**: Live-watches your Obsidian vault for modifications and instantly updates vector embeddings as you write.
    *   **Zotero Integration**: Scans your local Zotero SQLite database and processes the linked PDFs.
*   **Hybrid Vision OCR**: Employs an intelligent fallback system using local Vision Models. If a PDF lacks a proper text layer, OmniMind automatically parses the raw pages through a Vision LLM to extract high-fidelity text.
*   **Premium Web Control Panel**: Features a sleek Vite + React dashboard running securely in the background, allowing you to monitor the ingestion queue, pause/resume tasks, retry failed jobs, and browse your raw LanceDB vector chunks.
*   **LanceDB Vector Store**: Uses LanceDB for blazing-fast, serverless semantic search with optimistic concurrency controls.
*   **LangGraph Orchestration**: Advanced agentic workflows to intelligently decide when to query the knowledge graph or answer directly.

---

## 🚀 Getting Started

### Prerequisites

1.  **LM Studio** installed and running.
2.  **Node.js** (v20+ recommended).
3.  Load an **Embedding Model** in LM Studio (e.g., `nomic-embed-text`).
4.  *(Optional)* Load a **Vision Model** in LM Studio if you have scanned PDFs that require OCR. Ensure "Keep multiple models in memory" is enabled.

### Installation

Clone the repository and install dependencies:

```bash
npm install
cd ui && npm install && npm run build
cd ..
```

### Configuration

Ensure the following paths match your system setup in your `.env` or system environment variables:

```env
OBSIDIAN_VAULT_PATH="C:\Path\To\Your\Obsidian\Vault"
ZOTERO_DB_PATH="C:\Path\To\Your\Zotero\zotero.sqlite"
ZOTERO_STORAGE_PATH="C:\Path\To\Your\Zotero\storage"
MAX_CONCURRENT_WORKERS=4
```

### Running the Plugin

Start the plugin server:

```bash
lms dev
```

1. Open LM Studio.
2. The OmniMind plugin will automatically register as a tool.
3. Open a chat, and the ingestion engine will kick off automatically, parsing your Zotero and Obsidian vaults in the background.

---

## 🎛️ Control Panel

Once the plugin is running, navigate to:

**[http://localhost:4733](http://localhost:4733)**

The Control Panel provides a real-time dashboard to:
- Monitor **Pending**, **Processing**, and **Completed** ingestion tasks.
- **Pause/Resume** the queue to manage local CPU/GPU load.
- Browse the exact vector chunks that have been extracted and embedded into your LanceDB knowledge graph.

---

## 🛠️ Tech Stack

*   **Backend**: Node.js, TypeScript, `@lmstudio/sdk`
*   **Frontend**: React, Vite, CSS (No-Tailwind)
*   **Vector Database**: LanceDB
*   **PDF Processing**: `mupdf`
*   **Orchestration**: LangGraph

## 📝 License

MIT License. See `LICENSE` for more information.
