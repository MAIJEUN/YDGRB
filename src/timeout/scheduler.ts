import type { Client } from "discord.js";

import { logger } from "../logger.js";
import { channelMessage } from "../ui/response.js";
import { allStates, takeState } from "./store.js";
import { endNoticeView } from "./views.js";

/**
 * 타임아웃이 끝나면 채널에 한 번 알린다.
 *
 * 디스코드는 타임아웃이 **저절로 풀릴 때 아무 이벤트도 보내지 않는다.**
 * 그래서 뚜따이 만료처럼 직접 예약해 두고, 그 시각에 알림을 낸다.
 * 예약 기준은 파일에 저장된 시각이라 봇을 재시작해도 되살아난다
 * (`restoreTimeoutSchedules` 를 clientReady 에서 호출).
 *
 * 중간에 풀리는 경우는 `guildMemberUpdate` 가 잡아서 `announceRelease` 로 온다.
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
      void announce(client, guildId, userId, null);
    }, Math.max(delay, 0)),
  );
}

/**
 * 중간에 풀렸을 때.
 *
 * `/타임아웃` 으로 풀면 명령이 직접 부르고(푼 사람을 정확히 안다),
 * 디스코드 화면에서 풀면 `guildMemberUpdate` 가 감사 로그를 뒤져 부른다.
 *
 * 우리가 걸어 둔 타임아웃일 때만 알린다 — 저장된 게 없으면 어느 채널에 알릴지도 모르고,
 * 봇 밖에서 걸고 푼 것까지 떠드는 건 시끄럽다.
 */
export async function announceRelease(
  client: Client,
  guildId: string,
  userId: string,
  releasedBy: string | null,
): Promise<void> {
  cancelEnd(guildId, userId);
  await announce(client, guildId, userId, releasedBy ?? client.user?.id ?? null);
}

async function announce(
  client: Client,
  guildId: string,
  userId: string,
  releasedBy: string | null,
): Promise<void> {
  timers.delete(key(guildId, userId));

  // 읽으면서 지운다 — 먼저 가져간 쪽만 알린다. 알림이 두 번 나가는 걸 여기서 막는다.
  const state = await takeState(guildId, userId);
  if (state === undefined) return;

  logger.info(
    releasedBy === null
      ? `타임아웃 기간 만료 (${key(guildId, userId)})`
      : `타임아웃 해제됨 (${key(guildId, userId)})`,
  );

  if (state.channelId === null) return;

  try {
    // 알림 footer 에 넣을 사람 — 타임아웃을 건 사람. 못 찾으면 봇 자신.
    const actor = await client.users.fetch(state.appliedBy).catch(() => client.user);
    if (actor === null) return;

    const channel = await client.channels.fetch(state.channelId).catch(() => null);
    if (channel === null || !channel.isSendable()) return;

    await channel.send(
      channelMessage(
        endNoticeView({
          targetId: userId,
          until: new Date(state.until),
          releasedBy,
          user: actor,
        }),
      ),
    );
  } catch (error) {
    // 알림에 실패해도 타임아웃 자체는 이미 끝났다. 로그만 남긴다.
    logger.error(`타임아웃 종료 알림 실패 (${key(guildId, userId)})`, error);
  }
}

/** 부팅 시 저장된 예약을 되살린다. 이미 지난 것은 바로 알린다. */
export async function restoreTimeoutSchedules(client: Client): Promise<number> {
  const states = await allStates();

  for (const { guildId, state } of states) {
    if (state.until <= Date.now()) {
      // 봇이 꺼져 있는 동안 끝난 것 — 알림에 실제 시각이 들어가므로 늦게 떠도 말이 된다.
      void announce(client, guildId, state.userId, null);
    } else {
      scheduleEnd(client, guildId, state.userId, state.until);
    }
  }

  return states.length;
}
