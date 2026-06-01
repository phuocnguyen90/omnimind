# Developing OmniMind

This document contains instructions for building, running, and modifying the OmniMind plugin from source.
If you are an AI agent assisting with the codebase, please refer to the `AGENTS.md` file for architectural rules and constraints.

## 🛠️ Tech Stack

*   **Backend**: Node.js, TypeScript, `@lmstudio/sdk`
*   **Frontend**: React, Vite, CSS (No-Tailwind)
*   **Vector Database**: LanceDB
*   **PDF Processing**: `mupdf`
*   **Orchestration**: Native LM Studio SDK (`.act()` loop)

## 🏗️ Architecture Deep Dive

*   **LanceDB Vector Store**: Uses LanceDB for blazing-fast, serverless semantic search. We leverage LanceDB's optimistic concurrency controls to ensure the ingestion queue and search API don't collide.
*   **Premium Web Control Panel**: The UI is built using Vite + React. It allows developers and power-users to browse the raw LanceDB vector chunks directly to debug ingestion logic.
*   **Native SDK Orchestration**: We rely exclusively on LM Studio's built-in agentic `.act()` workflows. The agent inherently decides when to query the knowledge graph or answer directly, eliminating the need for heavy, error-prone third-party orchestration frameworks like LangChain.
## 🚀 Setting Up the Developer Environment

If you want to modify the plugin from source:

1. Clone the repository:
   ```bash
   git clone https://github.com/phuocnguyen90/omnimind.git
   cd omnimind
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

## 🏃 Running in Development Mode

To start the plugin server with live-reloading for local development:

```bash
lms dev
```

This will automatically compile changes and connect the plugin to your running LM Studio instance.

## 🧪 Running Tests

OmniMind uses the native `node:test` runner. To execute the test suite:

```bash
npm run test
```
