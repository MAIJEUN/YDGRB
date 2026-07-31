import path from "node:path";
import { pathToFileURL } from "node:url";

import { collectModuleFiles } from "../loaders/module-files.js";
import { logger } from "../logger.js";
import type { GameDefinition } from "./types.js";

/**
 * 게임 목록.
 *
 * `src/games/list/` 에 파일을 하나 넣으면 그게 곧 게임이다 —
 * 커맨드를 새로 만들 필요도, `npm run deploy` 를 다시 돌릴 필요도 없다
 * (`/게임 종류` 는 자동완성이라 목록을 실행 중에 읽는다).
 */

const LIST_DIR = path.join(import.meta.dirname, "list");

const games = new Map<string, GameDefinition>();

function isGame(value: unknown): value is GameDefinition {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<GameDefinition>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    (candidate.mode === "recruit" || candidate.mode === "instant") &&
    typeof candidate.start === "function"
  );
}

/** 아직 게임이 하나도 없으면 폴더 자체가 없다. 그건 문제가 아니다. */
async function listFiles(): Promise<string[]> {
  try {
    return await collectModuleFiles(LIST_DIR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadGames(): Promise<number> {
  games.clear();

  for (const filePath of await listFiles()) {
    const relativePath = path.relative(process.cwd(), filePath);
    const module: unknown = await import(pathToFileURL(filePath).href);
    const game = (module as { default?: unknown }).default;

    if (!isGame(game)) {
      logger.warn(`게임 형식이 아니어서 건너뜁니다 (default export 확인): ${relativePath}`);
      continue;
    }

    if (games.has(game.id)) {
      logger.warn(`게임 id 가 겹칩니다 — 나중 것을 건너뜁니다: ${game.id} (${relativePath})`);
      continue;
    }

    games.set(game.id, game);
    logger.debug(`게임 등록: ${game.id} (${relativePath})`);
  }

  return games.size;
}

export function getGame(id: string | undefined): GameDefinition | undefined {
  return id === undefined ? undefined : games.get(id);
}

export function allGames(): readonly GameDefinition[] {
  return [...games.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 검사와 개발용 — 파일 없이 게임을 끼워 넣는다. */
export function registerGame(game: GameDefinition): void {
  games.set(game.id, game);
}
