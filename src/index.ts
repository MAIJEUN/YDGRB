import type { Client } from "discord.js";

import { PRIVILEGED_INTENTS, createClient } from "./client.js";
import { loadConfig } from "./config.js";
import { loadGames } from "./games/registry.js";
import { cancelAllCloses } from "./games/scheduler.js";
// 부팅 시각을 정확히 잡으려면 로그인보다 먼저 불러야 한다.
import "./debug/runtime.js";
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
  logger.info(`미니게임 ${await loadGames()}개 로드`);

  installProcessHandlers(client);

  try {
    await client.login(config.token);
  } catch (error) {
    throw explainLoginFailure(error);
  }
}

/**
 * 로그인 실패를 사람이 고칠 수 있는 말로 바꾼다.
 *
 * 특권 인텐트를 안 켰을 때 디스코드가 주는 것은 `Used disallowed intents` 한 줄뿐이라,
 * **무엇을** 켜야 하는지가 안 나온다. 그게 이 봇에서 가장 흔한 첫 실패라서 여기서 붙여 준다.
 */
function explainLoginFailure(error: unknown): Error {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);

  if (/disallowed intents/iu.test(text)) {
    return new Error(
      [
        "특권 인텐트가 꺼져 있어 로그인하지 못했습니다.",
        "https://discord.com/developers/applications > 이 봇 > Bot > Privileged Gateway Intents 에서",
        ...PRIVILEGED_INTENTS.map((name) => `  - ${name} 켜기`),
        "켠 뒤 다시 실행해 주세요.",
      ].join("\n"),
    );
  }

  if (/token/iu.test(text) && /invalid/iu.test(text)) {
    return new Error(".env 의 DISCORD_TOKEN 이 올바르지 않습니다. 토큰을 다시 발급해 주세요.");
  }

  return error instanceof Error ? error : new Error(text);
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

      // 타이머가 남아 있으면 프로세스가 안 끝난다 — 타살버 반복과 게임 모집 마감.
      stopAllLoops();
      cancelAllCloses();

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
