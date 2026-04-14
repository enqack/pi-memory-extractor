import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text, Container, Spacer, Markdown, Box } from "@mariozechner/pi-tui";
import { getMarkdownTheme, DynamicBorder, isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { serializeTranscript, serializeDeepTranscript } from "./extractor.js";
import { runCompilation } from "./compiler.js";
import { getResolvedConfig, PiMemoryConfig, ensureVaultStructure } from "./config.js";
import {
  TODAY,
  findVaultRoot,
  extractKeywords,
  getArticleSummary,
} from "./utils.js";
import { getArticlesToArchive, archiveArticles } from "./archiver.js";
import { SynthesisTabs } from "./tui.js";
import { MemoryOrchestrator } from "./orchestrator.js";

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
            // Try to find the file in concepts, connections, qa, lessons-learned, or cursed-knowledge
            const categories = ["concepts", "connections", "qa", "lessons-learned", "cursed-knowledge"];
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

/**
 * Strips leading thinking/whitespace to ensure YAML starts at line 0.
 */
function repairObsidianContent(text: string): string {
  const firstFrontmatterIndex = text.indexOf("---\n");
  if (firstFrontmatterIndex > 0) {
    const leadingText = text.substring(0, firstFrontmatterIndex).trim();
    // Only strip if the leading text looks like accidental LLM chatter
    // (doesn't contain other markdown headings, etc.)
    if (leadingText.length < 1000 && !leadingText.includes("# ")) {
      return text.substring(firstFrontmatterIndex);
    }
  }
  return text;
}

/**
 * Ensures wikilinks in frontmatter are quoted.
 */
function quoteWikilinks(content: string): string {
  const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---\n/);
  if (!frontmatterMatch) return content;

  let fm = frontmatterMatch[1];
  const lines = fm.split("\n");
  const fixedLines = lines.map(line => {
    // Ensure all [[wikilinks]] are wrapped in double quotes.
    // Handles [[link]], "[[link]]", [[link]]", etc.
    return line.replace(/"?(\[\[.*?\]\])"?/g, '"$1"');
  });

  const newFm = fixedLines.join("\n");
  return content.replace(frontmatterMatch[1], newFm);
}

// --- Extension factory ---

export default function (pi: ExtensionAPI) {
  let vaultRoot: string | null = null;
  let config: PiMemoryConfig | null = null;
  const orchestrator = new MemoryOrchestrator(pi);

  // Helper to lazily ensure config + vaultRoot are resolved
  function ensureResolved(cwd: string): { vaultRoot: string; config: PiMemoryConfig } {
    if (!config) config = getResolvedConfig(cwd);
    if (!vaultRoot) vaultRoot = findVaultRoot(cwd, config);
    orchestrator.setContext(vaultRoot, config);
    return { vaultRoot, config };
  }

  // --- Resource Discovery ---
  pi.on("resources_discover", async () => {
    return {
      skillPaths: [path.join(__dirname, "..", "skills")],
    };
  });

  // --- Frontmatter Enforcement & Repair ---
  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("write", event)) {
      const { path: filePath } = event.input;
      let { content } = event.input;

      if (filePath.endsWith(".md") && filePath.includes("knowledge/")) {
        // 1. Repair leading thoughts
        const repaired = repairObsidianContent(content);
        if (repaired !== content) {
          content = repaired;
          event.input.content = content;
        }

        // 2. Quote wikilinks
        const quoted = quoteWikilinks(content);
        if (quoted !== content) {
          content = quoted;
          event.input.content = content;
        }

        // 3. Final check
        if (!content.startsWith("---\n")) {
          return {
            block: true,
            reason: `Rejected: Markdown file "${filePath}" must start with YAML frontmatter (---). Found: ${content.substring(0, 50).replace(/\n/g, "\\n")}...`,
          };
        }
      }
    }

    if (isToolCallEventType("edit", event)) {
        const { path: filePath, edits } = event.input;
        if (filePath.endsWith(".md") && filePath.includes("knowledge/")) {
            for (const edit of edits) {
                // If the edit is likely touching the frontmatter (line 0 or contains ---)
                if (edit.newText.includes("---") || edit.oldText === "" /* insertion at start? */) {
                    edit.newText = quoteWikilinks(edit.newText);
                }
            }
        }
    }
  });

  // --- session_start ---
  pi.on("session_start", async (event, ctx) => {
    const r = ensureResolved(ctx.cwd);

    // Ensure vault structure exists
    const created = ensureVaultStructure(r.vaultRoot, r.config);
    if (created) {
      ctx.ui.notify("[Memory Extractor] Initialized new knowledge vault structure.", "info");
    }

    // Restore orchestrator state
    await orchestrator.restoreState(ctx);
    const state = orchestrator.getState();
    if (state.step !== "idle") {
      ctx.ui.setStatus("memory-extractor", `🧠 MemEx: ${state.step}...`);
      ctx.ui.notify(`[Memory Extractor] Resuming knowledge extraction work (${state.step}).`, "info");
    }

    const contextMessage = await buildSessionContext(r.vaultRoot, r.config, ctx);
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

    if (state.step === "idle") {
      ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
    }
  });

  // --- agent_end ---
  pi.on("agent_end", async (event, ctx) => {
    const state = orchestrator.getState();
    const branch = ctx.sessionManager.getBranch();
    const lastAssistantMsg = [...branch].reverse().find(e => e.type === "message" && e.message.role === "assistant");
    
    // If we are in analysis or mapping, we advance automatically after the agent finishes its response
    if (state.step === "analysis" || state.step === "mapping") {
        await orchestrator.advanceWorkflow(ctx);
    } else if (state.step === "idle" && lastAssistantMsg) {
        // Reactive Trigger: Detect Self-Correction or Explicit Decisions
        const content = typeof lastAssistantMsg.message.content === "string" 
          ? lastAssistantMsg.message.content 
          : JSON.stringify(lastAssistantMsg.message.content);
        
        const hasCorrection = /correction|actually|instead|wait|correction:|self-correction/i.test(content);
        const hasDecision = /decided|decision|settled on|from now on|policy/i.test(content);
        
        if (hasCorrection || hasDecision) {
            console.log(`[Memory Extractor] Reactive trigger hit (Correction: ${hasCorrection}, Decision: ${hasDecision}). Starting extraction.`);
            const transcript = serializeTranscript(branch);
            orchestrator.startExtraction(ctx, hasCorrection ? "reactive_correction" : "reactive_decision", transcript, false).catch(() => {});
        }
    }
  });

  // --- session_before_compact ---
  pi.on("session_before_compact", async (_event, ctx) => {
    ctx.ui.setStatus("memory-extractor", "🧠 MemEx: waiting for compaction…");
  });

  // --- session_compact ---
  pi.on("session_compact", async (_event, ctx) => {
    const r = ensureResolved(ctx.cwd);
    const transcript = serializeTranscript(ctx.sessionManager.getBranch());
    
    if (transcript.trim()) {
      orchestrator.startExtraction(ctx, "compaction", transcript, false).catch((err) => {
        ctx.ui.notify(`[Memory Extractor] Orchestration error: ${(err as Error).message}`, "error");
      });
    } else {
      ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
    }
  });

  // --- session_shutdown ---
  pi.on("session_shutdown", async (_event, ctx) => {
    const r = ensureResolved(ctx.cwd);
    const transcript = serializeTranscript(ctx.sessionManager.getBranch());
    if (transcript.trim()) {
      orchestrator.startExtraction(ctx, "shutdown", transcript, false).catch(() => {});
    }
  });

  // --- Command: /extract-knowledge ---
  pi.registerCommand("extract-knowledge", {
    description: "Manually trigger session knowledge extraction via Orchestrator",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const r = ensureResolved(ctx.cwd);
      const deep = /--deep/.test(args ?? "");
      
      const transcript = deep 
        ? await serializeDeepTranscript(ctx)
        : serializeTranscript(ctx.sessionManager.getBranch());

      if (!transcript.trim()) {
        ctx.ui.notify("[Memory Extractor] Nothing new to extract from this session context.", "info");
        return;
      }

      ctx.ui.notify(`[Memory Extractor] Starting ${deep ? "deep " : ""}orchestrated extraction…`, "info");
      await orchestrator.startExtraction(ctx, "manual", transcript, deep);
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

  // --- Tool: submit_knowledge_synthesis ---
  pi.registerTool({
    name: "submit_knowledge_synthesis",
    label: "Submit Synthesized Knowledge",
    description: "Submit the final JSON packet of synthesized knowledge from the 3-step extraction workflow.",
    parameters: Type.Object({
      knowledge_title: Type.String({ description: "Descriptive title for the knowledge packet" }),
      source_summary: Type.String({ description: "Concise summary of learnings" }),
      themes: Type.Array(Type.Object({
        theme: Type.String(),
        summary: Type.String(),
        confidence: Type.Number({ minimum: 0, maximum: 1, default: 0.8, description: "Confidence score (0.0 - 1.0)" }),
        memory_type: StringEnum(["fact", "preference", "goal", "correction", "pattern"] as const, { description: "Type of memory extracted" })
      })),
      relationships: Type.Array(Type.Object({
        entity_a: Type.String(),
        relationship_type: Type.String(),
        entity_b: Type.String(),
        evidence_quote: Type.String(),
        confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1, default: 0.8 }))
      })),
      actionable_takeaways: Type.Array(Type.Object({
        priority: StringEnum(["High", "Medium", "Low"] as const, { description: "High, Medium, or Low" }),
        action: Type.String(),
        owner: Type.String()
      })),
      deep_thoughts: Type.Optional(Type.Array(Type.Object({
        topic: Type.String({ description: "The title or topic of the deep thought" }),
        content: Type.String({ description: "The full Jack Handey-style absurdist reflection" })
      })))
    }),
    renderResult(result, { expanded, tui }, theme) {
      if (!expanded) {
        return new Text(theme.fg("success", "✓ Knowledge synthesis received"), 0, 0);
      }
      
      const tabs = new SynthesisTabs(result.details?.params, theme);
      return {
        render: (w) => tabs.render(w),
        invalidate: () => tabs.invalidate(),
        handleInput: (data) => tabs.handleInput(data, tui),
      };
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ensureResolved(ctx.cwd);
      await orchestrator.processStepResult(ctx, params);
      return {
        content: [{ type: "text", text: "Knowledge packet received and processed by Orchestrator." }],
        details: { status: "received", params },
      };
    },
  });

  // --- Tool: extract_knowledge (Triggers Orchestrator) ---
  pi.registerTool({
    name: "extract_knowledge",
    label: "Extract Session Knowledge",
    description: "Manually trigger the orchestrated knowledge extraction workflow.",
    parameters: Type.Object({
      reason: Type.Optional(Type.String({ description: "Context for extraction" })),
      deep: Type.Optional(Type.Boolean({ description: "Scan all historical sessions" })),
    }),
    renderResult(result: any, { expanded }, theme) {
      const status = result.details?.status || "unknown";
      if (status === "started") {
        return new Text(theme.fg("success", "✓ Extraction workflow started"), 0, 0);
      }
      return new Text(theme.fg("warn", `Status: ${status}`), 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const r = ensureResolved(ctx.cwd);
      const transcript = params.deep
        ? await serializeDeepTranscript(ctx)
        : serializeTranscript(ctx.sessionManager.getBranch());

      if (!transcript.trim()) {
        return {
          content: [{ type: "text", text: "No knowledge found to extract." }],
          details: { status: "empty" },
        };
      }

      await orchestrator.startExtraction(ctx, params.reason ?? "llm_requested", transcript, !!params.deep);
      return {
        content: [{ type: "text", text: "Orchestration workflow started." }],
        details: { status: "started" },
      };
    },
  });

  // --- Tool: compile_knowledge ---
  pi.registerTool({
    name: "compile_knowledge",
    label: "Compile Knowledge Base",
    description: "Compile daily logs into the structured knowledge base.",
    parameters: Type.Object({
      force: Type.Optional(Type.Boolean()),
    }),
    renderResult(_result, _options, theme) {
      return new Text(theme.fg("success", "✓ Compilation initiated"), 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const r = ensureResolved(ctx.cwd);
      await runCompilation(pi, ctx, r.vaultRoot, r.config, !!params.force);
      return {
        content: [{ type: "text", text: "Compilation initiated." }],
        details: {},
      };
    },
  });

  // --- Utility Tools (Search, Archive, etc.) ---

  pi.registerTool({
    name: "cleanup_knowledge_vault",
    label: "Cleanup Knowledge Vault",
    description: "Archive old knowledge articles.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const r = ensureResolved(ctx.cwd);
      const toArchive = getArticlesToArchive(r.vaultRoot, r.config);
      if (toArchive.length === 0) return { content: [{ type: "text", text: "Nothing to archive." }] };
      const count = archiveArticles(r.vaultRoot, r.config, toArchive);
      return { content: [{ type: "text", text: `Archived ${count} articles.` }] };
    },
  });

  pi.registerTool({
    name: "search_knowledge",
    label: "Search Knowledge Base",
    parameters: Type.Object({ query: Type.String() }),
    renderResult(result: any, { expanded, tui }, theme) {
      const content = result.content?.[0]?.text || "";
      if (!expanded) {
        const matches = content.split("\n").filter(l => l.trim().length > 0 && !l.includes("No matches"));
        return new Text(theme.fg("success", `🔍 Found ${matches.length} matches for "${result.details?.query || ""}"`), 0, 0);
      }
      const container = new Container();
      container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
      container.addChild(new Text(theme.fg("accent", theme.bold(`Search Results for "${result.details?.query || ""}"`)), 1, 0));
      container.addChild(new Spacer(1));
      
      const lines = content.split("\n").filter(l => l.trim().length > 0);
      if (lines.length > 0 && !content.includes("No matches")) {
          for (const line of lines) {
              container.addChild(new Text(theme.fg("text", line), 1, 0));
          }
      } else {
          container.addChild(new Text(theme.fg("dim", "  No articles found matching this query."), 1, 0));
      }
      
      container.addChild(new Spacer(1));
      container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
      return container;
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const r = ensureResolved(ctx.cwd);
      const indexPath = path.join(r.vaultRoot, r.config.KNOWLEDGE, "index.md");
      if (!fs.existsSync(indexPath)) return { content: [{ type: "text", text: "No index found." }] };
      const content = fs.readFileSync(indexPath, "utf-8");
      const matches = content.split("\n").filter(l => l.toLowerCase().includes(params.query.toLowerCase()));
      return { 
        content: [{ type: "text", text: matches.join("\n") || "No matches." }],
        details: { query: params.query }
      };
    },
  });

  pi.registerTool({
    name: "read_knowledge_article",
    label: "Read Knowledge Article",
    parameters: Type.Object({ slug: Type.String() }),
    renderResult(result: any, { expanded }, theme) {
      if (!expanded || result.status === "error") {
        return new Text(result.content?.[0]?.text?.substring(0, 50) || "Not found", 0, 0);
      }
      const container = new Container();
      const mdTheme = getMarkdownTheme();
      const content = result.content?.[0]?.text || "";
      container.addChild(new Markdown(content, 0, 0, mdTheme));
      return container;
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const r = ensureResolved(ctx.cwd);
      const kbDir = path.join(r.vaultRoot, r.config.KNOWLEDGE);
      const cats = ["concepts", "connections", "qa", "lessons-learned", "cursed-knowledge", "archive"];
      for (const cat of cats) {
        const p = path.join(kbDir, cat, `${params.slug}.md`);
        if (fs.existsSync(p)) return { content: [{ type: "text", text: fs.readFileSync(p, "utf-8") }] };
      }
      return { content: [{ type: "text", text: "Not found." }] };
    },
  });

  console.log("[pi-memory-extractor] Extension loaded (Orchestrator Mode).");
}
