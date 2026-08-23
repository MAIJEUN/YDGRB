// /슬로우뿡모드 검증 — 시간 읽기 · 0은 해제 · 한계 · 권한 · 화면.
import { readFileSync } from "node:fs";

import { DIST, PROJECT, assert, finish, speak } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");
const source = read("src/commands/slowmode.ts");

const { MAX_SLOWMODE_SECONDS } = await import(`${DIST}/commands/slowmode.js`);
const { parseDuration, formatDuration } = await import(`${DIST}/time.js`);

// ── 1. 커맨드 ──────────────────────────────────────────────
console.log("\n=== 1. 커맨드 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const command = (await collectCommands()).find((c) => c.data.name === "슬로우뿡모드");

assert("/슬로우뿡모드 등록됨", command !== undefined);

const json = command.data.toJSON();
const option = (json.options ?? [])[0];

assert("옵션은 시간 하나", (json.options ?? []).length === 1 && option.name === "시간", JSON.stringify(json.options));
assert("  └ 필수", option.required === true);
assert("  └ 글자 칸 (「5분」 처럼 적을 수 있어야 한다)", option.type === 3, String(option.type));
assert("서버 전용", JSON.stringify(json.contexts) === "[0]", JSON.stringify(json.contexts));

// ManageChannels = 1 << 4 = 16
assert("채널 관리 권한이 있어야 보임", json.default_member_permissions === "16", json.default_member_permissions);

// ── 2. 시간 읽기 ───────────────────────────────────────────
//
// 기본 단위는 초다. 「30」 은 30초, 「5분」 은 300초.
console.log("\n=== 2. 시간 읽기 ===");
for (const [raw, seconds] of [
  ["30", 30],
  ["5분", 5 * 60],
  ["1시간", 60 * 60],
  ["1분 30", 90],
]) {
  const parsed = parseDuration(raw);
  assert(`${raw} → ${seconds}초`, parsed.ok && parsed.seconds === seconds, JSON.stringify(parsed));
}

// ── 3. 0은 해제 ────────────────────────────────────────────
//
// 기간 파서는 0을 거절한다 — 「0초 동안 타임아웃」 은 뜻이 없기 때문이다.
// 슬로우 모드에서만 그 거절을 해제로 받아 준다.
console.log("\n=== 3. 0은 해제 ===");
{
  const zero = parseDuration("0");
  assert("파서는 0을 거절함", zero.ok === false && zero.reason === "zero", JSON.stringify(zero));
  assert(
    "  └ 여기서만 해제로 받음",
    source.includes('if (parsed.reason === "zero") return { ok: true, seconds: 0 };'),
    "0 을 못 받으면 끄는 방법이 없다",
  );
  assert("  └ 0은 「없음」 이라고 적음", source.includes('seconds === 0 ? "없음"'));
  assert("  └ 껐다고 말해 줌", source.includes("슬로우뿡모드 — 껐습니다"));
}

// ── 4. 한계 ────────────────────────────────────────────────
console.log("\n=== 4. 한계 ===");
assert("디스코드 한계는 여섯 시간", MAX_SLOWMODE_SECONDS === 6 * 60 * 60, String(MAX_SLOWMODE_SECONDS));
assert("  └ 안내에도 그 값이", option.description.includes(formatDuration(MAX_SLOWMODE_SECONDS)), option.description);
assert("  └ 넘으면 막음", source.includes("parsed.seconds > MAX_SLOWMODE_SECONDS"));
assert(
  "  └ 한계를 손으로 적지 않음",
  source.includes("formatDuration(MAX_SLOWMODE_SECONDS)"),
  "표를 고치면 안내도 따라와야 한다",
);

// ── 5. 채널 ────────────────────────────────────────────────
console.log("\n=== 5. 채널 ===");
{
  // 스레드는 부모로 올라가지 않는다 — 슬로우 모드는 스레드가 자기 것을 따로 갖는다.
  assert("부모 채널로 올라가지 않음", !source.includes("isThread()"), "채팅뻥과 다른 점이다");
  assert("슬로우 모드가 있는 채널인지 봄", source.includes('"setRateLimitPerUser" in channel'));
  assert("  └ 없으면 그렇게 말함", source.includes("이 채널에는 슬로우 모드가 없어요"));

  assert("봇 권한을 미리 봄", source.includes("permissionsFor(me).has(PermissionFlagsBits.ManageChannels)"));
  assert("  └ 없으면 무엇이 없는지 적음", source.includes("채널 관리(Manage Channels)"));
}

// ── 6. 화면 ────────────────────────────────────────────────
console.log("\n=== 6. 화면 ===");
{
  assert("바뀐 값을 변동 칸으로", source.includes("name: \"슬로우 모드\""));
  assert("  └ 이전 → 이후", source.includes("${describe(before)} → **${describe(wanted.seconds)}**"));
  assert("채널은 멘션으로", source.includes("<#${channel.id}>"));
  assert("  └ 이름을 글자로 적지 않음", !source.includes("channel.name"));

  // 사람에게 거는 것이 아니라 채널 설정이라 사유 칸이 없다 (채팅뻥과 같다).
  assert("사유 칸은 없음", !source.includes('from "../ui/reason.js"'));
  assert("  └ 감사 로그에는 누가 걸었는지", source.includes("슬로우뿡모드 — ${interaction.user.tag}"));

  assert("실패하면 원인을 그대로", source.includes("error,"));
}

// ── 7. 말투 ────────────────────────────────────────────────
console.log("\n=== 7. 말투 ===");
assert("설명도 말투를 탐", json.description === speak("이 채널의 슬로우 모드를 정합니다. 0이면 해제합니다."), json.description);

finish();
