import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { response } from "../ui/response.js";
import { defineCommand } from "../types.js";
import { PANEL, isPanelKind } from "../wish/ids.js";
import { panelView } from "../wish/views.js";

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("소원권")
    .setDescription("소원권 시스템")
    // 소원권은 서버별로 관리되므로 DM 에서는 쓸 수 없다.
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName("패널")
        .setDescription("소원권 패널을 엽니다.")
        .addStringOption((option) =>
          option
            .setName("종류")
            .setDescription("열 패널을 고르세요")
            .setRequired(true)
            .addChoices(
              { name: "유저", value: PANEL.user },
              { name: "관리자", value: PANEL.admin },
            ),
        ),
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

    const kind = interaction.options.getString("종류", true);
    if (!isPanelKind(kind)) {
      await interaction.reply(
        response({
          status: "failure",
          title: "알 수 없는 패널",
          description: "유저 또는 관리자 패널만 열 수 있어요.",
          user: interaction.user,
        }),
      );
      return;
    }

    // 관리자 패널은 서버 관리자만.
    if (
      kind === PANEL.admin &&
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) !== true
    ) {
      await interaction.reply(
        response({
          status: "failure",
          title: "권한이 없습니다",
          description: "관리자 패널은 **관리자** 권한을 가진 사람만 열 수 있어요.",
          user: interaction.user,
        }),
      );
      return;
    }

    // 패널은 누른 사람에게만 보이게 둔다 — 남의 패널을 눌러서 조작하는 일이 없도록.
    await interaction.reply(response(await panelView(interaction.guildId, kind, interaction.user)));
  },
});
