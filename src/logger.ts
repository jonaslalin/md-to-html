/**
 * Logger configuration using pino.
 */

import pino from "pino"

/**
 * Checks if running in development mode.
 */
const isDevelopment = process.env.NODE_ENV !== "production"

/**
 * Default log level.
 */
const DEFAULT_LOG_LEVEL = isDevelopment ? "debug" : "info"

/**
 * Configured logger instance.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || DEFAULT_LOG_LEVEL,
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      }
    : undefined,
})
