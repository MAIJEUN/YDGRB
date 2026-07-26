import { PermissionFlagsBits } from "discord.js";

import { logger } from "../logger.js";
import { runNicknameChange } from "../nickname/execute.js";
import { ACTION, FIELD, MODAL_ID, MODE, NICK } from "../nickname/ids.js";
import { cancelRun } from "../nickname/registry.js";
import { describeDurationError, formatDuration, parseDuration } from "../time.js";
import { response } from "../ui/response.js";
import { defineComponentHandler, type ComponentInteraction } from "../types.js";

/**
 * 취소 버튼.
 *
 * 진행 중인 작업에 취소 표시만 남기고 응답은 하지 않는다 —
 * 그 작업의 루프가 곧 멈추면서 자기 메시지를 「취소됨」 화면으로 갈아 끼운다.
 */
async function handleCancel(
  interaction: ComponentInteraction,
  runId: string | undefined,
): Promise<void> {
  if (!interaction.isButton()) return;

  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageNicknames) !== true) {
    await interaction.reply(
      response({
        status: "failure",
        title: "권한이 없습니다",
        description: "이 기능은 **별명 관리** 권한을 가진 사람만 쓸 수 있어요.",
        user: interaction.user,
      }),
    );
    return;
  }

  const guildId = interaction.guildId;
  const run = guildId === null ? undefined : cancelRun(guildId, interaction.user.id, runId);

  if (run === undefined) {
    await interaction.reply(
      response({
        status: "failure",
        title: "취소할 작업이 없습니다",
        description: "이미 끝났거나 다른 작업으로 바뀐 것 같아요.",
        user: interaction.user,
      }),
    );
    return;
  }

  // 진행 중인 루프가 화면을 갱신하므로 여기서는 인터랙션만 종료한다.
  await interaction.deferUpdate();
}

/** 별명 시스템의 버튼과 모달 제출을 처리한다. customId 는 `nick:<동작>` 형태다. */
export default defineComponentHandler({
  namespace: NICK,
  async execute(interaction, args) {
    if (args[0] === ACTION.cancel) {
      await handleCancel(interaction, args[1]);
      return;
    }

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
