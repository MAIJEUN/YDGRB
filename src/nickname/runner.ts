import { setTimeout as sleep } from "node:timers/promises";

import type { Guild, GuildMember } from "discord.js";

import { describeError } from "../errors.js";
import { logger } from "../logger.js";
import { speak } from "../ui/tone.js";

/**
 * 서버 전원의 별명을 한꺼번에 바꾼다.
 *
 * 바꿀 수 없는 사람이 반드시 생긴다 — 서버 소유자는 디스코드가 아예 막아 두었고,
 * 봇보다 높은 역할을 가진 사람도 바꿀 수 없다. 그래서 실패를 오류로 보지 않고
 * 원인별로 세어서 결과에 함께 보여 준다.
 */

/** 진행률을 이 간격보다 자주 갱신하지 않는다 — 메시지 수정에도 요청 제한이 있다. */
const PROGRESS_INTERVAL_MS = 1500;

/** 요청 제한에 걸렸을 때 재시도 횟수와, 디스코드가 알려 준 대기 시간에 더할 여유. */
const FETCH_ATTEMPTS = 4;
const RETRY_BUFFER_MS = 500;

/**
 * 멤버 목록 요청(게이트웨이 opcode 8)은 제한이 빡빡하다.
 * 여러 서버를 동시에 처리하면 바로 걸리므로 프로세스 전체에서 한 번에 하나만 보낸다.
 */
let fetchQueue: Promise<unknown> = Promise.resolve();

function queued<T>(task: () => Promise<T>): Promise<T> {
  const run = fetchQueue.then(task, task);
  fetchQueue = run.catch(() => undefined);
  return run;
}

/**
 * 요청 제한 오류면 디스코드가 알려 준 대기 시간(ms), 아니면 undefined.
 *
 * catch 블록에서 부르는 함수이므로 무엇이 던져져도 터지지 않아야 한다.
 */
export function memberFetchRetryDelay(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const retryAfter = (error as { data?: { retry_after?: unknown } }).data?.retry_after;
  return typeof retryAfter === "number" ? retryAfter * 1000 + RETRY_BUFFER_MS : undefined;
}

/**
 * 서버 전원을 가져온다.
 *
 * 캐시가 이미 전원을 담고 있으면 게이트웨이에 묻지 않는다 —
 * 뚜따이 직후 바사삭처럼 연달아 실행할 때 제한에 걸리는 주된 원인이었다.
 */
async function fetchAllMembers(guild: Guild): Promise<GuildMember[]> {
  if (guild.members.cache.size >= guild.memberCount) {
    return [...guild.members.cache.values()];
  }

  return queued(async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return [...(await guild.members.fetch()).values()];
      } catch (error) {
        const wait = memberFetchRetryDelay(error);
        if (wait === undefined || attempt >= FETCH_ATTEMPTS) throw error;

        logger.warn(
          `멤버 목록 요청이 제한되었습니다. ${(wait / 1000).toFixed(1)}초 뒤 다시 시도합니다 (${attempt}/${FETCH_ATTEMPTS})`,
        );
        await sleep(wait);
      }
    }
  });
}

export interface Progress {
  /** 대상 인원 (봇 제외). */
  readonly total: number;
  readonly done: number;
  /** 실제로 바꾼 사람. */
  readonly changed: number;
  /** 이미 같은 별명이라 요청을 보내지 않은 사람. */
  readonly skipped: number;
  readonly failed: number;
}

export interface RunResult extends Progress {
  /** 원인별 실패 요약 — `봇보다 높은 역할 (3명)` 처럼. */
  readonly failures: readonly string[];
  /** 도중에 멈췄는지. 남은 사람은 손대지 않은 상태다. */
  readonly cancelled: boolean;
}

export interface ApplyOptions {
  readonly guild: Guild;
  /** null 이면 별명을 지운다 = 바사삭. */
  readonly nickname: string | null;
  /** 감사 로그에 남을 이유. */
  readonly reason: string;
  readonly onProgress: (progress: Progress) => Promise<void> | void;
  /** 매 사람마다 확인한다. true 를 돌려주면 그 자리에서 멈춘다. */
  readonly shouldStop?: () => boolean;
  /** 지목한 대상들. 비어 있으면 서버 전원(봇 제외). */
  readonly targetIds?: readonly string[];
}

function emptyProgress(total: number): Progress {
  return { total, done: 0, changed: 0, skipped: 0, failed: 0 };
}

/** 실패 원인을 사람이 읽을 수 있게 묶는다. 개인별로 나열하면 너무 길어진다. */
function describeFailure(guild: Guild, member: GuildMember, error: unknown): string {
  if (member.id === guild.ownerId) return speak("서버 소유자 (디스코드가 변경을 막습니다)");

  const code = (error as { code?: unknown }).code;
  if (code === 50013) return "봇보다 높은 역할 (권한 부족)";

  return describeError(error);
}

/**
 * 대상 목록.
 *
 * 지목한 사람들은 한 명씩 REST 로 가져온다 — `fetch({ user: [...] })` 는 게이트웨이(opcode 8)를
 * 쓰기 때문에 요청 제한에 걸리지만, 개별 조회는 REST 라 그 제한과 무관하다.
 * 전원일 때만 봇을 걸러 낸다 (지목한 대상이 봇이면 그 뜻대로 바꾼다).
 */
async function collectTargets(
  guild: Guild,
  targetIds: readonly string[],
): Promise<{ members: GuildMember[]; missing: string[] }> {
  if (targetIds.length === 0) {
    // GuildMembers 특권 인텐트가 있어야 전원을 받아올 수 있다.
    const all = await fetchAllMembers(guild);
    return { members: all.filter((member) => !member.user.bot), missing: [] };
  }

  const members: GuildMember[] = [];
  const missing: string[] = [];

  for (const id of targetIds) {
    try {
      members.push(await guild.members.fetch(id));
    } catch {
      // 서버를 나갔거나 없는 사람. 전체를 실패시키지 말고 그 사람만 실패로 센다.
      missing.push(id);
    }
  }

  return { members, missing };
}

export async function applyNickname(options: ApplyOptions): Promise<RunResult> {
  const { guild, nickname, reason, onProgress, shouldStop } = options;

  const { members: targets, missing } = await collectTargets(guild, options.targetIds ?? []);

  // 찾지 못한 사람도 대상에 넣고 곧바로 실패로 처리한다 — 전체 인원이 맞아야 진행률이 말이 된다.
  let progress = emptyProgress(targets.length + missing.length);
  const failures = new Map<string, number>();

  if (missing.length > 0) {
    failures.set("서버에 없는 사람", missing.length);
    progress = { ...progress, done: missing.length, failed: missing.length };
  }

  let lastReport = 0;
  const report = async (force: boolean): Promise<void> => {
    const now = Date.now();
    if (!force && now - lastReport < PROGRESS_INTERVAL_MS) return;
    lastReport = now;

    try {
      await onProgress(progress);
    } catch (error) {
      // 진행률 표시가 실패해도 본 작업은 계속한다.
      logger.warn("별명 진행률 갱신 실패", error);
    }
  };

  await report(true);

  let cancelled = false;

  for (const member of targets) {
    // 다른 작업이 시작됐거나 취소 버튼을 눌렀으면 여기서 멈춘다.
    if (shouldStop?.() === true) {
      cancelled = true;
      break;
    }

    if (member.nickname === nickname) {
      // 이미 원하는 상태다. 요청을 아끼면 큰 서버에서 눈에 띄게 빨라진다.
      progress = { ...progress, done: progress.done + 1, skipped: progress.skipped + 1 };
    } else {
      try {
        await member.setNickname(nickname, reason);
        progress = { ...progress, done: progress.done + 1, changed: progress.changed + 1 };
      } catch (error) {
        const cause = describeFailure(guild, member, error);
        failures.set(cause, (failures.get(cause) ?? 0) + 1);
        progress = { ...progress, done: progress.done + 1, failed: progress.failed + 1 };
      }
    }

    await report(false);
  }

  await report(true);

  return {
    ...progress,
    cancelled,
    failures: [...failures.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cause, count]) => `${cause} — ${count}명`),
  };
}
