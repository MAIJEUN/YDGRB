import { Client, Collection, GatewayIntentBits } from "discord.js";

/**
 * 인텐트는 "봇이 받을 이벤트 종류"다. 필요한 것만 켜야 한다.
 *
 * - Guilds: 서버/채널 정보와 슬래시 커맨드 처리에 필수.
 * - GuildMembers, GuildPresences, MessageContent 는 **특권 인텐트**라서
 *   Developer Portal > Bot > Privileged Gateway Intents 에서 먼저 켜야 하고,
 *   켜지 않은 채로 요청하면 로그인 시 `Used disallowed intents` 오류가 난다.
 *   필요해지면 아래 배열에 추가하세요.
 */
const INTENTS = [GatewayIntentBits.Guilds];

export function createClient(): Client {
  const client = new Client({ intents: INTENTS });

  client.commands = new Collection();
  client.contextMenuCommands = new Collection();
  client.components = new Collection();

  return client;
}
