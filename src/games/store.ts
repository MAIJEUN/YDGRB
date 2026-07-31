import { randomBytes } from "node:crypto";
import path from "node:path";

import { JsonFile } from "../storage/json-file.js";
import { HARD_PLAYER_LIMIT } from "./ids.js";
import type { GameSession, Phase } from "./types.js";

/**
 * 열려 있는 판.
 *
 * 저장하는 이유는 하나다 — **모집 패널의 버튼이 재시작을 견뎌야 한다.**
 * 봇을 껐다 켰다고 채널에 남은 「참가」 버튼이 죽으면, 누른 사람은 이유를 알 수 없다.
 *
 * 진행 중이던 판까지 되살리지는 않는다. 게임 안쪽 상태(누가 뭘 냈는지, 몇 번째 차례인지)는
 * 게임마다 달라서 일반적으로 이어 붙일 수 없다. 다시 켜질 때 정리하고 알린다.
 */

interface GuildGames {
  sessions: Record<string, GameSession>;
}

interface GameData {
  guilds: Record<string, GuildGames>;
}

const file = new JsonFile<GameData>(path.resolve(process.cwd(), "data", "games.json"), () => ({
  guilds: {},
}));

function guildOf(data: GameData, guildId: string): GuildGames {
  const guild = (data.guilds[guildId] ??= { sessions: {} });
  guild.sessions ??= {};
  return guild;
}

export function newSessionId(): string {
  return randomBytes(4).toString("hex");
}

export async function getSession(guildId: string, sessionId: string): Promise<GameSession | undefined> {
  return (await file.read()).guilds[guildId]?.sessions[sessionId];
}

/**
 * 그 채널에서 아직 안 끝난 판.
 *
 * 한 채널에 두 판이 돌면 버튼과 안내가 섞여 누가 무엇에 참가했는지 알 수 없게 된다.
 * 채널이 다르면 얼마든지 동시에 돌 수 있다.
 */
export async function activeInChannel(
  guildId: string,
  channelId: string,
): Promise<GameSession | undefined> {
  const sessions = Object.values((await file.read()).guilds[guildId]?.sessions ?? {});
  return sessions.find((session) => session.channelId === channelId && session.phase !== "ended");
}

/** 판을 연다. 그 채널에 이미 판이 있으면 열지 않고 그것을 돌려준다. */
export async function openSession(
  session: GameSession,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly running: GameSession }> {
  return file.update((data) => {
    const guild = guildOf(data, session.guildId);

    const running = Object.values(guild.sessions).find(
      (other) => other.channelId === session.channelId && other.phase !== "ended",
    );
    if (running !== undefined) return { ok: false, running } as const;

    guild.sessions[session.id] = session;
    return { ok: true } as const;
  });
}

export async function attachMessage(
  guildId: string,
  sessionId: string,
  messageId: string,
): Promise<void> {
  await file.update((data) => {
    const session = guildOf(data, guildId).sessions[sessionId];
    if (session !== undefined) session.messageId = messageId;
  });
}

export type JoinResult =
  | { readonly ok: true; readonly session: GameSession }
  | { readonly ok: false; readonly reason: "gone" | "closed" | "already" | "full" };

/**
 * 참가시킨다.
 *
 * 읽고-고치고-쓰기를 한 번의 `update` 안에서 하므로, 버튼을 연타하거나 여러 명이 동시에
 * 눌러도 정원을 넘기지 않는다.
 */
export async function addPlayer(
  guildId: string,
  sessionId: string,
  userId: string,
  maxPlayers: number | null,
): Promise<JoinResult> {
  return file.update((data) => {
    const session = guildOf(data, guildId).sessions[sessionId];

    if (session === undefined) return { ok: false, reason: "gone" } as const;
    if (session.phase === "ended") return { ok: false, reason: "closed" } as const;
    if (session.players.includes(userId)) return { ok: false, reason: "already" } as const;

    const limit = Math.min(maxPlayers ?? HARD_PLAYER_LIMIT, HARD_PLAYER_LIMIT);
    if (session.players.length >= limit) return { ok: false, reason: "full" } as const;

    session.players.push(userId);
    return { ok: true, session: { ...session, players: [...session.players] } } as const;
  });
}

export type LeaveResult =
  | { readonly ok: true; readonly session: GameSession }
  | { readonly ok: false; readonly reason: "gone" | "closed" | "notJoined" };

export async function removePlayer(
  guildId: string,
  sessionId: string,
  userId: string,
): Promise<LeaveResult> {
  return file.update((data) => {
    const session = guildOf(data, guildId).sessions[sessionId];

    if (session === undefined) return { ok: false, reason: "gone" } as const;
    if (session.phase !== "recruiting") return { ok: false, reason: "closed" } as const;

    const index = session.players.indexOf(userId);
    if (index === -1) return { ok: false, reason: "notJoined" } as const;

    session.players.splice(index, 1);
    return { ok: true, session: { ...session, players: [...session.players] } } as const;
  });
}

/**
 * 단계를 바꾼다. **바꾸기 전 단계가 `from` 일 때만** 바뀐다.
 *
 * 마감 타이머와 「시작」 버튼이 거의 같은 순간에 들어올 수 있다. 먼저 바꾼 쪽만
 * 이기게 해서 판이 두 번 시작되는 일을 막는다.
 */
export async function advance(
  guildId: string,
  sessionId: string,
  from: Phase,
  to: Phase,
): Promise<GameSession | undefined> {
  return file.update((data) => {
    const session = guildOf(data, guildId).sessions[sessionId];
    if (session === undefined || session.phase !== from) return undefined;

    session.phase = to;
    if (to !== "recruiting") session.closesAt = null;

    return { ...session, players: [...session.players] };
  });
}

/** 끝난 판을 치운다. 파일에 계속 쌓아 둘 이유가 없다. */
export async function dropSession(guildId: string, sessionId: string): Promise<void> {
  await file.update((data) => {
    const guild = guildOf(data, guildId);
    delete guild.sessions[sessionId];
    if (Object.keys(guild.sessions).length === 0) delete data.guilds[guildId];
  });
}

/** 부팅 때 되살리거나 정리하기 위해 전부 모아 온다. */
export async function allSessions(): Promise<GameSession[]> {
  const { guilds } = await file.read();
  return Object.values(guilds).flatMap((guild) => Object.values(guild.sessions ?? {}));
}
