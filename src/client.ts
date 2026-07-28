import { Client, Collection, GatewayIntentBits } from "discord.js";

/**
 * 인텐트는 "봇이 받을 이벤트 종류"다. 필요한 것만 켜야 한다.
 *
 * - Guilds: 서버/채널 정보와 슬래시 커맨드 처리에 필수.
 *
 * - GuildMembers: **특권 인텐트.** `/별명` 이 서버 전원의 목록을 받아오는 데 필요하다.
 *
 * - GuildMessages: `/타살버` 가 걸린 사람의 메시지에 반응을 달기 위해 필요하다.
 *
 * - MessageContent: **특권 인텐트.** `!y` 디버그 명령을 읽는 데 필요하다.
 *   메시지 **내용**을 보는 것이라 특권이다 — 이게 없으면 `message.content` 가
 *   빈 문자열로 오고, 접두사를 알아볼 방법이 없다.
 *
 * 특권 인텐트는 Developer Portal > Bot > Privileged Gateway Intents 에서 켜야 하고,
 * 켜지 않으면 **로그인 자체가** `Used disallowed intents` 로 실패한다
 * (index.ts 가 그 오류를 알아보고 무엇을 켜야 하는지 알려 준다).
 *
 * GuildPresences 도 특권 인텐트다. 필요해지면 같은 방식으로 켜고 추가한다.
 */
const INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];

/** 로그인이 막혔을 때 무엇을 켜야 하는지 알려 주기 위한 목록. */
export const PRIVILEGED_INTENTS: readonly string[] = [
  "Server Members Intent (GuildMembers)",
  "Message Content Intent (MessageContent)",
];

export function createClient(): Client {
  const client = new Client({ intents: INTENTS });

  client.commands = new Collection();
  client.contextMenuCommands = new Collection();
  client.components = new Collection();

  return client;
}
