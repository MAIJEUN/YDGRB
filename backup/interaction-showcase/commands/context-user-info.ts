import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  TimestampStyles,
  time,
} from "discord.js";

import { defineUserContextMenuCommand } from "../types.js";

/**
 * 유저 컨텍스트 메뉴 — 유저를 우클릭(모바일은 길게 누르기) > 앱 에서 실행한다.
 * 슬래시 커맨드와 달리 이름에 공백과 대문자를 쓸 수 있고, 옵션은 가질 수 없다.
 */
export default defineUserContextMenuCommand({
  data: new ContextMenuCommandBuilder()
    .setName("유저 정보")
    .setType(ApplicationCommandType.User)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { targetUser, targetMember } = interaction;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: targetUser.tag, iconURL: targetUser.displayAvatarURL() })
      .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "유저 ID", value: targetUser.id, inline: true },
        { name: "봇인가요?", value: targetUser.bot ? "예" : "아니오", inline: true },
        {
          name: "계정 생성",
          value: time(targetUser.createdAt, TimestampStyles.RelativeTime),
          inline: true,
        },
      );

    // 서버 밖에서 부르면 멤버 정보가 없을 수 있다.
    if (targetMember !== null && "joinedAt" in targetMember && targetMember.joinedAt !== null) {
      embed.addFields({
        name: "서버 참여",
        value: time(targetMember.joinedAt, TimestampStyles.RelativeTime),
        inline: true,
      });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
});
