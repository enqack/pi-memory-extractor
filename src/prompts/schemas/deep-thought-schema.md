# Deep Thought Schema Contract

## Structure (`deep-thoughts/YYYY-MM-DD-HH-MM-<slug>.md`)
Use for short, Jack Handey-style absurdist reflections grounded in a specific session moment.

### 1. Filename
Derive from the most relevant session header timestamp in the transcript (`### Session <id> — YYYY-MM-DDTHH:MM`), e.g. `2026-04-10T14:34` → `2026-04-10-14-34-<slug>.md`. Fall back to `{{today}}-{{time}}-<slug>.md` if no session header is present.

### 2. Frontmatter
The file MUST start with the following YAML frontmatter at **LINE 1**. No preamble or whitespace before the opening `---`.

```yaml
---
title: "[The Deep Thought Topic]"
type: deep-thought
date_created: "2026-04-17T14:32:00-07:00" # full local-ISO timestamp with offset — use {{now}}
tags:
  - deep-thought
---
```

### 3. Body

```markdown
# [The Deep Thought Topic]

[The full Jack Handey-style absurdist reflection — under 4 sentences.]

---

[Session work of relevance - under 3 sentences.]

```

### 4. The Formula
- Open with a tone of profound, Hallmark-style sincerity.
- Veer abruptly into the surreal, morbid, or absurd.
- Ground it in something specific from this session (a decision made, a bug encountered, a pattern discovered).
- Keep it under 4 sentences.

### 5. Quality Standards
- **Specificity**: Must reference the session concretely — no generic philosophising.
- **Brevity**: Under 4 sentences, no exceptions.
- **Tone**: Sincerity-to-absurdity arc is mandatory.
