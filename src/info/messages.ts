import type { Client } from "discord.js";

import { logger } from "../logger.js";

/**
 * 한 사람이 이 서버에 남긴 메시지 수 — **지금까지 전부.**
 *
 * 봇이 하나하나 세어 둔 것이 아니다. 디스코드의 [서버 메시지 검색]
 * (https://docs.discord.com/developers/resources/message#search-guild-messages)에 「이 사람이 쓴
 * 것」 을 물어 그 **총 개수**(`total_results`)만 받는다. 그래서 봇이 들어오기 전의 메시지도
 * 세어지고, 따로 저장해 둘 것도 없다.
 *
 * 대신 몇 가지가 디스코드 쪽 사정을 따른다.
 *
 *   · **봇이 볼 수 있는 채널만** 센다. 봇에게 「메시지 기록 보기」 가 없는 채널은 빠진다.
 *   · 디스코드가 아직 그 서버를 색인하는 중이면 숫자를 안 준다 (`202` · 코드 110000).
 *     그때는 잠깐 기다려 한 번 더 묻고, 그래도 안 되면 「세는 중」 이라고 말한다.
 *   · 메시지가 막 오가는 중이면 숫자가 조금 어긋날 수 있다 (디스코드가 그렇게 적어 두었다).
 */

export type MessageCount =
  | { readonly ok: true; readonly total: number }
  | { readonly ok: false; readonly reason: "indexing" | "unavailable" };

/** 색인 중이라는 답의 코드. */
const INDEX_NOT_READY = 110_000;

/** 색인 중일 때 한 번 더 묻기 전에 기다리는 최대 시간. 프로필 하나 보자고 오래 붙잡지 않는다. */
const MAX_RETRY_WAIT_MS = 3_000;

interface SearchReply {
  readonly total_results?: number;
  readonly code?: number;
  readonly retry_after?: number;
}

async function search(client: Client, guildId: string, userId: string): Promise<SearchReply> {
  const query = new URLSearchParams({
    author_id: userId,
    // 개수만 필요하다. 메시지 본문은 하나만 받아 오고 버린다 (0은 받지 않는다).
    limit: "1",
    // 연령 제한 채널도 센다 — 숫자만 내보내므로 무엇을 썼는지는 드러나지 않는다.
    include_nsfw: "true",
  });

  return (await client.rest.get(`/guilds/${guildId}/messages/search`, { query })) as SearchReply;
}

export async function countMessages(client: Client, guildId: string, userId: string): Promise<MessageCount> {
  try {
    let reply = await search(client, guildId, userId);

    // 색인 중 — 디스코드가 알려 준 만큼(길어야 몇 초) 기다렸다가 한 번만 더 묻는다.
    if (reply.code === INDEX_NOT_READY) {
      const wait = Math.min((reply.retry_after ?? 1) * 1000, MAX_RETRY_WAIT_MS);
      await new Promise((resolve) => setTimeout(resolve, wait));
      reply = await search(client, guildId, userId);
    }

    if (typeof reply.total_results === "number") return { ok: true, total: reply.total_results };
    if (reply.code === INDEX_NOT_READY) return { ok: false, reason: "indexing" };

    logger.warn(`메시지 수를 알 수 없는 답 (${guildId}/${userId})`, reply);
    return { ok: false, reason: "unavailable" };
  } catch (error) {
    // 권한이 없거나(403) 디스코드가 막았거나. 프로필 전체를 실패시킬 이유는 없다.
    logger.warn(`메시지 수를 세지 못했습니다 (${guildId}/${userId})`, error);
    return { ok: false, reason: "unavailable" };
  }
}
