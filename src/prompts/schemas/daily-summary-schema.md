# Daily Summary Schema Contract

This contract defines the format for raw conversation knowledge extractions stored in `daily/YYYY-MM-DD.md`.

## 1. Frontmatter & Title
The file MUST begin with the following YAML frontmatter starting at **LINE 1** (ABSOLUTE TOP) of the file. No text, thought blocks, or whitespace is allowed before the opening `---`.

```yaml
---
title: "YYYY-MM-DD"
date_created: "2026-04-17T14:32:00-07:00"  # full local-ISO timestamp — when this log was extracted, NOT the session date
tags:
  - daily-log
  - pi-memory
---
```

The `processed` field is OPTIONAL on creation and must NOT be set manually. The compilation agent adds it via `edit` after successfully processing the log.

# Daily Session Log — YYYY-MM-DD

## Session Knowledge — YYYY-MM-DD HH:mm

## 2. Categorization Buckets
Capture session findings into the following sections.

### 🔑 Decisions Made
List all concrete, irreversible choices made during the session (e.g., "Switching to Vite").

### 💡 Techniques & Patterns
Technical findings, successful workarounds, or confirmed patterns ("Use X for Y").

### 🏗️ Workflow & Architecture
Changes to the project structure, scripts, or organizational rules.

### ❓ Unresolved Challenges
Challenges that remain open and need follow-up in future sessions.

### 🧠 Deep Thoughts
List ONLY the deep thought articles actually written this session as wikilinks to their slugs (e.g. `[[2026-04-17-14-34-the-weight-of-remembering]]`). Write `- none` if no deep thought was written. Do NOT list regular knowledge articles here.

## 3. Context Summary
- **Context**: A 1–2 sentence description of the overall session purpose.

## 4. Quality Standards
- **Conciseness**: Use bullet points. Avoid conversational filler.
- **Clarity**: Ensure that a different AI agent reading this log 6 months from now would understand the rationale behind the decisions.
