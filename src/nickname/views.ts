import type { User } from "discord.js";

import type { MessageOptions, ResponseField } from "../ui/response.js";
import { atWithCountdown } from "../time.js";
import { MODE_LABEL, type Mode } from "./ids.js";
import type { Progress, RunResult } from "./runner.js";

const BAR_WIDTH = 16;

function bar(progress: Progress): string {
  const ratio = progress.total === 0 ? 1 : progress.done / progress.total;
  const filled = Math.round(ratio * BAR_WIDTH);

  return `\`${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}\`  ${Math.round(ratio * 100)}%`;
}

function tally(progress: Progress): string {
  return [
    `전체 **${progress.total}명**`,
    `성공 **${progress.changed}명**`,
    `건너뜀 **${progress.skipped}명**`,
    `실패 **${progress.failed}명**`,
    `남음 **${progress.total - progress.done}명**`,
  ].join(" · ");
}

function subject(mode: Mode, nickname: string | null): string {
  return mode === "dduttai"
    ? `모두의 별명을 \`${nickname ?? ""}\` 로 바꿉니다.`
    : "모두의 별명을 지워 디스코드 기본값(사용자명)으로 되돌립니다.";
}

/** 만료 안내 — 시각은 반드시 타임스탬프 마크다운으로 낸다. */
function expiryField(expiresAt: number | null): ResponseField[] {
  return expiresAt === null
    ? []
    : [{ name: "자동 바사삭", value: atWithCountdown(new Date(expiresAt)) }];
}

export interface ViewOptions {
  readonly mode: Mode;
  readonly nickname: string | null;
  readonly expiresAt: number | null;
  readonly user: User;
}

/** 진행 중 화면 — 실시간으로 이 내용만 갈아 끼운다. */
export function progressView(options: ViewOptions, progress: Progress): MessageOptions {
  return {
    status: "progress",
    title: `${MODE_LABEL[options.mode]} 진행 중`,
    description: subject(options.mode, options.nickname),
    fields: [
      { name: "진행", value: bar(progress) },
      { name: "집계", value: tally(progress) },
      ...expiryField(options.expiresAt),
    ],
    user: options.user,
    layout: "embed",
    ephemeral: false,
  };
}

export function resultView(options: ViewOptions, result: RunResult): MessageOptions {
  // 한 명도 못 바꿨으면 실패, 일부만 못 바꿨으면 진행중(노랑)으로 구분한다.
  const status =
    result.failed === 0 ? "success" : result.changed + result.skipped === 0 ? "failure" : "progress";

  return {
    status,
    title: `${MODE_LABEL[options.mode]} 완료`,
    description: subject(options.mode, options.nickname),
    fields: [
      { name: "집계", value: tally({ ...result, done: result.total }) },
      ...expiryField(options.expiresAt),
      ...(result.failures.length > 0
        ? [{ name: "바꾸지 못한 사람", value: result.failures.join("\n").slice(0, 1000) }]
        : []),
    ],
    user: options.user,
    layout: "embed",
    ephemeral: false,
  };
}
