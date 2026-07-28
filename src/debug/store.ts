import path from "node:path";

import { JsonFile } from "../storage/json-file.js";

/**
 * 관리자가 아닌데도 디버그를 쓸 수 있게 지정된 사람들.
 *
 * **서버마다 따로** 둔다. 관리자 권한이 서버마다 다른 것과 같은 이유다 —
 * 한 서버에서 도우라고 부른 사람이 다른 서버까지 들여다볼 이유는 없다.
 */

interface GuildDebug {
  allowed: string[];
}

interface DebugData {
  guilds: Record<string, GuildDebug>;
}

const file = new JsonFile<DebugData>(path.resolve(process.cwd(), "data", "debug.json"), () => ({
  guilds: {},
}));

function guildOf(data: DebugData, guildId: string): GuildDebug {
  const guild = (data.guilds[guildId] ??= { allowed: [] });
  guild.allowed ??= [];
  return guild;
}

export async function allowedIds(guildId: string): Promise<readonly string[]> {
  return (await file.read()).guilds[guildId]?.allowed ?? [];
}

export async function isAllowed(guildId: string, userId: string): Promise<boolean> {
  return (await allowedIds(guildId)).includes(userId);
}

/** 이미 있었으면 false — 호출부가 「이미 지정돼 있어요」 라고 말할 수 있게. */
export async function allow(guildId: string, userId: string): Promise<boolean> {
  return file.update((data) => {
    const guild = guildOf(data, guildId);
    if (guild.allowed.includes(userId)) return false;

    guild.allowed.push(userId);
    return true;
  });
}

/** 없었으면 false. */
export async function disallow(guildId: string, userId: string): Promise<boolean> {
  return file.update((data) => {
    const guild = guildOf(data, guildId);
    const index = guild.allowed.indexOf(userId);
    if (index === -1) return false;

    guild.allowed.splice(index, 1);
    return true;
  });
}
