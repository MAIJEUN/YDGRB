import type { Client } from "discord.js";

import { logger } from "../logger.js";
import { hasLeft, sendEndNotice } from "../ui/end-notice.js";
import { allStates, takeState } from "./store.js";

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

/** 타이머와 **언제 터지는지**를 같이 들고 있는다 — `!y 예약` 이 그 시각을 보여 준다. */
interface Reservation {
  readonly timer: NodeJS.Timeout;
  readonly at: number;
}

const timers = new Map<string, Reservation>();

function key(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export function cancelEnd(guildId: string, userId: string): void {
  const id = key(guildId, userId);
  const reservation = timers.get(id);
  if (reservation !== undefined) clearTimeout(reservation.timer);
  timers.delete(id);
}

export function scheduleEnd(client: Client, guildId: string, userId: string, until: number): void {
  cancelEnd(guildId, userId);

  const delay = until - Date.now();
  const id = key(guildId, userId);

  if (delay > MAX_DELAY_MS) {
    // 잘라서 다시 예약하더라도 `at` 은 **진짜 끝나는 시각**을 그대로 둔다.
    timers.set(id, {
      at: until,
      timer: setTimeout(() => {
        scheduleEnd(client, guildId, userId, until);
      }, MAX_DELAY_MS),
    });
    return;
  }

  timers.set(id, {
    at: until,
    timer: setTimeout(() => {
      void announce(client, guildId, userId, null);
    }, Math.max(delay, 0)),
  });
}

/** 디버그용 — 지금 걸려 있는 예약. */
export function reservations(): { guildId: string; userId: string; at: number }[] {
  return [...timers].map(([id, reservation]) => {
    const [guildId = "", userId = ""] = id.split(":");
    return { guildId, userId, at: reservation.at };
  });
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
  // 못 찾았으면 null 그대로 둔다 — 봇 이름을 대신 적어도 알려 주는 게 없다.
  await announce(client, guildId, userId, releasedBy);
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

  // 알림 footer 에 넣을 사람 — 타임아웃을 건 사람. 못 찾으면 봇 자신.
  const actor = await client.users.fetch(state.appliedBy).catch(() => client.user);
  if (actor === null) return;

  await sendEndNotice(
    client,
    { channelId: state.channelId, messageId: state.messageId },
    {
      effect: "타임아웃",
      target: `<@${userId}>`,
      until: new Date(state.until),
      note: state.reason ?? null,
      reason: releasedBy === null ? { kind: "expired" } : { kind: "released", byId: releasedBy },
      targetLeft: await hasLeft(client, guildId, userId),
      user: actor,
    },
  );
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
