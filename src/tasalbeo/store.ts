import path from "node:path";

import { JsonFile } from "../storage/json-file.js";

/**
 * 걸려 있는 타살버.
 *
 * 되돌리려면 **걸기 전 별명**을 들고 있어야 한다 — 디스코드는 예전 값을 알려 주지 않는다.
 * 채팅을 막는 역할 id 도 서버마다 하나씩 기억해 둔다 (매번 새로 만들지 않으려고).
 */
export interface TasalbeoState {
  userId: string;
  /** 풀리는 시각. */
  until: number;
  /** 명령을 쓴 사람. 알림 footer 에 쓴다. */
  appliedBy: string;
  appliedAt: number;
  /** 알림을 보낼 채널. */
  channelId: string | null;
  /** 타살버를 건 메시지 — 종료 안내를 여기에 답장으로 단다. */
  messageId: string | null;
  /** 걸기 전 별명. `null` 이면 별명이 없었다(사용자명 그대로). */
  previousNickname: string | null;
}

interface GuildTasalbeo {
  /** 채팅을 막는 역할. 아직 안 만들었으면 null. */
  roleId: string | null;
  targets: Record<string, TasalbeoState>;
}

interface TasalbeoData {
  guilds: Record<string, GuildTasalbeo>;
}

const file = new JsonFile<TasalbeoData>(
  path.resolve(process.cwd(), "data", "tasalbeo.json"),
  () => ({ guilds: {} }),
);

function guildOf(data: TasalbeoData, guildId: string): GuildTasalbeo {
  data.guilds[guildId] ??= { roleId: null, targets: {} };
  return data.guilds[guildId];
}

export async function getState(
  guildId: string,
  userId: string,
): Promise<TasalbeoState | undefined> {
  return (await file.read()).guilds[guildId]?.targets[userId];
}

export async function setState(guildId: string, state: TasalbeoState): Promise<void> {
  await file.update((data) => {
    guildOf(data, guildId).targets[state.userId] = state;
  });
}

/**
 * 읽으면서 동시에 지운다.
 *
 * 예약된 타이머와 손으로 푸는 명령이 겹쳐도 먼저 가져간 쪽만 뒷정리와 알림을 한다.
 * `update` 는 큐로 직렬화되므로 둘이 같은 상태를 가져갈 수 없다.
 */
export async function takeState(
  guildId: string,
  userId: string,
): Promise<TasalbeoState | undefined> {
  let taken: TasalbeoState | undefined;

  await file.update((data) => {
    const guild = data.guilds[guildId];
    if (guild === undefined) return;

    taken = guild.targets[userId];
    delete guild.targets[userId];
  });

  return taken;
}

/** 부팅 시 예약과 반복을 되살리기 위해 전부 모아 온다. */
export async function allStates(): Promise<{ guildId: string; state: TasalbeoState }[]> {
  const { guilds } = await file.read();
  const found: { guildId: string; state: TasalbeoState }[] = [];

  for (const [guildId, guild] of Object.entries(guilds)) {
    for (const state of Object.values(guild.targets)) found.push({ guildId, state });
  }

  return found;
}

/** 지금 타살버가 걸려 있는 사람들 — 메시지에 반응을 달지 판단할 때 쓴다. */
export async function activeTargets(guildId: string): Promise<ReadonlySet<string>> {
  const guild = (await file.read()).guilds[guildId];
  return new Set(Object.keys(guild?.targets ?? {}));
}

export async function getRoleId(guildId: string): Promise<string | null> {
  return (await file.read()).guilds[guildId]?.roleId ?? null;
}

export async function setRoleId(guildId: string, roleId: string | null): Promise<void> {
  await file.update((data) => {
    guildOf(data, guildId).roleId = roleId;
  });
}
