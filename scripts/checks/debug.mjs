// `!y` 디버그 검증 — 등급 · 파싱 · 모든 화면 렌더 · 계측 · 실행기 연동.
import { DIST, PROJECT, assert, finish } from "./_harness.mjs";

process.chdir(PROJECT);

const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const nodePath = await import("node:path");


const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

// ── 1. 소스가 말하는 것 ─────────────────────────────────────
console.log("\n=== 접근 규칙 ===");

const access = read("src/debug/access.ts");
const handle = read("src/debug/handle.ts");
const button = read("src/components/debug.ts");

assert("주인 — 애플리케이션 owner 를 본다", access.includes("application.fetch()"));
assert("  └ 팀 소유면 팀원 전원", access.includes("owner instanceof Team"));
assert("  └ 못 알아냈으면 캐시하지 않음", /if \(found\.size > 0\) cached = found/u.test(access));
assert("관리자 — Administrator 권한을 본다", access.includes("PermissionFlagsBits.Administrator"));
assert("지정 — 허용 목록을 본다", access.includes("isAllowed(guildId, userId)"));

assert("메시지에서 등급을 구함", handle.includes("await levelOf("));
assert("  └ 아무 등급도 아니면 아무 대답도 안 함", /level === null[\s\S]{0,200}return true;/u.test(handle));
assert("  └ 등급은 있는데 항목이 잠긴 경우는 알려 줌", handle.includes("deniedView"));
assert("버튼도 누를 때마다 다시 확인", button.includes("await levelOf("));
assert("  └ 끄기 직전에 한 번 더", /atLeast\(level, "owner"\)/u.test(button));

// ── 2. 접두사 ──────────────────────────────────────────────
console.log("\n=== 접두사 ===");
const { PREFIX, RESTART_EXIT_CODE } = await import(`${DIST}/debug/ids.js`);
assert("접두사는 !y", PREFIX === "!y", PREFIX);
assert(
  "  └ 뒤에 공백이거나 끝이어야 함 (`!yo` 는 안 걸림)",
  handle.includes('content !== PREFIX && !content.startsWith(`${PREFIX} `)'),
);

// ── 3. 계측 ────────────────────────────────────────────────
console.log("\n=== 계측 ===");
const runtime = await import(`${DIST}/debug/runtime.js`);

assert("부팅 시각을 잡아 둠", runtime.BOOTED_AT instanceof Date);
assert("이벤트 루프 지연을 잼", ["mean", "p99", "max"].every((key) => key in runtime.loopLag()));
assert("메모리를 읽음", runtime.memory().rss > 0);
assert("CPU 비율을 냄", typeof runtime.cpuPercent() === "number");

for (const [bytes, expected] of [
  [512, "512B"],
  [2048, "2.0KB"],
  [5 * 1024 * 1024, "5.0MB"],
]) {
  assert(`  └ ${bytes} → ${expected}`, runtime.formatBytes(bytes) === expected, runtime.formatBytes(bytes));
}

// ── 4. 로그 링 버퍼 ─────────────────────────────────────────
console.log("\n=== 로그 ===");
const loggerModule = await import(`${DIST}/logger.js`);

loggerModule.setLogLevel("error");
loggerModule.logger.debug("보이지 않아야 하는 줄");

assert(
  "기준보다 낮은 것도 담아 둠 (콘솔엔 안 찍혀도)",
  loggerModule.recentLogs(50).some((entry) => entry.text.includes("보이지 않아야 하는 줄")),
);
loggerModule.logger.error("에러 한 줄");
assert(
  "  └ 레벨로 거를 수 있음",
  loggerModule.recentLogs(50, "error").every((entry) => entry.level === "error"),
);
assert("  └ 실행 중에 기준을 바꿀 수 있음", loggerModule.logLevel() === "error");
loggerModule.setLogLevel("error");

loggerModule.logger.error("가".repeat(1000));
assert("긴 줄은 잘라서 담음", loggerModule.recentLogs(1)[0].text.length < 400);
loggerModule.logger.error("첫 줄\n둘째 줄");
assert("여러 줄은 한 줄로 눌러 담음", !loggerModule.recentLogs(1)[0].text.includes("\n"));
loggerModule.setLogLevel("info");

// ── 5. id 파싱 ─────────────────────────────────────────────
console.log("\n=== id ===");
const { createdAt, parseId } = await import(`${DIST}/debug/inspect.js`);

for (const [input, expected] of [
  ["222222222222222222", "222222222222222222"],
  ["<@222222222222222222>", "222222222222222222"],
  ["<@!222222222222222222>", "222222222222222222"],
  ["<@&444444444444444444>", "444444444444444444"],
  ["<#333333333333333333>", "333333333333333333"],
  ["안녕", null],
  ["123", null],
  [undefined, null],
]) {
  assert(`  ${String(input)} → ${String(expected)}`, parseId(input) === expected, String(parseId(input)));
}
assert(
  "스노플레이크에서 만든 때를 꺼냄",
  createdAt("222222222222222222").getTime() > 1_420_070_400_000,
);

// ── 6. 스케줄러가 예약을 내놓는지 ───────────────────────────
console.log("\n=== 예약 노출 ===");
const timeoutScheduler = await import(`${DIST}/timeout/scheduler.js`);
const nicknameScheduler = await import(`${DIST}/nickname/scheduler.js`);
const tasalbeoScheduler = await import(`${DIST}/tasalbeo/scheduler.js`);
const { allReservations } = await import(`${DIST}/debug/timers.js`);

const G = "111111111111111111";
const OTHER_G = "777777777777777777";
const FAR = Date.now() + 3_600_000;
const OWNER = "100000000000000001";
const ADMIN = "100000000000000002";
const GUEST = "100000000000000003";
const STRANGER = "100000000000000004";

timeoutScheduler.scheduleEnd(null, G, OWNER, FAR);
nicknameScheduler.scheduleExpiry(null, G, null, FAR + 1000);
tasalbeoScheduler.scheduleEnd(null, G, OWNER, FAR + 2000);

const reserved = allReservations();
assert("세 스케줄러가 전부 보임", reserved.length === 3, JSON.stringify(reserved));
assert("  └ 언제 터지는지도 같이", reserved.every((item) => item.at > Date.now()));
assert("  └ 먼저 터지는 것부터", reserved[0].at <= reserved[1].at && reserved[1].at <= reserved[2].at);
assert("  └ 서버 전원은 대상이 null", reserved.some((item) => item.targetId === null));

const VERY_FAR = Date.now() + 40 * 24 * 60 * 60 * 1000;
timeoutScheduler.scheduleEnd(null, G, OWNER, VERY_FAR);
assert("긴 예약도 진짜 시각을 들고 있음", allReservations().some((item) => item.at === VERY_FAR));

timeoutScheduler.cancelEnd(G, OWNER);
nicknameScheduler.cancelExpiry(G, null);
tasalbeoScheduler.cancelEnd(G, OWNER);
assert("취소하면 사라짐", allReservations().length === 0);

// ── 여기서부터는 저장소를 쓴다. 임시 폴더로 옮긴 뒤에 불러온다. ──
const sandbox = mkdtempSync(nodePath.join(tmpdir(), "debug-"));
process.chdir(sandbox);

const requireFromProject = (await import("node:module")).createRequire(`${PROJECT}/package.json`);
const { MessageFlags, PermissionFlagsBits } = requireFromProject("discord.js");

const { LEVEL_LABEL, atLeast, levelOf } = await import(`${DIST}/debug/access.js`);
const store = await import(`${DIST}/debug/store.js`);
const { COMMANDS, canUse, findCommand } = await import(`${DIST}/debug/commands.js`);
const { asViews } = await import(`${DIST}/debug/handle.js`);
const { buildContainer, channelMessage } = await import(`${DIST}/ui/response.js`);

// ── 7. 등급 ────────────────────────────────────────────────
console.log("\n=== 등급 ===");

assert("주인 > 관리자 > 지정", atLeast("owner", "admin") && atLeast("admin", "guest"));
assert("  └ 거꾸로는 아님", !atLeast("guest", "admin") && !atLeast("admin", "owner"));
assert("  └ 같은 등급은 통과", atLeast("guest", "guest"));
assert("등급마다 이름이 있음", ["owner", "admin", "guest"].every((level) => LEVEL_LABEL[level] !== undefined));

const adminPermissions = { has: (flag) => flag === PermissionFlagsBits.Administrator };
const plainPermissions = { has: () => false };

const client = {
  user: { id: "555555555555555555" },
  application: { fetch: async () => ({ owner: { id: OWNER } }) },
  ws: { status: 0, ping: 42.4, shards: { size: 1 } },
  options: { intents: 33283 },
};

assert("봇 주인은 주인", (await levelOf(client, G, OWNER, null)) === "owner");
assert("  └ 권한이 없어도 주인", (await levelOf(client, G, OWNER, plainPermissions)) === "owner");
assert("Administrator 는 관리자", (await levelOf(client, G, ADMIN, adminPermissions)) === "admin");
assert("그냥 멤버는 아무것도 아님", (await levelOf(client, G, STRANGER, plainPermissions)) === null);
assert("  └ 권한 정보가 없어도", (await levelOf(client, G, STRANGER, null)) === null);

console.log("\n=== 허용 목록 ===");
assert("처음엔 비어 있음", (await store.allowedIds(G)).length === 0);
assert("지정하면 true", (await store.allow(G, GUEST)) === true);
assert("  └ 두 번째는 false", (await store.allow(G, GUEST)) === false);
assert("  └ 지정되면 등급이 생김", (await levelOf(client, G, GUEST, plainPermissions)) === "guest");
assert("  └ 서버마다 따로", (await levelOf(client, OTHER_G, GUEST, plainPermissions)) === null);
assert("거두면 true", (await store.disallow(G, GUEST)) === true);
assert("  └ 두 번째는 false", (await store.disallow(G, GUEST)) === false);
assert("  └ 거두면 등급도 사라짐", (await levelOf(client, G, GUEST, plainPermissions)) === null);
await store.allow(G, GUEST); // 아래 화면 검사에 쓴다.

console.log("\n=== 항목별 등급 ===");
const levelOfCommand = (name) => findCommand(name).level ?? "guest";

for (const name of ["재시작", "종료"]) {
  assert(`${name} 은 주인만`, levelOfCommand(name) === "owner", levelOfCommand(name));
  assert(`  └ 관리자는 못 씀`, !canUse(findCommand(name), "admin"));
}
for (const name of ["허용", "해제"]) {
  assert(`${name} 은 관리자부터`, levelOfCommand(name) === "admin", levelOfCommand(name));
  assert(`  └ 지정된 사람은 못 씀`, !canUse(findCommand(name), "guest"));
  assert(`  └ 관리자는 씀`, canUse(findCommand(name), "admin"));
}
assert(
  "나머지는 셋 다 씀",
  COMMANDS.filter((c) => !["재시작", "종료", "허용", "해제"].includes(c.name)).every((c) =>
    canUse(c, "guest"),
  ),
);
assert("주인은 전부 씀", COMMANDS.every((c) => canUse(c, "owner")));

// ── 8. 모든 화면 ───────────────────────────────────────────
console.log("\n=== 화면 ===");

const ALLOWED = new Set([0x57f287, 0xfee75c, 0xed4245, 0x5865f2]);
const TIMESTAMP = /<t:\d+:[tTdDfFR]>/gu;

function bodyOf(view) {
  const head = buildContainer(view).toJSON().components[0];
  return head.type === 9 ? head.components[0].content : head.content;
}

function checkView(label, view) {
  const json = buildContainer(view).toJSON();
  const list = json.components;
  const head = list[0];
  const text = head.type === 9 ? head.components[0].content : head.content;

  const problems = [];

  if (!ALLOWED.has(json.accent_color)) problems.push(`색 ${json.accent_color}`);
  if (head.type !== 10 && head.type !== 9) problems.push(`첫 요소 타입 ${head.type}`);
  if (!text.startsWith("### !y ")) problems.push("제목이 「!y …」 가 아님");
  if (list.at(-1).type !== 10) problems.push("맨 아래가 footer 가 아님");
  else if (!list.at(-1).content.startsWith("-# @")) problems.push(`footer ${list.at(-1).content}`);
  if (list.at(-2)?.type !== 14) problems.push("footer 앞에 가로줄이 없음");

  const bare = text.replaceAll(TIMESTAMP, "");
  if (/\d{4}년|\d{4}-\d{2}-\d{2}|\d{1,2}월 \d{1,2}일/u.test(bare)) problems.push("날짜를 글자로 적음");

  const withoutMentions = text
    .replace(/<@[&!]?\d+>/gu, "")
    .replace(/<#\d+>/gu, "")
    .replaceAll("@everyone", "")
    .replaceAll("@here", "");
  if (/@[가-힣A-Za-z0-9_]+/u.test(withoutMentions)) problems.push("이름을 글자로 적음");

  if (JSON.stringify(json).length > 5500) problems.push(`너무 김 (${JSON.stringify(json).length})`);

  assert(label, problems.length === 0, problems.join(" / "));
}

// ── 가짜 서버 한 채 ───────────────────────────────────────
const C = "333333333333333333";
const R = "444444444444444444";
const MADE = new Date(1_600_000_000_000);

const permissions = { has: () => true, toArray: () => ["ViewChannel", "SendMessages", "ManageRoles"] };

const role = {
  id: R,
  position: 3,
  hexColor: "#ff0000",
  hoist: false,
  mentionable: true,
  managed: false,
  members: { size: 2 },
  permissions,
  createdAt: MADE,
  toString: () => `<@&${R}>`,
};

const everyone = { id: G, toString: () => "@everyone" };

const channel = {
  id: C,
  type: 0,
  parentId: null,
  createdAt: MADE,
  isThread: () => false,
  isTextBased: () => true,
  messages: { cache: { size: 5 }, fetch: async () => null },
  permissionOverwrites: {
    cache: new Map([[G, { allow: { toArray: () => [] }, deny: { toArray: () => ["SendMessages"] } }]]),
  },
  permissionsFor: () => permissions,
};

const user = { id: OWNER, username: "maijeun", globalName: null, bot: false, createdAt: MADE };

const guild = {
  id: G,
  name: "요땅그래",
  ownerId: OWNER,
  createdAt: MADE,
  memberCount: 1234,
  shardId: 0,
  emojis: { cache: { size: 1 } },
  stickers: { cache: { size: 0 } },
  channels: { cache: new Map([[C, channel]]) },
  roles: { cache: new Map([[R, role], [G, everyone]]), everyone },
};

const member = {
  id: OWNER,
  guild,
  user,
  nickname: null,
  joinedAt: MADE,
  roles: { cache: new Map([[R, role], [G, everyone]]), highest: role },
  permissions,
};

guild.members = {
  me: { joinedAt: MADE, permissions, roles: { highest: role } },
  cache: new Map([[OWNER, member]]),
  fetch: async (id) => (id === OWNER ? member : Promise.reject(new Error("없음"))),
};

// 이 봇이 같이 들어가 있는 **다른** 서버. 이름이 새면 안 된다.
const otherGuild = {
  id: OTHER_G,
  name: "비밀서버",
  ownerId: STRANGER,
  createdAt: MADE,
  memberCount: 7,
  shardId: 0,
  emojis: { cache: { size: 0 } },
  stickers: { cache: { size: 0 } },
  channels: { cache: new Map() },
  roles: { cache: new Map([[OTHER_G, { id: OTHER_G, toString: () => "@everyone" }]]) },
  members: { me: null, cache: new Map(), fetch: async () => Promise.reject(new Error("없음")) },
};

Object.assign(client, {
  guilds: { cache: new Map([[G, guild], [OTHER_G, otherGuild]]) },
  channels: { cache: new Map([[C, channel]]) },
  users: {
    cache: new Map([[OWNER, user]]),
    fetch: async (id) => (id === OWNER ? user : Promise.reject(new Error("없음"))),
  },
  emojis: { cache: new Map() },
  commands: new Map([["소원권", {}], ["별명", {}]]),
  contextMenuCommands: new Map([["2:프로필", { data: { name: "프로필" } }]]),
  components: new Map([["wish", {}], ["debug", {}]]),
});

const message = {
  id: "666666666666666666",
  client,
  guild,
  channel,
  author: user,
  content: "!y",
  inGuild: () => true,
  fetch: async () => message,
};

const run = (name, args, level) =>
  findCommand(name).run({ message, args, user, level });

assert("항목이 넉넉히 있음", COMMANDS.length >= 22, `${COMMANDS.length}개`);
assert("  └ 이름이 겹치지 않음", new Set(COMMANDS.map((c) => c.name)).size === COMMANDS.length);
assert(
  "  └ 별칭도 겹치지 않음",
  (() => {
    const seen = new Set();
    for (const command of COMMANDS) {
      for (const alias of [command.name, ...command.aliases]) {
        if (seen.has(alias)) return false;
        seen.add(alias);
      }
    }
    return true;
  })(),
);
assert("  └ 사용법이 전부 !y 로 시작", COMMANDS.every((c) => c.usage.startsWith("!y")));
assert("  └ 사용법에 @ 를 쓰지 않음 (멘션 규칙)", COMMANDS.every((c) => !c.usage.includes("@")));

assert("빈 입력은 도움말", findCommand("").name === "도움");
assert("  └ 영문 별칭도 통함", findCommand("status").name === "상태");
assert("  └ 대소문자 무관", findCommand("STATUS").name === "상태");
assert("  └ 없는 것은 undefined", findCommand("없는것") === undefined);

// 세 등급 모두에서 쓸 수 있는 화면을 전부 그려 본다.
for (const level of ["owner", "admin", "guest"]) {
  console.log(`\n--- ${LEVEL_LABEL[level]} ---`);

  for (const command of COMMANDS) {
    if (command.name === "오류") continue; // 일부러 터지는 것이라 따로 본다.
    if (!canUse(command, level)) continue;

    const args =
      command.name === "조회"
        ? [OWNER]
        : command.name === "시간"
          ? ["1일", "4시간"]
          : command.name === "역할"
            ? [R]
            : [];

    const views = asViews(await command.run({ message, args, user, level }));

    for (const [index, view] of views.entries()) {
      checkView(`${command.usage}${views.length > 1 ? ` (${index + 1}/${views.length})` : ""}`, view);
    }
  }
}

// ── 9. 등급에 따라 달라지는 것 ─────────────────────────────
console.log("\n=== 등급에 따라 ===");

const helpForAdmin = bodyOf(asViews(await run("도움", [], "admin"))[0]);
assert("도움말에 내 등급이 나옴", helpForAdmin.includes(LEVEL_LABEL.admin), helpForAdmin);
assert("  └ 못 쓰는 항목은 그렇다고 적음", helpForAdmin.includes("전용"), helpForAdmin);
assert("  └ 목록에서 빼지는 않음", helpForAdmin.includes("!y 재시작"), helpForAdmin);

const cwdForOwner = bodyOf(asViews(await run("런타임", [], "owner"))[0]);
const cwdForAdmin = bodyOf(asViews(await run("런타임", [], "admin"))[0]);
// sandbox 가 아니라 cwd 를 본다 — 심볼릭 링크가 걸린 임시 폴더(macOS 등)에서도 맞도록.
assert("주인은 실행 폴더 전체를 봄", cwdForOwner.includes(process.cwd()), cwdForOwner);
assert("  └ 관리자에게는 가려짐", !cwdForAdmin.includes(nodePath.dirname(sandbox)), cwdForAdmin);
assert("  └ 폴더 이름은 남김", cwdForAdmin.includes(nodePath.basename(sandbox)), cwdForAdmin);

const dataForAdmin = bodyOf(asViews(await run("저장소", [], "admin"))[0]);
assert("저장소 경로도 가려짐", !dataForAdmin.includes(nodePath.dirname(sandbox)), dataForAdmin);

const otherForAdmin = asViews(await run("서버", [OTHER_G], "admin"))[0];
checkView("관리자가 다른 서버를 보려 함", otherForAdmin);
assert("  └ 거절됨", otherForAdmin.status === "failure", otherForAdmin.status);
assert("  └ 이름이 새지 않음", !JSON.stringify(otherForAdmin).includes("비밀서버"));

const otherForOwner = asViews(await run("서버", [OTHER_G], "owner"))[0];
checkView("주인이 다른 서버를 봄", otherForOwner);
assert("  └ 주인은 볼 수 있음", otherForOwner.status !== "failure", otherForOwner.status);
assert("  └ 이름까지 나옴", JSON.stringify(otherForOwner).includes("비밀서버"));

const lookupAdmin = bodyOf(asViews(await run("조회", [OTHER_G], "admin"))[0]);
assert("조회도 다른 서버 이름을 감춤", !lookupAdmin.includes("비밀서버"), lookupAdmin);
assert("  └ 서버라는 것까지는 알려 줌", lookupAdmin.includes("서버"), lookupAdmin);

const lookupOwner = bodyOf(asViews(await run("조회", [OTHER_G], "owner"))[0]);
assert("  └ 주인에게는 이름까지", lookupOwner.includes("비밀서버"), lookupOwner);

// 자기 서버는 관리자도 그대로 본다.
const ownGuildAdmin = asViews(await run("서버", [G], "admin"))[0];
assert("자기 서버는 관리자도 봄", ownGuildAdmin.status !== "failure", ownGuildAdmin.status);

console.log("\n=== 허용 화면 ===");
const listView = asViews(await run("허용", [], "admin"))[0];
checkView("!y 허용 (목록)", listView);
assert("지정된 사람을 멘션으로 냄", JSON.stringify(listView).includes(`<@${GUEST}>`));

const addView = asViews(await run("허용", [`<@${STRANGER}>`], "admin"))[0];
checkView("!y 허용 (추가)", addView);
assert("  └ 새로 지정하면 초록", addView.status === "success", addView.status);
assert("  └ 진짜로 지정됨", await store.isAllowed(G, STRANGER));

const againView = asViews(await run("허용", [STRANGER], "admin"))[0];
assert("  └ 이미 있으면 노랑", againView.status === "progress", againView.status);

const dropView = asViews(await run("해제", [STRANGER], "admin"))[0];
checkView("!y 해제", dropView);
assert("  └ 거두면 초록", dropView.status === "success", dropView.status);
assert("  └ 진짜로 사라짐", !(await store.isAllowed(G, STRANGER)));

const dropAgain = asViews(await run("해제", [STRANGER], "admin"))[0];
assert("  └ 없던 사람이면 노랑", dropAgain.status === "progress", dropAgain.status);

const badTarget = asViews(await run("허용", ["안녕"], "admin"))[0];
checkView("대상을 못 알아봄", badTarget);
assert("  └ 빨강", badTarget.status === "failure", badTarget.status);

// ── 10. 못 찾았을 때 ───────────────────────────────────────
console.log("\n=== 못 찾았을 때 ===");
for (const [label, name, args] of [
  ["없는 서버", "서버", ["999999999999999999"]],
  ["없는 채널", "채널", ["999999999999999999"]],
  ["역할을 안 적음", "역할", []],
  ["없는 유저", "유저", ["999999999999999999"]],
  ["잘못된 기간", "시간", ["나중에"]],
  ["잘못된 id", "조회", ["안녕"]],
  ["없는 로그 기준", "로그레벨", ["시끄럽게"]],
]) {
  const view = asViews(await run(name, args, "owner"))[0];
  checkView(`${label} → ${view.status}`, view);
  assert("  └ 빨강이거나 노랑", view.status === "failure" || view.status === "progress", view.status);
}

const changed = asViews(await run("로그레벨", ["debug"], "owner"))[0];
checkView("로그 기준 바꿈", changed);
assert("  └ 바꿨으면 초록", changed.status === "success", changed.status);
assert("  └ 진짜로 바뀜", loggerModule.logLevel() === "debug");
loggerModule.setLogLevel("info");

let thrown = null;
try {
  await run("오류", [], "owner");
} catch (error) {
  thrown = error;
}
assert("`!y 오류` 는 진짜로 던짐", thrown instanceof Error, String(thrown));

const preview = asViews(await run("미리보기", [], "guest"));
assert(
  "미리보기가 네 색을 다 냄",
  new Set(preview.map((view) => view.status)).size === 4,
  preview.map((view) => view.status).join(", "),
);
assert(
  "  └ 보기용 버튼은 잠겨 있음",
  JSON.stringify(preview.map((view) => view.rows ?? [])).includes('"disabled":true'),
);

const payload = channelMessage(preview[0]);
assert("답장 페이로드가 Components V2", payload.flags.includes(MessageFlags.IsComponentsV2));
assert("  └ 멘션 알림을 막음", JSON.stringify(payload.allowedMentions) === '{"parse":[],"repliedUser":false}');

process.chdir(PROJECT);
rmSync(sandbox, { recursive: true, force: true });

// ── 11. 인텐트 · 실행기 ────────────────────────────────────
console.log("\n=== 인텐트 · 실행기 ===");
const clientSource = read("src/client.ts");
const indexSource = read("src/index.ts");
const runBat = read("run.bat");

assert("MessageContent 인텐트를 켬", clientSource.includes("GatewayIntentBits.MessageContent"));
assert("  └ 특권이라는 걸 적어 둠", clientSource.includes("특권 인텐트"));
assert("  └ 못 켰을 때 무엇을 켜야 하는지 알려 줌", indexSource.includes("Privileged Gateway Intents"));
assert("  └ disallowed intents 를 알아봄", indexSource.includes("disallowed intents"));

assert("재시작 종료 코드가 26", RESTART_EXIT_CODE === 26);
assert("  └ run.bat 이 그 코드를 알아봄", runBat.includes('if "%CODE%"=="26"'));
assert("  └ 재시도 횟수를 세지 않음", /"%CODE%"=="26"[\s\S]{0,200}set TRIES=0/u.test(runBat));

finish();
