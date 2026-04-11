import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { RELATIVE_PATHS } from "./constants.js";

/**
 * Interface representing the extension configuration.
 * All paths are relative to the vault root unless specified.
 */
export interface PiMemoryConfig {
  VAULT_ROOT: string;
  DAILY: string;
  KNOWLEDGE: string;
  DEEP_THOUGHTS: string;
  REPORTS: string;
}

const CONFIG_FILENAME = "pi-memory.json";
const DOT_CONFIG_FILENAME = ".pi-memory.json";

/**
 * Loads and merges configuration from System, User, and Project levels.
 * Precedence: Project > User > System > Internal Defaults.
 */
export function getResolvedConfig(projectCwd: string): PiMemoryConfig {
  const defaults: PiMemoryConfig = { ...RELATIVE_PATHS };

  const systemConfig = loadSystemConfig();
  const userConfig = loadUserConfig();
  const projectConfig = loadProjectConfig(projectCwd);

  return {
    ...defaults,
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
    console.error(`[pi-memory] Error reading config at ${filePath}:`, err);
  }
  return {};
}
