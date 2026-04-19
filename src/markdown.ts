import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { wikiLinkPlugin } from "remark-wiki-link";
import { visit } from "unist-util-visit";
import yaml, { JSON_SCHEMA } from "js-yaml";

/**
 * Shared remark processor — handles YAML frontmatter, GFM, and [[wikilink]] syntax.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  .use(wikiLinkPlugin, { aliasDivider: "|" })
  .use(remarkStringify);

/**
 * Shape of article YAML frontmatter.
 */
export interface ArticleFrontmatter {
  title?: string;
  type?: string;
  maturity?: string;
  revision?: number;
  category?: string;
  tags?: string[];
  date_created?: string;
  last_reinforced?: string;
  confidence?: number;
  memory_type?: string;
  sources?: string[];
  wikilinks?: string[];
  status?: string;
  [key: string]: unknown;
}

/**
 * Parse a markdown document into its frontmatter object and body text.
 */
export function parseArticle(content: string): {
  frontmatter: ArticleFrontmatter;
  body: string;
} {
  const tree = processor.parse(content);
  let yamlValue: string | null = null;
  let yamlEndOffset = 0;

  visit(tree, "yaml", (node: any) => {
    yamlValue = node.value as string;
    yamlEndOffset = node.position.end.offset + 1;
  });

  if (!yamlValue) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter = (yaml.load(yamlValue, { schema: JSON_SCHEMA }) ?? {}) as ArticleFrontmatter;
  const body = content.slice(yamlEndOffset);
  return { frontmatter, body };
}

/**
 * Serialize a frontmatter object to YAML wrapped in --- delimiters.
 * Uses JSON_SCHEMA so date-shaped strings (YYYY-MM-DD, ISO timestamps) stay
 * as strings instead of being coerced to JS Date and re-emitted as UTC.
 */
function serializeFrontmatter(frontmatter: ArticleFrontmatter): string {
  const yamlStr = yaml.dump(frontmatter, {
    schema: JSON_SCHEMA,
    lineWidth: 120,
    quotingType: '"',
    forceQuotes: false,
    noRefs: true,
  });
  return `---\n${yamlStr}---\n`;
}

/**
 * Merge `updates` into the existing frontmatter and return the full
 * document string. Round-trips YAML through js-yaml, which normalises
 * [[wikilink]] quoting as a side-effect.
 */
export function updateFrontmatter(
  content: string,
  updates: Partial<ArticleFrontmatter>,
): string {
  const { frontmatter, body } = parseArticle(content);
  const merged = { ...frontmatter, ...updates };
  return `${serializeFrontmatter(merged)}\n${body}`;
}

/**
 * Flatten arbitrarily nested values into a flat list of `[[slug]]` strings.
 * Handles the common LLM mistake of writing `- [[slug]]` unquoted, which YAML
 * parses as a nested flow sequence (`[["slug"]]`) instead of a literal string.
 */
function normalizeLinkField(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else if (typeof v === "string") {
      const trimmed = v.trim();
      if (!trimmed) return;
      const slug = trimmed.replace(/^\[+/, "").replace(/\]+$/, "").trim();
      if (slug) out.push(`[[${slug}]]`);
    }
  };
  walk(value);
  return out;
}

/**
 * Strip accidental LLM preamble before the opening `---` and round-trip
 * frontmatter through js-yaml to ensure [[wikilinks]] are quoted.
 * Returns the original string unchanged if it already starts with valid
 * frontmatter.
 */
export function repairDocument(content: string): string {
  let working = content;

  // Strip leading text before the first ---
  const firstFm = working.indexOf("---\n");
  if (firstFm > 0) {
    const leading = working.slice(0, firstFm).trim();
    if (leading.length < 1000 && !leading.includes("# ") && !leading.includes("\n\n")) {
      working = working.slice(firstFm);
    }
  }

  // Round-trip frontmatter to fix quoting
  try {
    const { frontmatter, body } = parseArticle(working);
    if (Object.keys(frontmatter).length > 0) {
      if ("wikilinks" in frontmatter) {
        frontmatter.wikilinks = normalizeLinkField(frontmatter.wikilinks);
      }
      if ("sources" in frontmatter) {
        frontmatter.sources = normalizeLinkField(frontmatter.sources);
      }
      return `${serializeFrontmatter(frontmatter)}\n${body}`;
    }
  } catch {
    // Return de-preambled content as-is if YAML parsing fails
  }

  return working;
}

/**
 * Validate that `content` starts with a well-formed YAML frontmatter block.
 */
export function validateDocument(content: string): { valid: boolean; error?: string } {
  if (!content.startsWith("---\n")) {
    return {
      valid: false,
      error: `Document must start with YAML frontmatter (---). Found: ${content.slice(0, 50).replace(/\n/g, "\\n")}…`,
    };
  }
  try {
    const { frontmatter } = parseArticle(content);
    if (Object.keys(frontmatter).length === 0) {
      return { valid: false, error: "Frontmatter block is empty." };
    }
  } catch (err) {
    return { valid: false, error: `Invalid YAML frontmatter: ${(err as Error).message}` };
  }
  return { valid: true };
}

/**
 * Recursively extract plain text from an mdast node.
 */
function nodeToText(node: any): string {
  if (node.type === "text" || node.type === "inlineCode") {
    return node.value ?? "";
  }
  if (node.type === "wikiLink") {
    return node.data?.alias
      ? `[[${node.value}|${node.data.alias}]]`
      : `[[${node.value}]]`;
  }
  if (Array.isArray(node.children)) {
    return node.children.map(nodeToText).join("");
  }
  return "";
}

/**
 * Extract the text content of a named section from a markdown document.
 * Returns text between the matching heading and the next equal-or-higher
 * heading, or null if the section is absent.
 */
export function extractSection(content: string, heading: string): string | null {
  const tree = processor.parse(content);

  let targetDepth = 0;
  let collecting = false;
  const sectionNodes: any[] = [];

  for (const node of (tree as any).children) {
    if (node.type === "heading") {
      const text = nodeToText(node).trim();
      if (!collecting && text.toLowerCase() === heading.toLowerCase()) {
        targetDepth = node.depth;
        collecting = true;
        continue;
      }
      if (collecting && node.depth <= targetDepth) break;
    }
    if (collecting) sectionNodes.push(node);
  }

  if (sectionNodes.length === 0) return null;

  const lines: string[] = [];
  for (const node of sectionNodes) {
    if (node.type === "paragraph") {
      const text = nodeToText(node).trim();
      if (text) lines.push(text);
    } else if (node.type === "list") {
      for (const item of node.children ?? []) {
        for (const child of item.children ?? []) {
          const text = nodeToText(child).trim();
          if (text) lines.push(`- ${text}`);
        }
      }
    } else if (node.type === "code") {
      lines.push("```" + (node.lang ?? "") + "\n" + node.value + "\n```");
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Build a complete, Obsidian-compatible markdown article from a frontmatter
 * object and a body string.
 */
export function buildArticle(frontmatter: ArticleFrontmatter, body: string): string {
  return `${serializeFrontmatter(frontmatter)}\n${body.trim()}\n`;
}
