import * as path from "node:path";
import { PiMemoryConfig } from "./config.js";

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
 * Returns the current local time as ISO-8601 with timezone offset,
 * second precision: YYYY-MM-DDTHH:MM:SS±HH:MM.
 * Used for article frontmatter `date` / `last_reinforced` so intra-day
 * writes are ordered and the wall-clock time is preserved without UTC shift.
 */
export function NOW_ISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");

  const offsetMin = -d.getTimezoneOffset(); // flip sign to match ISO convention
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  const offH = String(Math.floor(absMin / 60)).padStart(2, "0");
  const offM = String(absMin % 60).padStart(2, "0");

  return `${y}-${mo}-${day}T${h}:${min}:${sec}${sign}${offH}:${offM}`;
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

