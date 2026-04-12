import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { runExtraction, serializeTranscript } from "./extractor.js";
import { runCompilation } from "./compiler.js";
import { getResolvedConfig, PiMemoryConfig } from "./config.js";
import { TODAY, findVaultRoot } from "./utils.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  "temp",
  "tmp",
  ".pi",
  ".svelte-kit",
  ".next",
  ".cache",
]);

/**
 * pi-memory-extractor — Sessions knowledge extraction & compilation.
 *
 * Provides event handlers for context injection and extraction,
 * plus commands and tools for manual extraction and compilation.
 */

// --- Context injection ---

async function buildSessionContext(
  vaultRoot: string,
  config: PiMemoryConfig,
  ctx: ExtensionContext
): Promise<string | null> {
  const knowledgeIndexPath = path.join(vaultRoot, config.KNOWLEDGE, "index.md");
  const todayLogPath = path.join(vaultRoot, config.DAILY, `${TODAY()}.md`);

  const parts: string[] = [];

  // --- 1. Knowledge Index ---
  try {
    const content = await fsPromises.readFile(knowledgeIndexPath, "utf-8");
    const lines = content.trim().split("\n");
    // Truncate to first 5 + last 15 lines if long
    const recentLines =
      lines.length > 50
        ? [...lines.slice(0, 5), "...", "... [truncated for brevity] ...", "...", ...lines.slice(-15)]
        : lines;

    parts.push(`## Knowledge Base Index (Recent entries)\n${recentLines.join("\n")}\n\n---\nIf you need to find more specific topics, use the 'search_knowledge' tool.\nTo read a full article, use 'read_knowledge_article(slug)'.`);
  } catch {
    // Ignore if file doesn't exist or can't be read
  }

  // --- 2. Today's Daily Log ---
  try {
    const content = await fsPromises.readFile(todayLogPath, "utf-8");
    if (content.trim()) {
      parts.push(`## Today's Session Log (${TODAY()})\n\n${content.trim()}`);
    }
  } catch {
    // Ignore
  }

  // --- 3. Semantic Context Injection ---
  // Scan workspace for .md or .ts files and find related knowledge.
  try {
    const workspaceFiles: string[] = [];
    
    async function scanDir(dir: string, depth = 0) {
      if (depth > 5) return; // Limit depth to avoid massive scans
      
      let entries: fs.Dirent[] = [];
      try {
        entries = await fsPromises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name) || entry.name === config.VAULT_ROOT) {
          continue;
        }

        const res = path.resolve(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(res, depth + 1);
        } else if (entry.name.endsWith(".md") || entry.name.endsWith(".ts")) {
          workspaceFiles.push(res);
        }
        
        // Safety cap: don't process more than 200 files
        if (workspaceFiles.length >= 200) return;
      }
    }

    await scanDir(ctx.cwd);

    const indexPath = path.join(vaultRoot, config.KNOWLEDGE, "index.md");
    let indexContent = "";
    if (fs.existsSync(indexPath)) {
      indexContent = (await fsPromises.readFile(indexPath, "utf-8")).toLowerCase();
    }

    if (workspaceFiles.length > 0) {
      parts.push(`## Workspace Context (Semantic Injection)`);
      let foundLinks = 0;

      for (const file of workspaceFiles.slice(0, 50)) {
        const fileName = path.basename(file, path.extname(file)).toLowerCase();
        if (indexContent.includes(fileName)) {
          parts.push(`- [Relates to Knowledge: \`${path.basename(file)}\`] (Found in index)`);
          foundLinks++;
        }
      }

      if (foundLinks > 0) {
        parts.push(`\nAgent: Explicit links to related knowledge found above.`);
      } else {
        parts.push(`\nAgent: Use 'search_knowledge' with filenames as keywords if you need context.`);
      }
    }
  } catch (e) {
    // Fail silently
  }

  if (parts.length === 0) return null;

  return `[Memory Extractor — Session Context]\n\n${parts.join("\n\n---\n\n")}`;
}

// --- State helpers ---

interface ExtractorState {
  lastExtractedAt: number;
  lastExtractedEvent: string;
}

interface ExtensionState {
  isCompacting: boolean;
}

// --- Extension factory ---

export default function (pi: ExtensionAPI) {
  let vaultRoot: string | null = null;
  let config: PiMemoryConfig | null = null;

  const state: ExtensionState = { isCompacting: false };

  // Helper to lazily ensure config + vaultRoot are resolved
  function ensureResolved(cwd: string): { vaultRoot: string; config: PiMemoryConfig } {
    if (!config) config = getResolvedConfig(cwd);
    if (!vaultRoot) vaultRoot = findVaultRoot(cwd, config);
    return { vaultRoot, config };
  }

  // --- session_start ---
  pi.on("session_start", async (event, ctx) => {
    // Resolve config and vault root fresh each session
    config = getResolvedConfig(ctx.cwd);
    vaultRoot = findVaultRoot(ctx.cwd, config);

    // Restore last-run state from session entries
    const entries = ctx.sessionManager.getEntries();
    for (const entry of entries) {
      if (entry.type === "custom" && (entry as any).customType === "memory-extractor-state") {
        const data = (entry as any).data as ExtractorState;
        if (data?.lastExtractedAt) {
          ctx.ui.setStatus(
            "memory-extractor",
            `🧠 MemEx: last extracted: ${new Date(data.lastExtractedAt).toLocaleTimeString()}`,
          );
        }
      }
    }

    const contextMessage = await buildSessionContext(vaultRoot, config, ctx);
    if (contextMessage) {
      pi.sendMessage(
        {
          role: "user",
          content: [{ type: "text", text: contextMessage }],
          customType: "memory-extractor-context",
        } as any,
        { triggerTurn: false },
      );
      ctx.ui.notify("[Memory Extractor] Knowledge context injected.", "info");
    } else {
      ctx.ui.notify("[Memory Extractor] No knowledge base or daily log found yet.", "info");
    }

    ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
  });

  // --- session_before_compact ---
  pi.on("session_before_compact", async (_event, ctx) => {
    state.isCompacting = true;
    const r = ensureResolved(ctx.cwd);
    ctx.ui.setStatus("memory-extractor", "🧠 MemEx: waiting for compaction…");

    const transcript = serializeTranscript(ctx.sessionManager.getBranch());
    runExtraction(pi, ctx, r.vaultRoot, r.config, "pre_compact", transcript, false, state).catch((err) => {
      ctx.ui.notify(`[Memory Extractor] Extraction error: ${(err as Error).message}`, "error");
    });

    pi.appendEntry("memory-extractor-state", {
      lastExtractedAt: Date.now(),
      lastExtractedEvent: "pre_compact",
    } satisfies ExtractorState);
  });

  // --- session_compact ---
  pi.on("session_compact", async (_event, ctx) => {
    state.isCompacting = false;
    ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
  });

  // --- session_shutdown ---
  pi.on("session_shutdown", async (_event, ctx) => {
    const r = ensureResolved(ctx.cwd);
    ctx.ui.setStatus("memory-extractor", "🧠 MemEx: extracting…");

    const transcript = serializeTranscript(ctx.sessionManager.getBranch());
    runExtraction(pi, ctx, r.vaultRoot, r.config, "session_end", transcript, false, state).catch(() => {
      // Silently ignore on shutdown — process may exit before this resolves
    });

    pi.appendEntry("memory-extractor-state", {
      lastExtractedAt: Date.now(),
      lastExtractedEvent: "session_end",
    } satisfies ExtractorState);
  });

  // --- Command: /extract-knowledge ---
  pi.registerCommand("extract-knowledge", {
    description: "Manually trigger session knowledge extraction to the daily log",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const r = ensureResolved(ctx.cwd);

      const deep = /--deep/.test(args ?? "");
      ctx.ui.setStatus("memory-extractor", `🧠 MemEx: extracting${deep ? " (deep)" : ""}…`);
      ctx.ui.notify(`[Memory Extractor] Starting ${deep ? "deep " : ""}extraction…`, "info");

      try {
        await runExtraction(pi, ctx, r.vaultRoot, r.config, "manual", undefined, deep, state);
        pi.appendEntry("memory-extractor-state", {
          lastExtractedAt: Date.now(),
          lastExtractedEvent: deep ? "manual_deep" : "manual",
        } satisfies ExtractorState);
        ctx.ui.notify("[Memory Extractor] Extraction prompt sent to agent.", "info");
      } catch (err) {
        ctx.ui.notify(`[Memory Extractor] Extraction failed: ${(err as Error).message}`, "error");
      } finally {
        ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
      }
    },
  });

  // --- Command: /compile-knowledge ---
  pi.registerCommand("compile-knowledge", {
    description: "Compile daily session logs into structured knowledge base articles",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const r = ensureResolved(ctx.cwd);

      const force = /--force|-f/.test(args ?? "");

      ctx.ui.setStatus("memory-extractor", "🧠 MemEx: compiling…");
      ctx.ui.notify(`[Memory Compiler] Starting compilation${force ? " (force mode)" : ""}…`, "info");

      try {
        await runCompilation(pi, ctx, r.vaultRoot, r.config, force);
        ctx.ui.notify("[Memory Compiler] Compilation prompt sent to agent.", "info");
      } catch (err) {
        ctx.ui.notify(`[Memory Compiler] Compilation failed: ${(err as Error).message}`, "error");
      } finally {
        ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
      }
    },
  });

  // --- Tool: extract_knowledge ---
  pi.registerTool({
    name: "extract_knowledge",
    label: "Extract Session Knowledge",
    description:
      "Extract the current session's significant knowledge to the daily log " +
      "in the 'daily/' folder. Use this when the conversation has reached a " +
      "meaningful checkpoint and the learnings should be preserved.",
    promptSnippet: "Save current session knowledge to the daily log",
    promptGuidelines: [
      "Use extract_knowledge when the user asks to save, log, or remember session learnings.",
      "Use extract_knowledge before switching topics if significant work was done.",
    ],
    parameters: Type.Object({
      reason: Type.Optional(
        Type.String({
          description: "Optional reason or context for the extraction (e.g. 'checkpoint after refactor')",
        }),
      ),
      deep: Type.Optional(
        Type.Boolean({
          description: "If true, scan ALL historical sessions for the current project for knowledge.",
        }),
      ),
    }) as any,
    async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
      const r = ensureResolved(ctx.cwd);
      const label = params.reason ?? (params.deep ? "llm_requested_deep" : "llm_requested");
      await runExtraction(pi, ctx, r.vaultRoot, r.config, label, undefined, !!params.deep, state);

      pi.appendEntry("memory-extractor-state", {
        lastExtractedAt: Date.now(),
        lastExtractedEvent: label,
      } satisfies ExtractorState);

      return {
        content: [{ type: "text", text: "Extraction prompt queued. The agent will analyze the session and append findings to the daily log." }],
        details: { triggeredBy: label },
      };
    },
  });

  // --- Tool: compile_knowledge ---
  pi.registerTool({
    name: "compile_knowledge",
    label: "Compile Knowledge Base",
    description:
      "Compile extracted daily session logs into structured, interconnected knowledge " +
      "articles in the 'knowledge/' folder. Updates index.md and appends to log.md.",
    promptSnippet: "Compile daily logs into the structured knowledge base",
    promptGuidelines: [
      "Use compile_knowledge when the user asks to update or compile the knowledge base.",
      "Run compile_knowledge after a series of extract_knowledge calls to synthesize learnings.",
    ],
    parameters: Type.Object({
      force: Type.Optional(
        Type.Boolean({
          description: "If true, re-process all daily logs even if they have already been compiled.",
        }),
      ),
    }) as any,
    async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
      const r = ensureResolved(ctx.cwd);
      await runCompilation(pi, ctx, r.vaultRoot, r.config, !!params.force);

      return {
        content: [{ type: "text", text: "Compilation prompt queued. The agent will process daily logs and update the knowledge base." }],
        details: {},
      };
    },
  });

  // --- Tool: search_knowledge ---
  pi.registerTool({
    name: "search_knowledge",
    label: "Search Knowledge Base",
    description: "Search the structured knowledge base for a specific keyword or query.",
    parameters: Type.Object({
      query: Type.String({ description: "Keyword or topic to search for" }),
    }) as any,
    async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
      const r = ensureResolved(ctx.cwd);
      const kbDir = path.join(r.vaultRoot, r.config.KNOWLEDGE);

      if (!fs.existsSync(kbDir)) {
        return { content: [{ type: "text", text: "Knowledge base directory not found." }] };
      }

      const indexPath = path.join(kbDir, "index.md");
      let results = "";

      if (fs.existsSync(indexPath)) {
        const indexContent = fs.readFileSync(indexPath, "utf-8");
        const matches = indexContent
          .split("\n")
          .filter((line) => line.toLowerCase().includes(params.query.toLowerCase()));
        if (matches.length > 0) {
          results += `Matches in Index:\n${matches.join("\n")}\n\n`;
        }
      }

      return {
        content: [{
          type: "text",
          text: results || "No direct matches found in the index. Try a different keyword or check recent logs.",
        }],
      };
    },
  });

  // --- Tool: read_knowledge_article ---
  pi.registerTool({
    name: "read_knowledge_article",
    label: "Read Knowledge Article",
    description: "Read the full content of a specific knowledge article slug.",
    parameters: Type.Object({
      slug: Type.String({ description: "The slug of the article to read (e.g. 'm8-workflow')" }),
    }) as any,
    async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
      const r = ensureResolved(ctx.cwd);
      const kbDir = path.join(r.vaultRoot, r.config.KNOWLEDGE);

      const categories = ["concepts", "connections", "qa", "archive"];
      for (const cat of categories) {
        const filePath = path.join(kbDir, cat, `${params.slug}.md`);
        if (fs.existsSync(filePath)) {
          return { content: [{ type: "text", text: fs.readFileSync(filePath, "utf-8") }] };
        }
      }

      return { content: [{ type: "text", text: `Article '${params.slug}' not found.` }] };
    },
  });

  // --- Ready ---
  console.log("[pi-memory-extractor] Extension loaded (v2.0.0 — ExtensionAPI native).");
}
