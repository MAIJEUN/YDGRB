import { PermissionFlagsBits } from "discord.js";

import { logger } from "../logger.js";
import { ACTION, NICK } from "../nickname/ids.js";
import { cancelRun } from "../nickname/registry.js";
import { response } from "../ui/response.js";
import { defineComponentHandler } from "../types.js";
import { speak } from "../ui/tone.js";

/**
 * 별명 시스템의 버튼을 처리한다. 지금은 취소 버튼 하나뿐이다.
 * (뚜따이는 모달 대신 `/별명 뚜따이` 의 옵션으로 값을 받는다)
 */
export default defineComponentHandler({
  namespace: NICK,
  async execute(interaction, args) {
    if (args[0] !== ACTION.cancel) {
      logger.warn(`별명: 모르는 customId ${interaction.customId}`);
      return;
    }

    if (!interaction.isButton()) return;

    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageNicknames) !== true) {
      await interaction.reply(
        response({
          status: "failure",
          title: speak("권한이 없습니다"),
          description: speak("이 기능은 **별명 관리** 권한을 가진 사람만 쓸 수 있어요."),
          user: interaction.user,
        }),
      );
      return;
    }

    const guildId = interaction.guildId;
    const run = guildId === null ? undefined : cancelRun(guildId, interaction.user.id, args[1]);

    if (run === undefined) {
      await interaction.reply(
        response({
          status: "failure",
          title: speak("취소할 작업이 없습니다"),
          description: speak("이미 끝났거나 다른 작업으로 바뀐 것 같아요."),
          user: interaction.user,
        }),
      );
      return;
    }

    // 진행 중인 루프가 화면을 「취소됨」으로 갈아 끼우므로 여기서는 인터랙션만 종료한다.
    await interaction.deferUpdate();
  },
});
