type LogLevel = "info" | "warn" | "error" | "debug";

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, data?: unknown): void {
  const prefix = `[${timestamp()}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    console[level === "debug" ? "log" : level](`${prefix} ${message}`, data);
  } else {
    console[level === "debug" ? "log" : level](`${prefix} ${message}`);
  }
}

export const logger = {
  info: (msg: string, data?: unknown) => log("info", msg, data),
  warn: (msg: string, data?: unknown) => log("warn", msg, data),
  error: (msg: string, data?: unknown) => log("error", msg, data),
  debug: (msg: string, data?: unknown) => log("debug", msg, data),
};
