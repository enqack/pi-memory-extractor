import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { runExtraction, serializeTranscript } from "./extractor.js";
import { runCompilation } from "./compiler.js";
import { getResolvedConfig, PiMemoryConfig, ensureVaultStructure } from "./config.js";
import {
  TODAY,
  findVaultRoot,
  extractKeywords,
  getArticleSummary,
} from "./utils.js";
import { getArticlesToArchive, archiveArticles } from "./archiver.js";

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
  } catch (err) {
    if ((err as any).code !== "ENOENT") {
      ctx.ui.notify(`[Memory Extractor] Warning: Could not read Knowledge Index: ${(err as Error).message}`, "warn");
    }
  }

  // --- 2. Today's Daily Log ---
  try {
    const content = await fsPromises.readFile(todayLogPath, "utf-8");
    if (content.trim()) {
      parts.push(`## Today's Session Log (${TODAY()})\n\n${content.trim()}`);
    }
  } catch (err) {
    if ((err as any).code !== "ENOENT") {
      ctx.ui.notify(`[Memory Extractor] Warning: Could not read Daily Log: ${(err as Error).message}`, "warn");
    }
  }

  // --- 3. Smart Recall (Semantic Injection) ---
  try {
    const branch = ctx.sessionManager.getBranch();
    const recentHistory = branch.slice(-10); // Look at last 10 entries
    let keywordTargetText = "";
    
    for (const entry of recentHistory) {
      if (entry.type === "message") {
        const msg = entry.message as any;
        if (typeof msg.content === "string") {
          keywordTargetText += " " + msg.content;
        }
      }
    }

    if (keywordTargetText.trim().length > 0) {
      const keywords = extractKeywords(keywordTargetText);
      const indexPath = path.join(vaultRoot, config.KNOWLEDGE, "index.md");
      const kbDir = path.join(vaultRoot, config.KNOWLEDGE);

      if (fs.existsSync(indexPath) && keywords.length > 0) {
        const indexLines = fs.readFileSync(indexPath, "utf-8").split("\n");
        const matches: { slug: string; line: string; score: number }[] = [];

        for (const line of indexLines) {
          if (!line.startsWith("- [[")) continue;
          
          const slugMatch = line.match(/\[\[(.*?)\]\]/);
          if (!slugMatch) continue;
          const slug = slugMatch[1];
          const lowerLine = line.toLowerCase();
          
          let score = 0;
          for (const kw of keywords) {
            if (lowerLine.includes(kw)) score++;
          }

          if (score > 0) {
            matches.push({ slug, line, score });
          }
        }

        // Sort by score and take top 3
        matches.sort((a, b) => b.score - a.score);
        const topMatches = matches.slice(0, 3);

        if (topMatches.length > 0) {
          parts.push(`## Active Memories (Surgically Recalled)`);
          for (const match of topMatches) {
            // Try to find the file in concepts, connections, or qa
            const categories = ["concepts", "connections", "qa"];
            let foundSummary = false;
            
            for (const cat of categories) {
              const articlePath = path.join(kbDir, cat, `${match.slug}.md`);
              const summary = getArticleSummary(articlePath);
              if (summary) {
                parts.push(`### Memory: [[${match.slug}]]\n${summary}`);
                foundSummary = true;
                break;
              }
            }

            if (!foundSummary) {
              parts.push(`- [[${match.slug}]] (Reference only)`);
            }
          }
        }
      }
    }
  } catch (e) {
    ctx.ui.notify(`[Memory Extractor] Warning: Smart Recall failed: ${(e as Error).message}`, "warn");
    console.error(`[Memory Extractor] Smart Recall failed: ${e}`);
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
  pendingExtractionTranscript: string | null;
  lastExtractionAt: number;
}

// --- Extension factory ---

export default function (pi: ExtensionAPI) {
  let vaultRoot: string | null = null;
  let config: PiMemoryConfig | null = null;

  const state: ExtensionState = {
    isCompacting: false,
    pendingExtractionTranscript: null,
    lastExtractionAt: 0,
  };

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

    // Ensure vault structure exists
    const created = ensureVaultStructure(vaultRoot, config);
    if (created) {
      ctx.ui.notify("[Memory Extractor] Initialized new knowledge vault structure.", "info");
    }

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

    // Capture the transcript BEFORE it is truncated by compaction
    const transcript = serializeTranscript(ctx.sessionManager.getBranch());
    if (transcript.trim()) {
      state.pendingExtractionTranscript = transcript;
    }
  });

  // --- session_compact ---
  pi.on("session_compact", async (_event, ctx) => {
    state.isCompacting = false;
    ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");

    // Trigger any pending extraction after compaction is finished and context is clean
    if (state.pendingExtractionTranscript) {
      // Anti-loop Guard: Don't trigger if we extracted in the last 5 minutes
      const COOLDOWN_MS = 5 * 60 * 1000;
      const now = Date.now();
      if (now - state.lastExtractionAt < COOLDOWN_MS) {
        ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle (cooldown)");
        ctx.ui.notify("[Memory Extractor] Skipped auto-extraction: Cooling down from a recent session trigger.", "info");
        state.pendingExtractionTranscript = null;
        return;
      }

      state.lastExtractionAt = now;
      const r = ensureResolved(ctx.cwd);
      const transcript = state.pendingExtractionTranscript;
      state.pendingExtractionTranscript = null;

      runExtraction(pi, ctx, r.vaultRoot, r.config, "pre_compact", transcript, false).catch((err) => {
        ctx.ui.notify(`[Memory Extractor] Deferred extraction error: ${(err as Error).message}`, "error");
      });
    }
  });

  // --- session_shutdown ---
  pi.on("session_shutdown", async (_event, ctx) => {
    const r = ensureResolved(ctx.cwd);
    ctx.ui.setStatus("memory-extractor", "🧠 MemEx: extracting…");

    const transcript = serializeTranscript(ctx.sessionManager.getBranch());
    runExtraction(pi, ctx, r.vaultRoot, r.config, "session_end", transcript, false).catch(() => {
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
        const result = await runExtraction(pi, ctx, r.vaultRoot, r.config, "manual", undefined, deep);
        
        if (result === "sent") {
          pi.appendEntry("memory-extractor-state", {
            lastExtractedAt: Date.now(),
            lastExtractedEvent: deep ? "manual_deep" : "manual",
          } satisfies ExtractorState);
          ctx.ui.notify("[Memory Extractor] Extraction prompt sent to agent.", "info");
        } else if (result === "empty") {
          ctx.ui.notify("[Memory Extractor] Nothing new to extract from this session history.", "info");
        } else {
          ctx.ui.notify("[Memory Extractor] Extraction failed to render or send.", "error");
        }
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
      
      const result = await runExtraction(pi, ctx, r.vaultRoot, r.config, label, undefined, !!params.deep);

      if (result === "sent") {
        pi.appendEntry("memory-extractor-state", {
          lastExtractedAt: Date.now(),
          lastExtractedEvent: label,
        } satisfies ExtractorState);
        return {
          content: [{ type: "text", text: "Extraction prompt queued. The agent will analyze the session and append findings to the daily log." }],
          details: { triggeredBy: label, status: "sent" },
        };
      } else {
        return {
          content: [{ type: "text", text: result === "empty" ? "No significant new knowledge found to extract." : "Extraction failed." }],
          details: { triggeredBy: label, status: result },
        };
      }
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

  // --- Tool: cleanup_knowledge_vault ---
  pi.registerTool({
    name: "cleanup_knowledge_vault",
    label: "Cleanup Knowledge Vault",
    description:
      "Move articles older than 6 months from concepts/, connections/, and qa/ into the archive/ folder.",
    promptSnippet: "Move old knowledge base articles to the archive",
    parameters: Type.Object({}) as any,
    async execute(_toolCallId, _params: any, _signal, _onUpdate, ctx) {
      const r = ensureResolved(ctx.cwd);
      
      const toArchive = getArticlesToArchive(r.vaultRoot, r.config);
      if (toArchive.length === 0) {
        return {
          content: [{ type: "text", text: "No articles older than 6 months found. Clean as a whistle!" }],
          details: { found: 0 },
        };
      }

      const archivedCount = archiveArticles(r.vaultRoot, r.config, toArchive);
      
      ctx.ui.notify(`[Memory Extractor] Archived ${archivedCount} old knowledge articles.`, "info");
      
      return {
        content: [{ type: "text", text: `Successfully archived ${archivedCount} article(s).` }],
        details: { archived: archivedCount, paths: toArchive },
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
        return {
          content: [{ type: "text", text: "Knowledge base directory not found." }],
          details: {},
        };
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
        content: [
          {
            type: "text",
            text:
              results ||
              "No direct matches found in the index. Try a different keyword or check recent logs.",
          },
        ],
        details: { query: params.query },
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
          return {
            content: [{ type: "text", text: fs.readFileSync(filePath, "utf-8") }],
            details: { slug: params.slug, category: cat },
          };
        }
      }

      return {
        content: [{ type: "text", text: `Article '${params.slug}' not found.` }],
        details: { slug: params.slug, found: false },
      };
    },
  });

  // --- Ready ---
  console.log("[pi-memory-extractor] Extension loaded (v2.0.0 — ExtensionAPI native).");
}
