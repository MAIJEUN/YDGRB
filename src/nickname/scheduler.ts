import type { Client } from "discord.js";

import { logger } from "../logger.js";
import { hasLeft, sendEndNotice } from "../ui/end-notice.js";
import { MODE } from "./ids.js";
import { beginRun } from "./registry.js";
import { applyNickname, memberFetchRetryDelay } from "./runner.js";
import { clearState, getState, statesWithExpiry } from "./store.js";
import { tally } from "./views.js";

/**
 * 뚜따이 기간이 지나면 자동으로 바사삭한다.
 *
 * 예약은 파일에 저장된 만료 시각을 기준으로 하므로 봇을 재시작해도 되살아난다
 * (`restoreExpirySchedules` 를 clientReady 에서 호출).
 * 전체 대상과 개별 대상의 예약을 따로 두므로 키에 대상까지 넣는다.
 */

/** setTimeout 이 한 번에 감당하는 최대 지연 (약 24.8일). 더 길면 잘라서 다시 예약한다. */
const MAX_DELAY_MS = 2 ** 31 - 1;

/** 타이머와 **언제 터지는지**를 같이 들고 있는다 — `!y 예약` 이 그 시각을 보여 준다. */
interface Reservation {
  readonly timer: NodeJS.Timeout;
  readonly at: number;
}

const timers = new Map<string, Reservation>();

function key(guildId: string, targetId: string | null): string {
  return targetId === null ? guildId : `${guildId}:${targetId}`;
}

export function cancelExpiry(guildId: string, targetId: string | null): void {
  const id = key(guildId, targetId);
  const reservation = timers.get(id);
  if (reservation !== undefined) clearTimeout(reservation.timer);
  timers.delete(id);
}

/** 서버 전체 바사삭 — 그 서버의 예약을 전부 지운다. */
export function cancelAllExpiry(guildId: string): void {
  for (const [id, reservation] of [...timers]) {
    if (id === guildId || id.startsWith(`${guildId}:`)) {
      clearTimeout(reservation.timer);
      timers.delete(id);
    }
  }
}

/** 디버그용 — 지금 걸려 있는 예약. `targetId` 가 null 이면 서버 전원. */
export function reservations(): { guildId: string; targetId: string | null; at: number }[] {
  return [...timers].map(([id, reservation]) => {
    const [guildId = "", targetId] = id.split(":");
    return { guildId, targetId: targetId ?? null, at: reservation.at };
  });
}

export function scheduleExpiry(
  client: Client,
  guildId: string,
  targetId: string | null,
  expiresAt: number,
): void {
  cancelExpiry(guildId, targetId);

  const delay = expiresAt - Date.now();
  const id = key(guildId, targetId);

  if (delay > MAX_DELAY_MS) {
    // 잘라서 다시 예약하더라도 `at` 은 **진짜 만료 시각**을 그대로 둔다.
    timers.set(id, {
      at: expiresAt,
      timer: setTimeout(() => {
        scheduleExpiry(client, guildId, targetId, expiresAt);
      }, MAX_DELAY_MS),
    });
    return;
  }

  timers.set(id, {
    at: expiresAt,
    timer: setTimeout(() => {
      void expire(client, guildId, targetId);
    }, Math.max(delay, 0)),
  });
}

async function expire(client: Client, guildId: string, targetId: string | null): Promise<void> {
  timers.delete(key(guildId, targetId));

  const state = await getState(guildId, targetId);
  // 그 사이에 누가 바사삭했으면 할 일이 없다.
  if (state === undefined) return;

  const wholeServer = targetId === null;

  try {
    const guild = await client.guilds.fetch(guildId);

    // 알림의 footer 에 넣을 사람 — 뚜따이를 건 사람. 못 찾으면 봇 자신.
    const actor = await client.users.fetch(state.appliedBy).catch(() => client.user);

    // 전원 대상일 때만 레지스트리를 지난다 (돌고 있는 뚜따이가 있으면 취소하고 기다린다).
    const run = wholeServer ? await beginRun(guildId, MODE.basasak, state.appliedBy) : null;

    let result;
    try {
      result = await applyNickname({
        guild,
        nickname: null,
        targetIds: targetId === null ? [] : [targetId],
        reason: "뚜따이 기간 만료 — 자동 바사삭",
        onProgress: () => {},
        shouldStop: () => run?.cancelled === true,
      });
    } finally {
      run?.finish();
    }

    // 누가 도중에 새 뚜따이를 걸었다면 그 상태를 지우면 안 된다.
    if (result.cancelled) {
      logger.info(`자동 바사삭이 다른 작업에 밀려 중단되었습니다 (${key(guildId, targetId)})`);
      return;
    }

    await clearState(guildId, targetId);

    logger.info(
      `뚜따이 기간 만료로 자동 바사삭 (${key(guildId, targetId)}) — 완료 ${result.changed + result.skipped}명 / 실패 ${result.failed}명`,
    );
    if (result.failures.length > 0) logger.info(`  실패 사유 — ${result.failures.join(" / ")}`);

    if (actor === null) return;

    // 한 명도 못 바꿨으면 빨강, 일부만 못 바꿨으면 노랑 — 다 됐으면 알림 기본색(파랑).
    const outcome =
      result.failed === 0
        ? undefined
        : {
            status: result.changed + result.skipped === 0 ? ("failure" as const) : ("progress" as const),
            fields: [{ name: "집계", value: tally({ ...result, done: result.total }) }],
          };

    await sendEndNotice(
      client,
      { channelId: state.channelId, messageId: state.messageId },
      {
        effect: "뚜따이",
        target: targetId === null ? "**서버 전원**" : `<@${targetId}>`,
        until: new Date(state.expiresAt ?? Date.now()),
        reason: { kind: "expired" },
        outcome,
        targetLeft: targetId === null ? false : await hasLeft(client, guildId, targetId),
        user: actor,
      },
    );
  } catch (error) {
    const wait = memberFetchRetryDelay(error);

    if (wait === undefined) {
      logger.error(`자동 바사삭 실패 (${key(guildId, targetId)})`, error);
      return;
    }

    // 요청 제한이면 상태를 지우지 않았으니 다시 예약해서 나중에 처리한다.
    logger.warn(
      `자동 바사삭이 요청 제한에 걸렸습니다 (${key(guildId, targetId)}). ${(wait / 1000).toFixed(1)}초 뒤 다시 시도합니다.`,
    );
    scheduleExpiry(client, guildId, targetId, Date.now() + wait);
  }
}

/** 부팅 시 저장된 만료 예약을 되살린다. 이미 지난 것은 바로 처리한다. */
export async function restoreExpirySchedules(client: Client): Promise<number> {
  const states = await statesWithExpiry();
  const overdue: { guildId: string; targetId: string | null }[] = [];

  for (const { guildId, state } of states) {
    if (state.expiresAt === null) continue;

    if (state.expiresAt <= Date.now()) overdue.push({ guildId, targetId: state.targetId });
    else scheduleExpiry(client, guildId, state.targetId, state.expiresAt);
  }

  if (overdue.length > 0) {
    // 부팅을 붙잡지는 않되, **순서대로** 처리한다.
    // 동시에 멤버 목록을 요청하면 게이트웨이 요청 제한에 바로 걸린다.
    void (async () => {
      for (const { guildId, targetId } of overdue) {
        logger.info(`뚜따이 기간이 이미 지났습니다 — 바사삭합니다 (${key(guildId, targetId)})`);
        await expire(client, guildId, targetId);
      }
    })();
  }

  return states.length;
}
