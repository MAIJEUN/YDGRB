import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { openGameHere, readTitle, titleOption } from "../games/command.js";
import roulette, { MAX_SEATS, MIN_SEATS } from "../games/list/roulette.js";
import { defineCommand } from "../types.js";
import { speak } from "../ui/tone.js";

/**
 * `/룰렛 [참가인원] [제목]`
 *
 * 참가 형식이라 판을 열면 모집 패널이 뜬다. **적은 만큼 다 모이면 저절로 돌아가고**,
 * 덜 모여도 「시작」 으로 돌릴 수 있다 (판을 연 사람과 관리자만).
 *
 * 감출 것이 없어 옵션으로 받는다 — 몇 명을 받는지는 어차피 패널의 인원 칸에 그대로 뜬다.
 */

const OPTION = { seats: "참가인원" } as const;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("룰렛")
    .setDescription(speak("모인 사람 중 한 명을 뽑는 게임입니다."))
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName(OPTION.seats)
        .setDescription(speak(`이만큼 모이면 바로 돌립니다 (${MIN_SEATS} ~ ${MAX_SEATS}명).`))
        .setRequired(true)
        .setMinValue(MIN_SEATS)
        .setMaxValue(MAX_SEATS),
    )
    .addStringOption(titleOption),

  async execute(interaction) {
    await openGameHere(interaction, roulette, {
      title: readTitle(interaction),
      // 정원은 게임이 아니라 **이 판**의 것이다. 골격이 참가를 막는 자리에서 이 값을 본다.
      maxPlayers: interaction.options.getInteger(OPTION.seats, true),
    });
  },
});
