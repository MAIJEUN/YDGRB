// 예전 형식으로 저장된 파일을 지금 코드가 읽을 수 있는지.
//
// 봇을 쓰는 사람은 data/ 를 그대로 들고 새 버전으로 올라간다. 형식이 바뀔 때마다
// 예전 파일을 못 읽으면 기록이 통째로 사라진 것처럼 보인다. 그래서 **읽을 수 있는지**와
// **한 번 저장하면 새 형식으로 올라오는지**를 같이 본다.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, assert, finish } from "./_harness.mjs";

// 저장소는 import 시점의 cwd 로 data/ 경로를 잡는다. 먼저 옮겨 두어야 한다.
const sandbox = mkdtempSync(path.join(tmpdir(), "migration-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const G = "111111111111111111";
const U = "222222222222222222";
const OTHER = "333333333333333333";
const CH = "444444444444444444";

const write = (name, data) =>
  writeFileSync(path.join(sandbox, "data", name), JSON.stringify(data, null, 2));
const back = (name) => JSON.parse(readFileSync(path.join(sandbox, "data", name), "utf8"));

// ── 별명 ────────────────────────────────────────────────────
//
// 예전에는 대상이 서버 전원 하나뿐이라 서버 칸에 상태가 그대로 들어 있었다.
// 지금은 { all, members } 로 나뉘고, targetId·messageId 가 붙었다.
console.log("\n=== 1. 별명 — 예전 형식 ===");

write("nicknames.json", {
  guilds: {
    [G]: {
      nickname: "뚜따",
      appliedBy: U,
      appliedAt: 1_700_000_000_000,
      expiresAt: 1_900_000_000_000,
      channelId: CH,
    },
  },
});

const nickname = await import(`${DIST}/nickname/store.js`);

const old = await nickname.getState(G, null);
assert("예전 파일을 읽음", old !== undefined, JSON.stringify(old));
assert("  └ 별명이 살아 있음", old?.nickname === "뚜따", old?.nickname);
assert("  └ 서버 전원으로 봄 (targetId = null)", old?.targetId === null, String(old?.targetId));
assert("  └ 없던 messageId 는 null", old?.messageId === null, String(old?.messageId));
assert("  └ 만료 시각도 그대로", old?.expiresAt === 1_900_000_000_000, String(old?.expiresAt));

const restored = await nickname.statesWithExpiry();
assert("부팅 때 예약을 되살릴 수 있음", restored.length === 1, JSON.stringify(restored));
assert("  └ 어느 서버인지 앎", restored[0]?.guildId === G, restored[0]?.guildId);
assert("  └ targetId 가 채워짐", restored[0]?.state.targetId === null);

console.log("\n=== 2. 별명 — 한 번 저장하면 새 형식으로 ===");
await nickname.setState(G, {
  nickname: "뚜따",
  appliedBy: U,
  appliedAt: 1_700_000_000_000,
  expiresAt: null,
  channelId: CH,
  messageId: null,
  targetId: OTHER,
});

const upgraded = back("nicknames.json").guilds[G];
assert("전체 칸과 개별 칸으로 나뉨", "all" in upgraded && "members" in upgraded, JSON.stringify(upgraded));
assert("  └ 예전 상태가 전체 칸으로", upgraded.all?.nickname === "뚜따", JSON.stringify(upgraded.all));
assert("  └ 새로 건 것은 개별 칸으로", upgraded.members?.[OTHER]?.targetId === OTHER, JSON.stringify(upgraded.members));
assert(
  "개별을 걸어도 전체 예약이 안 사라짐",
  (await nickname.getState(G, null)) !== undefined,
  "한 칸만 두면 개별 뚜따이가 전체 자동 바사삭을 지워 버린다",
);

console.log("\n=== 3. 별명 — 빈 파일 · 없는 서버 ===");
assert("없는 서버는 undefined", (await nickname.getState("999999999999999999", null)) === undefined);
assert("  └ 없는 대상도", (await nickname.getState(G, "999999999999999999")) === undefined);

// ── 출헉 ────────────────────────────────────────────────────
//
// 「그래도 계속」 덤이 생기면서 extras 칸이 붙었다. 그 전 파일에는 없다.
console.log("\n=== 4. 출헉 — extras 가 없던 파일 ===");

write("attendance.json", {
  guilds: { [G]: { today: null, records: { [U]: { userId: U, total: 3, streak: 2, lastDate: "2026-07-01" } } } },
});

const attendance = await import(`${DIST}/attendance/store.js`);

const record = await attendance.getRecord(G, U);
assert("기록을 읽음", record?.total === 3, JSON.stringify(record));
assert("  └ 연속일수도", record?.streak === 2);
assert("extras 가 없어도 안 터짐", (await attendance.getExtra(G, "없는id")) === null);

const extra = await attendance.addExtra(G, "받아쓰기");
assert("덤을 새로 넣을 수 있음", typeof extra.id === "string" && extra.id.length > 0, JSON.stringify(extra));
assert("  └ 파일에 extras 칸이 생김", "extras" in back("attendance.json").guilds[G]);
assert("  └ 넣은 것을 다시 읽음", (await attendance.getExtra(G, extra.id))?.text === "받아쓰기");

// ── 소원권 ──────────────────────────────────────────────────
//
// 제작 비용이 서버 설정으로 바뀌면서 settings 에 fragmentsPerTicket 이 붙었다.
console.log("\n=== 5. 소원권 — 설정이 반쪽인 파일 ===");

write("wishes.json", {
  guilds: {
    [G]: {
      // OTHER 는 조각 칸이 아예 없던 시절의 기록이다.
      balances: { [U]: { tickets: 2, fragments: 7 }, [OTHER]: { tickets: 5 } },
      settings: { wishChannelId: CH },
      wishes: {},
    },
  },
});

const wish = await import(`${DIST}/wish/store.js`);

const balance = await wish.getBalance(G, U);
assert("잔고를 읽음", balance.tickets === 2 && balance.fragments === 7, JSON.stringify(balance));

const settings = await wish.getSettings(G);
assert("전달 채널이 살아 있음", settings.wishChannelId === CH, String(settings.wishChannelId));
assert(
  "  └ 없던 제작 비용은 기본값으로",
  settings.fragmentsPerTicket === wish.DEFAULT_FRAGMENTS_PER_TICKET,
  String(settings.fragmentsPerTicket),
);

console.log("\n=== 6. 소원권 — 반쪽짜리 잔고 ===");
const half = await wish.getBalance(G, OTHER);
assert("있는 값은 그대로", half.tickets === 5, JSON.stringify(half));
assert("  └ 없던 칸은 0 으로 채움", half.fragments === 0, JSON.stringify(half));

const fresh = await wish.getBalance(G, "888888888888888888");
assert("기록이 아예 없으면 0 으로 시작", fresh.tickets === 0 && fresh.fragments === 0, JSON.stringify(fresh));

// 역사는 나중에 붙은 칸이다. 없던 파일도 읽히고, 한 번 쓰면 생겨야 한다.
console.log("\n=== 6-1. 소원권 — 역사가 없던 파일 ===");
assert("역사 없이도 날짜가 안 터짐", (await wish.getHistoryDays(G, U)).length === 0);
assert("  └ 그날 목록도 비어 있음", (await wish.getHistoryOf(G, U, "2026-01-01")).length === 0);

await wish.applyBalanceChange(G, U, { tickets: 1 }, { note: { source: "옮겨 온 뒤 첫 변동" } });
const moved = await wish.getHistoryDays(G, U);
assert("한 번 쓰면 생김", moved.length === 1 && moved[0].count === 1, JSON.stringify(moved));

// ── 타살버 ──────────────────────────────────────────────────
console.log("\n=== 7. 타살버 — 역할이 아직 없는 서버 ===");

write("tasalbeo.json", { guilds: { [G]: { targets: {} } } });

const tasalbeo = await import(`${DIST}/tasalbeo/store.js`);
assert("roleId 가 없어도 null 로 읽음", (await tasalbeo.getRoleId(G)) === null);
assert("  └ 대상 목록은 비어 있음", (await tasalbeo.activeTargets(G)).size === 0);

await tasalbeo.setRoleId(G, "777777777777777777");
assert("  └ 넣으면 저장됨", (await tasalbeo.getRoleId(G)) === "777777777777777777");

// ── 깨진 파일 ───────────────────────────────────────────────
//
// 깨진 JSON 을 빈 값으로 덮어쓰면 기록이 소리 없이 사라진다. 던져야 한다.
console.log("\n=== 8. 깨진 파일은 조용히 덮어쓰지 않음 ===");

const brokenDir = mkdtempSync(path.join(tmpdir(), "broken-"));
mkdirSync(path.join(brokenDir, "data"));
writeFileSync(path.join(brokenDir, "data", "timeouts.json"), "{ 이건 JSON 이 아니다");
process.chdir(brokenDir);

const { JsonFile } = await import(`${DIST}/storage/json-file.js`);
const file = new JsonFile(path.join(brokenDir, "data", "timeouts.json"), () => ({ guilds: {} }));

let threw = false;
try {
  await file.read();
} catch {
  threw = true;
}
assert("깨진 JSON 은 오류로", threw, "빈 값으로 덮어쓰면 기록이 통째로 사라진다");

const missing = new JsonFile(path.join(brokenDir, "data", "없는파일.json"), () => ({ guilds: {} }));
assert("  └ 파일이 없을 때만 빈 값으로 시작", JSON.stringify(await missing.read()) === '{"guilds":{}}');

process.chdir(sandbox);
finish();
