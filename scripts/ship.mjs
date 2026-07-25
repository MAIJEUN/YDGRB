import { execFileSync } from "node:child_process";

/**
 * 검사를 통과했을 때만 커밋하고 푸시한다.
 *
 *   npm run ship -- "커밋 메시지"
 *
 * 푸시가 끝나면 GitHub Actions 가 이어서 빌드·배포하고 결과를 디스코드로 알린다.
 * 깨진 코드가 올라가서 배포가 실패하는 일을 줄이려고, 여기서 먼저 타입 검사와 빌드를 돌린다.
 */

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: "inherit", ...options });
}

function capture(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

// 메시지를 주면 한 줄 커밋, 안 주면 편집기가 열린다.
// 릴리스 설명의 상세 내용(증상·원인·해결)은 본문에 적어야 하므로 편집기 쪽이 기본에 가깝다.
const message = process.argv.slice(2).join(" ").trim();

try {
  capture("git", ["rev-parse", "--is-inside-work-tree"]);
} catch {
  fail("git 저장소가 아닙니다. 먼저 `git init` 과 원격 저장소 연결이 필요합니다. (RELEASE.md 참고)");
}

const changes = capture("git", ["status", "--porcelain"]);
if (changes === "") {
  fail("커밋할 변경이 없습니다.");
}

console.log("올라갈 변경:");
console.log(changes);
console.log();

console.log("▶ 타입 검사");
run("npm", ["run", "typecheck"], { shell: process.platform === "win32" });

console.log("▶ 빌드");
run("npm", ["run", "build"], { shell: process.platform === "win32" });

console.log("▶ 커밋");
run("git", ["add", "-A"]);

if (message === "") {
  console.log("  편집기에서 메시지를 작성하세요.");
  console.log("  첫 줄: `분류: 제목`  (분류 = 추가 · 수정 · 변경 · 제거)");
  console.log("  빈 줄 뒤 본문은 릴리스 설명의 인용문이 됩니다.\n");
  run("git", ["commit"]);
} else {
  run("git", ["commit", "-m", message]);
}

console.log("▶ 푸시");
run("git", ["push"]);

console.log("\n✔ 푸시 완료. GitHub Actions 가 빌드·배포하고 결과를 디스코드로 알립니다.");
