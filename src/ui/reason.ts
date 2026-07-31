import type { ChatInputCommandInteraction, SlashCommandStringOption } from "discord.js";

import type { ResponseField } from "./response.js";

/**
 * 패널티 명령의 **사유** 칸.
 *
 * 타임아웃 · 타살버 · 뚜따이 · 채팅뻥이 모두 같은 이름 · 같은 모양으로 받는다.
 * 명령마다 다르게 생기면 쓰는 사람이 매번 다시 읽어야 한다.
 *
 * 적은 사유는 세 곳으로 간다 —
 *   1. 응답의 「사유」 칸
 *   2. 디스코드 **감사 로그** (서버 설정에서 나중에 되짚을 수 있다)
 *   3. 나중에 풀릴 때의 **종료 안내** (그러려면 저장해 둬야 한다)
 */

export const REASON_OPTION = "사유";

/**
 * 감사 로그가 받는 한도가 512자다. 거기에 명령 이름과 실행자까지 붙으므로 넉넉히 줄여 둔다.
 * 화면에서도 한 칸이 너무 길어지지 않는 선이다.
 */
export const MAX_REASON_LENGTH = 200;

/** 커맨드 빌더에 그대로 넘긴다 — `.addStringOption(reasonOption)` */
export function reasonOption(option: SlashCommandStringOption): SlashCommandStringOption {
  return option
    .setName(REASON_OPTION)
    .setDescription("왜 거는지. 감사 로그와 해제 안내에도 남습니다")
    .setMaxLength(MAX_REASON_LENGTH);
}

/**
 * 적은 사유를 읽는다. 안 적었으면 null.
 *
 * 줄바꿈은 칸 하나를 세로로 늘려 버리므로 한 줄로 눌러 담는다.
 */
export function readReason(interaction: ChatInputCommandInteraction): string | null {
  const raw = interaction.options.getString(REASON_OPTION)?.replaceAll(/\s+/gu, " ").trim() ?? "";
  if (raw === "") return null;

  return raw.length > MAX_REASON_LENGTH ? `${raw.slice(0, MAX_REASON_LENGTH - 3)}...` : raw;
}

/** 응답의 「사유」 칸. 안 적었으면 칸 자체를 만들지 않는다. */
export function reasonField(reason: string | null | undefined): ResponseField[] {
  return reason === null || reason === undefined || reason === "" ? [] : [{ name: "사유", value: reason }];
}

/**
 * 감사 로그에 남길 한 줄.
 *
 * 사유를 안 적었어도 **누가 걸었는지**는 남긴다 — 그게 감사 로그의 본래 값이다.
 */
export function auditReason(effect: string, actorTag: string, reason: string | null): string {
  const base = `${effect} — ${actorTag}`;
  return reason === null ? base : `${base}: ${reason}`;
}
