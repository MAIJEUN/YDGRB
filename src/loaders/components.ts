import path from "node:path";
import { pathToFileURL } from "node:url";

import { logger } from "../logger.js";
import type { ComponentHandler } from "../types.js";
import { collectModuleFiles } from "./module-files.js";

const COMPONENTS_DIR = path.join(import.meta.dirname, "..", "components");

function isComponentHandler(value: unknown): value is ComponentHandler {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<ComponentHandler>;
  return typeof candidate.namespace === "string" && typeof candidate.execute === "function";
}

/** src/components 의 default export 들을 네임스페이스별로 모은다. */
export async function collectComponentHandlers(): Promise<ComponentHandler[]> {
  const handlers: ComponentHandler[] = [];
  const namespaces = new Set<string>();

  for (const filePath of await collectModuleFiles(COMPONENTS_DIR)) {
    const relativePath = path.relative(process.cwd(), filePath);
    const module: unknown = await import(pathToFileURL(filePath).href);
    const handler = (module as { default?: unknown }).default;

    if (!isComponentHandler(handler)) {
      logger.warn(`컴포넌트 핸들러 형식이 아니어서 건너뜁니다: ${relativePath}`);
      continue;
    }

    if (handler.namespace.includes(":")) {
      throw new Error(`네임스페이스에는 ':' 를 쓸 수 없습니다: ${handler.namespace} (${relativePath})`);
    }

    if (namespaces.has(handler.namespace)) {
      throw new Error(`컴포넌트 네임스페이스가 중복되었습니다: ${handler.namespace} (${relativePath})`);
    }

    namespaces.add(handler.namespace);
    handlers.push(handler);
    logger.debug(`컴포넌트 핸들러 로드: ${handler.namespace} (${relativePath})`);
  }

  return handlers;
}
