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
 * 취소 버튼을 제목 **오른쪽 위**에 두어야 해서 컨테이너(Components V2)로 그린다 —
 * 임베드는 안에 버튼을 넣을 수 없다. 색상·footer 규칙은 임베드와 같다.
 *
 * 한 번 컨테이너로 만든 메시지는 임베드로 바꿀 수 없으므로,
 * 준비·진행·결과 화면 모두 `layout: "container"` 를 유지한다.
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
function tally(progress: Progress): string {
  return [
    `전체 **${progress.total}명**`,
    `완료 **${progress.changed + progress.skipped}명**`,
    `실패 **${progress.failed}명**`,
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

/** 멤버 목록을 받아오는 동안 보여 줄 첫 화면. 여기서 컨테이너 속성이 정해진다. */
export function preparingView(options: ViewOptions, run: ActiveRun): MessageOptions {
  return {
    status: "progress",
    title: `${MODE_LABEL[options.mode]} 준비 중`,
    description: `${subject(options.mode, options.nickname)}\n멤버 목록을 받아오고 있습니다.`,
    fields: expiryField(options.expiresAt),
    user: options.user,
    layout: "container",
    accessoryButton: cancelButton(run.id),
    ephemeral: false,
  };
}

/** 진행 중 화면 — 실시간으로 이 내용만 갈아 끼운다. */
export function progressView(
  options: ViewOptions,
  progress: Progress,
  run: ActiveRun,
): MessageOptions {
  return {
    status: "progress",
    title: `${MODE_LABEL[options.mode]} 진행 중`,
    description: subject(options.mode, options.nickname),
    fields: [
      { name: "진행", value: bar(progress.done, progress.total) },
      { name: "집계", value: tally(progress) },
      ...expiryField(options.expiresAt),
    ],
    user: options.user,
    layout: "container",
    accessoryButton: cancelButton(run.id),
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
  run?: ActiveRun,
): MessageOptions {
  if (result.cancelled) {
    return {
      // 끝까지 가지 못했으므로 성공도 실패도 아니다.
      status: "progress",
      title: `${MODE_LABEL[options.mode]} 취소됨`,
      description: [
        run === undefined ? "중단했습니다." : cancelReason(run),
        "이미 바뀐 사람은 그대로 남아 있습니다.",
      ].join(" "),
      fields: [
        { name: "진행", value: bar(result.done, result.total) },
        { name: "집계", value: tally(result) },
        ...expiryField(options.expiresAt),
      ],
      user: options.user,
      layout: "container",
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
    description: subject(options.mode, options.nickname),
    // 실패 원인은 화면에 늘어놓지 않는다 (로그에만 남긴다).
    fields: [
      { name: "집계", value: tally({ ...result, done: result.total }) },
      ...expiryField(options.expiresAt),
    ],
    user: options.user,
    layout: "container",
    rows: [],
    ephemeral: false,
  };
}
