/**
 * Mermaid diagram renderer module.
 * Renders mermaid diagrams to SVG using Mermaid CLI.
 */

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { logger } from "./logger.js"

const MERMAID_RENDER_TIMEOUT_MS = 30000

const execFileAsync = promisify(execFile)

export class MermaidRenderer {
  private tempDir: string | null = null
  private mmdcPath: string

  constructor() {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const projectRoot = resolve(__dirname, "..")
    const localMmdc = join(projectRoot, "node_modules", ".bin", "mmdc")

    if (!existsSync(localMmdc)) {
      throw new Error(
        `Mermaid CLI not found at ${localMmdc}. ` +
          "Please install it locally by running: npm install",
      )
    }

    this.mmdcPath = localMmdc
  }

  /**
   * Render mermaid diagram to SVG image (high quality, scalable).
   * Returns path to SVG file or null if rendering fails.
   */
  async renderMermaidToSvg(mermaidCode: string, diagramId: string): Promise<string | null> {
    if (!this.tempDir) {
      this.tempDir = await mkdtemp(join(tmpdir(), "md-to-html-"))
    }

    const mermaidFile = join(this.tempDir, `${diagramId}.mmd`)
    const outputFile = join(this.tempDir, `${diagramId}.svg`)

    await writeFile(mermaidFile, mermaidCode, "utf-8")

    try {
      await execFileAsync(
        this.mmdcPath,
        ["-i", mermaidFile, "-o", outputFile, "-e", "svg", "-b", "transparent"],
        {
          timeout: MERMAID_RENDER_TIMEOUT_MS,
          cwd: process.cwd(),
        },
      )

      if (existsSync(outputFile)) {
        return outputFile
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ETIMEDOUT") {
        logger.warn(
          { diagramId, timeout: MERMAID_RENDER_TIMEOUT_MS },
          "Mermaid CLI timeout while rendering diagram",
        )
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error(
          { diagramId, error: errorMessage },
          "Mermaid CLI error while rendering diagram",
        )
      }
    }

    return null
  }

  /**
   * Clean up temporary files.
   */
  async cleanup(): Promise<void> {
    if (this.tempDir) {
      try {
        await rm(this.tempDir, { recursive: true, force: true })
        logger.debug({ tempDir: this.tempDir }, "Cleaned up temporary directory")
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.warn(
          { tempDir: this.tempDir, error: errorMessage },
          "Failed to clean up temporary directory",
        )
      }
      this.tempDir = null
    }
  }
}
