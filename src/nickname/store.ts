import path from "node:path";

import { JsonFile } from "../storage/json-file.js";

/**
 * 지금 걸려 있는 뚜따이 상태. 서버당 하나만 유효하다.
 *
 * 예전 별명은 저장하지 않는다 — 바사삭은 별명을 지워 디스코드 기본값(사용자명)으로
 * 되돌리는 방식이라 되돌릴 값을 들고 있을 필요가 없다.
 */
export interface NicknameState {
  /** 적용된 별명. */
  nickname: string;
  /** 명령을 쓴 사람. 만료 알림의 footer 에 쓴다. */
  appliedBy: string;
  appliedAt: number;
  /** 이 시각이 지나면 자동으로 바사삭된다. null 이면 수동으로 풀 때까지 유지. */
  expiresAt: number | null;
  /** 만료 알림을 보낼 채널. */
  channelId: string | null;
}

interface NicknameData {
  guilds: Record<string, NicknameState>;
}

const file = new JsonFile<NicknameData>(
  path.resolve(process.cwd(), "data", "nicknames.json"),
  () => ({ guilds: {} }),
);

export async function getState(guildId: string): Promise<NicknameState | undefined> {
  return (await file.read()).guilds[guildId];
}

export async function setState(guildId: string, state: NicknameState): Promise<void> {
  await file.update((data) => {
    data.guilds[guildId] = state;
  });
}

export async function clearState(guildId: string): Promise<void> {
  await file.update((data) => {
    delete data.guilds[guildId];
  });
}

/** 부팅 시 예약을 되살리기 위해 만료가 걸린 서버만 모아 온다. */
export async function statesWithExpiry(): Promise<{ guildId: string; state: NicknameState }[]> {
  const { guilds } = await file.read();

  return Object.entries(guilds)
    .filter(([, state]) => state.expiresAt !== null)
    .map(([guildId, state]) => ({ guildId, state }));
}
