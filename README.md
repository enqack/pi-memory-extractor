# pi-memory-extractor

A Pi extension that transforms session conversations into a persistent, self-organizing knowledge vault. At the end of each session, it serializes the transcript and spawns a detached subprocess to extract insights — without touching the main session's context budget.

---

## How it works

```
Pi Session
    │
    ├── session_start    → inject vault context into the new session
    ├── session_compact  → serialize transcript → spawn detached subprocess
    └── session_shutdown → serialize transcript → spawn detached subprocess

Extraction Subprocess (fresh context window)
    │
    ├── reads transcript + existing vault
    ├── appends to daily/YYYY-MM-DD.md (the session's actual date)
    ├── creates or updates knowledge articles
    ├── optionally writes a Deep Thought
    └── rebuilds knowledge/index.md
```

Extraction runs in a subprocess with its own fresh context window so it can ingest the full transcript without competing with the main session.

---

## Vault structure

```
knowledge-base/
├── daily/                  YYYY-MM-DD.md — append-only session logs
├── deep-thoughts/          Jack Handey-style session reflections
├── reports/                compiled knowledge reports
└── knowledge/
    ├── index.md            master index — [[slug]] — one-line summary
    ├── log.md              compilation run history
    ├── concepts/           single-topic technical articles
    ├── connections/        relational articles (A ↔ B)
    ├── qa/                 question-and-answer articles
    ├── lessons-learned/    retrospectives and high-level takeaways
    ├── cursed-knowledge/   obscure bugs, hard-to-fix gotchas
    └── archive/
        └── faded/          articles decayed to confidence ≤ 0
```

---

## Session context injection

At `session_start`, the extension injects three pieces of context into the session as a silent user message (`triggerTurn: false`):

1. **Knowledge index** — the master index, truncated to first 5 + last 15 lines for large vaults.
2. **Today's daily log** — the running log for the current day, if it exists.
3. **Smart recall** — keywords are extracted from the last 10 messages, scored against the index, and the top 3 matching articles have their summaries injected.

---

## Article lifecycle

Articles use YAML frontmatter + Markdown body and are Obsidian-compatible.

```markdown
---
title: "Example Concept"
type: concept
maturity: developing
revision: 3
category: "tooling"
tags: [typescript, build]
date: 2026-01-10
last_reinforced: 2026-04-14
confidence: 0.9
memory_type: fact
sources:
  - "[[2026-01-10]]"
wikilinks:
  - "[[related-concept]]"
---

## Summary
One paragraph summary used in smart recall and index building.

## Details
...
```

All inter-document references use wikilinks — including `sources`, which links to the daily log by date slug (`[[YYYY-MM-DD]]`), and `wikilinks`, which links to related articles.

### Confidence scoring

| Event | Effect |
|-------|--------|
| Article created (explicit fact) | 0.7 – 0.9 |
| Article created (inferred) | 0.5 – 0.6 |
| Article reinforced | += 0.1 (max 1.0) |
| Compilation decay (> 30 days unreinforced) | -= 0.1 per run |
| confidence ≤ 0 | moved to `archive/faded/` |
| mtime > 6 months | moved to `archive/` |

---

## Commands

| Command | Description |
|---------|-------------|
| `/extract-knowledge` | Run foreground extraction on the current session → today's daily log |
| `/extract-knowledge --deep` | Extract recent history (bounded by `deepExtractMaxChars`) → per-date daily logs |
| `/extract-knowledge --all` | Extract every historical session → per-date daily logs, no budget cutoff |
| `/compile-knowledge` | Compile unprocessed daily logs into knowledge articles |
| `/compile-knowledge --force` | Reprocess all daily logs, including already-compiled ones |

### Extraction modes

All three extraction modes write to per-date daily logs (e.g. sessions from 2026-04-10 → `daily/2026-04-10.md`). The modes differ only in which sessions are included:

- **No flag** — current session branch only.
- **`--deep`** — all historical sessions, newest-first, until `deepExtractMaxChars` is reached. Older sessions are skipped once the budget is exhausted.
- **`--all`** — every historical session with no cutoff. Each day's sessions are bounded individually by `subprocessMaxChars`.

Both `--deep` and `--all` run one extraction subprocess per calendar day, sequentially.

---

## Tools

| Tool | Description |
|------|-------------|
| `extract_knowledge` | LLM-callable extraction. Parameters: `reason` (string), `deep` (bool), `all` (bool) |
| `compile_knowledge` | LLM-callable compilation. Parameters: `force` (bool) |
| `search_knowledge` | Search `knowledge/index.md` by keyword |
| `read_knowledge_article` | Read a full article by slug |
| `sync_knowledge_index` | Rebuild `knowledge/index.md` from all vault articles |
| `cleanup_knowledge_vault` | Archive stale and faded articles |

---

## Installation

```bash
pi install git:github.com/enqack/pi-memory-extractor
```

---

## Configuration

The extension resolves config from three tiers, highest precedence first:

1. **Project** — `pi-memory.json` or `.pi-memory.json` (walks up 6 directory levels)
2. **User** — `~/.config/pi-memory.json` or `~/.pi-memory.json`
3. **System** — `/etc/pi-memory.json`

All keys are optional. Unset keys fall back to the defaults below.

| Key | Default | Description |
|-----|---------|-------------|
| `vaultRoot` | `"knowledge-base"` | Vault directory, relative to project root |
| `maxHistoryMessages` | `50` | Messages serialized for context injection |
| `maxMessageChars` | `1000` | Per-message char limit for context injection |
| `maxToolResultChars` | `200` | Tool result char limit for context injection |
| `globalMaxChars` | `15000` | Total char cap for injected context |
| `subprocessMaxChars` | `200000` | Transcript char budget per extraction subprocess |
| `deepExtractMaxChars` | `100000` | Total char budget for `--deep` session selection |
| `subprocessTools` | `"read,write,edit,grep,find,bash"` | Tools available to the extraction subprocess |
| `subprocessModel` | _(inherit)_ | Optional model override for the extraction subprocess |

Example `pi-memory.json`:

```json
{
  "vaultRoot": "knowledge-base",
  "subprocessModel": "gemma4:26b"
}
```

---

## Guardrails

- **Frontmatter repair** — all `write` calls to `knowledge/` files are intercepted, stripped of any LLM preamble, and round-tripped through `js-yaml` to fix `[[wikilink]]` quoting.
- **Frontmatter validation** — writes are blocked if the repaired document still lacks valid YAML frontmatter, with a reason returned to the agent.
- **Atomic writes** — `withFileMutationQueue()` prevents concurrent corruption of vault files.
- **TypeBox validation** — session `.jsonl` entries are validated before parsing; invalid entries are silently skipped.
