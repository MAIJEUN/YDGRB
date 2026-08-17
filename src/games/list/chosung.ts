import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

import { customId } from "../../types.js";
import { answerGame } from "../answer.js";
import { titleInput } from "../command.js";
import { defineGame } from "../types.js";

/**
 * 초성퀴즈 — **즉시 시작** 형식. 퀴즈와 같은 방식이다.
 *
 * 다른 점은 **문제를 만들어 낸다**는 것 하나뿐이다. 낼 글자를 받아 초성으로 바꿔 보여
 * 주고, 원래 글자를 맞히면 이긴다.
 *
 *   안녕하세요  →  ㅇㄴㅎㅅㅇ
 *
 * 맞히고 · 이기고 · 끝나는 규칙은 [answer.ts](../answer.ts) 가 맡는다 — 퀴즈와 같은 것이다.
 *
 * 낼 글자는 곧 정답이므로 **모달로 받는다.** 슬래시 옵션에 적으면 채널에 그대로 보인다.
 */

export const CHOSUNG = "chosung";

/** customId: `chosung:new` */
export const ACTION = { open: "new" } as const;

export const FIELD = {
  text: "text",
  duration: "duration",
  title: "title",
} as const;

/** 초성으로 바꾸면 글자 수는 그대로다. 한 줄에 들어갈 만큼만 받는다. */
export const MAX_TEXT_LENGTH = 60;

export function chosungModal(): ModalBuilder {
  const row = (input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(input);

  return new ModalBuilder()
    .setCustomId(customId(CHOSUNG, ACTION.open))
    .setTitle("초성퀴즈")
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.text)
          .setLabel("텍스트")
          // 초성으로 바뀌는 본보기라 말투를 입히지 않는다 — 「안녕하ㅅ-」가 되면 뜻이 사라진다.
          .setPlaceholder("안녕하세요 → ㅇㄴㅎㅅㅇ")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(MAX_TEXT_LENGTH),
      ),
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.duration)
          .setLabel("기간")
          .setPlaceholder("3분 · 2일 · 90(숫자만 쓰면 초). 10초 ~ 365일")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30),
      ),
      // 제목은 형식이 정한 칸이다.
      titleInput(FIELD.title),
    );
}

export default defineGame({
  id: CHOSUNG,
  name: "초성퀴즈",
  description: "초성만 보고 원래 글자를 맞히는 게임.",
  mode: "instant",
  ...answerGame,
});
