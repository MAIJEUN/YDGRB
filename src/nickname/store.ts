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

/**
 * 저장된 값을 지금 형식으로 맞춘다.
 *
 * 예전에는 서버 칸에 상태가 그대로 들어 있었다 (대상이 전체 하나뿐이었으므로).
 * 그 파일을 그대로 읽으면 `members` 가 없어서 터진다.
 */
function normalize(raw: unknown): GuildNicknames {
  if (typeof raw !== "object" || raw === null) return { all: null, members: {} };

  const value = raw as Partial<GuildNicknames> & Partial<NicknameState>;

  // 예전 형식 — 상태가 곧 서버 칸이었다.
  if (typeof value.nickname === "string") {
    return { all: { ...(raw as NicknameState), targetId: null }, members: {} };
  }

  return { all: value.all ?? null, members: value.members ?? {} };
}

/** update 안에서만 쓴다 — 옛 형식을 새 형식으로 바꿔 저장까지 되게 한다. */
function guildOf(data: NicknameData, guildId: string): GuildNicknames {
  const normalized = normalize(data.guilds[guildId]);
  data.guilds[guildId] = normalized;
  return normalized;
}

export async function getState(
  guildId: string,
  targetId: string | null,
): Promise<NicknameState | undefined> {
  const raw = (await file.read()).guilds[guildId];
  if (raw === undefined) return undefined;

  const guild = normalize(raw);
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
    if (data.guilds[guildId] === undefined) return;

    const guild = guildOf(data, guildId);
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

  for (const [guildId, raw] of Object.entries(guilds)) {
    const guild = normalize(raw);

    for (const state of [guild.all, ...Object.values(guild.members)]) {
      if (state !== null && state !== undefined && state.expiresAt !== null) {
        // 옛 파일에는 targetId 가 없다.
        found.push({ guildId, state: { ...state, targetId: state.targetId ?? null } });
      }
    }
  }

  return found;
}
