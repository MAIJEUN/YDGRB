import { checkDuration, normalizeTitle, openGameHere } from "../games/command.js";
import { keepAnswer } from "../games/answer.js";
import chosung, { ACTION, CHOSUNG, FIELD } from "../games/list/chosung.js";
import { refusedView } from "../games/views.js";
import { toChoseong } from "../hangul.js";
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

    // 초성만 적어도 그대로 통과시킨다. 그때는 문제와 정답이 같아져 화면에 답이 보이지만,
    // 그건 적은 사람이 알고 하는 일이다 — 봇이 대신 판단하지 않는다.

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
