// /퀴즈 검증 — 즉시 시작 · 채팅으로 맞히기 · 기간 · 정답이 새지 않는지.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const sandbox = mkdtempSync(path.join(tmpdir(), "quiz-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const runner = await import(`${DIST}/games/runner.js`);
const store = await import(`${DIST}/games/store.js`);
const views = await import(`${DIST}/games/views.js`);
const quiz = (await import(`${DIST}/games/list/quiz.js`)).default;
const { quizModal } = await import(`${DIST}/games/list/quiz.js`);
// 맞히기 규칙은 초성퀴즈와 함께 쓰는 공용 부품에 있다.
const { keepAnswer, matches } = await import(`${DIST}/games/answer.js`);
const { buildContainer, channelMessage } = await import(`${DIST}/ui/response.js`);

const G = "111111111111111111";
const CH = "222222222222222222";
const HOST = "333333333333333333";
const P2 = "444444444444444444";
const P3 = "555555555555555555";

const host = { id: HOST, username: "주최자" };

// ── 1. 커맨드 ──────────────────────────────────────────────
console.log("\n=== 1. 커맨드 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const command = (await collectCommands()).find((c) => c.data.name === "퀴즈");

assert("/퀴즈 등록됨", command !== undefined);

const json = command.data.toJSON();

// 디스코드는 슬래시 커맨드에 넣은 값을 채널에 그대로 보여 준다.
// 정답을 옵션으로 받으면 명령을 친 순간 모두가 답을 본다.
assert("옵션이 하나도 없음", (json.options ?? []).length === 0, JSON.stringify(json.options));
assert("  └ 서버 전용", JSON.stringify(json.contexts) === "[0]", JSON.stringify(json.contexts));

const modal = quizModal().toJSON();
const fields = modal.components.map((row) => row.components[0]);

assert("모달로 받음", modal.custom_id === "quiz:new", modal.custom_id);
assert(
  "  └ 칸은 문제·정답·기간·제목",
  fields.map((f) => f.custom_id).join(",") === "question,answer,duration,title",
  fields.map((f) => f.custom_id).join(","),
);
assert("  └ 문제·정답·기간은 필수", fields.slice(0, 3).every((f) => f.required === true));
assert("  └ 제목은 선택 (형식이 정한 칸)", fields[3]?.required === false);
assert("  └ 제목 칸 이름은 「제목」", fields[3]?.label === "제목", fields[3]?.label);

// ── 2. 게임 정의 ───────────────────────────────────────────
console.log("\n=== 2. 게임 ===");
assert("즉시 시작 형식", quiz.mode === "instant", quiz.mode);
assert("  └ 채팅을 받는다", typeof quiz.onMessage === "function");
assert("  └ 기간이 끝나면 마무리한다", typeof quiz.onTimeout === "function");

// ── 3. 정답 맞히기 ─────────────────────────────────────────
console.log("\n=== 3. 정답 판정 ===");
for (const [answer, written, expected] of [
  ["서울", "서울", true],
  ["서울", " 서울 ", true],
  ["서울", "서울입니다", false],
  ["서울", "부산", false],
  ["Hello World", "hello world", true],
  ["Hello World", "HELLO   WORLD", true],
  ["Hello World", "helloworld", false],
  ["42", "42", true],
  ["", "", false],
  ["서울", "", false],
]) {
  assert(`\`${answer}\` ← \`${written}\` → ${expected}`, matches(answer, written) === expected);
}

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

  return { sent, messages, users: { fetch: async () => host }, channels: { fetch: async (id) => channel(id) }, makeChannel: channel };
}

/** 커맨드가 하는 일 — 정답을 맡기고 판을 연다. */
async function openQuiz(client, { question, answer, seconds = 60, title = null, channelId = CH }) {
  const opened = await runner.openGame(quiz, G, channelId, host, {
    title,
    body: question,
    durationSeconds: seconds,
  });
  if (!opened.ok) return opened;

  keepAnswer(opened.session.id, answer);

  const message = await client.makeChannel(channelId).send(channelMessage(opened.view));
  await runner.attach(client, quiz, opened.session, message, host);

  return opened;
}

const say = (content, authorId, channelId = CH) =>
  runner.handleGameMessage({ content, channelId, guildId: G, author: { id: authorId } });

const bodyOf = (payload) => {
  const head = payload.components[0].toJSON().components[0];
  return head.type === 9 ? head.components[0].content : head.content;
};

// ── 4. 한 판 ───────────────────────────────────────────────
console.log("\n=== 4. 맞히면 이긴다 ===");
{
  const client = makeClient();
  const { session } = await openQuiz(client, { question: "대한민국의 수도는?", answer: "서울" });

  const panel = bodyOf(client.messages.get(String(session.messageId ?? "")).payload ?? {});
  assert("문제가 화면에 실림", panel.includes("대한민국의 수도는?"), panel);
  assert("  └ 정답은 새지 않음", !panel.includes("서울"), panel);
  assert("  └ 종료 시각을 타임스탬프로", /<t:\d+:[FR]>/u.test(panel), panel);

  await say("부산", P2);
  assert("틀리면 안 끝남", (await store.getSession(G, session.id)) !== undefined);

  await say(" 서울 ", P2);
  assert("맞히면 끝남", (await store.getSession(G, session.id)) === undefined);

  const last = client.sent.at(-1);
  const result = bodyOf(last.payload);
  assert("  └ 판을 연 메시지에 답장으로", last.replyTo === session.messageId, JSON.stringify(last.replyTo));
  assert("  └ 이긴 사람을 멘션으로", result.includes(`<@${P2}>`), result);
  assert("  └ 정답을 공개", result.includes("서울"), result);
  assert("  └ 파랑 (알림)", client.sent.at(-1).payload.components[0].toJSON().accent_color === 0x5865f2);
}

console.log("\n=== 5. 먼저 맞힌 사람만 ===");
{
  const client = makeClient();
  const { session } = await openQuiz(client, {
    question: "1+1?",
    answer: "2",
    channelId: "888888888888888881",
  });

  await say("2", P2, "888888888888888881");
  const first = JSON.stringify(client.sent.at(-1).payload);

  await say("2", P3, "888888888888888881");
  assert("두 번째 답은 아무 일도 안 함", JSON.stringify(client.sent.at(-1).payload) === first);
  assert("  └ 이긴 사람은 처음 맞힌 사람", first.includes(`<@${P2}>`), first.slice(0, 200));
  assert("  └ 판은 이미 끝남", (await store.getSession(G, session.id)) === undefined);
}

console.log("\n=== 6. 아무도 못 맞히면 ===");
{
  const client = makeClient();
  const { session } = await openQuiz(client, {
    question: "아무도 모르는 문제",
    answer: "정답",
    seconds: 1,
    channelId: "888888888888888882",
  });

  await new Promise((done) => setTimeout(done, 1400));

  assert("기간이 끝나면 스스로 끝남", (await store.getSession(G, session.id)) === undefined);

  const result = bodyOf(client.sent.at(-1).payload);
  assert("  └ 아무도 못 맞혔다고", result.includes("아무도 맞히지 못했습니다"), result);
  assert("  └ 정답을 공개", result.includes("정답"), result);
  assert(
    "  └ 파랑 (맞혔든 아니든 알림)",
    client.sent.at(-1).payload.components[0].toJSON().accent_color === 0x5865f2,
  );
}

// ── 7. 제목 ────────────────────────────────────────────────
console.log("\n=== 7. 제목 ===");
{
  const client = makeClient();
  const { session } = await openQuiz(client, {
    question: "문제",
    answer: "답",
    title: "보상은 소원권 1개",
    channelId: "888888888888888883",
  });

  const head = bodyOf(client.messages.get(String(session.messageId ?? "")).payload).split("\n")[0];
  assert("제목이 「제목 (퀴즈)」", head === "### 보상은 소원권 1개 (퀴즈) — 시작", head);

  await say("답", P2, "888888888888888883");
  const result = bodyOf(client.sent.at(-1).payload).split("\n")[0];
  assert("  └ 결과 화면에도", result === "### 보상은 소원권 1개 (퀴즈) — 끝", result);
}

// ── 8. 화면 규칙 ───────────────────────────────────────────
console.log("\n=== 8. 화면 규칙 ===");
const sample = {
  id: "aaaa1111", gameId: "quiz", guildId: G, channelId: CH,
  title: null, body: "대한민국의 수도는?", messageId: "1",
  hostId: HOST, players: [HOST], phase: "playing",
  openedAt: Date.now(), closesAt: Date.now() + 60_000,
};

for (const [label, view, expected] of [
  ["시작 → 노랑 (도는 중)", views.startedView(quiz, sample, host), 0xfee75c],
  ["맞힘 → 파랑 (알림)", views.endedView(quiz, sample, host, { description: `<@${P2}> 님이 맞혔습니다.` }), 0x5865f2],
  [
    "아무도 못 맞힘 → 파랑 (그것도 알림)",
    views.endedView(quiz, sample, host, { description: "아무도 맞히지 못했습니다." }),
    0x5865f2,
  ],
]) {
  const container = buildContainer(view).toJSON();
  const list = container.components;
  const text = list[0].type === 9 ? list[0].components[0].content : list[0].content;

  const problems = [];
  if (container.accent_color !== expected) problems.push(`색 ${container.accent_color}`);
  if (!text.startsWith("### 퀴즈")) problems.push("제목이 「퀴즈」 로 시작하지 않음");
  if (!list.at(-1).content.startsWith("-# @")) problems.push("footer");
  if (list.at(-2)?.type !== 14) problems.push("footer 앞 가로줄");
  if (/\d{4}년|\d{4}-\d{2}-\d{2}/u.test(text.replaceAll(/<t:\d+:[tTdDfFR]>/gu, ""))) {
    problems.push("날짜를 글자로 적음");
  }

  assert(label, problems.length === 0, problems.join(" / "));
}

// ── 9. 소스 ────────────────────────────────────────────────
console.log("\n=== 9. 소스 ===");
const quizSource = read("src/games/list/quiz.ts");
const commandSource = read("src/commands/quiz.ts");
const modalSource = read("src/components/quiz.ts");

const answerSource = read("src/games/answer.ts");
assert("정답은 저장소에 안 남김", !quizSource.includes("session.answer"));
assert("  └ 메모리에만 든다", answerSource.includes("const rounds = new Map"));
assert("  └ 판이 끝나면 지운다", answerSource.includes("rounds.delete"));
assert("맞히기 규칙을 따로 만들지 않음", quizSource.includes("...answerGame"));
assert("정답을 시작 전에 맡김", modalSource.includes("prepare:"), "여는 순간 답이 들어올 수 있다");
assert("제목 칸은 형식이 준 것", quizSource.includes("titleInput"), "이름·길이가 한 곳에서 나온다");
assert("커맨드는 모달만 띄움", commandSource.includes("showModal"));
assert("  └ 옵션을 붙이지 않음", !commandSource.includes("addStringOption"));

process.chdir(PROJECT);
finish();
