// 응답 형식 규칙 검증.
//
//   1. 모든 응답은 Components V2 — 컨테이너 하나
//   2. 색은 초록/노랑/빨강/파랑 네 가지
//   3. 순서: 제목·내용·변동 → [가로줄 → 이미지/파일] → [가로줄 → 인터랙션] → 가로줄 → footer
import { DIST, PROJECT, assert, finish } from "./_harness.mjs";

process.chdir(PROJECT);

const { readFileSync } = await import("node:fs");
const { createRequire } = await import("node:module");
const requireFromProject = createRequire(`${PROJECT}/package.json`);
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = requireFromProject("discord.js");


const TYPE = {
  1: "ActionRow",
  9: "Section",
  10: "TextDisplay",
  12: "MediaGallery",
  13: "File",
  14: "Separator",
  17: "Container",
};
const shape = (list) => list.map((c) => TYPE[c.type] ?? `type${c.type}`).join(" → ");

const { buildContainer, response, updateResponse, editResponse, channelMessage, messageEdit } = await import(
  `${DIST}/ui/response.js`
);

const user = { username: "테스터" };
const row = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("x").setLabel("버튼").setStyle(ButtonStyle.Primary),
  );

const base = { status: "success", title: "제목", description: "내용", user };

// ── 1. 색상 ────────────────────────────────────────────────
console.log("\n=== 색상 ===");
const EXPECTED = { success: 0x57f287, progress: 0xfee75c, failure: 0xed4245, info: 0x5865f2 };
for (const [status, color] of Object.entries(EXPECTED)) {
  const json = buildContainer({ ...base, status }).toJSON();
  assert(`${status} → #${color.toString(16)}`, json.accent_color === color, `${json.accent_color}`);
}
assert(
  "네 가지 외의 색은 소스에 없음",
  (readFileSync(`${PROJECT}/src/ui/response.ts`, "utf8").match(/0x[0-9a-f]{6}/gu) ?? []).length === 4,
);

// ── 2. 순서 ────────────────────────────────────────────────
console.log("\n=== 순서 ===");

const plain = buildContainer(base).toJSON();
assert("최소 형태 — 본문 → 가로줄 → footer", shape(plain.components) === "TextDisplay → Separator → TextDisplay", shape(plain.components));

const withRows = buildContainer({ ...base, rows: [row()] }).toJSON();
assert(
  "인터랙션 — 본문 → 가로줄 → 인터랙션 → 가로줄 → footer",
  shape(withRows.components) === "TextDisplay → Separator → ActionRow → Separator → TextDisplay",
  shape(withRows.components),
);

const withImages = buildContainer({ ...base, images: ["attachment://a.png", "attachment://b.png"] }).toJSON();
assert(
  "이미지 — 본문 → 가로줄 → 묶음 → 가로줄 → footer",
  shape(withImages.components) === "TextDisplay → Separator → MediaGallery → Separator → TextDisplay",
  shape(withImages.components),
);
assert("이미지는 묶음 하나에 담김", withImages.components[2].items.length === 2);

const full = buildContainer({
  ...base,
  images: ["attachment://a.png"],
  files: ["attachment://b.zip"],
  rows: [row()],
}).toJSON();
assert(
  "전체 — 본문 → 가로줄 → 묶음 → 파일 → 가로줄 → 인터랙션 → 가로줄 → footer",
  shape(full.components) ===
    "TextDisplay → Separator → MediaGallery → File → Separator → ActionRow → Separator → TextDisplay",
  shape(full.components),
);

// 이미지·인터랙션의 자리는 권장일 뿐이다 — 어울리면 바꿔도 된다.
console.log("\n=== 배치 바꾸기 ===");
const swapped = buildContainer({
  ...base,
  images: ["attachment://a.png"],
  rows: [row()],
  order: ["rows", "images"],
}).toJSON();
assert(
  "인터랙션을 먼저 둘 수 있음",
  shape(swapped.components) === "TextDisplay → Separator → ActionRow → Separator → MediaGallery → Separator → TextDisplay",
  shape(swapped.components),
);

const partial = buildContainer({
  ...base,
  images: ["attachment://a.png"],
  rows: [row()],
  order: ["rows"],
}).toJSON();
assert(
  "하나만 적어도 나머지가 사라지지 않음",
  shape(partial.components) === shape(swapped.components),
  shape(partial.components),
);

const defaultOrder = buildContainer({ ...base, images: ["attachment://a.png"], rows: [row()] }).toJSON();
assert(
  "안 적으면 권장 순서 (이미지 → 인터랙션)",
  shape(defaultOrder.components) === "TextDisplay → Separator → MediaGallery → Separator → ActionRow → Separator → TextDisplay",
  shape(defaultOrder.components),
);
assert("footer 는 어느 배치에서도 맨 끝", [swapped, partial, defaultOrder].every((c) => c.components.at(-1).content.startsWith("-# @")));
assert("  └ 그 위는 늘 가로줄", [swapped, partial, defaultOrder].every((c) => c.components.at(-2).type === 14));

console.log("\n=== 액세서리 ===");
const accessory = buildContainer({ ...base, accessoryButton: new ButtonBuilder().setCustomId("c").setLabel("취소").setStyle(ButtonStyle.Danger) }).toJSON();
assert("액세서리 버튼은 제목과 같은 줄(Section)", accessory.components[0].type === 9, shape(accessory.components));
assert("  └ 버튼이 액세서리 자리에 있음", accessory.components[0].accessory?.type === 2);

// ── 3. 본문 구성 ───────────────────────────────────────────
console.log("\n=== 제목 · 내용 · 변동 ===");
const body = buildContainer({
  ...base,
  fields: [{ name: "권한", value: "켜짐 → **꺼짐**" }],
  balance: "소원권: 3장 → 4장",
}).toJSON().components[0].content;

assert("제목이 맨 위", body.startsWith("### 제목"));
assert("내용이 그다음", body.indexOf("내용") > body.indexOf("### 제목"));
assert("변동이 내용 뒤", body.indexOf("**권한**") > body.indexOf("내용"));
assert("소원권 변동이 변동 맨 끝", body.indexOf("소원권: 3장") > body.indexOf("**권한**"));
assert("한 덩어리로 합쳐짐 (가로줄로만 구역을 나눔)", buildContainer({ ...base, fields: [{ name: "권한", value: "x" }] }).toJSON().components.length === 3);

// ── 3-1. 오류는 내용에 `코드` 로 ─────────────────────────────
console.log("\n=== 내용 안의 오류 ===");

function errored(error) {
  return buildContainer({ ...base, status: "failure", error }).toJSON();
}

const oneLine = errored(new Error("boom"));
assert("오류가 내용에 들어감", oneLine.components[0].content.includes("`Error: boom`"), oneLine.components[0].content);
assert("  └ 컨테이너는 하나 그대로", oneLine.components.filter((c) => c.type === 14).length === 1);
assert(
  "  └ 코드블록(```)이 아니라 인라인 코드",
  !oneLine.components[0].content.includes("```"),
);
assert(
  "  └ 내용 다음, 변동 앞",
  (() => {
    const text = buildContainer({
      ...base,
      status: "failure",
      error: new Error("boom"),
      fields: [{ name: "역할", value: "`@손님`" }],
    }).toJSON().components[0].content;
    return text.indexOf("내용") < text.indexOf("`Error: boom`") && text.indexOf("`Error: boom`") < text.indexOf("**역할**");
  })(),
);

const fiveLines = errored(new Error("1\n2\n3\n4\n5"));
const codeLines = (fiveLines.components[0].content.match(/^`.*`$/gmu) ?? []);
assert("최대 3줄", codeLines.length === 3, codeLines.join(" | "));
assert("  └ 넘치면 ... 표시", codeLines.at(-1).includes("..."), codeLines.at(-1));
assert("  └ 줄마다 코드로 감쌈", codeLines.every((line) => line.startsWith("`") && line.endsWith("`")));

const fenced = errored(new Error("```rm -rf```"));
assert("코드펜스는 중화", !fenced.components[0].content.includes("```"));

const stacked = new Error("boom");
assert("스택은 새 나가지 않음", !errored(stacked).components[0].content.includes("at "));
assert("오류가 없으면 아무것도 안 붙음", !buildContainer(base).toJSON().components[0].content.includes("`"));

// ── 3-2. 변동 칸 ────────────────────────────────────────────
console.log("\n=== 변동 칸 ===");

const bodyOf = (options) => {
  const head = buildContainer(options).toJSON().components[0];
  return head.type === 9 ? head.components[0].content : head.content;
};

const two = bodyOf({
  ...base,
  fields: [
    { name: "대상", value: "@마이즌" },
    { name: "채널", value: "#일반" },
  ],
});

assert("항목은 이름과 값을 줄로 나눔", two.includes("**대상**\n@마이즌"), two);
assert("  └ 항목 사이는 빈 줄", two.includes("@마이즌\n\n**채널**"), two);

// inline 은 임베드 시절의 잔재다 — 컨테이너에는 좌우 배치가 없어 아무 영향이 없어야 한다.
const inlined = bodyOf({
  ...base,
  fields: [
    { name: "대상", value: "@마이즌", inline: true },
    { name: "채널", value: "#일반", inline: true },
  ],
});
assert("inline 을 켜도 모양이 같음", inlined === two, inlined);
assert("  └ 한 줄에 이어 붙이지 않음", !inlined.includes("│"), inlined);

// 소원권 변동 문구는 언제나 변동 맨 끝에.
const withBalance = bodyOf({
  ...base,
  fields: [{ name: "대상", value: "@마이즌" }],
  balance: "소원권: 3장 → 4장",
});
assert("소원권 변동은 맨 끝", withBalance.endsWith("소원권: 3장 → 4장"), withBalance);

// ── 4. footer ──────────────────────────────────────────────
console.log("\n=== footer ===");
const footer = plain.components.at(-1);
assert("맨 아래가 footer", footer.type === 10);
assert("작은 글씨 + @이름", footer.content === "-# @테스터", footer.content);
assert("프로필 이미지 없음", !JSON.stringify(plain).includes("avatar"));
assert("바로 위가 가로줄", plain.components.at(-2).type === 14);

// ── 5. 페이로드 ────────────────────────────────────────────
console.log("\n=== 페이로드 ===");
const V2 = MessageFlags.IsComponentsV2;

for (const [name, payload] of [
  ["response", response(base)],
  ["updateResponse", updateResponse(base)],
  ["editResponse", editResponse(base)],
  ["channelMessage", channelMessage(base)],
  ["messageEdit", messageEdit(base)],
]) {
  const flags = payload.flags ?? [];
  assert(`${name} — IsComponentsV2`, flags.includes(V2), JSON.stringify(flags));
  assert(`  └ embeds 를 싣지 않음`, payload.embeds === undefined);
  assert(`  └ content 를 싣지 않음`, payload.content === undefined);
  assert(`  └ 컨테이너 하나`, payload.components.length === 1 && payload.components[0].toJSON().type === 17);
  // 멘션은 보이되 알림은 가지 않아야 한다. 답장도 원본 작성자를 울리면 안 된다.
  assert(
    `  └ 멘션 알림을 막음`,
    JSON.stringify(payload.allowedMentions) === '{"parse":[],"repliedUser":false}',
    JSON.stringify(payload.allowedMentions),
  );
}

assert("response 기본은 임시 메시지", response(base).flags.includes(MessageFlags.Ephemeral));
assert("  └ ephemeral: false 면 공개", !response({ ...base, ephemeral: false }).flags.includes(MessageFlags.Ephemeral));

// ── 6. 실제 화면들 ─────────────────────────────────────────
//
// 규칙을 지키는지 한 화면씩 실제로 그려서 본다. 지켜야 하는 것:
//   컨테이너 하나 · 네 색 중 하나 · 제목이 맨 위(### )
//   footer 는 맨 아래 `-# @이름` 이고 그 위는 가로줄
//   시각은 타임스탬프 마크다운, 이름은 글자가 아니라 멘션
console.log("\n=== 실제 화면 ===");
const ALLOWED = new Set(Object.values(EXPECTED));
const TIMESTAMP = /<t:\d+:[tTdDfFR]>/u;

function checkView(label, view) {
  const json = buildContainer(view).toJSON();
  const list = json.components;
  const head = list[0];
  const text = head.type === 9 ? head.components[0].content : head.content;

  const problems = [];

  if (!ALLOWED.has(json.accent_color)) problems.push(`색 ${json.accent_color}`);
  if (head.type !== 10 && head.type !== 9) problems.push(`첫 요소 ${shape([head])}`);
  if (!text.startsWith("### ")) problems.push("제목이 ### 로 시작하지 않음");
  if (list.at(-1).type !== 10) problems.push("맨 아래가 footer 가 아님");
  else if (!list.at(-1).content.startsWith("-# @")) problems.push(`footer ${list.at(-1).content}`);
  if (list.at(-2)?.type !== 14) problems.push("footer 앞에 가로줄이 없음");

  // 날짜를 글자로 적으면 안 된다. 타임스탬프 마크다운이 있으면 그건 예외.
  const plainDate = /\d{4}년|\d{4}-\d{2}-\d{2}|\d{1,2}월 \d{1,2}일/u;
  if (plainDate.test(text.replace(TIMESTAMP, ""))) problems.push("날짜를 글자로 적음");

  // 유저·역할·채널 이름을 글자로 적으면 안 된다 (footer 는 위에서 따로 봤다).
  // 멘션(<@id> · <@&id> · <#id>)과 @everyone·@here 를 먼저 걷어낸 뒤 남은 @ 를 본다.
  const withoutMentions = text
    .replace(/<@[&!]?\d+>/gu, "")
    .replace(/<#\d+>/gu, "")
    .replaceAll("@everyone", "")
    .replaceAll("@here", "");

  if (/@[가-힣A-Za-z0-9_]+/u.test(withoutMentions)) problems.push("이름을 글자로 적음");

  assert(label, problems.length === 0, `${problems.join(" / ")} — ${shape(list)}`);
}

// 소원권 — 저장소를 쓰므로 임시 폴더에서 돌린다.
const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const nodePath = await import("node:path");

const sandbox = mkdtempSync(nodePath.join(tmpdir(), "rules-"));
process.chdir(sandbox);

const wishViews = await import(`${DIST}/wish/views.js`);
const { noticeView } = wishViews;
const G = "111111111111111111";
const withId = { ...user, id: "222222222222222222" };

checkView("소원권 — 유저 패널", await wishViews.panelView(G, "user", withId, false));
checkView("소원권 — 관리자 패널", await wishViews.panelView(G, "admin", withId, true));
checkView("소원권 — 확인", await wishViews.checkView(G, withId.id, withId));
checkView("소원권 — 랭킹", await wishViews.rankView(G, "tickets", 0, withId));
checkView("소원권 — 결과", noticeView({ status: "success", title: "제작 완료", user, panel: "user" }));
checkView(
  "소원권 — 결과 (변동)",
  noticeView({ status: "failure", title: "실패", balance: "소원권: 1장 → 0장", user, panel: "admin" }),
);
checkView(
  "소원권 — 결과 (오류)",
  noticeView({ status: "failure", title: "실패", error: new Error("boom"), user, panel: "user" }),
);

process.chdir(PROJECT);

const { preparingView, progressView, resultView } = await import(`${DIST}/nickname/views.js`);
const nickOptions = { mode: "dduttai", nickname: "뚜따", expiresAt: Date.now() + 60_000, targetIds: [], user };
const run = { id: "r1", cancelled: false, cancelledBy: null, supersededBy: null };

checkView("별명 — 준비 중", preparingView(nickOptions, run));
checkView("별명 — 진행 중", progressView(nickOptions, { total: 10, done: 4, changed: 3, skipped: 1, failed: 0 }, run));
checkView("별명 — 완료", resultView(nickOptions, { total: 10, done: 10, changed: 9, skipped: 0, failed: 1, cancelled: false, failures: [] }));
checkView("별명 — 취소됨", resultView(nickOptions, { total: 10, done: 4, changed: 4, skipped: 0, failed: 0, cancelled: true, failures: [] }, run));
checkView("별명 — 대상 지정", progressView({ ...nickOptions, targetIds: ["333333333333333333"] }, { total: 1, done: 1, changed: 1, skipped: 0, failed: 0 }, null));

const attendance = await import(`${DIST}/attendance/views.js`);
const record = { userId: withId.id, total: 12, streak: 3, lastDate: "2026-07-28" };

checkView("출헉 — 오늘의 출헉", attendance.todayView(record, user));
checkView("출헉 — 덤", attendance.todayView(null, user, "abcd1234"));
checkView("출헉 — 이미 올림", attendance.alreadyView("[오늘의 출헉](https://x)", "abcd1234", user));
checkView("출헉 — 성공", attendance.successView(record, "소원권 조각: 0개 → 1개", user));
checkView("출헉 — 덤 성공", attendance.extraSuccessView(withId));

// 서버·프로필 — 가짜 값으로 그려만 본다 (자세한 검사는 info-check).
const { serverView, profileView } = await import(`${DIST}/info/views.js`);
const roleOf = (id) => ({ id, position: 1, toString: () => `<@&${id}>` });

checkView("서버 정보", serverView({
  id: "111111111111111111", name: "요땅그래", ownerId: "222222222222222222",
  createdAt: new Date(1_700_000_000_000), memberCount: 1234,
  channels: { cache: new Map([["a", { type: 0, isThread: () => false }]]) },
  roles: { cache: { size: 3 } }, emojis: { cache: { size: 1 } }, stickers: { cache: { size: 0 } },
  premiumTier: 0, premiumSubscriptionCount: 0, verificationLevel: 0, explicitContentFilter: 0,
  mfaLevel: 0, nsfwLevel: 0, defaultMessageNotifications: 0,
  afkChannelId: null, systemChannelId: null, rulesChannelId: null, vanityURLCode: null,
  afkTimeout: 300, preferredLocale: "ko", features: [], description: null,
  iconURL: () => null, bannerURL: () => null,
}, user));

checkView("프로필", profileView({
  id: "555555555555555555", guild: { id: "111111111111111111" }, nickname: null,
  joinedAt: new Date(1_710_000_000_000), premiumSince: null,
  isCommunicationDisabled: () => false, communicationDisabledUntil: null,
  displayAvatarURL: () => "https://cdn.discordapp.com/avatars/5/b.png",
  user: { username: "maijeun", globalName: null, bot: false, createdAt: new Date(1_600_000_000_000) },
  permissions: { has: () => false },
  roles: { cache: new Map([["111111111111111111", roleOf("111111111111111111")]]), highest: roleOf("111111111111111111") },
}, null, user));

const { endNoticeView } = await import(`${DIST}/ui/end-notice.js`);
const until = new Date(1_800_000_000_000);

checkView("종료 안내 — 만료", endNoticeView({ effect: "타임아웃", target: `<@${withId.id}>`, until, reason: { kind: "expired" }, user }));
checkView("종료 안내 — 해제", endNoticeView({ effect: "타살버", target: `<@${withId.id}>`, until, reason: { kind: "released", byId: "444444444444444444" }, user }));
checkView("종료 안내 — 서버 전원", endNoticeView({ effect: "뚜따이", target: "**서버 전원**", until, reason: { kind: "expired" }, user }));
checkView(
  "종료 안내 — 뒷정리 실패",
  endNoticeView({
    effect: "뚜따이", target: "**서버 전원**", until, reason: { kind: "expired" },
    outcome: { status: "progress", fields: [{ name: "집계", value: "전체 **10명** · 완료 **9명** · 실패 **1명**" }] },
    user,
  }),
);

// ── 7. 소스 전수 검사 ──────────────────────────────────────
console.log("\n=== 소스 전수 검사 ===");
const { globSync } = await import("node:fs");
const sources = globSync("src/**/*.ts", { cwd: PROJECT }).map((found) => ({
  // 윈도우에서는 역슬래시로 돌아온다.
  rel: found.replaceAll("\\", "/"),
  text: readFileSync(`${PROJECT}/${found}`, "utf8"),
}));
assert("소스를 읽었음", sources.length > 20, `${sources.length}개`);

const embedUsers = sources.filter((f) => /EmbedBuilder|setFooter|addFields\(/u.test(f.text));
assert("임베드를 쓰는 파일 없음", embedUsers.length === 0, embedUsers.map((f) => f.rel).join(", "));

const layoutUsers = sources.filter((f) => /layout:\s*"/u.test(f.text));
assert("layout 옵션이 남아 있지 않음", layoutUsers.length === 0, layoutUsers.map((f) => f.rel).join(", "));

const statuses = new Set();
for (const file of sources) {
  for (const match of file.text.matchAll(/status:\s*"([a-z]+)"/gu)) statuses.add(match[1]);
}
// wish/store.ts 의 소원 상태(pending/accepted/rejected)는 색과 무관한 도메인 값이다.
const colorStatuses = [...statuses].filter((s) => !["pending", "accepted", "rejected"].includes(s));
assert(
  "쓰이는 status 가 네 가지 안에 있음",
  colorStatuses.every((s) => s in EXPECTED),
  colorStatuses.join(", "),
);

const raw = sources.filter((f) => f.rel !== "src/ui/response.ts" && /setAccentColor|setColor\(/u.test(f.text));
assert("색을 직접 정하는 파일 없음 (렌더러만)", raw.length === 0, raw.map((f) => f.rel).join(", "));

// 오류 문구를 호출부에서 직접 코드블록으로 감싸면 3줄 제한과 형식이 어긋난다.
const handRolled = sources.filter((f) => /name: "원인"/u.test(f.text));
assert("「원인」 필드를 손으로 만드는 파일 없음", handRolled.length === 0, handRolled.map((f) => f.rel).join(", "));

/**
 * 코드블록을 직접 쓰는 곳.
 *
 * 안에서는 멘션이 `<@123…>` 날것으로 나오므로 원칙은 「쓰지 않는다」다. 예외는 둘뿐이고
 * **둘 다 그 대가를 알고 치른 자리**다.
 *
 *   errors.ts   — 오류 원문. 애초에 사람 이름이 없다.
 *   roulette.ts — 회전판. 글꼴 폭이 같아야 줄이 맞고, 줄이 맞아야 도는 것으로 보인다.
 *                 대신 당첨 알림은 칸 밖이라 멘션 그대로다 (바로 아래에서 확인한다).
 */
const FENCE_ALLOWED = new Set(["src/errors.ts", "src/games/list/roulette.ts"]);
const fences = sources.filter((f) => !FENCE_ALLOWED.has(f.rel) && /\\`\\`\\`/u.test(f.text));
assert("코드블록을 직접 쓰는 파일 없음", fences.length === 0, fences.map((f) => f.rel).join(", "));

const wheel = sources.find((f) => f.rel === "src/games/list/roulette.ts");
assert(
  "  └ 룰렛은 예외인 이유를 적어 둠",
  wheel !== undefined && wheel.text.includes("여기만 멘션이 아니다"),
);
assert(
  "  └ 당첨 알림은 칸 밖이라 멘션",
  wheel !== undefined && /description: speak\(`<@\$\{/u.test(wheel.text),
  "결과까지 글자로 적으면 뽑힌 사람이 자기가 불린 줄 모른다",
);

// 유저·역할은 항상 멘션으로. footer(`@사용자명`)와 로그·감사 로그만 예외.
const RESPONSE_TEXT = /(?:description|value|title):\s*[`"][^`"]*@\$\{[^}]*(?:username|displayName|tag|\.name)/u;
const named = sources.filter((f) => RESPONSE_TEXT.test(f.text));
assert("응답에서 이름을 글자로 적는 곳 없음", named.length === 0, named.map((f) => f.rel).join(", "));

const mentionUsers = sources.filter((f) => /<@\$\{/u.test(f.text)).map((f) => f.rel);
assert(
  "유저를 가리키는 곳은 멘션을 씀",
  ["src/wish/views.ts", "src/nickname/views.ts", "src/components/wish.ts", "src/wish/format.ts"].every((rel) =>
    mentionUsers.includes(rel),
  ),
  mentionUsers.join(", "),
);

const chatToggle = sources.find((f) => f.rel === "src/commands/chat-toggle.ts");
assert("역할도 멘션으로 가리킴", chatToggle.text.includes("role.toString()"), "label() 확인");
assert("  └ 역할 이름을 글자로 적지 않음", !chatToggle.text.includes("role.name"));

// 멘션을 쓰는 이상 알림 차단은 렌더러가 책임진다.
const responseSource = sources.find((f) => f.rel === "src/ui/response.ts").text;
assert(
  "렌더러가 알림을 막음",
  /NO_PINGS[^=]*=\s*\{\s*parse:\s*\[\],\s*repliedUser:\s*false\s*\}/u.test(responseSource),
);
assert(
  "  └ 다섯 페이로드 모두에 적용",
  (responseSource.match(/allowedMentions: NO_PINGS/gu) ?? []).length === 5,
);
const ownMentions = sources.filter(
  (f) => f.rel !== "src/ui/response.ts" && /allowedMentions/u.test(f.text),
);
assert("호출부가 직접 정하지 않음", ownMentions.length === 0, ownMentions.map((f) => f.rel).join(", "));

// 시각·남은 시간은 반드시 타임스탬프 마크다운으로. logger 는 콘솔 출력이라 예외.
console.log("\n=== 시간 표기 ===");
const HAND_ROLLED_DATE =
  /toLocale(?:Date|Time)?String|toISOString|toUTCString|toDateString|Intl\.DateTimeFormat|get(?:FullYear|Month|Hours|Minutes|Seconds)\(/u;
// logger 는 콘솔 출력, time.ts 는 「같은 날인가」를 재는 곳이다 (화면에는 마크다운만 나간다).
const DATE_ALLOWED = new Set(["src/logger.ts", "src/time.ts"]);
const handDates = sources.filter((f) => !DATE_ALLOWED.has(f.rel) && HAND_ROLLED_DATE.test(f.text));
assert("날짜를 손으로 찍는 파일 없음", handDates.length === 0, handDates.map((f) => f.rel).join(", "));

// 예외를 뒀으니, 그 날짜가 화면으로 새지 않는지도 본다.
const attendanceViews = sources.find((f) => f.rel === "src/attendance/views.ts");
assert(
  "  └ 출헉 화면은 날짜를 그대로 적지 않음",
  attendanceViews !== undefined && !/lastDate|dateKey|\.date\b/u.test(attendanceViews.text),
  "날짜를 보여 줘야 한다면 타임스탬프 마크다운을 써야 한다",
);

const timeSource = sources.find((f) => f.rel === "src/time.ts").text;
assert("타임스탬프 함수는 time.ts 에만", timeSource.includes('from "discord.js"') && timeSource.includes("TimestampStyles"));
const rawTimeUsers = sources.filter(
  (f) => f.rel !== "src/time.ts" && /\btime\(|TimestampStyles/u.test(f.text),
);
assert("호출부는 time.ts 를 거침", rawTimeUsers.length === 0, rawTimeUsers.map((f) => f.rel).join(", "));

// 실제로 마크다운이 나오는지.
const { at, countdown, atWithCountdown } = await import(`${DIST}/time.js`);
const moment = new Date(1_800_000_000_000); // 2027-01-15T08:00:00Z
const seconds = Math.floor(moment.getTime() / 1000);

assert("at() 은 <t:초:F>", at(moment) === `<t:${seconds}:F>`, at(moment));
assert("countdown() 은 <t:초:R>", countdown(moment) === `<t:${seconds}:R>`, countdown(moment));
// 날짜가 바뀌는 시각이면 시각도 함께, 오늘 안이면 남은 시간만.
assert(
  "atWithCountdown() — 날짜가 바뀌면 둘을 함께",
  atWithCountdown(moment) === `<t:${seconds}:F> (<t:${seconds}:R>)`,
  atWithCountdown(moment),
);

const soon = new Date(Date.now() + 60_000);
const soonSeconds = Math.floor(soon.getTime() / 1000);
const today = soon.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const nowDay = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

if (today === nowDay) {
  assert(
    "  └ 오늘 안이면 남은 시간만",
    atWithCountdown(soon) === `<t:${soonSeconds}:R>`,
    atWithCountdown(soon),
  );
} else {
  // 자정 언저리에 돌린 것이다. 이때는 날짜가 바뀌는 게 맞다.
  assert("  └ 자정을 넘으면 시각도 함께", atWithCountdown(soon).includes(":F>"), atWithCountdown(soon));
}

// 화면에 나가는 시각이 정말 마크다운인지 (TIMESTAMP 는 위 「실제 화면」에서 만들어 둔 것).
const expiring = buildContainer(
  preparingView({ ...nickOptions, expiresAt: moment.getTime() }, run),
).toJSON();
// 액세서리 버튼이 있으면 본문이 Section(9) 안으로 들어간다.
const head = expiring.components[0];
const headText = head.type === 9 ? head.components[0].content : head.content;

assert("별명 자동 바사삭이 타임스탬프 마크다운", TIMESTAMP.test(headText), headText);
assert("  └ 날짜를 글자로 적지 않음", !/\d{4}[-년/]/u.test(headText), headText);
assert("  └ 남은 시간도 함께 (<t:…:R>)", headText.includes(":R>"), headText);

finish();
