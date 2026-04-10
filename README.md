# Pi Memory Extractor

A sophisticated knowledge-management extension for the [Pi AI Agent](https://github.com/badlogic/pi-mono). It transforms Pi from a per-session assistant into a long-term project partner by ensuring that no critical insight, decision, or technical discovery is lost between sessions.

## 🚀 The Core Pipeline

The extension operates on a continuous **Capture → Distill → Inject** cycle:

1.  **Injection**: At session start, the extension injects the 10 most recent entries from the knowledge base and instructs the agent on how to retrieve deeper history.
2.  **Capture**: During the session (checkpoints, compaction, shutdown), discoveries are extracted into `logs/daily/YYYY-MM-DD.md`.
3.  **Distillation**: Daily logs are compiled into a structured, tiered knowledge base (Concepts, Connections, and Q&A).

---

## 🛠 Scalable Architecture Features

### 🔍 Search & Retrieval (RAG)
To handle repositories with hundreds of articles without bloating context, the extension uses an "on-demand" retrieval model:
- **`search_knowledge(query)`**: Allows the agent to search the index for specific topics.
- **`read_knowledge_article(slug)`**: Allows the agent to read full articles only when needed.
- **Optimized Injection**: Only the 10 most recent summaries are injected at startup to keep the context window clear.

### 🧱 Incremental & Hierarchical Compilation
- **Incremental Logic**: The compiler parses `logs/knowledge/log.md` to automatically skip daily logs that have already been processed.
- **Hierarchical Indexing**: Categorized indexes (`concepts/index.md`, `connections/index.md`, etc.) are maintained alongside a master catalog for efficient scaling.
- **Force Flag**: Supports `/compile-knowledge --force` to re-process the entire history if needed.

### 📂 Knowledge Lifecycle (Archiving)
- **Automated Archiving**: Articles older than **6 months** that describe temporary workflows or superseded decisions are automatically moved to `logs/knowledge/archive/` during compilation.

---

## 🏗 Technical Excellence
- **In-Session LLM Execution**: Uses the active agent session for extractions/compilations, reducing latency.
- **Concurrency Protection**: Uses `withFileMutationQueue` to ensure safe, serialized writes.
- **Dynamic Discovery**: Automatically identifies the project root by searching for a `logs/daily` sentinel (up to 6 levels up). No dependency on `CLAUDE.md`.
- **Persistent State**: Stores session metadata directly in the session file via `pi.appendEntry`.

## 📂 Log Directory Structure

The extension organizes knowledge into the following structure at your project root:

```text
logs/
├── daily/               # Raw daily session logs (YYYY-MM-DD.md)
└── knowledge/           # Compiled knowledge base
    ├── index.md         # Master Index (catalog)
    ├── log.md           # Compilation history
    ├── concepts/        # Single-topic articles
    │   └── index.md     # Category index
    ├── connections/     # Relational articles
    │   └── index.md     # Category index
    ├── qa/              # Question-and-answer articles
    │   └── index.md     # Category index
    └── archive/         # Stale knowledge (archived after 6 months)
```

---

## 📂 File Structure (Extension)

- `src/index.ts`: The main orchestrator and ExtensionAPI entry point.
- `src/extractor.ts`: Logic for filtered transcript serialization and extraction prompting.
- `src/compiler.ts`: Logic for log aggregation, synthesis, and archival rules.
- `src/deep-thoughts-criteria.md`: Criteria governing what qualifies as a "Deep Thought."

---

## 🛠 Installation

You can install `pi-memory-extractor` using one of the following methods:

### Method 1: Using the Pi Package Manager (NPM)
Once published, the easiest way to install the extension globally is via the Pi CLI:
```bash
pi install npm:pi-memory-extractor
```

### Method 2: Using the CLI Flag (Session-based)
For quick testing or project-specific use, load the local extension directly when starting Pi:
```bash
# From your project root
pi -e ./extensions/pi-memory-extractor/src/index.ts
```

### Method 3: Persistent Project Setup (Recommended)
Add the extension to your project's `.pi/agent/settings.json` so it loads automatically whenever you work in this repository:
```json
{
  "extensions": [
    "./extensions/pi-memory-extractor/src/index.ts"
  ]
}
```

### Method 4: Global Installation
To use the extractor across all your projects, add the absolute path to your global `~/.pi/agent/settings.json`:
```json
{
  "extensions": [
    "/absolute/path/to/extensions/pi-memory-extractor/src/index.ts"
  ]
}
```

---

## ✅ Verifying Installation

Once loaded, you can verify the extension is active by:
1.  **Status Bar**: Look for `[memory-extractor: idle]` in the bottom right of the Pi UI.
2.  **Commands**: Type `/` and look for the `/extract-knowledge` and `/compile-knowledge` commands.
3.  **Logs**: Check the Pi agent console output for: `[pi-memory-extractor] Extension loaded (v2.0.0 — ExtensionAPI native).`

---

## 🎨 Commands & TUI
- `/extract-knowledge`: Manually save current session learnings.
- `/compile-knowledge [--force]`: Synthesis recent (or all) logs into the formal KB.
- **Status Bar**: Displays phase (`idle`, `extracting…`, `compiling…`).
- **Notifications**: Alerts you when knowledge context is injected or archiving occurs.
