// /서ser버ber정jung보bow · /프로필쀼 검증.
import { DIST, PROJECT, assert, finish } from "./_harness.mjs";

process.chdir(PROJECT);

const { readFileSync } = await import("node:fs");


const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

console.log("\n=== 1. 커맨드 등록 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const commands = await collectCommands();

const server = commands.find((c) => c.data.name === "서ser버ber정jung보bow");
const profile = commands.find((c) => c.data.name === "프로필쀼");

assert("/서ser버ber정jung보bow 등록됨", server !== undefined, commands.map((c) => c.data.name).join(","));
assert("/프로필쀼 등록됨", profile !== undefined);

const serverJson = server.data.toJSON();
const profileJson = profile.data.toJSON();

// 디스코드 커맨드 이름 규칙: 소문자·숫자·밑줄·하이픈·글자, 1~32자.
const NAME = /^[-_\p{L}\p{N}]{1,32}$/u;
for (const [label, json] of [["서버정보", serverJson], ["프로필", profileJson]]) {
  assert(`${label} — 이름이 규칙에 맞음`, NAME.test(json.name), json.name);
  assert(`  └ 대문자가 없음`, json.name === json.name.toLowerCase(), json.name);
  assert(`  └ 서버 전용`, JSON.stringify(json.contexts) === "[0]");
  assert(`  └ 아무나 쓸 수 있음`, json.default_member_permissions == null, `${json.default_member_permissions}`);
}

assert("서버정보 — 옵션 없음", (serverJson.options ?? []).length === 0);
assert("프로필 — 유저 옵션 하나", (profileJson.options ?? []).length === 1 && profileJson.options[0].name === "유저");
assert("  └ 선택 항목 (비우면 자신)", !profileJson.options[0].required);
assert("  └ USER 타입(6)", profileJson.options[0].type === 6);

console.log("\n=== 2. 값 다듬기 ===");
const fmt = await import(`${DIST}/info/format.js`);

assert("천 단위 구분", fmt.count(1234567) === "1,234,567", fmt.count(1234567));
assert("  └ 세 자리 이하는 그대로", fmt.count(999) === "999");
assert("  └ 0", fmt.count(0) === "0");
assert("빈 값은 「없음」", fmt.orNone(null) === "없음" && fmt.orNone("") === "없음" && fmt.orNone(undefined) === "없음");
assert("  └ 값이 있으면 그대로", fmt.orNone("있음") === "있음");

// enum 을 숫자 그대로 내보내지 않는지.
assert("부스트 단계를 말로", fmt.premiumTier(2) === "2단계");
assert("모르는 값도 숫자로 새지 않음", fmt.premiumTier(99) === "알 수 없음");

// 뺀 항목의 도우미도 같이 지웠는지 (죽은 코드를 남기지 않는다).
for (const gone of ["verificationLevel", "contentFilter", "notifications", "mfaLevel", "nsfwLevel", "features"]) {
  assert(`  └ ${gone} 은 제거됨`, fmt[gone] === undefined);
}

console.log("\n=== 3. 화면 ===");
const { buildContainer } = await import(`${DIST}/ui/response.js`);
const { serverView, profileView } = await import(`${DIST}/info/views.js`);

const user = { username: "테스터" };
const GUILD = "111111111111111111";

const fakeGuild = {
  id: GUILD,
  name: "요땅그래",
  ownerId: "222222222222222222",
  createdAt: new Date(1_700_000_000_000),
  memberCount: 1234,
  channels: { cache: new Map([["a", { type: 0, isThread: () => false }], ["b", { type: 2, isThread: () => false }]]) },
  roles: { cache: { size: 25 } },
  emojis: { cache: { size: 48 } },
  stickers: { cache: { size: 3 } },
  premiumTier: 2,
  premiumSubscriptionCount: 14,
  verificationLevel: 2,
  explicitContentFilter: 2,
  mfaLevel: 0,
  nsfwLevel: 0,
  defaultMessageNotifications: 1,
  afkChannelId: "333333333333333333",
  afkTimeout: 300,
  systemChannelId: "444444444444444444",
  rulesChannelId: null,
  vanityURLCode: null,
  preferredLocale: "ko",
  features: ["COMMUNITY", "BANNER", "UNKNOWN_THING"],
  description: null,
  iconURL: () => "https://cdn.discordapp.com/icons/1/a.png",
  bannerURL: () => null,
};

// 본문이 Section(9) 안으로 들어간다 — 썸네일이 옆에 붙기 때문.
const textOf = (json) => {
  const head = json.components[0];
  return head.type === 9 ? head.components[0].content : head.content;
};

const serverBody = buildContainer(serverView(fakeGuild, user)).toJSON();
const serverText = textOf(serverBody);

assert("서버 — 파랑(정보)", serverBody.accent_color === 0x5865f2);
assert("  └ 제목", serverText.startsWith("### 서버 정보"), serverText.slice(0, 40));
assert("  └ 이름과 id 를 내용에", serverText.includes("**요땅그래** · `111111111111111111`"));
assert("  └ 「서버」 칸을 또 두지 않음", !serverText.includes("**서버**\n"), "내용이 이미 말했다");
assert("  └ 소유자는 멘션", serverText.includes("<@222222222222222222>"));
assert("  └ 만든 날은 타임스탬프", /\*\*만든 날\*\*\n<t:\d+:F>/u.test(serverText), serverText);
assert("  └ 채널은 멘션", serverText.includes("<#333333333333333333>"));
assert("  └ 멤버 수에 천 단위", serverText.includes("**1,234명**"));
assert("  └ 값이 없는 칸은 만들지 않음", !serverText.includes("규칙 채널") && !serverText.includes("맞춤 초대"));

// 뺀 항목들.
for (const gone of ["보안", "기본 알림", "언어", "기능"]) {
  assert(`  └ 「${gone}」 을 빼냄`, !serverText.includes(`**${gone}**`), serverText);
}

console.log("\n=== 3-1. 이미지 배치 (순서 규칙의 예외) ===");
assert("아이콘은 본문 옆 썸네일", serverBody.components[0].type === 9, `${serverBody.components[0].type}`);
assert("  └ 썸네일 자리에 아이콘", serverBody.components[0].accessory?.media?.url === "https://cdn.discordapp.com/icons/1/a.png", JSON.stringify(serverBody.components[0].accessory));
assert("  └ 배너가 없으면 큰 이미지도 없음", !serverBody.components.some((c) => c.type === 12));

const withBanner = buildContainer(
  serverView({ ...fakeGuild, bannerURL: () => "https://cdn.discordapp.com/banners/1/c.png" }, user),
).toJSON();
assert("배너는 아래 큰 이미지로", withBanner.components.some((c) => c.type === 12));
assert("  └ 썸네일과 따로", withBanner.components[0].type === 9);
assert(
  "  └ 배너 → 가로줄 → footer",
  withBanner.components.map((c) => c.type).join(",").endsWith("12,14,10"),
  withBanner.components.map((c) => c.type).join(","),
);

const noIcon = buildContainer(serverView({ ...fakeGuild, iconURL: () => null }, user)).toJSON();
assert("아이콘이 없으면 썸네일도 없음", noIcon.components[0].type === 10, `${noIcon.components[0].type}`);

const role = (id, position, name) => ({
  id,
  position,
  name,
  toString: () => (id === GUILD ? "@everyone" : `<@&${id}>`),
});

const fakeMember = {
  id: "555555555555555555",
  guild: { id: GUILD },
  nickname: "마이즌",
  joinedAt: new Date(1_710_000_000_000),
  premiumSince: null,
  isCommunicationDisabled: () => false,
  communicationDisabledUntil: null,
  displayAvatarURL: () => "https://cdn.discordapp.com/avatars/5/b.png",
  user: {
    username: "maijeun",
    globalName: "MAIJEUN",
    bot: false,
    createdAt: new Date(1_600_000_000_000),
  },
  permissions: { has: (flag) => flag === 8n },
  roles: {
    cache: new Map([
      [GUILD, role(GUILD, 0, "@everyone")],
      ["666666666666666666", role("666666666666666666", 5, "관리자")],
    ]),
    highest: role("666666666666666666", 5, "관리자"),
  },
};

const profileBody = buildContainer(profileView(fakeMember, null, user)).toJSON();
const profileText = textOf(profileBody);

assert("프로필 — 파랑(정보)", profileBody.accent_color === 0x5865f2);
assert("  └ 제목", profileText.startsWith("### 프로필"));
assert("  └ 대상을 멘션으로 내용에", profileText.includes("<@555555555555555555> · `555555555555555555`"));
assert("  └ 「유저」 칸을 또 두지 않음", !profileText.includes("**유저**\n"), "내용이 이미 말했다");
assert("  └ 계정 만든 날은 타임스탬프", /\*\*계정 만든 날\*\*\n<t:\d+:F>/u.test(profileText), profileText);
assert("  └ 서버 참가도 타임스탬프", /\*\*서버 참가\*\*\n<t:\d+:F>/u.test(profileText));
assert("  └ 역할은 멘션", profileText.includes("<@&666666666666666666>"));
assert("  └ @everyone 은 세지 않음", profileText.includes("역할 (1개)"), profileText);
assert("  └ 값이 없는 칸은 만들지 않음", !profileText.includes("부스트 시작") && !profileText.includes("타임아웃"));
assert("  └ 봇이 아니면 봇 칸 없음", !profileText.includes("**봇**"));

for (const gone of ["최고 역할", "주요 권한"]) {
  assert(`  └ 「${gone}」 을 빼냄`, !profileText.includes(`**${gone}**`), profileText);
}

assert("아바타는 본문 옆 썸네일", profileBody.components[0].type === 9);
assert("  └ 썸네일 자리에 아바타", profileBody.components[0].accessory?.media?.url.includes("avatars/5/b.png"));
assert("  └ 배너가 없으면 큰 이미지도 없음", !profileBody.components.some((c) => c.type === 12));

const withUserBanner = buildContainer(profileView(fakeMember, "https://cdn/banner.png", user)).toJSON();
assert("배너는 아래 큰 이미지로", withUserBanner.components.some((c) => c.type === 12));

// 타임아웃이 걸린 사람은 그 시각을 타임스탬프로.
const timedOut = textOf(
  buildContainer(
    profileView(
      { ...fakeMember, isCommunicationDisabled: () => true, communicationDisabledUntil: new Date(1_800_000_000_000) },
      null,
      user,
    ),
  ).toJSON(),
);
assert("타임아웃은 타임스탬프로", /\*\*타임아웃\*\*\n<t:1800000000:F>/u.test(timedOut), timedOut);

console.log("\n=== 4. 규칙 ===");
const views = read("src/info/views.ts");
const format = read("src/info/format.ts");

assert("시각은 time.ts 를 지남", views.includes('from "../time.js"'));
assert("  └ 날짜를 손으로 찍지 않음", !/toLocale|toISOString/u.test(views + format));
assert("색을 직접 정하지 않음", !/0x[0-9a-f]{6}/u.test(views + format));
assert("정보성이라 파랑", (views.match(/status: "info"/gu) ?? []).length === 2);

for (const rel of ["src/commands/server-info.ts", "src/commands/profile.ts"]) {
  const text = read(rel);
  assert(`${rel} — 렌더러를 지남`, /response\(|editResponse\(/u.test(text));
  assert(`  └ flags 를 손으로 넣지 않음`, !text.includes("flags:"), text);
}

finish();
