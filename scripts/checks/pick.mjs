// /찍기대작전 검증 — 숫자를 찍고 · 정답이 나오고 · 같은 것을 찍은 사람이 이긴다.
//
// 방식이 둘이라 여는 길도 둘이다 (선택은 곧바로, 랜덤은 모달로). 그 갈림길과,
// 도는 동안 찍은 것이 새지 않는지를 함께 본다.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish, speak } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const sandbox = mkdtempSync(path.join(tmpdir(), "pick-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const registry = await import(`${DIST}/games/registry.js`);
const runner = await import(`${DIST}/games/runner.js`);
const store = await import(`${DIST}/games/store.js`);
const views = await import(`${DIST}/games/views.js`);
const game = await import(`${DIST}/games/list/pick.js`);
const pick = game.default;
const { buildContainer, channelMessage } = await import(`${DIST}/ui/response.js`);

await registry.loadGames();

const G = "111111111111111111";
const CH = "222222222222222222";
const HOST = "333333333333333333";
const P = (n) => `44444444444444${String(1000 + n).slice(1)}`;

const host = { id: HOST, username: "주최자" };

const bodyOf = (view) => {
  const head = buildContainer(view).toJSON().components[0];
  return head.type === 9 ? head.components[0].content : head.content;
};
const rowsOf = (view) =>
  buildContainer(view)
    .toJSON()
    .components.filter((component) => component.type === 1);
const labelsOf = (view) => rowsOf(view).flatMap((row) => row.components.map((button) => button.label));

function makeSession(over = {}) {
  return {
    id: "aaaa1111",
    gameId: "pick",
    guildId: G,
    channelId: CH,
    title: null,
    name: game.roundName(6),
    body: game.pickBody(game.MODE.choice, HOST),
    maxPlayers: null,
    messageId: "m",
    hostId: HOST,
    players: [],
    phase: "playing",
    openedAt: Date.now(),
    playSeconds: game.CHOICE_SECONDS,
    closesAt: Date.now() + game.CHOICE_SECONDS * 1000,
    ...over,
  };
}

// ── 1. 커맨드 ──────────────────────────────────────────────
console.log("\n=== 1. 커맨드 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const command = (await collectCommands()).find((c) => c.data.name === "찍기대작전");

assert("/찍기대작전 등록됨", command !== undefined);

const json = command.data.toJSON();
const options = json.options ?? [];

assert(
  "옵션은 선택지수·형식·제목",
  options.map((o) => o.name).join(",") === "선택지수,형식,제목",
  options.map((o) => o.name).join(","),
);
assert("  └ 선택지수는 필수 정수", options[0]?.required === true && options[0]?.type === 4);
assert(
  `  └ ${game.MIN_CHOICES}~${game.MAX_CHOICES} 로 막아 둠`,
  options[0]?.min_value === game.MIN_CHOICES && options[0]?.max_value === game.MAX_CHOICES,
  `${options[0]?.min_value}~${options[0]?.max_value}`,
);
assert("  └ 형식은 선택 (비우면 선택 방식)", options[1]?.required !== true);
assert(
  "    · 고를 수 있는 것은 둘뿐",
  (options[1]?.choices ?? []).map((c) => c.value).join(",") === "choice,random",
  JSON.stringify((options[1]?.choices ?? []).map((c) => c.value)),
);
assert("  └ 제목은 선택 (형식이 정한 칸)", options[2]?.required !== true);
assert("  └ 기간 옵션은 없음", !options.some((o) => o.name === "기간"), "랜덤만 쓰는 값이라 모달로 받는다");
assert("  └ 서버 전용", JSON.stringify(json.contexts) === "[0]");

// ── 2. 형식 ────────────────────────────────────────────────
console.log("\n=== 2. 형식 ===");
assert("즉시 시작 형식", pick.mode === "instant", pick.mode);
assert("목록에서 자동으로 잡힘", registry.getGame("pick") !== undefined);
assert("방식은 선택·랜덤 둘", Object.keys(game.MODE).join(",") === "choice,random");
assert("  └ 아무 글자나 방식이 되지는 않음", !game.isPickMode("몰라") && game.isPickMode("random"));

// ── 3. 찍기 ────────────────────────────────────────────────
console.log("\n=== 3. 찍기 ===");
{
  const S = "bbbb2222";
  game.keepPick(S, game.MODE.choice, 6);

  const first = game.choose(S, P(1), 3);
  assert("찍힘", first.ok === true && first.changed === true);
  assert("  └ 처음이면 전에 찍은 것이 없음", first.before === undefined, String(first.before));

  const again = game.choose(S, P(1), 5);
  assert("바꿔 찍기", again.ok === true && again.changed === true);
  assert("  └ 무엇에서 바뀌었는지 알려 줌", again.before === 3, String(again.before));
  assert("  └ 같은 것을 다시 찍으면 그대로", game.choose(S, P(1), 5).changed === false);
  assert("  └ 사람이 늘지는 않음", game.pickOf(S).picks.size === 1, String(game.pickOf(S).picks.size));

  assert("없는 숫자는 막힘", game.choose(S, P(2), 7).reason === "unknown");
  assert("  └ 0번도 없음", game.choose(S, P(2), 0).reason === "unknown");
  assert("없는 판도 막힘", game.choose("없음", P(2), 1).reason === "gone");

  game.dropPick(S);
}

// ── 4. 개봉 ────────────────────────────────────────────────
console.log("\n=== 4. 개봉 ===");
{
  const S = "cccc3333";
  game.keepPick(S, game.MODE.random, 6);
  game.choose(S, P(1), 3);
  game.choose(S, P(2), 3);
  game.choose(S, P(3), 5);

  const round = game.pickOf(S);
  const board = game.pickBoard(round);

  // 찍은 것은 끝난 뒤에만 편다 — 도는 동안 보이면 고르는 사람이 그걸 보고 고른다.
  assert("숫자별로 묶음", board.includes(`\`3번\` <@${P(1)}> <@${P(2)}>`), JSON.stringify(board));
  assert("  └ 숫자 순으로", board.split("\n")[0].startsWith("`3번`"), board);
  assert("  └ 아무도 안 찍은 숫자는 안 적음", !board.includes("`1번`"), board);
  assert("  └ 한 줄에 한 숫자", board.split("\n").length === 2, board);

  const winners = game.reveal(S, 3);
  assert("같은 것을 찍은 사람이 전부 이김", winners.join(",") === `${P(1)},${P(2)}`, winners.join(","));
  assert("  └ 개봉하면 닫힘", game.pickOf(S).done === true);
  assert("  └ 닫히면 더 못 찍음", game.choose(S, P(4), 3).reason === "closed");
  assert("아무도 못 맞히면 빈 배열", game.reveal(S, 1).length === 0);

  assert("아무도 안 찍었으면 칸을 안 만듦", game.pickField({ picks: new Map() }).length === 0);
  assert("  └ 찍었으면 만듦", game.pickField(round)[0].name === "찍은 것");

  game.dropPick(S);

  // 봇이 고르는 값은 1 부터 선택지 수까지다.
  const rolled = new Set(Array.from({ length: 400 }, () => game.rollAnswer(4)));
  assert("봇은 1~n 중에서 고름", [...rolled].every((n) => n >= 1 && n <= 4), [...rolled].join(","));
  assert("  └ 한 숫자에 붙어 있지 않음", rolled.size === 4, [...rolled].sort().join(","));
}

// ── 5. 선택 방식은 연 사람이 고른다 ────────────────────────
//
// 연 사람이 누르는 숫자는 찍는 것이 아니라 **정답**이다. 그래서 그 사람은 찍을 수 없다.
console.log("\n=== 5. 선택 방식은 연 사람이 고른다 ===");
{
  const source = read("src/components/pick.ts");

  assert(
    "연 사람의 누름은 개봉으로 감",
    source.includes("round.mode === MODE.choice && interaction.user.id === context.session.hostId"),
  );
  assert("  └ 그 자리에서 판을 끝냄", source.includes("await context.end({"));
  assert("  └ 버튼부터 뗌", source.includes("await interaction.update(updateResponse(startedView(pick"));
  assert(
    "  └ 랜덤에서는 연 사람도 그냥 찍음",
    source.includes("round.mode === MODE.choice &&"),
    "방식을 함께 보지 않으면 랜덤 판에서 연 사람이 찍을 수 없게 된다",
  );

  assert(
    "찍은 것은 누른 사람에게만",
    source.includes("판 화면은 건드리지 않는다"),
    "도는 동안 보이면 고르는 사람이 그걸 보고 고른다",
  );
  assert("찍은 것은 메모리에만", !read("src/games/list/pick.ts").includes("JsonFile"));
}

// ── 6. 랜덤은 모달로 기간을 받는다 ─────────────────────────
console.log("\n=== 6. 랜덤은 모달로 기간을 받는다 ===");
{
  const modal = game.durationModal(6, "보상은 소원권 1개").toJSON();

  assert("customId 에 선택지 수를 실음", modal.custom_id.startsWith("pick:open:6:"), modal.custom_id);
  assert("  └ 제목도 함께", modal.custom_id.endsWith(":보상은 소원권 1개"), modal.custom_id);
  assert("  └ 100자 제한 안", game.durationModal(20, "가".repeat(60)).toJSON().custom_id.length < 100);
  assert("  └ 제목이 없으면 빈 자리", game.durationModal(6, null).toJSON().custom_id === "pick:open:6:");

  const field = modal.components[0];
  assert("칸은 기간 하나", modal.components.length === 1 && field.label === "기간", String(modal.components.length));
  assert("  └ 반드시 적어야 함", field.component.required === true);
  assert("  └ 한 줄", field.component.style === 1, String(field.component.style));

  // 제목에 콜론이 있어도 잘리지 않는다 — 뒤쪽을 통째로 잇는다.
  assert(
    "제목의 콜론을 잘라 먹지 않음",
    read("src/components/pick.ts").includes('args.slice(2).join(":")'),
  );

  // 커맨드는 랜덤일 때만 모달을 띄운다.
  const source = read("src/commands/pick.ts");
  assert("랜덤이면 모달", source.includes("if (mode === MODE.random)") && source.includes("interaction.showModal(durationModal("));
  assert("  └ 선택이면 곧바로 판", source.includes("await openGameHere(interaction, pick, {"));
  assert("  └ 비우면 선택 방식", source.includes("isPickMode(raw ?? undefined) ? raw : MODE.choice"));
}

// ── 7. 숫자 버튼 ───────────────────────────────────────────
console.log("\n=== 7. 숫자 버튼 ===");
{
  const S = "aaaa1111";
  game.keepPick(S, game.MODE.choice, 20);

  const view = views.startedView(pick, makeSession({ name: game.roundName(20) }), host);
  const labels = labelsOf(view);

  assert("선택지 수만큼 버튼", labels.length === 20, String(labels.length));
  assert("  └ 1 부터 세어 감", labels[0] === "1" && labels[19] === "20", `${labels[0]}…${labels[19]}`);
  assert(
    "  └ 다섯씩 나눠 담음",
    rowsOf(view).every((row) => row.components.length <= 5),
    JSON.stringify(rowsOf(view).map((r) => r.components.length)),
  );
  assert("  └ 스물이면 네 줄", rowsOf(view).length === 4, String(rowsOf(view).length));

  // 끝난 판에는 버튼을 남기지 않는다 — 눌러도 아무 일이 없으면 헷갈린다.
  game.reveal(S, 1);
  assert("개봉하면 버튼이 사라짐", labelsOf(views.startedView(pick, makeSession(), host)).length === 0);

  game.dropPick(S);
  assert("판을 잃어버렸어도 버튼은 없음", pick.buttons(makeSession()).length === 0);
}

// ── 8. 화면 ────────────────────────────────────────────────
console.log("\n=== 8. 화면 ===");
{
  const S = "dddd4444";
  game.keepPick(S, game.MODE.choice, 6);

  // 몇 중에 하나였는지는 제목에 싣는다 — 버튼은 끝나면서 사라진다.
  assert("제목에 범위가 실림", game.roundName(6) === "찍기대작전 1~6", game.roundName(6));

  const body = bodyOf(views.startedView(pick, makeSession({ id: S }), host));
  assert("  └ 화면 제목에도 그대로", body.includes("찍기대작전 1~6 — 시작"), body);

  // 제목 다음 덩어리가 게임이 적는 내용이다 (그 아래는 종료 시각 칸).
  const line = body.split("\n\n")[1];
  assert("선택이면 연 사람을 멘션으로", line.includes(`<@${HOST}>`), line);
  assert("  └ 몇 개인지는 다시 안 적음", !line.includes("6"), "제목과 버튼이 이미 말한다");

  const random = bodyOf(
    views.startedView(pick, makeSession({ id: S, body: game.pickBody(game.MODE.random, HOST) }), host),
  );
  assert("랜덤이면 봇이 고른다고", random.includes("봇") && !random.includes(`<@${HOST}>`), random);

  game.dropPick(S);
}

// ── 9. 시계 ────────────────────────────────────────────────
//
// 즉시 시작이라 여는 순간부터 시계가 돈다. 선택은 방치 방지용 10분, 랜덤은 적은 기간.
console.log("\n=== 9. 시계 ===");
{
  const client = makeClient();

  assert("선택은 10분을 기다림", game.CHOICE_SECONDS === 10 * 60, String(game.CHOICE_SECONDS));

  const opened = await runner.openGame(pick, G, CH, host, {
    name: game.roundName(4),
    body: game.pickBody(game.MODE.choice, HOST),
    durationSeconds: game.CHOICE_SECONDS,
    prepare: (sessionId) => {
      game.keepPick(sessionId, game.MODE.choice, 4);
    },
  });
  const message = await client.makeChannel(CH).send(channelMessage(opened.view));
  await runner.attach(client, pick, opened.session, message, host);

  const playing = await store.getSession(G, opened.session.id);
  assert("열자마자 도는 중", playing.phase === "playing", playing.phase);
  assert(
    "  └ 그때부터 시계가 돎",
    Math.abs(playing.closesAt - Date.now() - game.CHOICE_SECONDS * 1000) < 2000,
    String(playing.closesAt - Date.now()),
  );
  assert("  └ 여는 순간 버튼이 붙음", labelsOf(opened.view).length === 4, String(labelsOf(opened.view).length));
  assert("  └ 아무도 자동으로 참가하지 않음", playing.players.length === 0, JSON.stringify(playing.players));

  await runner.stopGame(client, G, opened.session.id, host, HOST);
  game.dropPick(opened.session.id);
}

finish();

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
