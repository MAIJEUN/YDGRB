// /탕수육 검증 — 탕 → 수 → 육 을 번갈아 치고, 틀리게 친 사람이 진다.
//
// 채팅으로 겨루는 게임이라 **그 채널에 올라오는 모든 메시지가 한 수**다. 그 규칙을
// 말로만 적어 두면 다음에 「게임과 상관없는 말은 봐주자」 가 슬그머니 들어온다.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish, speak } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const sandbox = mkdtempSync(path.join(tmpdir(), "tangsuyuk-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const registry = await import(`${DIST}/games/registry.js`);
const runner = await import(`${DIST}/games/runner.js`);
const store = await import(`${DIST}/games/store.js`);
const views = await import(`${DIST}/games/views.js`);
const game = await import(`${DIST}/games/list/tangsuyuk.js`);
const tangsuyuk = game.default;
const { buildContainer, channelMessage } = await import(`${DIST}/ui/response.js`);

await registry.loadGames();

const G = "111111111111111111";
const CH = "222222222222222222";
const OTHER_CH = "999999999999999999";
const HOST = "333333333333333333";
const P = (n) => `44444444444444${String(1000 + n).slice(1)}`;

const host = { id: HOST, username: "주최자" };

const bodyOf = (view) => {
  const head = buildContainer(view).toJSON().components[0];
  return head.type === 9 ? head.components[0].content : head.content;
};

// ── 1. 커맨드 ──────────────────────────────────────────────
console.log("\n=== 1. 커맨드 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const command = (await collectCommands()).find((c) => c.data.name === "탕수육");

assert("/탕수육 등록됨", command !== undefined);

const json = command.data.toJSON();
const options = json.options ?? [];

// 치는 글자도 순서도 지는 조건도 게임이 정해 놓은 것이라, 받을 값이 없다.
assert("옵션은 제목 하나뿐", options.map((o) => o.name).join(",") === "제목", options.map((o) => o.name).join(","));
assert("  └ 그마저 선택", options[0]?.required !== true);
assert("  └ 서버 전용", JSON.stringify(json.contexts) === "[0]");

// ── 2. 형식 ────────────────────────────────────────────────
console.log("\n=== 2. 형식 ===");
assert("즉시 시작 형식", tangsuyuk.mode === "instant", tangsuyuk.mode);
assert("목록에서 자동으로 잡힘", registry.getGame("tangsuyuk") !== undefined);
assert("차례는 탕 · 수 · 육", game.STEPS.join(",") === "탕,수,육", game.STEPS.join(","));
assert("채팅으로 겨룸", typeof tangsuyuk.onMessage === "function");
assert("  └ 버튼은 없음", tangsuyuk.buttons === undefined);

// ── 3. 차례 ────────────────────────────────────────────────
console.log("\n=== 3. 차례 ===");
{
  const S = "bbbb2222";
  game.keepChain(S);

  assert("처음은 탕", game.nextOf(game.chainOf(S)) === "탕");
  assert("  └ 탕이 아니면 짐", game.play(S, P(1), "수").reason === "wrong");
  assert("    · 그래도 차례는 그대로", game.nextOf(game.chainOf(S)) === "탕");

  assert("탕", game.play(S, P(1), "탕").ok === true);
  assert("  └ 다음은 수", game.nextOf(game.chainOf(S)) === "수");
  assert("수", game.play(S, P(2), "수").ok === true);
  assert("육", game.play(S, P(3), "육").ok === true);
  assert("  └ 한 바퀴 돌면 다시 탕", game.nextOf(game.chainOf(S)) === "탕");
  assert("  └ 이어 온 횟수를 셈", game.chainOf(S).moves === 3, String(game.chainOf(S).moves));

  // 앞뒤 공백은 봐준다. 모바일에서 붙는 것까지 지게 할 이유는 없다.
  assert("앞뒤 공백은 봐줌", game.play(S, P(1), " 탕 ").ok === true);

  // 한 사람이 잇달아 칠 수 없다 — 맞는 글자라도 그렇다.
  const twice = game.play(S, P(1), "수");
  assert("잇달아 치면 짐", twice.reason === "twice", JSON.stringify(twice));
  assert("  └ 다른 사람이면 됨", game.play(S, P(2), "수").ok === true);

  // 틀린 글자를 먼저 본다 — 잇달아 친 데다 글자까지 틀렸으면 글자가 틀렸다고 말한다.
  const both = game.play(S, P(2), "ㅋㅋ");
  assert("잇달아 + 틀린 글자는 「틀림」으로", both.reason === "wrong", JSON.stringify(both));
  assert("  └ 쳐야 했던 글자를 알려 줌", both.expected === "육", both.expected);
  assert("  └ 거기까지의 횟수도", both.moves === 5, String(both.moves));

  assert("없는 판은 막힘", game.play("없음", P(1), "탕").reason === "gone");

  game.dropChain(S);
}

// ── 4. 판이 도는 채널의 모든 메시지가 한 수 ────────────────
//
// 「탕수육 하는 채널에서 딴 소리를 하면 진다」 가 이 게임이다. 게임과 상관없는 말이라고
// 봐주면 게임이 아니게 된다.
console.log("\n=== 4. 모든 메시지가 한 수 ===");
{
  const client = makeClient();
  const opened = await open(client);

  await say(client, P(1), "탕");
  await say(client, P(2), "수");
  assert("맞게 치면 조용히 넘어감", (await store.getSession(G, opened.session.id)) !== undefined);
  assert("  └ 봇이 끼어들지 않음", client.sent.length === 1, JSON.stringify(client.sent.length));
  assert("  └ 친 사람이 참가자로", (await store.getSession(G, opened.session.id)).players.length === 2);

  // 다른 채널의 말은 이 판과 상관이 없다.
  await say(client, P(3), "육", OTHER_CH);
  assert("다른 채널은 안 셈", (await store.getSession(G, opened.session.id)) !== undefined);

  await say(client, P(3), "ㅋㅋ");

  const notice = JSON.stringify(client.sent.at(-1)?.payload ?? {});
  assert("게임과 상관없는 말도 한 수", (await store.getSession(G, opened.session.id)) === undefined);
  assert("  └ 친 사람이 짐", notice.includes(`<@${P(3)}> ${speak("님이 졌습니다.")}`), notice.slice(0, 300));
  assert("  └ 쳐야 했던 글자를 적음", notice.includes("**육**"), notice.slice(0, 300));
  assert("  └ 이어 간 횟수도", notice.includes("2번"), notice.slice(0, 300));
  assert("  └ 판을 연 메시지에 답장으로", client.sent.at(-1)?.replyTo === opened.message.id);

  game.dropChain(opened.session.id);
}

// ── 5. 잇달아 치면 진다 ────────────────────────────────────
console.log("\n=== 5. 잇달아 치면 진다 ===");
{
  const client = makeClient();
  const opened = await open(client);

  await say(client, P(1), "탕");
  await say(client, P(1), "수");

  const notice = JSON.stringify(client.sent.at(-1)?.payload ?? {});
  assert("혼자 이어 가면 짐", (await store.getSession(G, opened.session.id)) === undefined);
  assert("  └ 왜 졌는지 적음", notice.includes(speak("한 사람이 잇달아 칠 수는 없습니다.")), notice.slice(0, 300));

  game.dropChain(opened.session.id);
}

// ── 6. 시계는 없다 ─────────────────────────────────────────
//
// 기다리는 것이 시간이 아니라 사람이다. 그만두는 길은 오른쪽 위 「종료」다.
console.log("\n=== 6. 시계는 없다 ===");
{
  const client = makeClient();

  assert("기간을 걸지 않음", read("src/commands/tangsuyuk.ts").includes("durationSeconds: null"));

  const opened = await open(client);
  const playing = await store.getSession(G, opened.session.id);

  assert("열자마자 도는 중", playing.phase === "playing", playing.phase);
  assert("  └ 멎는 시각이 없음", playing.closesAt === null, String(playing.closesAt));
  assert("  └ 화면에도 종료 칸이 없음", !bodyOf(opened.view).includes("**종료**"), bodyOf(opened.view));

  await say(client, P(1), "탕");
  await say(client, P(2), "수");
  await runner.stopGame(client, G, opened.session.id, host, HOST);

  const notice = JSON.stringify(client.sent.at(-1)?.payload ?? {});
  assert("「종료」로 접힘", (await store.getSession(G, opened.session.id)) === undefined);
  assert("  └ 진 사람 없이 끝났다고", notice.includes(speak("아무도 지지 않고 판이 끝났습니다.")), notice.slice(0, 300));
  assert("  └ 노랑 (온전히 끝나지 못함)", notice.includes("16705372"), notice.slice(0, 300));
  assert("  └ 이어 간 횟수는 그대로", notice.includes("2번"), notice.slice(0, 300));

  game.dropChain(opened.session.id);
}

// ── 7. 화면 ────────────────────────────────────────────────
console.log("\n=== 7. 화면 ===");
{
  const client = makeClient();
  const opened = await open(client);
  const text = bodyOf(opened.view);

  assert("차례를 적음", text.includes("**탕** → **수** → **육**"), text);
  assert("  └ 지는 조건도", text.includes(speak("틀리게 치거나 잇달아 치면 집니다.")), text);
  assert("  └ 두 줄을 넘지 않음", text.split("\n").filter((line) => line.trim() !== "").length === 3, text);
  assert("  └ 노랑 (도는 중)", buildContainer(opened.view).toJSON().accent_color === 0xfee75c);

  // 판이 도는 동안 화면은 그대로다 — 한 수마다 고치면 편집 제한에 걸린다.
  await say(client, P(1), "탕");
  assert("한 수마다 화면을 고치지 않음", client.messages.get(opened.message.id).payload === opened.payload);

  await runner.stopGame(client, G, opened.session.id, host, HOST);
  game.dropChain(opened.session.id);
}

finish();

/** 판 하나를 열고 채널에 붙인다. */
async function open(client) {
  const opened = await runner.openGame(tangsuyuk, G, CH, host, {
    durationSeconds: null,
    prepare: game.keepChain,
  });
  const payload = channelMessage(opened.view);
  const message = await client.makeChannel(CH).send(payload);
  await runner.attach(client, tangsuyuk, opened.session, message, host);

  return { ...opened, message, payload };
}

/** 그 채널에 한 줄 친다. */
async function say(client, userId, content, channelId = CH) {
  await runner.handleGameMessage({
    guildId: G,
    channelId,
    content,
    author: { id: userId, bot: false },
    client,
  });
}

/** 판을 열고 메시지를 붙이는 데 필요한 만큼의 가짜 디스코드. */
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
        edit: async (next) => {
          message.payload = next;
        },
        reply: async (next) => {
          sent.push({ channelId: id, payload: next, replyTo: messageId });
          return { id: String((nextId += 1)), payload: next, edit: async () => {} };
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
