import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { chosungModal } from "../games/list/chosung.js";
import { defineCommand } from "../types.js";
import { speak } from "../ui/tone.js";

/**
 * `/초성퀴즈` — 옵션이 하나도 없다.
 *
 * 낼 글자가 곧 정답이라, 슬래시 옵션에 적으면 명령을 친 순간 채널에 그대로 보인다.
 * 그래서 전부 모달로 받는다 ([퀴즈](quiz.ts)와 같은 이유).
 *
 * 판을 여는 것은 [모달 핸들러](../components/chosung.ts)가 한다.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("초성퀴즈")
    .setDescription(speak("초성만 보고 원래 글자를 맞히는 게임입니다."))
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    // 모달은 **첫 응답**으로만 띄울 수 있다. 앞에서 defer 하거나 답하면 안 된다.
    await interaction.showModal(chosungModal());
  },
});
