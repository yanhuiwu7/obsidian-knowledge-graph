# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-19

### Added
- 🎉 Initial release
- 📝 Markdown code block based graph definition
- 🎨 Custom node types and colors
- 🖱️ Rich interactions (drag, zoom, hover highlights)
- 💾 Height persistence to frontmatter
- 🌐 D3.js v7 force-directed layout
- 📱 Responsive design, desktop and mobile support

### Features
- Triple-based relation definition (comma separated)
- Frontmatter configuration (name, description, height)
- Node type grouping (@type directive)
- Support for self-referential nodes
- Node pin/unpin
- Link label show/hide
- Drag to resize canvas with auto-save
- Direct height input for precise control

### Technical
- TypeScript type safety
- Fixed Obsidian app:// protocol arrow display issue
- Unique marker IDs to avoid conflicts across multiple graphs

---

## [Unreleased]

### Planned
- [ ] Export graph as image
- [ ] More layout algorithm options
- [ ] Custom node icons
- [ ] More color presets
