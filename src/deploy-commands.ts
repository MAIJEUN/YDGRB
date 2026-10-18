/**
 * 슬래시 커맨드를 디스코드에 등록한다.
 *
 *   npm run deploy          등록 — DISCORD_GUILD_ID 가 있으면 그 서버에, 없으면 글로벌로
 *   npm run deploy:now      즉시 등록 — 봇이 들어가 있는 **서버마다** 바로 반영
 *   npm run deploy:reset    초기화 — 글로벌과 서버마다 등록된 것을 **전부 지운다**
 *
 * 커맨드를 새로 만들거나 이름·설명·옵션을 바꿨을 때만 실행하면 된다.
 * (커맨드 내부 로직만 고쳤을 때는 봇만 재시작하면 됨)
 *
 * 무엇을 어떻게 하는지는 [deploy/run.ts](deploy/run.ts) 에 있다. 여기는 설정을 읽고 찍기만 한다.
 */
import { REST } from "discord.js";

import { loadConfig } from "./config.js";
import { deploy, modeOf } from "./deploy/run.js";
import { collectCommands } from "./loaders/commands.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const mode = modeOf(process.argv.slice(2));
  const rest = new REST().setToken(config.token);

  const commands = mode === "reset" ? [] : await collectCommands();
  if (mode !== "reset" && commands.length === 0) {
    logger.warn("등록할 커맨드가 없습니다. src/commands 를 확인하세요.");
    return;
  }

  const log = await deploy(rest, mode, {
    clientId: config.clientId,
    guildId: config.guildId,
    body: commands.map((command) => command.data.toJSON()),
  });

  for (const line of log) logger.info(line);

  // 올렸으면 무엇을 올렸는지 늘어놓는다.
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
