import { randomBytes } from "node:crypto";

import type { User } from "discord.js";
import type { OpenOptions } from "./runner.js";
import type { GameDefinition } from "./types.js";

/**
 * **열려다 막힌 판**을 잠깐 들고 있는 곳.
 *
 * 한 채널에 한 판이라, 이미 도는 판이 있으면 새 판은 거절된다. 그때 「기존 판을 접고
 * 시작」 버튼을 주려면 **무엇을 열려고 했는지**를 기억해야 한다 — 퀴즈의 문제와 정답,
 * 룰렛의 인원, 제목과 기간은 전부 그 명령 한 번에만 실려 오고, 응답한 순간 사라진다.
 *
 * 파일에 남기지 않는다. 정답이 들어 있고(퀴즈), 몇 분 뒤면 쓸모없어지며, 봇이 꺼졌다
 * 켜지면 어차피 그 명령을 다시 치는 것이 빠르다. `prepare` 가 **클로저**라 애초에 저장할
 * 수도 없다.
 */

/** 들고 있는 시간. 모집 마감과 같은 5분 — 그보다 오래 쥐고 있을 이유가 없다. */
export const PENDING_TIMEOUT_SECONDS = 5 * 60;

export interface PendingOpen {
  readonly game: GameDefinition;
  readonly options: OpenOptions;
  readonly guildId: string;
  readonly channelId: string;
  /** 명령을 친 사람. 판의 주최자가 될 사람이다. */
  readonly host: User;
}

const pending = new Map<string, { readonly open: PendingOpen; readonly timer: NodeJS.Timeout }>();

/** customId 에 실을 짧은 id 를 붙여 맡긴다. */
export function keepPending(open: PendingOpen): string {
  let id = randomBytes(4).toString("hex");
  while (pending.has(id)) id = randomBytes(4).toString("hex");

  const timer = setTimeout(() => {
    pending.delete(id);
  }, PENDING_TIMEOUT_SECONDS * 1000);

  // 이 타이머 하나 때문에 프로세스가 안 꺼지면 안 된다.
  timer.unref?.();

  pending.set(id, { open, timer });
  return id;
}

/** 맡긴 것을 **꺼내면서 지운다.** 버튼을 두 번 눌러도 판이 두 번 열리지 않게. */
export function takePending(id: string): PendingOpen | undefined {
  const found = pending.get(id);
  if (found === undefined) return undefined;

  clearTimeout(found.timer);
  pending.delete(id);

  return found.open;
}

/** 종료할 때 타이머를 남기지 않기 위해. */
export function cancelAllPending(): void {
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
}
