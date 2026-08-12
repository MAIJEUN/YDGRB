import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { openGameHere, readTitle, titleOption } from "../games/command.js";
import firstcome, {
  DEFAULT_TARGET,
  MAX_TARGET,
  MIN_TARGET,
  MODE,
  MODE_LABEL,
  RACE_SECONDS,
  isRaceMode,
  keepRace,
  raceName,
} from "../games/list/firstcome.js";
import { refusedView } from "../games/views.js";
import { response } from "../ui/response.js";
import { defineCommand } from "../types.js";
import { speak } from "../ui/tone.js";

/**
 * `/선착순 [종류] [값] [제목]`
 *
 * 여기는 감출 것이 없어 옵션으로 받는다 — 방식과 목표는 어차피 제목에 그대로 실린다.
 * (퀴즈처럼 정답이 끼어 있으면 모달이어야 한다.)
 */

const OPTION = { mode: "종류", value: "값" } as const;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("선착순")
    .setDescription(speak("버튼을 먼저 누른 사람이 가져가는 게임입니다."))
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName(OPTION.mode)
        .setDescription("먼저 누른 n명인지, 딱 n번째로 누른 사람인지")
        .setRequired(true)
        .addChoices(
          { name: speak(`${MODE_LABEL.count} — 먼저 누른 n명이 가져갑니다`), value: MODE.count },
          { name: speak(`${MODE_LABEL.nth} — 딱 n번째로 누른 사람이 가져갑니다`), value: MODE.nth },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName(OPTION.value)
        .setDescription(`비우면 n명은 ${DEFAULT_TARGET.count}, n번째는 ${DEFAULT_TARGET.nth}`)
        .setMinValue(MIN_TARGET)
        .setMaxValue(MAX_TARGET),
    )
    .addStringOption(titleOption),

  async execute(interaction) {
    const mode = interaction.options.getString(OPTION.mode, true);
    if (!isRaceMode(mode)) {
      await interaction.reply(
        response(refusedView("선착순 실패", speak("종류를 골라 주세요."), interaction.user)),
      );
      return;
    }

    const target = interaction.options.getInteger(OPTION.value) ?? DEFAULT_TARGET[mode];

    await openGameHere(interaction, firstcome, {
      title: readTitle(interaction),
      // 목표는 제목에 싣는다 — 「선착순 3명 — 시작」
      name: raceName(mode, target),
      durationSeconds: RACE_SECONDS,
      // 화면을 만들기 전에 맡긴다 — 여는 순간 누가 누를 수 있고, 첫 화면에 버튼이 붙어야 한다.
      prepare: (sessionId) => {
        keepRace(sessionId, mode, target);
      },
    });
  },
});
