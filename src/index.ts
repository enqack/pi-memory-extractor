import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  isToolCallEventType,
} from "@mariozechner/pi-coding-agent";
import {
  getResolvedConfig,
  ensureVaultStructure,
  PiMemoryConfig,
} from "./config.js";
import {
  serializeSubprocessTranscript,
  groupSessionsByDate,
} from "./extractor.js";
import { spawnExtractionSubprocess } from "./subprocess.js";
import { runCompilation } from "./compiler.js";
import { repairDocument, validateDocument } from "./markdown.js";
import { TODAY, findVaultRoot } from "./utils.js";
import { logger } from "./logger.js";
import { buildSessionContext } from "./context.js";
import { registerExtractTools } from "./tools/extract.js";
import { registerSearchTools } from "./tools/search.js";
import { registerVaultTools } from "./tools/vault.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
  let vaultRoot: string | null = null;
  let config: PiMemoryConfig | null = null;
  let compilingTurnPending = false;

  function resolve(cwd: string): { vaultRoot: string; config: PiMemoryConfig } {
    if (!config) config = getResolvedConfig(cwd);
    if (!vaultRoot) vaultRoot = findVaultRoot(cwd, config);
    return { vaultRoot, config };
  }

  // ── agent_end: reset compiling status after triggered turn completes ────
  pi.on("agent_end", async (_event, ctx) => {
    if (compilingTurnPending) {
      compilingTurnPending = false;
      ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
    }
  });

  // ── Resource discovery ──────────────────────────────────────────────────
  pi.on("resources_discover", async () => ({
    skillPaths: [path.join(__dirname, "..", "skills")],
  }));

  // ── Frontmatter enforcement ─────────────────────────────────────────────
  // Intercept write calls to knowledge/ files and repair + validate frontmatter.
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("write", event)) return;
    const { path: filePath } = event.input;
    if (!filePath.endsWith(".md") || !filePath.includes("knowledge/")) return;

    const repaired = repairDocument(event.input.content);
    event.input.content = repaired;

    const { valid, error } = validateDocument(repaired);
    if (!valid) {
      return { block: true, reason: `Rejected: ${error}` };
    }
  });

  // ── session_start ───────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const r = resolve(ctx.cwd);

    const created = ensureVaultStructure(r.vaultRoot, r.config);
    if (created) logger.info("Initialised vault structure.", ctx, true);

    ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");

    const context = await buildSessionContext(r.vaultRoot, r.config, ctx);
    if (context) {
      pi.sendMessage(
        {
          role: "user",
          content: [{ type: "text", text: context }],
          customType: "memory-extractor-context",
        } as any,
        { triggerTurn: false },
      );
      logger.info("Knowledge context injected.", ctx, true);
    } else {
      logger.info("No knowledge base found.", ctx, true);
    }
  });

  // ── session_before_compact ──────────────────────────────────────────────
  pi.on("session_before_compact", async (_event, ctx) => {
    ctx.ui.setStatus("memory-extractor", "🧠 MemEx: waiting for compaction…");
  });

  // ── session_compact ─────────────────────────────────────────────────────
  // Spawn a detached subprocess so extraction doesn't block the session.
  pi.on("session_compact", async (_event, ctx) => {
    const r = resolve(ctx.cwd);
    const transcript = serializeSubprocessTranscript(
      ctx.sessionManager.getBranch(),
      r.config,
    );

    if (!transcript.trim()) {
      ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
      return;
    }

    logger.info("Spawning background extraction (compaction)…", ctx, true);
    ctx.ui.setStatus("memory-extractor", "🧠 MemEx: extracting…");

    await spawnExtractionSubprocess({
      transcript,
      vaultRoot: r.vaultRoot,
      config: r.config,
      trigger: "compaction",
      cwd: ctx.cwd,
      detach: true,
    }).catch(() => {});

    ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
  });

  // ── session_shutdown ────────────────────────────────────────────────────
  // Subprocess must survive parent exit — use detach: true.
  pi.on("session_shutdown", async (_event, ctx) => {
    const r = resolve(ctx.cwd);
    const transcript = serializeSubprocessTranscript(
      ctx.sessionManager.getBranch(),
      r.config,
    );

    if (!transcript.trim()) return;

    logger.info("Spawning background extraction (shutdown)…", ctx, true);
    await spawnExtractionSubprocess({
      transcript,
      vaultRoot: r.vaultRoot,
      config: r.config,
      trigger: "shutdown",
      cwd: ctx.cwd,
      detach: true,
    }).catch(() => {});
  });

  // ── Command: /extract-knowledge ─────────────────────────────────────────
  pi.registerCommand("extract-knowledge", {
    description:
      "Trigger foreground knowledge extraction. --all: every session → per-date daily logs. --from YYYY-MM-DD [--to YYYY-MM-DD]: date range extraction → per-date daily logs (--to defaults to today). (no flag): current session only.",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const r = resolve(ctx.cwd);
      const all = /--all/.test(args ?? "");
      const fromMatch = (args ?? "").match(/--from\s+(\d{4}-\d{2}-\d{2})/);
      const toMatch = (args ?? "").match(/--to\s+(\d{4}-\d{2}-\d{2})/);
      const from = fromMatch?.[1];
      const to = toMatch?.[1] ?? TODAY();

      // ── --all or --from: per-date batch extraction ───────────────────────
      if (all || from) {
        const batches = await groupSessionsByDate(ctx, r.config, {
          from: from,
          to: all ? undefined : to,
        });
        if (batches.length === 0) {
          logger.info("No sessions found to extract.", ctx, true);
          return;
        }

        const label = all ? "full" : `range (${from} → ${to})`;
        logger.info(
          `Starting ${label} extraction: ${batches.length} day(s)…`,
          ctx,
          true,
        );
        ctx.ui.setStatus("memory-extractor", "🧠 MemEx: extracting…");

        try {
          for (let i = 0; i < batches.length; i++) {
            const { date, transcript } = batches[i];
            logger.info(
              `Extracting day ${i + 1}/${batches.length} (${date})…`,
              ctx,
              true,
            );

            try {
              const result = await spawnExtractionSubprocess({
                transcript,
                vaultRoot: r.vaultRoot,
                config: r.config,
                trigger: all ? "manual-all" : "manual-range",
                cwd: ctx.cwd,
                detach: false,
                date,
                signal: ctx.signal,
              });

              if (result.exitCode !== 0) {
                logger.error(
                  `Extraction for ${date} exited with code ${result.exitCode}.`,
                  ctx,
                  true,
                );
                if (result.stderr) logger.error(result.stderr, ctx, false);
              }
            } catch (err) {
              logger.error(
                `Extraction for ${date} failed: ${(err as Error).message}`,
                ctx,
                true,
              );
            }
          }

          logger.info(`Extraction complete (${label}).`, ctx, true);
        } finally {
          ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
        }
        return;
      }

      // ── current session only ─────────────────────────────────────────────
      const transcript = serializeSubprocessTranscript(
        ctx.sessionManager.getBranch(),
        r.config,
      );

      if (!transcript.trim()) {
        logger.info("Nothing to extract from the current session.", ctx, true);
        return;
      }

      logger.info("Starting extraction…", ctx, true);
      ctx.ui.setStatus("memory-extractor", "🧠 MemEx: extracting…");

      try {
        const result = await spawnExtractionSubprocess({
          transcript,
          vaultRoot: r.vaultRoot,
          config: r.config,
          trigger: "manual",
          cwd: ctx.cwd,
          detach: false,
          signal: ctx.signal,
        });

        if (result.exitCode === 0) {
          logger.info("Extraction complete.", ctx, true);
        } else {
          logger.error(
            `Extraction exited with code ${result.exitCode}.`,
            ctx,
            true,
          );
          if (result.stderr) logger.error(result.stderr, ctx, false);
        }
      } catch (err) {
        logger.error(`Extraction failed: ${(err as Error).message}`, ctx, true);
      } finally {
        ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
      }
    },
  });

  // ── Command: /compile-knowledge ─────────────────────────────────────────
  pi.registerCommand("compile-knowledge", {
    description:
      "Compile daily session logs into structured knowledge base articles. Pass --force to reprocess all logs.",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const r = resolve(ctx.cwd);
      const force = /--force|-f/.test(args ?? "");

      ctx.ui.setStatus("memory-extractor", "🧠 MemEx: compiling…");
      compilingTurnPending = true;
      logger.info(`Starting compilation${force ? " (force)" : ""}…`, ctx, true);

      try {
        await runCompilation(pi, ctx, r.vaultRoot, r.config, force);
        logger.info("Compilation turn triggered.", ctx, true);
      } catch (err) {
        compilingTurnPending = false;
        ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
        logger.error(
          `Compilation failed: ${(err as Error).message}`,
          ctx,
          true,
        );
      }
    },
  });

  // ── Tool registrations ──────────────────────────────────────────────────
  registerExtractTools(pi, resolve, () => compilingTurnPending, (v) => { compilingTurnPending = v; });
  registerSearchTools(pi, resolve);
  registerVaultTools(pi, resolve);
}
