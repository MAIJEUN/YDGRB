import path from "node:path";
import { pathToFileURL } from "node:url";

import { logger } from "../logger.js";
import type { Command } from "../types.js";
import { collectModuleFiles } from "./module-files.js";

const COMMANDS_DIR = path.join(import.meta.dirname, "..", "commands");

const KINDS = new Set(["chatInput", "userContextMenu", "messageContextMenu"]);

function isCommand(value: unknown): value is Command {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<Command>;
  return (
    typeof candidate.kind === "string" &&
    KINDS.has(candidate.kind) &&
    typeof candidate.execute === "function" &&
    typeof candidate.data === "object" &&
    candidate.data !== null &&
    typeof candidate.data.name === "string"
  );
}

/**
 * src/commands 의 모든 파일에서 default export 를 읽어 커맨드 목록을 만든다.
 * 봇 실행(index.ts)과 커맨드 등록(deploy-commands.ts)이 같은 목록을 공유한다.
 */
export async function collectCommands(): Promise<Command[]> {
  const commands: Command[] = [];
  const keys = new Set<string>();

  for (const filePath of await collectModuleFiles(COMMANDS_DIR)) {
    const relativePath = path.relative(process.cwd(), filePath);
    const module: unknown = await import(pathToFileURL(filePath).href);
    const command = (module as { default?: unknown }).default;

    if (!isCommand(command)) {
      logger.warn(`커맨드 형식이 아니어서 건너뜁니다 (default export 확인): ${relativePath}`);
      continue;
    }

    // 슬래시 커맨드와 컨텍스트 메뉴는 이름 공간이 달라 같은 이름을 써도 된다.
    const key = `${command.kind}:${command.data.name}`;
    if (keys.has(key)) {
      throw new Error(`커맨드 이름이 중복되었습니다: ${key} (${relativePath})`);
    }

    keys.add(key);
    commands.push(command);
    logger.debug(`커맨드 로드: ${key} (${relativePath})`);
  }

  return commands;
}
