# MISSION: COMPILE KNOWLEDGE

**YOUR IMMEDIATE TASK**: Process the daily session logs listed below and update the Knowledge Base.
YOU MUST EXECUTE REAL TOOL CALLS (`read`, `write`, `edit`, `ls`, `grep`) NOW.

### Daily logs to process:
{{#each dailyLogs}}
- {{this}}
{{/each}}

### Context:
- Project Root: `{{projectRoot}}`
- Knowledge Base: `{{relKnowledge}}/`

{{#if archiveList}}
**Articles to ARCHIVE (stale > 6 months):**
{{#each archiveList}}
- {{this}}
{{/each}}
**Archiving Rule**: Move these to `{{relKnowledge}}/archive/` and update frontmatter to `status: archived`.
{{/if}}

---

## EXECUTION RULES:
1. **Recursive Synthesis**: Use `ls` and `grep` to find related articles BEFORE creating new ones. Synthesize info into existing articles whenever possible.
2. **Contract Enforcement**: Every file you write MUST be 100% compliant with the schemas provided below.
3. **Master Index**: Your final step MUST be to update `{{relKnowledge}}/index.md` based on all current articles.

---

## REFERENCE CONTRACTS (SCHEMAS):

### 1. Article Schema (Concepts, Connections, QA)
{{{articleSchema}}}

### 2. Compilation Log Schema (log.md)
{{{compilationLogSchema}}}

### 3. Index Catalog Schema (index.md)
{{{indexSchema}}}

---

**GO NOW**: Begin by `read`ing the daily logs listed above and checking them against existing entries in `{{relKnowledge}}/concepts/`.
