// 미니게임 골격 검증 — 두 모드 · 모집 · 정원 · 마감 · 재시작 · 화면.
//
// 게임 자체는 아직 없다. 가짜 게임 셋(모집 · 무제한 모집 · 즉시 시작)을 끼워 넣고
// 골격이 어떻게 구는지 본다. 실제 게임이 붙으면 이 골격을 그대로 타게 된다.
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish } from "./_harness.mjs";

const { readFileSync } = await import("node:fs");
const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

// 저장소는 import 시점의 cwd 로 data/ 를 잡는다.
const sandbox = mkdtempSync(path.join(tmpdir(), "game-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const registry = await import(`${DIST}/games/registry.js`);
const runner = await import(`${DIST}/games/runner.js`);
const scheduler = await import(`${DIST}/games/scheduler.js`);
const store = await import(`${DIST}/games/store.js`);
const views = await import(`${DIST}/games/views.js`);
const { maxPlayersOf, minPlayersOf } = await import(`${DIST}/games/types.js`);
const { buildContainer } = await import(`${DIST}/ui/response.js`);

const G = "111111111111111111";
const CH = "222222222222222222";
const CH2 = "777777777777777777";
const HOST = "333333333333333333";
const P2 = "444444444444444444";
const P3 = "555555555555555555";
const P4 = "666666666666666666";

const host = { id: HOST, username: "주최자" };

// ── 가짜 게임 셋 ───────────────────────────────────────────
const played = [];

registry.registerGame({
  id: "duo",
  name: "둘이서",
  description: "두 명이서 하는 판.",
  mode: "recruit",
  minPlayers: 2,
  maxPlayers: 3,
  recruitSeconds: 60,
  start: async (context) => {
    played.push({ id: "duo", players: [...context.session.players] });
    await context.end({ description: "끝났습니다.", fields: [{ name: "이긴 사람", value: `<@${HOST}>` }] });
  },
});

registry.registerGame({
  id: "many",
  name: "다같이",
  description: "몇 명이든 되는 판.",
  mode: "recruit",
  minPlayers: 3,
  maxPlayers: null,
  start: async (context) => {
    played.push({ id: "many", players: [...context.session.players] });
    await context.end();
  },
});

registry.registerGame({
  id: "now",
  name: "바로하기",
  description: "누르면 바로 시작.",
  mode: "instant",
  start: async (context) => {
    await context.join(P2);
    played.push({ id: "now", players: [...context.session.players] });
    await context.end({ description: "바로 끝." });
  },
});

registry.registerGame({
  id: "boom",
  name: "터지는판",
  description: "일부러 터진다.",
  mode: "instant",
  start: () => {
    throw new Error("일부러 낸 오류");
  },
});

// ── 가짜 디스코드 ──────────────────────────────────────────
function makeClient() {
  const messages = new Map();
  const sent = [];
  let nextId = 1000;

  const channel = (id) => ({
    id,
    isTextBased: () => true,
    isDMBased: () => false,
    send: async (payload) => {
      const messageId = String((nextId += 1));
      const message = { id: messageId, payload, edit: async (next) => { message.payload = next; } };
      messages.set(messageId, message);
      sent.push({ channelId: id, payload });
      return message;
    },
    messages: {
      fetch: async (messageId) => {
        const found = messages.get(messageId);
        if (found === undefined) throw new Error("없는 메시지");
        return found;
      },
    },
  });

  return {
    sent,
    messages,
    user: { id: "999999999999999999" },
    users: { fetch: async (id) => (id === HOST ? host : { id, username: "누군가" }) },
    channels: { fetch: async (id) => channel(id) },
    makeChannel: channel,
  };
}

/** 판을 열고 메시지를 붙이는 것까지 — 커맨드가 하는 일을 흉내 낸다. */
async function open(client, gameId, channelId = CH) {
  const game = registry.getGame(gameId);
  const opened = await runner.openGame(game, G, channelId, host);
  if (!opened.ok) return opened;

  const message = await client.makeChannel(channelId).send({ view: opened.view });
  await runner.attach(client, game, opened.session, message, host);

  return { ...opened, message, game };
}

function bodyOf(view) {
  const head = buildContainer(view).toJSON().components[0];
  return head.type === 9 ? head.components[0].content : head.content;
}

// ── 1. 정의 ────────────────────────────────────────────────
console.log("\n=== 1. 게임 정의 ===");
assert("모집 · 즉시 두 가지", new Set(registry.allGames().map((g) => g.mode)).size === 2);
assert("최소 인원 기본은 2", minPlayersOf({ id: "x", name: "x", mode: "recruit" }) === 2);
assert("최대 인원은 안 적으면 제한 없음", maxPlayersOf({ id: "x", name: "x", mode: "recruit" }) === null);
assert("  └ null 도 제한 없음", maxPlayersOf({ maxPlayers: null }) === null);
assert("  └ 적으면 그 수", maxPlayersOf({ maxPlayers: 4 }) === 4);
assert("id 로 찾음", registry.getGame("duo")?.name === "둘이서");
assert("  └ 없는 id 는 undefined", registry.getGame("없음") === undefined);

// ── 2. 모집 ────────────────────────────────────────────────
console.log("\n=== 2. 모집 ===");
{
  const client = makeClient();
  const { session } = await open(client, "duo");

  assert("모집 단계로 열림", session.phase === "recruiting", session.phase);
  assert("  └ 연 사람은 이미 참가", session.players.length === 1 && session.players[0] === HOST);
  assert("  └ 마감 시각이 잡힘", typeof session.closesAt === "number" && session.closesAt > Date.now());
  assert("  └ 마감이 예약됨", scheduler.reservations().some((r) => r.sessionId === session.id));

  const joined = await runner.join(G, session.id, P2);
  assert("참가하면 늘어남", joined.ok && joined.session.players.length === 2, JSON.stringify(joined));
  assert("  └ 아직 정원은 안 참", joined.ok && joined.full === false);

  const again = await runner.join(G, session.id, P2);
  assert("두 번 참가는 막힘", !again.ok && again.reason === "already", JSON.stringify(again));

  const left = await runner.leave(G, session.id, P2);
  assert("나가면 줄어듦", left.ok && left.session.players.length === 1, JSON.stringify(left));

  const leaveAgain = await runner.leave(G, session.id, P2);
  assert("  └ 없는 사람은 막힘", !leaveAgain.ok && leaveAgain.reason === "notJoined");

  await runner.cancel(client, G, session.id, host);
  assert("접으면 판이 사라짐", (await store.getSession(G, session.id)) === undefined);
  assert("  └ 마감 예약도 사라짐", !scheduler.reservations().some((r) => r.sessionId === session.id));
}

// ── 3. 정원 ────────────────────────────────────────────────
console.log("\n=== 3. 정원 ===");
{
  played.length = 0;
  const client = makeClient();
  const { session } = await open(client, "duo"); // 최대 3

  await runner.join(G, session.id, P2);
  const third = await runner.join(G, session.id, P3);
  assert("정원이 차면 알려 줌", third.ok && third.full === true, JSON.stringify(third));

  const fourth = await runner.join(G, session.id, P4);
  assert("  └ 넘치면 막힘", !fourth.ok && fourth.reason === "full", JSON.stringify(fourth));

  // 정원이 찼으면 기다릴 이유가 없다 — 커맨드 쪽에서 바로 시작시킨다.
  await runner.startNow(client, G, session.id, host);
  assert("정원이 차면 시작할 수 있음", played.length === 1, JSON.stringify(played));
  assert("  └ 참가자가 그대로 넘어감", played[0]?.players.length === 3, JSON.stringify(played[0]));
  assert("  └ 끝나면 판이 사라짐", (await store.getSession(G, session.id)) === undefined);
}

console.log("\n=== 4. 최대 인원이 없는 판 ===");
{
  const client = makeClient();
  const { session, game } = await open(client, "many");

  for (const id of [P2, P3, P4]) await runner.join(G, session.id, id);

  const full = await runner.join(G, session.id, "888888888888888888");
  assert("계속 받음", full.ok && full.full === false, JSON.stringify(full));

  const panel = views.recruitView(game, (await store.getSession(G, session.id)), host);
  const text = bodyOf(panel);
  assert("화면에 「최대 없음」 이라고 적음", text.includes("최대 없음"), text);

  await runner.cancel(client, G, session.id, host);
}

// ── 5. 최소 인원 ───────────────────────────────────────────
console.log("\n=== 5. 최소 인원 ===");
{
  played.length = 0;
  const client = makeClient();
  const { session } = await open(client, "many"); // 최소 3, 지금 1명

  const started = await runner.startNow(client, G, session.id, host);
  assert("모자라면 시작 안 됨", started === false);
  assert("  └ 판은 그대로 모집 중", (await store.getSession(G, session.id))?.phase === "recruiting");
  assert("  └ 게임도 안 돌았음", played.length === 0);

  // 마감이 왔는데도 모자라면 접힌다.
  await runner.closeRecruiting(client, G, session.id, host);
  assert("마감에 모자라면 접힘", (await store.getSession(G, session.id)) === undefined);
  assert("  └ 게임은 안 돌았음", played.length === 0);

  const last = client.sent.at(-1) ?? { payload: {} };
  const closed = client.messages.get(String(session.messageId ?? ""));
  const shown = JSON.stringify(closed?.payload ?? last.payload);
  assert("  └ 접혔다고 알림", shown.includes("접힘"), shown.slice(0, 200));
  assert("  └ 인원이 모자랐다고 말함", shown.includes("인원이 모자랍니다"), shown.slice(0, 200));
}

// ── 6. 즉시 시작 ───────────────────────────────────────────
console.log("\n=== 6. 즉시 시작 ===");
{
  played.length = 0;
  const client = makeClient();
  const { session } = await open(client, "now");

  assert("모집 없이 바로 진행", played.length === 1, JSON.stringify(played));
  assert("  └ 연 사람이 참가자에 들어 있음", played[0]?.players.includes(HOST));
  assert("  └ 게임이 부른 사람도 들어옴", played[0]?.players.includes(P2), JSON.stringify(played[0]));
  assert("  └ 마감 예약이 없음", !scheduler.reservations().some((r) => r.sessionId === session.id));
  assert("  └ 끝나면 판이 사라짐", (await store.getSession(G, session.id)) === undefined);

  const result = client.sent.at(-1);
  assert("결과를 새 메시지로 남김", JSON.stringify(result.payload).includes("바로 끝"), JSON.stringify(result.payload).slice(0, 200));
}

console.log("\n=== 7. 게임이 터졌을 때 ===");
{
  const client = makeClient();
  const { session } = await open(client, "boom");

  assert("판을 정리함", (await store.getSession(G, session.id)) === undefined);
  const shown = JSON.stringify(client.sent.at(-1).payload);
  assert("  └ 실패로 끝냄", shown.includes("끝까지 돌지 못했습니다"), shown.slice(0, 200));
}

// ── 8. 한 채널에 한 판 ─────────────────────────────────────
console.log("\n=== 8. 한 채널에 한 판 ===");
{
  const client = makeClient();
  const first = await open(client, "duo");

  const second = await runner.openGame(registry.getGame("many"), G, CH, host);
  assert("같은 채널에는 못 엶", !second.ok, JSON.stringify(second));
  assert("  └ 돌고 있는 판을 알려 줌", second.running?.id === first.session.id);

  const other = await open(client, "many", CH2);
  assert("다른 채널은 됨", other.ok !== false && other.session.channelId === CH2);

  await runner.cancel(client, G, first.session.id, host);
  await runner.cancel(client, G, other.session.id, host);
}

// ── 9. 재시작 ──────────────────────────────────────────────
console.log("\n=== 9. 재시작 ===");
{
  const client = makeClient();

  // 모집 중인 판 하나, 진행 중인 판 하나를 손으로 남겨 둔다.
  const recruiting = {
    id: "aaaa1111", gameId: "duo", guildId: G, channelId: CH, messageId: null,
    hostId: HOST, players: [HOST], phase: "recruiting",
    openedAt: Date.now(), closesAt: Date.now() + 60_000,
  };
  const playing = {
    id: "bbbb2222", gameId: "many", guildId: G, channelId: CH2, messageId: null,
    hostId: HOST, players: [HOST, P2, P3], phase: "playing",
    openedAt: Date.now(), closesAt: null,
  };

  await store.openSession(recruiting);
  await store.openSession(playing);

  const result = await runner.restoreGames(client);

  assert("모집 중이던 판은 살림", result.restored === 1, JSON.stringify(result));
  assert("  └ 마감을 다시 예약", scheduler.reservations().some((r) => r.sessionId === recruiting.id));
  assert("  └ 버튼이 살아 있음", (await store.getSession(G, recruiting.id)) !== undefined);

  assert("진행 중이던 판은 접음", result.aborted === 1, JSON.stringify(result));
  assert("  └ 판이 사라짐", (await store.getSession(G, playing.id)) === undefined);
  const shown = JSON.stringify(client.sent.map((s) => s.payload));
  assert("  └ 중단됐다고 알림", shown.includes("다시 켜지면서 중단"), shown.slice(0, 300));

  await runner.cancel(client, G, recruiting.id, host);
}
{
  // 꺼져 있는 동안 마감이 지난 판.
  const client = makeClient();
  await store.openSession({
    id: "cccc3333", gameId: "duo", guildId: G, channelId: CH, messageId: null,
    hostId: HOST, players: [HOST], phase: "recruiting",
    openedAt: Date.now() - 10_000, closesAt: Date.now() - 1000,
  });

  await runner.restoreGames(client);
  assert("마감이 이미 지났으면 바로 판정", (await store.getSession(G, "cccc3333")) === undefined);
}

// ── 10. 화면 ───────────────────────────────────────────────
//
// 규칙(response.ts 머리말)을 지키는지 한 화면씩 그려서 본다.
console.log("\n=== 10. 화면 ===");

const ALLOWED = new Set([0x57f287, 0xfee75c, 0xed4245, 0x5865f2]);
const TIMESTAMP = /<t:\d+:[tTdDfFR]>/gu;

function checkView(label, view, expected) {
  const json = buildContainer(view).toJSON();
  const list = json.components;
  const head = list[0];
  const text = head.type === 9 ? head.components[0].content : head.content;

  const problems = [];

  if (!ALLOWED.has(json.accent_color)) problems.push(`색 ${json.accent_color}`);
  if (expected !== undefined && json.accent_color !== expected) problems.push(`색이 기대와 다름 ${json.accent_color}`);
  if (!text.startsWith("### ")) problems.push("제목이 ### 로 시작하지 않음");
  if (list.at(-1).type !== 10) problems.push("맨 아래가 footer 가 아님");
  else if (!list.at(-1).content.startsWith("-# @")) problems.push(`footer ${list.at(-1).content}`);
  if (list.at(-2)?.type !== 14) problems.push("footer 앞에 가로줄이 없음");

  const bare = text.replaceAll(TIMESTAMP, "");
  if (/\d{4}년|\d{4}-\d{2}-\d{2}|\d{1,2}월 \d{1,2}일/u.test(bare)) problems.push("날짜를 글자로 적음");

  const withoutMentions = text.replace(/<@[&!]?\d+>/gu, "").replace(/<#\d+>/gu, "");
  if (/@[가-힣A-Za-z0-9_]+/u.test(withoutMentions)) problems.push("이름을 글자로 적음");

  assert(label, problems.length === 0, problems.join(" / "));
}

const duo = registry.getGame("duo");
const sample = {
  id: "dddd4444", gameId: "duo", guildId: G, channelId: CH, messageId: "1",
  hostId: HOST, players: [HOST, P2], phase: "recruiting",
  openedAt: Date.now(), closesAt: Date.now() + 60_000,
};

checkView("모집 중 → 노랑", views.recruitView(duo, sample, host), 0xfee75c);
checkView("시작 → 노랑", views.startedView(duo, sample, host), 0xfee75c);
checkView("끝 → 초록", views.endedView(duo, sample, host, { description: "끝" }), 0x57f287);
checkView("접힘 → 노랑", views.cancelledView(duo, sample, host, "접었습니다."), 0xfee75c);
checkView("열지 못함 → 빨강", views.refusedView("실패", "안 됩니다.", host), 0xed4245);
checkView("목록 → 파랑", views.listView(registry.allGames(), host), 0x5865f2);
checkView("게임이 없을 때", views.listView([], host), 0x5865f2);

const panelText = bodyOf(views.recruitView(duo, sample, host));
assert("참가자를 멘션으로 적음", panelText.includes(`<@${HOST}>`) && panelText.includes(`<@${P2}>`), panelText);
assert("  └ 마감을 타임스탬프로", TIMESTAMP.test(panelText), panelText);
assert("  └ 인원을 적음", panelText.includes("**2명**"), panelText);

// 사람이 많으면 잘라서 적어야 한다 — 멘션을 다 적으면 글자 수 한계에 걸린다.
const crowd = { ...sample, players: Array.from({ length: 40 }, (_, i) => String(100000000000000000 + i)) };
const crowdText = bodyOf(views.recruitView(registry.getGame("many"), crowd, host));
assert("사람이 많으면 잘라서 적음", crowdText.includes("외 25명"), crowdText.slice(0, 200));
checkView("  └ 그래도 규칙을 지킴", views.recruitView(registry.getGame("many"), crowd, host));

const buttons = views.recruitView(duo, sample, host).rows[0].toJSON().components;
assert("버튼 넷", buttons.length === 4, String(buttons.length));
assert(
  "  └ customId 가 판을 가리킴",
  buttons.every((button) => button.custom_id.endsWith(`:${sample.id}`)),
  JSON.stringify(buttons.map((b) => b.custom_id)),
);

// ── 11. 소스 ───────────────────────────────────────────────
console.log("\n=== 11. 소스 ===");
const runnerSource = read("src/games/runner.ts");
const storeSource = read("src/games/store.ts");

assert(
  "정원 검사와 참가를 한 번에 처리",
  /file\.update\(\(data\) => \{[\s\S]{0,600}players\.push/u.test(storeSource),
  "따로 하면 버튼 연타로 정원을 넘길 수 있다",
);
assert(
  "단계는 이전 단계를 확인하고 바꿈",
  storeSource.includes("session.phase !== from"),
  "마감 타이머와 시작 버튼이 겹치면 판이 두 번 시작된다",
);
assert("게임이 터져도 잡아서 끝냄", runnerSource.includes("게임 ${game.id} 진행 중 오류"));
assert("판을 두 번 끝내지 않음", runnerSource.includes("finished.has(session.id)"));
assert("진행 중이던 판은 되살리지 않음", runnerSource.includes("봇이 다시 켜지면서 중단되었습니다"));

assert("색을 직접 정하지 않음", !read("src/games/views.ts").includes("setAccentColor"));
assert("게임은 화면을 직접 만들지 않음", !read("src/games/types.ts").includes("MessageOptions"));

const readySource = read("src/events/client-ready.ts");
assert("부팅 때 되살림", readySource.includes("restoreGames"));
assert("종료 때 타이머를 정리함", read("src/index.ts").includes("cancelAllCloses"));

process.chdir(PROJECT);
finish();
