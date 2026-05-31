# Product Requirement Document (PRD)

## Project Code Name: **OmniMind Extension (`lms-plugin-omnimind`)**

**Author:** AI & Full-Stack Engineering Collaborator

**Status:** Approved for Scaffolding

**Target Environment:** LM Studio Extension Runtime (Node.js) + Embedded LanceDB + Host File Monitors

---

## 1. Executive Summary & Objective

### 1.1 Problem Statement

While local LLM chat applications are mature, connecting personal multi-source databases remains difficult. Current RAG solutions require users to manually compile custom Python scripts, navigate command lines, or run persistent docker containers. Existing local plugins handle either flat file directories *or* standalone web lookups, completely overlooking the rich structured links available when combining a personal note graph (Obsidian) with deep academic reference repositories (Zotero).

### 1.2 Objective

To build an integrated LM Studio extension that automatically maps, text-extracts, chunks, and vector-indexes *both* Zotero storage directories and Obsidian Markdown files into a private, embedded vector instance. The plugin will expose unified function-calling capabilities directly inside the LM Studio chat UI, creating an instant local workspace knowledge assistant.

---

## 2. Extension Architecture & Data Boundaries

The plugin executes cleanly as an isolated process managed directly by LM Studio’s extension runtime loop.

```
+-----------------------------------------------------------------------------------+
|                              LM STUDIO RUNTIME CORE                               |
|                                                                                   |
|  +--------------------+         Tool Event        +----------------------------+  |
|  | LM Studio Chat UI  |-------------------------->|  OmniMind Tool Provider    |  |
|  +--------------------+                           +-------------+--------------+  |
|           ^                                                     |                 |
|           | Returns Aggregated Context                          v                 |
|           |                                       +----------------------------+  |
|           +---------------------------------------| Local LanceDB Vector Store |  |
|                                                   +-------------+--------------+  |
|                                                                 ^                 |
|                                                                 | Polls/Reads     |
|                                                                 v                 |
+-----------------------------------------------------------------+-----------------+
                                                                  |
                                      +---------------------------+---------------------------+
                                      | (Local Host File System Operations)                   |
                                      v                                                       v
                       +-----------------------------+                         +-----------------------------+
                       |    Obsidian Vault Dir       |                         |    Zotero Storage Path      |
                       |    (Chokidar Watcher)       |                         |    (SQLite + File System)   |
                       +-----------------------------+                         +-----------------------------+

```

---

## 3. Functional Requirements

### 3.1 Extension UI Configuration Settings

* **REQ-1.1:** The plugin must register configuration parameters with the LM Studio Settings panel to display custom string inputs and file path selectors:
* `zotero_db_path`: Absolute directory targeting the local `zotero.sqlite` file.
* `zotero_storage_path`: Absolute path targeting the `Zotero/storage/` folder.
* `obsidian_vault_path`: Absolute path targeting the primary local Obsidian workspace directory.


* **REQ-1.2:** The plugin must validate these directories instantly on save by checking for the existence of `zotero.sqlite` or a `.obsidian/` configuration folder.

### 3.2 Headless Sync & Extraction Pipelines

#### 3.2.1 Zotero Ingestion Loop

* **REQ-2.1:** The plugin must open a read-only database channel using `better-sqlite3` directly against `zotero.sqlite`.
* **REQ-2.2:** It must resolve the physical location of PDF attachments by extracting the 8-character subdirectory hash using the following mapping pattern:
```sql
SELECT items.key AS storage_key, itemAttachments.path AS file_name
FROM itemAttachments 
JOIN items ON itemAttachments.itemID = items.itemID
WHERE itemAttachments.path LIKE 'storage:%.pdf';

```



```
*   **REQ-2.3:** It must parse and extract text strings from these paths recursively using a lightweight node-native extractor (e.g., `pdf-parse`), splitting entries into paragraph-based chunks (~512 tokens) with a 15% sliding context boundary overlap.

#### 3.2.2 Obsidian Graph Watcher
*   **REQ-2.4:** The plugin must spin up a `chokidar` file-system monitor targeting the specified Obsidian folder pathway.
*   **REQ-2.5:** It must recursively parse `.md` files on creation or modification, parsing frontmatter blocks (`tags`, `aliases`, `citation_key`) as strict vector metadata properties.
*   **REQ-2.6:** Markdown content must be sectioned cleanly using structural elements (headers and subheaders) to keep sentence lists unified.

### 3.3 Serverless Vector Indexing via LM Studio APIs
*   **REQ-3.1:** The extension must load and commit vectors into an internal `vectordb` instance (LanceDB node bindings), storing data structures as flat binary files directly inside the plugin’s local runtime folder.
*   **REQ-3.2:** Rather than bringing an external embedding package, the plugin must route raw chunk text strings through LM Studio's internal embedding API endpoint (`/v1/embeddings`) using the currently active embedding model configuration.

### 3.4 Tool Registration & Capability Exposure
*   **REQ-4.1:** The extension must use the native LM Studio SDK wrapper to register explicitly as a **Tools Provider**, making capabilities instantly accessible to local models capable of function calling.
*   **REQ-4.2:** The plugin must register the following system tools:

| Registered Tool Name | Execution Signature | Target Backend Operation |
|---|---|---|
| `search_academic_references` | `(query: string, limit?: number)` | Vector similarity match strictly against chunked Zotero PDF content. Returns raw text blocks with their parent citation keys. |
| `search_personal_notes` | `(query: string, limit?: number)` | Vector similarity match strictly against the Obsidian Markdown database index. Returns matching document path blocks. |
| `query_hybrid_knowledge` | `(query: string)` | Executes parallel vector operations against both target indices, deduplicating matching keys and merging contexts. |

---

## 4. Non-Functional Requirements

*   **NFR-1 (Local Sandbox Enforcement):** All text parsing, database calls, vector tracking, and embedding calculations must happen completely locally on the host machine.
*   **NFR-2 (Memory Overhead Restrictions):** Because LanceDB is completely serverless and memory-mapped, the plugin runtime footprint must stay under 150MB of background RAM when actively watching directories.
*   **NFR-3 (Resource State Safeguards):** The file processing pipeline must run sequentially, yielding execution loops to ensure that loading massive academic papers does not spike CPU metrics or block the main thread of the host chat app interface.

---

## 5. Scope & Exclusions
*   **V1 Exclusion:** The plugin will not implement custom chat layout modifications. All data display relies purely on the default markdown text blocks returned by function execution calls inside the standard LM Studio chat view window.
*   **V1 Exclusion:** Automated model execution tuning. The plugin assumes the user has already loaded a tool-capable model inside their active session window.

