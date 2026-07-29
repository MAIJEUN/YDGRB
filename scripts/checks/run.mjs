import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * 검사를 전부 돌린다 (`npm test`).
 *
 * 하나씩 **따로 띄운다.** 검사마다 cwd 를 임시 폴더로 옮기거나 로그 기준을 바꾸거나
 * 예약 타이머를 걸어 두기 때문에, 한 프로세스에 몰아넣으면 서로 간섭한다.
 *
 * 인자를 주면 그 이름만 돌린다 —  `npm test -- debug format`
 */

const HERE = import.meta.dirname;

const wanted = process.argv.slice(2);

const files = readdirSync(HERE)
  .filter((name) => name.endsWith(".mjs"))
  // `_` 로 시작하는 것은 검사가 아니라 공용 부품이다.
  .filter((name) => !name.startsWith("_") && name !== "run.mjs")
  .filter((name) => wanted.length === 0 || wanted.includes(name.replace(/\.mjs$/u, "")))
  .sort();

if (files.length === 0) {
  console.error(`돌릴 검사가 없습니다: ${wanted.join(", ")}`);
  process.exit(1);
}

const started = Date.now();
const failures = [];

for (const file of files) {
  const name = file.replace(/\.mjs$/u, "");
  console.log(`\n${"─".repeat(60)}\n▶ ${name}\n${"─".repeat(60)}`);

  const result = spawnSync(process.execPath, [path.join(HERE, file)], { stdio: "inherit" });
  if (result.status !== 0) failures.push(name);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n${"═".repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ 검사 ${files.length}개 전부 통과 (${seconds}초)`);
} else {
  console.log(`❌ ${failures.length}/${files.length} 실패 — ${failures.join(", ")} (${seconds}초)`);
}

process.exit(failures.length === 0 ? 0 : 1);
