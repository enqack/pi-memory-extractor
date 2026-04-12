import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
  SessionHeader,
} from "@mariozechner/pi-coding-agent";
import { parseSessionEntries, migrateSessionEntries } from "@mariozechner/pi-coding-agent";
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
 * Helper to get truncated text from a message's content parts.
 * Prevents massive string allocations for huge tool results.
 */
function getMessageTextTruncated(content: any, max: number): string {
  if (typeof content === "string") {
    return content.length > max ? content.slice(0, max) + "… [truncated]" : content;
  }
  if (Array.isArray(content)) {
    let result = "";
    for (const part of content) {
      if (part.type === "text" && typeof part.text === "string") {
        const remaining = max - result.length;
        if (part.text.length > remaining) {
          result += part.text.slice(0, remaining) + "… [truncated]";
          return result;
        }
        result += part.text;
      }
    }
    return result;
  }
  return "";
}

/**
 * Serialize the session branch to a compact, filtered transcript.
 * Includes user messages, assistant text, and condensed tool results.
 * Skips raw tool call arguments and internal extension messages.
 */
export function serializeTranscript(entries: SessionEntry[]): string {
  // Cap history processing to the last 200 entries to ensure responsiveness
  const history = entries.length > 200 ? entries.slice(-200) : entries;
  const lines: string[] = [];

  for (const entry of history) {
    if (entry.type !== "message") continue;
    const msg = entry.message;

    if (msg.role === "user") {
      // Skip extension-injected context messages (they have a customType)
      if ((msg as any).customType) continue;
      const text = getMessageTextTruncated(msg.content, 2000);
      if (text.trim()) lines.push(`USER: ${text.trim()}`);
    } else if (msg.role === "assistant") {
      const text = getMessageTextTruncated(msg.content, 2000);
      if (text.trim()) lines.push(`ASSISTANT: ${text.trim()}`);
    } else if (msg.role === "toolResult") {
      // Condense tool results to 500 chars max
      const preview = getMessageTextTruncated(msg.content, 500);
      if (preview.trim()) {
        lines.push(`TOOL(${(msg as any).toolName ?? "unknown"}): ${preview.trim()}`);
      }
    }
  }

  return lines.join("\n\n");
}

/**
 * Serialize ALL historical sessions for the current project.
 */
export async function serializeDeepTranscript(ctx: ExtensionContext): Promise<string> {
  const sessionDir = ctx.sessionManager.getSessionDir();
  let files: string[] = [];
  try {
    files = (await fsPromises.readdir(sessionDir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return ""; // No sessions found
  }

  const allTranscripts: string[] = [];

  for (const file of files) {
    const filePath = path.join(sessionDir, file);
    try {
      const content = await fsPromises.readFile(filePath, "utf-8");
      const allEntries = parseSessionEntries(content);
      migrateSessionEntries(allEntries);

      // Header is the first entry
      const header = allEntries[0] as SessionHeader;
      const sessionDate = new Date(header.timestamp).toLocaleString();

      // Filter out the header before serializing transcript
      const sessionEntries = allEntries.filter((e) => e.type !== "session") as SessionEntry[];
      const transcript = serializeTranscript(sessionEntries);

      if (transcript.trim()) {
        allTranscripts.push(`### Session ${header.id} (${sessionDate})\n\n${transcript}`);
      }
    } catch (err) {
      console.error(`[Memory Extractor] Failed to parse session ${file}: ${err}`);
      continue;
    }
  }

  return allTranscripts.join("\n\n---\n\n");
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
  const dailyLogPath = path.join(vaultRoot, config.DAILY, `${today}.md`);
  const dailyLogRelPath = path.relative(projectRoot, dailyLogPath);

  return `**CRITICAL: YOU MUST EXECUTE REAL TOOL CALLS.**
DO NOT just print text describing your plan. You MUST call the \`write\` or \`edit\` tool to update the daily log. If you do not execute the file operation, you have failed the task.

**Context:**
- Project Root: \`${projectRoot}\`
- Daily Log (Absolute): \`${dailyLogPath}\`
- Daily Log (Relative): \`${dailyLogRelPath}\`

Your job: identify and summarize what is worth remembering from this conversation and append it to the daily log at \`${dailyLogPath}\`.

**Save to the daily log if the conversation contains:**
1. **Decisions**: Design choices, changed requirements, or confirmed plans.
2. **Key Findings**: Bug root causes, successful techniques, or learned patterns.
3. **Draft Documentation**: Explanations or code snippets that should move to the vault later.
4. **Deep Thoughts**: Abstract or theoretical insights that meet these criteria: ${deepThoughtsCriteria}

**Submission Rules:**
1. **Append Only**: Use the \`edit\` or \`write\` tool to add a new section for this session. Use the ABSOLUTE path: \`${dailyLogPath}\`.
2. **Structure**: 
   ### Session Knowledge — ${today}
   - **Decisions**: ...
   - **Key Findings & Learnings**: ...
   - **Deep Thoughts**: ...
3. **No Chatting**: DO NOT just output the summary in the chat. You MUST execute the tool call to save it to \`${dailyLogPath}\`.

BEGIN by identifying the knowledge from the transcript below and then calling the \`edit\` or \`write\` tool.

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
  triggerEvent: string,
  providedTranscript?: string,
  deep?: boolean,
  state?: { isCompacting: boolean }
): Promise<void> {
  let transcript: string;
  if (providedTranscript) {
    transcript = providedTranscript;
  } else if (deep) {
    transcript = await serializeDeepTranscript(ctx);
  } else {
    transcript = serializeTranscript(ctx.sessionManager.getBranch());
  }

  if (!transcript.trim()) {
    return; // Nothing to extract
  }

  // If this is triggered by a lifecycle event (compaction/shutdown),
  // we must escape the current turn and wait for the agent to be idle
  // to avoid "Agent is already processing a prompt" errors.
  const isLifecycleEvent = triggerEvent === "pre_compact" || triggerEvent === "shutdown";
  if (isLifecycleEvent) {
    // Escape the hook's execution context
    setTimeout(async () => {
      try {
        // Defensive wait: check if native waitForIdle is available (it's only in CommandContext)
        // otherwise poll isIdle()
        if (typeof (ctx as any).waitForIdle === "function") {
          await (ctx as any).waitForIdle();
        }
        
        // Polling loop: wait while agent is streaming OR in a critical lifecycle phase (compaction)
        while (!ctx.isIdle() || state?.isCompacting) {
          await new Promise((r) => setTimeout(r, 100));
        }
        await executeExtraction(pi, ctx, vaultRoot, config, triggerEvent, transcript);
      } catch (err) {
        console.error(`[Memory Extractor] Delayed extraction failed: ${err}`);
      }
    }, 100);
    return;
  }

  await executeExtraction(pi, ctx, vaultRoot, config, triggerEvent, transcript);
}

/**
 * Internal helper to build prompt and send the message.
 */
async function executeExtraction(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  vaultRoot: string,
  config: PiMemoryConfig,
  triggerEvent: string,
  transcript: string
): Promise<void> {
  let deepThoughtsCriteria = "";
  const criteriaPath = getCriteriaPath();
  try {
    deepThoughtsCriteria = await fsPromises.readFile(criteriaPath, "utf-8");
  } catch {
    // Ignore if file doesn't exist
  }

  const prompt = buildExtractionPrompt(ctx.cwd, vaultRoot, config, transcript, deepThoughtsCriteria);

  await pi.sendUserMessage(
    `[Memory Extractor — triggered by: ${triggerEvent}]\n\n${prompt}`,
    { deliverAs: "followUp" }
  );
}
