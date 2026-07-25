import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * YDGRB 버전 계산 — `YYYY.MD.A`
 *
 *   YYYY  네 자리 연도
 *   MD    달과 일을 그대로 이어 붙인 값 (5월 8일 → `58`, 7월 25일 → `725`)
 *   A     그날 몇 번째 릴리스인지. 0 부터 시작하고 두 자리 이상도 된다
 *
 *   예) 2026년 5월 8일 첫 릴리스 → `2026.58.0`, 그날 열한 번째 → `2026.58.10`
 *
 * 날짜가 바뀌면 앞자리가 달라지므로 A 는 자연히 0 부터 다시 센다.
 *
 * 주의: MD 를 0 으로 채우지 않기 때문에 1월 25일과 12월 5일이 둘 다 `125` 가 된다.
 * 지금 규칙 그대로 구현해 둔 것이며, 구분이 필요하면 `datePart` 에서 두 자리로 채우면 된다.
 */

/** 태그에서 읽어들일 형식. 앞에 `v` 나 `YDGRB` 가 붙어 있어도 받아 준다. */
const TAG_PATTERN = /^(?:v|YDGRB)?(\d{4})\.(\d{2,4})\.(\d+)$/iu;

/** 버전의 날짜 부분(`YYYY.MD`)을 만든다. */
export function datePart(date = new Date()) {
  return `${date.getFullYear()}.${date.getMonth() + 1}${date.getDate()}`;
}

/**
 * 기존 태그 목록을 보고 다음 버전을 정한다.
 *
 * 같은 날짜의 가장 큰 A 에 1 을 더한다 — 중간이 비어 있어도 번호를 재사용하지 않는다
 * (태그를 지웠다가 같은 번호로 다시 배포하면 어느 쪽 코드인지 알 수 없게 된다).
 */
export function nextVersion(tags, date = new Date()) {
  const prefix = datePart(date);

  let highest = -1;
  for (const raw of tags) {
    const match = TAG_PATTERN.exec(raw.trim());
    if (match === null) continue;
    if (`${match[1]}.${match[2]}` !== prefix) continue;

    highest = Math.max(highest, Number(match[3]));
  }

  return `${prefix}.${highest + 1}`;
}

/** 저장소의 태그 목록. git 이 없거나 저장소가 아니면 빈 배열. */
export function readTags() {
  try {
    return execFileSync("git", ["tag", "--list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\n");
  } catch {
    return [];
  }
}

// 직접 실행하면 다음 버전만 출력한다 (워크플로에서 그대로 받아 쓴다).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(nextVersion(readTags()));
}
