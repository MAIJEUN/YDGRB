import { PermissionFlagsBits, Team } from "discord.js";
import type { Client, PermissionsBitField } from "discord.js";

import { logger } from "../logger.js";
import { isAllowed } from "./store.js";

/**
 * 디버그를 쓸 수 있는 사람은 셋으로 나뉜다.
 *
 *   주인   — 애플리케이션 소유자(팀 소유면 팀원 전원). 전부 쓸 수 있다.
 *   관리자 — 그 서버에서 Administrator 를 가진 사람.
 *   지정   — 관리자가 아닌데 `!y 허용` 으로 따로 지정된 사람.
 *
 * 관리자와 지정된 사람은 **같은 것**을 쓴다 — 지정 자체가 관리자의 판단이므로
 * 그 아래로 또 나눌 이유가 없다. 주인에게만 남겨 둔 것은 두 가지다.
 *
 *   - 재시작 · 종료: 프로세스를 끄는 것이라 **다른 서버까지** 끊긴다.
 *   - 다른 서버 들여다보기: 이 서버의 관리자가 저 서버를 볼 이유는 없다.
 *
 * 실행 폴더 같은 호스트 경로도 주인에게만 보인다 (계정 이름이 섞여 있다).
 */

export type Level = "guest" | "admin" | "owner";

const RANK: Record<Level, number> = { guest: 0, admin: 1, owner: 2 };

export function atLeast(level: Level, minimum: Level): boolean {
  return RANK[level] >= RANK[minimum];
}

export const LEVEL_LABEL: Record<Level, string> = {
  owner: "주인",
  admin: "관리자",
  guest: "지정된 사람",
};

// ─────────────────────────────────────────────────────────────
// 주인
// ─────────────────────────────────────────────────────────────

let cached: ReadonlySet<string> | undefined;

async function fetchOwnerIds(client: Client): Promise<ReadonlySet<string>> {
  const application = client.application;
  if (application === null) return new Set();

  try {
    const { owner } = await application.fetch();

    if (owner === null) return new Set();
    if (owner instanceof Team) return new Set([owner.ownerId, ...owner.members.keys()].filter(isId));

    return new Set([owner.id]);
  } catch (error) {
    logger.warn("디버그: 소유자를 확인하지 못했습니다", error);
    return new Set();
  }
}

function isId(value: string | null): value is string {
  return value !== null;
}

/** 한 번 확인하면 캐시한다. 소유권은 봇이 켜져 있는 동안 바뀔 일이 거의 없다. */
export async function ownerIds(client: Client): Promise<ReadonlySet<string>> {
  if (cached !== undefined) return cached;

  const found = await fetchOwnerIds(client);
  // 못 알아냈을 때는 캐시하지 않는다 — 한 번 실패했다고 영영 잠기면 안 된다.
  if (found.size > 0) cached = found;

  return found;
}

export async function isOwner(client: Client, userId: string): Promise<boolean> {
  return (await ownerIds(client)).has(userId);
}

// ─────────────────────────────────────────────────────────────
// 판정
// ─────────────────────────────────────────────────────────────

/**
 * 이 사람이 어느 등급인지. 셋 다 아니면 null — 디버그를 쓸 수 없다.
 *
 * 권한은 호출부가 넘긴다. 메시지면 `message.member?.permissions`,
 * 버튼이면 `interaction.memberPermissions` 다 — 둘 다 이미 손에 들고 있는 값이라
 * 여기서 멤버를 다시 받아올 이유가 없다.
 */
export async function levelOf(
  client: Client,
  guildId: string,
  userId: string,
  permissions: Readonly<PermissionsBitField> | null,
): Promise<Level | null> {
  if (await isOwner(client, userId)) return "owner";
  if (permissions?.has(PermissionFlagsBits.Administrator) === true) return "admin";
  if (await isAllowed(guildId, userId)) return "guest";

  return null;
}
