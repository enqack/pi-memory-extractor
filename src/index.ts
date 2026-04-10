import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import { runExtraction } from "./extractor.js";
import { runCompilation } from "./compiler.js";

/**
 * pi-memory-extractor — Proper Pi ExtensionAPI implementation.
 *
 * Pipeline:
 *   session_start      → Inject knowledge index + today's daily log as session context.
 *   before_agent_start → No-op (context already injected at session_start).
 *   session_before_compact → Trigger extraction (fire-and-forget).
 *   session_shutdown   → Trigger extraction (fire-and-forget).
 *
 * Commands:
 *   /compile-knowledge → Manually trigger the knowledge base compiler.
 *   /extract-knowledge → Manually trigger the session knowledge extractor.
 *
 * Tools (callable by the LLM):
 *   compile_knowledge  → Trigger the compiler.
 *   extract_knowledge  → Trigger the extractor.
 *
 * State:
 *   Persisted via pi.appendEntry("memory-extractor-state", { ... }) — no external JSON.
 *
 * Vault root:
 *   Resolved at event-time from ctx.cwd by walking up to find the 'logs/daily' directory.
 *   Falls back to ctx.cwd if not found.
 */

// ---------------------------------------------------------------------------
// Vault-root discovery
// ---------------------------------------------------------------------------

/**
 * Walk up from `startDir` until we find a directory containing CLAUDE.md.
 * Returns that directory, or `startDir` if not found.
 */
function findVaultRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "logs", "daily"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }
  return startDir; // Best-effort fallback
}

// ---------------------------------------------------------------------------
// Context injection helpers
// ---------------------------------------------------------------------------

function TODAY(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Build the session context message injected at session_start.
 * Includes the knowledge index and today's daily log (if they exist).
 */
function buildSessionContext(vaultRoot: string): string | null {
  const knowledgeIndexPath = path.join(vaultRoot, "logs", "knowledge", "index.md");
  const todayLogPath = path.join(vaultRoot, "logs", "daily", `${TODAY()}.md`);

  const parts: string[] = [];

  if (fs.existsSync(knowledgeIndexPath)) {
    const lines = fs.readFileSync(knowledgeIndexPath, "utf-8").trim().split("\n");
    // Show only the header and the last 10 entries of the index to save context
    const recentLines = lines.length > 50 
      ? [...lines.slice(0, 5), "...", "... [truncated for brevity] ...", "...", ...lines.slice(-15)]
      : lines;
    
    parts.push(`## Knowledge Base Index (Recent entries)
${recentLines.join("\n")}

---
If you need to find more specific topics, use the 'search_knowledge' tool.
To read a full article, use 'read_knowledge_article(slug)'.`);
  }

  if (fs.existsSync(todayLogPath)) {
    const content = fs.readFileSync(todayLogPath, "utf-8").trim();
    if (content) {
      parts.push(`## Today's Session Log (${TODAY()})\n\n${content}`);
    }
  }

  if (parts.length === 0) return null;

  return `[Memory Extractor — Session Context]\n\n${parts.join("\n\n---\n\n")}`;
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

interface ExtractorState {
  lastExtractedAt: number;
  lastExtractedEvent: string;
}

function readLastState(pi: ExtensionAPI): ExtractorState | null {
  // We call pi.appendEntry but need to read back entries via ctx.sessionManager.
  // This is done inside session_start where we have ctx. See the event handler.
  return null;
}

// ---------------------------------------------------------------------------
// Main extension factory
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {

  // Module-level vault root cache (set on session_start, reused in other events)
  let vaultRoot: string | null = null;

  // ---------------------------------------------------------------------------
  // session_start — inject context + restore state
  // ---------------------------------------------------------------------------
  pi.on("session_start", async (event, ctx) => {
    // Resolve vault root fresh each session (cwd may change on /new or /resume)
    vaultRoot = findVaultRoot(ctx.cwd);

    vaultRoot = findVaultRoot(ctx.cwd);

    // Restore last-run state from session entries
    const entries = ctx.sessionManager.getEntries();
    for (const entry of entries) {
      if (
        entry.type === "custom" &&
        (entry as any).customType === "memory-extractor-state"
      ) {
        const data = (entry as any).data as ExtractorState;
        if (data?.lastExtractedAt) {
          ctx.ui.setStatus(
            "memory-extractor",
            `last extracted: ${new Date(data.lastExtractedAt).toLocaleTimeString()}`
          );
        }
      }
    }

    // Inject knowledge context into the session (once, at start)
    const contextMessage = buildSessionContext(vaultRoot);
    if (contextMessage) {
      pi.sendMessage(
        {
          customType: "memory-extractor",
          content: contextMessage,
          display: true,
        },
        { triggerTurn: false }
      );
      ctx.ui.notify("[Memory Extractor] Knowledge context injected.", "info");
    } else {
      ctx.ui.notify(
        "[Memory Extractor] No knowledge base or daily log found yet.",
        "info"
      );
    }

    ctx.ui.setStatus("memory-extractor", "idle");
  });

  // ---------------------------------------------------------------------------
  // session_before_compact — extract before compaction
  // ---------------------------------------------------------------------------
  pi.on("session_before_compact", async (_event, ctx) => {
    if (!vaultRoot) vaultRoot = findVaultRoot(ctx.cwd);
    ctx.ui.setStatus("memory-extractor", "extracting…");
    ctx.ui.notify("[Memory Extractor] Capturing knowledge before compaction…", "info");

    // Fire-and-forget — do NOT block compaction
    runExtraction(pi, ctx, vaultRoot, "pre_compact").catch((err) => {
      ctx.ui.notify(
        `[Memory Extractor] Extraction error: ${(err as Error).message}`,
        "error"
      );
    });

    // Persist state entry
    pi.appendEntry("memory-extractor-state", {
      lastExtractedAt: Date.now(),
      lastExtractedEvent: "pre_compact",
    } satisfies ExtractorState);

    ctx.ui.setStatus("memory-extractor", "idle");
    // Return undefined — let compaction proceed normally
  });

  // ---------------------------------------------------------------------------
  // session_shutdown — extract on exit
  // ---------------------------------------------------------------------------
  pi.on("session_shutdown", async (_event, ctx) => {
    if (!vaultRoot) vaultRoot = findVaultRoot(ctx.cwd);
    ctx.ui.setStatus("memory-extractor", "extracting…");

    // Fire-and-forget — do not block shutdown
    runExtraction(pi, ctx, vaultRoot, "session_end").catch(() => {
      // Silently ignore on shutdown — process may exit before this resolves
    });

    pi.appendEntry("memory-extractor-state", {
      lastExtractedAt: Date.now(),
      lastExtractedEvent: "session_end",
    } satisfies ExtractorState);
  });

  // ---------------------------------------------------------------------------
  // Command: /extract-knowledge
  // ---------------------------------------------------------------------------
  pi.registerCommand("extract-knowledge", {
    description: "Manually trigger session knowledge extraction to the daily log",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      if (!vaultRoot) vaultRoot = findVaultRoot(ctx.cwd);

      ctx.ui.setStatus("memory-extractor", "extracting…");
      ctx.ui.notify("[Memory Extractor] Starting extraction…", "info");

      try {
        await runExtraction(pi, ctx, vaultRoot, "manual");
        pi.appendEntry("memory-extractor-state", {
          lastExtractedAt: Date.now(),
          lastExtractedEvent: "manual",
        } satisfies ExtractorState);
        ctx.ui.notify("[Memory Extractor] Extraction prompt sent to agent.", "info");
      } catch (err) {
        ctx.ui.notify(
          `[Memory Extractor] Extraction failed: ${(err as Error).message}`,
          "error"
        );
      } finally {
        ctx.ui.setStatus("memory-extractor", "idle");
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Command: /compile-knowledge
  // ---------------------------------------------------------------------------
  pi.registerCommand("compile-knowledge", {
    description: "Compile daily session logs into structured knowledge base articles",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      if (!vaultRoot) vaultRoot = findVaultRoot(ctx.cwd);

      const force = /--force|-f/.test(args ?? "");

      ctx.ui.setStatus("memory-extractor", "compiling…");
      ctx.ui.notify(`[Memory Compiler] Starting compilation${force ? " (force mode)" : ""}…`, "info");

      try {
        await runCompilation(pi, ctx, vaultRoot, force);
        ctx.ui.notify("[Memory Compiler] Compilation prompt sent to agent.", "info");
      } catch (err) {
        ctx.ui.notify(
          `[Memory Compiler] Compilation failed: ${(err as Error).message}`,
          "error"
        );
      } finally {
        ctx.ui.setStatus("memory-extractor", "idle");
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Tool: extract_knowledge (callable by LLM)
  // ---------------------------------------------------------------------------
  pi.registerTool({
    name: "extract_knowledge",
    label: "Extract Session Knowledge",
    description:
      "Extract the current session's significant knowledge to the daily log " +
      "in logs/daily/. Use this when the conversation has reached a meaningful " +
      "checkpoint and the learnings should be preserved.",
    promptSnippet: "Save current session knowledge to the daily log",
    promptGuidelines: [
      "Use extract_knowledge when the user asks to save, log, or remember session learnings.",
      "Use extract_knowledge before switching topics if significant work was done.",
    ],
    parameters: Type.Object({
      reason: Type.Optional(
        Type.String({
          description: "Optional reason or context for the extraction (e.g. 'checkpoint after refactor')",
        })
      ),
    }) as any,
    async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
      if (!vaultRoot) vaultRoot = findVaultRoot(ctx.cwd);

      const label = params.reason ?? "llm_requested";
      await runExtraction(pi, ctx, vaultRoot, label);

      pi.appendEntry("memory-extractor-state", {
        lastExtractedAt: Date.now(),
        lastExtractedEvent: label,
      } satisfies ExtractorState);

      return {
        content: [
          {
            type: "text",
            text: "Extraction prompt queued. The agent will analyze the session and append findings to the daily log.",
          },
        ],
        details: { triggeredBy: label },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // Tool: compile_knowledge (callable by LLM)
  // ---------------------------------------------------------------------------
  pi.registerTool({
    name: "compile_knowledge",
    label: "Compile Knowledge Base",
    description:
      "Compile extracted daily session logs into structured, interconnected knowledge " +
      "articles in logs/knowledge/. Updates index.md and appends to log.md.",
    promptSnippet: "Compile daily logs into the structured knowledge base",
    promptGuidelines: [
      "Use compile_knowledge when the user asks to update or compile the knowledge base.",
      "Run compile_knowledge after a series of extract_knowledge calls to synthesize learnings.",
    ],
    parameters: Type.Object({
      force: Type.Optional(
        Type.Boolean({
          description: "If true, re-process all daily logs even if they have already been compiled.",
        })
      ),
    }) as any,
    async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
      if (!vaultRoot) vaultRoot = findVaultRoot(ctx.cwd);

      await runCompilation(pi, ctx, vaultRoot, !!params.force);

      return {
        content: [
          {
            type: "text",
            text: "Compilation prompt queued. The agent will process daily logs and update the knowledge base.",
          },
        ],
        details: {},
      };
    },
  });

  // ---------------------------------------------------------------------------
  // Tool: search_knowledge (callable by LLM)
  // ---------------------------------------------------------------------------
  pi.registerTool({
    name: "search_knowledge",
    label: "Search Knowledge Base",
    description: "Search the structured knowledge base for a specific keyword or query.",
    parameters: Type.Object({
      query: Type.String({ description: "Keyword or topic to search for" }),
    }) as any,
    async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
      if (!vaultRoot) vaultRoot = findVaultRoot(ctx.cwd);
      const kbDir = path.join(vaultRoot, "logs", "knowledge");
      
      if (!fs.existsSync(kbDir)) {
          return { content: [{ type: "text", text: "Knowledge base directory not found." }] };
      }

      // We use a simple glob/grep approach to find matches in the index or article bodies
      const indexPath = path.join(kbDir, "index.md");
      let results = "";
      
      if (fs.existsSync(indexPath)) {
          const indexContent = fs.readFileSync(indexPath, "utf-8");
          const matches = indexContent.split("\n").filter(line => 
              line.toLowerCase().includes(params.query.toLowerCase())
          );
          if (matches.length > 0) {
              results += `Matches in Index:\n${matches.join("\n")}\n\n`;
          }
      }

      return {
          content: [{ 
              type: "text", 
              text: results || "No direct matches found in the index. Try a different keyword or check recent logs." 
          }]
      };
    },
  });

  // ---------------------------------------------------------------------------
  // Tool: read_knowledge_article (callable by LLM)
  // ---------------------------------------------------------------------------
  pi.registerTool({
    name: "read_knowledge_article",
    label: "Read Knowledge Article",
    description: "Read the full content of a specific knowledge article slug.",
    parameters: Type.Object({
      slug: Type.String({ description: "The slug of the article to read (e.g. 'm8-workflow')" }),
    }) as any,
    async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
      if (!vaultRoot) vaultRoot = findVaultRoot(ctx.cwd);
      const kbDir = path.join(vaultRoot, "logs", "knowledge");

      // Search across categories
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

  // ---------------------------------------------------------------------------
  // Ready
  // ---------------------------------------------------------------------------
  console.log("[pi-memory-extractor] Extension loaded (v2.0.0 — ExtensionAPI native).");
}
