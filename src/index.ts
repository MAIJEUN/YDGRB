import type { Client } from "discord.js";

import { createClient } from "./client.js";
import { loadConfig } from "./config.js";
import { collectCommands } from "./loaders/commands.js";
import { collectComponentHandlers } from "./loaders/components.js";
import { registerEvents } from "./loaders/events.js";
import { logger } from "./logger.js";
import { stopAllLoops } from "./tasalbeo/runner.js";
import { contextMenuKey } from "./types.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = createClient();

  for (const command of await collectCommands()) {
    if (command.kind === "chatInput") {
      client.commands.set(command.data.name, command);
    } else {
      client.contextMenuCommands.set(
        contextMenuKey(command.data.type, command.data.name),
        command,
      );
    }
  }
  logger.info(
    `커맨드 로드 — 슬래시 ${client.commands.size}개, 컨텍스트 메뉴 ${client.contextMenuCommands.size}개`,
  );

  for (const handler of await collectComponentHandlers()) {
    client.components.set(handler.namespace, handler);
  }
  logger.info(`컴포넌트 핸들러 ${client.components.size}개 로드`);

  logger.info(`이벤트 핸들러 ${await registerEvents(client)}개 등록`);

  installProcessHandlers(client);

  await client.login(config.token);
}

function installProcessHandlers(client: Client): void {
  process.on("unhandledRejection", (reason) => {
    logger.error("처리되지 않은 Promise 거부", reason);
  });

  process.on("uncaughtException", (error) => {
    logger.error("처리되지 않은 예외", error);
  });

  // Ctrl+C 로 껐을 때 게이트웨이 연결을 정리하고 나간다.
  let shuttingDown = false;

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;

      logger.info(`${signal} 수신 — 봇을 종료합니다.`);

      // 타살버의 역할 넣었다 빼기 타이머가 남아 있으면 프로세스가 안 끝난다.
      stopAllLoops();

      void Promise.resolve(client.destroy()).finally(() => {
        process.exit(0);
      });
    });
  }
}

try {
  await main();
} catch (error) {
  // 설정 오류는 스택 트레이스 없이 메시지만 보여준다.
  logger.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
