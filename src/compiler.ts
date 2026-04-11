import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { PiMemoryConfig } from "./config.js";

/**
 * compiler.ts — Knowledge base compilation module.
 * Builds the compilation prompt and triggers the LLM via pi.sendUserMessage().
 */

/**
 * Parses knowledge/log.md to find which daily logs have already been compiled.
 */
function getCompiledSources(vaultRoot: string, config: PiMemoryConfig): Set<string> {
  const logPath = path.join(vaultRoot, config.KNOWLEDGE, "log.md");
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
function buildCompilationPrompt(
  projectRoot: string,
  vaultRoot: string,
  config: PiMemoryConfig,
  dailyLogs: string[]
): string {
  const getRel = (p: string) => path.relative(projectRoot, path.join(vaultRoot, p));

  const relDaily = getRel(config.DAILY);
  const relKnowledge = getRel(config.KNOWLEDGE);
  const logList = dailyLogs.map((l) => `- ${relDaily}/${l}`).join("\n");

  return `You are a knowledge base compiler for the project vault.

**Your task:** Process the daily session logs listed below and update the knowledge base at \`${relKnowledge}/\`.

**Knowledge Base Schema & Article Types:**

### 1. Concept Article (\`${relKnowledge}/concepts/<slug>.md\`)
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

### 2. Connection Article (\`${relKnowledge}/connections/<slug>.md\`)
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

### 3. Q&A Article (\`${relKnowledge}/qa/<slug>.md\`)
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
Maintain a visual representation of connections in \`${relKnowledge}/connections/graph.mmd\`.
- **Syntax**: Mermaid \`graph TD\`
- **Content**: Use nodes for concept slugs and edges to represent relationships.
- **Update Rule**: Re-generate or update this file every compilation run.

### 5. Archiving Stale Knowledge
- **Threshold**: **6 months** (based on frontmatter \`date\`).
- **Logic**: If an article is older than 6 months and describes a temporary workflow or superseded version, move it to \`${relKnowledge}/archive/\`.
- **Reference**: Update all indexes to reflect the move. Do NOT delete the article.

**Compilation Rules:**
1. **Deduplication**: Update existing articles rather than creating duplicates.
2. **Substance**: Focus on decisions, techniques, hardware behaviors, theory, and project context.
3. **Standards**: Every article needs at least 200 words and 2 [[wikilinks]].
4. **Log**: Always append a compilation entry to \`${relKnowledge}/log.md\` in this format:
   \`\`\`
   ## YYYY-MM-DD HH:MM — Compilation Run
   - Source: ${relDaily}/YYYY-MM-DD.md
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
 */
export async function runCompilation(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  vaultRoot: string,
  config: PiMemoryConfig,
  force: boolean = false
): Promise<void> {
  const dailyDir = path.join(vaultRoot, config.DAILY);

  if (!fs.existsSync(dailyDir)) {
    ctx.ui.notify("[Memory Compiler] No daily logs directory found — nothing to compile.", "info");
    return;
  }

  let logs = fs.readdirSync(dailyDir).filter((f) => f.endsWith(".md"));

  if (logs.length === 0) {
    ctx.ui.notify("[Memory Compiler] No daily logs found — nothing to compile.", "info");
    return;
  }

  logs.sort();

  if (!force) {
    const alreadyCompiled = getCompiledSources(vaultRoot, config);
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

  const prompt = buildCompilationPrompt(ctx.cwd, vaultRoot, config, logs);

  ctx.ui.notify(`[Memory Compiler] Triggering compilation of ${logs.length} daily log(s)…`, "info");

  pi.sendUserMessage(`[Memory Compiler]\n\n${prompt}`, { deliverAs: "followUp" });
}
