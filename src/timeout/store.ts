import path from "node:path";

import { JsonFile } from "../storage/json-file.js";

/**
 * 걸려 있는 타임아웃.
 *
 * 타임아웃 자체는 디스코드가 들고 있다 — 여기 저장하는 건 **끝날 때 알리기 위한 정보**뿐이다.
 * 어느 채널에 알릴지, footer 에 누구를 적을지는 디스코드가 알려 주지 않는다.
 */
export interface TimeoutState {
  userId: string;
  /** 풀리는 시각. */
  until: number;
  /** 명령을 쓴 사람. 알림 footer 에 쓴다. */
  appliedBy: string;
  appliedAt: number;
  /** 알림을 보낼 채널. */
  channelId: string | null;
  /** 타임아웃을 건 메시지 — 종료 알림을 여기에 답장으로 단다. */
  messageId: string | null;
  /** 걸 때 적어 둔 사유. 안 적었으면 null. 옛 파일에는 아예 없다. */
  reason?: string | null;
}

interface TimeoutData {
  guilds: Record<string, Record<string, TimeoutState>>;
}

const file = new JsonFile<TimeoutData>(
  path.resolve(process.cwd(), "data", "timeouts.json"),
  () => ({ guilds: {} }),
);

export async function getState(guildId: string, userId: string): Promise<TimeoutState | undefined> {
  return (await file.read()).guilds[guildId]?.[userId];
}

export async function setState(guildId: string, state: TimeoutState): Promise<void> {
  await file.update((data) => {
    data.guilds[guildId] ??= {};
    data.guilds[guildId][state.userId] = state;
  });
}

/**
 * 읽으면서 동시에 지운다.
 *
 * 알림이 두 번 나가지 않게 하는 장치다 — 예약된 타이머와 `guildMemberUpdate` 가
 * 거의 같은 순간에 들어올 수 있는데, 상태를 먼저 가져간 쪽만 알림을 낸다.
 * `update` 는 큐로 직렬화되므로 둘이 같은 상태를 가져가는 일이 없다.
 */
export async function takeState(
  guildId: string,
  userId: string,
): Promise<TimeoutState | undefined> {
  let taken: TimeoutState | undefined;

  await file.update((data) => {
    const guild = data.guilds[guildId];
    if (guild === undefined) return;

    taken = guild[userId];
    delete guild[userId];
    if (Object.keys(guild).length === 0) delete data.guilds[guildId];
  });

  return taken;
}

/** 부팅 시 예약을 되살리기 위해 전부 모아 온다. */
export async function allStates(): Promise<{ guildId: string; state: TimeoutState }[]> {
  const { guilds } = await file.read();
  const found: { guildId: string; state: TimeoutState }[] = [];

  for (const [guildId, members] of Object.entries(guilds)) {
    for (const state of Object.values(members)) found.push({ guildId, state });
  }

  return found;
}
