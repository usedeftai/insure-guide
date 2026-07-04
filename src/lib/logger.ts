import { APICallError, AISDKError } from "@ai-sdk/provider";
import winston from "winston";

const level = process.env.LOG_LEVEL ?? "info";
const usePrettyLogs =
  process.env.LOG_FORMAT === "pretty" ||
  (process.env.LOG_FORMAT !== "json" && process.env.NODE_ENV !== "production");

const LEVEL_COLORS: Record<string, string> = {
  error: "\x1b[31m",
  warn: "\x1b[33m",
  info: "\x1b[36m",
  debug: "\x1b[90m",
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function colorize(levelName: string, text: string): string {
  const color = LEVEL_COLORS[levelName] ?? "";
  return color ? `${color}${text}${RESET}` : text;
}

function formatMetaValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatMetaEntries(meta: Record<string, unknown>): string[] {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;

    if (key === "stack" && typeof value === "string") {
      lines.push(`${DIM}  stack:${RESET}`);
      for (const frame of value.split("\n")) {
        lines.push(`${DIM}    ${frame.trim()}${RESET}`);
      }
      continue;
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      lines.push(`  ${key}:`);
      lines.push(
        formatMetaValue(value)
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n")
      );
      continue;
    }

    lines.push(`  ${key}: ${formatMetaValue(value)}`);
  }

  return lines;
}

const prettyFormat = winston.format.printf((info) => {
  const {
    timestamp,
    level: levelName,
    message,
    service,
    component,
    stack,
    ...rest
  } = info;

  const headerParts = [
    colorize(String(levelName), String(levelName).toUpperCase().padEnd(5)),
    `${DIM}${timestamp}${RESET}`,
  ];

  if (service) headerParts.push(`${DIM}${service}${RESET}`);
  if (component) headerParts.push(colorize(String(levelName), String(component)));

  const lines = [`${headerParts.join(" ")} ${BOLD}${message}${RESET}`];
  lines.push(...formatMetaEntries(rest as Record<string, unknown>));

  if (typeof stack === "string") {
    lines.push(`${DIM}  stack:${RESET}`);
    for (const frame of stack.split("\n")) {
      lines.push(`${DIM}    ${frame.trim()}${RESET}`);
    }
  }

  return lines.join("\n");
});

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

export const logger = winston.createLogger({
  level,
  defaultMeta: { service: "backend" },
  format: usePrettyLogs
    ? winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        prettyFormat
      )
    : jsonFormat,
  transports: [new winston.transports.Console()],
});

export function createComponentLogger(component: string) {
  return logger.child({ component });
}

function truncate(value: string, maxLength = 4000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}… [truncated ${value.length - maxLength} chars]`;
}

function serializeCauseChain(
  error: unknown,
  depth = 0
): Record<string, unknown>[] | undefined {
  if (!(error instanceof Error) || !error.cause || depth >= 5) return undefined;

  const chain: Record<string, unknown>[] = [serializeErrorDetails(error.cause)];
  const nested = serializeCauseChain(error.cause, depth + 1);
  if (nested) chain.push(...nested);

  return chain;
}

function serializeErrorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { value: String(error) };
  }

  const details: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if (error.stack) {
    details.stack = error.stack;
  }

  if (AISDKError.isInstance(error)) {
    details.aiSdkError = true;
  }

  if (APICallError.isInstance(error)) {
    details.statusCode = error.statusCode ?? null;
    details.url = error.url ?? null;
    details.isRetryable = error.isRetryable;
    if (error.responseBody) {
      details.responseBody = truncate(
        typeof error.responseBody === "string"
          ? error.responseBody
          : JSON.stringify(error.responseBody)
      );
    }
    if (error.data !== undefined) {
      details.data = error.data;
    }
  }

  const causeChain = serializeCauseChain(error);
  if (causeChain?.length) {
    details.causeChain = causeChain;
  }

  return details;
}

export function serializeError(error: unknown): Record<string, unknown> {
  return serializeErrorDetails(error);
}

export function logError(
  log: winston.Logger,
  message: string,
  error: unknown,
  meta: Record<string, unknown> = {}
) {
  const errorDetails = serializeError(error);

  log.error(message, {
    ...meta,
    error: errorDetails.message ?? String(error),
    errorName: errorDetails.name,
    ...(errorDetails.statusCode !== undefined
      ? { statusCode: errorDetails.statusCode }
      : {}),
    ...(errorDetails.url ? { url: errorDetails.url } : {}),
    ...(errorDetails.responseBody ? { responseBody: errorDetails.responseBody } : {}),
    ...(errorDetails.causeChain ? { causeChain: errorDetails.causeChain } : {}),
    stack: errorDetails.stack,
  });
}
