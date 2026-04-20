## Execution Rules

1. **Frontmatter First**: Every `.md` file you write MUST start with `---` YAML frontmatter on **LINE 1**. No preamble, no explanations, no whitespace before the opening `---`.
2. **Wikilinks in YAML**: Any `[[wikilink]]` inside a YAML frontmatter block MUST be wrapped in double quotes: `"[[Slug]]"`.
3. **Check Before Creating (Mandatory)**: You MUST `grep` the relevant category directory and `read` every plausibly-related article in full before writing a new article. Creating a new article without first reading the existing near-matches is a defect. Prefer updating existing articles to fragmentation.
4. **Synthesise**: If the transcript covers multiple related sub-topics already split across articles, add cross-references via `wikilinks` — don't duplicate content.
5. **Article Granularity**: Each article covers one concept, one connection, or one question. Do not create omnibus articles.
6. **Daily Log**: The daily log is append-only. If today's log already exists, append a new section rather than overwriting. Use `---` as a separator between extraction runs. Each new section MUST start with a Level 2 header formatted as `## Session Knowledge — YYYY-MM-DD HH:mm` (using the current date and time). Before writing the daily log, run `date '+%Y-%m-%dT%H:%M:%S%z'` via bash and use that result as the `date_created` value — do NOT use `{{now}}`.
7. **Index Last**: Always rebuild `{{vaultRoot}}/knowledge/index.md` as your final step. Walk each category directory, list every article as `- [[slug]] — [one-line summary]`, and update the timestamp. Keep entries alphabetically sorted within each section.
8. **No Commentary**: When writing files with the `write` tool, the file content must start immediately with the YAML frontmatter. Do not wrap content in explanation.
