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
  const absKnowledge = path.join(vaultRoot, config.KNOWLEDGE);

  const relDaily = getRel(config.DAILY);
  const relKnowledge = getRel(config.KNOWLEDGE);
  const logList = dailyLogs.map((l) => `- ${relDaily}/${l}`).join("\n");  return `**CRITICAL: YOU MUST EXECUTE REAL TOOL CALLS.**
DO NOT just print text describing your plan. You MUST call the \`read\`, \`write\`, \`edit\`, \`ls\`, and \`grep\` tools to complete this task. If you do not execute at least one \`write\` or \`edit\` tool call, you have failed.

**Your Goal:** Process the daily session logs listed below and update the knowledge base at \`${relKnowledge}/\`.

**Context:**
- Project Root: \`${projectRoot}\`
- Knowledge Base (Absolute): \`${absKnowledge}\`
- Knowledge Base (Relative): \`${relKnowledge}/\`

**Daily logs to process:**
${logList}

**Execution Rules:**
1. **Real Tool Calls Only**: Every file creation or update MUST be done via the \`write\` or \`edit\` tools.
2. **Sequential Processing**: 
   - First, \`read\` the daily logs.
   - Second, use \`ls\` and \`grep\` on \`${relKnowledge}/concepts/\` to check for existing articles.
   - Third, use \`write\` or \`edit\` to save your findings.
3. **Log Run**: Always append a compilation entry to \`${absKnowledge}/log.md\` (use the absolute path).

**Article Schemas:**

### 1. Concept Article (\`${absKnowledge}/concepts/<slug>.md\`)
- **Frontmatter**: title, type (concept), category, tags, date, sources, wikilinks.
- **Structure**: Summary, Key Points, Details, Connections ([[wikilinks]]), Sources.

### 2. Connection Article (\`${absKnowledge}/connections/<slug>.md\`)
- **Frontmatter**: title, type (connection), concepts, tags, date, sources.
- **Structure**: Relationship, Details, Practical Implications, See Also.

### 3. Q&A Article (\`${absKnowledge}/qa/<slug>.md\`)
- **Frontmatter**: title, type (qa), tags, date, sources.
- **Structure**: Question, Answer, Related.

### 4. Mermaid Graph
- Update \`${absKnowledge}/connections/graph.mmd\` with any new relationships.

### 5. Compaction Log Format (\`${absKnowledge}/log.md\`)
\`\`\`
## YYYY-MM-DD HH:MM — Compilation Run
- Source: [daily log path]
- Created: [article slugs]
- Updated: [article slugs]
- Archived: [article slugs]
- Skipped: [reason]
\`\`\`

**Standard**: Every article needs 200+ words and 2+ wikilinks.

BEGIN by calling the \`read\` tool for the daily logs.`;
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

  // Use a delayed execution pattern to ensure the message is sent after the current turn ends.
  // Polling is used to wait for the agent to be idle.
  setTimeout(async () => {
    try {
      // Wait for agent to be idle (escape current command/tool turn)
      while (!ctx.isIdle()) {
        await new Promise((r) => setTimeout(r, 100));
      }

      await pi.sendUserMessage(`[Memory Compiler]\n\n${prompt}`, { deliverAs: "followUp" });
    } catch (err) {
      console.error(`[Memory Compiler] Failed to trigger follow-up: ${err}`);
      ctx.ui.notify("[Memory Compiler] Failed to trigger follow-up turn.", "error");
    }
  }, 100);
}
