import { TimestampStyles, time } from "discord.js";

/**
 * 시간 입력과 시간 출력을 한곳에서 다룬다.
 *
 * **입력** — 일 · 시간 · 분 · 초로 적는다. 단위를 안 쓰면 초로 본다.
 *   `1일 4시간 45초` → 100845초
 *   `64`            → 64초 (= 1분 4초)
 *
 * **출력** — 시각이나 남은 시간은 반드시 디스코드 타임스탬프 마크다운으로 낸다.
 * 문자열로 직접 적으면 보는 사람의 시간대가 반영되지 않는다.
 */

const SECOND = 1;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 안전장치 — 이보다 긴 기간은 받지 않는다. */
export const MAX_DURATION_SECONDS = 365 * DAY;

const UNIT_SECONDS: Record<string, number> = {
  일: DAY,
  d: DAY,
  day: DAY,
  days: DAY,

  시간: HOUR,
  시: HOUR,
  h: HOUR,
  hour: HOUR,
  hours: HOUR,

  분: MINUTE,
  m: MINUTE,
  min: MINUTE,
  mins: MINUTE,
  minute: MINUTE,
  minutes: MINUTE,

  초: SECOND,
  s: SECOND,
  sec: SECOND,
  secs: SECOND,
  second: SECOND,
  seconds: SECOND,
};

// 긴 단위를 먼저 적어야 한다 — `시간` 보다 `시` 가 앞에 오면 "4시간" 이 "4시" + "간" 으로 잘린다.
const TOKEN =
  /(\d+)\s*(일|시간|시|분|초|days?|hours?|minutes?|mins?|seconds?|secs?|[dhms])?/giu;

export type DurationResult =
  | { readonly ok: true; readonly seconds: number }
  | { readonly ok: false; readonly reason: "empty" | "invalid" | "zero" | "tooLong" };

/**
 * 사람이 적은 기간을 초로 바꾼다.
 *
 * 알 수 없는 글자가 섞여 있으면 조용히 무시하지 않고 형식 오류로 돌려준다 —
 * `1일 4시간` 을 `1일 4시` 로 잘못 읽어 엉뚱한 시간에 풀리는 것이 더 나쁘다.
 */
export function parseDuration(input: string): DurationResult {
  const text = input.trim().toLowerCase();
  if (text === "") return { ok: false, reason: "empty" };

  let total = 0;
  let cursor = 0;
  let found = false;

  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;

    // 토큰 사이에 공백 말고 다른 게 있으면 입력이 잘못된 것이다.
    if (text.slice(cursor, index).trim() !== "") return { ok: false, reason: "invalid" };

    const amount = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(amount)) return { ok: false, reason: "invalid" };

    // 단위를 안 적었으면 초.
    const unit = match[2];
    const multiplier = unit === undefined ? SECOND : UNIT_SECONDS[unit];
    if (multiplier === undefined) return { ok: false, reason: "invalid" };

    total += amount * multiplier;
    cursor = index + match[0].length;
    found = true;
  }

  if (!found || text.slice(cursor).trim() !== "") return { ok: false, reason: "invalid" };
  if (total <= 0) return { ok: false, reason: "zero" };
  if (total > MAX_DURATION_SECONDS) return { ok: false, reason: "tooLong" };

  return { ok: true, seconds: total };
}

/** 형식 오류를 사람이 읽을 수 있게. */
export function describeDurationError(reason: Exclude<DurationResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "empty":
      return "기간을 입력해 주세요.";
    case "zero":
      return "기간은 0보다 커야 해요.";
    case "tooLong":
      return "기간이 너무 깁니다. 365일 이내로 적어 주세요.";
    case "invalid":
      return "기간 형식을 알 수 없어요. `1일 4시간 45초` 처럼 적거나, 숫자만 쓰면 초로 봅니다 (`64` = 1분 4초).";
  }
}

/** 초를 `1일 4시간 45초` 형태로. 0 인 단위는 생략한다. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0초";

  const parts: string[] = [];
  let rest = Math.floor(seconds);

  for (const [unit, size] of [
    ["일", DAY],
    ["시간", HOUR],
    ["분", MINUTE],
    ["초", SECOND],
  ] as const) {
    const value = Math.floor(rest / size);
    if (value > 0) parts.push(`${value}${unit}`);
    rest -= value * size;
  }

  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────
// 출력 — 전부 타임스탬프 마크다운으로
// ─────────────────────────────────────────────────────────────

/** `2026년 7월 25일 오후 6시 12분` 처럼 보는 사람의 시간대로 표시된다. */
export function at(date: Date): string {
  return time(date, TimestampStyles.LongDateTime);
}

/** `3시간 후` / `5분 전` — 디스코드가 알아서 계속 갱신해 준다. */
export function countdown(date: Date): string {
  return time(date, TimestampStyles.RelativeTime);
}

/** 시각과 남은 시간을 함께 — `2026년 7월 25일 오후 6시 12분 (3시간 후)` */
export function atWithCountdown(date: Date): string {
  return `${at(date)} (${countdown(date)})`;
}
