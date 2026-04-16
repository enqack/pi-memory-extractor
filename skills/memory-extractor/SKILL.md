---
name: memory-extractor
description: Extracts session insights into structured knowledge and stores them in the project vault. Use when the user asks to save something for later, after significant discoveries, or when compiling daily logs.
---

# Skill: Memory Extractor

Transforms session insights into long-term structured knowledge stored in the project's knowledge vault.

## When to use
- After a significant technical discovery, decision, or architectural change.
- When the user asks to "save this", "remember this", or "extract that".
- Before session compaction or shutdown (this happens automatically).
- To compile accumulated daily logs into structured knowledge articles.

## Available Tools
- `extract_knowledge` — Serialize the current session and run the extraction subprocess.
- `compile_knowledge` — Compile daily logs into structured knowledge base articles.
- `search_index` — Keyword search against the knowledge index only.
- `search_articles` — Full-text keyword search across the active knowledge/ categories.
- `search_knowledge` — Full-text keyword search across the whole vault (articles + daily logs + deep thoughts).
- `read_knowledge_article` — Read a full article from the vault by slug.
- `sync_knowledge_index` — Rebuild the master knowledge/index.md from all vault articles.
- `cleanup_knowledge_vault` — Archive stale or faded articles.

## Extraction Workflow
When `extract_knowledge` is called, a subprocess agent with a fresh context window:
1. Reads the session transcript.
2. Reads the existing knowledge index.
3. Appends structured insights to today's daily log.
4. Creates or updates knowledge articles (concepts, connections, Q&A, lessons-learned, cursed-knowledge).
5. Optionally writes a Jack Handey-style Deep Thought.
6. Rebuilds `knowledge/index.md`.

## Compilation Workflow
When `compile_knowledge` is called, a compilation prompt is sent to the current agent, which:
1. Reads all uncompiled daily logs.
2. Synthesizes and updates the knowledge base articles.
3. Runs `sync_knowledge_index` as the final step.
