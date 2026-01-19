# md-to-html

A Node.js/TypeScript tool to convert markdown files with mermaid diagrams to HTML.

## Features

- Converts markdown to HTML with GitHub Flavored Markdown support
- Syntax highlighting for code blocks using [Shiki](https://shiki.style) (GitHub Light theme)
- Renders mermaid diagrams as SVG (high quality, scalable)
- Embeds SVG directly in HTML
- Structured logging with [Pino](https://getpino.io)

## Installation

```bash
git clone https://github.com/jonaslalin/md-to-html.git
cd md-to-html
npm install
```

## Usage

### Basic Conversion

```bash
npm start input.md
```

Creates `input.html` in the same directory. You can:
1. Open in a browser
2. Copy content and paste into Google Docs
3. Import via Google Docs: File > Import > Upload

### Specify Output File

```bash
npm start -- input.md -o output.html
```

**Note**: The `--` is required when using flags like `-o` to pass arguments through to the script.

## How It Works

1. Extracts mermaid diagrams from markdown code blocks
2. Renders diagrams to SVG using [Mermaid CLI](https://github.com/mermaid-js/mermaid-cli)
3. Converts markdown to HTML using [micromark](https://github.com/micromark/micromark) with GFM support
4. Applies syntax highlighting to code blocks using [Shiki](https://shiki.style) (GitHub Light theme)
5. Embeds SVG diagrams and highlighted code blocks in the final HTML output

## Development

```bash
npm install          # Install dependencies
npm run dev          # Watch mode
npm run build        # Build TypeScript
npm run format       # Format code with Biome
npm run lint         # Lint code with Biome
npm run check        # Format and lint
npm start input.md   # Run conversion
```

## Logging

Log levels controlled via `LOG_LEVEL` environment variable:

```bash
LOG_LEVEL=debug npm start input.md
```

Available levels: `fatal`, `error`, `warn`, `info`, `debug`, `trace`

## Requirements

- **Node.js**: >= 24.0.0 (see `.node-version`)
- **npm**: Latest version recommended

## License

MIT
