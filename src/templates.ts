import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Collapse consecutive blank lines and trim trailing whitespace per line.
 */
function lintMarkdown(content: string): string {
  return (
    content
      .split("\n")
      .map((l) => l.trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

/**
 * Load all schema files from src/prompts/schemas/ and return them keyed by
 * camelCase filename (e.g. "article-schema.md" → "articleSchema").
 */
function loadSchemas(): Record<string, string> {
  const schemaDir = path.join(__dirname, "prompts", "schemas");
  const schemas: Record<string, string> = {};

  try {
    if (!fs.existsSync(schemaDir)) return schemas;

    for (const file of fs.readdirSync(schemaDir).filter((f) => f.endsWith(".md"))) {
      const key = file
        .replace(".md", "")
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      schemas[key] = fs.readFileSync(path.join(schemaDir, file), "utf-8");
    }
  } catch (err) {
    logger.error(`Failed to load schemas: ${err}`);
  }

  return schemas;
}

/**
 * Render a named prompt template (from src/prompts/<name>.md) using Handlebars,
 * with all schema files automatically injected into the data context.
 */
export function renderTemplate(name: string, data: Record<string, any>): string {
  const templatePath = path.join(__dirname, "prompts", `${name}.md`);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const source = fs.readFileSync(templatePath, "utf-8");
  const template = Handlebars.compile(source);
  const schemas = loadSchemas();
  const rendered = template({ ...schemas, ...data });

  return lintMarkdown(rendered);
}

/**
 * Load a raw prompt file without rendering.
 */
export function loadPromptRaw(name: string): string {
  const templatePath = path.join(__dirname, "prompts", `${name}.md`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Prompt not found: ${templatePath}`);
  }
  return fs.readFileSync(templatePath, "utf-8");
}
