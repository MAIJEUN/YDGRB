import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

import { customId } from "../../types.js";
import { MAX_TITLE_LENGTH, TITLE_OPTION } from "../ids.js";
import { defineGame } from "../types.js";
import type { GameContext } from "../types.js";

/**
 * 퀴즈 — **즉시 시작** 형식.
 *
 * 문제를 띄우고, 기간 동안 그 채널에 올라온 메시지를 본다. 정답을 맞힌 첫 사람이 이긴다.
 * 아무도 못 맞히면 기간이 끝나면서 정답을 공개하고 끝난다.
 *
 * 모집이 없다 — 답을 적는 순간 참가한 것이다.
 *
 * **문제와 정답은 모달로 받는다.** 슬래시 커맨드 옵션은 채널에 그대로 남아 아무나 볼 수
 * 있다 (「/퀴즈 문제: … 정답: …」 이 통째로 보인다). 그러면 정답이 새므로 쓸 수 없다.
 */

export const QUIZ = "quiz";

/** customId: `quiz:new` */
export const ACTION = { open: "new" } as const;

export const FIELD = {
  question: "question",
  answer: "answer",
  duration: "duration",
  title: "title",
} as const;

export const MAX_QUESTION_LENGTH = 300;
export const MAX_ANSWER_LENGTH = 100;

export function quizModal(): ModalBuilder {
  const row = (input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(input);

  return new ModalBuilder()
    .setCustomId(customId(QUIZ, ACTION.open))
    .setTitle("퀴즈")
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.question)
          .setLabel("문제")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(MAX_QUESTION_LENGTH),
      ),
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.answer)
          .setLabel("정답")
          .setPlaceholder("공백과 대소문자는 따지지 않습니다")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(MAX_ANSWER_LENGTH),
      ),
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.duration)
          .setLabel("기간")
          .setPlaceholder("3분 · 90(숫자만 쓰면 초). 10초 ~ 1시간")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30),
      ),
      // 제목은 형식이 정한 칸이다. 모달로 받는 게임도 똑같이 둔다.
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.title)
          .setLabel(TITLE_OPTION)
          .setPlaceholder("보상은 소원권 1개")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(MAX_TITLE_LENGTH),
      ),
    );
}

/** 판마다 다른 것 — 정답과 이긴 사람. 진행 중인 판은 재시작을 견디지 않으므로 메모리면 된다. */
interface Round {
  readonly answer: string;
  winnerId: string | null;
}

const rounds = new Map<string, Round>();

/** 판을 열 때 정답을 맡겨 둔다. 정답은 화면에도 저장소에도 남기지 않는다. */
export function keepAnswer(sessionId: string, answer: string): void {
  rounds.set(sessionId, { answer, winnerId: null });
}

/**
 * 맞혔는지 본다.
 *
 * 앞뒤 공백과 사이 공백, 대소문자는 따지지 않는다 — 「Hello  World」 와 「hello world」 는
 * 같은 답으로 본다. 그 밖에는 그대로 견준다.
 */
export function matches(answer: string, written: string): boolean {
  const tidy = (text: string): string => text.replaceAll(/\s+/gu, " ").trim().toLowerCase();
  return tidy(answer) !== "" && tidy(answer) === tidy(written);
}

/** 정답을 공개할 때. 마크다운이 섞여 있어도 그대로 보이게 코드로 감싼다. */
function reveal(answer: string): string {
  return `\`${answer.replaceAll("`", "'")}\``;
}

export default defineGame({
  id: QUIZ,
  name: "퀴즈",
  description: "문제를 내고, 이 채널에 답을 적어 맞히는 게임.",
  mode: "instant",

  start(context) {
    // 문제는 판을 열 때 화면에 실려 있다. 여기서 따로 할 일이 없다.
    if (!rounds.has(context.session.id)) {
      void context.end({ status: "failure", description: "문제를 잃어버렸습니다." });
    }
  },

  async onMessage(context, message) {
    const round = rounds.get(context.session.id);
    if (round === undefined || round.winnerId !== null) return;
    if (!matches(round.answer, message.content)) return;

    round.winnerId = message.author.id;
    await context.join(message.author.id);

    await finish(context, round, message.author.id);
  },

  async onTimeout(context) {
    const round = rounds.get(context.session.id);
    if (round === undefined) {
      await context.end();
      return;
    }

    await finish(context, round, null);
  },
});

async function finish(
  context: GameContext,
  round: Round,
  winnerId: string | null,
): Promise<void> {
  rounds.delete(context.session.id);

  // 아무도 못 맞혔으면 온전히 끝난 게 아니다 — 노랑.
  await context.end(
    winnerId === null
      ? {
          status: "progress",
          description: "아무도 맞히지 못했습니다.",
          fields: [{ name: "정답", value: reveal(round.answer) }],
        }
      : {
          description: `<@${winnerId}> 님이 맞혔습니다.`,
          fields: [{ name: "정답", value: reveal(round.answer) }],
        },
  );
}
