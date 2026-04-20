import * as fs from "node:fs";
import * as path from "node:path";
import { extractSection } from "./markdown.js";

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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const wordBoundaryRe = new RegExp(
    "(?<![a-z0-9-])" + escapeRegex(needle) + "(?![a-z0-9-])",
    "i",
  );
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
      if (wordBoundaryRe.test(lines[i])) {
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
