import type { Client } from "discord.js";

import { logger } from "../logger.js";
import { hasLeft, sendEndNotice } from "../ui/end-notice.js";
import { startLoop, stopLoop } from "./runner.js";
import { allStates, getRoleId, takeState } from "./store.js";

/**
 * 타살버가 끝나면 뒷정리하고 알린다.
 *
 * 뒷정리는 세 가지 —
 *   1. 역할 반복을 멈추고
 *   2. 역할을 빼고
 *   3. 별명을 걸기 전 값으로 되돌린다
 *
 * 예약은 파일에 저장된 시각을 기준으로 하므로 봇을 재시작해도 되살아난다
 * (`restoreTasalbeo` 를 clientReady 에서 호출).
 */

/** setTimeout 이 한 번에 감당하는 최대 지연 (약 24.8일). 더 길면 잘라서 다시 예약한다. */
const MAX_DELAY_MS = 2 ** 31 - 1;

const timers = new Map<string, NodeJS.Timeout>();

function key(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export function cancelEnd(guildId: string, userId: string): void {
  const id = key(guildId, userId);
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
}

export function scheduleEnd(client: Client, guildId: string, userId: string, until: number): void {
  cancelEnd(guildId, userId);

  const delay = until - Date.now();
  const id = key(guildId, userId);

  if (delay > MAX_DELAY_MS) {
    timers.set(
      id,
      setTimeout(() => {
        scheduleEnd(client, guildId, userId, until);
      }, MAX_DELAY_MS),
    );
    return;
  }

  timers.set(
    id,
    setTimeout(() => {
      void finish(client, guildId, userId, null);
    }, Math.max(delay, 0)),
  );
}

/** 손으로 풀 때. `releasedBy` 는 푼 사람. */
export async function releaseTasalbeo(
  client: Client,
  guildId: string,
  userId: string,
  releasedBy: string,
): Promise<boolean> {
  cancelEnd(guildId, userId);
  return finish(client, guildId, userId, releasedBy);
}

/**
 * 뒷정리 + 알림. 이미 끝난 뒤면 아무것도 하지 않고 false 를 돌려준다.
 *
 * 상태를 **읽으면서 지우므로** 예약과 수동 해제가 겹쳐도 한 번만 실행된다.
 */
async function finish(
  client: Client,
  guildId: string,
  userId: string,
  releasedBy: string | null,
): Promise<boolean> {
  timers.delete(key(guildId, userId));
  stopLoop(guildId, userId);

  const state = await takeState(guildId, userId);
  if (state === undefined) return false;

  await cleanUp(client, guildId, state.userId, state.previousNickname);

  logger.info(
    releasedBy === null
      ? `타살버 기간 만료 (${key(guildId, userId)})`
      : `타살버 해제됨 (${key(guildId, userId)})`,
  );

  const actor = await client.users.fetch(state.appliedBy).catch(() => client.user);
  if (actor === null) return true;

  await sendEndNotice(
    client,
    { channelId: state.channelId, messageId: state.messageId },
    {
      effect: "타살버",
      target: `<@${userId}>`,
      until: new Date(state.until),
      reason: releasedBy === null ? { kind: "expired" } : { kind: "released", byId: releasedBy },
      targetLeft: await hasLeft(client, guildId, userId),
      user: actor,
    },
  );

  return true;
}

/** 역할을 빼고 별명을 되돌린다. 대상이 이미 나갔으면 할 수 있는 게 없다. */
async function cleanUp(
  client: Client,
  guildId: string,
  userId: string,
  previousNickname: string | null,
): Promise<void> {
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member === null) return;

    const roleId = await getRoleId(guildId);
    if (roleId !== null && member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, "타살버 종료").catch((error: unknown) => {
        logger.warn(`타살버: 역할을 빼지 못했습니다 (${userId})`, error);
      });
    }

    // 별명은 걸기 전 값으로. null 이면 별명을 지워 사용자명으로 되돌린다.
    await member.setNickname(previousNickname, "타살버 종료").catch((error: unknown) => {
      logger.warn(`타살버: 별명을 되돌리지 못했습니다 (${userId})`, error);
    });
  } catch (error) {
    logger.error(`타살버 뒷정리 실패 (${key(guildId, userId)})`, error);
  }
}

/** 부팅 시 저장된 타살버를 되살린다. 이미 지난 것은 바로 정리한다. */
export async function restoreTasalbeo(client: Client): Promise<number> {
  const states = await allStates();

  for (const { guildId, state } of states) {
    if (state.until <= Date.now()) {
      // 봇이 꺼져 있는 동안 끝났다 — 뒷정리와 알림을 지금 한다.
      void finish(client, guildId, state.userId, null);
      continue;
    }

    scheduleEnd(client, guildId, state.userId, state.until);

    const roleId = await getRoleId(guildId);
    if (roleId !== null) startLoop(client, guildId, state.userId, roleId);
  }

  return states.length;
}
