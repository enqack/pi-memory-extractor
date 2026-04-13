# Article Schema Contract

This contract defines the strict structure for all Knowledge Base articles managed by the Pi Memory Extractor.

## 1. Frontmatter Contract
Every article MUST contain the following YAML frontmatter.

```yaml
---
title: "[Short, Descriptive Title]"
type: concept | connection | qa
maturity: seed | developing | stable
revision: [Integer starting at 1]
category: [Architecture | Logic | UI | Hardware | Workflow]
tags: [tag1, tag2]
date: YYYY-MM-DD
sources: [daily-YYYY-MM-DD.md, session-id]
wikilinks: [[SlugA]], [[SlugB]]
---
```

## 2. Structural Patterns

### A. Concept Article (`concepts/<slug>.md`)
Use for individual technical patterns, architectural rules, or specific device behaviors discovered.
1. **Summary**: 2-3 sentences max.
2. **Key Points**: Bullet list of critical facts.
3. **Details**: Deep explanation of the "How" and "Why."
4. **Practical Application**: Code snippets or workflow steps.
5. **Connections**: Wikilinks to related concepts.
6. **Sources**: Links to the daily logs that provided this knowledge.

### B. Connection Article (`connections/<slug>.md`)
Use for documenting how two or more concepts interact (e.g., "React State + Event Batching").
1. **Relationship**: Paragraph describing the interaction.
2. **Examples**: Real-world cases of the connection.
3. **Practical Implications**: How this interaction affects production decisions.
4. **See Also**: Reference the parent concepts.

### C. Q&A Article (`qa/<slug>.md`)
Use for capturing specific challenges and their definitive solutions.
1. **Question**: The exact challenge or "How do I...?"
2. **Short Answer**: One-sentence resolution.
3. **Full Breakdown**: Detailed steps to the solution.
4. **Related Patterns**: Links to relevant concepts.

## 3. Quality Standards
- **Word Count**: Minimum 200 words for "Stable" articles.
- **Interlinking**: Minimum 2 wikilinks to other knowledge artifacts.
- **Tone**: Professional, technical, and objective.
