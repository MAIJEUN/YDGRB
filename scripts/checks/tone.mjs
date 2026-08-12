import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { assert, finish, PROJECT, speak } from "./_harness.mjs";

/**
 * 말투 검사 — 봇은 **말끝을 맺지 않는다.**
 *
 * 두 가지를 본다.
 *
 * 1. 표가 제대로 자르는가 — 「안녕하세요」가 「안녕하ㅅ-」가 되는가.
 * 2. 새는 문장이 없는가 — 소스에 적힌 높임말 중 `speak()` 를 안 거친 것이 있는가.
 *
 * 2번이 진짜다. 말투는 새 문장을 쓸 때마다 어긋난다. 사람이 매번 기억할 수는 없으니
 * 여기서 잡는다.
 */

console.log("=== 1. 어미를 자르고 초성만 남긴다 ===");

const CUTS = [
  ["안녕하세요", "안녕하ㅅ-"],
  ["게임을 시작하겠습니다", "게임을 시작하겠ㅅ-"],
  ["패배하셨습니다.", "패배하셨ㅅ-"],
  ["제가 짱입니다.", "제가 짱입ㄴ-"],
  ["승기는 제가 가져가겠습니다.", "승기는 제가 가져가겠ㅅ-"],
  ["만두는 정말 맛있습니다", "만두는 정말 맛있ㅅ-"],
  ["타살버를 시전하겠습니다", "타살버를 시전하겠ㅅ-"],
  ["끝나셨습니다", "끝나셨ㅅ-"],
  ["소원권 패널을 엽니다.", "소원권 패널을 엽ㄴ-"],
  ["지급할까요, 회수할까요?", "지급할까요, 회수할ㄲ-?"],
  ["이 명령은 서버 안에서만 사용할 수 있어요.", "이 명령은 서버 안에서만 사용할 수 있ㅇ-"],
];

for (const [before, after] of CUTS)
  assert(`${before} → ${after}`, speak(before) === after, speak(before));

console.log("\n=== 2. 꾸밈과 덧붙은 값은 그대로 둔다 ===");

const KEEPS = [
  // 굵게·기울임은 자를 자리를 가릴 뿐, 지우면 안 된다.
  ["_아직 설정되지 않았습니다._", "_아직 설정되지 않았ㅅ-_"],
  ["**이 서버에 없습니다.**", "**이 서버에 없ㅅ-**"],
  // 문장이 끝난 뒤에 붙는 값·토도 문장의 끝이다.
  ["등록되지 않은 커맨드입니다: /퀴즈", "등록되지 않은 커맨드입ㄴ-: /퀴즈"],
  ["**JSON 이 깨졌습니다** — data.json", "**JSON 이 깨졌ㅅ-** — data.json"],
  ["맞혔습니다 (기록 안 됨)", "맞혔ㅅ- (기록 안 됨)"],
  ["찾지 못했습니다 _(못 보는 것일 수 있어요)_", "찾지 못했ㅅ- _(못 보는 것일 수 있ㅇ-)_"],
  // 여러 문장이면 하나씩.
  ["기간을 비웁니다. 그러면 해제합니다.", "기간을 비웁ㄴ- 그러면 해제합ㄴ-"],
];

for (const [before, after] of KEEPS)
  assert(`${before} → ${after}`, speak(before) === after, speak(before));

console.log("\n=== 3. 말이 아닌 것은 건드리지 않는다 ===");

const SAME = [
  "아직 없음",
  "**3명**",
  "소원권 조각: 0개 → 1개",
  "선착순 5명",
  "ㅇㄴㅎㅅㅇ",
  "<@123456789> · `123456789`",
  "허용 → **차단**",
  "3분 · 90(숫자만 쓰면 초). 10초 ~ 1시간",
  // `니다` 는 받침 ㅂ 뒤에서만 어미다. 아니면 「아ㄴ-」 이 된다.
  "그건 아니다",
  "소원권 1장이 다닌다",
  // 홑 `요` 는 표에 없다. 있으면 「필ㅇ-」 이 된다.
  "소원권 1장 필요",
  "가장 중요",
];

assert("합니다 는 받침 ㅂ 이라 잘림", speak("소원권 패널을 엽니다.") === "소원권 패널을 엽ㄴ-");
assert("아닙니다 도 잘림", speak("그건 아닙니다.") === "그건 아닙ㄴ-", speak("그건 아닙니다."));

for (const text of SAME) assert(`그대로: ${text}`, speak(text) === text, speak(text));

// 유저가 적은 글은 말투를 타면 안 된다. 어미가 붙어 있어도 그건 그 사람의 말이다.
assert(
  "유저의 말은 감싸지 않는 한 그대로",
  speak(`정답은 **${"밥 먹었습니다"}** 입니다.`) === "정답은 **밥 먹었습니다** 입ㄴ-",
  speak("정답은 **밥 먹었습니다** 입니다."),
);

console.log("\n=== 4. 새는 문장이 없다 ===");

/** 사람이 디스코드에서 보는 말이 아닌 곳 — 콘솔 · 개발자 오류 · 부팅 로그. */
const SKIP_FILES = new Set([
  "src/logger.ts",
  "src/config.ts",
  "src/env.ts",
  "src/index.ts",
  "src/deploy-commands.ts",
  "src/errors.ts",
  "src/ui/tone.ts",
  "src/wish/store.ts",
  "src/storage/json-file.ts",
  "src/games/registry.ts",
  "src/loaders/commands.ts",
  "src/loaders/components.ts",
  "src/loaders/events.ts",
  "src/loaders/module-files.ts",
]);

/** 화면이 아니라 로그로 가는 줄. 여러 줄에 걸친 것도 따라간다. */
const LOG_CALL = /(?:logger\.\w+|console\.\w+|throw new \w+)\(/u;

/** 「~습니다」류가 들어 있는가. */
const POLITE = /(?:습니다|습니까|[가-힣]니다|[가-힣]니까|세요|셔요|[어아여예에해네게나까군지]요)/u;

const TICK = String.fromCharCode(96);

/**
 * 리터럴 하나의 끝을 찾는다.
 *
 * 백틱 안의 `${…}` 에는 또 다른 따옴표가 들어 있다 — `` `${a ? "풀었습니다" : "막았습니다"}.` `` 처럼.
 * 그걸 닫는 따옴표로 보면 바깥 문장을 못 알아보고 애먼 것을 잡는다.
 */
function endOfLiteral(line, start) {
  const quote = line[start];
  let i = start + 1;
  let depth = 0;

  while (i < line.length) {
    const ch = line[i];

    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (quote === TICK && ch === "$" && line[i + 1] === "{") {
      depth += 1;
      i += 2;
      continue;
    }
    if (depth > 0) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === '"' || ch === "'" || ch === TICK) {
        const inner = endOfLiteral(line, i);
        if (inner === -1) return -1;
        i = inner + 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === quote) return i;
    i += 1;
  }

  return -1;
}

/** 한 줄에서 **바깥쪽** 리터럴만 훑는다. `${…}` 안쪽은 바깥이 감싸면 같이 감싸진다. */
function literalsOf(line) {
  const found = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (ch !== '"' && ch !== TICK) {
      i += 1;
      continue;
    }

    const end = endOfLiteral(line, i);
    if (end === -1) break;

    found.push({ at: i, text: line.slice(i + 1, end) });
    i = end + 1;
  }

  return found;
}

const leaks = [];

for (const found of globSync("src/**/*.ts", { cwd: PROJECT })) {
  const rel = found.replaceAll("\\", "/");
  if (SKIP_FILES.has(rel)) continue;

  const lines = readFileSync(path.join(PROJECT, rel), "utf8").split("\n");
  let inComment = false;
  let inLogCall = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (inComment) {
      if (trimmed.includes("*/")) inComment = false;
      return;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inComment = true;
      return;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

    // 로그 호출은 여러 줄로 이어진다. 닫는 괄호를 만날 때까지 통째로 건너뛴다.
    if (inLogCall) {
      if (trimmed.startsWith(")")) inLogCall = false;
      return;
    }
    if (LOG_CALL.test(line)) {
      if (/\(\s*$/u.test(line)) inLogCall = true;
      return;
    }

    for (const literal of literalsOf(line)) {
      if (!POLITE.test(literal.text)) continue;
      // `speak(` 바로 뒤면 이미 말투를 탄다.
      if (line.slice(0, literal.at).trimEnd().endsWith("speak(")) continue;
      leaks.push({ where: `${rel}:${index + 1}`, text: literal.text });
    }
  });
}

/**
 * 일부러 남겨 둔 것 — 초성으로 바뀌는 **본보기**라 자르면 뜻이 사라진다.
 * 예외를 늘리려면 여기 적고 이유를 남긴다. 줄 번호가 아니라 문장으로 적어야
 * 위에 한 줄 넣었다고 예외가 풀리지 않는다.
 */
const ALLOWED = new Set(["안녕하세요 → ㅇㄴㅎㅅㅇ"]);

const real = leaks
  .filter((leak) => !ALLOWED.has(leak.text))
  .map((leak) => `${leak.where}  ${leak.text.slice(0, 70)}`);

assert(
  `말투를 안 탄 문장 없음 (${leaks.length - real.length}개는 일부러 남김)`,
  real.length === 0,
  real.join("\n     "),
);

// 유저가 적은 글이 문장 끝에 오면 그 사람의 말이 잘린다. 그런 자리는 없어야 한다.
const tails = [];
for (const found of globSync("src/**/*.ts", { cwd: PROJECT })) {
  const rel = found.replaceAll("\\", "/");
  const source = readFileSync(path.join(PROJECT, rel), "utf8");
  const spoken = new RegExp(`speak\\((["${TICK}])((?:[^"${TICK}\\\\]|\\\\.)*?)\\1\\)`, "gu");
  for (const match of source.matchAll(spoken)) {
    const bare = (match[2] ?? "").replace(/[*_`~)\]}」』»>"'.\s]*$/u, "");
    if (bare.endsWith("}")) tails.push(`${rel}  ${match[2]}`);
  }
}

assert("유저가 적은 글로 끝나는 문장 없음", tails.length === 0, tails.join("\n     "));

finish();
