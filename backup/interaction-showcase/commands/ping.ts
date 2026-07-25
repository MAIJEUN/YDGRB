import { MessageFlags, SlashCommandBuilder } from "discord.js";

import { defineCommand } from "../types.js";

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("ping")
    .setNameLocalizations({ ko: "핑" })
    .setDescription("봇 응답 속도를 확인합니다.")
    .setDescriptionLocalizations({ "en-US": "Check the bot's latency." }),

  async execute(interaction) {
    // withResponse: true 로 응답 메시지를 받아 실제 왕복 시간을 계산한다.
    const response = await interaction.reply({
      content: "측정 중…",
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    });

    const sentAt = response.resource?.message?.createdTimestamp ?? Date.now();
    const roundTrip = sentAt - interaction.createdTimestamp;

    // 하트비트를 아직 한 번도 못 받았으면 -1 이다.
    const heartbeat = interaction.client.ws.ping;

    await interaction.editReply(
      [
        `🏓 왕복 지연 **${roundTrip}ms**`,
        heartbeat < 0 ? "웹소켓 지연 측정 중…" : `웹소켓 지연 **${Math.round(heartbeat)}ms**`,
      ].join("\n"),
    );
  },
});
