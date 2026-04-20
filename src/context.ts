import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { PiMemoryConfig } from "./config.js";
import { TODAY, extractKeywords } from "./utils.js";
import { getArticleSummary } from "./search.js";
import { logger } from "./logger.js";

export async function buildSessionContext(
  vaultRoot: string,
  config: PiMemoryConfig,
  ctx: ExtensionContext,
): Promise<string | null> {
  const indexPath = path.join(vaultRoot, config.knowledge, "index.md");
  const todayLogPath = path.join(vaultRoot, config.daily, `${TODAY()}.md`);
  const kbDir = path.join(vaultRoot, config.knowledge);
  const parts: string[] = [];

  // 1. Knowledge Index (truncated for large indexes)
  try {
    const content = await fsPromises.readFile(indexPath, "utf-8");
    const lines = content.trim().split("\n");
    const displayLines =
      lines.length > 50
        ? [
            ...lines.slice(0, 5),
            "...",
            "... [truncated] ...",
            "...",
            ...lines.slice(-15),
          ]
        : lines;

    parts.push(
      `## Knowledge Base Index\n${displayLines.join("\n")}\n\n---\n` +
        `Use \`search_index\` for a fast index lookup, \`search_articles\` to full-text search the knowledge articles, or \`search_knowledge\` to search the whole vault (articles + daily logs + deep thoughts). Use \`read_knowledge_article(slug)\` to read a full article.`,
    );
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") {
      logger.warn(`Could not read knowledge index: ${e.message}`, ctx, true);
    }
  }

  // 2. Today's daily log
  try {
    const content = await fsPromises.readFile(todayLogPath, "utf-8");
    if (content.trim()) {
      parts.push(`## Today's Session Log (${TODAY()})\n\n${content.trim()}`);
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") {
      logger.warn(`Could not read daily log: ${e.message}`, ctx, true);
    }
  }

  // 3. Smart recall — inject summaries of the top 3 keyword-matching articles
  try {
    const branch = ctx.sessionManager.getBranch();
    let text = "";
    for (const entry of branch.slice(-10)) {
      if (entry.type === "message") {
        const msg = (entry as any).message;
        if (msg && typeof msg.content === "string") text += " " + msg.content;
      }
    }

    if (text.trim() && fs.existsSync(indexPath)) {
      const keywords = extractKeywords(text);
      if (keywords.length > 0) {
        const indexLines = fs.readFileSync(indexPath, "utf-8").split("\n");
        const scored: { slug: string; score: number }[] = [];

        for (const line of indexLines) {
          if (!line.startsWith("- [[")) continue;
          const m = line.match(/\[\[(.*?)\]\]/);
          if (!m) continue;
          const lowerLine = line.toLowerCase();
          let score = 0;
          for (const kw of keywords) {
            if (lowerLine.includes(kw)) score++;
          }
          if (score > 0) scored.push({ slug: m[1], score });
        }

        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, 3);

        if (top.length > 0) {
          const recalls: string[] = ["## Active Memories (Smart Recall)"];
          const cats = [
            "concepts",
            "connections",
            "qa",
            "lessons-learned",
            "cursed-knowledge",
          ];

          for (const { slug } of top) {
            let found = false;
            for (const cat of cats) {
              const summary = getArticleSummary(
                path.join(kbDir, cat, `${slug}.md`),
              );
              if (summary) {
                recalls.push(`### Memory: [[${slug}]]\n${summary}`);
                found = true;
                break;
              }
            }
            if (!found) recalls.push(`- [[${slug}]] (reference only)`);
          }

          parts.push(recalls.join("\n\n"));
        }
      }
    }
  } catch (err) {
    logger.error(`Smart recall failed: ${(err as Error).message}`, ctx, true);
  }

  if (parts.length === 0) return null;
  return `[Memory Extractor — Session Context]\n\n${parts.join("\n\n---\n\n")}`;
}
