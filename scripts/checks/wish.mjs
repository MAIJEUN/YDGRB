// 토큰 없이 확인 가능한 부분 점검:
//   1) 저장소/도메인 로직 (실제 파일에 쓰고 다시 읽음)
//   2) 변동 문구 형식이 요구사항과 정확히 일치하는지
//   3) 모든 디스코드 페이로드의 toJSON() — 스키마 검증이 여기서 돈다
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, fail, finish } from "./_harness.mjs";

// store 는 import 시점의 cwd 기준으로 data/wishes.json 경로를 잡는다.
const sandbox = mkdtempSync(path.join(tmpdir(), "wish-"));
process.chdir(sandbox);

function check(label, fn) {
  try {
    const value = fn();
    console.log(`  ✅ ${label}`);
    return value;
  } catch (error) {
    fail(label, error.message);
    return undefined;
  }
}

const store = await import(`${DIST}/wish/store.js`);
const { formatBalanceChange, formatBalance, formatBalanceBy } = await import(`${DIST}/wish/format.js`);

const G = "111111111111111111";
const A = "222222222222222222";
const B = "333333333333333333";
const C = "888888888888888881";
const D = "888888888888888882";

console.log("\n=== 1. 수량 변경 (지급 · 회수 · 제작 · 낭비) ===");

const given = await store.applyBalanceChanges(G, [A, B], { fragments: 5 }, { note: { source: "검사" } });
assert("두 명에게 조각 5개 지급", given.get(A)?.ok === true && given.get(B)?.ok === true);
assert(
  "0 → 5 로 반영",
  given.get(A).before.fragments === 0 && given.get(A).after.fragments === 5,
  JSON.stringify(given.get(A)),
);

const crafted = await store.applyBalanceChange(G, A, { fragments: -5, tickets: 1 }, { note: { source: "검사" } });
assert(
  "제작: 조각 -5, 소원권 +1 이 한 번에",
  crafted.ok && crafted.after.fragments === 0 && crafted.after.tickets === 1,
  JSON.stringify(crafted),
);

const tooMuch = await store.applyBalanceChange(G, A, { tickets: -5 }, { note: { source: "검사" } });
assert("부족하면 ok:false", tooMuch.ok === false && tooMuch.reason === "insufficient");
const afterFail = await store.getBalance(G, A);
assert(
  "실패한 변경은 아무것도 바꾸지 않음",
  afterFail.tickets === 1 && afterFail.fragments === 0,
  JSON.stringify(afterFail),
);

const partial = await store.applyBalanceChanges(G, [A, B], { tickets: -1 }, { note: { source: "검사" } });
assert(
  "여러 명 중 일부만 실패해도 나머지는 처리됨",
  partial.get(A)?.ok === true && partial.get(B)?.ok === false,
);

console.log("\n=== 1-1. 회수는 있는 만큼만 걷는다 ===");
//
// 「가진 걸 다 걷는다」 가 회수의 뜻이라, 모자라다고 아무것도 안 하는 게 더 이상하다.
// 다만 제작처럼 값을 정확히 치러야 하는 곳에는 켜면 안 된다.
await store.applyBalanceChange(G, C, { tickets: 5 }, { note: { source: "검사" } });

const clamped = await store.applyBalanceChange(G, C, { tickets: -100 }, { note: { source: "검사" }, clamp: true });
assert("보유보다 많이 회수해도 처리됨", clamped.ok === true, JSON.stringify(clamped));
assert("  └ 있는 만큼만 (5장 → 0장)", clamped.ok && clamped.after.tickets === 0, JSON.stringify(clamped));
assert("  └ 걷기 전 보유량을 그대로 알려 줌", clamped.ok && clamped.before.tickets === 5);
assert("  └ 음수로 내려가지 않음", (await store.getBalance(G, C)).tickets === 0);

const already = await store.applyBalanceChange(G, C, { tickets: -100 }, { note: { source: "검사" }, clamp: true });
assert("이미 0이어도 실패하지 않음", already.ok === true && already.after.tickets === 0);

// 켜지 않으면 예전 그대로다.
const strict = await store.applyBalanceChange(G, C, { tickets: -1 }, { note: { source: "검사" } });
assert("켜지 않으면 모자랄 때 그대로 거절", strict.ok === false && strict.reason === "insufficient");

console.log("\n=== 1-1-2. 갯수 한계 ===");
const amount = await import(`${DIST}/wish/amount.js`);
const { MAX_AMOUNT, MAX_AMOUNT_LENGTH, DECIMALS } = amount;

// 눈금 단위로 세어도 정수로 정확해야 한다. 그 위로는 더한 값이 슬금슬금 어긋난다.
assert(
  "눈금까지 정확한 최대값",
  MAX_AMOUNT === Math.floor(Number.MAX_SAFE_INTEGER / 10 ** DECIMALS),
  String(MAX_AMOUNT),
);
assert("  └ 입력 칸은 소수점 자리까지 열림", MAX_AMOUNT_LENGTH === String(MAX_AMOUNT).length + 1 + DECIMALS);
assert("  └ 예전 4자리 한계가 아님", MAX_AMOUNT_LENGTH > 4, String(MAX_AMOUNT_LENGTH));

// 그 위로는 저장하지 않는다.
await store.applyBalanceChange(G, D, { tickets: MAX_AMOUNT }, { note: { source: "검사" } });
const piled = await store.applyBalanceChange(G, D, { tickets: MAX_AMOUNT }, { note: { source: "검사" } });
assert("한계 위로는 올라가지 않음", piled.ok && piled.after.tickets === MAX_AMOUNT, JSON.stringify(piled));
assert(
  "  └ 눈금 단위로도 정수",
  Number.isSafeInteger((await store.getBalance(G, D)).tickets * 10 ** DECIMALS),
);

// 아래 랭킹 검사에 끼어들지 않게 걷어 낸다 (회수가 있는 만큼만 걷는다는 것도 한 번 더 쓴다).
await store.applyBalanceChange(G, D, { tickets: -MAX_AMOUNT }, { note: { source: "검사" }, clamp: true });
assert("  └ 걷어 내면 0", (await store.getBalance(G, D)).tickets === 0);

console.log("\n=== 1-1-3. 소수점 ===");
//
// 반 장도 셀 수 있어야 하지만, 부동소수점을 그대로 담으면 더할수록 어긋난다.
// 눈금을 정해 두고 저장 직전에 맞춘다.
for (const [raw, expected] of [
  ["3", 3],
  ["0.5", 0.5],
  ["0.1", 0.1],
  [" 2.5 ", 2.5],
  ["1.25", undefined],
  ["1.005", undefined],
  ["0", undefined],
  ["-1", undefined],
  ["1e3", undefined],
  ["abc", undefined],
  [String(MAX_AMOUNT + 1), undefined],
]) {
  assert(`읽기: ${JSON.stringify(raw)} → ${expected}`, amount.parseAmount(raw) === expected, String(amount.parseAmount(raw)));
}

assert("눈금에 맞춤", amount.quantize(0.1 + 0.2) === 0.3, String(amount.quantize(0.1 + 0.2)));
assert("  └ 눈금보다 잘면 안 받음", amount.parseAmount(String(amount.SMALLEST_AMOUNT / 10)) === undefined);
assert("  └ 눈금 하나는 받음", amount.parseAmount(String(amount.SMALLEST_AMOUNT)) === amount.SMALLEST_AMOUNT);
assert("입력 칸 안내가 표를 따라감", amount.AMOUNT_HINT.includes(`${DECIMALS}자리`), amount.AMOUNT_HINT);
assert("  └ 이미 맞은 값은 그대로", amount.quantize(1.5) === 1.5);

const DEC = "888888888888888880";
for (let index = 0; index < 10; index += 1) {
  await store.applyBalanceChange(G, DEC, { tickets: 0.1 }, { note: { source: "검사" } });
}
assert("0.1 을 열 번 더해도 안 어긋남", (await store.getBalance(G, DEC)).tickets === 1, String((await store.getBalance(G, DEC)).tickets));

await store.applyBalanceChange(G, DEC, { tickets: -0.4 }, { note: { source: "검사" } });
assert("  └ 소수로 걷기", (await store.getBalance(G, DEC)).tickets === 0.6, String((await store.getBalance(G, DEC)).tickets));

const short = await store.applyBalanceChange(G, DEC, { tickets: -0.7 }, { note: { source: "검사" } });
assert("  └ 모자라면 막힘", short.ok === false, JSON.stringify(short));

assert("뒤에 붙는 0 은 떼고 적음", amount.formatAmount(3) === "3", amount.formatAmount(3));
assert("  └ 소수는 그대로", amount.formatAmount(0.5) === "0.5", amount.formatAmount(0.5));
assert("  └ 천 단위는 콤마, 소수점 아래는 그대로", amount.formatAmount(1234.5) === "1,234.5", amount.formatAmount(1234.5));

await store.applyBalanceChange(G, DEC, { tickets: -100 }, { note: { source: "검사" }, clamp: true });


console.log("\n=== 1-2. 흡혈 (빼고 → 더하기) ===");
const V = "666666666666666666"; // 흡혈될 유저
const T = "777777777777777777"; // 흡혈할 유저

await store.applyBalanceChanges(G, [V], { fragments: 4 }, { note: { source: "검사" } });

// 부족하면 빼는 단계에서 멈추고 아무것도 바뀌지 않아야 한다.
const bloodFail = await store.applyBalanceChange(G, V, { fragments: -10 }, { note: { source: "검사" } });
assert("부족하면 흡혈 실패", bloodFail.ok === false);
assert(
  "  └ 양쪽 모두 그대로",
  (await store.getBalance(G, V)).fragments === 4 && (await store.getBalance(G, T)).fragments === 0,
);

const drained = await store.applyBalanceChange(G, V, { fragments: -3 }, { note: { source: "검사" } });
const gained = await store.applyBalanceChange(G, T, { fragments: 3 }, { note: { source: "검사" } });
assert("흡혈될 유저에게서 차감", drained.ok && drained.after.fragments === 1, JSON.stringify(drained));
assert("흡혈할 유저에게 지급", gained.ok && gained.after.fragments === 3, JSON.stringify(gained));
assert(
  "  └ 총합 보존 (4 = 1 + 3)",
  drained.after.fragments + gained.after.fragments === 4,
);
assert(
  "  └ 두 사람의 변동 문구가 모두 나옴",
  formatBalanceChange(drained) === "소원권 조각: 4개 → 1개" &&
    formatBalanceChange(gained) === "소원권 조각: 0개 → 3개",
  `${formatBalanceChange(drained)} / ${formatBalanceChange(gained)}`,
);

console.log("\n=== 2. 변동 문구 형식 ===");
const changeBoth = formatBalanceChange({
  before: { tickets: 3, fragments: 7 },
  after: { tickets: 4, fragments: 2 },
});
assert(
  "두 항목 모두 변동",
  changeBoth === "소원권: 3장 → 4장\n소원권 조각: 7개 → 2개",
  JSON.stringify(changeBoth),
);

const changeOne = formatBalanceChange({
  before: { tickets: 3, fragments: 7 },
  after: { tickets: 3, fragments: 2 },
});
assert("바뀐 항목만 표기", changeOne === "소원권 조각: 7개 → 2개", JSON.stringify(changeOne));

const changeNone = formatBalanceChange({
  before: { tickets: 3, fragments: 7 },
  after: { tickets: 3, fragments: 7 },
});
assert("변동 없으면 undefined", changeNone === undefined, JSON.stringify(changeNone));

console.log("\n=== 3. 랭킹 · 설정 · 소원 ===");
await store.applyBalanceChanges(G, [B], { tickets: 9 }, { note: { source: "검사" } });
const byTickets = await store.getRanking(G, "tickets");
assert("소원권 기준 정렬", byTickets[0].userId === B, JSON.stringify(byTickets));
assert(
  "  └ 소원권 0장인 사람은 빠짐",
  byTickets.every((entry) => entry.balance.tickets > 0),
  JSON.stringify(byTickets.map((e) => e.balance)),
);

const byFragments = await store.getRanking(G, "fragments");
assert("조각 기준 정렬", byFragments[0].userId === B, JSON.stringify(byFragments));
assert(
  "  └ 조각 0개인 사람은 빠짐",
  byFragments.every((entry) => entry.balance.fragments > 0),
  JSON.stringify(byFragments.map((e) => e.balance)),
);
assert(
  "  └ 기준이 다르면 명단도 달라짐",
  byTickets.length !== byFragments.length,
  `${byTickets.length} / ${byFragments.length}`,
);

assert(
  "소원권 기준은 장수만 표기",
  formatBalanceBy({ tickets: 3, fragments: 7 }, "tickets") === "소원권 **3장**",
  formatBalanceBy({ tickets: 3, fragments: 7 }, "tickets"),
);
assert(
  "조각 기준은 개수만 표기",
  formatBalanceBy({ tickets: 3, fragments: 7 }, "fragments") === "소원권 조각 **7개**",
  formatBalanceBy({ tickets: 3, fragments: 7 }, "fragments"),
);

const initial = await store.getSettings(G);
assert("설정 전 채널은 null", initial.wishChannelId === null);
assert("제작 비용 기본값 5", initial.fragmentsPerTicket === 5, `${initial.fragmentsPerTicket}`);

await store.updateSettings(G, { wishChannelId: "444444444444444444" });
const afterChannel = await store.getSettings(G);
assert("채널 설정 반영", afterChannel.wishChannelId === "444444444444444444");
assert("  └ 제작 비용은 그대로", afterChannel.fragmentsPerTicket === 5);

await store.updateSettings(G, { fragmentsPerTicket: 12 });
const afterCost = await store.getSettings(G);
assert("제작 비용만 바꿔도 채널 유지", afterCost.wishChannelId === "444444444444444444" && afterCost.fragmentsPerTicket === 12, JSON.stringify(afterCost));

// 예전 데이터에는 fragmentsPerTicket 이 없다 — 기본값으로 채워져야 한다.
const legacyGuild = "999999999999999999";
await store.updateSettings(legacyGuild, {});
assert("설정 없던 서버도 기본값 적용", (await store.getSettings(legacyGuild)).fragmentsPerTicket === 5);

// 제작 비용을 12로 올렸으니 되돌려 둔다 (아래 검사에 영향 없게).
await store.updateSettings(G, { fragmentsPerTicket: 5 });

const wish = await store.createWish(G, {
  userId: A,
  content: "테스트 소원",
  attachments: [],
  channelId: "444444444444444444",
});
assert("소원 id 는 8자", wish.id.length === 8, wish.id);

const first = await store.resolveWish(G, wish.id, "rejected", B);
const second = await store.resolveWish(G, wish.id, "accepted", B);
assert("처음 처리만 성공", first.ok === true);
assert("두 번째는 already", second.ok === false && second.reason === "already");

console.log("\n=== 4. 파일 저장 ===");
const saved = JSON.parse(await readFile(path.join(sandbox, "data", "wishes.json"), "utf8"));
// B 는 회수가 부족으로 거부돼 0장에 머물렀고, 그 뒤 9장을 받았다.
assert("디스크에 반영됨", saved.guilds[G].balances[B].tickets === 9, JSON.stringify(saved.guilds[G].balances));
assert("소원 기록 보존", saved.guilds[G].wishes[wish.id].status === "rejected");

console.log("\n=== 5. 봇 재시작 시나리오 ===");
// 모듈을 새로 로드하면 메모리 캐시가 비어 있어 디스크에서 다시 읽는다 = 재시작과 같은 상황.
const restarted = await import(`${DIST}/wish/store.js?restart=1`);
const seen = await restarted.getWish(G, wish.id);
assert("재시작 후에도 소원 기록이 남아 있음", seen?.status === "rejected", JSON.stringify(seen));

const pending = await restarted.createWish(G, {
  userId: A,
  content: "재시작 전에 접수된 소원",
  attachments: [],
  channelId: "444444444444444444",
});
await restarted.attachWishMessage(G, pending.id, "555555555555555555");

const restartedAgain = await import(`${DIST}/wish/store.js?restart=2`);
const before = await restartedAgain.getBalance(G, A);
const decided = await restartedAgain.resolveWish(G, pending.id, "rejected", B);
assert("재시작 후 수락/거절 처리 성공", decided.ok === true, JSON.stringify(decided));

const refund = await restartedAgain.applyBalanceChange(G, A, { tickets: 1 }, {
  note: { source: "검사" },
});
assert(
  "재시작 후 거절 환불도 정상",
  refund.ok && refund.after.tickets === before.tickets + 1,
  JSON.stringify(refund),
);
assert("메시지 id 도 보존됨", (await restartedAgain.getWish(G, pending.id))?.messageId === "555555555555555555");

console.log("\n=== 6. 첨부파일 처리 ===");
const attach = await import(`${DIST}/wish/attachments.js`);

const uploads = attach.prepareUploads(
  new Map([
    ["1", { name: "내 사진.png", url: "https://cdn.example/1", size: 2048, contentType: "image/png" }],
    ["2", { name: "내 사진.png", url: "https://cdn.example/2", size: 5, contentType: "image/png" }],
    ["3", { name: "문서.pdf", url: "https://cdn.example/3", size: 3_500_000, contentType: "application/pdf" }],
  ]),
);
assert("공백은 _ 로 정리", uploads[0].name === "내_사진.png", uploads[0].name);
assert("이름이 겹치면 번호를 붙임", uploads[1].name === "내_사진_2.png", uploads[1].name);
check("toUploadFiles()", () => attach.toUploadFiles(uploads).map((f) => f.name));

// 이미지는 묶음(MediaGallery), 나머지는 File 컴포넌트로 나뉘어 나간다.
assert(
  "이미지만 묶음 참조로",
  attach.galleryImages(uploads).join(",") === "attachment://내_사진.png,attachment://내_사진_2.png",
  attach.galleryImages(uploads).join(","),
);
assert(
  "이미지가 아닌 것만 파일 참조로",
  attach.galleryFiles(uploads).join(",") === "attachment://문서.pdf",
  attach.galleryFiles(uploads).join(","),
);
assert("두 목록이 겹치지 않음", attach.galleryImages(uploads).length + attach.galleryFiles(uploads).length === 3);

// 임베드 시절 헬퍼는 모두 사라져야 한다.
for (const gone of ["previewReference", "embedImages", "attachmentField", "attachmentSummary", "formatBytes"]) {
  assert(`${gone} 은 제거됨`, attach[gone] === undefined);
}

const fakeMessage = {
  attachments: new Map([
    ["101", { id: "101", name: "a.png", url: "https://cdn/a", size: 1, contentType: "image/png" }],
    ["102", { id: "102", name: "b.png", url: "https://cdn/b", size: 2, contentType: "image/png" }],
  ]),
};
assert("메시지에서 첨부 2개 추출", attach.fromMessage(fakeMessage).length === 2);
// 수정할 때 첨부를 id 그대로 다시 넘겨야 attachment:// 참조가 풀리지 않는다.
assert(
  "retained 는 원본 첨부를 그대로 돌려줌",
  attach.retained(fakeMessage).map((f) => f.id).join(",") === "101,102",
);

console.log("\n=== 7. 디스코드 페이로드 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const { collectComponentHandlers } = await import(`${DIST}/loaders/components.js`);
const modals = await import(`${DIST}/wish/modals.js`);
const panels = await import(`${DIST}/wish/panels.js`);
const { buildContainer } = await import(`${DIST}/ui/response.js`);

process.chdir(PROJECT); // 로더는 dist 기준 상대경로라 무관하지만 로그 경로를 위해 되돌린다

const commands = await collectCommands();
for (const command of commands) {
  const json = check(`커맨드 /${command.data.name}`, () => command.data.toJSON());
  if (json) {
    console.log(`     설명: ${json.description}`);
    for (const sub of json.options ?? []) {
      console.log(`     └ ${sub.name}: ${(sub.options ?? []).map((o) => `${o.name}[${(o.choices ?? []).map((c) => c.value).join("|")}]`).join(", ")}`);
    }
  }
}

const handlers = await collectComponentHandlers();
assert("컴포넌트 핸들러 등록", handlers.some((h) => h.namespace === "wish"), handlers.map((h) => h.namespace).join(","));

console.log("\n=== 7-0. 패널 열기 ===");
const wishJson = commands.find((c) => c.data.name === "소원권").data.toJSON();
const panelSub = wishJson.options[0];

assert("`/소원권 패널` — 하위 명령 하나", panelSub.name === "패널", panelSub.name);
assert("  └ 옵션이 없음", (panelSub.options ?? []).length === 0, JSON.stringify(panelSub.options));

const wishCommand = (await import("node:fs")).readFileSync(`${PROJECT}/src/commands/wish.ts`, "utf8");
assert("종류 옵션을 없앰", !wishCommand.includes('setName("종류")'));
assert("권한을 보고 고름", wishCommand.includes("isAdmin ? PANEL.admin : PANEL.user"), wishCommand);
assert("  └ 관리자 여부를 뷰에 넘김", wishCommand.includes("interaction.user, isAdmin)"));

console.log("\n=== 7-0-1. 패널 전환 버튼 ===");
const { panelSwitchButton } = panels;

const onUser = panelSwitchButton("user", true)?.toJSON();
assert("유저 패널에서는 관리자 패널로", onUser?.label === "관리자 패널", JSON.stringify(onUser));
assert("  └ customId 는 wish:panel:admin", onUser?.custom_id === "wish:panel:admin", onUser?.custom_id);

const onAdmin = panelSwitchButton("admin", true)?.toJSON();
assert("관리자 패널에서는 유저 패널로", onAdmin?.label === "유저 패널", JSON.stringify(onAdmin));
assert("  └ customId 는 wish:panel:user", onAdmin?.custom_id === "wish:panel:user", onAdmin?.custom_id);

assert("일반 유저에게는 버튼이 없음", panelSwitchButton("user", false) === undefined);
assert("  └ 관리자 패널이어도 마찬가지", panelSwitchButton("admin", false) === undefined);

const router = (await import("node:fs")).readFileSync(`${PROJECT}/src/components/wish.ts`, "utf8");
assert("라우터가 전환을 처리함", router.includes("case ACTION.panel:"));
assert(
  "  └ 눌린 값을 그대로 믿지 않고 다시 확인",
  router.includes("if (kind === PANEL.admin && !admin)"),
  "customId 는 누구나 흉내 낼 수 있다",
);
assert("  └ 결과 화면에도 버튼이 남음", (router.match(/isAdmin: isAdmin\(interaction\),/gu) ?? []).length >= 10);

// 버튼은 제목 오른쪽 끝(Section 액세서리)에 붙어야 한다.
const withSwitch = buildContainer({
  status: "info",
  title: "소원권 · 유저 패널",
  user: { username: "테스터" },
  accessoryButton: panelSwitchButton("user", true),
  rows: panels.userPanelRows(),
}).toJSON();

assert("제목과 같은 줄(Section)", withSwitch.components[0].type === 9, `${withSwitch.components[0].type}`);
assert("  └ 액세서리 자리에 버튼", withSwitch.components[0].accessory?.custom_id === "wish:panel:admin");
assert("  └ 패널 버튼은 그대로", withSwitch.components.some((c) => c.type === 1));

const CURRENT_SETTINGS = { wishChannelId: "444444444444444444", fragmentsPerTicket: 7 };

for (const [name, build] of Object.entries(modals)) {
  // configModal 만 현재 설정을 받아 미리 채운다.
  const json = check(`모달 ${name}()`, () =>
    (build.length > 0 ? build(CURRENT_SETTINGS) : build()).toJSON(),
  );
  if (json) {
    console.log(`     제목: ${json.title}`);
    for (const c of json.components) {
      console.log(`     └ ${c.label ?? "(TextDisplay)"} → type ${c.component?.type ?? c.type}`);
    }
  }
}

const configJson = modals.configModal(CURRENT_SETTINGS).toJSON();
const [channelLabel, costLabel] = configJson.components;
assert(
  "설정 모달에 현재 채널이 미리 선택됨",
  channelLabel.component.default_values?.[0]?.id === "444444444444444444",
  JSON.stringify(channelLabel.component.default_values),
);
assert(
  "  └ 채널은 선택 항목(비워도 됨)",
  channelLabel.component.required === false && channelLabel.component.min_values === 0,
  JSON.stringify(channelLabel.component),
);
assert(
  "설정 모달에 현재 제작 비용이 채워짐",
  costLabel.component.value === "7",
  JSON.stringify(costLabel.component),
);

check("userPanelRows()", () => panels.userPanelRows().map((r) => r.toJSON()));
check("adminPanelRows()", () => panels.adminPanelRows().map((r) => r.toJSON()));
check("checkRows()", () => panels.checkRows(A, false).map((r) => r.toJSON()));
check("rankRows(tickets, 0, 3)", () => panels.rankRows("tickets", 0, 3).map((r) => r.toJSON()));
check("rankRows(fragments, 2, 3)", () => panels.rankRows("fragments", 2, 3).map((r) => r.toJSON()));
const decisionRows = check("wishDecisionRows()", () =>
  panels.wishDecisionRows("abcd1234").map((r) => r.toJSON()),
);
if (decisionRows) {
  const ids = decisionRows[0].components.map((c) => c.custom_id);
  assert("수락/거절 customId 에 소원 id 가 실림", ids.join(",") === "wish:accept:abcd1234,wish:reject:abcd1234", ids.join(","));
  // 라우터가 하는 것과 같은 방식으로 되돌려 본다.
  const [namespace, action, wishId] = ids[0].split(":");
  assert("  └ 라우터가 되돌릴 수 있음", namespace === "wish" && action === "accept" && wishId === "abcd1234");
  assert("  └ customId 100자 제한 이내", ids.every((id) => id.length <= 100));
}

const fakeUser = {
  id: A,
  username: "테스터",
  displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/1.png",
};

const COLORS = { success: 0x57f287, failure: 0xed4245, progress: 0xfee75c, info: 0x5865f2 };
for (const status of ["success", "failure", "progress", "info"]) {
  const json = check(`Container(${status})`, () =>
    buildContainer({
      status,
      title: "제목",
      description: "본문",
      balance: "소원권: 1장 → 2장",
      user: fakeUser,
    }).toJSON(),
  );
  if (json) {
    assert(`  └ 색상 ${status}`, json.accent_color === COLORS[status], `${json.accent_color}`);
    assert(`  └ footer 는 이름만`, json.components.at(-1).content === "-# @테스터");
    assert(`  └ footer 에 프로필 사진 없음`, !JSON.stringify(json).includes("avatar"));
    assert(`  └ 변동 문구 포함`, json.components[0].content.includes("소원권: 1장 → 2장"));
  }
}

const container = check("Container(info) + 패널 버튼", () =>
  buildContainer({
    status: "info",
    title: "소원권 · 유저 패널",
    description: "본문",
    fields: [{ name: "내 보유", value: formatBalance({ tickets: 1, fragments: 2 }) }],
    balance: "소원권 조각: 3개 → 2개",
    user: fakeUser,
    rows: panels.userPanelRows(),
  }).toJSON(),
);
if (container) {
  assert("  └ accent color = 정보(파랑)", container.accent_color === COLORS.info);
  const types = container.components.map((c) => c.type);
  assert("  └ 버튼이 컨테이너 안에 있음", types.includes(1), JSON.stringify(types));
  const text = JSON.stringify(container);
  assert("  └ 변동 문구 포함", text.includes("소원권 조각: 3개 → 2개"));
  assert("  └ footer 는 작은 텍스트 `-# @이름`", text.includes("-# @테스터"));
  // Thumbnail(11) 을 쓰면 프로필 사진이 본문만큼 커진다. Section(9)은 액세서리 버튼용.
  assert("  └ 큰 이미지 컴포넌트를 쓰지 않음", !types.includes(11), JSON.stringify(types));
  assert("  └ 마지막 요소가 footer", container.components.at(-1).type === 10);
}

console.log("\n=== 7-1. 공개 결과 메시지 ===");
const { response } = await import(`${DIST}/ui/response.js`);

const panelCopy = {
  status: "success",
  title: "제작 완료",
  description: "조각 5개를 소원권 1장으로 바꿨습니다.",
  balance: "소원권: 0장 → 1장",
  user: fakeUser,
  rows: panels.userPanelRows(),
};

const privatePanel = response(panelCopy);
assert("패널은 컨테이너 + 나만 보기", privatePanel.components.length === 1 && privatePanel.flags.length === 2);

// announce() 가 보내는 형태 — 버튼만 떼고 모두에게.
// 확인/랭킹은 드롭다운을 그대로 실어 공개로 띄운다.
const publicView = response({
  status: "info",
  title: "소원권 확인",
  user: fakeUser,
  rows: panels.checkRows(A, false),
  ephemeral: false,
});
assert("확인 공개본은 컨테이너 + 모두에게", publicView.flags.length === 1 && publicView.components.length === 1);
const checkIds = panels
  .checkRows(A, false)
  .flatMap((r) => r.toJSON().components)
  .map((c) => c.custom_id);
assert(
  "  └ 유저 드롭다운과 역사 버튼이 실려 있음",
  checkIds.join(",") === `wish:checksel:0,wish:hist:${A}:1`,
  checkIds.join(","),
);
assert("  └ 「패널로」 버튼은 없음", !checkIds.some((id) => id.startsWith("wish:home")));

const rankIds = panels
  .rankRows("tickets", 1, 3)
  .flatMap((r) => r.toJSON().components)
  .map((c) => c.custom_id);
assert(
  "랭킹 조작은 rankpage/ranksort 로",
  rankIds.join(",") === "wish:ranksort:1,wish:rankpage:tickets:0,wish:noop,wish:rankpage:tickets:2",
  rankIds.join(","),
);
assert("  └ 「패널로」 버튼은 없음", !rankIds.some((id) => id.startsWith("wish:home")));

const panelIds = panels
  .userPanelRows()
  .flatMap((r) => r.toJSON().components)
  .map((c) => c.custom_id);
assert("패널의 랭킹 버튼은 인자 없이", panelIds.includes("wish:rank"), panelIds.join(","));

const publicCopy = response({ ...panelCopy, rows: [], accessoryButton: undefined, ephemeral: false });
assert("공개본도 컨테이너 1개", publicCopy.components.length === 1);
assert("공개본은 모두에게 보임", publicCopy.flags.length === 1, JSON.stringify(publicCopy.flags));
const publicJson = publicCopy.components[0].toJSON();
assert("공개본에는 버튼이 없음", !publicJson.components.some((c) => c.type === 1), JSON.stringify(publicJson.components.map((c) => c.type)));
assert(
  "  └ 색·footer·변동 문구는 그대로",
  publicJson.accent_color === COLORS.success &&
    publicJson.components.at(-1).content === "-# @테스터" &&
    publicJson.components[0].content.includes("소원권: 0장 → 1장"),
);

console.log("\n=== 7-2. 오류 표기 ===");
const { describeError } = await import(`${DIST}/errors.js`);

class DiscordAPIErrorLike extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
  get name() {
    return `DiscordAPIError[${this.code}]`;
  }
}

assert(
  "디스코드 오류는 코드까지 보임",
  describeError(new DiscordAPIErrorLike("Invalid Form Body", 50035)) ===
    "DiscordAPIError[50035]: Invalid Form Body",
  describeError(new DiscordAPIErrorLike("Invalid Form Body", 50035)),
);
assert("일반 Error", describeError(new TypeError("x is not a function")) === "TypeError: x is not a function");
assert("문자열도 처리", describeError("그냥 문자열") === "그냥 문자열");
assert("객체도 처리", describeError({ a: 1 }) === '{"a":1}');

const long = describeError(new Error("가".repeat(1000)));
assert("300자로 자르고 ... 표기", long.length === 300 && long.endsWith("..."), `${long.length}`);

const twoLines = describeError(new Error("첫 줄\n둘째 줄"));
assert("3줄 이하는 그대로", twoLines === "Error: 첫 줄\n둘째 줄", JSON.stringify(twoLines));

const manyLines = describeError(new Error("1\n2\n3\n4\n5\n6"));
assert("최대 3줄", manyLines.split("\n").length === 3, JSON.stringify(manyLines));
assert("  └ 나머지는 ... 으로", manyLines === "Error: 1\n2\n3 ...", JSON.stringify(manyLines));

const longLines = describeError(new Error(["가".repeat(200), "나".repeat(200), "다".repeat(200)].join("\n")));
assert("줄 수와 길이 제한이 함께 적용", longLines.split("\n").length <= 3 && longLines.length <= 300);

// 코드블록 안에 넣으므로 ``` 가 섞이면 형식이 깨진다.
assert("코드펜스는 중화", !describeError(new Error("```rm -rf```")).includes("```"));

// 스택이나 요청 URL(인터랙션 토큰 포함)이 새 나가면 안 된다.
const withStack = new Error("boom");
assert("스택은 포함하지 않음", !describeError(withStack).includes("at "));

const errored = buildContainer({
  status: "failure",
  title: "처리 중 문제가 생겼어요",
  description: "안내",
  fields: [{ name: "원인", value: "```\nDiscordAPIError[50035]: Invalid Form Body\n```" }],
  user: fakeUser,
}).toJSON();
assert("오류도 컨테이너로 나감", errored.accent_color === COLORS.failure, `${errored.accent_color}`);
assert("  └ 원인이 본문에 들어감", errored.components[0].content.includes("**원인**"));
assert("  └ footer 규칙 유지", errored.components.at(-1).content === "-# @테스터");

console.log("\n=== 8. 이미지 묶음 · 첨부 ===");
const IMG = (n) => `attachment://${n}.png`;
const galleryBase = { status: "success", title: "새 소원", description: "본문", user: fakeUser };

const none = buildContainer(galleryBase).toJSON();
assert("이미지 없으면 묶음도 없음", !none.components.some((c) => c.type === 12));
assert("  └ 가로줄은 footer 앞 하나뿐", none.components.filter((c) => c.type === 14).length === 1);

const one = buildContainer({ ...galleryBase, images: [IMG(1)] }).toJSON();
const oneGallery = one.components.find((c) => c.type === 12);
assert("1장도 묶음(MediaGallery)으로", oneGallery !== undefined && oneGallery.items.length === 1);
assert("  └ attachment:// 참조 유지", oneGallery.items[0].media.url === IMG(1), JSON.stringify(oneGallery.items[0]));

const three = buildContainer({ ...galleryBase, images: [1, 2, 3].map(IMG) }).toJSON();
const threeGallery = three.components.find((c) => c.type === 12);
assert("3장이 묶음 하나에", threeGallery.items.length === 3, `${threeGallery.items.length}`);
assert(
  "  └ 순서 유지",
  threeGallery.items.map((i) => i.media.url).join(",") === [1, 2, 3].map(IMG).join(","),
);

const many = buildContainer({
  ...galleryBase,
  images: Array.from({ length: 14 }, (_, i) => IMG(i)),
}).toJSON();
assert("10장까지만 (MediaGallery 한계)", many.components.find((c) => c.type === 12).items.length === 10);

const mixed = buildContainer({ ...galleryBase, images: [IMG(1)], files: ["attachment://doc.pdf"] }).toJSON();
const types = mixed.components.map((c) => c.type);
assert("이미지가 파일보다 먼저", types.indexOf(12) < types.indexOf(13), types.join(","));
assert(
  "  └ File 컴포넌트가 첨부를 가리킴",
  mixed.components.find((c) => c.type === 13).file.url === "attachment://doc.pdf",
  JSON.stringify(mixed.components.find((c) => c.type === 13)),
);

// 소원 메시지가 실제로 attachment:// 를 쓰는지 확인.
const refs = attach.galleryImages([
  { name: "a.gif", url: "https://cdn/a", size: 1, contentType: "image/gif" },
  { name: "doc.pdf", url: "https://cdn/d", size: 1, contentType: "application/pdf" },
  { name: "b.png", url: "https://cdn/b", size: 1, contentType: "image/png" },
]);
assert(
  "galleryImages 는 이미지만 attachment:// 로",
  refs.join(",") === "attachment://a.gif,attachment://b.png",
  refs.join(","),
);
console.log("\n=== 8-1. 수락/거절이 이미지를 지우지 않는지 ===");
const decideSource = (await import("node:fs")).readFileSync(
  `${PROJECT}/src/components/wish.ts`,
  "utf8",
);
const decideBody = decideSource.slice(
  decideSource.indexOf("async function decideWish"),
  decideSource.indexOf("async function fetchUser"),
);

assert("결과를 답글로 남김", decideBody.includes("interaction.message.reply("));

// 원본을 고치는 구간(①)과 답글 구간(②) 을 나눠서, 결과 내용이 ② 에만 있는지 본다.
const updatePart = decideBody.slice(decideBody.indexOf("// ①"), decideBody.indexOf("// ②"));
const replyPart = decideBody.slice(decideBody.indexOf("// ②"));
assert("  └ 두 구간을 찾음", updatePart.length > 0 && replyPart.length > 0);
assert("  └ 원본에는 결과 내용을 덮어쓰지 않음", !updatePart.includes("처리한 관리자"), updatePart);
assert("  └ 결과 내용은 답글에만", replyPart.includes("처리한 관리자"));
assert("  └ 환불 변동도 답글에", replyPart.includes("balance: refundText") && !updatePart.includes("balance:"));
assert(
  "원본은 같은 내용으로 다시 그림 (이미지·첨부 유지)",
  /interaction\.update\(\{[\s\S]*wishMessage\(wish\.content/u.test(decideBody),
);
assert("  └ 첨부를 id 그대로 다시 넘김", decideBody.includes("attachments: retained(interaction.message)"));
assert("  └ 버튼은 눌리지 않는 상태로", decideBody.includes("wishDecidedRows(accepted)"));
assert(
  "옛 임베드 메시지는 components 만 바꿈",
  decideBody.includes("MessageFlags.IsComponentsV2") &&
    decideBody.includes("interaction.update({ components: wishDecidedRows(accepted) })"),
);
assert("신청자에게 DM 도 보냄", decideBody.includes("notifyWisher("));

// 답글 안에서 유저는 멘션으로 가리켜야 한다.
assert(
  "결과 답글의 신청자·관리자는 멘션",
  decideBody.includes('value: `<@${wish.userId}>`') &&
    decideBody.includes('value: `<@${interaction.user.id}>`'),
);

console.log("\n=== 9. customId 중복 검사 (디스코드가 400 으로 거부하는 조건) ===");

function assertUnique(label, rows) {
  const ids = rows
    .flatMap((r) => r.toJSON().components)
    .map((c) => c.custom_id)
    .filter((id) => id !== undefined);

  const duplicated = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert(label, duplicated.length === 0, `중복: ${duplicated.join(", ")}`);
}

// 페이지가 1개일 때 이전/다음이 같은 id 가 되던 버그의 회귀 검사.
for (const sort of ["tickets", "fragments"]) {
  for (const [page, pageCount] of [[0, 0], [0, 1], [0, 3], [1, 3], [2, 3], [5, 1]]) {
    assertUnique(`rankRows(${sort}, ${page}쪽 / 전체 ${pageCount})`, panels.rankRows(sort, page, pageCount));
  }
}

const decidedAccept = check("wishDecidedRows(수락)", () =>
  panels.wishDecidedRows(true).map((r) => r.toJSON()),
);
if (decidedAccept) {
  const button = decidedAccept[0].components[0];
  assert("  └ 눌리지 않는 상태 표시", button.disabled === true && button.label === "수락됨", JSON.stringify(button));
  assert("  └ 수락은 초록(Success=3)", button.style === 3, `${button.style}`);
}
const decidedReject = panels.wishDecidedRows(false).map((r) => r.toJSON());
assert("wishDecidedRows(거절)은 빨강(Danger=4)", decidedReject[0].components[0].style === 4);

assertUnique("wishDecidedRows()", panels.wishDecidedRows(true));
assertUnique("userPanelRows()", panels.userPanelRows());
assertUnique("adminPanelRows()", panels.adminPanelRows());
assertUnique("checkRows()", panels.checkRows(A, false));
assertUnique("wishDecisionRows()", panels.wishDecisionRows("abcd1234"));

// 컨테이너 전체(여러 줄을 합친 상태)에서도 겹치면 안 된다.
const rankContainer = buildContainer({
  status: "success",
  title: "랭킹",
  user: fakeUser,
  rows: panels.rankRows("tickets", 0, 1),
}).toJSON();
const containerIds = rankContainer.components
  .filter((c) => c.type === 1)
  .flatMap((row) => row.components.map((c) => c.custom_id))
  .filter(Boolean);
assert(
  "컨테이너 안 전체 customId 유일",
  new Set(containerIds).size === containerIds.length,
  containerIds.join(", "),
);

finish();
