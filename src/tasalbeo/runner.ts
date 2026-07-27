import type { Client } from "discord.js";

import { logger } from "../logger.js";
import { OFF_MS, ON_MS } from "./ids.js";

/**
 * 역할을 **2초 붙였다 5초 뺐다** 반복한다.
 *
 * 타이머 하나만 들고 다음 단계를 예약하는 식이라 언제든 끊을 수 있다.
 * 봇이 꺼지면 반복도 멈춘다 — 다시 켜질 때 `restore` 가 되살린다.
 */

/** 연달아 이만큼 실패하면 포기한다 (역할이 지워졌거나 권한을 잃은 경우). */
const MAX_FAILURES = 3;

interface Loop {
  timer: NodeJS.Timeout;
  failures: number;
  /** 끊긴 뒤 늦게 도착한 응답이 다음 단계를 예약하지 못하게 하는 표식. */
  stopped: boolean;
}

const loops = new Map<string, Loop>();

function key(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export function isLooping(guildId: string, userId: string): boolean {
  return loops.has(key(guildId, userId));
}

/** 반복을 멈춘다. 역할을 빼는 것은 호출부(뒷정리)가 한다. */
export function stopLoop(guildId: string, userId: string): void {
  const id = key(guildId, userId);
  const loop = loops.get(id);
  if (loop === undefined) return;

  loop.stopped = true;
  clearTimeout(loop.timer);
  loops.delete(id);
}

export function startLoop(client: Client, guildId: string, userId: string, roleId: string): void {
  stopLoop(guildId, userId);

  const id = key(guildId, userId);
  const loop: Loop = { timer: setTimeout(() => {}, 0), failures: 0, stopped: false };
  loops.set(id, loop);

  const step = async (attach: boolean): Promise<void> => {
    if (loop.stopped) return;

    try {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);

      if (attach) await member.roles.add(roleId, "타살버 — 채팅 막기");
      else await member.roles.remove(roleId, "타살버 — 잠깐 풀기");

      loop.failures = 0;
    } catch (error) {
      loop.failures += 1;

      if (loop.failures >= MAX_FAILURES) {
        logger.warn(`타살버: 역할 반복을 포기합니다 (${id}) — ${String(error)}`);
        stopLoop(guildId, userId);
        return;
      }

      logger.debug(`타살버: 역할 ${attach ? "붙이기" : "빼기"} 실패 (${id})`, error);
    }

    if (loop.stopped) return;

    // 붙였으면 2초 뒤에 빼고, 뺐으면 5초 뒤에 다시 붙인다.
    loop.timer = setTimeout(() => {
      void step(!attach);
    }, attach ? ON_MS : OFF_MS);
  };

  void step(true);
}

/** 모든 반복을 멈춘다 — 종료할 때 타이머를 남기지 않기 위해. */
export function stopAllLoops(): void {
  for (const [id, loop] of loops) {
    loop.stopped = true;
    clearTimeout(loop.timer);
    loops.delete(id);
  }
}
