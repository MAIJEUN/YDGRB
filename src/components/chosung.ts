import { checkDuration, normalizeTitle, openGameHere } from "../games/command.js";
import { keepAnswer } from "../games/answer.js";
import chosung, { ACTION, CHOSUNG, FIELD } from "../games/list/chosung.js";
import { refusedView } from "../games/views.js";
import { hasSyllable, toChoseong } from "../hangul.js";
import { defineComponentHandler } from "../types.js";
import { response } from "../ui/response.js";

/**
 * 초성퀴즈 모달 — 여기서 판이 열린다.
 *
 * customId 규칙: `chosung:new`
 *
 * 받은 글자를 초성으로 바꿔 **문제**로 띄우고, 원래 글자를 **정답**으로 맡긴다.
 * 화면에는 초성만 나가고 원래 글자는 판이 끝날 때 처음 공개된다.
 */
export default defineComponentHandler({
  namespace: CHOSUNG,

  async execute(interaction, args) {
    if (!interaction.isModalSubmit()) return;
    if (args[0] !== ACTION.open) return;

    const text = interaction.fields.getTextInputValue(FIELD.text).replaceAll(/\s+/gu, " ").trim();
    const rawDuration = interaction.fields.getTextInputValue(FIELD.duration).trim();
    const title = normalizeTitle(interaction.fields.getTextInputValue(FIELD.title));

    if (text === "") {
      await interaction.reply(
        response(refusedView("초성퀴즈 실패", "낼 글자를 적어 주세요.", interaction.user)),
      );
      return;
    }

    // 한글 음절이 하나도 없으면 초성 문제가 답과 똑같아진다 — 내는 순간 답이 보인다.
    if (!hasSyllable(text)) {
      await interaction.reply(
        response(
          refusedView(
            "초성퀴즈 실패",
            "한글이 없어 초성으로 바꿀 것이 없습니다. 숫자나 영문만으로는 문제가 되지 않아요.",
            interaction.user,
          ),
        ),
      );
      return;
    }

    const duration = checkDuration(rawDuration, interaction.user);
    if (!duration.ok) {
      await interaction.reply(response(duration.view));
      return;
    }

    await openGameHere(interaction, chosung, {
      title,
      body: `# ${toChoseong(text)}`,
      durationSeconds: duration.seconds,
      // 시작하기 전에 맡긴다 — 시작한 뒤에 맡기면 그 사이에 들어온 답을 놓친다.
      prepare: (sessionId) => {
        keepAnswer(sessionId, text);
      },
    });
  },
});
