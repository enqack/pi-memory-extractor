import * as fs from "node:fs";
import * as path from "node:path";
import { PiMemoryConfig } from "./config.js";
import { parseArticle } from "./markdown.js";
import { logger } from "./logger.js";

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

const ACTIVE_CATEGORIES = [
  "concepts",
  "connections",
  "qa",
  "lessons-learned",
  "cursed-knowledge",
];

/**
 * Scan all active categories and return a list of articles that should be
 * archived, formatted as `"category/filename.md:reason"` where reason is
 * either `"faded"` (confidence ≤ 0) or `"stale"` (mtime > 6 months).
 */
export function getArticlesToArchive(
  vaultRoot: string,
  config: PiMemoryConfig,
): string[] {
  const kbDir = path.join(vaultRoot, config.knowledge);
  const toArchive: string[] = [];
  const now = Date.now();

  for (const cat of ACTIVE_CATEGORIES) {
    const catDir = path.join(kbDir, cat);
    if (!fs.existsSync(catDir)) continue;

    for (const file of fs.readdirSync(catDir).filter((f) => f.endsWith(".md"))) {
      const filePath = path.join(catDir, file);
      try {
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, "utf-8");
        const { frontmatter } = parseArticle(content);
        const confidence = frontmatter.confidence ?? 1.0;

        if (confidence <= 0) {
          toArchive.push(`${cat}/${file}:faded`);
        } else if (now - stat.mtimeMs > SIX_MONTHS_MS) {
          toArchive.push(`${cat}/${file}:stale`);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return toArchive;
}

/**
 * Move the given articles to the appropriate archive subdirectory.
 * Returns the number of files successfully archived.
 */
export function archiveArticles(
  vaultRoot: string,
  config: PiMemoryConfig,
  articles: string[],
): number {
  const kbDir = path.join(vaultRoot, config.knowledge);
  const archiveDir = path.join(kbDir, "archive");

  let count = 0;

  for (const item of articles) {
    const colonIdx = item.lastIndexOf(":");
    const relPath = colonIdx >= 0 ? item.slice(0, colonIdx) : item;
    const reason = colonIdx >= 0 ? item.slice(colonIdx + 1) : "stale";

    const srcPath = path.join(kbDir, relPath);
    const targetDir = reason === "faded"
      ? path.join(archiveDir, "faded")
      : archiveDir;

    try {
      fs.mkdirSync(targetDir, { recursive: true });
      const destPath = path.join(targetDir, path.basename(relPath));
      if (fs.existsSync(srcPath)) {
        fs.renameSync(srcPath, destPath);
        count++;
      }
    } catch (err) {
      logger.error(`Failed to archive ${relPath}: ${err}`);
    }
  }

  return count;
}
