import * as fs from "node:fs";
import * as path from "node:path";
import { PiMemoryConfig } from "./config.js";
import { extractSection } from "./markdown.js";

/**
 * Returns today's date in the system's local timezone as YYYY-MM-DD.
 */
export function TODAY(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Format a Date as a local-time ISO string truncated to the minute: YYYY-MM-DDTHH:MM.
 * Used for session header lines in transcripts so the extraction agent can derive
 * accurate deep thought filenames without timezone conversion.
 */
export function toLocalIso(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${min}`;
}

/**
 * Returns the current local time as HH:MM.
 */
export function NOW_TIME(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

/**
 * Resolves the absolute path to the vault root based on config.vaultRoot
 * relative to the project's working directory.
 */
export function findVaultRoot(cwd: string, config: PiMemoryConfig): string {
  return path.resolve(cwd, config.vaultRoot);
}

const STOP_WORDS = new Set([
  "this", "that", "with", "from", "your", "have", "been",
  "into", "their", "there", "which", "about", "could", "would",
  "should", "using", "these", "those",
]);

/**
 * Extract unique lowercase keywords from a string for index matching.
 */
export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

/**
 * Read a knowledge article and return the text of its "Summary" section,
 * or null if the file doesn't exist or has no Summary section.
 */
export function getArticleSummary(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    return extractSection(content, "Summary");
  } catch {
    return null;
  }
}
