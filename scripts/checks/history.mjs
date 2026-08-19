// 소원권 역사 검증 — 무엇이 남는가 · 날짜별로 묶이는가 · 화면에 나오는가.
//
// 「내 소원권이 왜 줄었지」에 답하는 것이 전부다. 사람이 사유를 적는 것(수수·흡혈)만
// 남기면 반쪽이 되므로, 출헉 보상도 제작도 소원 환불도 **무엇이 바꿨는지**가 함께 남아야 한다.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const sandbox = mkdtempSync(path.join(tmpdir(), "history-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const RAW = path.join(sandbox, "data", "wishes.json");

const store = await import(`${DIST}/wish/store.js`);
const views = await import(`${DIST}/wish/views.js`);
const panels = await import(`${DIST}/wish/panels.js`);
const format = await import(`${DIST}/wish/format.js`);
const ids = await import(`${DIST}/wish/ids.js`);
const { buildContainer } = await import(`${DIST}/ui/response.js`);
const { dateKey } = await import(`${DIST}/time.js`);

const G = "111111111111111111";
const A = "222222222222222222";
const B = "333333333333333333";
const user = { id: A, username: "마이즌" };

const bodyOf = async (view) => {
  const head = buildContainer(await view).toJSON().components[0];
  return head.type === 9 ? head.components[0].content : head.content;
};
const idsOf = (rows) => rows.flatMap((r) => r.toJSON().components).map((c) => c.custom_id);
const today = () => store.getHistoryOf(G, dateKey());

// ── 1. 무엇이 남는가 ───────────────────────────────────────
console.log("\n=== 1. 무엇이 남는가 ===");

await store.applyBalanceChange(
  G,
  A,
  { fragments: 8 },
  { note: { source: "출헉 보상", reason: "누적 4일" } },
);

const first = (await today())[0];
assert("한 줄이 남음", first !== undefined);
assert("  └ 누구", first.userId === A, first.userId);
assert("  └ 얼마나", first.fragments === 8 && first.tickets === 0, JSON.stringify(first));
assert("  └ 무엇이 바꿨는지", first.source === "출헉 보상", first.source);
assert("  └ 사유", first.reason === "누적 4일", String(first.reason));
assert("  └ 언제", typeof first.at === "number" && first.at > 0);

// 사람이 사유를 적을 자리가 없는 시스템도 「무엇이」는 남아야 한다.
await store.applyBalanceChange(
  G,
  A,
  { tickets: 1, fragments: -5 },
  { note: { source: "제작 (조각 5개)" } },
);
const crafted = (await today()).at(-1);
assert("사유가 없어도 남음", crafted.source === "제작 (조각 5개)" && crafted.reason === null);
assert("  └ 한 번에 둘이 움직임", crafted.tickets === 1 && crafted.fragments === -5);

// 아무것도 안 바뀐 변동은 역사가 아니다.
const before = (await today()).length;
await store.applyBalanceChange(G, A, { tickets: 0 }, { note: { source: "아무것도 아님" } });
assert("0 변동은 안 남김", (await today()).length === before);

// 막힌 변동도 안 남는다 — 바뀐 것이 없으므로.
const refused = await store.applyBalanceChange(
  G,
  B,
  { tickets: -5 },
  { note: { source: "모자란 회수" } },
);
assert("막힌 변동은 안 남김", refused.ok === false);
assert("  └ 줄 수도 그대로", (await today()).length === before);

// 있는 만큼만 걷는 회수는 **걷힌 만큼**만 남는다.
await store.applyBalanceChanges(G, [B], { tickets: 2 }, { note: { source: "밑작업" } });
await store.applyBalanceChanges(
  G,
  [B],
  { tickets: -100 },
  { note: { source: "수수 — 회수" }, clamp: true },
);
assert("걷힌 만큼만 남김", (await today()).at(-1).tickets === -2, String((await today()).at(-1).tickets));

// ── 2. 날짜별로 묶이는가 ───────────────────────────────────
console.log("\n=== 2. 날짜별로 묶이는가 ===");
{
  const days = await store.getHistoryDays(G);
  const day = days.find((candidate) => candidate.date === dateKey());

  assert("오늘 날짜가 잡힘", day !== undefined, days.map((d) => d.date).join(" "));
  assert("  └ 건수를 셈", day.count === (await today()).length, String(day.count));
  assert(
    "  └ 늘어난 것과 줄어든 것을 따로",
    day.tickets.gained === 3 && day.tickets.lost === 2,
    JSON.stringify(day.tickets),
  );
  assert(
    "  └ 조각도",
    day.fragments.gained === 8 && day.fragments.lost === 5,
    JSON.stringify(day.fragments),
  );
}
{
  // 최근 날짜가 앞이어야 한다 — 드롭다운이 스물다섯 줄까지만 받으므로 오래된 쪽이 잘려야 한다.
  const old = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const data = JSON.parse(readFileSync(RAW, "utf8"));
  data.guilds[G].history.unshift({
    at: old,
    userId: A,
    tickets: 1,
    fragments: 0,
    source: "옛날",
    reason: null,
  });
  writeFileSync(RAW, JSON.stringify(data));

  const fresh = await import(`${DIST}/wish/store.js?t=sorted`);
  const sorted = await fresh.getHistoryDays(G);

  assert("최근 날짜가 앞", sorted[0].date > sorted.at(-1).date, sorted.map((d) => d.date).join(" "));
  assert("  └ 그날 것만 골라 냄", (await fresh.getHistoryOf(G, dateKey(new Date(old)))).length === 1);
}

// ── 3. 넘치면 오래된 것부터 ────────────────────────────────
console.log("\n=== 3. 넘치면 오래된 것부터 ===");
assert("상한이 정해져 있음", store.MAX_HISTORY_ENTRIES > 0, String(store.MAX_HISTORY_ENTRIES));
{
  const data = JSON.parse(readFileSync(RAW, "utf8"));
  data.guilds[G].history = Array.from({ length: store.MAX_HISTORY_ENTRIES + 5 }, (_, index) => ({
    at: Date.now() - (store.MAX_HISTORY_ENTRIES - index) * 1000,
    userId: A,
    tickets: 1,
    fragments: 0,
    source: `줄 ${index}`,
    reason: null,
  }));
  writeFileSync(RAW, JSON.stringify(data));

  const fresh = await import(`${DIST}/wish/store.js?t=trim`);
  await fresh.applyBalanceChange(G, A, { tickets: 1 }, { note: { source: "마지막" } });

  const all = JSON.parse(readFileSync(RAW, "utf8")).guilds[G].history;
  assert("상한을 안 넘김", all.length === store.MAX_HISTORY_ENTRIES, String(all.length));
  assert("  └ 오래된 것이 잘림", all[0].source !== "줄 0", all[0].source);
  assert("  └ 방금 것은 남음", all.at(-1).source === "마지막", all.at(-1).source);
}

// ── 4. 확인 화면의 역사 버튼 ───────────────────────────────
console.log("\n=== 4. 확인 화면의 역사 버튼 ===");
{
  const closedIds = idsOf(panels.checkRows(A, false));

  assert(
    "접혀 있을 때는 드롭다운이 없음",
    !closedIds.some((id) => id.includes(ids.ACTION.historyDay)),
    closedIds.join(","),
  );
  assert("  └ 여는 버튼은 있음", closedIds.includes(`wish:hist:${A}:1`), closedIds.join(","));

  const days = await store.getHistoryDays(G);
  const openIds = idsOf(panels.checkRows(A, true, days));

  assert("펴면 드롭다운이 하나 늘어남", openIds.includes(`wish:histday:${A}`), openIds.join(","));
  assert("  └ 버튼은 접는 쪽으로 뒤집힘", openIds.includes(`wish:hist:${A}:0`), openIds.join(","));
  assert("  └ 유저 드롭다운은 그대로", openIds[0] === "wish:checksel", openIds[0]);

  // 지금 상태가 아니라 눌렀을 때 갈 상태를 싣는다 — 두 사람이 같은 화면을 봐도 어긋나지 않게.
  assert("customId 에 갈 상태를 실음", read("src/wish/panels.ts").includes('open ? "0" : "1"'));

  // 고를 날짜가 없으면 드롭다운을 만들지 않는다.
  assert(
    "날짜가 없으면 드롭다운도 없음",
    !idsOf(panels.checkRows(A, true, [])).some((id) => id.includes(ids.ACTION.historyDay)),
  );
  const emptyBody = await bodyOf(views.checkView("999999999999999999", A, user, true));
  assert("  └ 대신 그렇게 말해 줌", emptyBody.includes("**역사**"), emptyBody);
}

// ── 5. 날짜 드롭다운 ───────────────────────────────────────
console.log("\n=== 5. 날짜 드롭다운 ===");
{
  const days = await store.getHistoryDays(G);
  const options = panels.historySelect(A, days).toJSON().options;

  assert("날짜마다 한 줄", options.length === Math.min(days.length, ids.MAX_SELECT_OPTIONS));
  assert("  └ 제목은 날짜", /^\d{4}년 \d{1,2}월 \d{1,2}일 \(.\)$/u.test(options[0].label), options[0].label);
  assert("  └ 설명은 몇 건 얼마나", /^\d+건/u.test(options[0].description), options[0].description);
  assert("  └ 값은 날짜", /^\d{4}-\d{2}-\d{2}$/u.test(options[0].value), options[0].value);
  assert("  └ 제목·설명 모두 100자 안", options.every((o) => o.label.length <= 100 && o.description.length <= 100));

  // 디스코드가 받는 항목은 스물다섯 개뿐이다.
  const many = Array.from({ length: 40 }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    count: 1,
    tickets: { gained: 1, lost: 0 },
    fragments: { gained: 0, lost: 0 },
  }));
  assert(
    `많아도 ${ids.MAX_SELECT_OPTIONS}개까지`,
    panels.historySelect(A, many).toJSON().options.length === ids.MAX_SELECT_OPTIONS,
  );

  // 고른 날짜는 표시된 채로 남아야 지금 무엇을 보고 있는지 안다.
  assert("고른 날짜가 표시됨", panels.historySelect(A, days, days[0].date).toJSON().options[0].default === true);
}

// ── 6. 역사 화면 ───────────────────────────────────────────
console.log("\n=== 6. 역사 화면 ===");
{
  const days = await store.getHistoryDays(G);
  const text = await bodyOf(views.historyView(G, A, dateKey(), user));

  assert("제목", text.startsWith("### 소원권 역사"), text.split("\n")[0]);
  assert("  └ 날짜는 타임스탬프 마크다운", /\*\*<t:\d+:D>\*\*/u.test(text), text.slice(0, 120));
  assert("  └ 시각도", /<t:\d+:t>/u.test(text), text.slice(0, 300));
  assert("  └ 사람은 멘션", text.includes(`<@${A}>`));
  assert("  └ 집계 칸", text.includes("**집계**"));

  assert("한 장에 늘어놓는 줄 수를 막아 둠", ids.MAX_HISTORY_LINES > 0);
  const lines = text.split("\n").filter((line) => line.startsWith("<t:"));
  assert(`  └ ${ids.MAX_HISTORY_LINES}줄 이하`, lines.length <= ids.MAX_HISTORY_LINES, String(lines.length));
  assert("  └ 잘렸으면 그렇게 말함", lines.length === (await today()).length || text.includes("접었"), text.slice(0, 200));

  // 변동이 없는 날을 골라도 터지지 않는다.
  const empty = await bodyOf(views.historyView(G, A, "1999-01-01", user));
  assert("없는 날짜도 안 터짐", empty.includes("오간 것이 없"), empty);

  const rowIds = idsOf(panels.historyRows(A, days, days[0].date));
  assert("날짜 드롭다운은 그대로 둠", rowIds.includes(`wish:histday:${A}`), rowIds.join(","));
  assert("  └ 확인으로 돌아가는 길", rowIds.includes(`wish:hist:${A}:0`), rowIds.join(","));
}

// ── 7. 한 줄 꼴 ────────────────────────────────────────────
console.log("\n=== 7. 한 줄 꼴 ===");
{
  const line = format.formatLedgerEntry({
    at: 1_800_000_000_000,
    userId: A,
    tickets: 3,
    fragments: 0,
    source: "수수 — 지급",
    reason: "이벤트 1등 보상",
  });

  assert("부호를 붙임", line.includes("**+3장**"), line);
  assert("  └ 사유는 콜론으로 (줄표가 겹치지 않게)", line.includes("수수 — 지급: 이벤트 1등 보상"), line);
  assert("  └ 시각은 타임스탬프", /<t:\d+:t>/u.test(line), line);

  const minus = format.formatLedgerEntry({
    at: 1,
    userId: A,
    tickets: 0,
    fragments: -5,
    source: "제작",
    reason: null,
  });
  assert("줄어든 것도 부호", minus.includes("−5개"), minus);
  assert("  └ 사유가 없으면 무엇이 바꿨는지만", minus.endsWith("제작"), minus);

  const both = format.formatLedgerEntry({
    at: 1,
    userId: A,
    tickets: 1,
    fragments: -5,
    source: "제작",
    reason: null,
  });
  assert("한 번에 둘이 움직이면 한 줄에 둘 다", both.includes("+1장") && both.includes("−5개"), both);
}

// ── 8. 통로가 하나인가 ─────────────────────────────────────
//
// 수량이 바뀌는 곳이 하나뿐이라, 거기서 받아 두지 않으면 어디서도 다시 알아낼 수 없다.
console.log("\n=== 8. 통로가 하나인가 ===");
{
  const source = read("src/wish/store.ts");
  assert("역사는 수량 변경 안에서 남김", source.includes("guild.history.push({"));
  assert("  └ 왜 바꿨는지를 반드시 받음", source.includes("readonly note: ChangeNote;"));

  for (const [label, rel, needle] of [
    ["출헉 보상", "src/components/attendance.ts", 'source: "출헉 보상"'],
    ["수수", "src/components/wish.ts", "source: `수수 — ${taking"],
    ["흡혈", "src/components/wish.ts", "흡혈 — <@${to}> 님에게"],
    ["제작", "src/components/wish.ts", "source: `제작 (조각 ${fragmentsPerTicket}개)`"],
    ["낭비", "src/components/wish.ts", "source: `낭비 (${ITEM_LABEL[picked]})`"],
    ["소원 빌기", "src/components/wish.ts", 'source: "소원 빌기"'],
    ["소원 거절 환불", "src/components/wish.ts", 'source: "소원 거절 — 환불"'],
  ]) {
    assert(`${label} 이 왜 바뀌었는지 남김`, read(rel).includes(needle), needle);
  }
}

finish();
