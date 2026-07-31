import { ActivityType, Events } from "discord.js";

import { restoreGames } from "../games/runner.js";
import { logger } from "../logger.js";
import { restoreExpirySchedules } from "../nickname/scheduler.js";
import { restoreTasalbeo } from "../tasalbeo/scheduler.js";
import { restoreTimeoutSchedules } from "../timeout/scheduler.js";
import { defineEvent } from "../types.js";

export default defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`로그인 완료 — ${client.user.tag} (서버 ${client.guilds.cache.size}개)`);

    client.user.setActivity({ name: "/소원권 패널", type: ActivityType.Listening });

    // 뚜따이 기간이 걸려 있던 서버의 자동 바사삭 예약을 되살린다.
    const restored = await restoreExpirySchedules(client);
    if (restored > 0) logger.info(`뚜따이 만료 예약 ${restored}건 복구`);

    // 타임아웃 종료 알림 예약도 마찬가지로 되살린다.
    const timeouts = await restoreTimeoutSchedules(client);
    if (timeouts > 0) logger.info(`타임아웃 종료 알림 예약 ${timeouts}건 복구`);

    // 타살버는 예약뿐 아니라 역할 넣었다 빼는 반복까지 되살린다.
    const tasalbeo = await restoreTasalbeo(client);
    if (tasalbeo > 0) logger.info(`타살버 ${tasalbeo}건 복구`);

    // 모집 중이던 판은 되살리고, 진행 중이던 판은 접는다.
    const games = await restoreGames(client);
    if (games.restored > 0) logger.info(`게임 모집 ${games.restored}건 복구`);
    if (games.aborted > 0) logger.info(`진행 중이던 게임 ${games.aborted}건 정리`);
  },
});
