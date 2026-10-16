import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { countMessages } from "../info/messages.js";
import { profileView } from "../info/views.js";
import { editResponse, response } from "../ui/response.js";
import { defineCommand } from "../types.js";
import { speak } from "../ui/tone.js";

/** `/프로필쀼 [@유저]` — 비우면 자기 자신. */
const OPTION = { user: "유저" } as const;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("프로필쀼")
    .setDescription(speak("유저의 정보를 보여줍니다. 비우면 자신의 정보를 봅니다."))
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) => option.setName(OPTION.user).setDescription("비우면 자신")),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
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

    const member = interaction.options.getMember(OPTION.user) ?? interaction.member;
    if (member === null) {
      await interaction.reply(
        response({
          status: "failure",
          title: speak("프로필을 볼 수 없습니다"),
          description: speak("서버에 없는 사람입니다."),
          user: interaction.user,
        }),
      );
      return;
    }

    await interaction.deferReply();

    // 둘 다 디스코드에 따로 물어야 나온다. 서로 기다릴 이유가 없으니 함께 묻는다.
    const [banner, messages] = await Promise.all([
      // 배너는 멤버 정보에 딸려 오지 않는다. 유저를 새로 받아야 나온다.
      member.user
        .fetch(true)
        .then((fetched) => fetched.bannerURL({ size: 512, extension: "png" }) ?? null)
        .catch(() => null),
      // 지금까지 남긴 메시지 수 — 디스코드 검색에 개수만 묻는다.
      countMessages(interaction.client, interaction.guildId, member.id),
    ]);

    await interaction.editReply(editResponse(profileView(member, banner, interaction.user, messages)));
  },
});
