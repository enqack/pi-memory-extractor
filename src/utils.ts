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

export interface SearchMatch {
  line: number;
  text: string;
}

export interface SearchResultFile {
  path: string;
  matches: SearchMatch[];
}

export interface SearchOptions {
  maxFiles?: number;
  maxLinesPerFile?: number;
  snippetChars?: number;
}

/**
 * Recursively walk each root directory and substring-match `query`
 * (case-insensitive) against every line of every `.md` file encountered.
 *
 * Missing root directories are skipped silently. Results are sorted by
 * match count desc, then path asc. Snippet text is trimmed and truncated
 * to `snippetChars` characters.
 */
export function searchMarkdownTree(
  rootDirs: string[],
  query: string,
  opts: SearchOptions = {},
): SearchResultFile[] {
  const maxFiles = opts.maxFiles ?? 20;
  const maxLinesPerFile = opts.maxLinesPerFile ?? 3;
  const snippetChars = opts.snippetChars ?? 200;

  const needle = query.toLowerCase();
  const results: SearchResultFile[] = [];

  const files: string[] = [];
  for (const root of rootDirs) {
    if (!fs.existsSync(root)) continue;
    walkMarkdown(root, files);
  }

  for (const filePath of files) {
    if (results.length >= maxFiles) break;

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    const matches: SearchMatch[] = [];

    for (let i = 0; i < lines.length && matches.length < maxLinesPerFile; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        let snippet = lines[i].trim();
        if (snippet.length > snippetChars) {
          snippet = snippet.slice(0, snippetChars) + "…";
        }
        matches.push({ line: i + 1, text: snippet });
      }
    }

    if (matches.length > 0) {
      results.push({ path: filePath, matches });
    }
  }

  results.sort((a, b) => {
    if (b.matches.length !== a.matches.length) return b.matches.length - a.matches.length;
    return a.path.localeCompare(b.path);
  });

  return results;
}

function walkMarkdown(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdown(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
}
