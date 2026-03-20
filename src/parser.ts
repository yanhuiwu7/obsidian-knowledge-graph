import * as yaml from "js-yaml";
import { GraphConfig, NodeTypeConfig, Triple } from "./types";

// ============================================
// Code block syntax parser
// Supported formats:
//
// 1. Legacy @type style:
// @type TypeName [#color] node1, node2
//
// 2. YAML style (recommended):
// types:
//   - label: 组织
//     color: #6366f1
//     nodes: [分部, 部门, 职务]
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

    // types: (YAML block start)
    if (trimmed.startsWith("types:") || trimmed.startsWith("types :")) {
      const yamlResult = parseYamlTypesBlock(lines, i, typeColorIdx, autoColors);
      errors.push(...yamlResult.errors);
      if (yamlResult.nodeTypes) {
        nodeTypes.push(...yamlResult.nodeTypes);
        typeColorIdx += yamlResult.nodeTypes.length;
      }
      i = yamlResult.endIndex; // Skip to end of YAML block
      continue;
    }

    // @type node type definition (legacy)
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
// Parse YAML types block
// Format:
// types:
//   - label: 组织
//     color: #6366f1
//     nodes: [分部, 部门, 职务]
//   - label: 属性
//     color: #f59e0b
//     nodes: [主身份, 次身份]
// ============================================
function parseYamlTypesBlock(
  lines: string[],
  startIndex: number,
  baseColorIdx: number,
  autoColors: string[]
): { nodeTypes?: NodeTypeConfig[]; errors: string[]; endIndex: number } {
  const errors: string[] = [];
  const nodeTypes: NodeTypeConfig[] = [];

  // Collect YAML block lines (must be indented and not empty/comment)
  const yamlLines: string[] = [];
  let i = startIndex + 1;
  let hasContent = false;

  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Stop if we hit a non-indented line (end of YAML block)
    if (trimmed && !line.startsWith("\t") && !line.startsWith(" ") && !trimmed.startsWith("#")) {
      break;
    }

    // Skip empty lines and comments within the block
    if (!trimmed || trimmed.startsWith("#")) continue;

    yamlLines.push(line);
    hasContent = true;
  }

  if (!hasContent) {
    return { errors: [`Line ${startIndex + 1}: types: block is empty`], endIndex: i };
  }

  try {
    // Parse YAML (allow trailing comma in arrays)
    const raw = yamlLines.join("\n");
    const normalized = raw.replace(/,(\s*[\]}\]])/g, "$1"); // Remove trailing commas before brackets
    const parsed = yaml.load(normalized);

    if (!parsed || typeof parsed !== "object") {
      throw new Error("types: block must be a YAML list");
    }

    const typesList = parsed as unknown[];
    if (!Array.isArray(typesList)) {
      throw new Error("types: must be a YAML array starting with '- '");
    }

    let colorIdx = baseColorIdx;
    for (const item of typesList) {
      if (!item || typeof item !== "object") {
        errors.push(`Invalid type entry: must be an object`);
        continue;
      }

      const entry = item as Record<string, unknown>;
      const labelRaw = entry.label ?? "";
      const label = typeof labelRaw === "string" ? labelRaw : "";
      const colorRaw = entry.color;
      const color = typeof colorRaw === "string" ? colorRaw : autoColors[colorIdx % autoColors.length];

      // Parse nodes (can be array or comma-separated string)
      let nodes: string[] = [];
      if (entry.nodes) {
        if (Array.isArray(entry.nodes)) {
          nodes = entry.nodes.map((n) => String(n)).filter(Boolean);
        } else if (typeof entry.nodes === "string") {
          nodes = String(entry.nodes).split(",").map((s) => s.trim()).filter(Boolean);
        }
      }

      if (!label) {
        errors.push(`Type entry missing required field: label`);
        continue;
      }

      nodeTypes.push({
        id: `type_${label}_${colorIdx}`,
        label,
        color,
        nodes,
      });
      colorIdx++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Line ${startIndex + 1}: Failed to parse types: block - ${msg}`);
  }

  return { nodeTypes, errors, endIndex: i };
}

// ============================================
// Parse @type directive (legacy, still supported)
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
        currentVal.push(line.replace(/^ {2}|\t/, ""));
      }
    }
  }

  flush();
  return result;
}

// ============================================
// Serialize: GraphConfig → code block text
// Preference: use YAML style for types if any exist
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

  // Node types (prefer YAML style if any types exist)
  if (config.nodeTypes.length > 0) {
    lines.push("types:");
    config.nodeTypes.forEach((t) => {
      const nodesArray = (t.nodes ?? []).map((n) => n.includes(",") ? `"${n}"` : n).join(", ");
      lines.push(`  - label: ${t.label}`);
      if (t.color) lines.push(`    color: ${t.color}`);
      if (t.nodes && t.nodes.length > 0) {
        lines.push(`    nodes: [${nodesArray}]`);
      }
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
