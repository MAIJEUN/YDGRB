import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * 지난 릴리스 이후의 커밋으로 릴리스 설명을 만든다.
 *
 * 커밋 메시지를 이렇게 쓰면 그대로 문서가 된다.
 *
 *   수정: 소원권 수락/거절 시 이미지 소멸 수정 — wish.ts:520 (decideWish)
 *   (빈 줄)
 *   증상: 수락/거절 버튼을 누르면 이미지가 즉시 사라짐.
 *   원인: attachment:// 는 그 요청에 올라가는 파일만 가리킬 수 있는데 …
 *   해결: 편집할 때 embeds/attachments 를 아예 보내지 않도록 …
 *
 * 결과:
 *
 *   ## 수정
 *   - `소원권 수락/거절 시 이미지 소멸 수정 — wish.ts:520 (decideWish)`
 *   > 증상: …
 *   > 원인: …
 *   > 해결: …
 *
 * 제목의 `분류:` 접두사로 묶인다. 접두사가 없으면 「기타」로 간다.
 */

const SECTIONS = [
  { title: "추가", aliases: ["추가", "신규", "feat", "add"] },
  { title: "수정", aliases: ["수정", "버그", "fix", "bugfix"] },
  { title: "변경", aliases: ["변경", "개선", "change", "refactor"] },
  { title: "제거", aliases: ["제거", "삭제", "remove"] },
];

const OTHER = "기타";

// git log 를 파싱하기 위한 구분자.
// 본문에 줄바꿈이 들어가므로 눈에 보이지 않는 제어문자를 쓴다 (US = 제목/본문, RS = 커밋 사이).
const UNIT = String.fromCharCode(0x1f);
const RECORD = String.fromCharCode(0x1e);

/** 커밋 제목을 분류와 실제 제목으로 나눈다. */
export function classify(subject) {
  const trimmed = subject.trim();
  const match = /^([^:：]{1,12})[:：]\s*(.+)$/u.exec(trimmed);
  if (match === null) return { section: OTHER, title: trimmed };

  const prefix = match[1].trim().toLowerCase();
  const found = SECTIONS.find((section) => section.aliases.includes(prefix));

  return found === undefined
    ? { section: OTHER, title: trimmed }
    : { section: found.title, title: match[2].trim() };
}

/** 본문을 인용문으로 바꾼다. 빈 줄도 `>` 로 이어야 인용이 중간에 끊기지 않는다. */
function quote(body) {
  return body
    .trim()
    .split(/\r?\n/u)
    .map((line) => (line.trim() === "" ? ">" : `> ${line.trimEnd()}`));
}

export function buildNotes(name, commits) {
  const grouped = new Map();

  for (const commit of commits) {
    const { section, title } = classify(commit.subject);
    if (title === "") continue;

    const items = grouped.get(section) ?? [];
    items.push({ title, body: commit.body });
    grouped.set(section, items);
  }

  const lines = [`# ${name}`, ""];

  for (const section of [...SECTIONS.map((entry) => entry.title), OTHER]) {
    const items = grouped.get(section);
    if (items === undefined) continue;

    lines.push(`## ${section}`, "");

    for (const item of items) {
      lines.push(`- \`${item.title}\``);
      if (item.body.trim() !== "") lines.push(...quote(item.body));
      lines.push("");
    }
  }

  if (grouped.size === 0) lines.push("_기록된 변경 내역이 없습니다._");

  return `${lines.join("\n").trimEnd()}\n`;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/** 가장 최근 태그. 없으면 undefined (첫 릴리스). */
export function previousTag() {
  try {
    return git(["describe", "--tags", "--abbrev=0"]).trim();
  } catch {
    return undefined;
  }
}

/** 지난 태그 이후의 커밋. 병합 커밋은 뺀다. */
export function readCommits(since = previousTag()) {
  const range = since === undefined ? "HEAD" : `${since}..HEAD`;

  let raw;
  try {
    raw = git(["log", range, "--no-merges", `--format=%s${UNIT}%b${RECORD}`]);
  } catch {
    return [];
  }

  return raw
    .split(RECORD)
    .map((record) => record.trim())
    .filter((record) => record !== "")
    .map((record) => {
      const separator = record.indexOf(UNIT);
      return separator === -1
        ? { subject: record, body: "" }
        : { subject: record.slice(0, separator).trim(), body: record.slice(separator + 1) };
    });
}

// 직접 실행하면 설명 전문을 출력한다.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const name = process.argv[2];
  if (name === undefined || name === "") {
    console.error("릴리스 이름이 필요합니다. 예) node scripts/release-notes.mjs YDGRB2026.725.0");
    process.exit(1);
  }

  process.stdout.write(buildNotes(name, readCommits()));
}
