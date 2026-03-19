import { GraphConfig, NodeTypeConfig, Triple } from "./types";

// ============================================
// Code block syntax parser
// Supported format:
//
// ```knowledgegraph
// ---
// name: Graph Name
// description: |
//   ## Description
//   Multi-line Markdown description
// ---
//
// # Node Types
// @type Core Member #6366f1 Zhang, Li
// @type External Consultant #f59e0b Wang
//
// # Triples (comma separated: subject, predicate, object)
// Zhang, colleague, Li
// Zhang, boss, Wang
// Google DeepMind, acquired, Isomorphic Labs
// ```
// ============================================

export interface ParseResult {
  config: GraphConfig;
  errors: string[];
}

export function parseCodeBlock(source: string): ParseResult {
  const errors: string[] = [];
  const lines = source.split("\n");

  let name = "Knowledge Graph";
  let description = "";
  let height: number | undefined;
  const nodeTypes: NodeTypeConfig[] = [];
  const triples: Triple[] = [];

  // ── Parse frontmatter (--- wrapped metadata) ──
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    const fmLines: string[] = [];
    while (i < lines.length && lines[i]?.trim() !== "---") {
      fmLines.push(lines[i]);
      i++;
    }
    i++; // Skip the closing ---

    // Parse frontmatter key-value pairs (support multi-line description)
    const fm = parseFrontmatter(fmLines);
    if (fm.name) name = fm.name.trim();
    if (fm.description) description = fm.description.trim();
    if (fm.height) {
      const h = parseInt(fm.height.trim());
      if (!isNaN(h) && h > 0) height = h;
    }
  }

  // ── Parse main content ──
  let typeColorIdx = 0;
  const autoColors = [
    "#6366f1", "#f59e0b", "#10b981", "#ef4444",
    "#3b82f6", "#ec4899", "#14b8a6", "#f97316",
    "#8b5cf6", "#06b6d4", "#84cc16", "#a855f7",
  ];

  for (; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // @type node type definition
    if (trimmed.startsWith("@type ")) {
      const typeResult = parseTypeDirective(trimmed, typeColorIdx, autoColors);
      if (typeResult.error) {
        errors.push(`Line ${i + 1}: ${typeResult.error}`);
      } else if (typeResult.nodeType) {
        nodeTypes.push(typeResult.nodeType);
        typeColorIdx++;
      }
      continue;
    }

    // Triple: subject, predicate, object (comma separated, all three parts can contain spaces)
    const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      triples.push({
        subject:   parts[0],
        predicate: parts[1],
        object:    parts.slice(2).join(",").trim(),
      });
    } else if (parts.length > 0) {
      errors.push(`Line ${i + 1}: "${trimmed}" has invalid format. Triples should use commas to separate three parts (subject, predicate, object)`);
    }
  }

  const config: GraphConfig = {
    id: generateId(name),
    name,
    description,
    height,
    triples,
    nodeTypes,
  };

  return { config, errors };
}

// ============================================
// Parse @type directive
// Format: @type TypeName [#color] node1, node2, ...
// ============================================
function parseTypeDirective(
  line: string,
  colorIdx: number,
  autoColors: string[]
): { nodeType?: NodeTypeConfig; error?: string } {
  // Remove @type prefix
  const rest = line.slice(6).trim();
  if (!rest) return { error: "@type directive missing content" };

  // Try to match color (#rrggbb or #rgb)
  const colorMatch = rest.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
  let color = autoColors[colorIdx % autoColors.length];
  let remaining = rest;

  if (colorMatch) {
    color = colorMatch[0];
    remaining = rest.replace(colorMatch[0], "").trim();
  }

  // First token is type name, remaining is node list
  const tokens = remaining.split(/\s+/);
  const label = tokens[0];
  if (!label) return { error: "@type missing type name" };

  const nodesRaw = tokens.slice(1).join(" ");
  const nodes = nodesRaw
    ? nodesRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    nodeType: {
      id: `type_${label}_${colorIdx}`,
      label,
      color,
      nodes,
    },
  };
}

// ============================================
// Parse simple frontmatter (support multi-line description)
// ============================================
function parseFrontmatter(lines: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  let currentKey = "";
  let currentVal: string[] = [];
  let isMultiline = false;

  const flush = () => {
    if (currentKey) {
      result[currentKey] = currentVal.join("\n");
    }
  };

  for (const line of lines) {
    // key: value or key: | (multiline marker)
    const kvMatch = line.match(/^(\w+):\s*(.*)/);
    if (kvMatch && !isMultiline) {
      flush();
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === "|") {
        isMultiline = true;
        currentVal = [];
      } else {
        isMultiline = false;
        currentVal = [val];
      }
    } else if (isMultiline) {
      // Multiline content: detect if ended (when encountering a non-indented new key)
      const nextKv = line.match(/^(\w+):\s*(.*)/);
      if (nextKv) {
        flush();
        currentKey = nextKv[1];
        const val = nextKv[2].trim();
        isMultiline = val === "|";
        currentVal = isMultiline ? [] : [val];
      } else {
        // Remove one-level indentation (2 spaces or 1 tab)
        currentVal.push(line.replace(/^  |\t/, ""));
      }
    }
  }

  flush();
  return result;
}

// ============================================
// Serialize: GraphConfig → code block text
// ============================================
export function serializeToCodeBlock(config: GraphConfig): string {
  const lines: string[] = [];

  // frontmatter
  lines.push("---");
  lines.push(`name: ${config.name}`);
  if (config.description?.trim()) {
    lines.push("description: |");
    config.description.split("\n").forEach((l) => lines.push(`  ${l}`));
  }
  if (config.height && config.height !== 420) {
    lines.push(`height: ${config.height}`);
  }
  lines.push("---");
  lines.push("");

  // Node types
  if (config.nodeTypes.length > 0) {
    lines.push("# Node Types");
    config.nodeTypes.forEach((t) => {
      const nodesStr = (t.nodes ?? []).join(", ");
      lines.push(`@type ${t.label} ${t.color ?? ""} ${nodesStr}`.trimEnd());
    });
    lines.push("");
  }

  // Triples
  if (config.triples.length > 0) {
    lines.push("# Triples");
    config.triples.forEach((t) => {
      lines.push(`${t.subject}, ${t.predicate}, ${t.object}`);
    });
  }

  return lines.join("\n");
}

// ============================================
// Utility functions
// ============================================

function generateId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[\s\u4e00-\u9fa5]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
  return `kg_${slug || "graph"}_${Date.now().toString(36)}`;
}
