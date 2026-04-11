import * as fs from "node:fs";
import * as path from "node:path";
import { PiMemoryConfig } from "./config.js";

/**
 * Returns today's date (YYYY-MM-DD).
 */
export function TODAY(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Discovers the vault root by walking up from `startDir` using settings from `config`.
 */
export function findVaultRoot(startDir: string, config: PiMemoryConfig): string {
  let dir = startDir;

  // 1. Check if we're already in a vault (contains daily/)
  if (fs.existsSync(path.join(dir, config.DAILY))) {
    return dir;
  }

  // 2. Check if there's a VAULT_ROOT folder here
  const localKB = path.join(dir, config.VAULT_ROOT);
  if (fs.existsSync(localKB)) {
    return localKB;
  }

  // 3. Walk up to find a vault root
  for (let i = 0; i < 6; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;

    // Check if parent contains the vault root folder
    const upKB = path.join(dir, config.VAULT_ROOT);
    if (fs.existsSync(upKB)) {
      return upKB;
    }

    // Or if direct contents suggest we are in a vault
    if (fs.existsSync(path.join(dir, config.DAILY))) {
      return dir;
    }
  }

  // 4. Default fallback: project-local knowledge-base dir
  return path.join(startDir, config.VAULT_ROOT);
}
