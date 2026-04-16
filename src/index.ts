import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import { Text, Container, Spacer, Markdown } from "@mariozechner/pi-tui";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  getMarkdownTheme,
  DynamicBorder,
  isToolCallEventType,
  withFileMutationQueue,
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
import { runCompilation, ACTIVE_CATEGORIES } from "./compiler.js";
import { getArticlesToArchive, archiveArticles } from "./archiver.js";
import { repairDocument, validateDocument } from "./markdown.js";
import {
  TODAY,
  NOW_TIME,
  findVaultRoot,
  extractKeywords,
  getArticleSummary,
  searchMarkdownTree,
  SearchResultFile,
} from "./utils.js";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Context injection ────────────────────────────────────────────────────────

async function buildSessionContext(
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
    if ((err as any).code !== "ENOENT") {
      logger.warn(
        `Could not read knowledge index: ${(err as Error).message}`,
        ctx,
        true,
      );
    }
  }

  // 2. Today's daily log
  try {
    const content = await fsPromises.readFile(todayLogPath, "utf-8");
    if (content.trim()) {
      parts.push(`## Today's Session Log (${TODAY()})\n\n${content.trim()}`);
    }
  } catch (err) {
    if ((err as any).code !== "ENOENT") {
      logger.warn(
        `Could not read daily log: ${(err as Error).message}`,
        ctx,
        true,
      );
    }
  }

  // 3. Smart recall — inject summaries of the top 3 keyword-matching articles
  try {
    const branch = ctx.sessionManager.getBranch();
    let text = "";
    for (const entry of branch.slice(-10)) {
      if (entry.type === "message") {
        const msg = (entry as any).message;
        if (typeof msg.content === "string") text += " " + msg.content;
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

// ── Full-text search helpers ─────────────────────────────────────────────────

function formatSearchResults(
  results: SearchResultFile[],
  query: string,
  vaultRoot: string,
) {
  const totalMatches = results.reduce((n, r) => n + r.matches.length, 0);

  if (results.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No matches." }],
      details: { query, matchCount: 0, fileCount: 0 },
    };
  }

  const lines: string[] = [];
  for (const file of results) {
    const rel = path.relative(vaultRoot, file.path);
    for (const m of file.matches) {
      lines.push(`${rel}:${m.line} — ${m.text}`);
    }
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: { query, matchCount: totalMatches, fileCount: results.length },
  };
}

function renderFullTextSearchResult(result: any, { expanded }: { expanded: boolean }, theme: any) {
  const query: string = result.details?.query ?? "";
  const matchCount: number = result.details?.matchCount ?? 0;
  const fileCount: number = result.details?.fileCount ?? 0;
  const text: string = result.content?.[0]?.text ?? "";

  if (!expanded) {
    return new Text(
      theme.fg(
        "success",
        `🔍 ${matchCount} match(es) across ${fileCount} file(s) for "${query}"`,
      ),
      0,
      0,
    );
  }

  const container = new Container();
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  container.addChild(
    new Text(
      theme.fg("accent", theme.bold(`Search: "${query}"`)),
      1,
      0,
    ),
  );
  container.addChild(new Spacer(1));

  if (matchCount > 0) {
    for (const line of text.split("\n")) {
      container.addChild(new Text(theme.fg("text", line), 1, 0));
    }
  } else {
    container.addChild(new Text(theme.fg("dim", "  No results."), 1, 0));
  }

  container.addChild(new Spacer(1));
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  return container;
}

// ── Extension factory ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let vaultRoot: string | null = null;
  let config: PiMemoryConfig | null = null;

  function resolve(cwd: string): { vaultRoot: string; config: PiMemoryConfig } {
    if (!config) config = getResolvedConfig(cwd);
    if (!vaultRoot) vaultRoot = findVaultRoot(cwd, config);
    return { vaultRoot, config };
  }

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
      "Trigger foreground knowledge extraction. --all: every session → per-date daily logs. --deep: recent history (deepExtractMaxChars budget) → per-date daily logs. (no flag): current session only.",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const r = resolve(ctx.cwd);
      const all = /--all/.test(args ?? "");
      const deep = /--deep/.test(args ?? "");

      // ── --all or --deep: per-date batch extraction ─────────────────────────
      if (all || deep) {
        const batches = await groupSessionsByDate(ctx, r.config, {
          totalCharBudget: deep ? r.config.deepExtractMaxChars : undefined,
        });
        if (batches.length === 0) {
          logger.info("No sessions found to extract.", ctx, true);
          return;
        }

        const label = deep ? "deep" : "full";
        logger.info(`Starting ${label} extraction: ${batches.length} day(s)…`, ctx, true);
        ctx.ui.setStatus("memory-extractor", "🧠 MemEx: extracting…");

        try {
          for (let i = 0; i < batches.length; i++) {
            const { date, transcript } = batches[i];
            logger.info(`Extracting day ${i + 1}/${batches.length} (${date})…`, ctx, true);

            try {
              const result = await spawnExtractionSubprocess({
                transcript,
                vaultRoot: r.vaultRoot,
                config: r.config,
                trigger: deep ? "manual-deep" : "manual-all",
                cwd: ctx.cwd,
                detach: false,
                date,
                signal: ctx.signal,
              });

              if (result.exitCode !== 0) {
                logger.error(`Extraction for ${date} exited with code ${result.exitCode}.`, ctx, true);
                if (result.stderr) logger.error(result.stderr, ctx, false);
              }
            } catch (err) {
              logger.error(`Extraction for ${date} failed: ${(err as Error).message}`, ctx, true);
            }
          }

          logger.info(`${label.charAt(0).toUpperCase() + label.slice(1)} extraction complete.`, ctx, true);
        } finally {
          ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
        }
        return;
      }

      // ── current session only ───────────────────────────────────────────────
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
      logger.info(`Starting compilation${force ? " (force)" : ""}…`, ctx, true);

      try {
        await runCompilation(pi, ctx, r.vaultRoot, r.config, force);
        logger.info("Compilation prompt sent.", ctx, true);
      } catch (err) {
        logger.error(
          `Compilation failed: ${(err as Error).message}`,
          ctx,
          true,
        );
      } finally {
        ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
      }
    },
  });

  // ── Tool: extract_knowledge ─────────────────────────────────────────────
  pi.registerTool({
    name: "extract_knowledge",
    label: "Extract Session Knowledge",
    description:
      "Trigger knowledge extraction via a foreground subprocess. Use 'all' to process every historical session grouped by date into per-date daily logs.",
    parameters: Type.Object({
      reason: Type.Optional(
        Type.String({ description: "Why extraction is being triggered" }),
      ),
      deep: Type.Optional(
        Type.Boolean({ description: "Single-pass scan of recent historical sessions (bounded by deepExtractMaxChars)" }),
      ),
      all: Type.Optional(
        Type.Boolean({ description: "Process every historical session, grouped by calendar date, writing to per-date daily logs" }),
      ),
    }),
    renderResult(result: any, { expanded }, theme) {
      const status = result.details?.status ?? "unknown";
      if (status === "success")
        return new Text(theme.fg("success", "✓ Extraction complete"), 0, 0);
      if (status === "empty")
        return new Text(theme.fg("dim", "Nothing to extract"), 0, 0);
      return new Text(theme.fg("warn", `Extraction status: ${status}`), 0, 0);
    },
    async execute(_id, params, signal, _onUpdate, ctx) {
      const r = resolve(ctx.cwd);

      if (params.all) {
        const batches = await groupSessionsByDate(ctx, r.config);
        if (batches.length === 0) {
          return {
            content: [{ type: "text", text: "No sessions found to extract." }],
            details: { status: "empty" },
          };
        }

        let failed = 0;
        for (const { date, transcript } of batches) {
          const result = await spawnExtractionSubprocess({
            transcript,
            vaultRoot: r.vaultRoot,
            config: r.config,
            trigger: params.reason ?? "llm_requested_all",
            cwd: ctx.cwd,
            detach: false,
            date,
            signal,
          });
          if (result.exitCode !== 0) failed++;
        }

        if (failed === 0) {
          return {
            content: [{ type: "text", text: `Full extraction complete (${batches.length} day(s)).` }],
            details: { status: "success", days: batches.length },
          };
        }
        return {
          content: [{ type: "text", text: `Full extraction finished with ${failed}/${batches.length} day(s) failing.` }],
          details: { status: "error", days: batches.length, failed },
        };
      }

      if (params.deep) {
        const batches = await groupSessionsByDate(ctx, r.config, {
          totalCharBudget: r.config.deepExtractMaxChars,
        });
        if (batches.length === 0) {
          return {
            content: [{ type: "text", text: "No sessions found to extract." }],
            details: { status: "empty" },
          };
        }

        let failed = 0;
        for (const { date, transcript } of batches) {
          const result = await spawnExtractionSubprocess({
            transcript,
            vaultRoot: r.vaultRoot,
            config: r.config,
            trigger: params.reason ?? "llm_requested_deep",
            cwd: ctx.cwd,
            detach: false,
            date,
            signal,
          });
          if (result.exitCode !== 0) failed++;
        }

        if (failed === 0) {
          return {
            content: [{ type: "text", text: `Deep extraction complete (${batches.length} day(s)).` }],
            details: { status: "success", days: batches.length },
          };
        }
        return {
          content: [{ type: "text", text: `Deep extraction finished with ${failed}/${batches.length} day(s) failing.` }],
          details: { status: "error", days: batches.length, failed },
        };
      }

      const transcript = serializeSubprocessTranscript(
        ctx.sessionManager.getBranch(),
        r.config,
      );

      if (!transcript.trim()) {
        return {
          content: [{ type: "text", text: "No knowledge to extract." }],
          details: { status: "empty" },
        };
      }

      const result = await spawnExtractionSubprocess({
        transcript,
        vaultRoot: r.vaultRoot,
        config: r.config,
        trigger: params.reason ?? "llm_requested",
        cwd: ctx.cwd,
        detach: false,
        signal,
      });

      if (result.exitCode === 0) {
        return {
          content: [{ type: "text", text: "Extraction complete." }],
          details: { status: "success" },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Extraction exited with code ${result.exitCode}.`,
          },
        ],
        details: { status: "error", exitCode: result.exitCode },
      };
    },
  });

  // ── Tool: compile_knowledge ─────────────────────────────────────────────
  pi.registerTool({
    name: "compile_knowledge",
    label: "Compile Knowledge Base",
    description:
      "Compile daily session logs into structured knowledge base articles.",
    parameters: Type.Object({
      force: Type.Optional(
        Type.Boolean({ description: "Reprocess already-compiled logs" }),
      ),
    }),
    renderResult(_result, _opts, theme) {
      return new Text(theme.fg("success", "✓ Compilation initiated"), 0, 0);
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const r = resolve(ctx.cwd);
      await runCompilation(pi, ctx, r.vaultRoot, r.config, !!params.force);
      return { content: [{ type: "text", text: "Compilation initiated." }] };
    },
  });

  // ── Tool: cleanup_knowledge_vault ───────────────────────────────────────
  pi.registerTool({
    name: "cleanup_knowledge_vault",
    label: "Cleanup Knowledge Vault",
    description:
      "Archive stale (> 6 months) and faded (confidence ≤ 0) articles.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const r = resolve(ctx.cwd);
      const toArchive = getArticlesToArchive(r.vaultRoot, r.config);
      if (toArchive.length === 0) {
        return { content: [{ type: "text", text: "Nothing to archive." }] };
      }
      const count = archiveArticles(r.vaultRoot, r.config, toArchive);
      return {
        content: [{ type: "text", text: `Archived ${count} article(s).` }],
      };
    },
  });

  // ── Tool: search_index ──────────────────────────────────────────────────
  pi.registerTool({
    name: "search_index",
    label: "Search Knowledge Index",
    description:
      "Keyword search against knowledge/index.md only. For article-body search use search_articles; for whole-vault search use search_knowledge.",
    parameters: Type.Object({ query: Type.String() }),
    renderResult(result: any, { expanded }, theme) {
      const text: string = result.content?.[0]?.text ?? "";
      const matches = text
        .split("\n")
        .filter((l: string) => l.trim() && !l.includes("No matches"));

      if (!expanded) {
        return new Text(
          theme.fg(
            "success",
            `🔍 ${matches.length} match(es) for "${result.details?.query ?? ""}"`,
          ),
          0,
          0,
        );
      }

      const container = new Container();
      container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
      container.addChild(
        new Text(
          theme.fg(
            "accent",
            theme.bold(`Search: "${result.details?.query ?? ""}"`),
          ),
          1,
          0,
        ),
      );
      container.addChild(new Spacer(1));
      if (matches.length > 0) {
        for (const line of matches) {
          container.addChild(new Text(theme.fg("text", line), 1, 0));
        }
      } else {
        container.addChild(new Text(theme.fg("dim", "  No results."), 1, 0));
      }
      container.addChild(new Spacer(1));
      container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
      return container;
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const r = resolve(ctx.cwd);
      if (!params.query.trim()) {
        return {
          content: [{ type: "text", text: "query must be non-empty." }],
          status: "error",
          details: { query: params.query },
        };
      }
      const indexPath = path.join(r.vaultRoot, r.config.knowledge, "index.md");
      if (!fs.existsSync(indexPath)) {
        return {
          content: [{ type: "text", text: "No knowledge index found." }],
        };
      }
      const lines = fs
        .readFileSync(indexPath, "utf-8")
        .split("\n")
        .filter((l) => l.toLowerCase().includes(params.query.toLowerCase()));
      return {
        content: [{ type: "text", text: lines.join("\n") || "No matches." }],
        details: { query: params.query },
      };
    },
  });

  // ── Tool: search_articles ───────────────────────────────────────────────
  pi.registerTool({
    name: "search_articles",
    label: "Search Knowledge Articles",
    description:
      "Full-text keyword search across the active knowledge/ categories (concepts, connections, qa, lessons-learned, cursed-knowledge). Returns file paths with matching line numbers and snippets.",
    parameters: Type.Object({ query: Type.String() }),
    renderResult: renderFullTextSearchResult,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const r = resolve(ctx.cwd);
      if (!params.query.trim()) {
        return {
          content: [{ type: "text", text: "query must be non-empty." }],
          status: "error",
          details: { query: params.query },
        };
      }
      const kbDir = path.join(r.vaultRoot, r.config.knowledge);
      const roots = ACTIVE_CATEGORIES.map((c) => path.join(kbDir, c));
      const results = searchMarkdownTree(roots, params.query);
      return formatSearchResults(results, params.query, r.vaultRoot);
    },
  });

  // ── Tool: search_knowledge ──────────────────────────────────────────────
  pi.registerTool({
    name: "search_knowledge",
    label: "Search Knowledge Base",
    description:
      "Full-text keyword search across the whole vault: active knowledge/ categories, daily/ logs, and deep-thoughts/. Returns file paths with matching line numbers and snippets.",
    parameters: Type.Object({ query: Type.String() }),
    renderResult: renderFullTextSearchResult,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const r = resolve(ctx.cwd);
      if (!params.query.trim()) {
        return {
          content: [{ type: "text", text: "query must be non-empty." }],
          status: "error",
          details: { query: params.query },
        };
      }
      const kbDir = path.join(r.vaultRoot, r.config.knowledge);
      const roots = [
        ...ACTIVE_CATEGORIES.map((c) => path.join(kbDir, c)),
        path.join(r.vaultRoot, r.config.daily),
        path.join(r.vaultRoot, r.config.deepThoughts),
      ];
      const results = searchMarkdownTree(roots, params.query);
      return formatSearchResults(results, params.query, r.vaultRoot);
    },
  });

  // ── Tool: read_knowledge_article ────────────────────────────────────────
  pi.registerTool({
    name: "read_knowledge_article",
    label: "Read Knowledge Article",
    description: "Read a full knowledge article by its slug.",
    parameters: Type.Object({ slug: Type.String() }),
    renderResult(result: any, { expanded }, theme) {
      if (!expanded || result.status === "error") {
        return new Text(
          result.content?.[0]?.text?.substring(0, 60) ?? "Not found",
          0,
          0,
        );
      }
      const container = new Container();
      container.addChild(
        new Markdown(result.content?.[0]?.text ?? "", 0, 0, getMarkdownTheme()),
      );
      return container;
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const r = resolve(ctx.cwd);
      const kbDir = path.join(r.vaultRoot, r.config.knowledge);
      const cats = [
        "concepts",
        "connections",
        "qa",
        "lessons-learned",
        "cursed-knowledge",
        "archive",
      ];

      for (const cat of cats) {
        const p = path.join(kbDir, cat, `${params.slug}.md`);
        if (fs.existsSync(p)) {
          return {
            content: [{ type: "text", text: fs.readFileSync(p, "utf-8") }],
          };
        }
      }

      return {
        content: [{ type: "text", text: "Article not found." }],
        status: "error",
      };
    },
  });

  // ── Tool: sync_knowledge_index ──────────────────────────────────────────
  pi.registerTool({
    name: "sync_knowledge_index",
    label: "Sync Knowledge Index",
    description:
      "Scan all category directories and rebuild knowledge/index.md.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const r = resolve(ctx.cwd);
      const kbDir = path.join(r.vaultRoot, r.config.knowledge);
      const indexPath = path.join(kbDir, "index.md");

      const categories = [
        { name: "Concepts", dir: "concepts" },
        { name: "Connections", dir: "connections" },
        { name: "Q&A", dir: "qa" },
        { name: "Lessons Learned", dir: "lessons-learned" },
        { name: "Cursed Knowledge", dir: "cursed-knowledge" },
      ];

      let content =
        '---\ntitle: "Knowledge Base Index"\ntype: index\n---\n\n# Knowledge Base Index\n\n';

      for (const cat of categories) {
        content += `## ${cat.name}\n`;
        const catDir = path.join(kbDir, cat.dir);

        if (!fs.existsSync(catDir)) {
          content += "(No articles currently.)\n\n";
          continue;
        }

        const files = fs
          .readdirSync(catDir)
          .filter((f) => f.endsWith(".md"))
          .sort();
        if (files.length === 0) {
          content += "(No articles currently.)\n\n";
          continue;
        }

        for (const file of files) {
          const slug = path.basename(file, ".md");
          const summary = getArticleSummary(path.join(catDir, file)) ?? "";
          const firstLine =
            summary
              .split("\n")
              .map((l) => l.trim())
              .find((l) => l.length > 0) ?? "[No summary]";

          let cleanSummary = firstLine;
          if (cleanSummary.length > 120) {
            const cut = cleanSummary.lastIndexOf(" ", 120);
            cleanSummary =
              cleanSummary.slice(0, cut > 0 ? cut : 120).trim() + "…";
          } else if (
            cleanSummary !== "[No summary]" &&
            !cleanSummary.match(/[.!?]$/)
          ) {
            cleanSummary += ".";
          }

          content += `- [[${slug}]] — ${cleanSummary}\n`;
        }
        content += "\n";
      }

      content += `---\n*Last Updated: ${TODAY()} ${NOW_TIME()}*\n`;

      await withFileMutationQueue(indexPath, () =>
        fsPromises.writeFile(indexPath, content),
      );

      return {
        content: [
          { type: "text", text: `Knowledge index rebuilt at ${indexPath}.` },
        ],
        details: { path: indexPath, status: "success" },
      };
    },
  });

  logger.info("pi-memory-extractor loaded (subprocess mode).");
}
