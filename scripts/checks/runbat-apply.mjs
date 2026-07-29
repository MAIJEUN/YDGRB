// 업데이트 적용을 **같은 창에서** 하는지 실제로 돌려 본다.
//
// 실행 중이라 덮어쓸 수 없는 것은 run.bat 하나뿐이다. 나머지는 그 자리에서 옮기고,
// run.bat 만 마지막 한 줄이 갈아 끼운 뒤 새것을 이 창에서 실행한다.
// 그 마지막 대목을 run.bat 에서 그대로 떼어 와 가짜 압축 결과에 대고 돌린다.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PROJECT, assert, finish, skipUnlessWindows } from "./_harness.mjs";

const BAT = `${PROJECT}/run.bat`;

// cmd.exe 를 실제로 돌려 보는 검사다. 다른 OS 에서는 볼 것이 없다.
skipUnlessWindows("cmd.exe 가 있어야 합니다");

const text = readFileSync(BAT, "utf8");

// 적용 대목을 있는 그대로 떼어 온다 — 베껴 적으면 escape 가 어긋나도 모른다.
const start = text.indexOf("REM  지금 실행 중이라 덮어쓸 수 없는 파일은");
const block = start === -1 ? undefined : text.slice(start).trimEnd();

if (block === undefined) {
  console.log("  ❌ 적용 대목을 찾지 못했습니다");
  process.exit(1);
}

console.log("\n=== 새 창을 띄우지 않는다 ===");
assert("적용 대목에 start 가 없음", !/^\s*start\b/imu.test(block), "start 를 쓰면 새 창이 뜬다");
assert("  └ 도우미 배치를 만들지 않음", !text.includes("HELPER"), "임시 배치 = 새 창");
assert(
  "  └ 새 run.bat 은 자식 cmd 로 (같은 콘솔을 물려받는다)",
  block.includes('cmd /d /s /c ""%~f0" %*"'),
);

console.log("\n=== 바꾸고 · 실행하고 · 끝내기가 한 줄 ===");
const swap = block.split(/\r?\n/u).find((line) => line.includes('move /y "%CD%\\run.bat.new"'));
assert("한 줄 안에 셋이 다 있음", swap !== undefined && /move[\s\S]*cmd \/d \/s \/c[\s\S]*exit/u.test(swap), swap);
assert(
  "  └ exit /b 가 아니라 exit",
  swap !== undefined && /&\s*exit\s*$/u.test(swap),
  "서브루틴 안이라 exit /b 는 :menu 로 돌아가 버린다",
);
assert(
  "프롤로그도 한 줄로 이어 둠",
  text.includes('cmd /d /s /c ""%~f0" %*" & exit /b'),
  "줄을 나누면 바뀐 파일을 옛 위치부터 다시 읽는다",
);
assert(
  "  └ 거기서는 exit /b 에 코드를 안 붙임",
  !/cmd \/d \/s \/c ""%~f0" %\*" & exit \/b %errorlevel%/u.test(text),
  "%errorlevel% 은 줄을 읽을 때 이미 펼쳐진다",
);

console.log("\n=== run.bat 만 따로 뺀다 ===");
assert(
  "복사 전에 run.bat 을 .new 로 치움",
  block.indexOf('move /y "%UNPACK%\\run.bat"') < block.indexOf("xcopy"),
  "실행 중인 자기 자신을 xcopy 로 덮어쓰면 그 자리에서 깨진다",
);
assert("  └ 나머지는 그 자리에서 옮김", block.includes('xcopy /e /i /y "%UNPACK%\\*" "%CD%\\"'));
assert("  └ 옮기다 실패하면 그냥 진행", /xcopy[\s\S]{0,160}goto :eof/u.test(block));

// ── 실제로 돌려 보기 ────────────────────────────────────────
console.log("\n=== 실제로 돌려 보기 ===");

const sandbox = path.join(tmpdir(), `apply-${Date.now()}`);
const home = path.join(sandbox, "home");
const unpack = path.join(sandbox, "unpack");
mkdirSync(path.join(home, "data"), { recursive: true });
mkdirSync(path.join(unpack, "dist"), { recursive: true });

// 새 버전에 들어 있는 척하는 파일들. VERSION 은 일부러 넣지 않는다 —
// zip 에 VERSION 이 빠져 있어도 버전이 맞아야 하기 때문이다.
writeFileSync(path.join(unpack, "package.json"), '{"version":"new"}');
writeFileSync(path.join(unpack, "dist", "index.js"), "// new\n");
// 새 run.bat. 갈아 끼워진 뒤 같은 창에서 실행되면 이 줄이 찍힌다.
writeFileSync(path.join(unpack, "run.bat"), "@echo off\r\necho NEW-RUN-BAT-SPEAKING\r\nexit /b 0\r\n");

// 덮어쓰기에 휩쓸리면 안 되는 것들.
writeFileSync(path.join(home, ".env"), "DISCORD_TOKEN=secret\r\n");
writeFileSync(path.join(home, "data", "wishes.json"), '{"keep":true}');
writeFileSync(path.join(home, "VERSION"), "2026.700.0");

const zip = path.join(sandbox, "fake.zip");
writeFileSync(zip, "zip");

// 떼어 온 대목이 곧 「실행 중인 run.bat」 이 되도록 driver.bat 에 넣는다.
// 마지막 줄이 이 파일 자신을 새것으로 갈아 끼우게 된다.
const driver = path.join(home, "driver.bat");
writeFileSync(
  driver,
  [
    "@echo off",
    `set "UNPACK=${unpack}"`,
    `set "ZIP=${zip}"`,
    'set "LATEST=2026.729.0"',
    block,
    "",
  ].join("\r\n"),
);

let output = "";
try {
  output = execSync(`call "${driver}"`, { cwd: home, timeout: 60_000, encoding: "utf8" });
} catch (error) {
  output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
}

assert(
  "갈아 끼운 run.bat 이 같은 창에서 이어 실행됨",
  output.includes("NEW-RUN-BAT-SPEAKING"),
  JSON.stringify(output),
);
assert(
  "  └ 실행 중이던 배치가 새 내용으로 바뀜",
  readFileSync(driver, "utf8").includes("NEW-RUN-BAT-SPEAKING"),
);
assert("  └ .new 는 남지 않음", !readdirSync(home).includes("run.bat.new"), readdirSync(home).join(", "));

const version = readFileSync(path.join(home, "VERSION"), "utf8");
assert("새 파일이 덮어써짐", readFileSync(path.join(home, "package.json"), "utf8").includes("new"));
assert("  └ 하위 폴더까지", readdirSync(path.join(home, "dist")).includes("index.js"));
assert(
  "zip 에 VERSION 이 없어도 버전이 갱신됨",
  version === "2026.729.0",
  `실제로 적힌 값: ${JSON.stringify(version)}`,
);
assert("  └ 줄바꿈이 붙지 않음", !/[\r\n]/u.test(version), JSON.stringify(version));
assert(".env 는 그대로", readFileSync(path.join(home, ".env"), "utf8").includes("secret"));
assert("data 는 그대로", readFileSync(path.join(home, "data", "wishes.json"), "utf8").includes("keep"));
assert("다시 설치하라는 표식을 남김", readdirSync(home).includes(".update-applied"));

const leftovers = readdirSync(sandbox);
assert("푼 폴더를 치움", !leftovers.includes("unpack"), leftovers.join(", "));
assert("zip 을 치움", !leftovers.includes("fake.zip"), leftovers.join(", "));

// 갈아 끼운 뒤 다시 물어보지 않게 하는 표식.
assert("다시 묻지 않게 표식을 세움", block.includes('set "YDGRB_UPDATED=1"'));
assert("  └ 확인 쪽이 그 표식을 봄", text.includes("if defined YDGRB_UPDATED"));

try {
  rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
} catch {
  console.log(`  (임시 폴더가 잠겨 있어 남겨 둡니다: ${sandbox})`);
}

finish();
