// /국민투표 검증 — 공약을 내야 참가 · 후보마다 버튼 · 자기 표 금지 · 개표.
//
// 참가 형식이지만 참가하는 방법이 다르다. 「참가」가 모달을 띄우고, **제출한 사람만**
// 후보가 된다. 그 길을 골격과 게임이 나눠 맡으므로 이음매를 함께 본다.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish, speak } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const sandbox = mkdtempSync(path.join(tmpdir(), "vote-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const registry = await import(`${DIST}/games/registry.js`);
const runner = await import(`${DIST}/games/runner.js`);
const store = await import(`${DIST}/games/store.js`);
const views = await import(`${DIST}/games/views.js`);
const poll = await import(`${DIST}/games/list/vote.js`);
const vote = poll.default;
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
const labelsOf = (view) =>
  buildContainer(view)
    .toJSON()
    .components.filter((component) => component.type === 1)
    .flatMap((row) => row.components.map((button) => button.label));

/** 판 하나를 열고 후보를 세운다. */
function makeSession(over = {}) {
  return {
    id: "aaaa1111",
    gameId: "vote",
    guildId: G,
    channelId: CH,
    title: null,
    name: null,
    body: null,
    maxPlayers: 3,
    messageId: "m",
    hostId: HOST,
    players: [],
    phase: "recruiting",
    openedAt: Date.now(),
    playSeconds: 300,
    closesAt: Date.now() + 300_000,
    ...over,
  };
}

// ── 1. 커맨드 ──────────────────────────────────────────────
console.log("\n=== 1. 커맨드 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const command = (await collectCommands()).find((c) => c.data.name === "국민투표");

assert("/국민투표 등록됨", command !== undefined);

const json = command.data.toJSON();
const options = json.options ?? [];

assert(
  "옵션은 참가인원·기간·제목·자기투표",
  options.map((o) => o.name).join(",") === "참가인원,기간,제목,자기투표",
  options.map((o) => o.name).join(","),
);
assert("  └ 참가인원은 필수 정수", options[0]?.required === true && options[0]?.type === 4);
assert(
  `  └ ${poll.MIN_CANDIDATES}~${poll.MAX_CANDIDATES} 로 막아 둠`,
  options[0]?.min_value === poll.MIN_CANDIDATES && options[0]?.max_value === poll.MAX_CANDIDATES,
  `${options[0]?.min_value}~${options[0]?.max_value}`,
);
assert("  └ 기간도 필수", options[1]?.required === true && options[1]?.type === 3);
assert("  └ 제목은 선택 (형식이 정한 칸)", options[2]?.required !== true);
assert("  └ 자기투표는 선택 (기본은 못 찍음)", options[3]?.required !== true && options[3]?.type === 5);
assert("  └ 서버 전용", JSON.stringify(json.contexts) === "[0]");

// ── 2. 형식 ────────────────────────────────────────────────
console.log("\n=== 2. 형식 ===");
assert("참가 형식", vote.mode === "recruit", vote.mode);
assert(`  └ 최소 ${poll.MIN_CANDIDATES}명`, vote.minPlayers === poll.MIN_CANDIDATES);
assert("  └ 정원은 판이 정함", vote.maxPlayers === null);
assert("  └ 열 명까지", poll.MAX_CANDIDATES === 10, String(poll.MAX_CANDIDATES));
assert("목록에서 자동으로 잡힘", registry.getGame("vote") !== undefined);

// ── 3. 참가는 모달로 ───────────────────────────────────────
//
// 「참가」를 누르면 공약 모달이 뜬다. 제출해야 후보가 된다 — 적다 만 사람은 참가가 아니다.
console.log("\n=== 3. 참가는 모달로 ===");
{
  assert("게임이 참가 모달을 준다", typeof vote.joinModal === "function");

  const modal = vote.joinModal(makeSession()).toJSON();
  assert("  └ customId 가 판을 가리킴", modal.custom_id === "vote:pledge:aaaa1111", modal.custom_id);

  const field = modal.components[0];
  assert("  └ 칸은 공약 하나", modal.components.length === 1 && field.label === "공약", String(modal.components.length));
  assert("    · 선택 칸 (안 적어도 출마)", field.component.required === false);
  assert("    · 여러 줄", field.component.style === 2, String(field.component.style));
  assert(
    `    · ${poll.MAX_PLEDGE_LENGTH}자까지`,
    field.component.max_length === poll.MAX_PLEDGE_LENGTH,
    String(field.component.max_length),
  );

  // 골격은 모달을 띄우기만 하고, 참가는 게임의 모달 핸들러가 시킨다.
  const handler = read("src/components/game.ts");
  assert("골격이 모달을 대신 띄움", handler.includes("if (game.joinModal !== undefined)"));
  assert("  └ 띄우고 곧바로 빠짐", handler.includes("await interaction.showModal(game.joinModal(session))"));
  assert(
    "  └ 참가는 게임 쪽에서",
    read("src/components/vote.ts").includes("await join(interaction.guildId, sessionId, interaction.user.id)"),
  );
  assert(
    "  └ 다시 내면 공약만 바뀜",
    read("src/components/vote.ts").includes("이미 나온 사람이 다시 내면"),
  );
}

// ── 4. 공약 ────────────────────────────────────────────────
console.log("\n=== 4. 공약 ===");
{
  const S = "bbbb2222";
  poll.keepPoll(S);

  assert("아무도 없으면 내용이 없음", poll.pledgeBoard(S) === null);

  poll.addCandidate(S, { userId: P(1), name: "가", pledge: "소원권을 나눠 드리겠습니다" });
  poll.addCandidate(S, { userId: P(2), name: "나", pledge: null });

  const board = poll.pledgeBoard(S);
  assert("후보를 멘션으로", board.includes(`<@${P(1)}>`) && board.includes(`<@${P(2)}>`), board);
  assert("  └ 적은 공약 그대로", board.includes("소원권을 나눠 드리겠습니다"), board);
  assert("  └ 안 적었으면 그렇게", board.includes(speak("_공약 없이 나왔습니다._")), board);

  // 한 사람이 두 줄을 쓴다 — 이름과 몇 명이 한 줄, 공약이 그 아래 인용으로. 사이를 띄운다.
  const lines = board.split("\n");
  assert("이름 옆에 몇 명이 찍었는지", /^<@\d+> - `0명`$/u.test(lines[0]), JSON.stringify(lines[0]));
  assert("  └ 공약은 그 아래 인용으로", lines[1] === "> 소원권을 나눠 드리겠습니다", JSON.stringify(lines[1]));
  assert("  └ 사람 사이만 한 줄 띄움", lines[2] === "" && lines[3].startsWith(`<@${P(2)}>`), JSON.stringify(lines.slice(2, 4)));
  assert("    · 그보다 더 띄우지 않음", !board.includes(`\n\n\n`), JSON.stringify(board));
  assert(
    "  └ 한 줄에 이름과 공약을 붙이지 않음",
    !lines[0].includes("소원권을 나눠"),
    "공약이 길면 어디까지가 누구 것인지 눈이 못 따라간다",
  );

  // 다시 내면 공약만 바뀐다 — 후보가 둘로 늘지 않는다.
  poll.addCandidate(S, { userId: P(1), name: "가", pledge: "바꾼 공약" });
  assert("다시 내면 공약만 바뀜", poll.pollOf(S).candidates.length === 2, String(poll.pollOf(S).candidates.length));
  assert("  └ 바뀐 것이 보임", poll.pledgeBoard(S).includes("> 바꾼 공약"));

  // 몇 명이 찍었는지는 누르는 즉시 바뀐다. 누가 찍었는지는 끝까지 안 나온다.
  poll.castVote(S, "999", P(1));
  assert("찍으면 그 자리에서 늘어남", poll.pledgeBoard(S).includes(`<@${P(1)}> - \`1명\``), poll.pledgeBoard(S));
  assert("  └ 안 받은 사람은 0명", poll.pledgeBoard(S).includes(`<@${P(2)}> - \`0명\``), poll.pledgeBoard(S));
  assert("  └ 누가 찍었는지는 안 나옴", !poll.pledgeBoard(S).includes("999"), poll.pledgeBoard(S));

  // 모으는 동안에는 형식이 정한 모집 패널 그대로다 — 그때 볼 것은 누가 들어왔나와
  // 몇 명 남았나이고, 그건 골격이 이미 적는다.
  const recruiting = bodyOf(views.recruitView(vote, makeSession({ id: S, players: [P(1), P(2)] }), host));
  assert("모집 중에는 기본 형식 그대로", recruiting.includes(vote.description), recruiting);
  assert("  └ 공약 목록은 아직 안 나옴", !recruiting.includes(`<@${P(1)}> - \``), recruiting);
  assert("  └ 참가한 사람 칸은 있음", recruiting.includes("참가한 사람"), recruiting);

  const playing = bodyOf(views.startedView(vote, makeSession({ id: S, phase: "playing", players: [P(1), P(2)] }), host));
  assert("시작하면 후보 목록으로 바뀜", playing.includes(`<@${P(1)}> - \``), playing);
  assert("  └ 게임 설명은 사라짐", !playing.includes(vote.description), playing);

  poll.dropPoll(S);
}

// ── 5. 자기 자신은 못 찍는다 (풀 수는 있다) ────────────────
console.log("\n=== 5. 자기 자신은 못 찍는다 ===");
{
  const S = "cccc3333";
  poll.keepPoll(S);
  poll.addCandidate(S, { userId: P(1), name: "가", pledge: null });
  poll.addCandidate(S, { userId: P(2), name: "나", pledge: null });

  assert("자기 표는 막힘", poll.castVote(S, P(1), P(1)).reason === "self");
  assert("  └ 남에게는 됨", poll.castVote(S, P(1), P(2)).ok === true);
  assert("후보가 아닌 사람도 찍을 수 있음", poll.castVote(S, "999", P(1)).ok === true);
  assert("없는 후보는 막힘", poll.castVote(S, "999", "888").reason === "unknown");
  assert("없는 판도 막힘", poll.castVote("없음", "999", P(1)).reason === "gone");

  // 한 사람은 한 표. 바꿔 찍으면 옮겨 가고, 같은 사람을 다시 찍으면 그대로다.
  assert("바꿔 찍기", poll.castVote(S, "999", P(2)).changed === true);
  assert("  └ 같은 사람을 다시 찍으면 그대로", poll.castVote(S, "999", P(2)).changed === false);
  assert(
    "  └ 표가 옮겨 감",
    poll.tally(poll.pollOf(S)).find((e) => e.candidate.userId === P(1)).votes === 0,
    JSON.stringify(poll.tally(poll.pollOf(S)).map((e) => e.votes)),
  );

  // 빠지면 받은 표도 함께 사라진다.
  poll.removeCandidate(S, P(2));
  assert("빠지면 후보에서 사라짐", poll.pollOf(S).candidates.length === 1);
  assert("  └ 그 사람에게 간 표도", poll.pollOf(S).votes.size === 0, String(poll.pollOf(S).votes.size));

  poll.dropPoll(S);

  // 「자기투표」 를 켠 판에서는 풀린다. 판을 열 때 정하고 도중에 바뀌지 않는다.
  const OPEN = "cccc4444";
  poll.keepPoll(OPEN, { selfVote: true });
  poll.addCandidate(OPEN, { userId: P(1), name: "가", pledge: null });
  poll.addCandidate(OPEN, { userId: P(2), name: "나", pledge: null });

  assert("켜 두면 자기 표도 됨", poll.castVote(OPEN, P(1), P(1)).ok === true);
  assert("  └ 제 몫으로 셈", poll.tally(poll.pollOf(OPEN))[0].votes === 1, poll.pledgeBoard(OPEN));
  assert("  └ 없는 후보는 그래도 막힘", poll.castVote(OPEN, P(1), "888").reason === "unknown");

  poll.dropPoll(OPEN);
}

// ── 6. 후보마다 버튼 ───────────────────────────────────────
console.log("\n=== 6. 후보마다 버튼 ===");
{
  const S = "aaaa1111";
  poll.keepPoll(S);
  for (let index = 1; index <= 7; index += 1) {
    poll.addCandidate(S, { userId: P(index), name: `후보${index}`, pledge: null });
  }

  const playing = makeSession({ phase: "playing", players: Array.from({ length: 7 }, (_, i) => P(i + 1)) });
  const labels = labelsOf(views.startedView(vote, playing, host));

  assert("후보 수만큼 버튼", labels.length === 7, labels.join(","));
  assert("  └ 이름이 버튼에", labels[0] === "후보1", labels[0]);

  // 한 줄에 다섯 개까지 — 디스코드가 정한 값이다.
  const rows = buildContainer(views.startedView(vote, playing, host))
    .toJSON()
    .components.filter((component) => component.type === 1);
  assert("  └ 다섯씩 나눠 담음", rows.every((row) => row.components.length <= 5), JSON.stringify(rows.map((r) => r.components.length)));

  // 모집 중에는 투표 버튼이 없다 — 아직 겨룰 때가 아니다.
  assert("모집 중에는 투표 버튼 없음", vote.buttons(makeSession()).length === 0);
  assert("  └ 끝난 판에도 없음", vote.buttons(makeSession({ phase: "ended" })).length === 0);

  poll.dropPoll(S);
}

// ── 7. 개표 ────────────────────────────────────────────────
console.log("\n=== 7. 개표 ===");
{
  const S = "dddd4444";
  poll.keepPoll(S);
  poll.addCandidate(S, { userId: P(1), name: "가", pledge: null });
  poll.addCandidate(S, { userId: P(2), name: "나", pledge: "출헉을 대신 해 드리겠습니다" });
  poll.addCandidate(S, { userId: P(3), name: "다", pledge: null });

  assert("아무도 안 찍었으면 당선자 없음", poll.winnersOf(poll.pollOf(S)).length === 0);

  poll.castVote(S, "901", P(2));
  poll.castVote(S, "902", P(2));
  poll.castVote(S, "903", P(1));

  const winners = poll.winnersOf(poll.pollOf(S));
  assert("가장 많이 받은 사람", winners.length === 1 && winners[0].userId === P(2), JSON.stringify(winners));

  const board = poll.resultBoard(poll.pollOf(S));
  assert("많이 받은 순", board.split("\n\n")[0].includes(P(2)), board);
  assert("  └ 0표도 적음", board.includes("`0표`"), board);
  assert("  └ 표는 칸으로 감쌈", board.includes("`2표`"), board);
  // 끝난 뒤에도 무엇을 걸고 나왔는지 함께 편다 — 표만 남으면 왜 그렇게 됐는지가 사라진다.
  assert("  └ 공약도 함께", board.includes("> 출헉을 대신 해 드리겠습니다"), board);
  assert("    · 안 적은 사람도 자리는 있음", board.includes(`> ${speak("_공약 없이 나왔습니다._")}`), board);
  assert("    · 도는 동안과 같은 모양", /^<@\d+> - `2표`$/u.test(board.split("\n")[0]), JSON.stringify(board.split("\n")[0]));

  // 같으면 여럿이 나란히 1위다.
  poll.castVote(S, "904", P(1));
  const tied = poll.winnersOf(poll.pollOf(S));
  assert("같은 표면 나란히", tied.length === 2, JSON.stringify(tied.map((c) => c.userId)));

  poll.dropPoll(S);
}

// ── 8. 기간은 시작한 뒤에 흐른다 ───────────────────────────
//
// 모집 게임은 언제 시작될지 모른다. 기간을 들고 있다가 시작하는 순간 시계를 건다.
console.log("\n=== 8. 기간은 시작한 뒤에 ===");
{
  const client = makeClient();
  const opened = await runner.openGame(vote, G, CH, host, {
    maxPlayers: 2,
    durationSeconds: 300,
    prepare: poll.keepPoll,
  });
  const message = await client.makeChannel(CH).send(channelMessage(opened.view));
  await runner.attach(client, vote, opened.session, message, host);

  const recruiting = await store.getSession(G, opened.session.id);
  assert("기간을 들고 있음", recruiting.playSeconds === 300, String(recruiting.playSeconds));
  assert(
    "  └ 모집 중 마감은 5분",
    Math.abs(recruiting.closesAt - Date.now() - 5 * 60 * 1000) < 2000,
    String(recruiting.closesAt - Date.now()),
  );

  await runner.join(G, opened.session.id, P(1));
  await runner.join(G, opened.session.id, P(2));
  poll.addCandidate(opened.session.id, { userId: P(1), name: "가", pledge: null });
  poll.addCandidate(opened.session.id, { userId: P(2), name: "나", pledge: null });

  await runner.startNow(client, G, opened.session.id, host);

  const playing = await store.getSession(G, opened.session.id);
  assert("시작하면 그 기간으로 시계를 걺", playing.phase === "playing", playing.phase);
  assert(
    "  └ 이제부터 5분이 아니라 적은 기간",
    Math.abs(playing.closesAt - Date.now() - 300 * 1000) < 2000,
    String(playing.closesAt - Date.now()),
  );

  await runner.stopGame(client, G, opened.session.id, host, HOST);
  poll.dropPoll(opened.session.id);
}

// ── 9. 몇 명인지는 뜨고, 누구인지는 안 뜬다 ────────────────
console.log("\n=== 9. 몇 명인지는 뜨고, 누구인지는 안 뜬다 ===");
{
  const source = read("src/components/vote.ts");

  assert("누른 사람에게만 답함", source.includes("noticeView"));
  assert(
    "  └ 표가 옮겨 가면 판 화면을 고침",
    source.includes("refreshPanel(interaction.client, running.context.session, running.context.host)"),
  );
  assert("    · 같은 사람을 다시 눌렀으면 그대로", source.includes("if (result.changed)"));
  assert(
    "  └ 도는 판도 다시 그릴 수 있음",
    read("src/games/runner.ts").includes('if (session.phase === "playing")'),
    "refreshPanel 이 모집 중에만 그리면 표가 멈춰 보인다",
  );
  assert("공약 상태는 메모리에만", !read("src/games/list/vote.ts").includes("JsonFile"));
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
