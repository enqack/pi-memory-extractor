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
**Articles to ARCHIVE:**
{{#each archivelist}}
- {{this}}
{{/each}}
**Archiving Rule**: Move these to `{{relKnowledge}}/archive/` (or `{{relKnowledge}}/archive/faded/` if tagged `:faded`) and update frontmatter to `status: archived`.
{{/if}}

{{#if decayedList}}
**Decayed this run (system-applied before you started):**
{{#each decayedList}}
- {{this}}
{{/each}}
{{/if}}

{{#if fadedList}}
**Faded (confidence ≤ 0 — move to `archive/faded/`):**
{{#each fadedList}}
- {{this}}
{{/each}}
{{/if}}

{{#if staleList}}
**Stale (mtime > 6 months — move to `archive/`):**
{{#each staleList}}
- {{this}}
{{/each}}
{{/if}}

---

## EXECUTION RULES:
1. **Recursive Synthesis**: Use `ls` and `grep` to find related articles BEFORE creating new ones. Synthesize info into existing articles whenever possible.
2. **Contract Enforcement**: Every file you write MUST be 100% compliant with the schemas provided below.
3. **Obsidian Compliance**: Every Markdown file MUST start with a `---` YAML frontmatter block on **LINE 1**. **DO NOT** put any text, preamble, or whitespace before the first `---`.
4. **Valid YAML**: Wikilinks in frontmatter MUST be wrapped in double quotes: `wikilinks: ["[[Slug]]"]`.
5. **No Preamble**: When calling the `write` tool, the `content` MUST start immediately with the YAML frontmatter. Do not explain what you are doing inside the tool call.
6. **Master Index**: Your final step MUST be to call the `sync_knowledge_index` tool. This will programmatically rebuild the `index.md` based on all current articles in the vault. DO NOT attempt to write the index manually unless the tool fails.
7. **Reinforcement**: When updating an article based on new logs, set `last_reinforced` to `{{currentTimestamp}}` (the full local-ISO timestamp with offset) and increase `confidence` (+0.1, cap at 1.0). Decay is handled automatically by the system before compilation runs — do not apply it manually. **Reinforcement tracking**: Every time you bump an article's `last_reinforced` and `confidence`, add its slug to a running "reinforced" list in your working memory. When you write the final log entry, emit this list as an indented bullet list under `**Reinforced**:`. Example:
   ```
   - **Reinforced**:
     - [[slug1]]
     - [[slug2]]
   ```
   If no articles were reinforced this run, write `- **Reinforced**: none` — do not omit the field.
8. **Mark Processed**: After successfully processing each daily log, add `processed: true` to its frontmatter using the `edit` tool. This prevents the log from being compiled again in future runs. Do NOT mark a log processed if you skipped it.
9. **Compilation Log Append**: To update the compilation log, you MUST first `read` `{{relKnowledge}}/log.md`. Use the `edit` tool to insert the new `## YYYY-MM-DD HH:MM — Compilation Run` block at the **end** of the file (after the last existing entry). Do NOT use `write` on `log.md`. If the file is empty, you may use `write` with frontmatter and the single new entry. Every field in the Activity Manifest MUST use an indented bullet list of `[[wikilinks]]` — including **Sources**. If a field has no entries, write `- **FieldName**: none`. Never use inline array notation `[slug1, slug2]`. Ensure the entry follows the schema's append-only contract.
10. **New Article Creation**: When creating a NEW article, set `date_created` to `{{currentTimestamp}}` (the full local-ISO timestamp with offset). Do NOT use the date from the source daily log for `date_created`.

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
