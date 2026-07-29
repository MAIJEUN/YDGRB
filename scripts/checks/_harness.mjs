import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 검사 스크립트가 함께 쓰는 것들.
 *
 * 이 폴더의 검사들은 디스코드에 접속하지 않는다. 가짜 서버·유저·채널을 만들어
 * **빌드 결과(dist)를 실제로 돌려 보고**, 소스를 글자 단위로 훑어 규칙 위반을 잡는다.
 * 그래서 토큰 없이 어디서든 돌고, CI 에서도 돈다.
 *
 * 하나가 한 프로세스다 (`run.mjs` 가 따로따로 띄운다). 검사마다 cwd 를 임시 폴더로
 * 옮기거나 로그 기준을 바꾸기 때문에, 한 프로세스에 몰아넣으면 서로 간섭한다.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** 저장소 뿌리. 슬래시로 통일해 두어 `${PROJECT}/src/...` 를 그대로 쓸 수 있다. */
export const PROJECT = ROOT.replaceAll("\\", "/");

/**
 * 빌드 결과. 검사는 소스가 아니라 **실제로 돌아가는 것**을 본다.
 *
 * `file:///` 을 손으로 붙이면 리눅스에서 슬래시가 넷이 된다. URL 변환에 맡긴다.
 */
export const DIST = pathToFileURL(path.join(ROOT, "dist")).href;

let failed = 0;

export function assert(label, condition, detail = "") {
  if (condition) console.log(`  ✅ ${label}`);
  else {
    failed += 1;
    console.log(`  ❌ ${label}${detail === "" ? "" : `\n     ${detail}`}`);
  }
}

/** assert 로 감싸기 어려운 자리에서 직접 실패를 세울 때. */
export function fail(label, detail = "") {
  failed += 1;
  console.log(`  ❌ ${label}${detail === "" ? "" : `\n     ${detail}`}`);
}

export function failCount() {
  return failed;
}

/** 맨 끝에서 부른다. 하나라도 틀렸으면 0 이 아닌 코드로 끝난다. */
export function finish() {
  console.log(failed === 0 ? "\n✅ 전체 통과" : `\n❌ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

/**
 * 윈도우에서만 뜻이 있는 검사에서 부른다 (cmd.exe 를 돌려 보는 것들).
 *
 * CI 는 리눅스라 그냥 실패시키면 배포가 막힌다. 건너뛰되, 건너뛴 것을 보이게 남긴다.
 */
export function skipUnlessWindows(reason) {
  if (process.platform === "win32") return;

  console.log(`  ⏭  건너뜁니다 (${process.platform}) — ${reason}`);
  process.exit(0);
}
