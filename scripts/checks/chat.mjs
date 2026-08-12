// /채팅뻥 검증 — 채널 덮어쓰기 토글.
//
// 실제로 겪은 두 가지 회귀를 여기서 막는다.
//   1) 한 번 막으면 다시 안 켜졌다 — has() 의 두 번째 인자를 빼면 관리자 권한이
//      모든 검사를 통과시켜 버린다.
//   2) 명령을 친 채널이 아니라 서버 전체가 바뀌었다.
import { DIST, PROJECT, assert, finish, speak } from "./_harness.mjs";

const { readFileSync } = await import("node:fs");
const requireFromProject = (await import("node:module")).createRequire(`${PROJECT}/package.json`);
const { PermissionFlagsBits, PermissionsBitField } = requireFromProject("discord.js");

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const G = "111111111111111111";
const CH = "222222222222222222";
const PARENT = "333333333333333333";
const ROLE = "444444444444444444";
const ACTOR = "555555555555555555";

console.log("\n=== 1. 커맨드 등록 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const command = (await collectCommands()).find((c) => c.data.name === "채팅뻥");

assert("/채팅뻥 등록됨", command !== undefined);

const json = command.data.toJSON();
assert("  └ 이 채널 이야기라고 적혀 있음", json.description.includes("채널"), json.description);
assert(
  "  └ 역할 관리 권한이 있어야 보임",
  json.default_member_permissions === String(PermissionFlagsBits.ManageRoles),
  String(json.default_member_permissions),
);
assert("  └ 서버 전용", JSON.stringify(json.contexts) === "[0]", JSON.stringify(json.contexts));

const option = json.options?.[0];
assert("역할 옵션이 있음", option?.name === "역할", JSON.stringify(json.options));
assert("  └ 비워도 됨 (@everyone)", option?.required !== true);
assert("  └ 설명이 그렇게 말함", option?.description.includes("everyone"), option?.description);

// ── 가짜 서버 ──────────────────────────────────────────────
function makeChannel(id, { thread = false, parent = null, denied = false } = {}) {
  const overwrites = new Map();
  if (denied) {
    overwrites.set(ROLE, { deny: new PermissionsBitField(PermissionFlagsBits.SendMessages) });
  }

  const edits = [];

  return {
    id,
    edits,
    guild: null, // 아래에서 채운다
    isThread: () => thread,
    parent,
    permissionsFor: () => new PermissionsBitField(PermissionFlagsBits.ManageRoles),
    permissionOverwrites: {
      cache: overwrites,
      edit: async (role, permissions, options) => {
        edits.push({ channelId: id, roleId: role.id, permissions, options });
      },
    },
  };
}

function makeRole(id, { administrator = false, position = 1 } = {}) {
  return {
    id,
    position,
    permissions: new PermissionsBitField(
      administrator ? PermissionFlagsBits.Administrator : PermissionFlagsBits.SendMessages,
    ),
    toString: () => (id === G ? "@everyone" : `<@&${id}>`),
  };
}

function makeInteraction({ channel, role, actorTop = 5, ownerId = "999999999999999999" }) {
  const sent = [];

  const guild = {
    id: G,
    ownerId,
    roles: {
      everyone: makeRole(G),
      fetch: async (id) => (id === role.id ? role : null),
    },
    members: { me: { id: "777777777777777777" } },
  };

  channel.guild = guild;
  if (channel.parent !== null) channel.parent.guild = guild;

  return {
    sent,
    user: { id: ACTOR, username: "마이즌", tag: "마이즌#0" },
    guild,
    channel,
    member: {
      id: ACTOR,
      roles: { highest: { comparePositionTo: (other) => actorTop - other.position } },
    },
    options: { getRole: () => (role.id === G ? null : role) },
    inCachedGuild: () => true,
    reply: async (payload) => sent.push({ kind: "reply", payload }),
    deferReply: async () => sent.push({ kind: "defer" }),
    editReply: async (payload) => sent.push({ kind: "edit", payload }),
  };
}

/** 컨테이너 본문 글자 (제목 · 내용 · 변동이 한 덩어리로 들어 있다). */
function bodyOf(payload) {
  const head = payload.components[0].toJSON().components[0];
  return head.type === 9 ? head.components[0].content : head.content;
}

console.log("\n=== 2. 막기 ===");
{
  const channel = makeChannel(CH);
  const role = makeRole(ROLE);
  const interaction = makeInteraction({ channel, role });

  await command.execute(interaction);

  assert("한 채널만 손댐", channel.edits.length === 1, JSON.stringify(channel.edits));
  assert("  └ 명령을 친 채널", channel.edits[0]?.channelId === CH, channel.edits[0]?.channelId);
  assert("  └ 그 역할만", channel.edits[0]?.roleId === ROLE);
  assert(
    "  └ 메시지 보내기를 거부로",
    channel.edits[0]?.permissions.SendMessages === false,
    JSON.stringify(channel.edits[0]?.permissions),
  );
  assert("  └ 감사 로그에 이유를 남김", String(channel.edits[0]?.options.reason).includes("채팅뻥"));

  const result = interaction.sent.at(-1);
  const body = bodyOf(result.payload);
  assert("응답이 초록", result.payload.components[0].toJSON().accent_color === 0x57f287);
  assert("  └ 껐다고 알림", body.includes(speak("껐습니다")), body);
  assert("  └ 역할을 멘션으로", body.includes(`<@&${ROLE}>`), body);
  assert("  └ 채널도 멘션으로", body.includes(`<#${CH}>`), body);
  assert("  └ 변동을 적음", body.includes("허용 → **차단**"), body);
}

console.log("\n=== 3. 다시 켜기 ===");
//
// 여기가 한 번 깨졌던 자리다. has(flag) 는 관리자 권한을 가진 사람에게 늘 true 를
// 돌려주므로, 이미 막혀 있는지 판단할 때는 checkAdmin 을 꺼야 한다.
{
  const channel = makeChannel(CH, { denied: true });
  const role = makeRole(ROLE);
  const interaction = makeInteraction({ channel, role });

  await command.execute(interaction);

  assert(
    "막혀 있으면 되돌림 (null = 상속)",
    channel.edits[0]?.permissions.SendMessages === null,
    JSON.stringify(channel.edits[0]?.permissions),
  );

  const body = bodyOf(interaction.sent.at(-1).payload);
  assert("  └ 켰다고 알림", body.includes(speak("켰습니다")), body);
  assert("  └ 변동을 적음", body.includes("차단 → **허용**"), body);
}

console.log("\n=== 4. 스레드는 부모로 ===");
{
  const parent = makeChannel(PARENT);
  const thread = makeChannel(CH, { thread: true, parent });
  const role = makeRole(ROLE);
  const interaction = makeInteraction({ channel: thread, role });

  await command.execute(interaction);

  assert("스레드 자체는 안 건드림", thread.edits.length === 0, JSON.stringify(thread.edits));
  assert("  └ 부모 채널을 바꿈", parent.edits[0]?.channelId === PARENT, JSON.stringify(parent.edits));
}

console.log("\n=== 5. 못 바꾸는 경우 ===");
{
  const channel = makeChannel(CH);
  const role = makeRole(ROLE, { administrator: true });
  const interaction = makeInteraction({ channel, role });

  await command.execute(interaction);

  const body = bodyOf(interaction.sent.at(-1).payload);
  assert("관리자 역할은 거절", channel.edits.length === 0, JSON.stringify(channel.edits));
  assert("  └ 빨강", interaction.sent.at(-1).payload.components[0].toJSON().accent_color === 0xed4245);
  assert("  └ 이유를 말함", body.includes("관리자"), body);
}
{
  const channel = makeChannel(CH);
  const role = makeRole(ROLE, { position: 9 });
  const interaction = makeInteraction({ channel, role, actorTop: 2 });

  await command.execute(interaction);

  const body = bodyOf(interaction.sent.at(-1).payload);
  assert("자기보다 높은 역할은 거절", channel.edits.length === 0);
  assert("  └ 이유를 말함", body.includes("높거나 같은"), body);
}
{
  // 서버 소유자는 서열과 무관하다.
  const channel = makeChannel(CH);
  const role = makeRole(ROLE, { position: 9 });
  const interaction = makeInteraction({ channel, role, actorTop: 2, ownerId: ACTOR });

  await command.execute(interaction);
  assert("서버 소유자는 서열을 넘음", channel.edits.length === 1, JSON.stringify(channel.edits));
}

console.log("\n=== 6. 소스 ===");
const source = read("src/commands/chat-toggle.ts");

assert(
  "역할 권한이 아니라 채널 덮어쓰기를 씀",
  source.includes("permissionOverwrites.edit") && !source.includes("role.setPermissions"),
  "서버 권한은 역할끼리 더해져서 끄는 것만으로는 안 막힌다",
);
assert(
  "  └ 이미 막혔는지 볼 때 관리자를 빼고 봄",
  /has\(PermissionFlagsBits\.Administrator, false\)/u.test(source),
  "checkAdmin 을 켜 두면 관리자에게 늘 true 라 다시 켜지지 않는다",
);
assert("역할을 멘션으로 가리킴", source.includes("role.toString()"));
assert("  └ 이름을 글자로 적지 않음", !source.includes("role.name"));

finish();
