import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { Text, Container, Markdown } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { PiMemoryConfig } from "../config.js";
import { rebuildKnowledgeIndex, ACTIVE_CATEGORIES } from "../compiler.js";
import { getArticlesToArchive, archiveArticles } from "../archiver.js";

type Resolver = (cwd: string) => { vaultRoot: string; config: PiMemoryConfig };

export function registerVaultTools(pi: ExtensionAPI, resolve: Resolver): void {
  // ── Tool: read_knowledge_article ──────────────────────────────────────────
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
      if (!/^[a-zA-Z0-9_-]+$/.test(params.slug)) {
        return { content: [{ type: "text", text: "Invalid slug." }], status: "error" };
      }
      const r = resolve(ctx.cwd);
      const kbDir = path.join(r.vaultRoot, r.config.knowledge);
      const cats = [
        ...ACTIVE_CATEGORIES,
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

  // ── Tool: cleanup_knowledge_vault ─────────────────────────────────────────
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

  // ── Tool: sync_knowledge_index ────────────────────────────────────────────
  pi.registerTool({
    name: "sync_knowledge_index",
    label: "Sync Knowledge Index",
    description:
      "Scan all category directories and rebuild knowledge/index.md.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const r = resolve(ctx.cwd);
      const indexPath = path.join(r.vaultRoot, r.config.knowledge, "index.md");

      try {
        await rebuildKnowledgeIndex(r.vaultRoot, r.config);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Index rebuild failed: ${(err as Error).message}`,
            },
          ],
          details: { status: "error" },
        };
      }

      return {
        content: [
          { type: "text", text: `Knowledge index rebuilt at ${indexPath}.` },
        ],
        details: { path: indexPath, status: "success" },
      };
    },
  });
}
