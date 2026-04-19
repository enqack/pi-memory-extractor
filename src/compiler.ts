import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { PiMemoryConfig } from "./config.js";
import { parseArticle, updateFrontmatter } from "./markdown.js";
import { renderTemplate } from "./templates.js";
import { getArticlesToArchive } from "./archiver.js";
import { TODAY, NOW_ISO } from "./utils.js";
import { logger } from "./logger.js";

export const ACTIVE_CATEGORIES = [
  "concepts",
  "connections",
  "qa",
  "lessons-learned",
  "cursed-knowledge",
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Filter a list of daily log filenames to those not yet marked processed.
 * A log is considered processed when its frontmatter contains `processed: true`.
 */
function getUnprocessedLogs(dailyDir: string, logs: string[]): string[] {
  return logs.filter((file) => {
    try {
      const content = fs.readFileSync(path.join(dailyDir, file), "utf-8");
      const { frontmatter } = parseArticle(content);
      return frontmatter.processed !== true;
    } catch {
      return true;
    }
  });
}

/**
 * Apply a −0.1 confidence penalty to every active article whose
 * `last_reinforced` date is more than 30 days ago.
 * Returns the slugs of articles that were decayed.
 */
async function applyDecay(
  vaultRoot: string,
  config: PiMemoryConfig,
  ctx: ExtensionContext,
): Promise<string[]> {
  const now = Date.now();
  const decayedSlugs: string[] = [];

  for (const cat of ACTIVE_CATEGORIES) {
    const dir = path.join(vaultRoot, config.knowledge, cat);
    if (!fs.existsSync(dir)) continue;

    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const filePath = path.join(dir, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const { frontmatter } = parseArticle(content);
        const conf = frontmatter.confidence ?? 1.0;
        if (conf <= 0) continue; // archiver will handle these

        const lastReinforced = frontmatter.last_reinforced
          ? new Date(frontmatter.last_reinforced as string).getTime()
          : 0;

        if (now - lastReinforced > THIRTY_DAYS_MS) {
          const newConf = parseFloat(Math.max(0, conf - 0.1).toFixed(1));
          await withFileMutationQueue(filePath, async () => {
            fs.writeFileSync(filePath, updateFrontmatter(content, { confidence: newConf }));
          });
          decayedSlugs.push(`${cat}/${file.replace(/\.md$/, "")}`);
        }
      } catch (err) {
        logger.warn(`Decay: could not process ${file}: ${ err}`);
      }
    }
  }

  if (decayedSlugs.length > 0) {
    logger.info(`Decay applied to ${decayedSlugs.length} article(s).`, ctx, true);
  }

  return decayedSlugs;
}

/**
 * Main compilation entry point.
 *
 * 1. Identify uncompiled daily logs (unless force=true).
 * 2. Apply confidence decay to all active articles.
 * 3. Render the compilation prompt and send it as a follow-up to the agent.
 */
export async function runCompilation(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  vaultRoot: string,
  config: PiMemoryConfig,
  force: boolean = false,
): Promise<void> {
  const dailyDir = path.join(vaultRoot, config.daily);

  if (!fs.existsSync(dailyDir)) {
    logger.info("No daily logs directory found — nothing to compile.", ctx, true);
    return;
  }

  let logs = fs.readdirSync(dailyDir).filter((f) => f.endsWith(".md")).sort();

  if (logs.length === 0) {
    logger.info("No daily logs found — nothing to compile.", ctx, true);
    return;
  }

  if (!force) {
    const pending = getUnprocessedLogs(dailyDir, logs);

    if (pending.length === 0) {
      logger.info(
        `All ${logs.length} log(s) are already compiled. Use --force to re-process.`,
        ctx,
        true,
      );
      return;
    }

    if (pending.length < logs.length) {
      logger.info(
        `Skipping ${logs.length - pending.length} already-compiled log(s).`,
        ctx,
        true,
      );
    }

    logs = pending;
  } else {
    logger.info(`Force mode: processing all ${logs.length} log(s).`, ctx, true);
  }

  // Capture faded/stale articles before decay so those lists reflect pre-run state.
  const archiveList = getArticlesToArchive(vaultRoot, config);

  // Apply decay after archiveList snapshot so Faded and Decayed are non-overlapping.
  const decayedList = await applyDecay(vaultRoot, config, ctx);
  const fadedList = archiveList
    .filter((e) => e.endsWith(":faded"))
    .map((e) => e.split(":")[0]);
  const staleList = archiveList
    .filter((e) => e.endsWith(":stale"))
    .map((e) => e.split(":")[0]);

  const relDaily = path.relative(ctx.cwd, dailyDir);
  const relKnowledge = path.relative(ctx.cwd, path.join(vaultRoot, config.knowledge));
  const absKnowledge = path.join(vaultRoot, config.knowledge);

  const prompt = renderTemplate("compilation", {
    projectRoot: ctx.cwd,
    vaultRoot,
    absKnowledge,
    relKnowledge,
    dailyLogs: logs.map((l) => `${relDaily}/${l}`),
    archiveList,
    decayedList,
    fadedList,
    staleList,
    currentDate: TODAY(),
    currentTimestamp: NOW_ISO(),
  });

  logger.info(`Triggering compilation of ${logs.length} daily log(s)…`, ctx, true);
  if (archiveList.length > 0) {
    logger.info(`${archiveList.length} article(s) flagged for archiving.`, ctx, true);
  }

  try {
    await pi.sendMessage(
      {
        role: "user",
        content: [{ type: "text", text: prompt }],
      } as any,
      { triggerTurn: true },
    );
  } catch (err) {
    logger.error(`Failed to trigger compilation follow-up: ${err}`, ctx, true);
    throw err;
  }
}
