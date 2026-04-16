# Cursed Knowledge Article Schema

## Structure (`cursed-knowledge/<slug>.md`)
Use for documenting hard-to-fix, obscure, or extremely troublesome issues.

### 1. Frontmatter
Every article MUST contain the following YAML frontmatter starting at **LINE 1** (ABSOLUTE TOP) of the file. No text, thought blocks, or whitespace is allowed before the opening `---`.

```yaml
---
title: "[Short, Descriptive Title]"
type: cursed-knowledge
maturity: seed # seed | developing | stable
revision: 1
category: Logic # Logic | Hardware | OS | Network | etc.
tags:
  - tag1
  - tag2
date: YYYY-MM-DD
sources:
  - "[[YYYY-MM-DD]]"
wikilinks: []
---
```

**CRITICAL**: Wikilinks in frontmatter MUST be wrapped in double quotes (e.g., `"[[Slug]]"`).

### 2. Content Sections
1. **The Curse**: Describe the bizarre or frustrating behavior.
2. **Symptoms**: How to identify this issue is occurring (logs, errors).
3. **The Trap**: Why common fixes or "obvious" solutions don't work.
4. **The Exorcism**: The actual (often non-obvious) fix or workaround.
5. **Prevention**: How to avoid this curse in the future.
