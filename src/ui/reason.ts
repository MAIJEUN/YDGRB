import { LabelBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  SlashCommandStringOption,
} from "discord.js";

import type { ResponseField } from "./response.js";
import { speak } from "./tone.js";

/**
 * **사유** 칸 — 남에게 무언가를 하는 명령이 왜 그랬는지 남기는 자리.
 *
 * 패널티(타임아웃 · 타살버)와 [소원권 변동](../wish/modals.ts)(수수 · 흡혈)이 모두 같은
 * 이름 · 같은 길이 · 같은 모양으로 받는다. 명령마다 다르게 생기면 쓰는 사람이 매번 다시
 * 읽어야 한다.
 *
 * 받는 방식만 두 가지다 — 슬래시 옵션(`reasonOption`)과 모달 칸(`reasonInput`).
 * 그 명령이 이미 쓰는 쪽에 맞춘다.
 *
 * 적은 사유가 가는 곳은 그 명령이 정한다 —
 *   · 어디서나    응답의 「사유」 칸 (`reasonField`)
 *   · 패널티만    디스코드 **감사 로그** (`auditReason`)
 *   · 패널티만    나중에 풀릴 때의 **종료 안내**
 *   · 소원권만    [역사](../wish/store.ts) — 날짜별로 다시 들춰 볼 수 있다
 *
 * 어느 쪽이든 **저장해 둬야** 나중에 다시 보여 줄 수 있다.
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
    .setDescription(speak("왜 거는지. 감사 로그와 해제 안내에도 남습니다"))
    .setMaxLength(MAX_REASON_LENGTH);
}

/**
 * 적은 사유를 다듬는다. 비어 있으면 null.
 *
 * 줄바꿈은 칸 하나를 세로로 늘려 버리므로 한 줄로 눌러 담는다.
 */
function normalizeReason(raw: string | null | undefined): string | null {
  const tidy = raw?.replaceAll(/\s+/gu, " ").trim() ?? "";
  if (tidy === "") return null;

  return tidy.length > MAX_REASON_LENGTH ? `${tidy.slice(0, MAX_REASON_LENGTH - 3)}...` : tidy;
}

/** 슬래시 옵션에서 사유를 읽는다. */
export function readReason(interaction: ChatInputCommandInteraction): string | null {
  return normalizeReason(interaction.options.getString(REASON_OPTION));
}

/**
 * 모달로 받는 사유. 슬래시 쪽과 **같은 이름 · 같은 길이**를 쓴다.
 *
 * 왜 적는지는 명령마다 달라서 설명만 받는다 — 패널티는 감사 로그에 남고, 소원권 변동은
 * 그 자리 안내에만 남는다.
 *
 * 모달에는 칸을 다섯 개까지만 넣을 수 있다. 사유를 붙일 때 그 수를 넘지 않는지 보라.
 */
export function reasonInput(fieldId: string, description: string): LabelBuilder {
  return new LabelBuilder()
    .setLabel(REASON_OPTION)
    .setDescription(description)
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId(fieldId)
        .setStyle(TextInputStyle.Short)
        .setMaxLength(MAX_REASON_LENGTH)
        .setRequired(false),
    );
}

/** 모달에서 사유를 읽는다. 안 적었으면 null. */
export function readModalReason(interaction: ModalSubmitInteraction, fieldId: string): string | null {
  return normalizeReason(interaction.fields.getTextInputValue(fieldId));
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
