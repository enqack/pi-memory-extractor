# pi-memory-extractor

A Pi extension that transforms session conversations into a persistent, self-organizing knowledge vault. Raw session insights are extracted into daily logs by a subprocess, then periodically compiled by the main session's LLM into structured, cross-linked knowledge articles — all without touching the active session's context budget during extraction.

---

## The two-phase pipeline

```
┌─────────────────────────────────────────────────────────┐
│  Phase 1 — Extraction (runs automatically or on demand) │
└─────────────────────────────────────────────────────────┘

Pi Session
    │
    ├── session_start     → inject vault context into new session
    ├── session_compact   → serialize transcript → spawn detached subprocess
    └── session_shutdown  → serialize transcript → spawn detached subprocess

Extraction Subprocess (fresh context window, no impact on main session)
    │
    ├── reads transcript + existing vault index
    ├── appends findings to daily/YYYY-MM-DD.md (session's actual date)
    ├── creates or updates knowledge articles (concepts, Q&A, etc.)
    ├── optionally writes a Deep Thought
    └── rebuilds knowledge/index.md

┌──────────────────────────────────────────────────────────────┐
│  Phase 2 — Compilation (run manually when ready to refine)   │
└──────────────────────────────────────────────────────────────┘

/compile-knowledge
    │
    ├── system applies confidence decay to stale articles (before LLM runs)
    ├── identifies uncompiled daily logs via knowledge/log.md
    ├── sends compilation prompt as follow-up to the current session
    │
    └── Main session LLM
            ├── reads each uncompiled daily log
            ├── synthesises findings into existing articles (or creates new ones)
            ├── reinforces and cross-links related articles
            ├── archives flagged articles
            └── calls sync_knowledge_index to rebuild index.md
```

The two-phase design separates concerns: extraction happens automatically in an isolated subprocess after every session; compilation is a deliberate refinement step that merges raw logs into polished, interconnected knowledge.

---

## Vault structure

```
knowledge-base/
├── daily/                  YYYY-MM-DD.md — append-only session extraction logs
├── deep-thoughts/          YYYY-MM-DD-HH-MM-slug.md — Jack Handey-style reflections
├── reports/                compiled knowledge reports
└── knowledge/
    ├── index.md            master index — [[slug]] — one-line summary per article
    ├── log.md              append-only compilation run history
    ├── concepts/           single-topic technical articles
    ├── connections/        relational articles (A ↔ B interactions)
    ├── qa/                 question-and-answer articles
    ├── lessons-learned/    retrospectives and high-level takeaways
    ├── cursed-knowledge/   obscure bugs and hard-to-fix gotchas
    └── archive/
        └── faded/          articles whose confidence decayed to zero
```

---

## Phase 1: Extraction

### How it works

At `session_compact` and `session_shutdown`, the extension serializes the current session transcript and spawns a **detached subprocess** running a fresh instance of the pi agent. The subprocess has its own context window — it does not compete with the main session — and runs to completion even after the parent session exits.

The subprocess:
1. Reads the serialized transcript from a temp file
2. Reads `knowledge/index.md` to understand what is already known
3. Reads today's `daily/YYYY-MM-DD.md` to append rather than overwrite
4. Writes or appends the daily log with categorized findings
5. Creates or updates knowledge articles for each significant insight
6. Optionally writes a Deep Thought if the session contained a genuinely memorable moment
7. Rebuilds `knowledge/index.md`

### Extraction modes

All three modes group sessions by their actual calendar date and write to that date's daily log (`daily/YYYY-MM-DD.md`), not necessarily today's.

| Command | Scope |
|---------|-------|
| `/extract-knowledge` | Current session branch only |
| `/extract-knowledge --deep` | All historical sessions, newest-first, until `deepExtractMaxChars` is reached |
| `/extract-knowledge --all` | Every historical session with no cutoff |

Both `--deep` and `--all` run one extraction subprocess per calendar day, sequentially.

### Deep Thoughts

A Deep Thought is a short, Jack Handey-style absurdist reflection generated only when the session contained a genuinely memorable moment — a breakthrough, a painful debugging saga, an ironic twist, or a decision with dark implications. The filename encodes the session's actual timestamp (`YYYY-MM-DD-HH-MM-slug.md`), derived from the session header embedded in the transcript.

---

## Phase 2: Compilation

Compilation is the refinement step that transforms raw extraction logs into polished, interconnected knowledge. Unlike extraction, it runs as a **follow-up message in the current main session** — the active LLM synthesises the logs directly, with full access to the conversation context.

### What it does

1. **Identify uncompiled logs** — reads `knowledge/log.md` and parses its Sources sections to build a set of already-processed daily logs. Only unprocessed logs are included unless `--force` is passed.
2. **Apply confidence decay** — before handing anything to the LLM, the system automatically applies a −0.1 confidence penalty to any article in an active category whose `last_reinforced` date is more than 30 days ago. Articles already at zero are left for the archiver. The LLM is explicitly instructed not to apply decay manually.
3. **Send the compilation prompt** — a Handlebars template (`compilation.md`) is rendered with the list of logs to process, vault paths, the current date, and a list of articles flagged for archiving. It is sent as a follow-up message to the current agent.
4. **LLM synthesises** — the agent reads each daily log and merges findings into the knowledge base using a **recursive synthesis** approach: it must `ls` and `grep` for related articles before creating anything new, preferring to enrich and cross-link existing articles over fragmentation.
5. **Rebuild index** — the final mandatory step is calling `sync_knowledge_index`, which programmatically scans all active category directories, extracts each article's Summary section, and rewrites `knowledge/index.md`. The LLM never writes the index manually.

### Compilation log

Every run appends an entry to `knowledge/log.md` recording the sources processed, articles created or updated, articles archived, and any major synthesis decisions. This is how the system tracks which logs have already been compiled.

### Confidence decay

Decay is applied once per compilation run, before the LLM prompt is sent.

| Condition | Effect |
|-----------|--------|
| `last_reinforced` > 30 days ago | −0.1 confidence |
| Article reinforced during compilation | +0.1 confidence (cap 1.0) |
| `confidence ≤ 0` after decay | flagged for archiving → `archive/faded/` |

Only active categories are affected (concepts, connections, qa, lessons-learned, cursed-knowledge). Archive directories are not touched.

### Archiving

The archiver runs as part of compilation and also as a standalone `cleanup_knowledge_vault` tool.

| Rule | Destination |
|------|-------------|
| `confidence ≤ 0` | `knowledge/archive/faded/` |
| File `mtime` > 6 months | `knowledge/archive/` |

---

## Session context injection

At `session_start`, the extension injects vault context as a silent user message (`triggerTurn: false`) so the agent begins the session already aware of existing knowledge. Three things are injected:

1. **Knowledge index** — the full `knowledge/index.md`. If the index exceeds 50 lines, it is truncated to the first 5 lines + `…` + the last 15 lines to stay within context budget.

2. **Today's daily log** — if `daily/{TODAY}.md` exists, it is included verbatim. This keeps the agent aware of what was already extracted from earlier sessions today.

3. **Smart recall** — keywords are extracted from the last 10 session messages. Each index line is scored by how many keywords it contains. The top 3 scoring articles have their full Summary sections injected as `### Memory: [[slug]]` blocks. This surfaces the articles most likely to be relevant to the current conversation without requiring an explicit search.

---

## Article lifecycle

Articles use YAML frontmatter + Markdown body and are Obsidian-compatible. All inter-document references use wikilinks.

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
One paragraph. Used verbatim in smart recall and index building.

## Details
...
```

### Article types

| Type | Directory | Purpose |
|------|-----------|---------|
| `concept` | `concepts/` | Single-topic technical patterns, rules, behaviours |
| `connection` | `connections/` | How two or more concepts interact |
| `qa` | `qa/` | A specific challenge and its definitive solution |
| `lessons-learned` | `lessons-learned/` | High-level retrospective takeaways |
| `cursed-knowledge` | `cursed-knowledge/` | Obscure bugs, non-obvious fixes, environment gotchas |

### Maturity levels

| Maturity | Meaning |
|----------|---------|
| `seed` | Newly extracted, unverified |
| `developing` | Reinforced across multiple sessions |
| `stable` | Well-established, minimum 200 words, ≥ 2 cross-links |

### Confidence scoring

| Event | Effect |
|-------|--------|
| Created from explicit statement | 0.7 – 0.9 |
| Created from inference | 0.5 – 0.6 |
| Reinforced during compilation | +0.1 (max 1.0) |
| Decay (unreinforced > 30 days) | −0.1 per compilation run |
| `confidence ≤ 0` | moved to `archive/faded/` |
| `mtime` > 6 months | moved to `archive/` |

---

## Commands

| Command | Description |
|---------|-------------|
| `/extract-knowledge` | Foreground extraction — current session → per-date daily log |
| `/extract-knowledge --deep` | Foreground extraction — recent history (bounded by `deepExtractMaxChars`) → per-date daily logs |
| `/extract-knowledge --all` | Foreground extraction — every historical session → per-date daily logs, no cutoff |
| `/compile-knowledge` | Compile unprocessed daily logs into knowledge articles |
| `/compile-knowledge --force` | Reprocess all daily logs, including already-compiled ones |

---

## Tools

| Tool | Description |
|------|-------------|
| `extract_knowledge` | LLM-callable extraction. Params: `reason` (string), `deep` (bool), `all` (bool) |
| `compile_knowledge` | LLM-callable compilation. Params: `force` (bool) |
| `search_index` | Keyword search against `knowledge/index.md` only |
| `search_articles` | Full-text keyword search across the active `knowledge/` categories |
| `search_knowledge` | Full-text keyword search across the whole vault (`knowledge/` + `daily/` + `deep-thoughts/`) |
| `read_knowledge_article` | Read a full article by slug |
| `sync_knowledge_index` | Programmatically rebuild `knowledge/index.md` from all active articles |
| `cleanup_knowledge_vault` | Archive faded (confidence ≤ 0) and stale (> 6 months) articles |

---

## Installation

```bash
pi install git:github.com/enqack/pi-memory-extractor
```

---

## Configuration

Config is resolved from three tiers, highest precedence first:

1. **Project** — `pi-memory.json` or `.pi-memory.json` (walks up 6 directory levels from cwd)
2. **User** — `~/.config/pi-memory.json` or `~/.pi-memory.json`
3. **System** — `/etc/pi-memory.json`

All keys are optional; unset keys fall back to the defaults below.

| Key | Default | Description |
|-----|---------|-------------|
| `vaultRoot` | `"knowledge-base"` | Vault root directory, relative to project root |
| `maxHistoryMessages` | `50` | Messages included in context injection |
| `maxMessageChars` | `1000` | Per-message character limit for context injection |
| `maxToolResultChars` | `200` | Tool result character limit for context injection |
| `globalMaxChars` | `15000` | Total character cap for injected context |
| `subprocessMaxChars` | `200000` | Transcript character budget per extraction subprocess |
| `deepExtractMaxChars` | `100000` | Total session-selection budget for `--deep` mode |
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

- **Frontmatter repair** — all `write` calls to `knowledge/` files are intercepted, stripped of any LLM preamble, and round-tripped through `js-yaml` to fix `[[wikilink]]` quoting automatically.
- **Frontmatter validation** — writes are blocked if the repaired document still lacks valid YAML frontmatter; the reason is returned to the agent so it can self-correct.
- **Atomic writes** — `withFileMutationQueue()` serializes concurrent writes to the same file, preventing corruption during parallel operations.
- **TypeBox validation** — session `.jsonl` entries are validated on parse; malformed entries are silently skipped rather than aborting the extraction.
