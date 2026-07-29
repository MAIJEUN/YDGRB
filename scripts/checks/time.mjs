// 기간 입력 파서와 시간 표기 검증.
//
// 여기가 틀리면 조용히 엉뚱한 시각에 풀린다 — `1일 4시간` 을 `1일 4시` 로 읽는 식으로.
// 그래서 모르는 글자가 섞이면 넘겨짚지 않고 형식 오류로 돌려주는지까지 본다.
import { DIST, assert, finish } from "./_harness.mjs";

const {
  MAX_DURATION_SECONDS,
  at,
  atWithCountdown,
  clock,
  countdown,
  describeDurationError,
  formatDuration,
  parseDuration,
} = await import(`${DIST}/time.js`);

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

console.log("\n=== 1. 읽기 ===");

for (const [input, seconds] of [
  // 단위를 안 쓰면 초.
  ["64", 64],
  ["1", 1],
  // 한글 단위.
  ["1일", DAY],
  ["3시간", 3 * HOUR],
  ["5분", 5 * MINUTE],
  ["30초", 30],
  // 섞어 쓰기. 「시간」이 「시」보다 먼저 잡혀야 한다.
  ["1일 4시간 45초", DAY + 4 * HOUR + 45],
  ["1일4시간45초", DAY + 4 * HOUR + 45],
  ["2시간 30분", 2 * HOUR + 30 * MINUTE],
  // 「시」도 시간으로 본다.
  ["4시", 4 * HOUR],
  // 영문 단위.
  ["1d", DAY],
  ["2h", 2 * HOUR],
  ["3m", 3 * MINUTE],
  ["10s", 10],
  ["1day 2hours 3mins", DAY + 2 * HOUR + 3 * MINUTE],
  ["1D 2H", DAY + 2 * HOUR],
  // 공백은 넉넉히 봐준다.
  ["  1일   2시간  ", DAY + 2 * HOUR],
  // 같은 단위를 여러 번 적으면 더한다.
  ["1시간 1시간", 2 * HOUR],
]) {
  const parsed = parseDuration(input);
  assert(
    `\`${input}\` → ${seconds}초`,
    parsed.ok && parsed.seconds === seconds,
    JSON.stringify(parsed),
  );
}

console.log("\n=== 2. 안 읽히는 것 ===");

for (const [input, reason] of [
  ["", "empty"],
  ["   ", "empty"],
  ["0", "zero"],
  ["0초", "zero"],
  ["0일 0시간", "zero"],
  ["나중에", "invalid"],
  ["1일 나중에", "invalid"],
  ["1주일", "invalid"],
  ["하루", "invalid"],
  ["1일!", "invalid"],
  ["366일", "tooLong"],
  ["9999시간", "tooLong"],
]) {
  const parsed = parseDuration(input);
  assert(`\`${input}\` → ${reason}`, !parsed.ok && parsed.reason === reason, JSON.stringify(parsed));
}

assert("365일까지는 받음", parseDuration("365일").ok);
assert("  └ 한계가 365일", MAX_DURATION_SECONDS === 365 * DAY, String(MAX_DURATION_SECONDS));

console.log("\n=== 3. 사유 문구 ===");
for (const reason of ["empty", "zero", "invalid", "tooLong"]) {
  const text = describeDurationError(reason);
  assert(`${reason} 에 안내가 있음`, typeof text === "string" && text.length > 0, String(text));
}
assert(
  "형식 오류는 예시를 보여 줌",
  describeDurationError("invalid").includes("1일 4시간 45초"),
  describeDurationError("invalid"),
);

console.log("\n=== 4. 되돌려 적기 ===");
for (const [seconds, text] of [
  [0, "0초"],
  [-5, "0초"],
  [1, "1초"],
  [64, "1분 4초"],
  [HOUR, "1시간"],
  [DAY, "1일"],
  [DAY + 4 * HOUR + 45, "1일 4시간 45초"],
  [2 * DAY + 30 * MINUTE, "2일 30분"],
]) {
  assert(`${seconds}초 → \`${text}\``, formatDuration(seconds) === text, formatDuration(seconds));
}

// 읽은 값을 다시 적으면 같은 값으로 읽혀야 한다.
for (const input of ["1일 4시간 45초", "2시간 30분", "64"]) {
  const first = parseDuration(input);
  const again = parseDuration(formatDuration(first.seconds));
  assert(`\`${input}\` 는 오갈 수 있음`, again.ok && again.seconds === first.seconds, formatDuration(first.seconds));
}

console.log("\n=== 5. 타임스탬프 마크다운 ===");
//
// 시각을 글자로 적으면 보는 사람의 시간대가 반영되지 않고, 남은 시간도 멈춘다.
// 그래서 화면에 나가는 시각은 전부 이 세 함수를 지나야 한다.
const moment = new Date(1_800_000_000_000); // 2027-01-15T08:00:00Z
const seconds = Math.floor(moment.getTime() / 1000);

assert("at() 은 <t:초:F>", at(moment) === `<t:${seconds}:F>`, at(moment));
assert("countdown() 은 <t:초:R>", countdown(moment) === `<t:${seconds}:R>`, countdown(moment));
// 짧은 시각(`t`)이다. 긴 시각(`T`)은 초까지 붙어 로그를 줄줄이 세울 때 너무 길다.
assert("clock() 은 <t:초:t>", clock(moment) === `<t:${seconds}:t>`, clock(moment));
assert(
  "atWithCountdown() 은 둘을 함께",
  atWithCountdown(moment) === `<t:${seconds}:F> (<t:${seconds}:R>)`,
  atWithCountdown(moment),
);
assert(
  "초 단위로 내림 (밀리초가 새지 않음)",
  at(new Date(moment.getTime() + 999)) === at(moment),
  at(new Date(moment.getTime() + 999)),
);

finish();
