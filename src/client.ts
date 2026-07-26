import { Client, Collection, GatewayIntentBits } from "discord.js";

/**
 * 인텐트는 "봇이 받을 이벤트 종류"다. 필요한 것만 켜야 한다.
 *
 * - Guilds: 서버/채널 정보와 슬래시 커맨드 처리에 필수.
 * - GuildMembers: **특권 인텐트.** `/별명` 이 서버 전원의 목록을 받아오는 데 필요하다.
 *   Developer Portal > Bot > Privileged Gateway Intents 에서 **Server Members Intent** 를
 *   켜지 않으면 로그인 자체가 `Used disallowed intents` 로 실패한다.
 *
 * GuildPresences 와 MessageContent 도 특권 인텐트다. 필요해지면 같은 방식으로 켜고 추가한다.
 */
const INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers];

export function createClient(): Client {
  const client = new Client({ intents: INTENTS });

  client.commands = new Collection();
  client.contextMenuCommands = new Collection();
  client.components = new Collection();

  return client;
}
