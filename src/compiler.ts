import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

/**
 * compiler.ts — Knowledge base compilation module.
 *
 * Lists available daily logs and triggers the LLM via pi.sendUserMessage()
 * to compile them into structured knowledge articles under knowledge/.
 *
 * The agent is responsible for reading, creating, and updating the knowledge
 * articles using its built-in file tools. This module just builds the prompt
 * and delivers it.
 *
 *
 * No subprocess calls. No standalone CLI. Pure ExtensionAPI.
 */

/**
 * Configuration for directory names relative to the vault root.
 */
const RELATIVE_PATHS = {
  VAULT_ROOT: "knowledge-base",
  DAILY: "daily",
  KNOWLEDGE: "knowledge",
  DEEP_THOUGHTS: "deep-thoughts",
  REPORTS: "reports",
};

/**
 * Parses logs/knowledge/log.md to determine which daily logs have already
 * been successfully compiled into the knowledge base.
 */
function getCompiledSources(vaultRoot: string): Set<string> {
  const logPath = path.join(vaultRoot, RELATIVE_PATHS.KNOWLEDGE, "log.md");
  const compiled = new Set<string>();

  if (!fs.existsSync(logPath)) return compiled;

  const content = fs.readFileSync(logPath, "utf-8");
  // Match lines like "- Source: daily/2026-04-09.md" or "- Sources: daily/A.md, daily/B.md"
  const sourceLines = content.matchAll(/^- Sources?: (.*)$/gm);

  for (const match of sourceLines) {
    const rawPaths = match[1].split(",");
    for (const raw of rawPaths) {
      const fileName = path.basename(raw.trim());
      if (fileName.endsWith(".md")) {
        compiled.add(fileName);
      }
    }
  }

  return compiled;
}

/**
 * Build the compilation prompt for the LLM.
 */
function buildCompilationPrompt(vaultRoot: string, dailyLogs: string[]): string {
  const logList = dailyLogs.map((l) => `- ${RELATIVE_PATHS.DAILY}/${l}`).join("\n");

  return `You are a knowledge base compiler for the project vault.

**Your task:** Process the daily session logs listed below and update the knowledge base at \`${RELATIVE_PATHS.KNOWLEDGE}/\`.

**Knowledge Base Schema & Article Types:**

### 1. Concept Article (\`${RELATIVE_PATHS.KNOWLEDGE}/concepts/<slug>.md\`)
A concept article covers one topic thoroughly (techniques, devices, theory, workflow, or project decisions).
- **Frontmatter**:
\`\`\`yaml
---
title: "Human-readable title"
type: concept
category: technique | device | theory | workflow | project
tags: []
date: "YYYY-MM-DD"
sources: []          # list of session dates or daily log refs that contributed
wikilinks: []        # other articles this one links to
---
\`\`\`
- **Body Structure** (required sections in order):
  1. **Summary** — one-paragraph overview (2–4 sentences)
  2. **Key Points** — 3–5 bullet points of the most important facts
  3. **Details** — 2+ paragraphs of full explanation
  4. **Connections** — [[wikilinks]] to related articles (minimum 2)
  5. **Sources** — list of session dates that contributed this knowledge

### 2. Connection Article (\`${RELATIVE_PATHS.KNOWLEDGE}/connections/<slug>.md\`)
Documents how two or more concepts relate or interact.
- **Frontmatter**:
\`\`\`yaml
---
title: "ConceptA + ConceptB"
type: connection
concepts: []         # list of concept slugs being connected
tags: []
date: "YYYY-MM-DD"
sources: []
---
\`\`\`
- **Body Structure**:
  1. **Relationship** — one paragraph describing how the concepts connect
  2. **Details** — 2+ paragraphs explaining the interaction in depth
  3. **Practical Implications** — how this connection affects production decisions
  4. **See Also** — [[wikilinks]] to the parent concept articles

### 3. Q&A Article (\`${RELATIVE_PATHS.KNOWLEDGE}/qa/<slug>.md\`)
Captures explicit questions and answers from sessions.
- **Frontmatter**:
\`\`\`yaml
---
title: "Question as title"
type: qa
tags: []
date: "YYYY-MM-DD"
sources: []
---
\`\`\`
- **Body Structure**:
  1. **Question** — the exact question asked
  2. **Answer** — full answer with supporting detail
  3. **Related** — [[wikilinks]] to relevant concept articles

### 4. Mermaid Knowledge Graph
Maintain a visual representation of connections in \`${RELATIVE_PATHS.KNOWLEDGE}/connections/graph.mmd\`.
- **Syntax**: Mermaid \`graph TD\`
- **Content**: Use nodes for concept slugs and edges to represent relationships (e.g., \`[[slug1]] --> [[slug2]]\`).
- **Update Rule**: Re-generate or update this file every time a compilation run occurs by scanning existing articles and wikilinks.

### 5. Archiving Stale Knowledge
- **Threshold**: **6 months** (based on frontmatter \`date\`).
- **Logic**: If an article is older than 6 months and describes a temporary workflow, old debug session, or superseded version, move it from its category folder to \`${RELATIVE_PATHS.KNOWLEDGE}/archive/\`.
- **Reference**: Update all indexes to reflect the move. Do NOT delete the article; just move it.

**Compilation Rules:**
1. **Deduplication**: If an existing article covers the knowledge, update it with new detail rather than creating a duplicate.
2. **Substance**: Focus on decisions made, techniques learned, hardware behaviors discovered, theory applied, and project context.
3. **Standards**: Every article needs at least 200 words and 2 [[wikilinks]] to other articles.
4. **Log**: Always append a compilation entry to \`${RELATIVE_PATHS.KNOWLEDGE}/log.md\` in this format:
   \`\`\`
   ## YYYY-MM-DD HH:MM — Compilation Run
   - Source: ${RELATIVE_PATHS.DAILY}/YYYY-MM-DD.md
   - Created: [list of new article slugs, or "none"]
   - Updated: [list of updated article slugs, or "none"]
   - Archived: [list of archived article slugs, or "none"]
   - Skipped: [reason if nothing was saved]
   \`\`\`

**Daily logs to process:**
${logList}

Use the Read, Write, Edit, Grep, and Find tools as needed to complete this task.`;
}

/**
 * Main compilation entry point.
 * Lists daily logs and sends the compilation prompt to the LLM via
 * pi.sendUserMessage() so the running agent handles all file operations.
 */
export async function runCompilation(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  vaultRoot: string,
  force: boolean = false
): Promise<void> {
  const dailyDir = path.join(vaultRoot, RELATIVE_PATHS.DAILY);

  if (!fs.existsSync(dailyDir)) {
    ctx.ui.notify("[Memory Compiler] No daily logs directory found — nothing to compile.", "info");
    return;
  }

  let logs = fs.readdirSync(dailyDir).filter((f) => f.endsWith(".md"));

  if (logs.length === 0) {
    ctx.ui.notify("[Memory Compiler] No daily logs found — nothing to compile.", "info");
    return;
  }

  logs.sort(); // Chronological order

  // Incremental filtering
  if (!force) {
    const alreadyCompiled = getCompiledSources(vaultRoot);
    const filteredLogs = logs.filter((l) => !alreadyCompiled.has(l));

    if (filteredLogs.length === 0) {
      ctx.ui.notify(
        `[Memory Compiler] All ${logs.length} logs are already compiled. Use --force to re-process.`,
        "info"
      );
      return;
    }

    if (filteredLogs.length < logs.length) {
      ctx.ui.notify(
        `[Memory Compiler] Skipping ${logs.length - filteredLogs.length} already-compiled logs.`,
        "info"
      );
    }
    logs = filteredLogs;
  } else {
    ctx.ui.notify(`[Memory Compiler] Force mode: Processing all ${logs.length} logs.`, "info");
  }

  const prompt = buildCompilationPrompt(vaultRoot, logs);

  ctx.ui.notify(
    `[Memory Compiler] Triggering compilation of ${logs.length} daily log(s)…`,
    "info"
  );

  // deliverAs: "followUp" — waits for agent to fully finish any current task
  // before delivering this prompt.
  pi.sendUserMessage(
    `[Memory Compiler]\n\n${prompt}`,
    { deliverAs: "followUp" }
  );
}
