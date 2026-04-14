# Pi Memory Extractor

A knowledge-management extension for the [Pi AI Agent](https://github.com/badlogic/pi-mono). It transforms Pi from a per-session assistant into a long-term project partner by ensuring that no critical insight, decision, or technical discovery is lost between sessions.

---

## The Orchestrated Pipeline

Unlike basic extraction methods, this extension uses a **Multi-Step Memory Orchestrator** to ensure high-fidelity knowledge capture. Every extraction goes through a mandatory 3-step workflow:

1.  **Step 1: Analysis (Thematic Categorization)**: The agent identifies dominant, recurring themes, assigning each a `memory_type` (Fact, Preference, Goal, Correction, Pattern) and a initial `confidence` score.
2.  **Step 2: Mapping (Relationship Deep-Dive)**: The agent maps entities (Concepts, Products, People) and their explicit relationships (e.g., `[A] -> [Implemented via] -> [B]`).
3.  **Step 3: Synthesis (Final Structured Output)**: The agent compiles the analysis and mapping into a structured JSON packet.
4.  **Step 4: Resolution (Conflict Handling)**: If new insights conflict with existing high-confidence knowledge, the orchestrator pauses the workflow to resolve the discrepancy with the user before committing via the `submit_knowledge_synthesis` tool.

---

## Core Features

### 🧠 Orchestrated Knowledge Extraction
Automatically triggers during session compaction or shutdown, or manually via commands. It also features **Reactive Triggering**, which monitors the conversation for linguistic markers of self-correction (e.g., "actually", "wait") or explicit project decisions to initiate extraction autonomously.

### ⏳ Knowledge Lifecycle & Decay
Introduces a temporal dimension to memory. Each knowledge article tracks its `confidence` (0.0–1.0) and `last_reinforced` date.
- **Reinforcement**: Active use or referencing of a memory during a session increases its confidence score.
- **Decay**: Knowledge that is not reinforced during a 30-day compilation cycle suffers a confidence penalty (-0.1).

### 💭 Deep Thoughts
Captured via `[[deep_thought: Topic]]` markers during the analysis phase. These represent absurdist, meta-cognitive reflections on the coding process or session context, following the Jack Handey "Deep Thought" formula.

### 🔍 Smart Context Injection & Recall
At session start, the extension injects a summary of the most recent knowledge index. It also uses **Smart Recall**—a keyword-based scoring system—to surface relevant article summaries from the knowledge base based on the initial conversation history.

### 🏗️ Robust Knowledge Compiler
Compiles daily logs into a structured, tiered knowledge base (Concepts, Connections, Q&A, Lessons Learned, and Cursed Knowledge). It uses incremental logic to only process new logs unless the `--force` flag is used.

### 🧹 Automatic Archiving
Keeps the knowledge base fresh by automatically moving stale or "faded" information:
- **Stale**: Articles older than 6 months are moved to the `archive/` directory.
- **Faded**: Articles whose confidence drops to 0.0 due to lack of reinforcement are moved to `archive/faded/`.

### 🛠️ Automated Knowledge Guardrails
Ensures the structural integrity of the knowledge base by intercepting `write` and `edit` calls to Markdown files. It automatically:
- **Repairs Frontmatter**: Strips accidental LLM chatter/thinking before the YAML block.
- **Quotes Wikilinks**: Ensures `[[links]]` in YAML frontmatter are properly quoted for Obsidian compatibility.
- **Enforces YAML**: Blocks writes to the knowledge base that lack a valid YAML frontmatter header.

---

## Directory Structure

The extension organizes knowledge under a vault root folder (default: `knowledge-base/`) located in the project root:

```text
project-root/
└── knowledge-base/          # Vault root (configurable via pi-memory.json)
    ├── daily/               # Raw daily session logs (YYYY-MM-DD.md)
    ├── deep-thoughts/       # Absurdist reflections and "Deep Thought" articles
    ├── reports/             # Generated summaries and project reports
    └── knowledge/           # Compiled knowledge base
        ├── index.md         # Master index (catalog)
        ├── log.md           # Compilation history
        ├── concepts/        # Single-topic articles
        ├── connections/     # Relational articles
        ├── qa/              # Question-and-answer articles
        ├── lessons-learned/ # High-level project/task takeaways
        ├── cursed-knowledge/# Hard-to-fix or obscure technical issues
        └── archive/         # Stale knowledge (archived after 6 months)
            └── faded/       # Knowledge that has decayed due to lack of reinforcement
```

---

## Technical Notes

- **Reactive Extraction Heuristics**: Monitors the conversation stream for linguistic markers of "pivots" or "corrections" to capture state changes as they happen.
- **Confidence-Based Persistence**: Implements a "forgetting" curve for low-utility knowledge, ensuring the active vault remains focused on currently relevant information.
- **Conflict Resolution Logic**: Scans the knowledge index during synthesis to detect potential discrepancies with existing entries, enabling proactive reconciliation.
- **Multi-Step Orchestration**: Uses the `MemoryOrchestrator` to manage stateful extraction workflows across multiple agent turns, storing progress in the session history and using the `agent_end` event for progression.
- **Interactive Visualization**: The `submit_knowledge_synthesis` tool provides a custom TUI (`SynthesisTabs`) for reviewing extracted themes, relationships, and takeaways.
- **Thread-Safe Writes**: Uses `withFileMutationQueue` to ensure that concurrent tool executions or automated triggers don't corrupt the knowledge vault.
- **Smart Recall Heuristics**: Uses a lightweight keyword-based scoring system to find relevant articles in the `index.md` based on recent conversation history, injecting summaries to provide context.
- **Structural Integrity**: Actively repairs and enforces Obsidian-compatible YAML frontmatter in knowledge articles.
- **Cascading Configuration**: Supports a three-tiered configuration system (System → User → Project) via `pi-memory.json`.
- **Event-Driven Lifecycle**: Automatically manages memory lifecycle through `session_start`, `agent_end`, `session_compact`, and `session_shutdown` hooks.

---

## Commands

| Command | Description |
|---------|-------------|
| `/extract-knowledge` | Manually trigger session knowledge extraction. |
| `/extract-knowledge --deep` | Trigger extraction scanning ALL historical session files. |
| `/compile-knowledge` | Compile daily logs into the structured knowledge base. |
| `/compile-knowledge --force`, `-f` | Re-process all daily logs, including already-compiled entries. |

---

## Tools

The extension registers several tools that can be invoked by the agent or manually:

| Tool | Description |
|------|-------------|
| `extract_knowledge` | Triggers the orchestrated extraction workflow. Supports `deep` mode. |
| `compile_knowledge` | Triggers the compilation of daily logs. |
| `submit_knowledge_synthesis` | **(Internal)** Used by the orchestrator to commit final synthesized knowledge. Renders interactive `SynthesisTabs`. |
| `cleanup_knowledge_vault` | Archives articles older than 6 months. |
| `search_knowledge` | Search the knowledge base index for specific keywords. |
| `read_knowledge_article` | Read the full content of a specific knowledge article by its slug. |

---

## Installation

### Method 1: Pi Package Manager

Once published, install the extension globally via the Pi CLI:

```bash
pi install npm:pi-memory-extractor
```

### Method 2: Project Settings (Recommended)

Add the extension to your project's `.pi/agent/settings.json`:

```json
{
  "extensions": [
    "./extensions/pi-memory-extractor/src/index.ts"
  ]
}
```

---

## Configuration

`pi-memory-extractor` uses a three-tiered, cascading configuration system.

### Resolution Order

1.  **Project**: `pi-memory.json` or `.pi-memory.json` in the nearest ancestor directory (Highest Precedence).
2.  **User**: `~/.config/pi-memory.json` or `~/.pi-memory.json`.
3.  **System**: `/etc/pi-memory.json`.
4.  **Internal Defaults** (Lowest Precedence).

### Configuration Schema

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `VAULT_ROOT` | `string` | `"knowledge-base"` | Name of the vault folder relative to the project root. |
| `DAILY` | `string` | `"daily"` | Sub-directory for raw daily session logs. |
| `KNOWLEDGE` | `string` | `"knowledge"` | Sub-directory for compiled knowledge articles. |
| `DEEP_THOUGHTS` | `string` | `"deep-thoughts"` | Sub-directory for deep-thought criteria. |
| `REPORTS` | `string` | `"reports"` | Sub-directory for generated reports. |
