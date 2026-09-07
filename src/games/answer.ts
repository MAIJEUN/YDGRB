import { FileUploadBuilder, LabelBuilder } from "discord.js";
import type { ModalSubmitInteraction } from "discord.js";

import { prepareUploads } from "../ui/attachments.js";
import type { Attached } from "../ui/attachments.js";
import type { GameContext, GameDefinition } from "./types.js";
import { speak } from "../ui/tone.js";

/**
 * **채팅으로 먼저 맞히면 이기는** 게임의 공통 부분.
 *
 * 퀴즈와 초성퀴즈가 이것을 그대로 쓴다. 두 게임의 다른 점은 **문제를 무엇으로 보여
 * 주느냐** 하나뿐이다 — 맞히는 방식, 이기는 규칙, 끝나는 모양은 전부 같다.
 *
 * 정답은 **메모리에만** 둔다. 저장소에 남기면 파일을 열어 볼 수 있는 사람에게 새고,
 * 진행 중인 판은 어차피 재시작을 견디지 않으므로 남길 이유도 없다.
 */

interface Round {
  readonly answer: string;
  /** 문제에 딸려 온 그림. 모달로 올라온 그대로. */
  readonly media: readonly Attached[];
  winnerId: string | null;
}

const rounds = new Map<string, Round>();

/**
 * 판을 열 때 정답을 맡겨 둔다. **시작하기 전에** 불러야 그 사이에 들어온 답을 안 놓친다.
 *
 * 그림도 여기 함께 둔다. 정답과 한 몸이라 — 판이 끝나면 같이 사라져야 하고, 파일에
 * 남길 이유도 없다 (진행 중인 판은 재시작을 견디지 않는다).
 */
export function keepAnswer(
  sessionId: string,
  answer: string,
  media: readonly Attached[] = [],
): void {
  rounds.set(sessionId, { answer, media, winnerId: null });
}

/**
 * 그 판의 문제 그림. 게임의 `media` 훅이 이걸 그대로 돌려준다.
 *
 * 판이 끝나면 빈 배열이다 — 끝난 판의 화면에는 그림을 다시 걸지 않는다.
 */
export function mediaOf(sessionId: string): readonly Attached[] {
  return rounds.get(sessionId)?.media ?? [];
}

/** 아직 답을 기다리고 있는 판인지. 게임이 `start()` 에서 확인용으로 쓴다. */
export function hasAnswer(sessionId: string): boolean {
  return rounds.has(sessionId);
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

async function finish(
  context: GameContext,
  round: Round,
  winnerId: string | null,
): Promise<void> {
  rounds.delete(context.session.id);

  // 색은 골격이 정한다 — 맞혔든 아무도 못 맞혔든 「끝났다」는 알림이라 같은 파랑이다.
  await context.end({
    description: winnerId === null ? speak("아무도 맞히지 못했습니다.") : speak(`<@${winnerId}> 님이 맞혔습니다.`),
    fields: [{ name: "정답", value: reveal(round.answer) }],
  });
}

/**
 * 채팅으로 맞히는 게임이 그대로 얹어 쓰는 세 갈래.
 *
 * ```ts
 * export default defineGame({ …, ...answerGame });
 * ```
 */
/**
 * 문제에 붙일 그림 — **선택.**
 *
 * 모달 칸은 다섯 개까지라 여기가 마지막 자리다. 파일 종류를 가릴 수단은 없어서 무엇이든
 * 올라올 수 있는데, 이미지가 아니면 [골격](views.ts)이 파일 카드로 건다. 올린 것이
 * 사라지지 않는 편이 「이미지만 됩니다」 하고 버리는 것보다 낫다.
 */
export const MAX_QUIZ_IMAGES = 4;

/** 모달 안쪽 그림 칸의 id. 두 퀴즈가 같은 것을 쓴다. */
export const IMAGE_FIELD = "images";

/** 그림 칸. 두 퀴즈의 모달이 같은 모양으로 마지막에 붙인다. */
export function imageField(): LabelBuilder {
  return new LabelBuilder()
    .setLabel("그림")
    .setDescription(`선택 · 최대 ${MAX_QUIZ_IMAGES}개`)
    .setFileUploadComponent(
      new FileUploadBuilder()
        .setCustomId(IMAGE_FIELD)
        .setMinValues(0)
        .setMaxValues(MAX_QUIZ_IMAGES)
        .setRequired(false),
    );
}

/** 모달 제출에서 그림을 꺼낸다. 안 올렸으면 빈 배열. */
export function readImages(interaction: ModalSubmitInteraction): Attached[] {
  return prepareUploads(interaction.fields.getUploadedFiles(IMAGE_FIELD));
}

export const answerGame: Pick<
  GameDefinition,
  "start" | "media" | "onMessage" | "onTimeout"
> = {
  /** 문제에 딸려 온 그림. 두 퀴즈가 같은 자리에 맡겨 두므로 여기서 한 번만 꺼낸다. */
  media(session) {
    return mediaOf(session.id);
  },

  start(context) {
    // 문제는 판을 열 때 화면에 실려 있다. 여기서 따로 할 일이 없다.
    if (!hasAnswer(context.session.id)) {
      void context.end({ status: "failure", description: speak("문제를 잃어버렸습니다.") });
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
};
