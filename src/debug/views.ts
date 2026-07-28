import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type {
  MessageActionRowComponentBuilder,
  PermissionsBitField,
  PermissionsString,
  User,
} from "discord.js";

import { customId } from "../types.js";
import type { MessageOptions, ResponseField, Status } from "../ui/response.js";
import { NAMESPACE } from "./ids.js";

/**
 * 디버그 화면의 공통 골격.
 *
 * 디버그라고 형식을 벗어나지 않는다 — 다른 응답과 똑같이 렌더러 하나를 지나고,
 * 색도 네 가지 안에서 고른다. 보여 주기만 하는 것은 **파랑**, 무언가 바꿨으면 초록,
 * 되돌릴 수 없는 것을 물어보는 중이면 노랑, 못 찾았거나 실패했으면 빨강이다.
 */

export interface CardOptions {
  readonly status?: Status;
  readonly description?: string;
  readonly error?: unknown;
  readonly fields?: readonly ResponseField[];
  readonly rows?: readonly ActionRowBuilder<MessageActionRowComponentBuilder>[];
  readonly order?: readonly ("images" | "rows")[];
  /** 제목 오른쪽 끝에 붙는 버튼 하나. 새로고침처럼 화면에 딸린 동작에 쓴다. */
  readonly accessoryButton?: ButtonBuilder;
}

/** 제목은 규칙대로 「명령어 이름」 — 친 그대로인 `!y 상태` 가 제목이 된다. */
export function card(name: string, user: User, options: CardOptions = {}): MessageOptions {
  const { status = "info", ...rest } = options;
  return { status, title: `!y ${name}`, user, ...rest };
}

/** 값이 있을 때만 칸을 만든다. */
export function field(name: string, value: string | null): ResponseField[] {
  return value === null || value === "" ? [] : [{ name, value }];
}

export function yesNo(value: boolean): string {
  return value ? "예" : "아니오";
}

/** 목록을 줄로 세우고, 길면 남은 개수만 알린다. */
export function lines(items: readonly string[], max: number): string {
  if (items.length === 0) return "없음";

  const shown = items.slice(0, max);
  if (items.length > max) shown.push(`_외 ${items.length - max}개_`);

  return shown.join("\n");
}

/** 이름을 죽 늘어놓을 때 — 코드로 감싸 붙여 놓아야 눈이 덜 아프다. */
export function chips(items: readonly string[], max: number): string {
  if (items.length === 0) return "없음";

  const shown = items.slice(0, max).map((item) => `\`${item}\``);
  if (items.length > max) shown.push(`_외 ${items.length - max}개_`);

  return shown.join(" ");
}

// ─────────────────────────────────────────────────────────────
// 권한
// ─────────────────────────────────────────────────────────────

/**
 * 이 봇이 **하는 일에 실제로 필요한** 권한만 본다.
 *
 * 전부 늘어놓으면 40줄이 넘고, 그중 우리가 쓰는 건 몇 개 없다.
 * 여기 없는 권한이 빠져도 이 봇은 멀쩡히 돈다.
 */
export const NEEDED: readonly (readonly [PermissionsString, string])[] = [
  ["ViewChannel", "채널 보기"],
  ["SendMessages", "메시지 보내기"],
  ["ReadMessageHistory", "기록 읽기"],
  ["AttachFiles", "파일 첨부"],
  ["AddReactions", "반응 달기"],
  ["ManageRoles", "역할 관리"],
  ["ManageChannels", "채널 관리"],
  ["ManageNicknames", "별명 관리"],
  ["ModerateMembers", "타임아웃"],
  ["ViewAuditLog", "감사 로그"],
];

/** 가진 것은 `O`, 없는 것은 `X`. 빠진 게 있으면 그것만 따로 모아 준다. */
export function permissionTable(permissions: PermissionsBitField | null): {
  readonly table: string;
  readonly missing: readonly string[];
} {
  if (permissions === null) return { table: "확인할 수 없음", missing: [] };

  const missing: string[] = [];
  const rows = NEEDED.map(([flag, label]) => {
    // Administrator 를 빼고 본다 — 관리자가 있으면 전부 O 로 보여 정작 뭐가 빠졌는지 못 본다.
    const has = permissions.has(flag, false);
    if (!has) missing.push(label);

    return `${has ? "✅" : "❌"} ${label}`;
  });

  return { table: rows.join("\n"), missing };
}

// ─────────────────────────────────────────────────────────────
// 버튼
// ─────────────────────────────────────────────────────────────

export function confirmRow(
  action: "restart" | "stop",
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(NAMESPACE, action))
      .setLabel(action === "restart" ? "재시작" : "종료")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(customId(NAMESPACE, "cancel"))
      .setLabel("취소")
      .setStyle(ButtonStyle.Secondary),
  );
}

/** `!y 미리보기` 전용 — 눌러도 아무 일도 없어야 하므로 전부 잠가 둔다. */
export function sampleRow(): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(NAMESPACE, "sample"))
      .setLabel("보기용 버튼")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
  );
}

/** 상태 화면 오른쪽 위에 붙는 새로고침. */
export function refreshButton(name: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(customId(NAMESPACE, "refresh", name))
    .setLabel("새로고침")
    .setStyle(ButtonStyle.Secondary);
}
