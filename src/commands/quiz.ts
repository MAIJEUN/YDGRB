import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { quizModal } from "../games/list/quiz.js";
import { defineCommand } from "../types.js";

/**
 * `/퀴즈` — 옵션이 하나도 없다.
 *
 * 디스코드는 슬래시 커맨드에 넣은 값을 **채널에 그대로 보여 준다.** 정답을 옵션으로
 * 받으면 명령을 친 순간 모두가 답을 본다. 그래서 문제·정답·기간·제목을 전부 모달로 받는다.
 *
 * 판을 여는 것은 [모달 핸들러](../components/quiz.ts)가 한다.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("퀴즈")
    .setDescription("문제를 내고, 이 채널에 답을 적어 맞히는 게임입니다.")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    // 모달은 **첫 응답**으로만 띄울 수 있다. 앞에서 defer 하거나 답하면 안 된다.
    await interaction.showModal(quizModal());
  },
});
