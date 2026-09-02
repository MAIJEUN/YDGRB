import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { openGameHere, readTitle, titleOption } from "../games/command.js";
import tangsuyuk, { STEPS, keepChain } from "../games/list/tangsuyuk.js";
import { defineCommand } from "../types.js";
import { speak } from "../ui/tone.js";

/**
 * `/탕수육` — 제목 말고는 정할 것이 없다.
 *
 * 치는 글자도, 순서도, 지는 조건도 게임이 정해 놓은 것이다. 명령이 받을 값이 없으니
 * 모달도 옵션도 두지 않는다.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("탕수육")
    .setDescription(speak(`${STEPS.join(" · ")} 을 번갈아 치는 게임입니다.`))
    .setContexts(InteractionContextType.Guild)
    .addStringOption(titleOption),

  async execute(interaction) {
    await openGameHere(interaction, tangsuyuk, {
      title: readTitle(interaction),
      // **시계를 걸지 않는다.** 기다리는 것이 시간이 아니라 사람이다. 아무도 안 치면
      // 판은 그대로 있고, 그만두려면 오른쪽 위 「종료」를 누른다.
      durationSeconds: null,
      // 화면을 만들기 전에 놓는다 — 여는 순간이 곧 시작이라, 첫 메시지가 이미 한 수다.
      prepare: keepChain,
    });
  },
});
