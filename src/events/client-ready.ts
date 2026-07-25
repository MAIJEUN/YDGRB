import { ActivityType, Events } from "discord.js";

import { logger } from "../logger.js";
import { defineEvent } from "../types.js";

export default defineEvent({
  name: Events.ClientReady,
  once: true,
  execute(client) {
    logger.info(`로그인 완료 — ${client.user.tag} (서버 ${client.guilds.cache.size}개)`);

    client.user.setActivity({ name: "/소원권 패널", type: ActivityType.Listening });
  },
});
