import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { response } from "../ui/response.js";
import { defineCommand } from "../types.js";
import { PANEL } from "../wish/ids.js";
import { panelView } from "../wish/views.js";
import { speak } from "../ui/tone.js";

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("소원권")
    .setDescription("소원권 시스템")
    // 소원권은 서버별로 관리되므로 DM 에서는 쓸 수 없다.
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub.setName("패널").setDescription(speak("소원권 패널을 엽니다."))),

  async execute(interaction) {
    if (interaction.guildId === null) {
      await interaction.reply(
        response({
          status: "failure",
          title: "서버 전용",
          description: speak("이 명령은 서버 안에서만 사용할 수 있어요."),
          user: interaction.user,
        }),
      );
      return;
    }

    const isAdmin =
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;

    // 관리자는 관리자 패널로, 나머지는 유저 패널로 연다.
    // 관리자는 제목 오른쪽 버튼으로 두 패널을 오갈 수 있다.
    const kind = isAdmin ? PANEL.admin : PANEL.user;

    // 패널은 누른 사람에게만 보이게 둔다 — 남의 패널을 눌러서 조작하는 일이 없도록.
    await interaction.reply(
      response(await panelView(interaction.guildId, kind, interaction.user, isAdmin)),
    );
  },
});
