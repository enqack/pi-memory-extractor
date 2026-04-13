import * as fs from "node:fs";
import * as path from "node:path";
import { PiMemoryConfig } from "./config.js";

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Find articles in active categories that are older than the threshold.
 * Returns relative paths (category/filename).
 */
export function getArticlesToArchive(
  vaultRoot: string,
  config: PiMemoryConfig,
): string[] {
  const kbDir = path.join(vaultRoot, config.KNOWLEDGE);
  const categories = ["concepts", "connections", "qa", "lessons-learned", "cursed-knowledge"];
  const toArchive: string[] = [];
  const now = Date.now();

  for (const cat of categories) {
    const catDir = path.join(kbDir, cat);
    if (!fs.existsSync(catDir)) continue;

    const files = fs.readdirSync(catDir).filter((f) => f.endsWith(".md") && f !== "index.md");
    for (const file of files) {
      const filePath = path.join(catDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > SIX_MONTHS_MS) {
          toArchive.push(`${cat}/${file}`);
        }
      } catch {
        // Skip inaccessible files
      }
    }
  }

  return toArchive;
}

/**
 * Move specified articles to the archive directory.
 * Returns the number of files archived.
 */
export function archiveArticles(
  vaultRoot: string,
  config: PiMemoryConfig,
  articles: string[],
): number {
  const kbDir = path.join(vaultRoot, config.KNOWLEDGE);
  const archiveDir = path.join(kbDir, "archive");

  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  let count = 0;
  for (const relPath of articles) {
    const srcPath = path.join(kbDir, relPath);
    // relPath is like 'concepts/some-file.md', we want 'archive/some-file.md'
    const fileName = path.basename(relPath);
    const destPath = path.join(archiveDir, fileName);

    try {
      if (fs.existsSync(srcPath)) {
        fs.renameSync(srcPath, destPath);
        count++;
      }
    } catch (err) {
      console.error(`[Memory Archiver] Failed to archive ${relPath}:`, err);
    }
  }

  return count;
}
