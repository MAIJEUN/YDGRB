import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Client } from "discord.js";

import { logger } from "../logger.js";
import type { AnyEventHandler } from "../types.js";
import { collectModuleFiles } from "./module-files.js";

const EVENTS_DIR = path.join(import.meta.dirname, "..", "events");

function isEventHandler(value: unknown): value is AnyEventHandler {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as { name?: unknown; execute?: unknown };
  return typeof candidate.name === "string" && typeof candidate.execute === "function";
}

/** src/events 의 default export 들을 클라이언트에 연결하고, 등록한 개수를 돌려준다. */
export async function registerEvents(client: Client): Promise<number> {
  let registered = 0;

  for (const filePath of await collectModuleFiles(EVENTS_DIR)) {
    const relativePath = path.relative(process.cwd(), filePath);
    const module: unknown = await import(pathToFileURL(filePath).href);
    const handler = (module as { default?: unknown }).default;

    if (!isEventHandler(handler)) {
      logger.warn(`이벤트 형식이 아니어서 건너뜁니다 (default export 확인): ${relativePath}`);
      continue;
    }

    // 핸들러마다 이벤트 인자 타입이 달라 여기서는 하나로 좁힐 수 없다.
    // 타입 안전성은 defineEvent 가 각 파일에서 보장하므로, 연결 지점만 느슨하게 둔다.
    const execute = handler.execute as (...args: unknown[]) => unknown;

    // 한 핸들러의 예외가 프로세스를 죽이지 않도록 여기서 모두 잡는다.
    const listener = (...args: unknown[]): void => {
      try {
        const result = execute(...args);
        if (result instanceof Promise) {
          result.catch((error: unknown) => {
            logger.error(`이벤트 ${handler.name} 처리 중 오류`, error);
          });
        }
      } catch (error) {
        logger.error(`이벤트 ${handler.name} 처리 중 오류`, error);
      }
    };

    if (handler.once === true) client.once(handler.name, listener);
    else client.on(handler.name, listener);

    registered += 1;
    logger.debug(`이벤트 등록: ${handler.name}${handler.once === true ? " (once)" : ""} (${relativePath})`);
  }

  return registered;
}
