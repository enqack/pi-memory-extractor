# Pi Memory Extractor

A knowledge-management extension for the [Pi AI Agent](https://github.com/badlogic/pi-mono). It transforms Pi from a per-session assistant into a long-term project partner by ensuring that no critical insight, decision, or technical discovery is lost between sessions.

---

## The Core Pipeline

The extension operates on a continuous **Capture → Distill → Inject** cycle:

1. **Injection**: At session start, the extension injects the most recent entries from the knowledge base index and instructs the agent on how to retrieve deeper history on demand.
2. **Capture**: During the session (at checkpoints, compaction, and shutdown), discoveries are extracted into `daily/YYYY-MM-DD.md`.
3. **Distillation**: Daily logs are compiled into a structured, tiered knowledge base (Concepts, Connections, and Q&A).

---

## Architecture

### Search and Retrieval

To handle repositories with hundreds of articles without bloating the context window, the extension uses an on-demand retrieval model:

- **`search_knowledge(query)`**: Allows the agent to search the knowledge index for specific topics.
- **`read_knowledge_article(slug)`**: Allows the agent to read full articles only when needed.
- **Optimized Injection**: Only the most recent index summaries are injected at startup to keep the context window clear.

### Incremental and Hierarchical Compilation

- **Incremental Logic**: The compiler parses `knowledge/log.md` to automatically skip daily logs that have already been processed.
- **Hierarchical Indexing**: Categorized indexes (`concepts/index.md`, `connections/index.md`, etc.) are maintained alongside a master catalog for efficient scaling.
- **Force Flag**: Supports `/compile-knowledge --force` to re-process the entire history when needed.

### Knowledge Lifecycle

- **Automated Archiving**: Articles older than six months that describe temporary workflows or superseded decisions are automatically moved to `knowledge/archive/` during compilation.

---

## Directory Structure

The extension organizes knowledge under a vault root folder (default: `knowledge-base/`) located in the project root:

```text
project-root/
└── knowledge-base/          # Vault root (configurable via pi-memory.json)
    ├── daily/               # Raw daily session logs (YYYY-MM-DD.md)
    ├── deep-thoughts/       # Deep thoughts criteria and meta-log
    ├── reports/             # Generated summaries and reports
    └── knowledge/           # Compiled knowledge base
        ├── index.md         # Master index (catalog)
        ├── log.md           # Compilation history
        ├── concepts/        # Single-topic articles
        │   └── index.md
        ├── connections/     # Relational articles
        │   └── index.md
        ├── qa/              # Question-and-answer articles
        │   └── index.md
        └── archive/         # Stale knowledge (archived after 6 months)
```

---

## Technical Notes

- **In-Session LLM Execution**: Uses the active agent session for extractions and compilations, reducing latency.
- **Dynamic Discovery**: Automatically identifies the vault root by searching for the configured vault folder or a `daily/` sentinel, walking up to 6 levels from the current directory.
- **Cascading Configuration**: Supports a three-tiered configuration system (System → User → Project) via `pi-memory.json`, with the project-level config taking highest precedence.
- **Relative Pathing**: All paths passed to the LLM are resolved relative to the project root, ensuring portability regardless of vault name.
- **Persistent State**: Stores session metadata directly in the session file via `pi.appendEntry`.

---

## Source Layout

| File | Description |
|------|-------------|
| `src/index.ts` | Main orchestrator and ExtensionAPI entry point. |
| `src/extractor.ts` | Filtered transcript serialization and extraction prompt building. |
| `src/compiler.ts` | Log aggregation, synthesis, and archival prompt building. |
| `src/config.ts` | Three-tiered cascading configuration loader (System → User → Project). |
| `src/constants.ts` | Internal default path configuration. |
| `src/utils.ts` | Shared utilities — vault root discovery and date helpers. |
| `src/deep-thoughts-criteria.md` | Criteria governing what qualifies as a "Deep Thought." |

---

## Installation

### Method 1: Pi Package Manager

Once published, install the extension globally via the Pi CLI:

```bash
pi install npm:pi-memory-extractor
```

### Method 2: CLI Flag (Session-based)

For quick testing or one-off use, load the extension directly when starting Pi:

```bash
pi -e ./extensions/pi-memory-extractor/src/index.ts
```

### Method 3: Project Settings (Recommended)

Add the extension to your project's `.pi/agent/settings.json` so it loads automatically for this repository:

```json
{
  "extensions": [
    "./extensions/pi-memory-extractor/src/index.ts"
  ]
}
```

### Method 4: Global Settings

To use the extension across all projects, add the absolute path to your global `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "/absolute/path/to/extensions/pi-memory-extractor/src/index.ts"
  ]
}
```

---

## Configuration

`pi-memory-extractor` uses a three-tiered, cascading configuration system modeled after tools such as Git and ESLint. Settings are resolved by merging all applicable configuration files in order of increasing precedence, with more specific scopes always overriding broader ones.

### Resolution Order

| Tier | Location | Precedence |
|------|----------|------------|
| Internal Defaults | Compiled into the extension | Lowest |
| System | `/etc/pi-memory.json` | — |
| User | `~/.config/pi-memory.json` or `~/.pi-memory.json` | — |
| Project | `pi-memory.json` or `.pi-memory.json` (nearest ancestor directory) | Highest |

Each tier is optional. If a file is not present, that tier is skipped and the next lower tier's values apply. Project-level configuration is discovered by walking up the directory tree from the current working directory, allowing workspace roots and sub-directories to each carry their own overrides.

### Configuration Schema

All configuration files use JSON format and support the following fields:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `VAULT_ROOT` | `string` | `"knowledge-base"` | Name of the vault folder relative to the project root. |
| `DAILY` | `string` | `"daily"` | Sub-directory within the vault for raw daily session logs. |
| `KNOWLEDGE` | `string` | `"knowledge"` | Sub-directory within the vault for compiled knowledge articles. |
| `DEEP_THOUGHTS` | `string` | `"deep-thoughts"` | Sub-directory within the vault for deep-thought criteria and meta-logs. |
| `REPORTS` | `string` | `"reports"` | Sub-directory within the vault for generated summaries and reports. |

All sub-directory paths are resolved relative to the vault root, not the project root.

### Examples

**Minimal project override — rename the vault folder**

Place a `pi-memory.json` in the project root:

```json
{
  "VAULT_ROOT": "ai-notes"
}
```

This causes the extension to use `project-root/ai-notes/` instead of `project-root/knowledge-base/`.

**User-level defaults — applied across all projects**

Create `~/.config/pi-memory.json`:

```json
{
  "VAULT_ROOT": "memory",
  "DAILY": "logs"
}
```

A project-level `pi-memory.json` will still override these values for that specific project.

**Full custom layout**

```json
{
  "VAULT_ROOT": "docs/ai-knowledge",
  "DAILY": "sessions",
  "KNOWLEDGE": "articles",
  "DEEP_THOUGHTS": "reflections",
  "REPORTS": "summaries"
}
```

### Vault Discovery

At session start, the extension resolves the vault root using the following logic:

1. Check if the current working directory contains the configured `DAILY` sub-directory (i.e., Pi is already running inside the vault).
2. Check if a folder named `VAULT_ROOT` exists in the current working directory.
3. Walk up the directory tree (up to 6 levels), repeating checks 1 and 2 at each level.
4. If no vault is found, fall back to `<cwd>/<VAULT_ROOT>` as the default.

This ensures the extension works correctly whether Pi is launched from the project root, a sub-directory, or a monorepo workspace.

---

## Verifying Installation

Once loaded, verify the extension is active by:

1. **Status Bar**: Look for `MemEx: idle` in the bottom right of the Pi UI.
2. **Commands**: Type `/` and confirm that `/extract-knowledge` and `/compile-knowledge` appear.
3. **Logs**: Check the Pi agent console for: `[pi-memory-extractor] Extension loaded (v2.0.0 — ExtensionAPI native).`

---

## Commands

| Command | Description |
|---------|-------------|
| `/extract-knowledge` | Manually save current session learnings to the daily log. |
| `/compile-knowledge` | Compile recent daily logs into the structured knowledge base. |
| `/compile-knowledge --force` | Re-process all daily logs, including already-compiled entries. |

The status bar displays the current phase (`idle`, `extracting…`, `compiling…`) and notifications are emitted when knowledge context is injected or archiving occurs.
