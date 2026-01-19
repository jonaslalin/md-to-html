/**
 * Markdown to HTML converter module.
 * Converts markdown with mermaid diagrams to HTML with embedded SVG diagrams.
 * Uses Shiki (via shiki/bundle/full) for syntax highlighting with GitHub Light theme.
 */

import { readFile, writeFile } from "node:fs/promises"
import { micromark } from "micromark"
import { gfm, gfmHtml } from "micromark-extension-gfm"
import { type BundledLanguage, createHighlighter, type Highlighter } from "shiki/bundle/full"
import { logger } from "./logger.js"
import type { MermaidRenderer } from "./renderer.js"

// Configuration constants
const HTML_MAX_WIDTH = "800px"
const SHIKI_THEME = "github-light" as const

/**
 * Supported languages for syntax highlighting.
 */
const SUPPORTED_LANGUAGES: BundledLanguage[] = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "jsonc",
  "markdown",
  "yaml",
  "bash",
  "shell",
  "python",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "swift",
  "kotlin",
  "html",
  "css",
  "scss",
  "sql",
  "xml",
]

/**
 * Information about a mermaid diagram found in markdown.
 */
export interface DiagramInfo {
  diagramId: string
  mermaidCode: string
  startPos: number
  endPos: number
}

/**
 * Result of syntax highlighting operation.
 */
interface HighlightResult {
  html: string
  styles: string
}

/**
 * Information about a code block to be highlighted.
 */
interface CodeBlockInfo {
  fullMatch: string
  language: string
  code: string
  placeholder: string
}

/**
 * Replacement information for mermaid diagrams.
 */
interface MermaidReplacement {
  start: number
  end: number
  placeholder: string
}

/**
 * Wraps HTML content in a complete HTML document.
 *
 * @param content - HTML content to wrap
 * @param shikiStyles - Optional CSS styles from Shiki
 * @returns Complete HTML document
 */
function wrapInHtmlDocument(content: string, shikiStyles = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Converted Markdown</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            max-width: ${HTML_MAX_WIDTH};
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
            color: #24292e;
            background-color: #ffffff;
        }
        h1, h2, h3, h4, h5, h6 {
            margin-top: 1.5em;
            margin-bottom: 0.5em;
            font-weight: 600;
            line-height: 1.25;
        }
        h1 {
            font-size: 2em;
            border-bottom: 1px solid #eaecef;
            padding-bottom: 0.3em;
        }
        h2 {
            font-size: 1.5em;
            border-bottom: 1px solid #eaecef;
            padding-bottom: 0.3em;
        }
        code:not(pre code) {
            background-color: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 0.9em;
        }
        pre.shiki {
            padding: 16px;
            border-radius: 6px;
            overflow-x: auto;
            line-height: 1.45;
        }
        pre.shiki code {
            background-color: transparent;
            padding: 0;
            font-size: 0.9em;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
        }
        th, td {
            border: 1px solid #dfe2e5;
            padding: 8px 13px;
            text-align: left;
        }
        th {
            background-color: #f6f8fa;
            font-weight: 600;
        }
        tr:nth-child(2n) {
            background-color: #f6f8fa;
        }
        svg {
            max-width: 100%;
            height: auto;
            margin: 1em 0;
            display: block;
        }
        ${shikiStyles}
    </style>
</head>
<body>
${content}
</body>
</html>`
}

/**
 * Decodes HTML entities.
 *
 * @param encoded - HTML-encoded string
 * @returns Decoded string
 */
function decodeHtmlEntities(encoded: string): string {
  return encoded
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * Normalizes language identifier to lowercase.
 *
 * @param lang - Language identifier
 * @returns Normalized identifier
 */
function normalizeLanguage(lang: string): string {
  return lang.toLowerCase()
}

/**
 * Converts markdown to HTML with syntax highlighting and mermaid diagrams.
 */
export class MarkdownToHtmlConverter {
  private readonly mermaidRenderer: MermaidRenderer
  private shikiHighlighter: Highlighter | null = null

  constructor(mermaidRenderer: MermaidRenderer) {
    this.mermaidRenderer = mermaidRenderer
  }

  /**
   * Returns the Shiki highlighter instance (lazy initialization).
   *
   * @returns Shiki highlighter
   * @throws {Error} If initialization fails
   */
  private async getShikiHighlighter(): Promise<Highlighter> {
    if (!this.shikiHighlighter) {
      try {
        logger.debug(
          { theme: SHIKI_THEME, languages: SUPPORTED_LANGUAGES.length },
          "Initializing Shiki highlighter",
        )
        this.shikiHighlighter = await createHighlighter({
          themes: [SHIKI_THEME],
          langs: SUPPORTED_LANGUAGES,
        })
        logger.debug("Shiki highlighter initialized successfully")
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error({ error: errorMessage }, "Failed to initialize Shiki highlighter")
        throw new Error(`Failed to initialize Shiki highlighter: ${errorMessage}`)
      }
    }
    return this.shikiHighlighter
  }

  /**
   * Extracts mermaid diagrams from markdown.
   *
   * @param markdownContent - Markdown content to scan
   * @returns Array of diagram info
   */
  extractMermaidDiagrams(markdownContent: string): DiagramInfo[] {
    const diagrams: DiagramInfo[] = []
    const pattern = /```mermaid\s*\n([\s\S]*?)```/g

    let match: RegExpExecArray | null = pattern.exec(markdownContent)
    while (match !== null) {
      if (match.index === undefined) {
        match = pattern.exec(markdownContent)
        continue
      }

      const mermaidCode = match[1].trim()
      if (!mermaidCode) {
        continue
      }

      const diagramId = `diagram_${diagrams.length}`
      diagrams.push({
        diagramId,
        mermaidCode,
        startPos: match.index,
        endPos: match.index + match[0].length,
      })
      match = pattern.exec(markdownContent)
    }

    return diagrams
  }

  /**
   * Applies syntax highlighting to code blocks.
   *
   * @param html - HTML with code blocks
   * @returns Highlighted HTML and styles
   */
  async highlightCodeBlocks(html: string): Promise<HighlightResult> {
    // Match code blocks with language class
    const codeBlockPattern =
      /<pre><code\s+class="language-([\w-]+)"[^>]*>([\s\S]*?)<\/code><\/pre>/g

    const codeBlocks: CodeBlockInfo[] = []
    let match: RegExpExecArray | null = codeBlockPattern.exec(html)
    let placeholderIndex = 0

    // Extract all code blocks
    while (match !== null) {
      const language = match[1]
      const encodedCode = match[2]
      const code = decodeHtmlEntities(encodedCode)
      const placeholder = `CODE_BLOCK_PLACEHOLDER_${placeholderIndex++}`

      codeBlocks.push({
        fullMatch: match[0],
        language,
        code,
        placeholder,
      })
      match = codeBlockPattern.exec(html)
    }

    // Early return if no code blocks found
    if (codeBlocks.length === 0) {
      return { html, styles: "" }
    }

    // Initialize Shiki highlighter
    const highlighter = await this.getShikiHighlighter()

    // Highlight each code block
    const highlightedBlocks = new Map<string, string>()
    let successCount = 0
    let failureCount = 0

    for (const { language, code, placeholder } of codeBlocks) {
      try {
        const normalizedLang = normalizeLanguage(language)

        const highlighted = highlighter.codeToHtml(code, {
          lang: normalizedLang,
          theme: SHIKI_THEME,
        })

        highlightedBlocks.set(placeholder, highlighted)
        successCount++
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const normalizedLang = normalizeLanguage(language)
        logger.warn(
          { language, normalizedLang, error: errorMessage },
          "Failed to highlight code block, using plain code",
        )

        // Fallback to original code block
        const originalBlock = codeBlocks.find((cb) => cb.placeholder === placeholder)
        highlightedBlocks.set(placeholder, originalBlock?.fullMatch ?? "")
        failureCount++
      }
    }

    logger.debug(
      { total: codeBlocks.length, success: successCount, failures: failureCount },
      "Code block highlighting completed",
    )

    // Replace code blocks with highlighted versions
    let highlightedHtml = html
    for (const { fullMatch, placeholder } of codeBlocks) {
      highlightedHtml = highlightedHtml.replace(fullMatch, placeholder)
    }

    // Shiki uses inline styles, no extraction needed
    const shikiStyles = ""

    // Replace placeholders with highlighted code
    for (const [placeholder, highlighted] of highlightedBlocks.entries()) {
      highlightedHtml = highlightedHtml.replace(placeholder, highlighted)
    }

    return { html: highlightedHtml, styles: shikiStyles }
  }

  /**
   * Converts markdown to HTML with embedded SVG diagrams.
   *
   * @param markdownContent - Markdown content to convert
   * @param imageReplacements - Map of mermaid diagram replacements
   * @returns Complete HTML document
   */
  async convertMarkdownToHtml(
    markdownContent: string,
    imageReplacements: Map<number, { diagramId: string; imagePath: string }>,
  ): Promise<string> {
    // Replace mermaid blocks with placeholders
    let processedContent = markdownContent
    const placeholders = new Map<string, string>()
    const replacements: MermaidReplacement[] = []

    for (const [startPos, { diagramId, imagePath }] of imageReplacements.entries()) {
      const pattern = /```mermaid\s*\n[\s\S]*?```/g
      let match: RegExpExecArray | null = pattern.exec(markdownContent)
      while (match !== null) {
        if (match.index !== undefined && match.index === startPos) {
          const placeholder = `MERMAID_PLACEHOLDER_${diagramId}`
          let svgHtml: string

          if (imagePath) {
            try {
              const svgContent = await readFile(imagePath, "utf-8")
              svgHtml = `<div style="max-width: 100%; margin: 1em 0;">${svgContent}</div>`
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error)
              logger.warn({ diagramId, imagePath, error: errorMessage }, "Failed to read SVG file")
              svgHtml = "<p><em>[Mermaid diagram - failed to read SVG]</em></p>"
            }
          } else {
            svgHtml = "<p><em>[Mermaid diagram - rendering failed]</em></p>"
          }

          placeholders.set(placeholder, svgHtml)
          replacements.push({
            start: match.index,
            end: match.index + match[0].length,
            placeholder,
          })
          break
        }
        match = pattern.exec(markdownContent)
      }
    }

    // Sort replacements in reverse order
    replacements.sort((a, b) => b.start - a.start)
    for (const { start, end, placeholder } of replacements) {
      processedContent =
        processedContent.slice(0, start) + placeholder + processedContent.slice(end)
    }

    // Convert markdown to HTML
    const htmlContent = micromark(processedContent, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    })

    // Replace mermaid placeholders with SVG
    let finalHtml = htmlContent
    for (const [placeholder, svgHtml] of placeholders.entries()) {
      finalHtml = finalHtml.replace(placeholder, svgHtml)
    }

    // Apply syntax highlighting to code blocks
    const { html: highlightedHtml, styles: shikiStyles } = await this.highlightCodeBlocks(finalHtml)

    return wrapInHtmlDocument(highlightedHtml, shikiStyles)
  }

  /**
   * Converts a markdown file to HTML.
   *
   * @param markdownFile - Input markdown file path
   * @param outputFile - Output HTML file path (defaults to input with .html extension)
   * @returns Path to generated HTML file
   * @throws {Error} If file operations fail
   */
  async convert(markdownFile: string, outputFile?: string): Promise<string> {
    const markdownContent = await readFile(markdownFile, "utf-8")
    const diagrams = this.extractMermaidDiagrams(markdownContent)
    logger.info({ count: diagrams.length }, "Found mermaid diagrams in markdown")

    const imageReplacements = new Map<number, { diagramId: string; imagePath: string }>()

    // Render mermaid diagrams
    for (const { diagramId, mermaidCode, startPos } of diagrams) {
      logger.debug({ diagramId }, "Rendering mermaid diagram")
      const imagePath = await this.mermaidRenderer.renderMermaidToSvg(mermaidCode, diagramId)

      if (imagePath) {
        imageReplacements.set(startPos, { diagramId, imagePath })
        logger.info(
          { diagramId, imagePath, format: "SVG" },
          "Successfully rendered mermaid diagram",
        )
      } else {
        logger.error({ diagramId }, "Failed to render mermaid diagram")
        imageReplacements.set(startPos, { diagramId, imagePath: "" })
      }
    }

    // Convert markdown to HTML
    const htmlContent = await this.convertMarkdownToHtml(markdownContent, imageReplacements)

    // Determine output path
    const output = outputFile ?? markdownFile.replace(/\.md$/i, ".html")
    await writeFile(output, htmlContent, "utf-8")

    logger.info(
      { input: markdownFile, output, diagramsRendered: diagrams.length },
      "Successfully converted markdown to HTML",
    )

    return output
  }
}
