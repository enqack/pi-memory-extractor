import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { PiMemoryConfig } from "./config.js";
import { TODAY } from "./utils.js";

/**
 * extractor.ts — Session knowledge extraction module.
 * Serializes the session transcript and triggers the LLM via pi.sendUserMessage().
 */

/**
 * Resolves the path to deep-thoughts-criteria.md relative to this file.
 */
function getCriteriaPath(): string {
  // Use __dirname for CJS (jiti)
  return path.join(__dirname, "deep-thoughts-criteria.md");
}

/**
 * Serialize the session branch to a compact, filtered transcript.
 * Includes user messages, assistant text, and condensed tool results.
 * Skips raw tool call arguments and internal extension messages.
 */
function serializeTranscript(ctx: ExtensionContext): string {
  const entries = ctx.sessionManager.getBranch();
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message;

    if (msg.role === "user") {
      // Skip extension-injected context messages (they have a customType)
      if ((msg as any).customType) continue;
      const text = Array.isArray(msg.content)
        ? msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ")
        : String(msg.content);
      if (text.trim()) lines.push(`USER: ${text.trim()}`);
    } else if (msg.role === "assistant") {
      const text = Array.isArray(msg.content)
        ? msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ")
        : String(msg.content);
      if (text.trim()) lines.push(`ASSISTANT: ${text.trim()}`);
    } else if (msg.role === "toolResult") {
      // Condense tool results to first 300 chars
      const resultText = Array.isArray(msg.content)
        ? msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ")
        : String(msg.content ?? "");
      const preview = resultText.length > 300 ? resultText.slice(0, 300) + "… [truncated]" : resultText;
      if (preview.trim()) {
        lines.push(`TOOL(${(msg as any).toolName ?? "unknown"}): ${preview.trim()}`);
      }
    }
  }

  return lines.join("\n\n");
}

/**
 * Build the extraction prompt for the LLM.
 */
function buildExtractionPrompt(
  projectRoot: string,
  vaultRoot: string,
  config: PiMemoryConfig,
  transcript: string,
  deepThoughtsCriteria: string
): string {
  const today = TODAY();
  const dailyLogRelPath = path.relative(projectRoot, path.join(vaultRoot, config.DAILY, `${today}.md`));

  return `You are a knowledge extractor reviewing a Pi agent session transcript.

Your job: identify and summarize what is worth remembering from this conversation for future sessions.

**Save to the daily log if the conversation contains:**
- Important decisions, discoveries, or context changes
- Significant technical findings, hardware behaviors discovered, or theory applied
- Workflow improvements or production techniques learned
- Key information that would be useful for future sessions of this project

**Skip entirely if the conversation only contains:**
- Routine file reads with no decisions
- Simple back-and-forth clarifications
- Tool calls that produced no new knowledge
- Trivial exchanges (greetings, formatting fixes)

**Output format:**
If there is nothing worth saving, respond with exactly: FLUSH_OK

Otherwise, respond with a structured markdown summary and **immediately append it** to the file at:
\`${dailyLogRelPath}\`

Use the Write or Edit tool to append. If the file does not exist, create it. If it already has content, add a separator \`---\` before your new entry.

The summary format to append:

## Session Knowledge — ${today}

### Decisions
- (bullet list of decisions made, or omit section if none)

### Key Findings & Learnings
- (bullet list of discoveries or technical learnings, or omit section if none)

### Workflow & Project Context
- (notes on project progress or context changes, or omit section if none)

### Context
(1–2 sentences summarizing what this session was about)

${deepThoughtsCriteria ? `---\n\n${deepThoughtsCriteria}` : ""}

---

Here is the conversation transcript:

${transcript}`;
}

/**
 * Main extraction entry point.
 */
export async function runExtraction(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  vaultRoot: string,
  config: PiMemoryConfig,
  triggerEvent: string
): Promise<void> {
  const transcript = serializeTranscript(ctx);

  if (!transcript.trim()) {
    return; // Nothing to extract
  }

  let deepThoughtsCriteria = "";
  const criteriaPath = getCriteriaPath();
  if (fs.existsSync(criteriaPath)) {
    deepThoughtsCriteria = fs.readFileSync(criteriaPath, "utf-8");
  }

  const prompt = buildExtractionPrompt(ctx.cwd, vaultRoot, config, transcript, deepThoughtsCriteria);

  pi.sendUserMessage(
    `[Memory Extractor — triggered by: ${triggerEvent}]\n\n${prompt}`,
    { deliverAs: "followUp" }
  );
}
