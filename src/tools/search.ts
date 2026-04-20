import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { Text, Container, Spacer } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { PiMemoryConfig } from "../config.js";
import { ACTIVE_CATEGORIES } from "../compiler.js";
import { searchMarkdownTree, SearchResultFile } from "../search.js";

type Resolver = (cwd: string) => { vaultRoot: string; config: PiMemoryConfig };

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

function renderFullTextSearchResult(
  result: any,
  { expanded }: { expanded: boolean },
  theme: any,
) {
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
    new Text(theme.fg("accent", theme.bold(`Search: "${query}"`)), 1, 0),
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

export function registerSearchTools(pi: ExtensionAPI, resolve: Resolver): void {
  // ── Tool: search_index ────────────────────────────────────────────────────
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

  // ── Tool: search_articles ─────────────────────────────────────────────────
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

  // ── Tool: search_knowledge ────────────────────────────────────────────────
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
}
