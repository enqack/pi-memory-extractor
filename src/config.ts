import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { logger } from "./logger.js";

/**
 * Interface representing the extension configuration.
 * All paths are relative to the vault root unless specified.
 */
export interface PiMemoryConfig {
  vaultRoot: string;
  daily: string;
  knowledge: string;
  deepThoughts: string;
  reports: string;

  // Extraction Limits (used for context-injection & legacy paths)
  maxHistoryMessages: number;
  maxMessageChars: number;
  maxToolResultChars: number;
  maxPartsPerMessage: number;
  globalMaxChars: number;
  deepExtractMaxChars: number;

  // Subprocess Extraction
  /** Total character budget for the transcript passed to the extraction subprocess. Default: 200000. */
  subprocessMaxChars: number;
  /** Comma-separated list of pi tools available to the extraction subprocess. */
  subprocessTools: string;
  /** Optional model override for the extraction subprocess (e.g. "claude-haiku-4-5" for speed). */
  subprocessModel?: string;
}

const CONFIG_FILENAME = "pi-memory.json";
const DOT_CONFIG_FILENAME = ".pi-memory.json";

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: PiMemoryConfig = {
  vaultRoot: "knowledge-base",
  daily: "daily",
  knowledge: "knowledge",
  deepThoughts: "deep-thoughts",
  reports: "reports",

  maxHistoryMessages: 50,
  maxMessageChars: 1000,
  maxToolResultChars: 200,
  maxPartsPerMessage: 15,
  globalMaxChars: 15000,
  deepExtractMaxChars: 100000,

  subprocessMaxChars: 200000,
  subprocessTools: "read,write,edit,grep,find,bash",
};

/**
 * Loads and merges configuration from System, User, and Project levels.
 * Precedence: Project > User > System > Internal Defaults.
 */
export function getResolvedConfig(projectCwd: string): PiMemoryConfig {
  const systemConfig = loadSystemConfig();
  const userConfig = loadUserConfig();
  const projectConfig = loadProjectConfig(projectCwd);

  return {
    ...DEFAULT_CONFIG,
    ...systemConfig,
    ...userConfig,
    ...projectConfig,
  };
}

function loadSystemConfig(): Partial<PiMemoryConfig> {
  const systemPath = "/etc/pi-memory.json";
  return readJsonFile(systemPath);
}

function loadUserConfig(): Partial<PiMemoryConfig> {
  const home = os.homedir();

  // Try ~/.config/pi-memory.json first
  const xdgConfigPath = path.join(home, ".config", CONFIG_FILENAME);
  const xdgConfig = readJsonFile(xdgConfigPath);
  if (Object.keys(xdgConfig).length > 0) return xdgConfig;

  // Fallback to ~/.pi-memory.json
  const dotHomePath = path.join(home, DOT_CONFIG_FILENAME);
  return readJsonFile(dotHomePath);
}

function loadProjectConfig(startDir: string): Partial<PiMemoryConfig> {
  let dir = startDir;

  for (let i = 0; i < 6; i++) {
    const configPath = path.join(dir, CONFIG_FILENAME);
    const dotConfigPath = path.join(dir, DOT_CONFIG_FILENAME);

    if (fs.existsSync(configPath)) return readJsonFile(configPath);
    if (fs.existsSync(dotConfigPath)) return readJsonFile(dotConfigPath);

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return {};
}

function readJsonFile(filePath: string): Partial<PiMemoryConfig> {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    logger.error(`Error reading config at ${filePath}: ${err}`);
  }
  return {};
}

/**
 * Ensures the basic vault directory structure exists.
 * Returns true if any directories were created.
 */
export function ensureVaultStructure(vaultRoot: string, config: PiMemoryConfig): boolean {
  let created = false;
  const dirs = [
    vaultRoot,
    path.join(vaultRoot, config.daily),
    path.join(vaultRoot, config.knowledge),
    path.join(vaultRoot, config.knowledge, "concepts"),
    path.join(vaultRoot, config.knowledge, "connections"),
    path.join(vaultRoot, config.knowledge, "qa"),
    path.join(vaultRoot, config.knowledge, "lessons-learned"),
    path.join(vaultRoot, config.knowledge, "cursed-knowledge"),
    path.join(vaultRoot, config.knowledge, "archive"),
    path.join(vaultRoot, config.knowledge, "archive", "faded"),
    path.join(vaultRoot, config.deepThoughts),
    path.join(vaultRoot, config.reports),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created = true;
    }
  }

  return created;
}
