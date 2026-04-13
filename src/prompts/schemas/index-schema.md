# Index Catalog Schema Contract

This contract defines the formatting and rules for the master `knowledge/index.md`.

## 1. Document Structure
The index MUST be organized into clear sections for Concepts, Connections, and QA.

```markdown
# Knowledge Base Index

## Concepts
- [[slug]] — [A one-line summary describing the topic]

## Connections
- [[slug]] — [A one-line summary of the interaction]

## Q&A
- [[slug]] — [A one-line summary of the solution]

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
