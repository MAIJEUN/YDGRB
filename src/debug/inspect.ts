import { SnowflakeUtil } from "discord.js";
import type { Client, Guild, TextBasedChannel } from "discord.js";

/**
 * 사람이 친 토큰을 id 로 바꾸고, id 가 무엇인지 되짚는다.
 *
 * 디버그에서는 `@유저` 를 붙여 부를 수도 있고 id 를 그냥 붙여 넣을 수도 있어야 한다.
 * 둘 다 받는다.
 */

/** `<@123>` · `<@!123>` · `<@&123>` · `<#123>` 그리고 맨 숫자. */
const MENTION = /^<[@#][!&]?(\d{17,20})>$/u;
const RAW = /^\d{17,20}$/u;

export function parseId(token: string | undefined): string | null {
  if (token === undefined) return null;

  const trimmed = token.trim();
  if (RAW.test(trimmed)) return trimmed;

  return MENTION.exec(trimmed)?.[1] ?? null;
}

/** 스노플레이크에 박혀 있는 생성 시각. 디스코드가 id 안에 넣어 둔다. */
export function createdAt(id: string): Date {
  return new Date(Number(SnowflakeUtil.timestampFrom(id)));
}

export type Resolved =
  | { readonly kind: "서버"; readonly label: string }
  | { readonly kind: "채널"; readonly label: string }
  | { readonly kind: "역할"; readonly label: string }
  | { readonly kind: "유저"; readonly label: string }
  | { readonly kind: "이모지"; readonly label: string }
  | { readonly kind: "메시지"; readonly label: string }
  | null;

/**
 * id 하나로 무엇이든 찾아본다 — 서버·채널·역할·이모지·메시지·유저 순서로.
 *
 * 스노플레이크는 종류를 구분하지 않아서 값만 봐서는 알 수 없다. 그래서 차례로 물어본다.
 * 캐시를 먼저 보고, 캐시에 없는 것만 REST 로 한 번씩 시도한다.
 */
export async function resolveId(
  client: Client,
  guild: Guild,
  here: TextBasedChannel | null,
  id: string,
): Promise<Resolved> {
  const found = client.guilds.cache.get(id);
  if (found !== undefined) return { kind: "서버", label: `\`${found.name}\`` };

  if (client.channels.cache.has(id)) return { kind: "채널", label: `<#${id}>` };

  const role = guild.roles.cache.get(id);
  if (role !== undefined) return { kind: "역할", label: role.toString() };

  const emoji = client.emojis.cache.get(id);
  if (emoji !== undefined) return { kind: "이모지", label: emoji.toString() };

  // 메시지는 어느 채널에 있는지 모르면 못 찾는다. 명령을 친 채널만 확인해 본다.
  if (here !== null) {
    const message = await here.messages.fetch(id).catch(() => null);
    if (message !== null) return { kind: "메시지", label: `[바로가기](${message.url})` };
  }

  const user = await client.users.fetch(id).catch(() => null);
  if (user !== null) return { kind: "유저", label: `<@${id}>` };

  return null;
}
