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
List the specific actions taken during the run.

- **Sources**: `[[YYYY-MM-DD]]`, `[[YYYY-MM-DD]]` — wikilinks to each daily log processed
- **Created**: [Slugs of new articles]
- **Updated**: [Slugs of articles refined with new info]
- **Archived**: [Slugs moved to archive/]
- **Skipped**: [Reason if no knowledge was refined]

## 4. Decision Log (Optional)
Record any major maintenance decisions made (e.g., "Merged articles A and B into new concept C").

## 5. Quality Standards
- **Integrity**: Never delete or edit past log entries.
- **Reference**: Use `[[wikilinks]]` for all created or updated article slugs.
