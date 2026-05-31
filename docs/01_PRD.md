# Product Requirements Document (PRD)

## 1. Vision & Objective
The core objective of the **OmniMind LM Studio Plugin** is to eliminate friction when using local LLMs to interact with personal knowledge bases. Specifically, it bridges **Obsidian** (knowledge graph) and **Zotero** (reference library) directly inside the LM Studio chat interface.

By leveraging an embedded vector database and structured, deterministic agent workflows (via LangGraph), the plugin enables even small, locally-hosted LLMs to act with high capability, allowing users to:
- Instantly chat with their markdown notes and academic PDFs.
- Rely on the agent to autonomously traverse the knowledge graph, grade relevance, and refine queries if it needs more context.
- Generate new notes that contain precise, non-hallucinated citations (`[@citation_key]`) and native wikilinks (`[[Note Name]]`).

## 2. Target Audience
- Researchers, students, and knowledge workers who use Obsidian and Zotero.
- Users who value local-first, privacy-respecting AI tools (LM Studio).
- Users who want to synthesize new knowledge without constantly copy-pasting between applications, and who need reliable agentic behavior from local models.

## 3. User Stories

### Story 1: Effortless Setup
*As a user, I want to install the plugin in LM Studio, point it to my Obsidian Vault and Zotero database, and have it automatically index my files without complex Python installations or terminal commands.*

### Story 2: Reliable Graph Exploration (LangGraph)
*As a user asking a complex question about a topic, I want the system to utilize a structured workflow. The agent should search my notes, grade the retrieved documents for relevance, and autonomously rewrite its query and search again if the context isn't good enough, before synthesizing the final answer.*

### Story 3: Precise Citations and Link Generation
*As a user drafting a literature review, I want to ask the LLM to synthesize recent papers. The LLM should return markdown text that I can copy-paste directly into Obsidian, complete with accurate `[@smith2024]` citations and `[[Topic Idea]]` wikilinks.*

### Story 4: Automated Note Creation
*As a user synthesizing research, I want to instruct the LLM to create a new synthesis note directly in my Obsidian Vault, properly formatted with frontmatter, backlinks, and references, avoiding the manual step of copy-pasting.*

## 4. Functional Requirements

### 4.1 Ingestion & Syncing
- **Zotero Sync:** Read `zotero.sqlite` locally to extract PDF attachments, parse text, and map to citation keys.
- **Obsidian Sync:** Read the Obsidian vault directory recursively. Parse `.md` files, recognizing YAML frontmatter and `[[wikilinks]]`.
- **Auto-Update:** Use a file watcher (e.g., `chokidar`) to re-index Obsidian notes as they are modified in real-time.

### 4.2 Vector Store
- Create an embedded vector store (e.g., LanceDB) inside the plugin directory.
- Generate embeddings using LM Studio's `/v1/embeddings` endpoint or internal SDK `llm.embed()` to ensure no data leaves the machine.

### 4.3 Structured Agentic Workflows (LangGraph)
Instead of relying on zero-shot LLM tool calling, the plugin must use LangGraph to orchestrate explicit state machines for complex tasks. Example tools/nodes include:
1. `retrieve_context`: Vector search across both Obsidian and Zotero.
2. `grade_documents`: Ask the LLM to evaluate if the retrieved documents answer the query.
3. `get_note_content`: Explicit retrieval of a specific note or PDF by its title/citation key (following a wikilink).
4. `create_obsidian_note`: Writes a new `.md` file to the Obsidian vault with generated content.

## 5. Non-Functional Requirements
- **Local-Only:** No external API calls.
- **Performance:** Low memory footprint when idle. Indexing must not block the LM Studio main UI thread.
- **Resilience:** The plugin must gracefully handle locked SQLite files (using WAL mode/read-only flags) and missing PDFs.
