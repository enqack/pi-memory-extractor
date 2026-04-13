import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { PiMemoryConfig } from "./config.js";
import { renderTemplate } from "./templates.js";
import { getArticlesToArchive } from "./archiver.js";

/**
 * Parses knowledge/log.md to find which daily logs have already been compiled.
 */
/**
 * Parses knowledge/log.md to find which daily logs have already been compiled.
 */
export function getCompiledSources(
  vaultRoot: string,
  config: PiMemoryConfig,
): Set<string> {
  const logPath = path.join(vaultRoot, config.KNOWLEDGE, "log.md");
  const compiled = new Set<string>();

  if (!fs.existsSync(logPath)) return compiled;

  const content = fs.readFileSync(logPath, "utf-8");
  for (const match of content.matchAll(/^- Sources?: (.*)$/gm)) {
    const rawPaths = match[1].split(",");
    for (const raw of rawPaths) {
      const fileName = path.basename(raw.trim());
      if (fileName.endsWith(".md")) {
        compiled.add(fileName);
      }
    }
  }

  return compiled;
}

/**
 * Main compilation entry point.
 */
export async function runCompilation(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  vaultRoot: string,
  config: PiMemoryConfig,
  force: boolean = false,
): Promise<void> {
  const dailyDir = path.join(vaultRoot, config.DAILY);

  if (!fs.existsSync(dailyDir)) {
    ctx.ui.notify(
      "[Memory Compiler] No daily logs directory found — nothing to compile.",
      "info",
    );
    return;
  }

  let logs = fs.readdirSync(dailyDir).filter((f) => f.endsWith(".md"));

  if (logs.length === 0) {
    ctx.ui.notify(
      "[Memory Compiler] No daily logs found — nothing to compile.",
      "info",
    );
    return;
  }

  logs.sort();

  if (!force) {
    const alreadyCompiled = getCompiledSources(vaultRoot, config);
    const filteredLogs = logs.filter((l) => !alreadyCompiled.has(l));

    if (filteredLogs.length === 0) {
      ctx.ui.notify(
        `[Memory Compiler] All ${logs.length} logs are already compiled. Use --force to re-process.`,
        "info",
      );
      return;
    }

    if (filteredLogs.length < logs.length) {
      ctx.ui.notify(
        `[Memory Compiler] Skipping ${logs.length - filteredLogs.length} already-compiled logs.`,
        "info",
      );
    }
    logs = filteredLogs;
  } else {
    ctx.ui.notify(
      `[Memory Compiler] Force mode: Processing all ${logs.length} logs.`,
      "info",
    );
  }

  const archiveList = getArticlesToArchive(vaultRoot, config);
  const relDaily = path.relative(ctx.cwd, dailyDir);
  const relKnowledge = path.relative(ctx.cwd, path.join(vaultRoot, config.KNOWLEDGE));
  const absKnowledge = path.join(vaultRoot, config.KNOWLEDGE);

  try {
    const prompt = renderTemplate("compilation", {
      projectRoot: ctx.cwd,
      vaultRoot,
      absKnowledge,
      relKnowledge,
      dailyLogs: logs.map((l) => `${relDaily}/${l}`),
      archiveList,
    });

    ctx.ui.notify(
      `[Memory Compiler] Triggering compilation of ${logs.length} daily log(s)…`,
      "info",
    );

    if (archiveList.length > 0) {
      ctx.ui.notify(`[Memory Compiler] Found ${archiveList.length} articles for archiving.`, "info");
    }

    // Trigger the agent to start processing. 
    // We don't use waitForIdle() here to avoid deadlocks when called from tools.
    try {
      await pi.sendUserMessage(prompt, {
        deliverAs: "followUp",
      });
    } catch (err) {
      console.error(`[Memory Compiler] Failed to trigger follow-up: ${err}`);
      ctx.ui.notify(
        "[Memory Compiler] Failed to trigger follow-up turn.",
        "error",
      );
    }
  } catch (err) {
    console.error(`[Memory Compiler] Failed to render template: ${err}`);
    ctx.ui.notify("[Memory Compiler] Failed to render compilation prompt.", "error");
  }
}

