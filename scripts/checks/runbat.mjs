// run.bat 검증 — 인코딩 · 줄바꿈 · 파싱 · 업데이트 흐름.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PROJECT, assert, finish, skipUnlessWindows } from "./_harness.mjs";

const BAT = `${PROJECT}/run.bat`;

// cmd.exe 를 실제로 돌려 보는 검사다. 다른 OS 에서는 볼 것이 없다.
skipUnlessWindows("cmd.exe 가 있어야 합니다");

const bytes = readFileSync(BAT);
const text = bytes.toString("utf8");

console.log("\n=== 1. 파일 자체 ===");
assert("BOM 이 없음", !(bytes[0] === 0xef && bytes[1] === 0xbb), "BOM 이 있으면 cmd 가 첫 줄을 못 읽는다");
assert("줄바꿈이 CRLF", !/(?<!\r)\n/u.test(text), "LF 만 있으면 goto·괄호 블록이 깨진다");
assert("UTF-8 로 읽힘", text.includes("소원권 봇"));

console.log("\n=== 2. 코드 페이지 (「'닫고' is not recognized」 의 원인) ===");
// 라벨 줄 자체를 경계로 잡는다 — 주석 안의 ":main" 에 걸리지 않게.
const prologue = text.slice(0, text.indexOf("\r\n:main\r\n"));

assert("chcp 를 부른 뒤 자기 자신을 다시 실행", prologue.includes('cmd /d /s /c ""%~f0" %*"'));
assert("  └ 두 번 돌지 않게 표식을 둠", prologue.includes('if "%YDGRB_UTF8%"=="1" goto main'));
assert(
  "  └ :main 앞은 전부 ASCII",
  // 여기가 한 글자라도 한글이면 옛 코드 페이지로 읽혀 같은 문제가 난다.
  ![...prologue].some((c) => c.charCodeAt(0) > 0x7f),
  [...prologue].filter((c) => c.charCodeAt(0) > 0x7f).join(""),
);
// 주석이 아닌 실제 chcp 명령은 프롤로그 한 곳뿐이어야 한다.
const chcpLines = text.split("\r\n").filter((line) => /^\s*(echo\s+)?chcp\b/iu.test(line.trim()));
assert("  └ chcp 명령이 파일 중간에 다시 나오지 않음", chcpLines.length === 1, chcpLines.join(" | "));

console.log("\n=== 3. 괄호 블록 안의 특수문자 ===");
// if (...) 블록 안에서 escape 안 된 ) 가 있으면 블록이 거기서 끊긴다.
const lines = text.split("\r\n");
let depth = 0;
const broken = [];

for (const [index, line] of lines.entries()) {
  const trimmed = line.trim();
  if (trimmed.startsWith("rem ") || trimmed.startsWith("REM ")) continue;

  // echo 줄에 escape 안 된 괄호가 있는지 — 블록 안이면 거기서 끊긴다.
  if (depth > 0 && /^echo /iu.test(trimmed)) {
    const bare = trimmed.replace(/\^[()<>&|]/gu, "");
    if (/[()]/u.test(bare)) broken.push(`${index + 1}: ${trimmed}`);
  }

  // 블록 깊이 세기 (echo 줄의 escape 된 괄호는 빼고).
  const counted = trimmed.replace(/\^[()<>&|]/gu, "").replace(/"[^"]*"/gu, "");
  depth += (counted.match(/\(/gu) ?? []).length;
  depth -= (counted.match(/\)/gu) ?? []).length;
  if (depth < 0) depth = 0;
}

assert("블록 안 echo 의 괄호가 전부 escape 됨", broken.length === 0, broken.join("\n     "));
assert("괄호가 맞음", depth === 0, `깊이 ${depth}`);

console.log("\n=== 4. 업데이트 확인 ===");
assert("VERSION 을 기준으로 비교", text.includes('if not exist "VERSION"'));
assert("  └ 없으면 조용히 넘어감 (소스 실행)", /if not exist "VERSION" \(\s*\r\n\s*REM[\s\S]{0,120}goto :eof/u.test(text));
assert("최신 태그를 GitHub 에서 읽음", text.includes("releases/latest"));
assert("  └ 응답을 기다리다 멈추지 않게 타임아웃", text.includes("-TimeoutSec 5"), "없으면 인터넷이 막혔을 때 실행기가 통째로 멈춘다");
assert("  └ 실패해도 그냥 진행", text.includes("확인하지 못했습니다. 그냥 진행합니다"));
assert("같으면 최신이라고 알림", text.includes('if "%LATEST%"=="%CURRENT%"'));
assert("다르면 물어봄 (Y/N)", text.includes("지금 업데이트할까요? (Y/N)"));
assert("  └ Y 가 아니면 건너뜀", text.includes('if /i not "%ANSWER%"=="Y"'));
assert("예약 실행에서는 묻지 않음", text.indexOf('if /i "%~1"=="bot" goto bot') < text.indexOf("call :check_update"));

console.log("\n=== 5. 업데이트 적용 ===");
assert("zip 을 받아서 품", text.includes("curl -L --fail") && text.includes("tar -xf"));
// 새 창을 띄우지 않는다 — 자세한 것은 runbat-apply-check.
// (메모장을 여는 `start "" notepad` 는 업데이트와 상관없으므로 :do_update 뒤만 본다.)
const applyPart = text.slice(text.indexOf("\r\n:do_update\r\n"));
assert("업데이트가 새 창을 띄우지 않음", !/^\s*start\s/mu.test(applyPart), "start 를 쓰면 새 창이 뜬다");
assert("  └ 임시 도우미 배치도 없음", !text.includes("HELPER"));
assert(
  "실행 중인 run.bat 만 따로 갈아 끼움",
  text.includes('move /y "%UNPACK%\\run.bat" "%UNPACK%\\run.bat.new"'),
);
// zip 에 VERSION 이 없던 시절에 만들어진 릴리스로 업데이트하면 버전이 그대로 남아
// 매번 다시 물어보게 된다. 방금 받은 태그를 직접 적어 그 구멍을 막는다.
assert("받은 태그를 VERSION 에 적음", text.includes('<nul set /p "=%LATEST%">"%CD%\\VERSION"'));
assert(
  "  └ 덮어쓴 뒤에 적음 (zip 의 VERSION 이 이겨도 무효)",
  text.indexOf('xcopy /e /i /y "%UNPACK%') < text.indexOf('set /p "=%LATEST%"'),
);
assert("의존성이 늘었을 수 있으니 다시 설치", text.includes('.update-applied'));
assert("  └ 표식을 지우고 npm ci", /del \/q "\.update-applied"[\s\S]{0,200}npm ci --omit=dev/u.test(text));
assert("갈아 끼운 직후에는 다시 묻지 않음", text.includes("if defined YDGRB_UPDATED"));

// .env 와 data 는 zip 에 없으므로 덮어쓰기에 휩쓸리지 않는다.
const workflow = readFileSync(`${PROJECT}/.github/workflows/release.yml`, "utf8");
assert("릴리스에 VERSION 을 넣음", workflow.includes("> release/VERSION"));
assert("  └ 줄바꿈 없이 버전만", workflow.includes(`printf '%s' "$VERSION"`), "set /p 가 줄바꿈까지 읽으면 비교가 어긋난다");
assert("  └ .env 와 data 는 안 들어감", !/for item in[^\n]*\.env\b(?!\.example)/u.test(workflow) && !workflow.includes(" data "));

console.log("\n=== 6. 실제로 돌려 보기 ===");
const sandbox = path.join(tmpdir(), `runbat-${Date.now()}`);
mkdirSync(path.join(sandbox, "dist"), { recursive: true });
mkdirSync(path.join(sandbox, "node_modules"), { recursive: true });
writeFileSync(path.join(sandbox, "dist", "index.js"), "process.exit(0);\n");
writeFileSync(path.join(sandbox, ".env"), "DISCORD_TOKEN=abc\r\nDISCORD_CLIENT_ID=1\r\n");
writeFileSync(path.join(sandbox, "run.bat"), bytes);

function run(args) {
  const log = path.join(sandbox, "out.txt");
  rmSync(log, { force: true });

  try {
    // execSync 는 cmd 로 그대로 넘겨 준다 — execFileSync 로 넘기면 Node 가
    // 따옴표를 한 번 더 감싸 경로가 깨진다.
    // 명령을 따옴표로 시작하지 않도록 call 을 앞에 둔다.
    execSync(`call "${path.join(sandbox, "run.bat")}" ${args} > "${log}" 2>&1`, {
      timeout: 40_000,
      stdio: "ignore",
      cwd: sandbox,
    });
  } catch {
    // 종료 코드는 흐름에 따라 다르다. 우리가 볼 것은 출력이다.
  }

  return readFileSync(log, "utf8");
}

// VERSION 이 없으면 업데이트 확인을 건너뛴다 → 곧장 봇으로.
const output = run("bot");

assert("깨진 줄이 실행되지 않음", !/is not recognized|인식되지/u.test(output), output);
assert("  └ 한글이 온전히 나옴", output.includes("소원권 봇"), output);
assert("  └ 배너가 세 줄로", (output.match(/={10,}/gu) ?? []).length === 2, output);
assert("VERSION 이 없으면 업데이트 확인을 건너뜀", !output.includes("업데이트를 확인합니다"), output);
assert("바로 봇을 시작함", output.includes("봇을 시작합니다"), output);

// 잘못된 폴더에서 돌리면 안내하고 멈춘다.
rmSync(path.join(sandbox, "dist"), { recursive: true, force: true });
const missing = run("bot");
assert("dist 가 없으면 안내", missing.includes("dist\\index.js 가 없습니다"), missing);
assert("  └ 그 줄도 안 깨짐", !/is not recognized/u.test(missing), missing);

rmSync(sandbox, { recursive: true, force: true });

finish();
