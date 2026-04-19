# Compilation Log Schema Contract

This contract defines the format for entries in the append-only `knowledge/log.md`.

## 1. Frontmatter
The log file MUST start with the following YAML frontmatter at **LINE 1**.

```yaml
---
title: Knowledge Base Compilation Log
type: log
---
```

## 2. Entry Header
Each compilation run MUST be recorded as a Level 2 header with a timestamp.

```markdown
## YYYY-MM-DD HH:MM — Compilation Run
```

## 3. Activity Manifest
List the specific actions taken during the run. Each field uses an indented bullet list of `[[wikilinks]]`. If a field has no entries, write `- **FieldName**: none`.

```markdown
- **Sources**:
  - [[2026-04-10]]
  - [[2026-04-11]]
- **Created**:
  - [[slug-a]]
  - [[slug-b]]
- **Updated**:
  - [[slug-c]]
- **Decayed**:
  - [[slug-d]]
- **Reinforced**:
  - [[slug-c]]
- **Faded**: none
- **Stale**: none
- **Archived**: none
- **Skipped**: none
```

Field semantics:
- **Sources** — `[[YYYY-MM-DD]]` wikilinks to each daily log processed this run
- **Created** — slugs of new articles written this run
- **Updated** — slugs of articles refined with new information
- **Decayed** — articles that lost 0.1 confidence this run (system-provided, applied before prompt)
- **Reinforced** — articles whose `last_reinforced` was bumped this run (agent self-reported; subset of Updated)
- **Faded** — articles that were already at confidence ≤ 0 before this run (system-provided; non-overlapping with Decayed)
- **Stale** — articles with mtime > 6 months, queued for `archive/` (system-provided)
- **Archived** — articles actually moved to archive during this run (agent self-reported)
- **Skipped** — reason if no knowledge was refined (otherwise `none`)

## 4. Decision Log (Optional)
Record any major maintenance decisions made (e.g., "Merged articles A and B into new concept C").

## 5. Quality Standards
- **Integrity**: Never delete or edit past log entries. This is an append-only log.
- **Reference**: Use `[[wikilinks]]` for all article slugs and date references.
