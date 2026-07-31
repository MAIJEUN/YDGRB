// 패널티 명령의 [사유] 칸 — 규칙 검증.
//
// 규칙: **모든 패널티 명령에 선택 옵션 「사유」 가 있다.** 적은 사유는 세 곳으로 간다 —
// 응답의 칸 · 디스코드 감사 로그 · 나중에 풀릴 때의 종료 안내.
//
// 명령마다 이름이나 모양이 갈라지면 쓰는 사람이 매번 다시 읽어야 하므로,
// 여기서 두 명령을 한꺼번에 본다.
import { DIST, PROJECT, assert, finish } from "./_harness.mjs";

const { readFileSync } = await import("node:fs");
const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const { MAX_REASON_LENGTH, REASON_OPTION, auditReason, readReason, reasonField } = await import(
  `${DIST}/ui/reason.js`
);

/**
 * 패널티 명령 — **사람에게 벌로 거는** 것들.
 *
 * 별명(뚜따이·바사삭)과 채팅뻥은 빼 둔다. 뚜따이는 서버 전원의 별명을 맞추는 놀이에
 * 가깝고, 채팅뻥은 사람이 아니라 채널·역할의 권한을 켜고 끄는 것이다.
 */
const PENALTIES = [
  { name: "타임아웃", file: "src/commands/timeout.ts" },
  { name: "타살버", file: "src/commands/tasalbeo.ts" },
];

/** 패널티가 아니라 사유 칸이 **없어야** 하는 것들. */
const NOT_PENALTIES = [
  { name: "별명", file: "src/commands/nickname.ts" },
  { name: "채팅뻥", file: "src/commands/chat-toggle.ts" },
];

console.log("\n=== 1. 패널티 명령에 있는가 ===");
assert("옵션 이름은 「사유」", REASON_OPTION === "사유", REASON_OPTION);

const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const commands = await collectCommands();

for (const penalty of PENALTIES) {
  const command = commands.find((c) => c.data.name === penalty.name);
  assert(`/${penalty.name} 등록됨`, command !== undefined);
  if (command === undefined) continue;

  const json = command.data.toJSON();

  // 별명은 하위 명령(뚜따이·바사삭)이라 한 겹 안쪽에 있다.
  const groups =
    json.options?.some((option) => option.type === 1)
      ? json.options.filter((option) => option.type === 1)
      : [json];

  for (const group of groups) {
    const label = group === json ? `/${penalty.name}` : `/${penalty.name} ${group.name}`;
    const found = (group.options ?? []).find((option) => option.name === REASON_OPTION);

    assert(`  └ ${label} 에 사유 칸`, found !== undefined, JSON.stringify((group.options ?? []).map((o) => o.name)));
    if (found === undefined) continue;

    assert(`     · 선택 옵션`, found.required !== true);
    assert(`     · 글자 칸`, found.type === 3, String(found.type));
    assert(`     · 길이를 막아 둠`, found.max_length === MAX_REASON_LENGTH, String(found.max_length));
  }
}

console.log("\n=== 1-1. 패널티가 아닌 것에는 없는가 ===");
for (const other of NOT_PENALTIES) {
  const command = commands.find((c) => c.data.name === other.name);
  assert(`/${other.name} 등록됨`, command !== undefined);
  if (command === undefined) continue;

  const shape = JSON.stringify(command.data.toJSON());
  assert(`  └ 사유 칸이 없음`, !shape.includes(`"${REASON_OPTION}"`), other.name);
  assert(`  └ 헬퍼도 안 씀`, !read(other.file).includes('from "../ui/reason.js"'), other.file);
}

console.log("\n=== 2. 읽기 ===");
const fake = (value) => ({ options: { getString: () => value } });

assert("적으면 그대로", readReason(fake("떠들어서")) === "떠들어서");
assert("  └ 앞뒤 공백은 떼고", readReason(fake("  떠들어서  ")) === "떠들어서");
assert("  └ 줄바꿈은 한 줄로", readReason(fake("첫 줄\n둘째 줄")) === "첫 줄 둘째 줄");
assert("  └ 공백만 있으면 없는 것", readReason(fake("   ")) === null);
assert("  └ 안 적었으면 null", readReason(fake(null)) === null);
assert("  └ 옵션 자체가 없어도 null", readReason(fake(undefined)) === null);

const long = readReason(fake("가".repeat(500)));
assert("긴 사유는 잘라 냄", long.length === MAX_REASON_LENGTH, String(long.length));
assert("  └ 잘렸다고 표시", long.endsWith("..."), long.slice(-10));

console.log("\n=== 3. 화면 칸 ===");
assert("적으면 칸을 만듦", JSON.stringify(reasonField("떠들어서")) === '[{"name":"사유","value":"떠들어서"}]');
for (const empty of [null, undefined, ""]) {
  assert(`  └ ${JSON.stringify(empty)} 이면 칸을 안 만듦`, reasonField(empty).length === 0);
}

console.log("\n=== 4. 감사 로그 ===");
assert(
  "누가 걸었는지 + 사유",
  auditReason("타임아웃", "마이즌#0", "떠들어서") === "타임아웃 — 마이즌#0: 떠들어서",
  auditReason("타임아웃", "마이즌#0", "떠들어서"),
);
assert(
  "  └ 사유가 없어도 누가 걸었는지는 남김",
  auditReason("타임아웃", "마이즌#0", null) === "타임아웃 — 마이즌#0",
  auditReason("타임아웃", "마이즌#0", null),
);

// 감사 로그가 받는 한도는 512자다. 사유를 최대로 적어도 넘지 않아야 한다.
const longest = auditReason("타임아웃", "a".repeat(40), "가".repeat(MAX_REASON_LENGTH));
assert("  └ 최대로 적어도 한도 안", longest.length < 512, `${longest.length}자`);

console.log("\n=== 5. 저장까지 이어지는가 ===");
//
// 며칠 뒤에 풀리는 것도 있다. 그때 다시 보여 주지 않으면 왜 걸렸는지 아무도 모른다.
for (const [label, file] of [
  ["타임아웃", "src/timeout/store.ts"],
  ["타살버", "src/tasalbeo/store.ts"],
]) {
  assert(`${label} 상태에 사유 칸`, /reason\?: string \| null;/u.test(read(file)));
}

for (const [label, file] of [
  ["타임아웃", "src/timeout/scheduler.ts"],
  ["타살버", "src/tasalbeo/scheduler.ts"],
]) {
  assert(`${label} 종료 안내로 넘김`, read(file).includes("note: state.reason ?? null"));
}

console.log("\n=== 6. 종료 안내에 나오는가 ===");
const { endNoticeView } = await import(`${DIST}/ui/end-notice.js`);
const { buildContainer } = await import(`${DIST}/ui/response.js`);

function bodyOf(view) {
  const head = buildContainer(view).toJSON().components[0];
  return head.type === 9 ? head.components[0].content : head.content;
}

const base = {
  effect: "타임아웃",
  target: "<@222222222222222222>",
  until: new Date(1_800_000_000_000),
  reason: { kind: "expired" },
  user: { username: "마이즌" },
};

const withNote = bodyOf(endNoticeView({ ...base, note: "떠들어서" }));
assert("걸 때 적은 사유가 끝날 때 다시 나옴", withNote.includes("**사유**\n떠들어서"), withNote);
assert("  └ 풀린 시각 다음에", withNote.indexOf("풀린 시각") < withNote.indexOf("**사유**"), withNote);

assert("안 적었으면 칸이 없음", !bodyOf(endNoticeView({ ...base, note: null })).includes("**사유**"));
assert("  └ 아예 안 넘겨도", !bodyOf(endNoticeView(base)).includes("**사유**"));

console.log("\n=== 7. 손으로 만들지 않는가 ===");
//
// 사유 칸을 명령마다 손으로 만들면 이름과 모양이 갈라진다. 전부 한 곳을 지나야 한다.
for (const penalty of PENALTIES) {
  const source = read(penalty.file);
  assert(`/${penalty.name} 이 공용 헬퍼를 씀`, source.includes('from "../ui/reason.js"'), penalty.file);
}

const handMade = PENALTIES.filter((penalty) => /name: "사유"/u.test(read(penalty.file)));
assert("사유 칸을 손으로 만드는 곳 없음", handMade.length === 0, handMade.map((p) => p.file).join(", "));

const handMadeOption = PENALTIES.filter((penalty) => /setName\("사유"\)/u.test(read(penalty.file)));
assert("  └ 옵션도 손으로 만들지 않음", handMadeOption.length === 0, handMadeOption.map((p) => p.file).join(", "));

finish();
