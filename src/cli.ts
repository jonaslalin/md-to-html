#!/usr/bin/env node

/**
 * Command-line interface for md-to-html.
 */

import { existsSync } from "node:fs"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { MarkdownToHtmlConverter } from "./converter.js"
import { logger } from "./logger.js"
import { MermaidRenderer } from "./renderer.js"

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName("md-to-html")
    .usage("$0 <input> [options]", "Convert markdown with mermaid diagrams to HTML")
    .command(
      "$0 <input>",
      "Convert markdown file to HTML",
      (yargs) => {
        return yargs
          .positional("input", {
            describe: "Input markdown file",
            type: "string",
            demandOption: true,
          })
          .option("output", {
            alias: "o",
            describe:
              "Output HTML file path (default: input filename with .html extension in same directory)",
            type: "string",
          })
      },
      async (argv) => {
        const input = String(argv.input)
        const output = argv.output ? String(argv.output) : undefined

        if (!existsSync(input)) {
          logger.error({ input }, "Input file not found")
          process.exit(1)
        }

        const renderer = new MermaidRenderer()
        const converter = new MarkdownToHtmlConverter(renderer)

        try {
          await converter.convert(input, output)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          logger.error({ error: errorMessage }, "Error during conversion")
          process.exit(1)
        } finally {
          await renderer.cleanup()
        }
      },
    )
    .version("1.0.0")
    .help()
    .alias("help", "h")
    .alias("version", "v")
    .strict()
    .parseAsync()

  return argv
}

main().catch((error) => {
  logger.fatal({ error }, "Fatal error occurred")
  process.exit(1)
})
