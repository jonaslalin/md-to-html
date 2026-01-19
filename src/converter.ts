/**
 * Markdown to HTML converter module.
 * Converts markdown with mermaid diagrams to HTML with embedded SVG diagrams.
 */

import { readFile, writeFile } from "node:fs/promises"
import { micromark } from "micromark"
import { gfm, gfmHtml } from "micromark-extension-gfm"
import { logger } from "./logger.js"
import type { MermaidRenderer } from "./renderer.js"

const HTML_MAX_WIDTH = "800px"

export interface DiagramInfo {
  diagramId: string
  mermaidCode: string
  startPos: number
  endPos: number
}

/**
 * Wrap HTML content in a complete HTML document with styles.
 */
function wrapInHtmlDocument(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: ${HTML_MAX_WIDTH};
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
        }
        h1, h2, h3, h4, h5, h6 {
            margin-top: 1.5em;
            margin-bottom: 0.5em;
        }
        code {
            background-color: #f4f4f4;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
        }
        pre {
            background-color: #f4f4f4;
            padding: 10px;
            border-radius: 5px;
            overflow-x: auto;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #f2f2f2;
            font-weight: bold;
        }
        svg {
            max-width: 100%;
            height: auto;
            margin: 1em 0;
        }
    </style>
</head>
<body>
${content}
</body>
</html>`
}

export class MarkdownToHtmlConverter {
  private mermaidRenderer: MermaidRenderer

  constructor(mermaidRenderer: MermaidRenderer) {
    this.mermaidRenderer = mermaidRenderer
  }

  /**
   * Extract mermaid diagrams from markdown content.
   * Returns list of diagram information.
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
   * Convert markdown to HTML, replacing mermaid code blocks with embedded SVGs.
   */
  async convertMarkdownToHtml(
    markdownContent: string,
    imageReplacements: Map<number, { diagramId: string; imagePath: string }>,
  ): Promise<string> {
    // Replace mermaid blocks with placeholders to prevent micromark from escaping HTML
    let processedContent = markdownContent
    const placeholders: Map<string, string> = new Map()
    const replacements: Array<{ start: number; end: number; placeholder: string }> = []

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

    replacements.sort((a, b) => b.start - a.start)
    for (const { start, end, placeholder } of replacements) {
      processedContent =
        processedContent.slice(0, start) + placeholder + processedContent.slice(end)
    }

    const htmlContent = micromark(processedContent, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    })

    let finalHtml = htmlContent
    for (const [placeholder, svgHtml] of placeholders.entries()) {
      finalHtml = finalHtml.replace(placeholder, svgHtml)
    }

    return wrapInHtmlDocument(finalHtml)
  }

  /**
   * Convert markdown file to HTML with mermaid diagrams rendered as SVG images.
   * Returns path to output HTML file.
   */
  async convert(markdownFile: string, outputFile?: string): Promise<string> {
    const markdownContent = await readFile(markdownFile, "utf-8")
    const diagrams = this.extractMermaidDiagrams(markdownContent)
    logger.info({ count: diagrams.length }, "Found mermaid diagrams in markdown")

    const imageReplacements = new Map<number, { diagramId: string; imagePath: string }>()

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

    const htmlContent = await this.convertMarkdownToHtml(markdownContent, imageReplacements)

    const output = outputFile || markdownFile.replace(/\.md$/i, ".html")
    await writeFile(output, htmlContent, "utf-8")

    logger.info(
      { input: markdownFile, output, diagramsRendered: diagrams.length },
      "Successfully converted markdown to HTML",
    )

    return output
  }
}
