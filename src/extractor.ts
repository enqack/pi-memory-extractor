import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Value } from "@sinclair/typebox/value";
import { PiMemoryConfig } from "./config.js";
import { SessionEntrySchema, SessionEntry, SessionHeader } from "./schema.js";
import { toLocalIso } from "./utils.js";
import { logger } from "./logger.js";

/**
* Parse a session .jsonl file into validated entry objects.
* Entries that fail TypeBox validation are silently skipped.
*/
export function parseSessionEntries(content: string): SessionEntry[] {
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        const json = JSON.parse(line);
        if (Value.Check(SessionEntrySchema, json)) return json as SessionEntry;
        logger.warn(`Invalid session entry skipped: ${line.substring(0, 80)}…`);
        return null;
      } catch {
        return null;
      }
    })
    .filter((e): e is SessionEntry => e !== null);
}

/**
* Truncate a message content value to `max` characters, respecting an
* optional `maxParts` limit on content-array parts.
*/
function truncateContent(content: any, max: number, maxParts: number): string {
  if (typeof content === "string") {
    return content.length > max ? content.slice(0, max) + "… [truncated]" : content;
  }
  if (Array.isArray(content)) {
    let result =
      "";
    let parts = 0;
    for (const part of content) {
      if (part.type === "text" && typeof part.text === "string") {
        if (parts >= maxParts) break;
        const remaining = max - result.length;
        if (part.text.length > remaining) {
          result += part.text.slice(0, remaining) + "… [truncated]";
          return result;
        }
        result += part.text;
        parts++;
      }
    }
    return result;
  }
  return "";
}

/**
* Serialize a list of session entries into a compact transcript string,
* applying per-message and global character budgets.
*/
export function serializeTranscript(entries: SessionEntry[], config: PiMemoryConfig): string {
  const history =
    entries.length > config.maxHistoryMessages
      ? entries.slice(-config.maxHistoryMessages)
      : entries;

  const lines: string[] = [];

  for (const entry of history) {
    if (entry.type !== "message") continue;
    const msg = (entry as any).message;

    if (msg.role === "user") {
      if (msg.customType) continue; // skip injected context messages
      const text = truncateContent(msg.content, config.maxMessageChars, config.maxPartsPerMessage);
      if (text.trim()) lines.push(`USER: ${text.trim()}`);
    } else if (msg.role === "assistant") {
      const text = truncateContent(msg.content, config.maxMessageChars, config.maxPartsPerMessage);
      if (text.trim()) lines.push(`ASSISTANT: ${text.trim()}`);
    } else if (msg.role === "toolResult") {
      // Check for toolResult. Note: type check is better but this is a quick fix for the snippet.
      const preview = truncateContent(msg.content, config.maxToolResultChars, config.maxPartsPerMessage);
      if (preview.trim()) {
        lines.push(`TOOL(${msg.toolName ?? "unknown"}): ${preview.trim()}`);
      }
    }
  }

  const result = lines.join("\n\n");

  if (result.length > config.globalMaxChars) {
    return result.slice(0, config.globalMaxChars) + "\n\n… [Transcript truncated for size]";
  }

  return result;
}

/**
* Serialize the current session branch with relaxed limits suitable for the
* extraction subprocess (which has its own fresh context window).
*
* Per the spec:
* - maxHistoryMessages × 20 (≥ 1000)
* - maxMessageChars × 5
* - maxToolResultChars × 5
* - global cap = config.subprocessMaxChars
*/
export function serializeSubprocessTranscript(
  entries: SessionEntry[],
  config: PiMemoryConfig,
): string {
  const body = serializeTranscript(entries, {
    ...config,
    maxHistoryMessages: Math.max(config.maxHistoryMessages * 20, 1000),
    maxMessageChars: config.maxMessageChars * 5,
    maxToolResultChars: config.maxToolResultChars * 5,
    globalMaxChars: config.subprocessMaxChars,
  });

  const sessionHeader = entries.find((e) => e.type === "session") as SessionHeader | undefined;
  if (!sessionHeader || !body.trim()) return body;

  const localIso = toLocalIso(new Date(sessionHeader.timestamp));
  return `### Session ${sessionHeader.id} — ${localIso}\n\n${body}`;
}


/**
* A single date's worth of sessions serialized into one transcript.
*/
export interface DateBatch {
  /** Calendar date in YYYY-MM-DD (local time). */
  date: string;
  /** Serialized transcript bounded by subprocessMaxChars. */
  transcript: string;
}

/**
* Group sessions by their local calendar date and serialize each group into a
* transcript bounded by `subprocessMaxChars`. Returns batches sorted
* chronologically (oldest first).
*
* @param totalCharBudget - When set, sessions are selected newest-first until
*   the cumulative transcript length exceeds this limit (matching `--deep`
*   scoping). The selected sessions are then grouped by date. When omitted,
*   all sessions are included (`--all` behaviour).
* @param from - Start date (YYYY-MM-DD).
* @param to - End date (YYYY-MM-DD).
*/
export async function groupSessionsByDate(
  ctx: ExtensionContext,
  config: PiMemoryConfig,
  { totalCharBudget, from, to }: { 
    totalCharBudget?: number; 
    from?: string; 
    to?: string 
  } = {},
): Promise<DateBatch[]> {
  const sessionDir = ctx.sessionManager.getSessionDir();
  let files: string[];

  try {
    files = (await fsPromises.readdir(sessionDir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }

  // When a budget is set we need mtime for newest-first selection.
  interface ParsedSession {
    header: SessionHeader;
    chunk: string;
    mtime: number;
  }
  const sessions: ParsedSession[] = [];

  for (const file of files) {
    const filePath = path.join(sessionDir, file);
    try {
      const content = await fsPromises.readFile(filePath, "utf-8");
      const entries = parseSessionEntries(content);
      if (
        entries.length === 0 ||
        entries[0].type !== "session"
      )
        continue;

      const header = entries[0] as SessionHeader;
      const msgEntries = entries.filter(
        (e) => e.type !== "session",
      ) as SessionEntry[];
      const transcript = serializeTranscript(msgEntries, config);
      if (!transcript.toString().trim()) continue;

      const ts = new Date(header.timestamp);
      if (isNaN(ts.getTime())) {
        logger.warn(
          `Skipping session ${header.id}: invalid timestamp "${header.timestamp}".`,
        );
        continue;
      }
      const chunk = `### Session ${header.id} — ${toLocalIso(ts)}\n\n${transcript}`;

      const mtime = totalCharBudget !== undefined
        ? (await fsPromises.stat(filePath)).mtimeMs
        : 0;

      sessions.push({ header, chunk, mtime });
    } catch (err) {
      logger.error(`Failed to parse session file ${file}: ${err}`);
    }
  }

  // Filter by date range [from, to]
  let filtered = sessions;
  if (from) {
    const startDate = new Date(from);
    filtered = filtered.filter((s) => new Date(s.header.timestamp) >= startDate);
  }
  if (to) {
    const endDate = new Date(to);
    endDate.setHours(23, 59, 59, 999);
    filtered = filtered.filter((s) => new Date(s.header.timestamp) <= endDate);
  }

  // When a budget is given, select sessions newest-first until it is exhausted.
  let selected: ParsedSession[];
  if (totalCharBudget !== undefined) {
    filtered.sort((a, b) => b.mtime - a.mtime);
    let total = 0;
    selected = [];
    for (const s of filtered) {
      if (total + s.chunk.length > totalCharBudget) {
        logger.info(
          `Deep extract reached budget (${totalCharBudget} chars). ` +
            `Skipping ${filtered.length - selected.length} older session(s).`,
        );
        break;
      }
      selected.push(s);
      total += s.chunk.length;
    }
  } else {
    selected = filtered;
  }

  // Group selected sessions by local-int calendar date.
  const byDate = new Map<string, string[]>();
  for (const { header, chunk } of selected) {
    const ts = new Date(header.timestamp);
    if (isNaN(ts.getTime())) {
      logger.warn(
        `Skipping session ${header.id} in date grouping: invalid timestamp.`,
      );
      continue;
    }
    const y = ts.getFullYear();
    const m = String(ts.getMonth() + 1).padStart(2, "0");
    const d = String(ts.getDate()).padStart(2, "0");
    const date = `${y}-${m}-${d}`;

    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(chunk);
  }

  // Sort dates chronologically, then join each day's chunks up to the budget
  const batches: DateBatch[] = [];

  for (const date of [...byDate.keys()].sort()) {
    const chunks = byDate.get(date)!;
    let combined = "";
    let truncated = false;
    let includedCount = 0;

    for (const chunk of chunks) {
      const separator = combined ? "\n\n---\n\n" : "";
      if (
        combined.length +
        separator.length +
        chunk.length >
        config.subprocessMaxChars
      ) {
        logger.info(
          `Date ${date}: subprocess budget reached; ${
            chunks.length - includedCount
          } session(s) omitted.`,
        );
        truncated = true;
        break;
      }
      combined += separator + chunk;
      includedCount++;
    }

    if (truncated) {
      combined +=
        "\n\n---\n\n*Truncated: subprocess budget reached; some sessions for this day omitted.*";
    }

    if (combined.trim()) {
      batches.push({ date, transcript: combined });
    }
  }

  return batches;
}
