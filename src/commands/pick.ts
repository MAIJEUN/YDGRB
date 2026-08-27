import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { openGameHere, readTitle, titleOption } from "../games/command.js";
import pick, {
  CHOICE_SECONDS,
  MAX_CHOICES,
  MIN_CHOICES,
  MODE,
  MODE_LABEL,
  durationModal,
  isPickMode,
  keepPick,
  pickBody,
  roundName,
} from "../games/list/pick.js";
import { defineCommand } from "../types.js";
import { speak } from "../ui/tone.js";

/**
 * `/찍기대작전 [선택지수] [형식] [제목]`
 *
 * 형식이 두 갈래라 여는 길도 둘이다.
 *
 *   선택 — 여기서 곧바로 판이 선다. 연 사람이 고를 때까지 돈다.
 *   랜덤 — **기간 모달**을 띄우고, 제출하는 순간 판이 선다
 *          ([모달 핸들러](../components/pick.ts)).
 *
 * 기간을 슬래시 옵션으로 두지 않은 이유는, 디스코드에 「이 옵션을 고르면 저 옵션이 뜬다」
 * 가 없어서다. 옵션으로 두면 선택 방식에도 쓸모없는 칸이 따라다닌다.
 */

const OPTION = { choices: "선택지수", mode: "형식" } as const;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("찍기대작전")
    .setDescription(speak("숫자 하나를 찍어 맞히는 게임입니다."))
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName(OPTION.choices)
        .setDescription(`1 부터 이 숫자까지 중에 하나 (${MIN_CHOICES} ~ ${MAX_CHOICES})`)
        .setRequired(true)
        .setMinValue(MIN_CHOICES)
        .setMaxValue(MAX_CHOICES),
    )
    .addStringOption((option) =>
      option
        .setName(OPTION.mode)
        .setDescription(`연 사람이 고를지 봇이 고를지 — 비우면 ${MODE_LABEL.choice}`)
        .addChoices(
          { name: speak(`${MODE_LABEL.choice} — 판을 연 사람이 고릅니다`), value: MODE.choice },
          { name: speak(`${MODE_LABEL.random} — 기간이 끝나면 봇이 고릅니다`), value: MODE.random },
        ),
    )
    .addStringOption(titleOption),

  async execute(interaction) {
    const choices = interaction.options.getInteger(OPTION.choices, true);
    const raw = interaction.options.getString(OPTION.mode);
    const mode = isPickMode(raw ?? undefined) ? raw : MODE.choice;

    // 랜덤은 얼마 뒤에 고를지를 받아야 한다. 모달은 **첫 응답**으로만 띄울 수 있다.
    if (mode === MODE.random) {
      await interaction.showModal(durationModal(choices, readTitle(interaction)));
      return;
    }

    await openGameHere(interaction, pick, {
      title: readTitle(interaction),
      // 몇 중에 하나였는지를 제목에 싣는다 — 버튼은 끝나면서 사라진다.
      name: roundName(choices),
      body: pickBody(MODE.choice, interaction.user.id),
      // 연 사람이 고를 때까지 기다린다. 방치된 판이 채널을 묶지 않게 두는 시계다.
      durationSeconds: CHOICE_SECONDS,
      // 화면을 만들기 전에 맡긴다 — 여는 순간이 곧 시작이라 첫 화면에 버튼이 붙어야 한다.
      prepare: (sessionId) => {
        keepPick(sessionId, MODE.choice, choices);
      },
    });
  },
});
