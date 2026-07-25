import {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  TimestampStyles,
  time,
} from "discord.js";

import { defineCommand } from "../types.js";

const DISCORD_BLURPLE = 0x5865f2;

export default defineCommand({
  // Embed 와 서버 전용 제한 예시.
  data: new SlashCommandBuilder()
    .setName("serverinfo")
    .setNameLocalizations({ ko: "서버정보" })
    .setDescription("이 서버의 기본 정보를 보여줍니다.")
    // DM 에서는 호출할 수 없게 서버 전용으로 제한한다.
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    // setContexts 로 이미 막았지만, guild 타입을 좁히기 위해 한 번 더 확인한다.
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "이 명령은 서버 안에서만 사용할 수 있어요.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { guild } = interaction;
    const owner = await guild.fetchOwner();

    const embed = new EmbedBuilder()
      .setColor(DISCORD_BLURPLE)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: "서버 ID", value: guild.id, inline: true },
        { name: "소유자", value: owner.user.tag, inline: true },
        { name: "멤버", value: `${guild.memberCount}명`, inline: true },
        { name: "채널", value: `${guild.channels.cache.size}개`, inline: true },
        { name: "역할", value: `${guild.roles.cache.size}개`, inline: true },
        {
          name: "부스트",
          value: `${guild.premiumSubscriptionCount ?? 0}회 (레벨 ${guild.premiumTier})`,
          inline: true,
        },
        {
          name: "만든 날짜",
          // time() 은 보는 사람의 시간대로 표시되는 타임스탬프 마크업을 만든다.
          value: time(guild.createdAt, TimestampStyles.LongDate),
        },
      )
      .setFooter({ text: `요청: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
});
