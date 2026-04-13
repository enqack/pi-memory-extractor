import * as fs from "node:fs";
import * as path from "node:path";
import Handlebars from "handlebars";

/**
 * Basic markdown linting/cleaning to ensure prompts are consistent.
 */
function lintMarkdown(content: string): string {
  return content
    .split("\n")
    .map((line) => line.trimEnd()) // Remove trailing whitespace
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // Collapse consecutive blank lines (max 1)
    .trim() + "\n"; // Ensure exactly one newline at EOF
}

/**
 * Loads all authoritative schemas from src/prompts/schemas/
 */
function loadSchemas(): Record<string, string> {
  const schemaDir = path.join(__dirname, "prompts", "schemas");
  const schemas: Record<string, string> = {};

  try {
    if (fs.existsSync(schemaDir)) {
      const files = fs.readdirSync(schemaDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        // camelCase the filename (e.g., article-schema -> articleSchema)
        const key = file
          .replace(".md", "")
          .replace(/-([a-z])/g, (g) => g[1].toUpperCase())
          .replace("Schema", "Schema"); // Ensure it ends with Schema
          
        const content = fs.readFileSync(path.join(schemaDir, file), "utf-8");
        schemas[key] = content;
      }
    }
  } catch (err) {
    console.error(`[Memory Extractor] Failed to load schemas: ${err}`);
  }

  return schemas;
}

/**
 * Resolves a prompt template by name and renders it with provided data.
 */
export function renderTemplate(name: string, data: Record<string, any>): string {
  const templatePath = path.join(__dirname, "prompts", `${name}.md`);
  
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found at: ${templatePath}`);
  }

  const source = fs.readFileSync(templatePath, "utf-8");
  const template = Handlebars.compile(source);
  
  // Inject schemas automatically into the data context
  const schemas = loadSchemas();
  const rendered = template({ ...schemas, ...data });

  return lintMarkdown(rendered);
}

/**
 * Simple helper to load a static prompt file without rendering.
 */
export function loadPromptRaw(name: string): string {
  const templatePath = path.join(__dirname, "prompts", `${name}.md`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Prompt file not found at: ${templatePath}`);
  }
  return fs.readFileSync(templatePath, "utf-8");
}
