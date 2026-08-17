import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

import { customId } from "../../types.js";
import { answerGame } from "../answer.js";
import { titleInput } from "../command.js";
import { defineGame } from "../types.js";
import { speak } from "../../ui/tone.js";

/**
 * 퀴즈 — **즉시 시작** 형식.
 *
 * 문제를 띄우고, 기간 동안 그 채널에 올라온 메시지를 본다. 정답을 맞힌 첫 사람이 이긴다.
 * 아무도 못 맞히면 기간이 끝나면서 정답을 공개하고 끝난다.
 *
 * 모집이 없다 — 답을 적는 순간 참가한 것이다.
 *
 * **문제와 정답은 모달로 받는다.** 슬래시 커맨드 옵션은 채널에 그대로 남아 아무나 볼 수
 * 있다 (「/퀴즈 문제: … 정답: …」 이 통째로 보인다). 그러면 정답이 새므로 쓸 수 없다.
 *
 * 맞히고 · 이기고 · 끝나는 규칙은 [answer.ts](../answer.ts) 가 맡는다 —
 * 초성퀴즈와 같은 것을 쓴다.
 */

export const QUIZ = "quiz";

/** customId: `quiz:new` */
export const ACTION = { open: "new" } as const;

export const FIELD = {
  question: "question",
  answer: "answer",
  duration: "duration",
  title: "title",
} as const;

export const MAX_QUESTION_LENGTH = 300;
export const MAX_ANSWER_LENGTH = 100;

export function quizModal(): ModalBuilder {
  const row = (input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(input);

  return new ModalBuilder()
    .setCustomId(customId(QUIZ, ACTION.open))
    .setTitle("퀴즈")
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.question)
          .setLabel("문제")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(MAX_QUESTION_LENGTH),
      ),
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.answer)
          .setLabel("정답")
          .setPlaceholder(speak("공백과 대소문자는 따지지 않습니다"))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(MAX_ANSWER_LENGTH),
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
      // 제목은 형식이 정한 칸이다. 모달로 받는 게임도 똑같이 둔다.
      titleInput(FIELD.title),
    );
}

export default defineGame({
  id: QUIZ,
  name: "퀴즈",
  description: "문제를 내고, 이 채널에 답을 적어 맞히는 게임.",
  mode: "instant",
  ...answerGame,
});
