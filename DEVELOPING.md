# Developing OmniMind

This document contains instructions for building, running, and modifying the OmniMind plugin from source.
If you are an AI agent assisting with the codebase, please refer to the `AGENTS.md` file for architectural rules and constraints.

## 🛠️ Tech Stack

*   **Backend**: Node.js, TypeScript, `@lmstudio/sdk`
*   **Frontend**: React, Vite, CSS (No-Tailwind)
*   **Vector Database**: LanceDB
*   **PDF Processing**: `mupdf`
*   **Orchestration**: LangGraph

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
