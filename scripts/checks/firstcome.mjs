// /선착순 검증 — 두 방식 · 한 사람 한 번 · 눌린 순서 10줄 · 시간 만료.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish, speak } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const sandbox = mkdtempSync(path.join(tmpdir(), "firstcome-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const runner = await import(`${DIST}/games/runner.js`);
const store = await import(`${DIST}/games/store.js`);
const views = await import(`${DIST}/games/views.js`);
const firstcome = (await import(`${DIST}/games/list/firstcome.js`)).default;
const race = await import(`${DIST}/games/list/firstcome.js`);
const { channelMessage } = await import(`${DIST}/ui/response.js`);

const G = "111111111111111111";
const CH = "222222222222222222";
const HOST = "333333333333333333";
const P = (n) => `44444444444444${String(1000 + n).slice(1)}`;

const host = { id: HOST, username: "주최자" };

// ── 1. 커맨드 ──────────────────────────────────────────────
console.log("\n=== 1. 커맨드 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const command = (await collectCommands()).find((c) => c.data.name === "선착순");

assert("/선착순 등록됨", command !== undefined);

const json = command.data.toJSON();
const options = json.options ?? [];

assert("옵션은 종류·값·제목", options.map((o) => o.name).join(",") === "종류,값,제목", options.map((o) => o.name).join(","));
assert("  └ 종류는 필수", options[0]?.required === true);
assert(
  "  └ 고르는 것은 n명 · n번째",
  (options[0]?.choices ?? []).map((c) => c.value).join(",") === "count,nth",
  JSON.stringify(options[0]?.choices),
);
assert("  └ 값은 선택", options[1]?.required !== true);
assert("  └ 값은 정수", options[1]?.type === 4, String(options[1]?.type));
assert(
  "  └ 값의 범위를 막아 둠",
  options[1]?.min_value === race.MIN_TARGET && options[1]?.max_value === race.MAX_TARGET,
  `${options[1]?.min_value}~${options[1]?.max_value}`,
);
assert("  └ 제목은 선택 (형식이 정한 칸)", options[2]?.required !== true);
assert("  └ 서버 전용", JSON.stringify(json.contexts) === "[0]", JSON.stringify(json.contexts));

// ── 2. 기본값 ──────────────────────────────────────────────
console.log("\n=== 2. 기본값 ===");
assert("n명 기본은 1", race.DEFAULT_TARGET.count === 1, String(race.DEFAULT_TARGET.count));
assert("n번째 기본은 5", race.DEFAULT_TARGET.nth === 5, String(race.DEFAULT_TARGET.nth));
assert("즉시 시작 형식", firstcome.mode === "instant", firstcome.mode);
assert("  └ 버튼으로 겨룬다", typeof firstcome.buttons === "function");
assert("  └ 시간이 다 되면 마무리한다", typeof firstcome.onTimeout === "function");

// ── 3. 누르기 ──────────────────────────────────────────────
console.log("\n=== 3. 한 사람 한 번 ===");
{
  race.keepRace("s1", race.MODE.count, 3);

  assert("처음 누르면 1번째", race.press("s1", P(1)).order === 1);
  assert("  └ 다음 사람은 2번째", race.press("s1", P(2)).order === 2);

  const again = race.press("s1", P(1));
  assert("같은 사람이 또 누르면 막힘", !again.ok && again.reason === "already", JSON.stringify(again));
  assert("  └ 순서가 늘지 않음", race.raceOf("s1").pressed.length === 2);

  const third = race.press("s1", P(3));
  assert("목표를 채우면 알려 줌", third.ok && third.filled === true, JSON.stringify(third));

  const late = race.press("s1", P(4));
  assert("  └ 뒤늦게 누르면 막힘", !late.ok && late.reason === "closed", JSON.stringify(late));

  assert("없는 판은 막힘", race.press("없음", P(1)).reason === "gone");
  race.dropRace("s1");
}

console.log("\n=== 4. 이긴 사람 ===");
{
  race.keepRace("s2", race.MODE.count, 3);
  for (const n of [1, 2, 3]) race.press("s2", P(n));

  const winners = race.winnersOf(race.raceOf("s2"));
  assert("n명 — 앞에서부터 그 수만큼", winners.length === 3, JSON.stringify(winners));
  assert("  └ 누른 순서 그대로", winners[0] === P(1) && winners[2] === P(3));
  race.dropRace("s2");
}
{
  race.keepRace("s3", race.MODE.nth, 3);
  for (const n of [1, 2, 3]) race.press("s3", P(n));

  const winners = race.winnersOf(race.raceOf("s3"));
  assert("n번째 — 그 자리 한 사람만", winners.length === 1, JSON.stringify(winners));
  assert("  └ 3번째로 누른 사람", winners[0] === P(3), winners[0]);
  race.dropRace("s3");
}
{
  // 아무도 안 눌렀으면 이긴 사람도 없다.
  race.keepRace("s4", race.MODE.nth, 5);
  assert("빈 판에는 이긴 사람 없음", race.winnersOf(race.raceOf("s4")).length === 0);
  race.dropRace("s4");
}

// ── 5. 눌린 순서 ───────────────────────────────────────────
console.log("\n=== 5. 눌린 순서 ===");
{
  race.keepRace("s5", race.MODE.nth, 100);
  for (const n of [1, 2, 3, 4]) race.press("s5", P(n));

  const board = race.pressBoard(race.raceOf("s5"));
  const lines = board.split("\n");

  assert("늦게 누른 사람이 위", lines[0] === `\`4번째\` <@${P(4)}>`, lines[0]);
  assert("  └ 아래로 갈수록 먼저", lines.at(-1) === `\`1번째\` <@${P(1)}>`, lines.at(-1));
  assert("  └ 있는 만큼만 (4줄)", lines.length === 4, String(lines.length));
  assert("  └ 유저를 멘션으로", lines.every((line) => /<@\d+>$/u.test(line)), board);
  // 번째를 인라인 코드로 감싸 칸처럼 보이게 한다.
  assert("  └ 번째가 칸으로 감싸짐", lines.every((line) => /^`\d+번째`/u.test(line)), board);
  // 코드블록으로 통째로 감싸면 그 안에서는 멘션이 날것으로 나온다.
  assert("  └ 코드블록은 쓰지 않음", !board.includes("```"), board);

  // 넘치면 최근 것부터 10줄.
  for (let n = 5; n <= 25; n += 1) race.press("s5", P(n));
  const many = race.pressBoard(race.raceOf("s5")).split("\n");

  assert("10명을 넘으면 잘라 냄", many.length === race.MAX_SHOWN_PRESSES, String(many.length));
  assert("  └ 가장 최근이 맨 위", many[0] === `\`25번째\` <@${P(25)}>`, many[0]);
  assert("  └ 그 아래로 열 줄", many.at(-1) === `\`16번째\` <@${P(16)}>`, many.at(-1));

  race.dropRace("s5");
}
{
  race.keepRace("s6", race.MODE.nth, 3);
  assert("아무도 안 눌렀으면 「아직 없음」", race.pressBoard(race.raceOf("s6")) === "아직 없음");
  assert("  └ 결과 칸도 만들지 않음", race.pressField(race.raceOf("s6")).length === 0);
  race.dropRace("s6");
}
{
  // n명은 누른 사람이 곧 이긴 사람이라, 아래에 또 늘어놓지 않는다.
  race.keepRace("s7", race.MODE.count, 3);
  for (const n of [1, 2, 3]) race.press("s7", P(n));

  assert("n명은 눌린 순서 칸을 안 만듦", race.pressField(race.raceOf("s7")).length === 0);
  assert("  └ n번째는 만듦", (() => {
    race.keepRace("s8", race.MODE.nth, 3);
    for (const n of [1, 2, 3]) race.press("s8", P(n));
    const made = race.pressField(race.raceOf("s8")).length === 1;
    race.dropRace("s8");
    return made;
  })());
  race.dropRace("s7");
}

console.log("\n=== 6. 목표 문구 ===");
assert("n명", race.raceName(race.MODE.count, 3) === "선착순 3명", race.raceName(race.MODE.count, 3));
assert("n번째", race.raceName(race.MODE.nth, 5) === "선착순 5번째", race.raceName(race.MODE.nth, 5));

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

/** 커맨드가 하는 일 — 목표를 맡기고 판을 연다. */
async function open(client, { mode, target, seconds = 60, title = null, channelId = CH }) {
  const opened = await runner.openGame(firstcome, G, channelId, host, {
    title,
    name: race.raceName(mode, target),
    durationSeconds: seconds,
    // 화면을 만들기 전에 맡겨야 첫 화면에 버튼이 붙는다.
    prepare: (sessionId) => race.keepRace(sessionId, mode, target),
  });
  if (!opened.ok) return opened;

  const message = await client.makeChannel(channelId).send(channelMessage(opened.view));
  await runner.attach(client, firstcome, opened.session, message, host);

  return opened;
}

const bodyOf = (payload) => {
  const head = payload.components[0].toJSON().components[0];
  return head.type === 9 ? head.components[0].content : head.content;
};

// ── 7. 버튼 ────────────────────────────────────────────────
console.log("\n=== 7. 버튼 ===");
{
  const client = makeClient();
  const { session } = await open(client, { mode: race.MODE.count, target: 2 });

  const panel = client.messages.get(String(session.messageId ?? "")).payload;
  const rows = panel.components[0].toJSON().components.filter((c) => c.type === 1);

  assert("판에 버튼이 붙음", rows.length === 1, JSON.stringify(rows));
  assert(
    "  └ customId 가 판을 가리킴",
    rows[0].components[0].custom_id === `firstcome:press:${session.id}`,
    rows[0].components[0].custom_id,
  );
  const head = bodyOf(panel).split("\n")[0];
  assert("  └ 제목이 「선착순 2명」", head === "### 선착순 2명 — 시작", head);
  assert("  └ 도는 동안 눌린 순서는 안 보임", !bodyOf(panel).includes("눌린 순서"), bodyOf(panel));

  // 다 차면 버튼이 사라진다 — 눌러도 아무 일 없는 버튼을 남기지 않는다.
  race.press(session.id, P(1));
  race.press(session.id, P(2));

  const closed = views.startedView(firstcome, session, host);
  assert("다 차면 버튼이 사라짐", (closed.rows ?? []).length === 0, JSON.stringify(closed.rows));

  race.dropRace(session.id);
  await store.dropSession(G, session.id);
}

// ── 8. 시간이 다 됐을 때 ───────────────────────────────────
console.log("\n=== 8. 시간 만료 ===");
{
  const client = makeClient();
  const { session } = await open(client, {
    mode: race.MODE.count,
    target: 5,
    seconds: 1,
    channelId: "888888888888888881",
  });

  race.press(session.id, P(1));
  race.press(session.id, P(2));

  await new Promise((done) => setTimeout(done, 1400));

  assert("스스로 끝남", (await store.getSession(G, session.id)) === undefined);

  const result = bodyOf(client.sent.at(-1).payload);
  assert("  └ 덜 찼어도 누른 사람이 가져감", result.includes(`<@${P(1)}>`) && result.includes(`<@${P(2)}>`), result);
  assert("  └ n명은 눌린 순서를 안 남김", !result.includes("**눌린 순서**"), result);
  assert("  └ 참가자 칸도 따로 안 붙음", !result.includes("참가한 사람"), result);
  assert("  └ 제목에도 목표가", result.includes("선착순 5명"), result.split("\n")[0]);
  assert("  └ 파랑 (알림)", client.sent.at(-1).payload.components[0].toJSON().accent_color === 0x5865f2);
}
{
  // n번째는 그 자리에 못 닿으면 이긴 사람이 없다.
  const client = makeClient();
  const { session } = await open(client, {
    mode: race.MODE.nth,
    target: 5,
    seconds: 1,
    channelId: "888888888888888882",
  });

  race.press(session.id, P(1));
  await new Promise((done) => setTimeout(done, 1400));

  const result = bodyOf(client.sent.at(-1).payload);
  assert("n번째에 못 닿으면 이긴 사람 없음", result.includes(speak("아무도 채우지 못했습니다")), result);
  assert("  └ n번째는 눌린 순서를 남김", result.includes("**눌린 순서**"), result);
}

// ── 9. 제목 ────────────────────────────────────────────────
console.log("\n=== 9. 제목 ===");
{
  const client = makeClient();
  const { session } = await open(client, {
    mode: race.MODE.count,
    target: 1,
    title: "보상은 소원권 1개",
    channelId: "888888888888888883",
  });

  const head = bodyOf(client.messages.get(String(session.messageId ?? "")).payload).split("\n")[0];
  assert(
    "제목이 「제목 (선착순 1명)」",
    head === "### 보상은 소원권 1개 (선착순 1명) — 시작",
    head,
  );

  race.dropRace(session.id);
  await store.dropSession(G, session.id);
}

// ── 10. 소스 ───────────────────────────────────────────────
console.log("\n=== 10. 소스 ===");
const gameSource = read("src/games/list/firstcome.ts");
const buttonSource = read("src/components/firstcome.ts");

assert(
  "자리를 잡는 것은 동기로",
  /export function press\([\s\S]{0,600}pressed\.push/u.test(gameSource) && !/export async function press/u.test(gameSource),
  "await 가 끼면 그 틈에 같은 자리를 두 사람이 가져간다",
);
assert("끝난 판에는 버튼을 안 남김", gameSource.includes("race.done) return []"));
assert(
  "눌린 순서는 결과에만",
  !gameSource.includes("pressBoard") || gameSource.indexOf("pressField") > gameSource.indexOf("pressBoard"),
);
assert(
  "  └ 누를 때는 화면을 안 고침",
  buttonSource.includes("화면은 건드리지 않는다"),
  "도는 동안 순위표를 띄우면 눈치를 보게 된다",
);
assert(
  "다 찼을 때만 화면을 갈아 끼움 (버튼을 떼려고)",
  buttonSource.includes("if (!result.filled)") && buttonSource.includes("interaction.update("),
);
assert("  └ 누른 사람에게는 몇 번째인지 알림", buttonSource.includes("번째**로 누르셨습니다"));
assert("누른 사람은 참가자로도 남김", buttonSource.includes("context.join(interaction.user.id)"));
assert("제목 칸은 형식이 준 것", read("src/commands/firstcome.ts").includes("titleOption"));

process.chdir(PROJECT);
finish();
