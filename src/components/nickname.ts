import { logger } from "../logger.js";
import { runNicknameChange } from "../nickname/execute.js";
import { FIELD, MODAL_ID, MODE, NICK } from "../nickname/ids.js";
import { describeDurationError, formatDuration, parseDuration } from "../time.js";
import { response } from "../ui/response.js";
import { defineComponentHandler } from "../types.js";

/** 별명 시스템의 모달 제출을 처리한다. customId 는 `nick:<동작>` 형태다. */
export default defineComponentHandler({
  namespace: NICK,
  async execute(interaction, args) {
    if (args[0] !== MODAL_ID.dduttai) {
      logger.warn(`별명: 모르는 customId ${interaction.customId}`);
      return;
    }

    if (!interaction.isModalSubmit()) return;

    const nickname = interaction.fields.getTextInputValue(FIELD.nickname).trim();
    if (nickname === "") {
      await interaction.reply(
        response({
          status: "failure",
          title: "뚜따이 실패",
          description: "별명을 입력해 주세요.",
          user: interaction.user,
        }),
      );
      return;
    }

    const raw = interaction.fields.getTextInputValue(FIELD.duration).trim();

    // 비워 두면 직접 풀 때까지 유지한다.
    let expiresAt: number | null = null;

    if (raw !== "") {
      const parsed = parseDuration(raw);
      if (!parsed.ok) {
        await interaction.reply(
          response({
            status: "failure",
            title: "기간을 읽을 수 없습니다",
            description: describeDurationError(parsed.reason),
            fields: [{ name: "입력한 값", value: `\`${raw}\`` }],
            user: interaction.user,
          }),
        );
        return;
      }

      expiresAt = Date.now() + parsed.seconds * 1000;
      logger.debug(`뚜따이 기간 ${formatDuration(parsed.seconds)} (${raw})`);
    }

    await runNicknameChange(interaction, { mode: MODE.dduttai, nickname, expiresAt });
  },
});
