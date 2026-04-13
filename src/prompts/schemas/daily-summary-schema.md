# Daily Summary Schema Contract

This contract defines the format for raw conversation knowledge extractions stored in `daily/YYYY-MM-DD.md`.

## 1. Frontmatter & Title
The file MUST begin with the following YAML frontmatter starting at **LINE 1** (ABSOLUTE TOP) of the file. No text, thought blocks, or whitespace is allowed before the opening `---`.

```yaml
---
title: "Session Knowledge — YYYY-MM-DD"
date: YYYY-MM-DD
tags:
  - daily-log
  - pi-memory
---
```

# Session Knowledge — YYYY-MM-DD

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

### 🧠 Deep Thought Topics
Briefly list the topics of any abstract thoughts marked with `[[deep_thought]]`.
*Note: Full extraction of these topics is handled as a separate standalone artifact turn.*

## 3. Context Summary
- **Context**: A 1-2 sentence description of the overall session purpose (e.g., "Debugging the memory extractor's compaction logic").

## 4. Quality Standards
- **Conciseness**: Use bullet points. Avoid conversational filler.
- **Clarity**: Ensure that a different AI agent reading this log 6 months from now would understand the rationale behind the decisions.
