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
**Archiving Rule**: Move these to `{{relKnowledge}}/archive/` (or `{{relKnowledge}}/archive/faded/` if the item is tagged as `:faded`) and update frontmatter to `status: archived`.
{{/if}}

---

## EXECUTION RULES:
1. **Recursive Synthesis**: Use `ls` and `grep` to find related articles BEFORE creating new ones. Synthesize info into existing articles whenever possible.
2. **Contract Enforcement**: Every file you write MUST be 100% compliant with the schemas provided below.
3. **Obsidian Compliance**: Every Markdown file MUST start with a `---` YAML frontmatter block on **LINE 1**. **DO NOT** put any text, thinking blocks, preamble, or whitespace before the first `---`.
4. **Valid YAML**: Wikilinks in frontmatter MUST be wrapped in double quotes: `wikilinks: ["[[Slug]]"]`.
5. **No Preamble**: When calling the `write` tool, the `content` MUST start immediately with the YAML frontmatter. Do not explain what you are doing inside the tool call.
6. **Master Index**: Your final step MUST be to update `{{relKnowledge}}/index.md` based on all current articles.
7. **Confidence & Decay Logic**:
    - **Reinforcement**: When updating an article based on new logs, set `last_reinforced` to `{{currentDate}}` and increase `confidence` (+0.1, cap at 1.0).
    - **Decay**: For EVERY article you read that is NOT being reinforced today, check the `last_reinforced` date.
        - If the date is > 30 days ago, **DECREASE confidence by 0.1**.
        - If confidence reaches 0.0, mark it for archiving in the next cleanup cycle or move it to `archive/faded/`.

---

## REFERENCE CONTRACTS (SCHEMAS):

### 1. Core Article Schema (Concepts, Connections, QA)
{{{articleSchema}}}

### 2. Lessons Learned Schema
{{{lessonsLearnedSchema}}}

### 3. Cursed Knowledge Schema
{{{cursedKnowledgeSchema}}}

### 4. Compilation Log Schema (log.md)
{{{compilationLogSchema}}}

### 5. Index Catalog Schema (index.md)
{{{indexSchema}}}

---

**GO NOW**: Begin by `read`ing the daily logs listed above and checking them against existing entries in `{{relKnowledge}}/concepts/`.
