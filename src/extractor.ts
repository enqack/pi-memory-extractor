import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
  SessionHeader,
} from "@mariozechner/pi-coding-agent";
import { PiMemoryConfig } from "./config.js";
import { TODAY } from "./utils.js";
import { renderTemplate } from "./templates.js";

/**
 * Extraction limits to keep the context window stable.
 */
export const EXTRACTION_LIMITS = {
  MAX_HISTORY_MESSAGES: 50,
  MAX_MESSAGE_CHARS: 1000,
  MAX_TOOL_RESULT_CHARS: 200,
  MAX_PARTS_PER_MESSAGE: 15,
  GLOBAL_MAX_CHARS: 25000,
};

/**
 * Parses a session .jsonl file into an array of entries.
 */
export function parseSessionEntries(content: string): any[] {
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    })
    .filter((e) => e !== null);
}

/**
 * Simple migration helper to ensure old session entries remain compatible.
 */
export function migrateSessionEntries(entries: any[]): void {
  // No-op for modern ExtensionAPI sessions
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
    let partsCount = 0;
    for (const part of content) {
      if (part.type === "text" && typeof part.text === "string") {
        if (partsCount >= EXTRACTION_LIMITS.MAX_PARTS_PER_MESSAGE) break;

        const remaining = max - result.length;
        if (part.text.length > remaining) {
          result += part.text.slice(0, remaining) + "… [truncated]";
          return result;
        }
        result += part.text;
        partsCount++;
      }
    }
    return result;
  }
  return "";
}

/**
 * Serialize the session branch to a compact, filtered transcript.
 * Strict limits are applied to prevent recursive compaction loops.
 */
export function serializeTranscript(entries: SessionEntry[]): string {
  // Strict Limit: Only the last N messages to keep context window clean
  const history = entries.length > EXTRACTION_LIMITS.MAX_HISTORY_MESSAGES
    ? entries.slice(-EXTRACTION_LIMITS.MAX_HISTORY_MESSAGES)
    : entries;
  const lines: string[] = [];

  for (const entry of history) {
    if (entry.type !== "message") continue;
    const msg = entry.message;

    if (msg.role === "user") {
      if ((msg as any).customType) continue;
      // Strict Limit: user messages
      const text = getMessageTextTruncated(msg.content, EXTRACTION_LIMITS.MAX_MESSAGE_CHARS);
      if (text.trim()) lines.push(`USER: ${text.trim()}`);
    } else if (msg.role === "assistant") {
      // Strict Limit: assistant messages
      const text = getMessageTextTruncated(msg.content, EXTRACTION_LIMITS.MAX_MESSAGE_CHARS);
      if (text.trim()) lines.push(`ASSISTANT: ${text.trim()}`);
    } else if (msg.role === "toolResult") {
      // Tool results limit
      const preview = getMessageTextTruncated(msg.content, EXTRACTION_LIMITS.MAX_TOOL_RESULT_CHARS);
      if (preview.trim()) {
        lines.push(`TOOL(${(msg as any).toolName ?? "unknown"}): ${preview.trim()}`);
      }
    }
  }

  const result = lines.join("\n\n");

  // Final safety cap: truncate entire transcript if it exceeds the global safe budget
  if (result.length > EXTRACTION_LIMITS.GLOBAL_MAX_CHARS) {
    return result.slice(0, EXTRACTION_LIMITS.GLOBAL_MAX_CHARS) + "\n\n... [Transcript truncated for size stability] ...";
  }

  return result;
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
    return "";
  }

  const allTranscripts: string[] = [];

  for (const file of files) {
    const filePath = path.join(sessionDir, file);
    try {
      const content = await fsPromises.readFile(filePath, "utf-8");
      const allEntries = parseSessionEntries(content);
      migrateSessionEntries(allEntries);

      const header = allEntries[0] as SessionHeader;
      const sessionDate = new Date(header.timestamp).toLocaleString();
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