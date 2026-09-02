import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { openGameHere, readTitle, titleOption } from "../games/command.js";
import tangsuyuk, { STEPS, chainBody, chainName, keepChain } from "../games/list/tangsuyuk.js";
import { defineCommand } from "../types.js";
import { speak } from "../ui/tone.js";

/**
 * `/탕수육 [제목] [번갈아]`
 *
 * 치는 글자도 순서도 게임이 정해 놓은 것이라 받을 값이 거의 없다. 하나뿐인 것이
 * **번갈아** — 한 사람이 잇달아 칠 수 있는지다. 안 주면 칠 수 있다.
 */

const OPTION = { alternate: "번갈아" } as const;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("탕수육")
    .setDescription(speak(`${STEPS.join(" · ")} 을 차례로 치는 게임입니다.`))
    .setContexts(InteractionContextType.Guild)
    .addStringOption(titleOption)
    .addBooleanOption((option) =>
      option
        .setName(OPTION.alternate)
        .setDescription(speak("선택 · 켜면 한 사람이 잇달아 칠 수 없습니다.")),
    ),

  async execute(interaction) {
    const alternate = interaction.options.getBoolean(OPTION.alternate) ?? false;

    await openGameHere(interaction, tangsuyuk, {
      title: readTitle(interaction),
      // 번갈아 친 판이 더 어렵다. 결과만 남았을 때 무슨 판이었는지 알 수 있게 제목에 싣는다.
      name: chainName(alternate),
      body: chainBody(alternate),
      // **시계를 걸지 않는다.** 기다리는 것이 시간이 아니라 사람이다. 아무도 안 치면
      // 판은 그대로 있고, 그만두려면 오른쪽 위 「종료」를 누른다.
      durationSeconds: null,
      // 화면을 만들기 전에 놓는다 — 여는 순간이 곧 시작이라, 첫 메시지가 이미 한 수다.
      prepare: (sessionId) => {
        keepChain(sessionId, alternate);
      },
    });
  },
});
