import { Events } from "discord.js";

import { handleDebugMessage } from "../debug/handle.js";
import { handleGameMessage } from "../games/runner.js";
import { reactRandomly } from "../tasalbeo/reactions.js";
import { activeTargets } from "../tasalbeo/store.js";
import { defineEvent } from "../types.js";

/**
 * 메시지를 받아서 하는 두 가지 —
 *
 *   1. `!y …` 면 디버그 (봇 주인만)
 *   2. 타살버가 걸린 사람의 메시지면 반응을 단다
 *
 * 1번 때문에 메시지 **내용**을 읽어야 하고, 그건 특권 인텐트(MessageContent)를 요구한다.
 * 2번만 있을 때는 필요 없었다 — 누가 보냈는지만 알면 반응은 달 수 있으니까.
 */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    if (!message.inGuild()) return;

    if (await handleDebugMessage(message)) return;

    // 채팅으로 겨루는 게임(퀴즈 같은)이 도는 채널이면 그쪽으로 넘긴다.
    await handleGameMessage(message);

    const targets = await activeTargets(message.guildId);
    if (!targets.has(message.author.id)) return;

    await reactRandomly(message);
  },
});
