import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";

/**
 * extractor.ts — Session knowledge extraction module.
 *
 * Reads the current session branch from ctx.sessionManager, serializes a
 * filtered transcript (assistant + tool results), builds the extraction
 * prompt, and triggers the LLM via pi.sendUserMessage().
 *
 * The agent is expected to write the daily log itself using its built-in
 * file tools. We instruct it exactly where to write and what format to use.
 *
 * No subprocess calls. No standalone CLI. Pure ExtensionAPI.
 */

const TODAY = () => new Date().toISOString().split("T")[0];

/**
 * Resolves the path to deep-thoughts-criteria.md relative to this file.
 */
function getCriteriaPath(): string {
  // Use __dirname for CJS (jiti)
  return path.join(__dirname, "deep-thoughts-criteria.md");
}

/**
 * Serialize the session branch to a compact, filtered transcript.
 * We include: user messages, assistant text messages, and tool results.
 * We skip: raw tool call arguments (too verbose) and internal extension messages.
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
        ? msg.content
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join(" ")
        : String(msg.content);
      if (text.trim()) lines.push(`USER: ${text.trim()}`);
    } else if (msg.role === "assistant") {
      const text = Array.isArray(msg.content)
        ? msg.content
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join(" ")
        : String(msg.content);
      if (text.trim()) lines.push(`ASSISTANT: ${text.trim()}`);
    } else if (msg.role === "toolResult") {
      // Include a condensed view of tool results (first 300 chars)
      const resultText = Array.isArray(msg.content)
        ? msg.content
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join(" ")
        : String(msg.content ?? "");
      const preview = resultText.length > 300
        ? resultText.slice(0, 300) + "… [truncated]"
        : resultText;
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
  vaultRoot: string,
  transcript: string,
  deepThoughtsCriteria: string
): string {
  const today = TODAY();
  const dailyLogPath = path.join(vaultRoot, "logs", "daily", `${today}.md`);

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
\`${dailyLogPath}\`

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
 * Serializes the transcript, builds the prompt, and sends it to the LLM
 * via pi.sendUserMessage() so the running agent handles the write.
 */
export async function runExtraction(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  vaultRoot: string,
  triggerEvent: string
): Promise<void> {
  const transcript = serializeTranscript(ctx);

  if (!transcript.trim()) {
    return; // Nothing to extract
  }

  // Load Deep Thoughts criteria if available
  let deepThoughtsCriteria = "";
  const criteriaPath = getCriteriaPath();
  if (fs.existsSync(criteriaPath)) {
    deepThoughtsCriteria = fs.readFileSync(criteriaPath, "utf-8");
  }

  const prompt = buildExtractionPrompt(vaultRoot, transcript, deepThoughtsCriteria);

  // Trigger the LLM in the current session to run the extraction.
  // deliverAs: "steer" queues after the current turn's tool calls finish.
  // deliverAs: "followUp" waits for agent to fully finish.
  // We use followUp to avoid competing with any active tool calls.
  try {
    pi.sendUserMessage(
      `[Memory Extractor — triggered by: ${triggerEvent}]\n\n${prompt}`,
      { deliverAs: "followUp" }
    );
  } catch {
    // If agent is not streaming, sendUserMessage with no deliverAs option
    // triggers immediately. The overload handles this gracefully.
    pi.sendUserMessage(
      `[Memory Extractor — triggered by: ${triggerEvent}]\n\n${prompt}`
    );
  }
}
