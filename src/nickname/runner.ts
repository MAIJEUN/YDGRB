import type { Guild, GuildMember } from "discord.js";

import { describeError } from "../errors.js";
import { logger } from "../logger.js";

/**
 * 서버 전원의 별명을 한꺼번에 바꾼다.
 *
 * 바꿀 수 없는 사람이 반드시 생긴다 — 서버 소유자는 디스코드가 아예 막아 두었고,
 * 봇보다 높은 역할을 가진 사람도 바꿀 수 없다. 그래서 실패를 오류로 보지 않고
 * 원인별로 세어서 결과에 함께 보여 준다.
 */

/** 진행률을 이 간격보다 자주 갱신하지 않는다 — 메시지 수정에도 요청 제한이 있다. */
const PROGRESS_INTERVAL_MS = 1500;

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
}

function emptyProgress(total: number): Progress {
  return { total, done: 0, changed: 0, skipped: 0, failed: 0 };
}

/** 실패 원인을 사람이 읽을 수 있게 묶는다. 개인별로 나열하면 너무 길어진다. */
function describeFailure(guild: Guild, member: GuildMember, error: unknown): string {
  if (member.id === guild.ownerId) return "서버 소유자 (디스코드가 변경을 막습니다)";

  const code = (error as { code?: unknown }).code;
  if (code === 50013) return "봇보다 높은 역할 (권한 부족)";

  return describeError(error);
}

export async function applyNickname(
  guild: Guild,
  /** null 이면 별명을 지운다 = 바사삭. */
  nickname: string | null,
  reason: string,
  onProgress: (progress: Progress) => Promise<void> | void,
): Promise<RunResult> {
  // GuildMembers 특권 인텐트가 있어야 전원을 받아올 수 있다.
  const members = await guild.members.fetch();
  const targets = [...members.values()].filter((member) => !member.user.bot);

  let progress = emptyProgress(targets.length);
  const failures = new Map<string, number>();

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

  for (const member of targets) {
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
    failures: [...failures.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cause, count]) => `${cause} — ${count}명`),
  };
}
