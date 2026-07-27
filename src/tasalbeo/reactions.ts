import type { Client, GuildEmoji, Message } from "discord.js";

import { logger } from "../logger.js";
import { EMOJI_NAMES } from "./ids.js";

/**
 * 타살버가 걸린 사람의 메시지에 굴러가는 이모지를 **무작위 개수만큼** 단다.
 *
 * 이모지는 **이름으로** 찾는다 — 봇이 들어가 있는 서버 전체에서 찾으므로,
 * 이모지가 있는 서버에 봇이 들어가 있기만 하면 다른 서버에서도 쓸 수 있다.
 * (그 채널에 **외부 이모지 사용** 권한이 필요하다)
 */

/** 설정한 이름들 중 실제로 쓸 수 있는 이모지만. */
function available(client: Client): GuildEmoji[] {
  const found: GuildEmoji[] = [];

  for (const name of EMOJI_NAMES) {
    const emoji = client.emojis.cache.find((candidate) => candidate.name === name);
    if (emoji !== undefined) found.push(emoji);
  }

  return found;
}

/** 무작위 순서로 섞는다 (Fisher–Yates). */
function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }

  return copy;
}

/**
 * 반응을 단다. 개수는 1개 ~ 쓸 수 있는 전부 중 무작위.
 *
 * 반응 하나마다 요청이 하나씩 나가므로 순서대로 보낸다.
 * 중간에 실패하면(권한 없음, 메시지 삭제 등) 그 자리에서 멈춘다.
 */
export async function reactRandomly(message: Message): Promise<void> {
  const emojis = available(message.client);

  if (emojis.length === 0) {
    logger.debug(`타살버: 쓸 수 있는 이모지가 없습니다 (${EMOJI_NAMES.join(", ")})`);
    return;
  }

  const count = 1 + Math.floor(Math.random() * emojis.length);

  for (const emoji of shuffled(emojis).slice(0, count)) {
    try {
      await message.react(emoji);
    } catch (error) {
      // 메시지가 지워졌거나 반응 권한이 없다. 남은 것도 어차피 실패한다.
      logger.debug("타살버: 반응 달기 실패", error);
      return;
    }
  }
}
