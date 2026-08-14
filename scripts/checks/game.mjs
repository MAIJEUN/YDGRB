// 미니게임 형식 검증 — 두 방식 · 모집 · 정원 · 5분 마감 · 재시작 · 제목 · 화면.
//
// 가짜 게임 넷을 끼워 넣고 골격이 어떻게 구는지 본다. 실제 게임(/퀴즈)은 quiz 검사에서.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish, speak } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

// 저장소는 import 시점의 cwd 로 data/ 를 잡는다.
const sandbox = mkdtempSync(path.join(tmpdir(), "game-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const ids = await import(`${DIST}/games/ids.js`);
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

// ── 가짜 게임들 ────────────────────────────────────────────
const played = [];
const heard = [];

registry.registerGame({
  id: "duo",
  name: "둘이서",
  description: "두 명이서 하는 판.",
  mode: "recruit",
  minPlayers: 2,
  maxPlayers: 3,
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

// 채팅으로 겨루고 기간이 있는 게임 — 퀴즈와 같은 모양.
registry.registerGame({
  id: "chat",
  name: "받아치기",
  description: "채널에 적으면 된다.",
  mode: "instant",
  start: () => {},
  onMessage: async (context, message) => {
    heard.push(message.content);
    if (message.content === "정답") {
      await context.join(message.author.id);
      await context.end({ description: "맞혔습니다." });
    }
  },
  onTimeout: async (context) => {
    await context.end({ status: "progress", description: "아무도 못 맞혔습니다." });
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
    isSendable: () => true,
    send: async (payload) => {
      const messageId = String((nextId += 1));
      const message = {
        id: messageId,
        payload,
        edit: async (next) => { message.payload = next; },
        // 결과는 판을 연 메시지에 **답장**으로 달린다.
        reply: async (next) => {
          const replyId = String((nextId += 1));
          const reply = { id: replyId, payload: next, edit: async () => {}, reply: async () => {} };
          messages.set(replyId, reply);
          sent.push({ channelId: id, payload: next, replyTo: messageId });
          return reply;
        },
      };
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

/** 판을 열고 메시지를 붙이는 것까지 — 게임 커맨드가 하는 일을 흉내 낸다. */
async function open(client, gameId, options = {}) {
  const game = registry.getGame(gameId);
  const channelId = options.channelId ?? CH;
  const opened = await runner.openGame(game, G, channelId, host, options);
  if (!opened.ok) return opened;

  const message = await client.makeChannel(channelId).send({ view: opened.view });
  await runner.attach(client, game, opened.session, message, host);

  return { ...opened, message, game };
}

const bodyOf = (view) => {
  const head = buildContainer(view).toJSON().components[0];
  return head.type === 9 ? head.components[0].content : head.content;
};
const headOf = (view) => bodyOf(view).split("\n")[0];

// ── 1. 형식 ────────────────────────────────────────────────
console.log("\n=== 1. 형식 ===");
assert("방식은 두 가지뿐", new Set(registry.allGames().map((g) => g.mode)).size === 2);
assert("모집 마감은 5분", ids.RECRUIT_TIMEOUT_SECONDS === 5 * 60, String(ids.RECRUIT_TIMEOUT_SECONDS));
assert("  └ 게임이 고를 수 없음", !read("src/games/types.ts").includes("recruitSeconds"));
assert("최소 인원 기본은 2", minPlayersOf({ mode: "recruit" }) === 2);
assert("최대 인원은 안 적으면 제한 없음", maxPlayersOf({ mode: "recruit" }) === null);
assert("  └ null 도 제한 없음", maxPlayersOf({ maxPlayers: null }) === null);
assert("  └ 적으면 그 수", maxPlayersOf({ maxPlayers: 4 }) === 4);
assert("/게임 같은 공통 커맨드는 없음", !read("README.md").includes("/게임 종류"));

// ── 2. 모집 ────────────────────────────────────────────────
console.log("\n=== 2. 모집 ===");
{
  const client = makeClient();
  const { session } = await open(client, "duo");

  assert("모집 단계로 열림", session.phase === "recruiting", session.phase);
  assert("  └ 연 사람은 이미 참가", session.players.length === 1 && session.players[0] === HOST);
  assert(
    "  └ 마감이 5분 뒤",
    Math.abs(session.closesAt - Date.now() - 5 * 60 * 1000) < 2000,
    String(session.closesAt - Date.now()),
  );
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

// ── 3. 정원이 차면 자동 시작 ───────────────────────────────
console.log("\n=== 3. 정원 ===");
{
  played.length = 0;
  const client = makeClient();
  const { session } = await open(client, "duo"); // 최대 3

  await runner.join(G, session.id, P2);
  const third = await runner.join(G, session.id, P3);
  assert("정원이 차면 알려 줌 (full)", third.ok && third.full === true, JSON.stringify(third));

  const fourth = await runner.join(G, session.id, P4);
  assert("  └ 넘치면 막힘", !fourth.ok && fourth.reason === "full", JSON.stringify(fourth));

  await runner.startNow(client, G, session.id, host);
  assert("정원이 차면 시작", played.length === 1, JSON.stringify(played));
  assert("  └ 참가자가 그대로 넘어감", played[0]?.players.length === 3, JSON.stringify(played[0]));
  assert("  └ 끝나면 판이 사라짐", (await store.getSession(G, session.id)) === undefined);
}

assert(
  "버튼 쪽이 full 이면 바로 시작시킴",
  /result\.full[\s\S]{0,120}startNow/u.test(read("src/components/game.ts")),
);

console.log("\n=== 4. 최대 인원이 없는 판 ===");
{
  const client = makeClient();
  const { session, game } = await open(client, "many");

  for (const id of [P2, P3, P4]) await runner.join(G, session.id, id);

  const more = await runner.join(G, session.id, "888888888888888888");
  assert("계속 받음", more.ok && more.full === false, JSON.stringify(more));

  const text = bodyOf(views.recruitView(game, await store.getSession(G, session.id), host));
  assert("화면에 「최대 없음」 이라고 적음", text.includes("최대 없음"), text);

  await runner.cancel(client, G, session.id, host);
}

// ── 5. 최소 인원 · 5분 마감 ────────────────────────────────
console.log("\n=== 5. 최소 인원과 마감 ===");
{
  played.length = 0;
  const client = makeClient();
  const { session } = await open(client, "many"); // 최소 3, 지금 1명

  const started = await runner.startNow(client, G, session.id, host);
  assert("모자라면 시작 안 됨", started === false);
  assert("  └ 판은 그대로 모집 중", (await store.getSession(G, session.id))?.phase === "recruiting");
  assert("  └ 게임도 안 돌았음", played.length === 0);

  await runner.expireRecruiting(client, G, session.id, host);
  assert("5분이 지나면 취소", (await store.getSession(G, session.id)) === undefined);
  assert("  └ 게임은 안 돌았음", played.length === 0);

  const shown = JSON.stringify(client.messages.get(String(session.messageId ?? ""))?.payload ?? {});
  assert("  └ 취소됐다고 알림", shown.includes("취소"), shown.slice(0, 200));
  assert("  └ 5분이라고 말함", shown.includes("5분"), shown.slice(0, 300));
}
{
  // 인원이 다 찼어도 마감이 오면 취소된다 — 시작하는 것은 사람이 하는 일이다.
  played.length = 0;
  const client = makeClient();
  const { session } = await open(client, "duo"); // 최소 2

  await runner.join(G, session.id, P2);
  await runner.expireRecruiting(client, G, session.id, host);

  assert("인원이 찼어도 마감이면 취소", played.length === 0, JSON.stringify(played));
  assert("  └ 판이 사라짐", (await store.getSession(G, session.id)) === undefined);
}

// ── 6. 즉시 시작 ───────────────────────────────────────────
console.log("\n=== 6. 즉시 시작 ===");
{
  heard.length = 0;
  const client = makeClient();
  const { session } = await open(client, "chat", { durationSeconds: 60, body: "문제입니다" });

  assert("모집 없이 바로 진행", (await store.getSession(G, session.id))?.phase === "playing");
  assert("  └ 기간만큼 시계가 걸림", scheduler.reservations().some((r) => r.sessionId === session.id));

  const view = bodyOf(views.startedView(registry.getGame("chat"), session, host));
  assert("  └ 게임이 준 내용을 보여 줌", view.includes("문제입니다"), view);
  assert("  └ 참가자 칸은 없음 (즉시 시작)", !view.includes("참가한 사람"), view);

  // 채널 메시지가 게임으로 넘어간다.
  const say = async (content, authorId = P2) =>
    runner.handleGameMessage({ content, channelId: CH, guildId: G, author: { id: authorId } });

  await say("아무 말");
  assert("도는 채널의 메시지가 게임으로 감", heard.includes("아무 말"), JSON.stringify(heard));

  await runner.handleGameMessage({ content: "딴 채널", channelId: CH2, guildId: G, author: { id: P2 } });
  assert("  └ 다른 채널은 안 감", !heard.includes("딴 채널"), JSON.stringify(heard));

  await say("정답");
  assert("맞히면 끝남", (await store.getSession(G, session.id)) === undefined);
  assert("  └ 답한 사람이 참가자로", JSON.stringify(client.sent.at(-1).payload).includes("맞혔습니다"));
  assert("  └ 시계도 풀림", !scheduler.reservations().some((r) => r.sessionId === session.id));

  await say("끝난 뒤");
  assert("  └ 끝난 판에는 안 넘김", !heard.includes("끝난 뒤"), JSON.stringify(heard));
}

console.log("\n=== 7. 기간이 다 됐을 때 ===");
{
  const client = makeClient();
  const { session } = await open(client, "chat", { durationSeconds: 1 });

  assert("진행 중인 판은 「접기」로 안 접힘", (await runner.cancel(client, G, session.id, host)) === false);
  assert("  └ 그대로 남아 있음", (await store.getSession(G, session.id)) !== undefined);

  // 시계가 진짜로 도는지 본다 — 1초짜리 판이 스스로 끝나야 한다.
  await new Promise((done) => setTimeout(done, 1400));

  assert("기간이 다 되면 스스로 끝남", (await store.getSession(G, session.id)) === undefined);
  const shown = JSON.stringify(client.sent.at(-1).payload);
  assert("  └ 게임이 마무리를 맡음 (onTimeout)", shown.includes("아무도 못 맞혔습니다"), shown.slice(0, 200));
  assert("  └ 노랑 (온전히 끝나지 못함)", shown.includes("16705372"), shown.slice(0, 120));
}

console.log("\n=== 8. 게임이 터졌을 때 ===");
{
  const client = makeClient();
  const { session } = await open(client, "boom", { channelId: "888888888888888880" });

  assert("판을 정리함", (await store.getSession(G, session.id)) === undefined);
  const shown = JSON.stringify(client.sent.at(-1).payload);
  assert("  └ 실패로 끝냄", shown.includes(speak("끝까지 돌지 못했습니다")), shown.slice(0, 200));
}

// ── 9. 한 채널에 한 판 ─────────────────────────────────────
console.log("\n=== 9. 한 채널에 한 판 ===");
{
  const client = makeClient();
  const first = await open(client, "duo", { channelId: "888888888888888881" });

  const second = await runner.openGame(registry.getGame("many"), G, "888888888888888881", host, {});
  assert("같은 채널에는 못 엶", !second.ok, JSON.stringify(second));
  assert("  └ 돌고 있는 판을 알려 줌", second.running?.id === first.session.id);

  await runner.cancel(client, G, first.session.id, host);
}

// ── 10. 재시작 ─────────────────────────────────────────────
console.log("\n=== 10. 재시작 ===");
{
  const client = makeClient();

  const recruiting = {
    id: "aaaa1111", gameId: "duo", guildId: G, channelId: "888888888888888882",
    title: null, body: null, messageId: null,
    hostId: HOST, players: [HOST], phase: "recruiting",
    openedAt: Date.now(), closesAt: Date.now() + 60_000,
  };
  const playing = {
    id: "bbbb2222", gameId: "many", guildId: G, channelId: "888888888888888883",
    title: null, body: null, messageId: null,
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
  const client = makeClient();
  await store.openSession({
    id: "cccc3333", gameId: "duo", guildId: G, channelId: "888888888888888884",
    title: null, body: null, messageId: null,
    hostId: HOST, players: [HOST], phase: "recruiting",
    openedAt: Date.now() - 10_000, closesAt: Date.now() - 1000,
  });

  await runner.restoreGames(client);
  assert("마감이 이미 지났으면 바로 취소", (await store.getSession(G, "cccc3333")) === undefined);
}

// ── 11. 화면 ───────────────────────────────────────────────
console.log("\n=== 11. 화면 ===");

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
  id: "dddd4444", gameId: "duo", guildId: G, channelId: CH, title: null, body: null, messageId: "1",
  hostId: HOST, players: [HOST, P2], phase: "recruiting",
  openedAt: Date.now(), closesAt: Date.now() + 60_000,
};

checkView("모집 중 → 노랑", views.recruitView(duo, sample, host), 0xfee75c);
checkView("시작 → 노랑 (도는 중)", views.startedView(duo, sample, host), 0xfee75c);
checkView("끝 → 파랑 (알림)", views.endedView(duo, sample, host, { description: "끝" }), 0x5865f2);
checkView("취소 → 노랑", views.cancelledView(duo, sample, host, "접었습니다."), 0xfee75c);
checkView("열지 못함 → 빨강", views.refusedView("실패", "안 됩니다.", host), 0xed4245);

const panelText = bodyOf(views.recruitView(duo, sample, host));
assert("참가자를 멘션으로 적음", panelText.includes(`<@${HOST}>`) && panelText.includes(`<@${P2}>`), panelText);
assert("  └ 마감을 타임스탬프로", TIMESTAMP.test(panelText), panelText);
assert("  └ 인원을 적음", panelText.includes("**2명**"), panelText);

// 끝 화면에는 명단을 넣지 않는다. 답장이 달리는 그 메시지가 바로 위에서 이미 보여 주고,
// 결과는 누가 이겼는지를 말한다. 그 사이에 명단을 끼우면 봐야 할 한 줄이 밀린다.
for (const [label, view] of [
  ["결과가 있을 때", views.endedView(duo, sample, host, { description: "끝" })],
  ["게임이 아무 말 없을 때", views.endedView(duo, sample, host, undefined)],
  ["종료로 끊겼을 때", views.endedView(duo, sample, host, undefined, HOST)],
]) {
  assert(`끝 화면에 참가자 칸 없음 (${label})`, !bodyOf(view).includes("참가한 사람"), bodyOf(view));
}
assert(
  "  └ 끝낸 사람은 그대로 남음",
  bodyOf(views.endedView(duo, sample, host, undefined, HOST)).includes("끝낸 사람"),
);

const crowd = { ...sample, players: Array.from({ length: 40 }, (_, i) => String(100000000000000000 + i)) };
const crowdText = bodyOf(views.recruitView(registry.getGame("many"), crowd, host));
assert("사람이 많으면 잘라서 적음", crowdText.includes("외 25명"), crowdText.slice(0, 200));
checkView("  └ 그래도 규칙을 지킴", views.recruitView(registry.getGame("many"), crowd, host));

// 판이 도는지 끝났는지가 **색으로** 갈라져야 한다.
const colorOf = (view) => buildContainer(view).toJSON().accent_color;
assert(
  "시작과 끝이 다른 색",
  colorOf(views.startedView(duo, sample, host)) !== colorOf(views.endedView(duo, sample, host, {})),
);
assert(
  "  └ 끝은 초록이 아님 (요청한 일이 아니다)",
  colorOf(views.endedView(duo, sample, host, {})) !== 0x57f287,
);
assert(
  "  └ 게임이 실패로 끝나면 그 색",
  colorOf(views.endedView(duo, sample, host, { status: "failure" })) === 0xed4245,
);

const buttons = views.recruitView(duo, sample, host).rows[0].toJSON().components;
assert("버튼 셋 (참가·나가기·시작)", buttons.length === 3, String(buttons.length));
assert(
  "  └ customId 가 판을 가리킴",
  buttons.every((button) => button.custom_id.endsWith(`:${sample.id}`)),
  JSON.stringify(buttons.map((b) => b.custom_id)),
);
assert(
  "  └ 접기는 없어짐 (종료로 합침)",
  !buttons.some((button) => button.custom_id.includes(`:${ids.ACTION.cancel}:`)),
  JSON.stringify(buttons.map((b) => b.custom_id)),
);

// ── 11.5. 종료 버튼 ────────────────────────────────────────
//
// 판을 멈추는 자리는 게임이 버튼을 몇 개 싣든 **늘 같은 곳**에 있어야 한다.
// 액션 로우에 두면 게임 버튼에 밀려 자리가 옮겨 다닌다. 그래서 제목 오른쪽 위다.
console.log("\n=== 11.5. 종료 버튼 ===");

/** 컨테이너 첫 구역의 액세서리 — 제목 오른쪽 위에 붙는 버튼. */
const accessoryOf = (view) => {
  const head = buildContainer(view).toJSON().components[0];
  return head.type === 9 ? head.accessory : undefined;
};

for (const [label, view] of [
  ["모집 중", views.recruitView(duo, sample, host)],
  ["진행 중", views.startedView(duo, { ...sample, phase: "playing" }, host)],
]) {
  const accessory = accessoryOf(view);
  assert(`${label} 화면 오른쪽 위에 종료`, accessory?.label === "종료", JSON.stringify(accessory));
  assert(
    `  └ customId 는 ${ids.ACTION.stop}:<판>`,
    accessory?.custom_id === `${ids.GAME}:${ids.ACTION.stop}:${sample.id}`,
    String(accessory?.custom_id),
  );
  assert("  └ 빨강 (Danger=4)", accessory?.style === 4, String(accessory?.style));
}

for (const [label, view] of [
  ["끝", views.endedView(duo, sample, host, {})],
  ["취소", views.cancelledView(duo, sample, host, "접었습니다")],
]) {
  assert(`${label} 화면에는 없음`, accessoryOf(view) === undefined, JSON.stringify(accessoryOf(view)));
}

assert(
  "누를 수 있는 사람을 핸들러가 가름",
  read("src/components/game.ts").includes("판을 연 사람과 관리자만 종료할 수 있습니다"),
);

// 선착순처럼 자기 버튼을 싣는 게임도 종료 자리는 그대로다.
{
  const withRows = {
    ...duo,
    buttons: () => views.recruitView(duo, sample, host).rows,
  };
  const view = views.startedView(withRows, { ...sample, phase: "playing" }, host);
  assert("게임이 버튼을 실어도 종료는 그 자리", accessoryOf(view)?.label === "종료");
  assert("  └ 게임 버튼은 아래 로우로", view.rows.length === 1);
}

// 실제로 멈추는지 — 단계마다 끝나는 모양이 다르다.
{
  const client = makeClient();
  const { session } = await open(client, "duo");

  assert("모집 중에 종료", (await runner.stopGame(client, G, session.id, host, P2)) === true);
  assert("  └ 판이 사라짐", (await store.getSession(G, session.id)) === undefined);

  const shown = JSON.stringify(client.messages.get(String(session.messageId ?? ""))?.payload ?? {});
  assert("  └ 취소로 끝남", shown.includes("취소"), shown.slice(0, 200));
  assert("  └ 누가 접었는지 멘션으로", shown.includes(`<@${P2}>`), shown.slice(0, 300));
}
{
  heard.length = 0;
  const client = makeClient();
  const { session } = await open(client, "chat", { durationSeconds: 60 });

  assert("진행 중에 종료", (await runner.stopGame(client, G, session.id, host, P3)) === true);
  assert("  └ 판이 사라짐", (await store.getSession(G, session.id)) === undefined);
  assert("  └ 시계도 풀림", !scheduler.reservations().some((r) => r.sessionId === session.id));

  const shown = JSON.stringify(client.sent.at(-1).payload);
  assert("  └ 게임이 마무리를 맡음", shown.includes("아무도 못 맞혔습니다"), shown.slice(0, 200));
  assert("  └ 끝낸 사람을 남김", shown.includes("끝낸 사람"), shown.slice(0, 300));
  assert("  └ 멘션으로", shown.includes(`<@${P3}>`), shown.slice(0, 300));

  await runner.handleGameMessage({ content: "끝난 뒤", channelId: CH, guildId: G, author: { id: P2 } });
  assert("  └ 끝난 판에는 안 넘김", !heard.includes("끝난 뒤"), JSON.stringify(heard));
}
{
  const client = makeClient();
  const { session } = await open(client, "duo");
  await runner.stopGame(client, G, session.id, host, HOST);

  assert("없는 판을 또 종료해도 조용히", (await runner.stopGame(client, G, session.id, host, HOST)) === false);
}

// ── 12. 제목 ───────────────────────────────────────────────
console.log("\n=== 12. 제목 ===");
{
  const titled = { ...sample, title: "보상은 소원권 1개" };

  assert(
    "제목을 적으면 「제목 (게임 이름)」",
    headOf(views.recruitView(duo, titled, host)) === "### 보상은 소원권 1개 (둘이서) — 모집 중",
    headOf(views.recruitView(duo, titled, host)),
  );
  assert(
    "  └ 안 적으면 게임 이름 그대로",
    headOf(views.recruitView(duo, sample, host)) === "### 둘이서 — 모집 중",
    headOf(views.recruitView(duo, sample, host)),
  );
  assert(
    "  └ 공백만 적어도 게임 이름 그대로",
    headOf(views.recruitView(duo, { ...sample, title: "   " }, host)) === "### 둘이서 — 모집 중",
  );

  for (const [label, view] of [
    ["시작", views.startedView(duo, titled, host)],
    ["끝", views.endedView(duo, titled, host, { description: "끝" })],
    ["취소", views.cancelledView(duo, titled, host, "접었습니다.")],
  ]) {
    assert(`  └ ${label} 화면에도 붙음`, headOf(view).includes("보상은 소원권 1개 (둘이서)"), headOf(view));
  }

  checkView("제목을 붙여도 규칙을 지킴", views.recruitView(duo, titled, host));
}
{
  const client = makeClient();
  const { session } = await open(client, "duo", {
    channelId: "888888888888888885",
    title: "보상은 소원권 1개",
  });

  assert("제목이 판에 저장됨", session.title === "보상은 소원권 1개", String(session.title));
  const saved = await store.getSession(G, session.id);
  assert("  └ 파일에서 다시 읽어도", saved?.title === "보상은 소원권 1개", String(saved?.title));

  await runner.cancel(client, G, session.id, host);
}

// 모든 게임 커맨드가 같은 제목 칸을 쓴다.
const commandSource = read("src/games/command.ts");
assert("제목 칸을 한 곳에서 만듦", commandSource.includes("export function titleOption"));
assert("  └ 모달로 받는 게임도 같은 칸", commandSource.includes("export function titleInput"));
assert("  └ 이름은 「제목」", ids.TITLE_OPTION === "제목", ids.TITLE_OPTION);

// ── 13. 소스 ───────────────────────────────────────────────
console.log("\n=== 13. 소스 ===");
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
assert("메시지는 메모리에서 찾아 넘김", runnerSource.includes("const live = new Map"));
assert(
  "결과는 판을 연 메시지에 답장",
  runnerSource.includes("announceAt("),
  "효과의 종료 안내와 같은 자리를 쓴다",
);
assert(
  "  └ 종료 안내와 같은 구현",
  read("src/ui/end-notice.ts").includes("export async function announceAt"),
);

assert("색을 직접 정하지 않음", !read("src/games/views.ts").includes("setAccentColor"));
assert("게임은 화면을 직접 만들지 않음", !read("src/games/types.ts").includes("MessageOptions"));

assert("시작·접기는 주최자와 관리자만", read("src/components/game.ts").includes("PermissionFlagsBits.Administrator"));
assert("  └ 그렇게 말해 줌", read("src/components/game.ts").includes("판을 연 사람과 관리자만"));

assert("부팅 때 되살림", read("src/events/client-ready.ts").includes("restoreGames"));
assert("종료 때 타이머를 정리함", read("src/index.ts").includes("cancelAllCloses"));
assert("채널 메시지를 게임으로 넘김", read("src/events/message-create.ts").includes("handleGameMessage"));

process.chdir(PROJECT);
finish();
