// /룰렛 검증 — 참가 형식 · 판마다 정원 · 회전 · 당첨.
//
// 회전 한 판을 **실제로 끝까지** 돌린다 (12초쯤). 이 게임의 값은 「돌다가 한 명이
// 뽑힌다」 하나뿐이라, 그 길을 흉내로만 덮으면 덮은 것이 없다.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish, speak } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const sandbox = mkdtempSync(path.join(tmpdir(), "roulette-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const registry = await import(`${DIST}/games/registry.js`);
const runner = await import(`${DIST}/games/runner.js`);
const store = await import(`${DIST}/games/store.js`);
const wheel = await import(`${DIST}/games/list/roulette.js`);
const roulette = wheel.default;
const { seatsOf } = await import(`${DIST}/games/types.js`);
const { channelMessage } = await import(`${DIST}/ui/response.js`);

const G = "111111111111111111";
const CH = "222222222222222222";
const HOST = "333333333333333333";
const P = (n) => `44444444444444${String(1000 + n).slice(1)}`;

const host = { id: HOST, username: "주최자" };

await registry.loadGames();

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
        edits: [],
        edit: async (next) => {
          message.payload = next;
          message.edits.push(next);
        },
        reply: async (next) => {
          sent.push({ payload: next, replyTo: messageId });
          return { id: String((nextId += 1)), payload: next, edit: async () => {} };
        },
      };
      messages.set(messageId, message);
      sent.push({ payload });
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

/** 판을 열고 메시지를 붙인다 — 커맨드가 하는 일. */
async function open(client, { seats, channelId = CH, title = null }) {
  const opened = await runner.openGame(roulette, G, channelId, host, { title, maxPlayers: seats });
  if (!opened.ok) return opened;

  const message = await client.makeChannel(channelId).send(channelMessage(opened.view));
  await runner.attach(client, roulette, opened.session, message, host);

  return { ...opened, message };
}

const bodyOf = (payload) => JSON.stringify(payload);

// ── 1. 커맨드 ──────────────────────────────────────────────
console.log("\n=== 1. 커맨드 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const command = (await collectCommands()).find((c) => c.data.name === "룰렛");

assert("/룰렛 등록됨", command !== undefined);

const json = command.data.toJSON();
const options = json.options ?? [];

assert(
  "옵션은 참가인원·제목",
  options.map((o) => o.name).join(",") === "참가인원,제목",
  options.map((o) => o.name).join(","),
);
assert("  └ 참가인원은 필수", options[0]?.required === true);
assert("  └ 정수", options[0]?.type === 4, String(options[0]?.type));
assert(
  `  └ ${wheel.MIN_SEATS}~${wheel.MAX_SEATS} 로 막아 둠`,
  options[0]?.min_value === wheel.MIN_SEATS && options[0]?.max_value === wheel.MAX_SEATS,
  `${options[0]?.min_value}~${options[0]?.max_value}`,
);
assert("  └ 제목은 선택 (형식이 정한 칸)", options[1]?.required !== true);
assert("  └ 서버 전용", JSON.stringify(json.contexts) === "[0]", JSON.stringify(json.contexts));
assert("옵션 이름에 공백이 없음", options.every((o) => !o.name.includes(" ")), "디스코드가 거부한다");

// ── 2. 형식 ────────────────────────────────────────────────
console.log("\n=== 2. 형식 ===");
assert("참가 형식", roulette.mode === "recruit", roulette.mode);
assert(`  └ 최소 ${wheel.MIN_SEATS}명`, roulette.minPlayers === wheel.MIN_SEATS);
assert("  └ 정원은 게임이 아니라 판이 정함", roulette.maxPlayers === null);
assert("목록에서 자동으로 잡힘", registry.getGame("roulette") !== undefined);

// ── 3. 자리표 ──────────────────────────────────────────────
//
// 줄 맨 앞의 `>` 는 디스코드에서 **인용문**이 된다. 굵게 싸야 그 일이 없다.
console.log("\n=== 3. 자리표 ===");
{
  const seats = [P(1), P(2), P(3)];
  const drawn = wheel.board(seats, 1);
  const lines = drawn.split("\n");

  assert("한 줄에 한 사람", lines.length === 3, String(lines.length));
  assert("  └ 전부 멘션으로", seats.every((id) => drawn.includes(`<@${id}>`)), drawn);
  assert("표시한 줄은 화살표로 감쌈", lines[1] === `**>** <@${P(2)}> **<**`, lines[1]);
  assert("  └ 나머지는 멘션만", lines[0] === `<@${P(1)}>` && lines[2] === `<@${P(3)}>`, lines[0]);
  assert(
    "  └ 줄 맨 앞이 `>` 가 아님 (인용문이 된다)",
    lines.every((line) => !line.startsWith(">")),
    drawn,
  );
  assert(
    "  └ 코드블록으로 싸지 않음 (멘션이 날것으로 나온다)",
    !drawn.includes("```"),
    drawn,
  );
}

// ── 4. 회전 ────────────────────────────────────────────────
console.log("\n=== 4. 회전 ===");
{
  let landed = true;
  let inRange = true;

  for (let seats = wheel.MIN_SEATS; seats <= wheel.MAX_SEATS; seats += 1) {
    for (let winner = 0; winner < seats; winner += 1) {
      if (wheel.seatAt(wheel.SPIN_FRAMES, seats, winner) !== winner) landed = false;

      for (let frame = 0; frame <= wheel.SPIN_FRAMES; frame += 1) {
        const at = wheel.seatAt(frame, seats, winner);
        if (!Number.isInteger(at) || at < 0 || at >= seats) inRange = false;
      }
    }
  }

  assert("마지막 칸은 언제나 당첨자", landed);
  assert("  └ 중간 칸도 자리 안", inRange);
  assert("  └ 자리가 없어도 안 터짐", wheel.seatAt(3, 0, 0) === 0);

  const delays = Array.from({ length: wheel.SPIN_FRAMES }, (_, k) => wheel.frameDelay(k));
  assert("뒤로 갈수록 느려짐", delays.every((ms, i) => i === 0 || ms > delays[i - 1]), delays.join(","));
  assert(
    "  └ 가장 빠른 칸도 1초 이상 (편집 제한)",
    Math.min(...delays) >= 1000,
    String(Math.min(...delays)),
  );

  // 한 바퀴는 돌아야 룰렛으로 보인다.
  const path5 = Array.from({ length: wheel.SPIN_FRAMES + 1 }, (_, k) => wheel.seatAt(k, 5, 0));
  assert("한 자리에 머무르지 않음", new Set(path5).size > 1, path5.join(","));
}

// ── 5. 자리 섞기 ───────────────────────────────────────────
console.log("\n=== 5. 자리 섞기 ===");
{
  const members = [P(1), P(2), P(3), P(4), P(5), P(6)];
  const orders = new Set();

  for (let i = 0; i < 40; i += 1) {
    const seats = wheel.shuffle(members);
    if (seats.length !== members.length) orders.add("길이가 다름");
    else if ([...seats].sort().join() !== [...members].sort().join()) orders.add("사람이 바뀜");
    else orders.add(seats.join());
  }

  assert("사람은 그대로", !orders.has("길이가 다름") && !orders.has("사람이 바뀜"));
  assert("  └ 차례는 판마다 다름", orders.size > 1, `${orders.size}가지`);
  assert("  └ 원본을 건드리지 않음", members[0] === P(1));
}

// ── 6. 판마다 정원 ─────────────────────────────────────────
//
// 정원을 게임에 박아 두면 판마다 다르게 열 수가 없다. 세션에 실어 보낸다.
console.log("\n=== 6. 판마다 정원 ===");
{
  const client = makeClient();
  const { session } = await open(client, { seats: 3 });

  assert("정원이 판에 실림", session.maxPlayers === 3, String(session.maxPlayers));
  assert("  └ 정원을 보는 곳도 같은 값", seatsOf(roulette, session) === 3);
  assert("  └ 연 사람이 첫 자리", session.players.join() === HOST);

  const panel = bodyOf((await client.messages.get(session.messageId)).payload);
  assert("화면에도 그 정원", panel.includes("최대 **3명**"), panel.slice(0, 300));

  const second = await runner.join(G, session.id, P(1));
  assert("둘째 참가", second.ok === true && second.full === false);

  const third = await runner.join(G, session.id, P(2));
  assert("셋째로 다 참", third.ok === true && third.full === true);

  const fourth = await runner.join(G, session.id, P(3));
  assert("  └ 넷째는 막힘", fourth.ok === false && fourth.reason === "full", JSON.stringify(fourth));

  await runner.stopGame(client, G, session.id, host, HOST);
}
// 예전 판에는 이 칸이 아예 없다. 그때는 게임에 적힌 값으로 떨어져야 한다.
assert("판이 안 정했으면 게임 값", seatsOf(roulette, { maxPlayers: undefined }) === null);

// ── 7. 돌려서 뽑기 ─────────────────────────────────────────
//
// 여기만 느리다 (12초쯤). 회전을 진짜로 돌린다.
console.log("\n=== 7. 돌려서 뽑기 ===");
{
  const client = makeClient();
  const { session } = await open(client, { seats: 3, title: "보상은 소원권 1개" });

  await runner.join(G, session.id, P(1));
  const full = await runner.join(G, session.id, P(2));
  assert("다 모이면 시작 신호", full.full === true);

  await runner.startNow(client, G, session.id, host);

  const panel = client.messages.get(session.messageId);

  // 시작하면서 갈아 끼운 화면 하나는 아직 자리표가 아니다. 자리표만 골라 센다.
  const drawn = panel.edits.map((payload) => bodyOf(payload)).filter((frame) => frame.includes("**>**"));
  assert("자리표를 여러 번 고침 (회전)", drawn.length >= wheel.SPIN_FRAMES, String(drawn.length));
  assert(
    "  └ 매 칸 한 사람만 표시됨",
    drawn.every((frame) => (frame.match(/\*\*>\*\*/gu) ?? []).length === 1),
    JSON.stringify(drawn.map((frame) => (frame.match(/\*\*>\*\*/gu) ?? []).length)),
  );

  const last = drawn.at(-1);
  assert("판이 끝남", (await store.getSession(G, session.id)) === undefined);

  const result = bodyOf(client.sent.at(-1).payload);
  assert("결과가 답장으로", client.sent.at(-1).replyTo === session.messageId);
  assert("  └ 당첨을 알림", result.includes(speak("님이 당첨되셨습니다")), result.slice(0, 300));
  assert("  └ 파랑 (알림)", result.includes("5793266"), result.slice(0, 200));
  assert("  └ 제목이 이어짐", result.includes("보상은 소원권 1개 (룰렛)"), result.slice(0, 200));

  // 참가자 칸이 모두를 늘어놓으므로, 당첨자는 **내용 문장**에서 집어야 한다.
  const winner = /<@(\d+)> 님이 당첨/u.exec(result)?.[1];
  assert("  └ 당첨자는 참가자 중 하나", [HOST, P(1), P(2)].includes(winner), String(winner));
  assert(
    "  └ 멎은 자리가 곧 당첨자",
    last.includes(`**>** <@${winner}> **<**`),
    last.slice(0, 300),
  );
}

// ── 8. 도는 중에 종료 ──────────────────────────────────────
//
// 판이 끝났는데 회전이 계속 화면을 덮으면, 결과 위에 옛 자리표가 다시 올라온다.
console.log("\n=== 8. 도는 중에 종료 ===");
{
  const client = makeClient();
  const { session } = await open(client, { seats: 2 });

  await runner.join(G, session.id, P(1));
  const spin = runner.startNow(client, G, session.id, host);

  // 첫 칸이 그려지자마자 끊는다.
  await new Promise((done) => setTimeout(done, 200));
  await runner.stopGame(client, G, session.id, host, P(1));

  const afterStop = client.messages.get(session.messageId).edits.length;
  await spin;
  await new Promise((done) => setTimeout(done, 1600));

  assert("판이 끝남", (await store.getSession(G, session.id)) === undefined);
  assert(
    "  └ 끊긴 뒤로는 화면을 안 고침",
    client.messages.get(session.messageId).edits.length <= afterStop,
    `${afterStop} → ${client.messages.get(session.messageId).edits.length}`,
  );

  const result = bodyOf(client.sent.at(-1).payload);
  assert("  └ 끝낸 사람을 남김", result.includes("끝낸 사람"), result.slice(0, 300));
  assert("  └ 멘션으로", result.includes(`<@${P(1)}>`), result.slice(0, 300));
}

// ── 9. 소스 ────────────────────────────────────────────────
console.log("\n=== 9. 소스 ===");
{
  const source = read("src/games/list/roulette.ts");

  assert("당첨자를 먼저 뽑고 거기서 멎음", source.includes("당첨자를 먼저 뽑는다"));
  assert("  └ 뽑기는 crypto", source.includes('from "node:crypto"') && source.includes("randomInt("));
  assert("  └ Math.random 은 안 씀", !source.includes("Math.random("));
  assert("도는 중에 끝났는지 본다", source.includes("context.alive()"));
  assert("메시지는 한 번만 집음", source.includes("메시지는 **한 번만** 집어 둔다"));
  assert("제목 칸은 형식이 준 것", read("src/commands/roulette.ts").includes("titleOption"));
  assert("정원은 판에 실어 보냄", read("src/commands/roulette.ts").includes("maxPlayers:"));
}

finish();
