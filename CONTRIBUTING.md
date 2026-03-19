# Contributing Guide

Thank you for considering contributing to Knowledge Graph Viz!

## Development Setup

```bash
# Clone repository
git clone https://github.com/your-username/obsidian-knowledge-graph.git
cd obsidian-knowledge-graph

# Install dependencies
npm install

# Development mode (auto build)
npm run dev

# Production build
npm run build
```

## Testing the Plugin

1. Run `npm run build` to build `main.js`
2. Copy `main.js`, `manifest.json`, `styles.css` to your Obsidian Vault's `.obsidian/plugins/knowledge-graph-viz/` directory
3. Enable the plugin in Obsidian settings

## Submitting Pull Requests

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Code Style

- Use TypeScript
- Follow existing code structure
- Add necessary comments
- Use clear commit messages

## Reporting Bugs

Please submit bug reports in GitHub Issues with:
- Obsidian version
- Plugin version
- Steps to reproduce
- Expected behavior vs actual behavior
- Screenshots (if relevant)

## Feature Requests

Welcome to submit feature requests in GitHub Issues, describing:
- What feature you want to implement
- Use case scenario
- Expected results
