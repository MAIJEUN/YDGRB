import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { checkDuration, openGameHere, readTitle, titleOption } from "../games/command.js";
import vote, { MAX_CANDIDATES, MIN_CANDIDATES, keepPoll } from "../games/list/vote.js";
import { response } from "../ui/response.js";
import { defineCommand } from "../types.js";
import { speak } from "../ui/tone.js";

/**
 * `/국민투표 [참가인원] [기간] [제목]`
 *
 * 참가 형식이라 판을 열면 모집 패널이 뜬다. 「참가」를 누르면 **공약 모달**이 뜨고,
 * 제출해야 후보가 된다.
 *
 * **기간은 투표하는 시간**이다. 모집에 쓰는 시간이 아니다 — 모집은 형식이 정한 5분이고,
 * 시작하는 순간부터 이 기간이 흐른다.
 *
 * 감출 것이 없어 옵션으로 받는다. 남에게 보이면 안 되는 것은 공약뿐이고, 그건 모달로 받는다.
 */

const OPTION = { seats: "참가인원", time: "기간" } as const;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("국민투표")
    .setDescription(speak("참가한 사람 중 가장 많은 표를 받은 사람이 이기는 게임입니다."))
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName(OPTION.seats)
        .setDescription(speak(`이만큼 모이면 바로 시작합니다 (${MIN_CANDIDATES} ~ ${MAX_CANDIDATES}명).`))
        .setRequired(true)
        .setMinValue(MIN_CANDIDATES)
        .setMaxValue(MAX_CANDIDATES),
    )
    .addStringOption((option) =>
      option
        .setName(OPTION.time)
        .setDescription("투표하는 시간 — 3분 · 2일 · 90(숫자만 쓰면 초)")
        .setRequired(true)
        .setMaxLength(30),
    )
    .addStringOption(titleOption),

  async execute(interaction) {
    const rawTime = interaction.options.getString(OPTION.time, true);

    const duration = checkDuration(rawTime, interaction.user);
    if (!duration.ok) {
      await interaction.reply(response(duration.view));
      return;
    }

    await openGameHere(interaction, vote, {
      title: readTitle(interaction),
      maxPlayers: interaction.options.getInteger(OPTION.seats, true),
      // 모집 게임의 기간은 **시작한 뒤**에 흐른다. 골격이 시작하는 순간 시계를 건다.
      durationSeconds: duration.seconds,
      // 화면을 만들기 전에 놓는다 — 첫 화면부터 공약 목록을 그릴 수 있어야 한다.
      prepare: keepPoll,
    });
  },
});
