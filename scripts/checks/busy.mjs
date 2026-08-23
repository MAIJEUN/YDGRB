// 한 채널에 한 판 — 막혔을 때 무엇을 주는가.
//
// 「이미 돌고 있습니다」 만 말하면 막힌 사람이 할 수 있는 일이 없다. 도는 판으로 가는
// 링크와, 접고 대신 여는 버튼을 준다. 뒤쪽은 **그 판을 끝낼 수 있는 사람에게만** 준다.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish, speak } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const sandbox = mkdtempSync(path.join(tmpdir(), "busy-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const ids = await import(`${DIST}/games/ids.js`);
const pending = await import(`${DIST}/games/pending.js`);
const registry = await import(`${DIST}/games/registry.js`);
const runner = await import(`${DIST}/games/runner.js`);
const store = await import(`${DIST}/games/store.js`);
const views = await import(`${DIST}/games/views.js`);
const { buildContainer, messageLink } = await import(`${DIST}/ui/response.js`);

await registry.loadGames();

const G = "111111111111111111";
const CH = "222222222222222222";
const MSG = "333333333333333333";
const HOST = "444444444444444444";
const OTHER = "555555555555555555";

const user = { id: OTHER, username: "마이즌" };
const host = { id: HOST, username: "주최자" };

const session = (over = {}) => ({
  id: "aaaa1111",
  gameId: "quiz",
  guildId: G,
  channelId: CH,
  title: "보상은 소원권 1개",
  name: null,
  body: null,
  maxPlayers: null,
  messageId: MSG,
  hostId: HOST,
  players: [],
  phase: "playing",
  openedAt: Date.now(),
  closesAt: Date.now() + 600_000,
  ...over,
});

const jsonOf = (view) => buildContainer(view).toJSON();
const bodyOf = (view) => {
  const head = jsonOf(view).components[0];
  return head.type === 9 ? head.components[0].content : head.content;
};
const buttonsOf = (view) =>
  jsonOf(view)
    .components.filter((component) => component.type === 1)
    .flatMap((row) => row.components);

// ── 1. 규칙 ────────────────────────────────────────────────
console.log("\n=== 1. 한 채널에 한 판 ===");
{
  const opened = await runner.openGame(registry.getGame("quiz"), G, CH, host, { body: "문제" });
  assert("첫 판은 열림", opened.ok === true);

  const blocked = await runner.openGame(registry.getGame("chosung"), G, CH, user, { body: "ㅁㅈ" });
  assert("같은 채널의 둘째 판은 막힘", blocked.ok === false);
  assert("  └ 무엇이 막았는지 알려 줌", blocked.ok === false && blocked.running.id === opened.session.id);

  const elsewhere = await runner.openGame(registry.getGame("chosung"), G, "999999999999999999", user, {});
  assert("다른 채널은 얼마든지", elsewhere.ok === true);

  await store.dropSession(G, opened.session.id);
  await store.dropSession(G, elsewhere.session.id);
}

// ── 2. 막혔다는 안내 ───────────────────────────────────────
console.log("\n=== 2. 막혔다는 안내 ===");
{
  const link = messageLink(G, CH, MSG);
  const quiz = registry.getGame("quiz");

  const view = views.busyView(session(), quiz, user, { link, takeoverId: "deadbeef" });
  const text = bodyOf(view);

  assert("무슨 판인지 이름으로", text.includes("보상은 소원권 1개 (퀴즈)"), text);
  assert("  └ 연 사람은 멘션으로", text.includes(`<@${HOST}>`), text);
  assert("  └ 언제 끝나는지 타임스탬프로", /<t:\d+:R>/u.test(text), text);
  assert("  └ 빨강 (열지 못함)", jsonOf(view).accent_color === 0xed4245);

  const buttons = buttonsOf(view);
  assert("바로 가기 링크", buttons[0].url === link, String(buttons[0].url));
  assert("  └ 링크 버튼은 customId 가 없음", buttons[0].custom_id === undefined);
  assert("접고 시작 버튼", buttons[1].custom_id === "game:takeover:deadbeef", String(buttons[1].custom_id));
  assert("  └ 빨강 (Danger=4)", buttons[1].style === 4, String(buttons[1].style));

  // 끝낼 수 없는 사람에게는 버튼을 아예 안 준다.
  const passerby = buttonsOf(views.busyView(session(), quiz, user, { link, takeoverId: null }));
  assert("접을 수 없으면 그 버튼도 없음", passerby.length === 1, String(passerby.length));
  assert("  └ 링크는 그대로", passerby[0].url === link);

  // 아직 메시지가 안 붙은 판이면 링크도 못 만든다.
  assert("메시지가 없으면 링크도 없음", messageLink(G, CH, null) === null);
  const noLink = buttonsOf(views.busyView(session({ messageId: null }), quiz, user, { link: null, takeoverId: "x" }));
  assert("  └ 그때는 버튼이 하나", noLink.length === 1 && noLink[0].custom_id === "game:takeover:x");

  // 모집 중이면 「모집 마감」, 진행 중이면 「종료」.
  assert("모집 중은 마감이라고", bodyOf(views.busyView(session({ phase: "recruiting" }), quiz, user, { link, takeoverId: null })).includes("모집 마감"));
  assert("  └ 시계가 없으면 칸도 없음", !bodyOf(views.busyView(session({ closesAt: null }), quiz, user, { link, takeoverId: null })).includes("종료"));
}

// ── 3. 열려던 것을 맡아 둔다 ───────────────────────────────
//
// 문제와 정답, 인원, 제목은 그 명령 한 번에만 실려 오고 응답한 순간 사라진다.
console.log("\n=== 3. 열려던 것을 맡아 둔다 ===");
{
  const open = {
    game: registry.getGame("quiz"),
    options: { title: "제목", body: "문제입니다" },
    guildId: G,
    channelId: CH,
    host: user,
  };

  const id = pending.keepPending(open);
  assert("짧은 id 로 맡김", /^[0-9a-f]{8}$/u.test(id), id);
  assert("  └ customId 에 실을 수 있는 길이", `game:takeover:${id}`.length < 100);

  const taken = pending.takePending(id);
  assert("꺼내면 그대로", taken?.options.body === "문제입니다", JSON.stringify(taken?.options));
  assert("  └ 꺼내면서 지운다 (두 번 눌러도 한 번만)", pending.takePending(id) === undefined);
  assert("없는 id 는 undefined", pending.takePending("deadbeef") === undefined);

  assert("들고 있는 시간은 5분", pending.PENDING_TIMEOUT_SECONDS === 5 * 60);
  assert(
    "  └ 파일에 남기지 않음",
    !read("src/games/pending.ts").includes("JsonFile"),
    "정답이 들어 있고 prepare 는 클로저라 저장할 수도 없다",
  );

  pending.cancelAllPending();
}

// ── 4. 접고 대신 열기 ──────────────────────────────────────
console.log("\n=== 4. 접고 대신 열기 ===");
{
  const client = makeClient();
  const CH2 = "666666666666666666";

  // 모집 형식으로 연다 — 즉시 시작 게임은 붙이는 순간 돌다가 스스로 끝날 수 있다.
  const roulette = registry.getGame("roulette");
  const first = await runner.openGame(roulette, G, CH2, host, { maxPlayers: 4 });
  const message = await client.makeChannel(CH2).send({});
  await runner.attach(client, roulette, first.session, message, host);
  assert("먼저 연 판이 모집 중", (await store.getSession(G, first.session.id))?.phase === "recruiting");

  const { openPending } = await import(`${DIST}/games/command.js`);

  // 접기 전에는 열리지 않는다.
  const stillBusy = await openPending(client, {
    game: registry.getGame("chosung"),
    options: { body: "ㄴㅈㅇㅇㅍ" },
    guildId: G,
    channelId: CH2,
    host: user,
  });
  assert("도는 판이 있으면 그대로 막힘", stillBusy.ok === false);

  // 접고 나면 열린다.
  await runner.stopGame(client, G, first.session.id, host, OTHER);
  assert("접으면 사라짐", (await store.getSession(G, first.session.id)) === undefined);

  const opened = await openPending(client, {
    game: registry.getGame("chosung"),
    options: { body: "ㄴㅈㅇㅇㅍ" },
    guildId: G,
    channelId: CH2,
    host: user,
  });
  assert("그 자리에 새 판이 열림", opened.ok === true, JSON.stringify(opened));
  assert("  └ 연 사람은 명령을 친 사람", opened.ok && opened.session.hostId === OTHER);
  assert("  └ 열려던 내용 그대로", opened.ok && opened.session.body === "ㄴㅈㅇㅇㅍ");

  // 채널에 새 메시지로 나간다 — 막혔다는 안내는 누른 사람에게만 보이는 것이라 판이 될 수 없다.
  const last = client.sent.at(-1);
  assert("채널에 판을 올림", last?.channelId === CH2, JSON.stringify(last?.channelId));
  assert("  └ 판에 메시지가 붙음", (await store.getSession(G, opened.session.id))?.messageId !== null);
}

// ── 5. 누가 누를 수 있는가 ─────────────────────────────────
console.log("\n=== 5. 누가 누를 수 있는가 ===");
{
  const source = read("src/games/command.ts");
  const handler = read("src/components/game.ts");

  assert("버튼은 끝낼 수 있는 사람에게만 붙음", source.includes("interaction.user.id === running.hostId"));
  assert("  └ 관리자도", source.includes("PermissionFlagsBits.Administrator"));
  assert("눌린 것을 그대로 믿지 않음", handler.includes("mayControl(interaction, running.hostId)"));
  assert("  └ 종료와 같은 잣대", handler.includes("판을 연 사람과 관리자만 접을 수 있습니다"));

  // 판 id 가 아니라 맡긴 id 라, 판을 찾기 전에 갈라야 한다.
  assert("넘겨받기는 판을 찾기 전에 가름", handler.includes("if (action === ACTION.takeover)"));
  assert("  └ 맡긴 것이 없으면 다시 치라고", handler.includes("명령을 다시 써 주세요"));

  assert("동작 id 가 있음", ids.ACTION.takeover === "takeover", ids.ACTION.takeover);
}

// ── 6. 링크는 한 곳에서 ────────────────────────────────────
console.log("\n=== 6. 링크는 한 곳에서 ===");
{
  assert(
    "메시지 링크 모양",
    messageLink("1", "2", "3") === "https://discord.com/channels/1/2/3",
    String(messageLink("1", "2", "3")),
  );
  assert("  └ 메시지가 없으면 null", messageLink("1", "2", null) === null);

  const handMade = ["src/games/command.ts", "src/commands/attendance.ts"].filter((rel) =>
    read(rel).includes("https://discord.com/channels/"),
  );
  assert("링크를 손으로 만드는 곳 없음", handMade.length === 0, handMade.join(", "));
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
