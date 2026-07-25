import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  TimestampStyles,
  time,
} from "discord.js";

import { defineMessageContextMenuCommand } from "../types.js";

/**
 * 메시지 컨텍스트 메뉴 — 메시지를 우클릭 > 앱 에서 실행한다.
 * 신고·번역·저장 같은 "이 메시지에 대해" 하는 기능에 어울린다.
 */
export default defineMessageContextMenuCommand({
  data: new ContextMenuCommandBuilder()
    .setName("메시지 정보")
    .setType(ApplicationCommandType.Message)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { targetMessage } = interaction;
    const characters = [...targetMessage.content].length;

    const lines = [
      `**작성자**: ${targetMessage.author.tag}`,
      `**메시지 ID**: \`${targetMessage.id}\``,
      `**보낸 시각**: ${time(targetMessage.createdAt, TimestampStyles.LongDateTime)}`,
      `**글자 수**: ${characters}자`,
      `**첨부파일**: ${targetMessage.attachments.size}개`,
      `**임베드**: ${targetMessage.embeds.length}개`,
      `**컴포넌트 줄**: ${targetMessage.components.length}개`,
      `**바로가기**: ${targetMessage.url}`,
    ];

    await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
  },
});
