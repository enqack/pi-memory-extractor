import * as fs from "node:fs";
import * as path from "node:path";
import { PiMemoryConfig } from "./config.js";

/**
 * Returns today's date in the system's local timezone (YYYY-MM-DD).
 */
export function TODAY(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Resolves the vault root path.
 */
export function findVaultRoot(startDir: string, config: PiMemoryConfig): string {
  // Just use the configured VAULT_ROOT relative to the startDir (project root)
  const vaultPath = path.join(startDir, config.VAULT_ROOT);
  
  if (!fs.existsSync(vaultPath)) {
    console.log(`[pi-memory-extractor] Vault root does not exist. It will be created at: ${vaultPath}`);
  } else {
    console.log(`[pi-memory-extractor] Using vault root: ${vaultPath}`);
  }

  return vaultPath;
}

const STOP_WORDS = new Set(["this", "that", "with", "from", "your", "have", "been", "into", "their", "there", "which", "about", "could", "would", "should", "using", "these", "those"]);

/**
 * Extract potential keywords from text for matching against the KB index.
 */
export function extractKeywords(text: string): string[] {
  // Simple heuristic: words > 3 chars, split by spaces/punctuation, lowercased
  // Also include the project name and common technical terms.
  const words = text.toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

/**
 * Reads a knowledge article and extracts its "Summary" section.
 */
export function getArticleSummary(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    
    let summary: string[] = [];
    let inSummary = false;

    for (const line of lines) {
      if (line.trim().startsWith("## Summary")) {
        inSummary = true;
        continue;
      }
      if (inSummary && line.trim().startsWith("## ")) {
        break; // End of summary section
      }
      if (inSummary) {
        summary.push(line);
      }
    }

    const result = summary.join("\n").trim();
    return result || null;
  } catch {
    return null;
  }
}
