import "./env.js";

const LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LEVELS)[number];

function isLogLevel(value: string | undefined): value is LogLevel {
  return LEVELS.some((level) => level === value);
}

function resolveThreshold(): number {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  return LEVELS.indexOf(isLogLevel(raw) ? raw : "info");
}

const threshold = resolveThreshold();

const TAGS: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

function timestamp(): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const now = new Date();

  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return `${date} ${clock}`;
}

function write(level: LogLevel, args: readonly unknown[]): void {
  if (LEVELS.indexOf(level) < threshold) return;

  const prefix = `[${timestamp()}] ${TAGS[level]}`;

  // 경고/오류는 stderr 로 보내 로그 수집 시 분리하기 쉽게 한다.
  if (level === "warn" || level === "error") console.error(prefix, ...args);
  else console.log(prefix, ...args);
}

export const logger = {
  debug: (...args: unknown[]): void => write("debug", args),
  info: (...args: unknown[]): void => write("info", args),
  warn: (...args: unknown[]): void => write("warn", args),
  error: (...args: unknown[]): void => write("error", args),
};
