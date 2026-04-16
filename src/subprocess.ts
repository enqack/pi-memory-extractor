import { spawn } from "node:child_process";
import * as os from "node:os";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { renderTemplate } from "./templates.js";
import { PiMemoryConfig } from "./config.js";
import { TODAY, NOW_TIME } from "./utils.js";

/**
 * Resolve the correct command + args to invoke the pi CLI.
 *
 * When pi is run as a Node/Bun script, we re-invoke through the same runtime
 * so extensions are loaded correctly. Otherwise we call the `pi` binary.
 */
function getPiInvocation(piArgs: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  if (currentScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...piArgs] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  if (/^(node|bun)(\.exe)?$/.test(execName)) {
    // Generic runtime — can't re-use it without a script path
    return { command: "pi", args: piArgs };
  }
  // pi is a compiled binary
  return { command: process.execPath, args: piArgs };
}

export interface ExtractionSubprocessResult {
  exitCode: number;
  stderr: string;
}

export interface SpawnExtractionOpts {
  /** Pre-serialized session transcript written to a temp file. */
  transcript: string;
  /** Absolute path to the vault root directory. */
  vaultRoot: string;
  /** Resolved extension config. */
  config: PiMemoryConfig;
  /** Human-readable label for the trigger (included in the task prompt). */
  trigger: string;
  /** Working directory for the subprocess. */
  cwd: string;
  /**
   * Target date for the daily log (YYYY-MM-DD). Defaults to TODAY().
   * Pass the session's calendar date when running batch extraction so each
   * day's knowledge lands in the correct daily log.
   */
  date?: string;
  /**
   * When true, spawn a detached process and return null immediately.
   * Use for session_shutdown and session_compact so extraction survives
   * parent exit.
   */
  detach?: boolean;
  /** AbortSignal — only honoured when detach is false. */
  signal?: AbortSignal;
  /** Callback for each stdout line — only fires when detach is false. */
  onOutput?: (line: string) => void;
}

export async function spawnExtractionSubprocess(
  opts: SpawnExtractionOpts & { detach: true },
): Promise<null>;
export async function spawnExtractionSubprocess(
  opts: SpawnExtractionOpts & { detach?: false },
): Promise<ExtractionSubprocessResult>;
export async function spawnExtractionSubprocess(
  opts: SpawnExtractionOpts,
): Promise<ExtractionSubprocessResult | null> {
  const today = opts.date ?? TODAY();
  const time = NOW_TIME();
  const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "pi-mem-extract-"));

  // Write transcript to a temp file to avoid argv size limits.
  const transcriptPath = path.join(tmpDir, "transcript.md");
  await withFileMutationQueue(transcriptPath, () =>
    fsPromises.writeFile(transcriptPath, opts.transcript, "utf-8"),
  );

  // Render and write the extraction agent system prompt.
  const systemPromptContent = renderTemplate("extraction-agent", { today, time, vaultRoot: opts.vaultRoot });
  const systemPromptPath = path.join(tmpDir, "extraction-agent.md");
  await withFileMutationQueue(systemPromptPath, () =>
    fsPromises.writeFile(systemPromptPath, systemPromptContent, { encoding: "utf-8", mode: 0o600 }),
  );

  // Task message that kicks off the subprocess agent.
  const task = [
    `Trigger: ${opts.trigger}`,
    `Vault root: ${opts.vaultRoot}`,
    `Transcript file: ${transcriptPath}`,
    `Today: ${today}`,
    `Time: ${time}`,
    "",
    "Read the transcript file, then extract and record knowledge into the vault.",
  ].join("\n");

  const piArgs: string[] = [
    "--mode", "json",
    "-p",
    "--no-session",
    "--tools", opts.config.subprocessTools,
  ];

  if (opts.config.subprocessModel) {
    piArgs.push("--model", opts.config.subprocessModel);
  }

  piArgs.push("--append-system-prompt", systemPromptPath, task);

  const invocation = getPiInvocation(piArgs);

  // ── Detached mode: fire-and-forget ───────────────────────────────────────
  if (opts.detach) {
    const proc = spawn(invocation.command, invocation.args, {
      cwd: opts.cwd,
      shell: false,
      detached: true,
      stdio: "ignore",
    });
    proc.unref();
    // Temp files intentionally left in /tmp — the subprocess reads them
    // before the OS reclaims them.
    return null;
  }

  // ── Foreground mode: await completion ────────────────────────────────────
  try {
    return await new Promise<ExtractionSubprocessResult>((resolve) => {
      const proc = spawn(invocation.command, invocation.args, {
        cwd: opts.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";
      let lineBuffer = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) opts.onOutput?.(line);
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        if (lineBuffer.trim()) opts.onOutput?.(lineBuffer);
        resolve({ exitCode: code ?? 1, stderr });
      });

      proc.on("error", (err) => {
        resolve({ exitCode: 1, stderr: err.message });
      });

      if (opts.signal) {
        const kill = () => {
          proc.kill("SIGTERM");
          setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
        };
        if (opts.signal.aborted) kill();
        else opts.signal.addEventListener("abort", kill, { once: true });
      }
    });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
