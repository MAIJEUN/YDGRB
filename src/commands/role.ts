import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { PANEL } from "../roles/ids.js";
import { panelView } from "../roles/views.js";
import { response } from "../ui/response.js";
import { speak } from "../ui/tone.js";
import { defineCommand } from "../types.js";
import { refusedView } from "../games/views.js";

/**
 * `/역할 패널`
 *
 * 관리자가 사람마다 「이 역할들만」 을 열어 주면, 그 사람은 **권한 없이** 유저 패널에서
 * 그 역할들을 스스로 붙였다 뗀다. 디스코드 역할 권한을 주면 아무 역할이나 만지게 되므로,
 * 명단을 두고 봇이 대신 붙였다 떼는 것이다.
 *
 * 여는 방식은 [소원권 패널](../commands/wish.ts)과 같다 — 관리자는 관리자 패널로,
 * 나머지는 유저 패널로 열리고, 관리자는 제목 오른쪽 버튼으로 둘을 오간다.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("역할")
    .setDescription("역할 패널")
    // 역할은 서버의 것이라 DM 에서는 쓸 수 없다.
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub.setName("패널").setDescription(speak("역할 패널을 엽니다."))),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply(
        response(
          refusedView("서버 전용", speak("이 명령은 서버 안에서만 사용할 수 있어요."), interaction.user),
        ),
      );
      return;
    }

    const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);

    // 패널은 누른 사람에게만 보이게 둔다 — 남의 패널을 눌러서 조작하는 일이 없도록.
    await interaction.reply(
      response(await panelView(interaction.member, isAdmin ? PANEL.admin : PANEL.user, isAdmin)),
    );
  },
});
