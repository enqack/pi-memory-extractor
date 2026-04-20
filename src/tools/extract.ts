import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PiMemoryConfig } from "../config.js";
import { serializeSubprocessTranscript, groupSessionsByDate } from "../extractor.js";
import { spawnExtractionSubprocess } from "../subprocess.js";
import { runCompilation } from "../compiler.js";
import { TODAY } from "../utils.js";

type Resolver = (cwd: string) => { vaultRoot: string; config: PiMemoryConfig };

export function registerExtractTools(
  pi: ExtensionAPI,
  resolve: Resolver,
  getCompilingPending: () => boolean,
  setCompilingPending: (v: boolean) => void,
): void {
  // ── Tool: extract_knowledge ───────────────────────────────────────────────
  pi.registerTool({
    name: "extract_knowledge",
    label: "Extract Session Knowledge",
    description:
      "Trigger knowledge extraction via a foreground subprocess. Use 'all' to process every historical session grouped by date. Use 'from'/'to' (YYYY-MM-DD) for a date range; 'to' defaults to today if omitted.",
    parameters: Type.Object({
      reason: Type.Optional(
        Type.String({ description: "Why extraction is being triggered" }),
      ),
      from: Type.Optional(
        Type.String({ description: "Start date YYYY-MM-DD (inclusive)" }),
      ),
      to: Type.Optional(
        Type.String({
          description: "End date YYYY-MM-DD (inclusive); defaults to today",
        }),
      ),
      all: Type.Optional(
        Type.Boolean({
          description:
            "Process every historical session, grouped by calendar date, writing to per-date daily logs",
        }),
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
            content: [
              {
                type: "text",
                text: `Full extraction complete (${batches.length} day(s)).`,
              },
            ],
            details: { status: "success", days: batches.length },
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Full extraction finished with ${failed}/${batches.length} day(s) failing.`,
            },
          ],
          details: { status: "error", days: batches.length, failed },
        };
      }

      if (params.from) {
        const batches = await groupSessionsByDate(ctx, r.config, {
          from: params.from,
          to: params.to ?? TODAY(),
        });
        if (batches.length === 0) {
          return {
            content: [{ type: "text", text: "No sessions found for that date range." }],
            details: { status: "empty" },
          };
        }

        let failed = 0;
        for (const { date, transcript } of batches) {
          const result = await spawnExtractionSubprocess({
            transcript,
            vaultRoot: r.vaultRoot,
            config: r.config,
            trigger: params.reason ?? "llm_requested_range",
            cwd: ctx.cwd,
            detach: false,
            date,
            signal,
          });
          if (result.exitCode !== 0) failed++;
        }

        if (failed === 0) {
          return {
            content: [
              {
                type: "text",
                text: `Date-range extraction complete (${batches.length} day(s)).`,
              },
            ],
            details: { status: "success", days: batches.length },
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Date-range extraction finished with ${failed}/${batches.length} day(s) failing.`,
            },
          ],
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

  // ── Tool: compile_knowledge ───────────────────────────────────────────────
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
      ctx.ui.setStatus("memory-extractor", "🧠 MemEx: compiling…");
      setCompilingPending(true);
      await runCompilation(pi, ctx, r.vaultRoot, r.config, !!params.force);
      return { content: [{ type: "text", text: "Compilation initiated." }] };
    },
  });
}
