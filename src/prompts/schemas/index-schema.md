# Index Catalog Schema Contract

This contract defines the formatting and rules for the master `knowledge/index.md`.

## 1. Document Structure
The index MUST be organized into clear sections and start with YAML frontmatter at **LINE 1**.

```markdown
---
title: Knowledge Base Index
type: index
---

# Knowledge Base Index

## Concepts
- [[slug]] — [A one-line summary describing the topic]

## Connections
- [[slug]] — [A one-line summary of the interaction]

## Q&A
- [[slug]] — [A one-line summary of the solution]

## Lessons Learned
- [[slug]] — [A one-line summary of the key lesson]

## Cursed Knowledge
- [[slug]] — [A one-line summary of the issue/fix]

---
*Last Updated: YYYY-MM-DD HH:MM*
```

## 2. One-Line Summary Standard
The one-line summary is critical for the "Smart Recall" system. It must:
- Mention the primary technical concepts or terms.
- Be under 120 characters.
- Start with a capital letter and end with a period.

## 3. Maintenance Rule
- **Alphabetical Order**: Slugs within each section MUST be kept in alphabetical order.
- **Atomic Updates**: Every single article creation or change MUST trigger an update to this index.
