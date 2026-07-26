import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { defineCommand } from "../types.js";
import { runNicknameChange } from "../nickname/execute.js";
import { MODE } from "../nickname/ids.js";
import { dduttaiModal } from "../nickname/modals.js";
import { response } from "../ui/response.js";

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("별명")
    .setDescription("서버 전체의 별명을 한꺼번에 바꿉니다.")
    .setContexts(InteractionContextType.Guild)
    // 디스코드 쪽에서도 권한 없는 사람에게는 아예 안 보이게 한다.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addSubcommand((sub) =>
      sub
        .setName("뚜따이")
        .setDescription("모두의 별명을 정한 값으로 바꿉니다. 기간이 지나면 자동으로 풀립니다."),
    )
    .addSubcommand((sub) =>
      sub.setName("바사삭").setDescription("모두의 별명을 초기화합니다."),
    ),

  async execute(interaction) {
    if (interaction.guildId === null) {
      await interaction.reply(
        response({
          status: "failure",
          title: "서버 전용",
          description: "이 명령은 서버 안에서만 사용할 수 있어요.",
          user: interaction.user,
        }),
      );
      return;
    }

    // 모달을 띄우기 전에 막는다 — 띄운 뒤에는 제출할 때까지 거절할 방법이 없다.
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

    if (interaction.options.getSubcommand() === "뚜따이") {
      // 별명과 기간은 모달에서 받는다. showModal 은 첫 응답으로만 가능하다.
      await interaction.showModal(dduttaiModal());
      return;
    }

    await runNicknameChange(interaction, {
      mode: MODE.basasak,
      nickname: null,
      expiresAt: null,
    });
  },
});
