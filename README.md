# Knowledge Graph Viz — Obsidian Plugin

Interactive knowledge graph visualization plugin based on Markdown code blocks, featuring D3.js force-directed layout with customizable node types, relationships, colors, and descriptions.

## Features

- 📝 **Markdown Native**: Define graphs directly in notes using code blocks, no extra config interface needed
- 🎨 **Highly Customizable**: Custom node types, colors, relationship labels, and descriptions
- 🖱️ **Rich Interactions**: Drag nodes, scroll to zoom, pan canvas, hover highlights, pin nodes
- 💾 **Persistent**: Canvas height auto-saves to frontmatter, restores on next open
- 🌐 **D3.js Powered**: Beautiful force-directed layout using D3.js v7
- 📱 **Responsive**: Works on desktop and mobile

## Installation

### Manual Installation

1. Find the plugins directory in your Obsidian Vault:
   ```
   <YourVault>/.obsidian/plugins/
   ```

2. Create folder `knowledge-graph-viz/` and copy these 3 files into it:
   - `main.js`
   - `manifest.json`
   - `styles.css`

3. In Obsidian, open **Settings → Community Plugins**, enable "Knowledge Graph Viz"

### Development Mode

```bash
# Clone repository
git clone https://github.com/yanhuiwu7/obsidian-knowledge-graph.git
cd obsidian-knowledge-graph

# Install dependencies
npm install

# Development mode (watch for changes, auto rebuild)
npm run dev

# Production build
npm run build
```

## Usage

### Basic Syntax

Create a `knowledgegraph` code block in your notes:

```knowledgegraph
---
name: My Knowledge Graph
description: |
  This supports **Markdown** formatted descriptions
  Can write multiple lines
height: 500
---

# Node Types
@type Core Member #6366f1 Zhang, Li
@type External Consultant #f59e0b Wang

# Triples (comma separated: subject, predicate, object)
Zhang, colleague, Li
Zhang, boss, Wang
Google DeepMind, acquired, Isomorphic Labs
```

### Triple Format

Use English commas to separate three parts: `subject, predicate, object`

```
Zhang, colleague, Li
Company, contains, Department
Department, contains, Person
```

- `subject` and `object` are automatically created as nodes
- `predicate` is displayed as the relationship label
- Lines starting with `#` are comments and will be ignored

### Self-Referential Nodes

For nodes that relate to themselves, write the same name for subject and object:

```
Role, multi-level, Role
```

### Node Types

Use `@type` directive to define node types:

```
@type TypeName [#color] Node1, Node2, ...
```

Example:

```
@type Core Member #6366f1 Zhang, Li
@type External Consultant #f59e0b Wang
@type Project #10b981 Alpha, Beta, Gamma
```

- `TypeName`: Label shown in legend
- `#color`: Optional, auto-assigned if not specified
- `Node list`: Comma-separated node names

Nodes not covered by any type will be auto-assigned colors.

### Frontmatter Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `name` | Graph name | Knowledge Graph |
| `description` | Description (supports Markdown) | None |
| `height` | Canvas height (px) | 420 |

### Interactions

| Action | Effect |
|--------|--------|
| Scroll wheel | Zoom |
| Drag empty space | Pan canvas |
| Drag node | Move node (auto pin) |
| Click node | Pin / Unpin |
| Hover node | Highlight related nodes and links |
| "Fit" | Auto-scale to fit view |
| "Label" | Toggle link labels |
| "Restart" | Re-trigger force-directed layout |
| Drag bottom | Adjust canvas height (auto save) |
| Bottom-right input | Directly enter height value (px) |

## Examples

### Organization Chart

\`\`\`knowledgegraph
---
name: Organization Structure
description: |
  ## Company Organization
  Shows hierarchical relationships between departments
---

@type Executive #6366f1 CEO, VP
@type Department #f59e0b Tech Dept, Marketing Dept, Ops Dept
@type Team #10b981 Frontend Team, Backend Team

CEO, leads, VP
VP, oversees, Tech Dept
VP, oversees, Marketing Dept
Tech Dept, contains, Frontend Team
Tech Dept, contains, Backend Team
\`\`\`

### Concept Graph

\`\`\`knowledgegraph
---
name: Frontend Tech Stack
height: 450
---

@type Framework #3b82f6 React, Vue, Angular
@type Build Tool #ef4444 Webpack, Vite, Rollup
@type Utility #10b981 TypeScript, ESLint, Prettier

React, uses, TypeScript
React, bundles with, Webpack
React, bundles with, Vite
Vue, uses, TypeScript
TypeScript, linted by, ESLint
\`\`\`

## Configuration

In **Settings → Knowledge Graph Viz** you can configure:

- **Show Node Labels**: Whether to display node names by default (doesn't affect hover tooltip)

## Tech Stack

- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [D3.js](https://d3js.org/) - Data visualization
- [Obsidian API](https://docs.obsidian.md/) - Plugin development

## License

[MIT License](LICENSE)

## Contributing

Issues and Pull Requests are welcome!

## Acknowledgments

- [D3.js](https://d3js.org/) - Powerful visualization library
- [Obsidian](https://obsidian.md/) - Excellent note-taking app
