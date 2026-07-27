import { Events } from "discord.js";

import { reactRandomly } from "../tasalbeo/reactions.js";
import { activeTargets } from "../tasalbeo/store.js";
import { defineEvent } from "../types.js";

/**
 * 타살버가 걸린 사람의 메시지에 반응을 단다.
 *
 * 메시지 **내용**은 읽지 않는다 — 그건 특권 인텐트(MessageContent)가 필요하지만,
 * 누가 보냈는지 알고 반응을 다는 데는 `GuildMessages` 만 있으면 된다.
 */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    if (message.guildId === null) return;
    if (message.author.bot) return;

    const targets = await activeTargets(message.guildId);
    if (!targets.has(message.author.id)) return;

    await reactRandomly(message);
  },
});
