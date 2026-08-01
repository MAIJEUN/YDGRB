// /초성퀴즈 검증 — 초성 변환 · 퀴즈와 같은 규칙 · 정답이 새지 않는지.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const sandbox = mkdtempSync(path.join(tmpdir(), "chosung-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const { hasSyllable, toChoseong } = await import(`${DIST}/hangul.js`);
const runner = await import(`${DIST}/games/runner.js`);
const store = await import(`${DIST}/games/store.js`);
const { keepAnswer } = await import(`${DIST}/games/answer.js`);
const chosung = (await import(`${DIST}/games/list/chosung.js`)).default;
const { chosungModal } = await import(`${DIST}/games/list/chosung.js`);
const { channelMessage } = await import(`${DIST}/ui/response.js`);

const G = "111111111111111111";
const CH = "222222222222222222";
const HOST = "333333333333333333";
const P2 = "444444444444444444";

const host = { id: HOST, username: "주최자" };

// ── 1. 초성 변환 ───────────────────────────────────────────
console.log("\n=== 1. 초성 변환 ===");
for (const [text, expected] of [
  // 받침이 없는 것 · 있는 것.
  ["안녕", "ㅇㄴ"],
  ["가", "ㄱ"],
  ["힣", "ㅎ"],
  ["안녕하세요", "ㅇㄴㅎㅅㅇ"],
  // 초성 19자를 다 지난다 (쌍자음 포함).
  ["까치", "ㄲㅊ"],
  ["딸기", "ㄸㄱ"],
  ["빵", "ㅃ"],
  ["쌀", "ㅆ"],
  ["짜장", "ㅉㅈ"],
  // 띄어쓰기는 남는다 — 몇 단어인지 보여야 한다.
  ["대한 민국", "ㄷㅎ ㅁㄱ"],
  // 한글이 아닌 것은 그대로.
  ["A1 안녕!", "A1 ㅇㄴ!"],
  ["2026년", "2026ㄴ"],
  ["🙂 하이", "🙂 ㅎㅇ"],
  // 이미 자모인 것은 건드리지 않는다.
  ["ㅇㄴ", "ㅇㄴ"],
  ["ㅏㅑ", "ㅏㅑ"],
  ["", ""],
]) {
  assert(`\`${text}\` → \`${expected}\``, toChoseong(text) === expected, toChoseong(text));
}

console.log("\n=== 2. 초성으로 바꿀 것이 있는가 ===");
for (const [text, expected] of [
  ["안녕", true],
  ["A 안녕", true],
  ["가", true],
  ["힣", true],
  ["ㅇㄴ", false],
  ["12345", false],
  ["hello", false],
  ["", false],
  ["!!!", false],
]) {
  assert(`\`${text}\` → ${expected}`, hasSyllable(text) === expected);
}

assert(
  "한글이 없으면 문제가 답과 같아짐",
  toChoseong("hello") === "hello" && !hasSyllable("hello"),
  "그래서 모달에서 막는다",
);

// ── 3. 커맨드 ──────────────────────────────────────────────
console.log("\n=== 3. 커맨드 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const command = (await collectCommands()).find((c) => c.data.name === "초성퀴즈");

assert("/초성퀴즈 등록됨", command !== undefined);

const json = command.data.toJSON();
assert("옵션이 하나도 없음", (json.options ?? []).length === 0, JSON.stringify(json.options));
assert("  └ 서버 전용", JSON.stringify(json.contexts) === "[0]", JSON.stringify(json.contexts));

const modal = chosungModal().toJSON();
const fields = modal.components.map((row) => row.components[0]);

assert("모달로 받음", modal.custom_id === "chosung:new", modal.custom_id);
assert(
  "  └ 칸은 텍스트·기간·제목",
  fields.map((f) => f.custom_id).join(",") === "text,duration,title",
  fields.map((f) => f.custom_id).join(","),
);
assert("  └ 텍스트·기간은 필수", fields.slice(0, 2).every((f) => f.required === true));
assert("  └ 제목은 선택 (형식이 정한 칸)", fields[2]?.required === false);
assert("  └ 제목 칸 이름은 「제목」", fields[2]?.label === "제목", fields[2]?.label);

// ── 4. 게임 ────────────────────────────────────────────────
console.log("\n=== 4. 게임 ===");
assert("즉시 시작 형식", chosung.mode === "instant", chosung.mode);
assert("  └ 채팅을 받는다", typeof chosung.onMessage === "function");
assert("  └ 기간이 끝나면 마무리한다", typeof chosung.onTimeout === "function");

const quiz = (await import(`${DIST}/games/list/quiz.js`)).default;
assert("퀴즈와 같은 규칙을 씀", chosung.onMessage === quiz.onMessage && chosung.onTimeout === quiz.onTimeout);
assert("  └ 이름은 따로", chosung.id !== quiz.id && chosung.name === "초성퀴즈");

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
    users: { fetch: async () => host },
    channels: { fetch: async (id) => channel(id) },
    makeChannel: channel,
  };
}

/** 모달 핸들러가 하는 일 — 초성으로 바꿔 띄우고 원래 글자를 맡긴다. */
async function open(client, { text, seconds = 60, title = null, channelId = CH }) {
  const opened = await runner.openGame(chosung, G, channelId, host, {
    title,
    body: `# ${toChoseong(text)}`,
    durationSeconds: seconds,
  });
  if (!opened.ok) return opened;

  keepAnswer(opened.session.id, text);

  const message = await client.makeChannel(channelId).send(channelMessage(opened.view));
  await runner.attach(client, chosung, opened.session, message, host);

  return opened;
}

const say = (content, authorId, channelId = CH) =>
  runner.handleGameMessage({ content, channelId, guildId: G, author: { id: authorId } });

const bodyOf = (payload) => {
  const head = payload.components[0].toJSON().components[0];
  return head.type === 9 ? head.components[0].content : head.content;
};

// ── 5. 한 판 ───────────────────────────────────────────────
console.log("\n=== 5. 맞히면 이긴다 ===");
{
  const client = makeClient();
  const { session } = await open(client, { text: "안녕하세요" });

  const panel = bodyOf(client.messages.get(String(session.messageId ?? "")).payload);
  assert("초성이 문제로 실림", panel.includes("ㅇㄴㅎㅅㅇ"), panel);
  assert("  └ 원래 글자는 새지 않음", !panel.includes("안녕하세요"), panel);

  await say("반갑습니다", P2);
  assert("틀리면 안 끝남", (await store.getSession(G, session.id)) !== undefined);

  await say("ㅇㄴㅎㅅㅇ", P2);
  assert("초성을 그대로 적어도 오답", (await store.getSession(G, session.id)) !== undefined);

  await say(" 안녕하세요 ", P2);
  assert("원래 글자를 맞히면 끝남", (await store.getSession(G, session.id)) === undefined);

  const last = client.sent.at(-1);
  const result = bodyOf(last.payload);
  assert("  └ 판을 연 메시지에 답장으로", last.replyTo === session.messageId, String(last.replyTo));
  assert("  └ 이긴 사람을 멘션으로", result.includes(`<@${P2}>`), result);
  assert("  └ 정답을 공개", result.includes("안녕하세요"), result);
  assert("  └ 파랑 (알림)", last.payload.components[0].toJSON().accent_color === 0x5865f2);
}

console.log("\n=== 6. 아무도 못 맞히면 ===");
{
  const client = makeClient();
  const { session } = await open(client, {
    text: "아무도 모름",
    seconds: 1,
    channelId: "888888888888888881",
  });

  await new Promise((done) => setTimeout(done, 1400));

  assert("기간이 끝나면 스스로 끝남", (await store.getSession(G, session.id)) === undefined);

  const result = bodyOf(client.sent.at(-1).payload);
  assert("  └ 아무도 못 맞혔다고", result.includes("아무도 맞히지 못했습니다"), result);
  assert("  └ 원래 글자를 공개", result.includes("아무도 모름"), result);
}

// ── 7. 제목 ────────────────────────────────────────────────
console.log("\n=== 7. 제목 ===");
{
  const client = makeClient();
  const { session } = await open(client, {
    text: "감사합니다",
    title: "보상은 소원권 1개",
    channelId: "888888888888888882",
  });

  const head = bodyOf(client.messages.get(String(session.messageId ?? "")).payload).split("\n")[0];
  assert("제목이 「제목 (초성퀴즈)」", head === "### 보상은 소원권 1개 (초성퀴즈) — 시작", head);

  await say("감사합니다", P2, "888888888888888882");
  const result = bodyOf(client.sent.at(-1).payload).split("\n")[0];
  assert("  └ 결과 화면에도", result === "### 보상은 소원권 1개 (초성퀴즈) — 끝", result);
}

// ── 8. 소스 ────────────────────────────────────────────────
console.log("\n=== 8. 소스 ===");
const modalSource = read("src/components/chosung.ts");
const commandSource = read("src/commands/chosung.ts");
const gameSource = read("src/games/list/chosung.ts");

assert("한글이 없으면 막음", modalSource.includes("hasSyllable(text)"), "문제가 답과 같아진다");
assert("정답을 시작 전에 맡김", modalSource.includes("prepare:"), "여는 순간 답이 들어올 수 있다");
assert("커맨드는 모달만 띄움", commandSource.includes("showModal"));
assert("  └ 옵션을 붙이지 않음", !commandSource.includes("addStringOption"));
assert("맞히기 규칙을 따로 만들지 않음", gameSource.includes("...answerGame"));
assert("  └ 정답을 저장소에 안 남김", !gameSource.includes("session.answer"));
assert("제목 칸은 형식이 준 것", gameSource.includes("titleInput"));

process.chdir(PROJECT);
finish();
