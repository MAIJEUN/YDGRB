/**
 * 슬래시 커맨드를 디스코드에 등록한다. `npm run deploy`
 *
 * 커맨드를 새로 만들거나 이름·설명·옵션을 바꿨을 때만 실행하면 된다.
 * (커맨드 내부 로직만 고쳤을 때는 봇만 재시작하면 됨)
 *
 * .env 의 DISCORD_GUILD_ID 가 있으면 그 서버에만 등록되어 즉시 반영되고,
 * 비어 있으면 글로벌 등록이라 반영까지 시간이 걸릴 수 있다.
 */
import { REST, Routes } from "discord.js";

import { loadConfig } from "./config.js";
import { collectCommands } from "./loaders/commands.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const commands = await collectCommands();

  if (commands.length === 0) {
    logger.warn("등록할 커맨드가 없습니다. src/commands 를 확인하세요.");
    return;
  }

  const body = commands.map((command) => command.data.toJSON());
  const rest = new REST().setToken(config.token);

  const route =
    config.guildId === undefined
      ? Routes.applicationCommands(config.clientId)
      : Routes.applicationGuildCommands(config.clientId, config.guildId);

  const result = (await rest.put(route, { body })) as unknown[];
  const target = config.guildId === undefined ? "글로벌" : `길드 ${config.guildId}`;

  logger.info(`커맨드 ${result.length}개 등록 완료 (${target})`);
  for (const command of commands) {
    logger.info(
      command.kind === "chatInput"
        ? `  /${command.data.name} — ${command.data.description}`
        : `  [컨텍스트 메뉴] ${command.data.name}`,
    );
  }
}

try {
  await main();
} catch (error) {
  logger.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
