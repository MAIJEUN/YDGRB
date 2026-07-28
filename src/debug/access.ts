import { Team } from "discord.js";
import type { Client } from "discord.js";

import { logger } from "../logger.js";

/**
 * 디버그를 쓸 수 있는 사람 — **애플리케이션 소유자만.**
 *
 * 서버 관리자에게 열지 않는다. 여기서 나오는 것은 메모리·경로·최근 로그·예약처럼
 * 그 서버와 상관없는 봇 자체의 속사정이고, 봇은 여러 서버에 들어가 있을 수 있다.
 * 한 서버의 관리자가 다른 서버의 예약 목록을 보게 둘 이유가 없다.
 *
 * 팀 소유라면 팀원 전원이 쓸 수 있다.
 */

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
