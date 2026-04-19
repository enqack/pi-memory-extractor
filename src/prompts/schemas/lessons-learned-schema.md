# Lessons Learned Article Schema

## Structure (`lessons-learned/<slug>.md`)
Use for capturing high-level takeaways from a task, project, or event.

### 1. Frontmatter
Every article MUST contain the following YAML frontmatter starting at **LINE 1** (ABSOLUTE TOP) of the file. No text, thought blocks, or whitespace is allowed before the opening `---`.

```yaml
---
title: "[Short, Descriptive Title]"
type: lessons-learned
maturity: seed # seed | developing | stable
revision: 1
category: Workflow # Workflow | Architecture | Management | etc.
tags:
  - tag1
  - tag2
date_created: "2026-04-17T14:32:00-07:00" # full local-ISO timestamp with offset
last_reinforced: "2026-04-17T14:32:00-07:00"
confidence: 0.9 # (0.0 - 1.0)
sources:
  - "[[YYYY-MM-DD]]"
wikilinks: []
---
```

**CRITICAL**: Wikilinks in frontmatter MUST be wrapped in double quotes (e.g., `"[[Slug]]"`).

### 2. Content Sections
1. **Context**: What was being attempted?
2. **What Went Well**: Successes and positive outcomes.
3. **Challenges**: Obstacles encountered.
4. **The Lesson**: The core takeaway or heuristic for the future.
5. **Next Steps**: How to apply this moving forward.
