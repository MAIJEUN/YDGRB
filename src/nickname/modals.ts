import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

import { customId } from "../types.js";
import { FIELD, MAX_NICKNAME_LENGTH, MODAL_ID, NICK } from "./ids.js";

/** 뚜따이 — 별명과 (선택) 기간. */
export function dduttaiModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(NICK, MODAL_ID.dduttai))
    .setTitle("뚜따이")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("뚜따이할 별명")
        .setDescription(`서버 전원에게 적용됩니다. ${MAX_NICKNAME_LENGTH}자까지.`)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.nickname)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("예: 요땅그래")
            .setMinLength(1)
            .setMaxLength(MAX_NICKNAME_LENGTH)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("기간")
        .setDescription("이 기간이 지나면 자동으로 바사삭됩니다. 비우면 직접 풀 때까지 유지.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.duration)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("1일 4시간 45초  ·  64 (숫자만 쓰면 초)")
            .setMaxLength(60)
            .setRequired(false),
        ),
    );
}
