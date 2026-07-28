import "./env.js";

const LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LEVELS)[number];

export const LOG_LEVELS: readonly LogLevel[] = LEVELS;

export function isLogLevel(value: string | undefined): value is LogLevel {
  return LEVELS.some((level) => level === value);
}

function resolveThreshold(): number {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  return LEVELS.indexOf(isLogLevel(raw) ? raw : "info");
}

// `!y 로그레벨` 로 실행 중에 바꿀 수 있어야 해서 const 가 아니다.
let threshold = resolveThreshold();

export function logLevel(): LogLevel {
  return LEVELS[threshold] ?? "info";
}

/** 실행 중에 기준을 바꾼다. 봇을 껐다 켜면 다시 .env 의 LOG_LEVEL 로 돌아간다. */
export function setLogLevel(level: LogLevel): void {
  threshold = LEVELS.indexOf(level);
}

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

// ─────────────────────────────────────────────────────────────
// 최근 기록 — `!y 로그` 가 읽어 간다
//
// **기준보다 낮은 것도 담는다.** 콘솔에 안 찍힌 debug 를 나중에 들여다볼 수 있어야
// 디버그로서 값이 있다. 창을 못 보는 상황(서비스로 돌릴 때)에도 이것만 있으면 된다.
// ─────────────────────────────────────────────────────────────

/** 메모리에 들고 있을 줄 수. 넘으면 오래된 것부터 버린다. */
const RECENT_LIMIT = 200;
/** 한 줄이 길면 잘라서 담는다 — 컨테이너 글자 수도 한계가 있다. */
const MAX_TEXT = 300;

export interface LogEntry {
  readonly at: number;
  readonly level: LogLevel;
  readonly text: string;
}

const recent: LogEntry[] = [];

/** 콘솔에 찍히는 모양과 달리, 기록용은 한 줄로 눌러 담는다. */
function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function remember(level: LogLevel, args: readonly unknown[]): void {
  const text = args.map(stringify).join(" ").replaceAll(/\s*\n\s*/gu, " ⏎ ");

  recent.push({
    at: Date.now(),
    level,
    text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 3)}...` : text,
  });

  if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT);
}

/** 최근 것부터 `limit` 줄. 레벨을 주면 그 레벨 이상만. */
export function recentLogs(limit: number, minimum?: LogLevel): readonly LogEntry[] {
  const floor = minimum === undefined ? 0 : LEVELS.indexOf(minimum);
  const kept = recent.filter((entry) => LEVELS.indexOf(entry.level) >= floor);

  return kept.slice(Math.max(kept.length - limit, 0));
}

function write(level: LogLevel, args: readonly unknown[]): void {
  remember(level, args);

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
