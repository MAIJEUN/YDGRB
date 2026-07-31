import { defineGame } from "../types.js";
import type { GameContext } from "../types.js";

/**
 * 퀴즈 — **즉시 시작** 형식.
 *
 * 문제를 띄우고, 기간 동안 그 채널에 올라온 메시지를 본다. 정답을 맞힌 첫 사람이 이긴다.
 * 아무도 못 맞히면 기간이 끝나면서 정답을 공개하고 끝난다.
 *
 * 모집이 없다 — 답을 적는 순간 참가한 것이다 ("누구든 참가할 수 있다").
 */

/** 판마다 다른 것 — 정답과 이긴 사람. 진행 중인 판은 재시작을 견디지 않으므로 메모리면 된다. */
interface Round {
  readonly answer: string;
  readonly hostId: string;
  winnerId: string | null;
}

const rounds = new Map<string, Round>();

/** 판을 열 때 커맨드가 정답을 맡겨 둔다. 정답은 화면에도 저장소에도 남기지 않는다. */
export function keepAnswer(sessionId: string, answer: string, hostId: string): void {
  rounds.set(sessionId, { answer, hostId, winnerId: null });
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
  id: "quiz",
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

    // 문제를 낸 사람은 답을 알고 있다.
    if (message.author.id === round.hostId) return;
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
