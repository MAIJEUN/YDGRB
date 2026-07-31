import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { openGameHere, titleOption } from "../games/command.js";
import quiz, { keepAnswer } from "../games/list/quiz.js";
import { refusedView } from "../games/views.js";
import { describeDurationError, formatDuration, parseDuration } from "../time.js";
import { response } from "../ui/response.js";
import { defineCommand } from "../types.js";

/**
 * `/퀴즈 [문제] [정답] [기간] [제목]`
 *
 * 즉시 시작 형식이라 치는 순간 판이 열린다. 그 뒤로는 [게임 골격](../games/runner.ts)이
 * 시계를 재고, 채널 메시지를 [게임](../games/list/quiz.ts)에 넘긴다.
 *
 * **정답은 어디에도 보이지 않는다.** 커맨드 옵션은 친 사람에게만 보이고, 판 화면에는
 * 문제만 실린다. 정답은 판이 끝날 때 처음 공개된다.
 */

const OPTION = { question: "문제", answer: "정답", duration: "기간" } as const;

const MAX_QUESTION_LENGTH = 300;
const MAX_ANSWER_LENGTH = 100;

/** 너무 짧으면 읽기도 전에 끝나고, 너무 길면 채널이 하루 종일 묶인다. */
const MIN_SECONDS = 10;
const MAX_SECONDS = 60 * 60;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("퀴즈")
    .setDescription("문제를 내고, 이 채널에 답을 적어 맞히는 게임입니다.")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName(OPTION.question)
        .setDescription("낼 문제")
        .setRequired(true)
        .setMaxLength(MAX_QUESTION_LENGTH),
    )
    .addStringOption((option) =>
      option
        .setName(OPTION.answer)
        .setDescription("정답 (공백과 대소문자는 따지지 않습니다)")
        .setRequired(true)
        .setMaxLength(MAX_ANSWER_LENGTH),
    )
    .addStringOption((option) =>
      option
        .setName(OPTION.duration)
        .setDescription("3분 · 90(숫자만 쓰면 초). 최대 1시간")
        .setRequired(true),
    )
    .addStringOption(titleOption),

  async execute(interaction) {
    const question = interaction.options.getString(OPTION.question, true).trim();
    const answer = interaction.options.getString(OPTION.answer, true).trim();
    const rawDuration = interaction.options.getString(OPTION.duration, true).trim();

    if (answer === "") {
      await interaction.reply(
        response(refusedView("퀴즈 실패", "정답이 비어 있어요.", interaction.user)),
      );
      return;
    }

    const parsed = parseDuration(rawDuration);
    if (!parsed.ok) {
      await interaction.reply(
        response({
          status: "failure",
          title: "기간을 읽을 수 없습니다",
          description: describeDurationError(parsed.reason),
          fields: [{ name: "입력한 값", value: `\`${rawDuration}\`` }],
          user: interaction.user,
        }),
      );
      return;
    }

    if (parsed.seconds < MIN_SECONDS || parsed.seconds > MAX_SECONDS) {
      await interaction.reply(
        response({
          status: "failure",
          title: "기간이 맞지 않습니다",
          description: `**${formatDuration(MIN_SECONDS)}** 부터 **${formatDuration(MAX_SECONDS)}** 사이로 적어 주세요.`,
          fields: [{ name: "입력한 값", value: `\`${rawDuration}\` (${formatDuration(parsed.seconds)})` }],
          user: interaction.user,
        }),
      );
      return;
    }

    await openGameHere(interaction, quiz, {
      body: question,
      durationSeconds: parsed.seconds,
      // 시작하기 전에 맡긴다 — 시작한 뒤에 맡기면 그 사이에 들어온 답을 놓친다.
      prepare: (sessionId) => {
        keepAnswer(sessionId, answer, interaction.user.id);
      },
    });
  },
});
