import path from "node:path";

import { JsonFile } from "../storage/json-file.js";

/**
 * 걸려 있는 뚜따이 상태.
 *
 * 예전 별명은 저장하지 않는다 — 바사삭은 별명을 지워 디스코드 기본값(사용자명)으로
 * 되돌리는 방식이라 되돌릴 값을 들고 있을 필요가 없다.
 *
 * 전체 대상과 개별 대상을 **따로** 보관한다. 한 칸만 두면 누군가에게 개별 뚜따이를 거는 순간
 * 서버 전체에 걸어 둔 자동 바사삭 예약이 사라져 버린다.
 */
export interface NicknameState {
  nickname: string;
  /** 명령을 쓴 사람. 만료 알림의 footer 에 쓴다. */
  appliedBy: string;
  appliedAt: number;
  /** 이 시각이 지나면 자동으로 바사삭된다. null 이면 수동으로 풀 때까지 유지. */
  expiresAt: number | null;
  /** 만료 알림을 보낼 채널. */
  channelId: string | null;
  /** null 이면 서버 전체. */
  targetId: string | null;
}

interface GuildNicknames {
  all: NicknameState | null;
  members: Record<string, NicknameState>;
}

interface NicknameData {
  guilds: Record<string, GuildNicknames>;
}

const file = new JsonFile<NicknameData>(
  path.resolve(process.cwd(), "data", "nicknames.json"),
  () => ({ guilds: {} }),
);

function guildOf(data: NicknameData, guildId: string): GuildNicknames {
  const existing = data.guilds[guildId];
  if (existing !== undefined) return existing;

  const created: GuildNicknames = { all: null, members: {} };
  data.guilds[guildId] = created;
  return created;
}

export async function getState(
  guildId: string,
  targetId: string | null,
): Promise<NicknameState | undefined> {
  const guild = (await file.read()).guilds[guildId];
  if (guild === undefined) return undefined;

  return targetId === null ? (guild.all ?? undefined) : guild.members[targetId];
}

export async function setState(guildId: string, state: NicknameState): Promise<void> {
  await file.update((data) => {
    const guild = guildOf(data, guildId);

    if (state.targetId === null) guild.all = state;
    else guild.members[state.targetId] = state;
  });
}

export async function clearState(guildId: string, targetId: string | null): Promise<void> {
  await file.update((data) => {
    const guild = data.guilds[guildId];
    if (guild === undefined) return;

    if (targetId === null) guild.all = null;
    else delete guild.members[targetId];
  });
}

/** 서버 전체 바사삭 — 전체와 개별 예약을 모두 지운다. 모두의 별명이 사라지기 때문이다. */
export async function clearAllStates(guildId: string): Promise<void> {
  await file.update((data) => {
    delete data.guilds[guildId];
  });
}

/** 부팅 시 예약을 되살리기 위해 만료가 걸린 것만 모아 온다. */
export async function statesWithExpiry(): Promise<{ guildId: string; state: NicknameState }[]> {
  const { guilds } = await file.read();
  const found: { guildId: string; state: NicknameState }[] = [];

  for (const [guildId, guild] of Object.entries(guilds)) {
    for (const state of [guild.all, ...Object.values(guild.members)]) {
      if (state !== null && state !== undefined && state.expiresAt !== null) {
        found.push({ guildId, state });
      }
    }
  }

  return found;
}
