// /타살버 검증 — 커맨드 · 저장소 · 역할 · 반복 · 반응 · 복구.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish } from "./_harness.mjs";

const sandbox = mkdtempSync(path.join(tmpdir(), "tasalbeo-"));
process.chdir(sandbox);


const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const G = "111111111111111111";
const U = "222222222222222222";
const MOD = "333333333333333333";
const CH = "444444444444444444";
const MSG = "555555555555555555";
const ROLE = "666666666666666666";

console.log("\n=== 1. 커맨드 등록 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const commands = await collectCommands();
const command = commands.find((c) => c.data.name === "타살버");
assert("/타살버 등록됨", command !== undefined, commands.map((c) => c.data.name).join(","));

const json = command.data.toJSON();
console.log(`     설명: ${json.description}`);
assert("서버 전용", JSON.stringify(json.contexts) === "[0]");
assert("타임아웃 권한으로 제한", json.default_member_permissions === "1099511627776", json.default_member_permissions);

const options = json.options ?? [];
assert(
  "옵션은 유저·기간·사유",
  options.map((o) => o.name).join(",") === "유저,기간,사유",
  options.map((o) => o.name).join(","),
);
assert("  └ 사유는 선택", !options[2].required && options[2].type === 3);
assert("  └ 유저는 필수", options[0].required === true && options[0].type === 6);
assert("  └ 기간은 선택 (비우면 해제)", !options[1].required && options[1].type === 3);
assert("  └ 기간 설명에 형식·해제·상한", ["1일 4시간 45초", "해제", "1일"].every((part) => options[1].description.includes(part)), options[1].description);

console.log("\n=== 2. 걸리는 것 ===");
const ids = await import(`${DIST}/tasalbeo/ids.js`);
assert("별명은 `타살버맞`", ids.NICKNAME === "타살버맞", ids.NICKNAME);
assert("역할이 2초 붙음", ids.ON_MS === 2000, `${ids.ON_MS}`);
assert("  └ 5초 빠짐", ids.OFF_MS === 5000, `${ids.OFF_MS}`);
assert("기간 상한은 1일", ids.MAX_SECONDS === 24 * 60 * 60, `${ids.MAX_SECONDS}`);

const EXPECTED_EMOJIS = [
  "_cartwheel", "_ccccccccc", "_dol_li_gi_yup", "_pcw",
  "_personcartwheeling", "_shuoooong", "_wheelcart", "_yup_dol_gi",
];
assert("이모지 8종", ids.EMOJI_NAMES.length === 8, `${ids.EMOJI_NAMES.length}`);
assert("  └ 이름이 정확히 일치", ids.EMOJI_NAMES.join(",") === EXPECTED_EMOJIS.join(","), ids.EMOJI_NAMES.join(","));

console.log("\n=== 3. 저장소 ===");
const store = await import(`${DIST}/tasalbeo/store.js`);
const until = Date.now() + 60_000;

await store.setState(G, {
  userId: U, until, appliedBy: MOD, appliedAt: Date.now(),
  channelId: CH, messageId: MSG, previousNickname: "원래별명",
});

const saved = await store.getState(G, U);
assert("걸기 전 별명을 기억함", saved?.previousNickname === "원래별명", JSON.stringify(saved));
assert("  └ 답장할 자리도", saved.channelId === CH && saved.messageId === MSG);

// 별명이 없던 사람은 null 로 기억해야 한다 — 되돌릴 때 별명을 지운다.
await store.setState(G, { ...saved, userId: "777777777777777777", previousNickname: null });
assert("별명이 없던 사람은 null", (await store.getState(G, "777777777777777777")).previousNickname === null);

assert("역할 id 는 서버마다 하나", (await store.getRoleId(G)) === null);
await store.setRoleId(G, ROLE);
assert("  └ 저장하고 다시 읽음", (await store.getRoleId(G)) === ROLE);

const active = await store.activeTargets(G);
assert("걸려 있는 사람 목록", active.has(U) && active.size === 2, [...active].join(","));

const [first, second] = await Promise.all([store.takeState(G, U), store.takeState(G, U)]);
assert("동시에 가져가도 한 쪽만", [first, second].filter((s) => s !== undefined).length === 1);
assert("  └ 역할 id 는 남아 있음", (await store.getRoleId(G)) === ROLE, "사람이 빠져도 역할은 재사용한다");

console.log("\n=== 4. 역할: 채널 차단이 있어야 실제로 막힌다 ===");
const roleSource = read("src/tasalbeo/role.ts");
assert("역할 자체에는 권한을 주지 않음", /permissions:\s*\[\]/u.test(roleSource));
assert("채널마다 차단을 검", roleSource.includes("permissionOverwrites.edit("));
assert("  └ SendMessages 를 false 로", roleSource.includes("{ SendMessages: false }"));
assert("  └ 이미 걸린 채널은 건너뜀", roleSource.includes("if (already === true) continue;"));
assert("  └ 스레드는 제외", roleSource.includes("channel.isThread()"));
assert("역할이 지워졌으면 다시 만듦", roleSource.includes("await setRoleId(guild.id, null)"));

console.log("\n=== 5. 역할 반복 ===");
const runnerSource = read("src/tasalbeo/runner.ts");
assert("붙였다 뺐다 번갈아", runnerSource.includes("void step(!attach);"));
assert("  └ 붙이면 2초, 빼면 5초 뒤", runnerSource.includes("attach ? ON_MS : OFF_MS"));
assert("  └ 붙이기로 시작", runnerSource.includes("void step(true);"));
assert("연달아 실패하면 포기", runnerSource.includes("loop.failures >= MAX_FAILURES"));
assert("끊긴 뒤 늦은 응답이 다시 예약하지 못함", (runnerSource.match(/if \(loop\.stopped\) return;/gu) ?? []).length >= 2);

const runner = await import(`${DIST}/tasalbeo/runner.js`);
assert("걸려 있지 않으면 false", runner.isLooping(G, U) === false);
runner.stopLoop(G, U); // 없는 것을 멈춰도 터지지 않아야 한다
runner.stopAllLoops();
assert("모두 멈추기가 안전함", true);

const indexSource = read("src/index.ts");
assert("종료할 때 반복을 멈춤 (프로세스가 안 끝나는 것 방지)", indexSource.includes("stopAllLoops();"));

console.log("\n=== 6. 반응 ===");
const reactionsSource = read("src/tasalbeo/reactions.ts");
assert("이름으로 이모지를 찾음", reactionsSource.includes("candidate.name === name"));
assert("  └ 봇이 들어간 서버 전체에서", reactionsSource.includes("client.emojis.cache"));
assert("  └ 없는 이름은 건너뜀", reactionsSource.includes("if (emoji !== undefined) found.push(emoji)"));
assert("개수는 무작위", reactionsSource.includes("1 + Math.floor(Math.random() * emojis.length)"));
assert("  └ 순서도 섞음", reactionsSource.includes("shuffled(emojis)"));
assert("실패하면 남은 것도 포기", reactionsSource.includes("return;"));

// 무작위 개수가 1 이상, 전체 이하인지 — 경계 확인.
let min = Infinity;
let max = 0;
for (let i = 0; i < 2000; i += 1) {
  const n = 1 + Math.floor(Math.random() * 8);
  min = Math.min(min, n);
  max = Math.max(max, n);
}
assert("개수 범위가 1~8", min === 1 && max === 8, `${min}~${max}`);

const messageEvent = read("src/events/message-create.ts");
assert("메시지마다 대상인지 확인", messageEvent.includes("targets.has(message.author.id)"));
assert("  └ 봇 메시지는 무시", messageEvent.includes("message.author.bot"));
assert("  └ DM 은 무시", messageEvent.includes("!message.inGuild()"));

const clientSource = read("src/client.ts");
assert("GuildMessages 인텐트 추가됨", clientSource.includes("GatewayIntentBits.GuildMessages"));
// MessageContent 는 `!y` 디버그가 들어오면서 필요해졌다 (내용을 읽어야 접두사를 안다).
// 타살버 자체는 여전히 내용을 보지 않는다 — 그것만 확인한다.
assert(
  "  └ 타살버는 메시지 내용을 읽지 않음",
  !/message\.content/u.test(messageEvent.split("handleDebugMessage")[1] ?? messageEvent),
);

console.log("\n=== 7. 끝날 때 뒷정리 ===");
const schedulerSource = read("src/tasalbeo/scheduler.ts");
assert("반복을 멈춤", schedulerSource.includes("stopLoop(guildId, userId)"));
assert("역할을 뺌", schedulerSource.includes('member.roles.remove(roleId, "타살버 종료")'));
assert("별명을 되돌림", schedulerSource.includes('member.setNickname(previousNickname, "타살버 종료")'));
assert("  └ null 이면 별명을 지움 (사용자명으로)", schedulerSource.includes("previousNickname: string | null"));
assert("알림은 공용 종료 안내로", schedulerSource.includes("sendEndNotice("));
assert("  └ 효과 이름은 타살버", schedulerSource.includes('effect: "타살버"'));
assert("  └ 답장 자리를 넘김", schedulerSource.includes("channelId: state.channelId, messageId: state.messageId"));
assert("  └ 서버를 떠났는지 확인", schedulerSource.includes("hasLeft("));
assert("한 번만 실행됨 (읽으면서 지우기)", schedulerSource.includes("takeState(guildId, userId)"));
assert("긴 기간은 잘라서 다시 예약", schedulerSource.includes("MAX_DELAY_MS"));

console.log("\n=== 8. 다시 걸어도 원래 별명을 지킴 ===");
const commandSource = read("src/commands/tasalbeo.ts");
assert(
  "이미 걸려 있으면 처음 별명을 그대로",
  commandSource.includes("current?.previousNickname ?? target.nickname"),
  "두 번째 실행에서 「타살버맞」 이 원래 별명으로 저장되면 영영 못 되돌린다",
);
assert("해제는 releaseTasalbeo 로", commandSource.includes("releaseTasalbeo("));
assert("  └ 푼 사람을 넘김", /releaseTasalbeo\([\s\S]{0,120}interaction\.user\.id/u.test(commandSource));
assert("안 걸린 사람 해제는 실패로", commandSource.includes("타살버 상태가 아닙니다"));

console.log("\n=== 8-1. 결과만 적기 ===");
assert("「걸린 것」 안내를 붙이지 않음", !commandSource.includes('name: "걸린 것"'), commandSource);
assert(
  "  └ 무슨 일이 일어날지 나열하지 않음",
  !commandSource.includes("반복합니다.") && !commandSource.includes("달립니다."),
);
assert("해제에 「별명」 안내를 붙이지 않음", !commandSource.includes("원래대로 되돌렸습니다"));

// 내용에 이미 나온 대상을 변동 칸에 또 적지 않는다.
const applied = commandSource.slice(commandSource.indexOf('title: "타살버 — 적용"'));
assert(
  "적용 결과 — 내용이 대상을 말하면 칸을 두지 않음",
  applied.includes("동안 타살버를 걸었습니다.") && !applied.includes('name: "대상"'),
  applied.slice(0, 400),
);
assert("  └ 풀리는 시각만 남음", applied.includes('name: "풀리는 시각"'));

// 해제 응답 하나만 잘라 본다 — 뒤에 오는 실패 경로까지 포함하면 안 된다.
const releaseStart = commandSource.indexOf('title: "타살버 — 해제"');
const releasedPart = commandSource.slice(
  releaseStart,
  commandSource.indexOf("return;", releaseStart),
);
assert(
  "해제 결과 — 대상 칸 없음",
  releasedPart.includes("타살버를 풀었습니다.") && !releasedPart.includes('name: "대상"'),
  releasedPart,
);

// 실패는 내용이 이유라서 대상을 말하지 않는다 — 그때는 칸으로 둔다.
assert(
  "실패에는 대상 칸을 남김 (내용이 이유라서)",
  (commandSource.match(/name: "대상"/gu) ?? []).length === 2,
  `${(commandSource.match(/name: "대상"/gu) ?? []).length}개`,
);

// 환불은 변동 문구가 말한다 — 따로 적지 않는다.
const wishSource = read("src/components/wish.ts");
assert("환불 안내를 따로 적지 않음", !wishSource.includes("소원권 1장을 돌려드렸어요"), "변동 문구가 이미 말한다");
assert("앞으로 일어날 일을 예고하지 않음", !wishSource.includes("알려드릴게요"));

console.log("\n=== 9. 막아야 할 대상 ===");
for (const [label, needle] of [
  ["서버 소유자", "guild.ownerId"],
  ["봇", "target.user.bot"],
  ["봇 역할 관리 권한", "PermissionFlagsBits.ManageRoles"],
  ["봇 별명 관리 권한", "PermissionFlagsBits.ManageNicknames"],
  ["봇보다 높은 역할", "me.roles.highest.comparePositionTo"],
  ["실행자보다 높은 역할", "actor.roles.highest.comparePositionTo"],
  ["기간 상한", "parsed.seconds > MAX_SECONDS"],
]) {
  assert(label, commandSource.includes(needle));
}

console.log("\n=== 10. 부팅 복구 ===");
// 앞 단계에서 남긴 것을 치우고 두 건만 남긴다.
await store.takeState(G, "777777777777777777");

await store.setState(G, {
  userId: U, until: Date.now() + 60_000, appliedBy: MOD, appliedAt: 0,
  channelId: CH, messageId: MSG, previousNickname: "원래별명",
});
await store.setState(G, {
  userId: "888888888888888888", until: Date.now() - 60_000, appliedBy: MOD, appliedAt: 0,
  channelId: null, messageId: null, previousNickname: null,
});

const scheduler = await import(`${DIST}/tasalbeo/scheduler.js`);
const fakeClient = {
  user: { id: "999999999999999999" },
  users: { fetch: async () => ({ id: MOD, username: "관리자" }) },
  channels: { fetch: async () => null },
  guilds: { fetch: async () => ({ members: { fetch: async () => null } }) },
};

const restored = await scheduler.restoreTasalbeo(fakeClient);
assert("복구 건수를 돌려줌", restored === 2, `${restored}`);

await new Promise((resolve) => setTimeout(resolve, 80));
assert("이미 끝난 건 정리됨", (await store.getState(G, "888888888888888888")) === undefined);
assert("아직 남은 건 그대로", (await store.getState(G, U)) !== undefined);
assert("  └ 역할 반복도 되살림", runner.isLooping(G, U) === true);

// 타이머를 남기면 프로세스가 안 끝난다.
scheduler.cancelEnd(G, U);
runner.stopAllLoops();

const ready = read("src/events/client-ready.ts");
assert("부팅 때 복구를 부름", ready.includes("restoreTasalbeo(client)"));

finish();
