import { SlashCommandBuilder } from "discord.js";

import { defineCommand } from "../types.js";

const DEFAULT_FACES = 6;
const MAX_FACES = 1000;
const MAX_COUNT = 20;

export default defineCommand({
  // 옵션을 받는 커맨드 예시. setMinValue/setMaxValue 를 걸어 두면
  // 디스코드 쪽에서 먼저 걸러 주므로 봇에서 범위 검사를 다시 할 필요가 없다.
  data: new SlashCommandBuilder()
    .setName("roll")
    .setNameLocalizations({ ko: "주사위" })
    .setDescription("주사위를 굴립니다.")
    .addIntegerOption((option) =>
      option
        .setName("faces")
        .setNameLocalizations({ ko: "면" })
        .setDescription(`주사위 면 수 (기본 ${DEFAULT_FACES})`)
        .setMinValue(2)
        .setMaxValue(MAX_FACES),
    )
    .addIntegerOption((option) =>
      option
        .setName("count")
        .setNameLocalizations({ ko: "개수" })
        .setDescription(`굴릴 개수 (기본 1, 최대 ${MAX_COUNT})`)
        .setMinValue(1)
        .setMaxValue(MAX_COUNT),
    ),

  async execute(interaction) {
    const faces = interaction.options.getInteger("faces") ?? DEFAULT_FACES;
    const count = interaction.options.getInteger("count") ?? 1;

    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * faces));
    const total = rolls.reduce((sum, value) => sum + value, 0);

    const breakdown = count === 1 ? "" : `\n\`${rolls.join(" + ")} = ${total}\``;

    await interaction.reply(`🎲 d${faces} × ${count} → **${total}**${breakdown}`);
  },
});
