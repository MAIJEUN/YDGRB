import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { serverView } from "../info/views.js";
import { response } from "../ui/response.js";
import { defineCommand } from "../types.js";

/** `/서ser버ber정jung보bow` — 이 서버에 대해 보여 줄 수 있는 것을 전부 보여 준다. */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("서ser버ber정jung보bow")
    .setDescription("이 서버의 정보를 보여줍니다.")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
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

    // 스티커는 기본으로 캐시되지 않는다. 없으면 0개로 보이므로 한 번 받아 온다.
    await interaction.guild.stickers.fetch().catch(() => null);

    await interaction.reply(response(serverView(interaction.guild, interaction.user)));
  },
});
