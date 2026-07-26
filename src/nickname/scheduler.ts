import type { Client } from "discord.js";

import { logger } from "../logger.js";
import { channelMessage } from "../ui/response.js";
import { MODE } from "./ids.js";
import { applyNickname, memberFetchRetryDelay } from "./runner.js";
import { clearState, getState, statesWithExpiry } from "./store.js";
import { resultView } from "./views.js";

/**
 * 뚜따이 기간이 지나면 자동으로 바사삭한다.
 *
 * 예약은 파일에 저장된 만료 시각을 기준으로 하므로 봇을 재시작해도 되살아난다
 * (`restoreExpirySchedules` 를 clientReady 에서 호출).
 */

/** setTimeout 이 한 번에 감당하는 최대 지연 (약 24.8일). 더 길면 잘라서 다시 예약한다. */
const MAX_DELAY_MS = 2 ** 31 - 1;

const timers = new Map<string, NodeJS.Timeout>();

export function cancelExpiry(guildId: string): void {
  const timer = timers.get(guildId);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(guildId);
}

export function scheduleExpiry(client: Client, guildId: string, expiresAt: number): void {
  cancelExpiry(guildId);

  const delay = expiresAt - Date.now();

  if (delay > MAX_DELAY_MS) {
    timers.set(
      guildId,
      setTimeout(() => {
        scheduleExpiry(client, guildId, expiresAt);
      }, MAX_DELAY_MS),
    );
    return;
  }

  timers.set(
    guildId,
    setTimeout(() => {
      void expire(client, guildId);
    }, Math.max(delay, 0)),
  );
}

async function expire(client: Client, guildId: string): Promise<void> {
  timers.delete(guildId);

  const state = await getState(guildId);
  // 그 사이에 누가 바사삭했으면 할 일이 없다.
  if (state === undefined) return;

  try {
    const guild = await client.guilds.fetch(guildId);

    // 알림의 footer 에 넣을 사람 — 뚜따이를 건 사람. 못 찾으면 봇 자신.
    const actor = await client.users.fetch(state.appliedBy).catch(() => client.user);

    const result = await applyNickname(guild, null, "뚜따이 기간 만료 — 자동 바사삭", () => {});
    await clearState(guildId);

    logger.info(
      `뚜따이 기간 만료로 자동 바사삭 (${guildId}) — 완료 ${result.changed + result.skipped}명 / 실패 ${result.failed}명`,
    );
    if (result.failures.length > 0) logger.info(`  실패 사유 — ${result.failures.join(" / ")}`);

    if (state.channelId === null || actor === null) return;

    const channel = await client.channels.fetch(state.channelId).catch(() => null);
    if (channel === null || !channel.isSendable()) return;

    await channel.send(
      channelMessage({
        ...resultView(
          { mode: MODE.basasak, nickname: null, expiresAt: null, user: actor },
          result,
        ),
        title: "기간이 끝나 자동으로 바사삭했습니다",
      }),
    );
  } catch (error) {
    const wait = memberFetchRetryDelay(error);

    if (wait === undefined) {
      logger.error(`자동 바사삭 실패 (${guildId})`, error);
      return;
    }

    // 요청 제한이면 상태를 지우지 않았으니 다시 예약해서 나중에 처리한다.
    logger.warn(
      `자동 바사삭이 요청 제한에 걸렸습니다 (${guildId}). ${(wait / 1000).toFixed(1)}초 뒤 다시 시도합니다.`,
    );
    scheduleExpiry(client, guildId, Date.now() + wait);
  }
}

/** 부팅 시 저장된 만료 예약을 되살린다. 이미 지난 것은 바로 처리한다. */
export async function restoreExpirySchedules(client: Client): Promise<number> {
  const states = await statesWithExpiry();
  const overdue: string[] = [];

  for (const { guildId, state } of states) {
    if (state.expiresAt === null) continue;

    if (state.expiresAt <= Date.now()) overdue.push(guildId);
    else scheduleExpiry(client, guildId, state.expiresAt);
  }

  if (overdue.length > 0) {
    // 부팅을 붙잡지는 않되, 서버끼리는 **순서대로** 처리한다.
    // 동시에 멤버 목록을 요청하면 게이트웨이 요청 제한에 바로 걸린다.
    void (async () => {
      for (const guildId of overdue) {
        logger.info(`뚜따이 기간이 이미 지났습니다 — 바사삭합니다 (${guildId})`);
        await expire(client, guildId);
      }
    })();
  }

  return states.length;
}
