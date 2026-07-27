import type { User } from "discord.js";

import { atWithCountdown } from "../time.js";
import type { MessageOptions, ResponseField } from "../ui/response.js";
import { MODE_LABEL, type Mode } from "./ids.js";
import { cancelButton } from "./panels.js";
import type { ActiveRun } from "./registry.js";
import type { Progress, RunResult } from "./runner.js";

/**
 * 별명 작업 화면.
 *
 * 준비 → 진행 → 결과 순으로 같은 메시지를 갈아 끼운다.
 * 취소 버튼은 제목 오른쪽 끝(Section 액세서리)에 붙는다.
 */

const BAR_WIDTH = 16;

function bar(done: number, total: number): string {
  const ratio = total === 0 ? 1 : done / total;
  const filled = Math.round(ratio * BAR_WIDTH);

  return `\`${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}\`  ${Math.round(ratio * 100)}%`;
}

/**
 * 전체 · 완료 · 실패만 보여 준다.
 * 이미 같은 별명이라 건너뛴 사람도 원하는 상태이므로 완료로 센다.
 */
export function tally(progress: Progress): string {
  return [
    `전체 **${progress.total}명**`,
    `완료 **${progress.changed + progress.skipped}명**`,
    `실패 **${progress.failed}명**`,
  ].join(" · ");
}

function who(targetIds: readonly string[]): string {
  if (targetIds.length === 0) return "모두의";
  return `${targetIds.map((id) => `<@${id}>`).join(", ")} 님의`;
}

function subject(options: ViewOptions): string {
  const target = who(options.targetIds);

  return options.mode === "dduttai"
    ? `${target} 별명을 \`${options.nickname ?? ""}\` 로 바꿉니다.`
    : `${target} 별명을 지워 디스코드 기본값(사용자명)으로 되돌립니다.`;
}

/** 만료 안내 — 시각은 반드시 타임스탬프 마크다운으로 낸다. */
function expiryField(expiresAt: number | null): ResponseField[] {
  return expiresAt === null
    ? []
    : [{ name: "자동 바사삭", value: atWithCountdown(new Date(expiresAt)), inline: true }];
}

export interface ViewOptions {
  readonly mode: Mode;
  readonly nickname: string | null;
  readonly expiresAt: number | null;
  /** 비어 있으면 서버 전체. */
  readonly targetIds: readonly string[];
  readonly user: User;
}

/** 지목한 사람만 바꿀 때는 취소할 새도 없이 끝나므로 버튼을 달지 않는다. */
function accessory(run: ActiveRun | null): { accessoryButton?: ReturnType<typeof cancelButton> } {
  return run === null ? {} : { accessoryButton: cancelButton(run.id) };
}

/** 대상을 모으는 동안 보여 줄 첫 화면. 여기서 컨테이너 속성이 정해진다. */
export function preparingView(options: ViewOptions, run: ActiveRun | null): MessageOptions {
  return {
    status: "progress",
    title: `${MODE_LABEL[options.mode]} 준비 중`,
    description:
      options.targetIds.length === 0
        ? `${subject(options)}\n멤버 목록을 받아오고 있습니다.`
        : subject(options),
    fields: expiryField(options.expiresAt),
    user: options.user,
    ...accessory(run),
    ephemeral: false,
  };
}

/** 진행 중 화면 — 실시간으로 이 내용만 갈아 끼운다. */
export function progressView(
  options: ViewOptions,
  progress: Progress,
  run: ActiveRun | null,
): MessageOptions {
  return {
    status: "progress",
    title: `${MODE_LABEL[options.mode]} 진행 중`,
    description: subject(options),
    fields: [
      // 진행 막대는 그 자체로 한 줄을 채운다 — 나란히 붙이면 오히려 접힌다.
      { name: "진행", value: bar(progress.done, progress.total) },
      { name: "집계", value: tally(progress), inline: true },
      ...expiryField(options.expiresAt),
    ],
    user: options.user,
    ...accessory(run),
    ephemeral: false,
  };
}

/** 취소된 이유를 사람이 읽을 수 있게. */
function cancelReason(run: ActiveRun): string {
  if (run.supersededBy !== null) {
    return `**${MODE_LABEL[run.supersededBy]}** 이(가) 시작되어 중단했습니다.`;
  }

  return run.cancelledBy === null
    ? "중단했습니다."
    : `<@${run.cancelledBy}> 님이 취소했습니다.`;
}

export function resultView(
  options: ViewOptions,
  result: RunResult,
  run?: ActiveRun | null,
): MessageOptions {
  if (result.cancelled) {
    return {
      // 끝까지 가지 못했으므로 성공도 실패도 아니다.
      status: "progress",
      title: `${MODE_LABEL[options.mode]} 취소됨`,
      description: [
        run === undefined || run === null ? "중단했습니다." : cancelReason(run),
        "이미 바뀐 사람은 그대로 남아 있습니다.",
      ].join(" "),
      fields: [
        { name: "진행", value: bar(result.done, result.total) },
        { name: "집계", value: tally(result), inline: true },
        ...expiryField(options.expiresAt),
      ],
      user: options.user,
      rows: [],
      ephemeral: false,
    };
  }

  // 한 명도 못 바꿨으면 실패, 일부만 못 바꿨으면 진행중(노랑)으로 구분한다.
  const status =
    result.failed === 0 ? "success" : result.changed + result.skipped === 0 ? "failure" : "progress";

  return {
    status,
    title: `${MODE_LABEL[options.mode]} 완료`,
    description: subject(options),
    // 실패 원인은 화면에 늘어놓지 않는다 (로그에만 남긴다).
    fields: [
      { name: "집계", value: tally({ ...result, done: result.total }), inline: true },
      ...expiryField(options.expiresAt),
    ],
    user: options.user,
    rows: [],
    ephemeral: false,
  };
}
