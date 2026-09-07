import path from "node:path";

import { JsonFile } from "../storage/json-file.js";
import { MAX_ALLOWED_ROLES } from "./ids.js";

/**
 * 누가 어떤 역할을 스스로 켜고 끌 수 있는지.
 *
 * **권한이 아니라 명단이다.** 디스코드 권한을 주면 그 사람은 아무 역할이나 만지게 되므로,
 * 관리자가 사람마다 「이 역할들만」 을 적어 두고 봇이 그 명단 안에서만 대신 붙였다 뗀다.
 *
 * 서버 → 유저 → 역할 id 목록. 아무것도 열어 주지 않은 사람은 아예 없는 칸이다.
 */

export interface RoleGuild {
  /** 유저 id → 그 사람이 켜고 끌 수 있는 역할 id 목록. */
  allowed: Record<string, string[]>;
}

export interface RoleData {
  guilds: Record<string, RoleGuild>;
}

const file = new JsonFile<RoleData>(path.resolve(process.cwd(), "data", "roles.json"), () => ({
  guilds: {},
}));

function guildOf(data: RoleData, guildId: string): RoleGuild {
  const existing = data.guilds[guildId];
  if (existing !== undefined) {
    existing.allowed ??= {};
    return existing;
  }

  const created: RoleGuild = { allowed: {} };
  data.guilds[guildId] = created;
  return created;
}

/** 그 사람에게 열어 준 역할. 없으면 빈 배열. */
export async function allowedRoles(guildId: string, userId: string): Promise<string[]> {
  const guild = (await file.read()).guilds[guildId];
  return [...(guild?.allowed[userId] ?? [])];
}

/** 이 서버에서 누군가에게 무언가를 열어 준 사람들. 관리자 패널이 한눈에 보려고 쓴다. */
export async function openedUsers(guildId: string): Promise<string[]> {
  const guild = (await file.read()).guilds[guildId];
  if (guild === undefined) return [];

  return Object.entries(guild.allowed)
    .filter(([, roles]) => roles.length > 0)
    .map(([userId]) => userId);
}

/**
 * 그 사람에게 열어 줄 역할을 **통째로 정한다.**
 *
 * 하나씩 더하고 빼지 않는다 — 드롭다운이 「지금 열려 있는 것」을 미리 고른 채로 뜨므로,
 * 사람이 보고 낸 그 목록이 곧 결과여야 화면과 저장된 것이 어긋나지 않는다.
 *
 * 빈 목록이면 그 사람 칸을 아예 지운다. 빈 배열을 남겨 두면 「열어 준 적 없는 사람」과
 * 「전부 닫은 사람」이 파일에서 구별되지 않는다.
 */
export async function setAllowedRoles(
  guildId: string,
  userId: string,
  roleIds: readonly string[],
): Promise<string[]> {
  // 같은 역할이 두 번 실려 와도 한 번만 센다. 스물다섯을 넘으면 뒤를 자른다.
  const tidy = [...new Set(roleIds)].slice(0, MAX_ALLOWED_ROLES);

  return file.update((data) => {
    const guild = guildOf(data, guildId);

    if (tidy.length === 0) {
      delete guild.allowed[userId];
      return [];
    }

    guild.allowed[userId] = tidy;
    return [...tidy];
  });
}

/**
 * 서버에서 사라진 역할을 명단에서 걷어 낸다.
 *
 * 지워진 역할이 명단에 남아 있으면 유저 패널의 드롭다운에 죽은 항목이 뜬다. 화면을
 * 그릴 때마다 살아 있는 역할만 골라 내되, 실제로 줄어들었으면 파일도 고쳐 둔다.
 */
export async function pruneMissingRoles(
  guildId: string,
  userId: string,
  alive: readonly string[],
): Promise<void> {
  const current = await allowedRoles(guildId, userId);
  if (current.length === alive.length) return;

  await setAllowedRoles(guildId, userId, alive);
}
