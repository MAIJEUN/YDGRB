import { keepAnswer } from "../games/answer.js";
import { checkDuration, normalizeTitle, openGameHere } from "../games/command.js";
import quiz, { ACTION, FIELD, QUIZ } from "../games/list/quiz.js";
import { refusedView } from "../games/views.js";
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

    const duration = checkDuration(rawDuration, interaction.user);
    if (!duration.ok) {
      await interaction.reply(response(duration.view));
      return;
    }

    await openGameHere(interaction, quiz, {
      title,
      body: question,
      durationSeconds: duration.seconds,
      // 시작하기 전에 맡긴다 — 시작한 뒤에 맡기면 그 사이에 들어온 답을 놓친다.
      prepare: (sessionId) => {
        keepAnswer(sessionId, answer);
      },
    });
  },
});
