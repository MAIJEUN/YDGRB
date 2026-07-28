import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { profileView } from "../info/views.js";
import { editResponse, response } from "../ui/response.js";
import { defineCommand } from "../types.js";

/** `/프로필쀼 [@유저]` — 비우면 자기 자신. */
const OPTION = { user: "유저" } as const;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("프로필쀼")
    .setDescription("유저의 정보를 보여줍니다. 비우면 자신의 정보를 봅니다.")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) => option.setName(OPTION.user).setDescription("비우면 자신")),

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

    const member = interaction.options.getMember(OPTION.user) ?? interaction.member;
    if (member === null) {
      await interaction.reply(
        response({
          status: "failure",
          title: "프로필을 볼 수 없습니다",
          description: "서버에 없는 사람입니다.",
          user: interaction.user,
        }),
      );
      return;
    }

    await interaction.deferReply();

    // 배너는 멤버 정보에 딸려 오지 않는다. 유저를 새로 받아야 나온다.
    const banner = await member.user
      .fetch(true)
      .then((fetched) => fetched.bannerURL({ size: 512, extension: "png" }) ?? null)
      .catch(() => null);

    await interaction.editReply(editResponse(profileView(member, banner, interaction.user)));
  },
});
