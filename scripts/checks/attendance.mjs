// /출헉체흐 검증 — 커맨드 · 저장소 · 연속일수 · 보상 · 이미지 · 화면.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish, speak } from "./_harness.mjs";

const sandbox = mkdtempSync(path.join(tmpdir(), "att-"));
process.chdir(sandbox);


const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const G = "111111111111111111";
const A = "222222222222222222";
const B = "333333333333333333";

console.log("\n=== 1. 커맨드 등록 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const commands = await collectCommands();
const command = commands.find((c) => c.data.name === "출헉체흐");
assert("/출헉체흐 등록됨", command !== undefined, commands.map((c) => c.data.name).join(","));

const json = command.data.toJSON();
console.log(`     설명: ${json.description}`);
assert("서버 전용", JSON.stringify(json.contexts) === "[0]");
// Administrator = 1 << 3 = 8
assert("관리자만", json.default_member_permissions === "8", json.default_member_permissions);

const option = json.options[0];
assert("옵션은 텍스트 하나", json.options.length === 1 && option.name === "텍스트");
assert("  └ 필수", option.required === true);
assert("  └ 길이 제한", option.max_length === 24, `${option.max_length}`);

console.log("\n=== 2. 날짜 (한국 기준) ===");
const store = await import(`${DIST}/attendance/store.js`);

assert("오늘 날짜는 YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/u.test(store.dateKey()), store.dateKey());
assert("어제 계산", store.previousDateKey("2026-07-27") === "2026-07-26");
assert("  └ 달을 넘어감", store.previousDateKey("2026-08-01") === "2026-07-31");
assert("  └ 해를 넘어감", store.previousDateKey("2026-01-01") === "2025-12-31");
assert("  └ 윤년", store.previousDateKey("2024-03-01") === "2024-02-29");

// 한국 시간 기준인지 — UTC 로 보면 전날인 시각을 넣어 본다.
const lateNight = new Date("2026-07-27T15:30:00Z"); // 한국은 7월 28일 0시 30분
assert("한국 날짜로 셈", store.dateKey(lateNight) === "2026-07-28", store.dateKey(lateNight));

console.log("\n=== 3. 오늘의 출헉 ===");
assert("처음엔 없음", (await store.getToday(G)) === null);

await store.setToday(G, {
  date: store.dateKey(),
  text: "오늘의암호",
  by: A,
  channelId: "444444444444444444",
  messageId: null,
});
assert("올리면 읽힘", (await store.getToday(G))?.text === "오늘의암호");

await store.attachMessage(G, "555555555555555555");
assert("메시지 id 를 붙임", (await store.getToday(G))?.messageId === "555555555555555555");

// 날짜가 지난 것은 없는 것으로 봐야 한다 (어제 버튼을 눌러도 안 되게).
await store.setToday(G, { date: "2020-01-01", text: "옛날", by: A, channelId: "c", messageId: "m" });
assert("어제 것은 없는 것으로", (await store.getToday(G)) === null);

await store.setToday(G, { date: store.dateKey(), text: "오늘의암호", by: A, channelId: "c", messageId: "m" });
await store.clearToday(G);
assert("치우면 사라짐", (await store.getToday(G)) === null);

console.log("\n=== 4. 출헉 기록 ===");
const REWARD_EVERY = 4;

const first = await store.checkIn(G, A, REWARD_EVERY);
assert("첫 출헉", first.ok && first.record.total === 1 && first.record.streak === 1, JSON.stringify(first));
assert("  └ 1일째는 보상 없음", first.rewarded === false);

const again = await store.checkIn(G, A, REWARD_EVERY);
assert("같은 날 두 번은 거부", again.ok === false && again.reason === "already");
assert("  └ 수가 늘지 않음", (await store.getRecord(G, A)).total === 1);

// 연타해도 한 번만 세는지 — 동시에 눌러 본다.
const burst = await Promise.all([store.checkIn(G, B, REWARD_EVERY), store.checkIn(G, B, REWARD_EVERY)]);
assert("연타해도 한 번만", burst.filter((r) => r.ok).length === 1, JSON.stringify(burst));
assert("  └ 기록은 1일", (await store.getRecord(G, B)).total === 1);

console.log("\n=== 5. 연속일수 · 보상 ===");
// 어제 한 것으로 꾸며서 이어지는지 본다.
const today = store.dateKey();
const yesterday = store.previousDateKey(today);

const raw = path.join(sandbox, "data", "attendance.json");
const patch = (record) => {
  const data = JSON.parse(readFileSync(raw, "utf8"));
  data.guilds[G].records[A] = { userId: A, ...record };
  writeFileSync(raw, JSON.stringify(data));
};

// 캐시를 비우기 위해 저장소를 새로 로드한다 (봇 재시작과 같은 상황).
async function freshStore(tag) {
  return import(`${DIST}/attendance/store.js?t=${tag}`);
}

patch({ total: 2, streak: 2, lastDate: yesterday });
const continued = await (await freshStore("a")).checkIn(G, A, REWARD_EVERY);
assert("어제 했으면 이어짐", continued.ok && continued.record.streak === 3, JSON.stringify(continued));
assert("  └ 누적도 늘어남", continued.record.total === 3);

patch({ total: 9, streak: 5, lastDate: "2020-01-01" });
const broken = await (await freshStore("b")).checkIn(G, A, REWARD_EVERY);
assert("빠졌으면 1부터 다시", broken.ok && broken.record.streak === 1, JSON.stringify(broken));
assert("  └ 누적은 그대로 이어짐", broken.record.total === 10);

// 4의 배수마다 보상.
for (const [before, expected] of [[3, true], [4, false], [7, true], [11, true], [12, false]]) {
  patch({ total: before, streak: 1, lastDate: yesterday });
  const result = await (await freshStore(`r${before}`)).checkIn(G, A, REWARD_EVERY);
  assert(
    `${before}일 → ${before + 1}일: 보상 ${expected ? "있음" : "없음"}`,
    result.ok && result.rewarded === expected,
    JSON.stringify(result),
  );
}

console.log("\n=== 6. 제출많 ===");
patch({ total: 30, streak: 1, lastDate: today });
const fresh = await freshStore("top");
const top = await fresh.topAttender(G);
assert("가장 많이 한 사람", top?.userId === A && top.total === 30, JSON.stringify(top));
assert("아무도 없으면 null", (await fresh.topAttender("999999999999999999")) === null);

console.log("\n=== 7. 이미지 ===");
const { renderText } = await import(`${DIST}/attendance/image.js`);

const png = renderText("오늘의암호 abc 123");
assert("PNG 를 만듦", png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a", png.subarray(0, 8).toString("hex"));
assert("  └ 비어 있지 않음", png.length > 1000, `${png.length}바이트`);

// 같은 글자는 **늘 같은 그림**이어야 한다. 명단이 늘 때마다 이 그림을 다시 올리는데,
// 그때마다 잡선과 기울기가 달라지면 받아쓰는 사람 눈앞에서 그림이 계속 흔들린다.
const twice = renderText("같은글자");
const thrice = renderText("같은글자");
assert("같은 글자는 같은 바이트", twice.equals(thrice), "다시 올려도 화면이 그대로여야 한다");
assert("  └ 다른 글자는 다른 그림", !renderText("다른글자").equals(twice));

const wide = renderText("아주아주아주긴글자입니다");
assert("글자가 길면 넓어짐", wide.length > renderText("짧").length);

const imageSource = read("src/attendance/image.ts");
assert("글자를 하나씩 기울임", imageSource.includes("ctx.rotate("));
assert("배경에 잡선을 깖", imageSource.includes("NOISE_LINES"));
assert("한글 폰트를 찾음", imageSource.includes("Malgun Gothic"));
assert("  └ 없으면 알려 줌", imageSource.includes("한글 폰트를 찾지 못했습니다"));

// ── 6-1. 명단 (저장소) ─────────────────────────────────────
console.log("\n=== 6-1. 명단 (저장소) ===");
{
  const ROSTER = "777777777777777777";

  await store.setToday(ROSTER, {
    date: store.dateKey(),
    text: "글자",
    by: A,
    channelId: "999999999999999999",
    messageId: "1",
    attenders: [],
  });

  await store.checkIn(ROSTER, A, 4);
  await store.checkIn(ROSTER, B, 4);

  assert("맞힌 차례로 쌓임", (await store.getToday(ROSTER))?.attenders.join() === `${A},${B}`);

  await store.checkIn(ROSTER, A, 4);
  assert("  └ 두 번 하려 해도 한 번만", (await store.getToday(ROSTER))?.attenders.join() === `${A},${B}`);
}

console.log("\n=== 7-1. 덤 (그래도 계속) ===");
const extraStore = await freshStore("extra");

const extra = await extraStore.addExtra(G, "덤글자");
assert("덤 자리를 만듦", extra.text === "덤글자" && extra.id.length === 8, JSON.stringify(extra));
assert("  └ 오늘 날짜로", extra.date === store.dateKey());
assert("id 로 다시 찾음", (await extraStore.getExtra(G, extra.id))?.text === "덤글자");
assert("없는 id 는 null", (await extraStore.getExtra(G, "deadbeef")) === null);

// 지난 날 덤은 통하지 않고, 새로 올릴 때 치워진다.
const rawFile = path.join(sandbox, "data", "attendance.json");
const stale = JSON.parse(readFileSync(rawFile, "utf8"));
stale.guilds[G].extras["old12345"] = { id: "old12345", date: "2020-01-01", text: "옛날" };
writeFileSync(rawFile, JSON.stringify(stale));

const pruner = await freshStore("prune");
assert("지난 날 덤은 안 통함", (await pruner.getExtra(G, "old12345")) === null);
await pruner.addExtra(G, "새덤");
const afterPrune = JSON.parse(readFileSync(rawFile, "utf8"));
assert("  └ 새로 올릴 때 치워짐", afterPrune.guilds[G].extras.old12345 === undefined, JSON.stringify(afterPrune.guilds[G].extras));

console.log("\n=== 8. 화면 ===");
const { buildContainer } = await import(`${DIST}/ui/response.js`);
const { todayView, alreadyView, successView, extraSuccessView, EMPTY_BOARD, MAX_SHOWN_ATTENDERS, IMAGE_NAME } =
  await import(
  `${DIST}/attendance/views.js`
);
const user = { username: "테스터" };

const board = { userId: B, total: 12, streak: 3, lastDate: today };
const todayJson = buildContainer(todayView({ top: board, attenders: [] }, user)).toJSON();
const todayBody = todayJson.components[0].content;

assert("제목은 「오늘의 출헉」", todayBody.startsWith("### 오늘의 출헉"), todayBody);
assert("글자를 본문에 적지 않음", !todayBody.includes("오늘의암호"), "이미지로만 보여 줘야 복붙을 막는다");
assert("제출많을 멘션으로", todayBody.includes(`**제출많**\n<@${B}> (12일)`), todayBody);
assert("이미지를 묶음으로 붙임", JSON.stringify(todayJson).includes(`attachment://${IMAGE_NAME}`));
assert("  └ 버튼이 있음", JSON.stringify(todayJson).includes("안녕난버튼이야"));
assert("  └ 공개로 나감", todayView(EMPTY_BOARD, user).ephemeral === false);
assert("제출많이 없으면 칸도 없음", !buildContainer(todayView(EMPTY_BOARD, user)).toJSON().components[0].content.includes("제출많"));

const successJson = buildContainer(
  successView({ userId: A, total: 4, streak: 4, lastDate: today }, "소원권 조각: 0개 → 1개", user),
).toJSON();
const successBody = successJson.components[0].content;

assert("성공은 초록", successJson.accent_color === 0x57f287);
assert("  └ 문구", successBody.includes(`<@${A}> 출헉 성공! (연속 4일째)`), successBody);
assert("  └ 조각 지급이 변동으로", successBody.includes("소원권 조각: 0개 → 1개"));
assert(
  "  └ 본인에게만 보임",
  successView({ userId: A, total: 4, streak: 4, lastDate: today }, undefined, user).ephemeral !== false,
);

// 덤 메시지 — 기록 안 된다는 것이 분명해야 한다.
const extraJson = buildContainer(todayView(EMPTY_BOARD, user, "abcd1234")).toJSON();
const extraBody = extraJson.components[0].content;

assert("덤은 제목에 기록 안 됨", extraBody.startsWith("### 출헉 (기록 안 됨)"), extraBody);
assert("  └ 제출많을 보여 주지 않음", !extraBody.includes("제출많"));
assert("  └ 버튼에 덤 id 를 실음", JSON.stringify(extraJson).includes("att:check:abcd1234"));
assert("오늘의 출헉 버튼에는 id 없음", JSON.stringify(buildContainer(todayView(EMPTY_BOARD, user)).toJSON()).includes('"att:check"'));

const alreadyJson = buildContainer(alreadyView("[오늘의 출헉](https://x)", "abcd1234", user)).toJSON();
assert("이미 올렸을 때 빨강", alreadyJson.accent_color === 0xed4245);
assert("  └ 링크가 문장 안에", alreadyJson.components[0].content.includes("[오늘의 출헉](https://x)이 이미"));
assert("  └ 「그래도 계속」 버튼", JSON.stringify(alreadyJson).includes("att:again:abcd1234"));
assert("  └ 나만 보기", alreadyView("x", "y", user).ephemeral !== false);

const extraSuccess = buildContainer(extraSuccessView(user)).toJSON();
assert("덤 성공은 파랑(기록 아님)", extraSuccess.accent_color === 0x5865f2);
assert("  └ 제목에 기록 안 됨", extraSuccess.components[0].content.includes(speak("맞혔습니다 (기록 안 됨)")));
assert("  └ 연속일수를 말하지 않음", !extraSuccess.components[0].content.includes("연속"));
assert("  └ 본인에게만 보임", extraSuccessView(user).ephemeral !== false);

// 출헉 메시지 자체는 공개, 성공은 나만 보기.
assert("오늘의 출헉은 공개", todayView(EMPTY_BOARD, user).ephemeral === false);

// ── 8-1. 오늘 출헉한 사람 ──────────────────────────────────
//
// 성공 안내는 여전히 누른 사람에게만 간다. 대신 누가 했는지는 출헉 메시지 한 곳에 모인다.
console.log("\n=== 8-1. 오늘 출헉한 사람 ===");
{
  const withList = buildContainer(todayView({ top: null, attenders: [A, B] }, user)).toJSON();
  const listBody = withList.components[0].content;

  assert("명단 칸이 붙음", listBody.includes("**오늘 출헉 (2명)**"), listBody);
  assert("  └ 멘션으로", listBody.includes(`<@${A}> <@${B}>`), listBody);
  assert("  └ 이름을 글자로 적지 않음", !listBody.includes("테스터"), listBody);

  // 맞힌 차례 그대로. 뒤집으면 화면도 뒤집힌다.
  const flipped = buildContainer(todayView({ top: null, attenders: [B, A] }, user)).toJSON();
  assert("차례를 지킴", flipped.components[0].content.includes(`<@${B}> <@${A}>`));

  assert(
    "아무도 없으면 칸도 없음",
    !buildContainer(todayView(EMPTY_BOARD, user)).toJSON().components[0].content.includes("오늘 출헉"),
  );

  const crowd = Array.from({ length: MAX_SHOWN_ATTENDERS + 7 }, (_, i) => String(500000000000000000 + i));
  const crowdBody = buildContainer(todayView({ top: null, attenders: crowd }, user)).toJSON().components[0].content;

  assert("많으면 잘라서 적음", crowdBody.includes("외 7명"), crowdBody.slice(0, 200));
  assert(
    `  └ 늘어놓는 것은 ${MAX_SHOWN_ATTENDERS}명까지`,
    (crowdBody.match(/<@\d+>/gu) ?? []).length === MAX_SHOWN_ATTENDERS,
    String((crowdBody.match(/<@\d+>/gu) ?? []).length),
  );
  assert("  └ 전체 인원은 그대로 셈", crowdBody.includes(`오늘 출헉 (${crowd.length}명)`), crowdBody.slice(0, 120));

  // 명단이 먼저, 여태까지의 기록이 그다음.
  const both = buildContainer(todayView({ top: board, attenders: [A] }, user)).toJSON().components[0].content;
  assert("명단이 제출많보다 먼저", both.indexOf("오늘 출헉") < both.indexOf("제출많"), both);

  assert(
    "덤에는 명단이 없음 (출헉으로 안 셈)",
    !buildContainer(todayView({ top: board, attenders: [A] }, user, "abcd1234")).toJSON().components[0].content.includes("오늘 출헉"),
  );
}

console.log("\n=== 9. 연결 ===");
const commandSource = read("src/commands/attendance.ts");
const componentSource = read("src/components/attendance.ts");

assert("하루에 한 번", commandSource.includes("const already = await getToday(interaction.guildId)"));
assert(
  "  └ 「오늘의 출헉」 자체가 링크",
  commandSource.includes("`[오늘의 출헉](https://discord.com/channels/"),
  commandSource,
);
assert("  └ 링크를 못 만들면 글자만", commandSource.includes('? "오늘의 출헉"'));
assert("  └ 「보러 가기」 를 따로 붙이지 않음", !commandSource.includes("보러 가기"));
assert("  └ 그림 그리기 전에 자리를 잡음", commandSource.indexOf("setToday(") < commandSource.indexOf("renderText("));
assert("  └ 실패하면 자리를 비움", commandSource.includes("clearToday(interaction.guildId)"));
assert("이미지를 첨부로 올림", commandSource.includes("new AttachmentBuilder(renderText(text)"));

assert(
  "텍스트는 명령 옵션으로 받음 (모달 아님)",
  commandSource.includes("addStringOption(") && !commandSource.includes("showModal("),
  commandSource.slice(0, 200),
);
assert("  └ 이미 있으면 덤 자리를 잡아 둠", commandSource.includes("await addExtra(interaction.guildId, text)"));

assert("버튼 → 모달", componentSource.includes("interaction.showModal(answerModal(extraId))"));
assert("  └ 모달에 정답을 싣지 않음", !componentSource.includes("setValue("), "모달 내용은 클라이언트가 다 본다");
assert("받아쓴 값을 견줌", componentSource.includes("matches(interaction.fields.getTextInputValue(FIELD.answer), text)"));
assert("  └ 앞뒤 공백만 봐 줌", componentSource.includes("answer.trim() === text.trim()"));
assert("지난 버튼은 막음", (componentSource.match(/지난 출헉입니다/gu) ?? []).length === 2);

assert("덤은 출헉으로 세지 않음", /if \(extraId !== undefined\) \{\s*await interaction\.reply\(response\(extraSuccessView/u.test(componentSource));
assert("  └ checkIn 보다 먼저 빠져나감", componentSource.indexOf("extraSuccessView") < componentSource.indexOf("await checkIn("));
assert("덤 올리기도 관리자만", componentSource.includes("PermissionFlagsBits.Administrator"));
assert("  └ 정답은 customId 가 아니라 저장소에서", componentSource.includes("await getExtra(guildId, extraId)"));
assert("4의 배수면 조각 지급", componentSource.includes("applyBalanceChange(guildId, interaction.user.id"));
assert("  └ 소원권 저장소를 그대로 씀", componentSource.includes('from "../wish/store.js"'));

const { collectComponentHandlers } = await import(`${DIST}/loaders/components.js`);
const handlers = await collectComponentHandlers();
// 명단이 늘면 채널의 출헉 메시지를 다시 그린다.
assert("출헉하면 명단을 다시 그림", componentSource.includes("await refreshBoard(interaction, guildId)"));
assert(
  "  └ 이미지를 다시 올림",
  componentSource.includes("files: [new AttachmentBuilder(renderText(today.text)"),
  "V2 메시지는 붙어 있던 첨부 목록이 비어 돌아온다. 안 올리면 attachment:// 참조가 풀린다",
);
assert("  └ 같은 글자는 같은 그림이라 화면은 그대로", imageSource.includes("seededRandom"));
assert("    └ Math.random 을 쓰지 않음", !imageSource.includes("Math.random("));
assert("  └ footer 는 올린 사람 그대로", componentSource.includes("users.fetch(today.by)"));
assert("  └ 못 고쳐도 그냥 넘어감", componentSource.includes("출헉: 명단을 고치지 못했습니다"));
assert("  └ 성공 안내는 여전히 나만 보기", !componentSource.includes("successView(result.record, rewarded, interaction.user), { ephemeral: false }"));

assert("컴포넌트 핸들러 등록", handlers.some((h) => h.namespace === "att"), handlers.map((h) => h.namespace).join(","));

finish();
