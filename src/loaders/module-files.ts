import { readdir } from "node:fs/promises";
import path from "node:path";

const MODULE_FILE = /\.(?:ts|mts|js|mjs)$/;

/**
 * dir 안의 모듈 파일 경로를 재귀적으로 모은다(하위 폴더로 카테고리를 나눠도 된다).
 * 개발 중에는 src 의 .ts 를, `npm run build` 후에는 dist 의 .js 를 읽게 된다.
 */
export async function collectModuleFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectModuleFiles(fullPath)));
    } else if (MODULE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }

  // 로드 순서를 실행 환경과 무관하게 고정한다.
  return files.sort();
}
