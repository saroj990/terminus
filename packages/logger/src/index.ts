export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent {
  level: LogLevel;
  message: string;
  runId?: string;
  ts: string;
  fields?: Record<string, unknown>;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  child(fields: Record<string, unknown>): Logger;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(options?: {
  level?: LogLevel;
  fields?: Record<string, unknown>;
  sink?: (event: LogEvent) => void;
}): Logger {
  const minLevel = options?.level ?? (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";
  const baseFields = options?.fields ?? {};
  const sink =
    options?.sink ??
    ((event: LogEvent) => {
      const line = JSON.stringify(event);
      if (event.level === "error") console.error(line);
      else console.log(line);
    });

  const emit = (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const event: LogEvent = {
      level,
      message,
      ts: new Date().toISOString(),
      fields: { ...baseFields, ...fields },
    };
    if (typeof event.fields?.runId === "string") {
      event.runId = event.fields.runId;
    }
    sink(redact(event));
  };

  return {
    child(fields) {
      return createLogger({
        level: minLevel,
        fields: { ...baseFields, ...fields },
        sink,
      });
    },
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

const SECRET_KEYS = /api[_-]?key|token|password|secret|authorization/i;

function redact(event: LogEvent): LogEvent {
  if (!event.fields) return event;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event.fields)) {
    if (SECRET_KEYS.test(k)) fields[k] = "[REDACTED]";
    else if (typeof v === "string" && /sk-[a-zA-Z0-9]{10,}/.test(v)) {
      fields[k] = v.replace(/sk-[a-zA-Z0-9]+/g, "sk-[REDACTED]");
    } else fields[k] = v;
  }
  return { ...event, fields };
}
