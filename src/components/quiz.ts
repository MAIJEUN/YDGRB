import { normalizeTitle, openGameHere } from "../games/command.js";
import quiz, { ACTION, FIELD, QUIZ, keepAnswer } from "../games/list/quiz.js";
import { refusedView } from "../games/views.js";
import { describeDurationError, formatDuration, parseDuration } from "../time.js";
import { defineComponentHandler } from "../types.js";
import { response } from "../ui/response.js";

/**
 * 퀴즈 모달 — 여기서 판이 열린다.
 *
 * customId 규칙: `quiz:new`
 *
 * 모달에 적은 값은 **친 사람에게만** 보인다. 정답이 채널에 새지 않게 하는 것이
 * 모달을 쓰는 유일한 이유다.
 */

/** 너무 짧으면 읽기도 전에 끝나고, 너무 길면 채널이 하루 종일 묶인다. */
const MIN_SECONDS = 10;
const MAX_SECONDS = 60 * 60;

export default defineComponentHandler({
  namespace: QUIZ,

  async execute(interaction, args) {
    if (!interaction.isModalSubmit()) return;
    if (args[0] !== ACTION.open) return;

    const question = interaction.fields.getTextInputValue(FIELD.question).trim();
    const answer = interaction.fields.getTextInputValue(FIELD.answer).trim();
    const rawDuration = interaction.fields.getTextInputValue(FIELD.duration).trim();
    const title = normalizeTitle(interaction.fields.getTextInputValue(FIELD.title));

    if (question === "" || answer === "") {
      await interaction.reply(
        response(refusedView("퀴즈 실패", "문제와 정답을 채워 주세요.", interaction.user)),
      );
      return;
    }

    const parsed = parseDuration(rawDuration);
    if (!parsed.ok) {
      await interaction.reply(
        response({
          status: "failure",
          title: "기간을 읽을 수 없습니다",
          description: describeDurationError(parsed.reason),
          fields: [{ name: "입력한 값", value: `\`${rawDuration}\`` }],
          user: interaction.user,
        }),
      );
      return;
    }

    if (parsed.seconds < MIN_SECONDS || parsed.seconds > MAX_SECONDS) {
      await interaction.reply(
        response({
          status: "failure",
          title: "기간이 맞지 않습니다",
          description: `**${formatDuration(MIN_SECONDS)}** 부터 **${formatDuration(MAX_SECONDS)}** 사이로 적어 주세요.`,
          fields: [
            { name: "입력한 값", value: `\`${rawDuration}\` (${formatDuration(parsed.seconds)})` },
          ],
          user: interaction.user,
        }),
      );
      return;
    }

    await openGameHere(interaction, quiz, {
      title,
      body: question,
      durationSeconds: parsed.seconds,
      // 시작하기 전에 맡긴다 — 시작한 뒤에 맡기면 그 사이에 들어온 답을 놓친다.
      prepare: (sessionId) => {
        keepAnswer(sessionId, answer);
      },
    });
  },
});
