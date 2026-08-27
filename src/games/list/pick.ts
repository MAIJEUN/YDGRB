import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { MessageActionRowComponentBuilder } from "discord.js";

import { customId } from "../../types.js";
import type { ResponseField } from "../../ui/response.js";
import { speak } from "../../ui/tone.js";
import { MAX_SHOWN_PLAYERS } from "../ids.js";
import { defineGame } from "../types.js";
import type { GameSession } from "../types.js";

/**
 * 찍기대작전 — **즉시 시작** 형식. 숫자 하나를 찍어 맞힌다.
 *
 * 명령을 치면 곧바로 판이 서고, 선택지 수만큼 숫자 버튼이 붙는다. 누구나 하나를 찍고,
 * **정답이 나올 때까지 기다린다.** 같은 숫자를 찍었던 사람이 전부 이긴다.
 *
 * 정답을 누가 내느냐가 두 방식을 가른다.
 *
 *   선택 — **판을 연 사람**이 고른다. 고르는 순간 판이 끝난다.
 *   랜덤 — **봇**이 고른다. 얼마 뒤에 고를지는 판을 열 때 정한다.
 *
 * **선택 방식에는 시계가 없다.** 기다리는 것이 시간이 아니라 사람이라, 몇 분을 걸어 두든
 * 그 숫자에 뜻이 없다. 그만두려면 오른쪽 위 「종료」를 누른다 — 그 길이 이미 있는데
 * 시계를 하나 더 두면, 아직 다 안 모였는데 판이 저 혼자 접히는 일만 생긴다.
 *
 * 선택 방식에서 연 사람은 **찍을 수 없다.** 그 사람이 누르는 숫자는 곧 정답이라,
 * 찍는 것과 고르는 것을 같은 버튼으로 할 수 없다.
 *
 * 찍은 것은 **끝날 때까지 아무에게도 안 보인다.** 도는 동안 누가 몇 번을 찍었는지가
 * 보이면 선택 방식의 연 사람이 그걸 보고 고르게 된다 — 아무도 못 맞히는 숫자를 고르면
 * 그만이니, 게임이 아니라 술래잡기가 된다.
 *
 * 판이 도는 동안의 상태(찍은 것)는 **메모리에만** 둔다. 진행 중인 판은 어차피 재시작을
 * 견디지 않는다.
 */

export const PICK = "pick";

/** customId: `pick:open:<선택지 수>:<제목>` (모달) · `pick:choose:<판 id>:<숫자>` (버튼) */
export const ACTION = { open: "open", choose: "choose" } as const;

/** 모달 안쪽 입력의 id. */
export const FIELD = { duration: "pick_duration" } as const;

export const MODE = { choice: "choice", random: "random" } as const;
export type PickMode = (typeof MODE)[keyof typeof MODE];

export const MODE_LABEL: Record<PickMode, string> = {
  choice: "선택",
  random: "랜덤",
};

export function isPickMode(value: string | undefined): value is PickMode {
  return value === MODE.choice || value === MODE.random;
}

/**
 * 선택지 수의 한계.
 *
 * 둘은 있어야 찍는 재미가 있고, 스물이면 버튼 네 줄이다. 그보다 늘리면 화면이 버튼으로
 * 덮이고, 맞힐 확률도 찍는 맛이 안 날 만큼 낮아진다.
 */
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 20;

interface Round {
  readonly mode: PickMode;
  readonly choices: number;
  /** 누가 몇 번을 찍었는지. 정답이 나오기 전까지는 바꿔 찍을 수 있다. */
  readonly picks: Map<string, number>;
  /** 정답이 나왔다. 버튼을 떼고 더 받지 않는다. */
  done: boolean;
}

const rounds = new Map<string, Round>();

/** 판을 열 때 방식과 선택지 수를 맡겨 둔다. */
export function keepPick(sessionId: string, mode: PickMode, choices: number): void {
  rounds.set(sessionId, { mode, choices, picks: new Map(), done: false });
}

export function pickOf(sessionId: string): Round | undefined {
  return rounds.get(sessionId);
}

export function dropPick(sessionId: string): void {
  rounds.delete(sessionId);
}

export type ChooseResult =
  | { readonly ok: true; readonly changed: boolean; readonly before: number | undefined }
  | { readonly ok: false; readonly reason: "gone" | "closed" | "unknown" };

/**
 * 숫자를 찍는다.
 *
 * 다시 찍으면 **옮겨 간다.** 아직 아무도 정답을 모르는 판이라 바꿔 찍는 것을 막을 이유가
 * 없다 — 막으면 잘못 누른 사람이 판에서 나가는 수밖에 없다.
 */
export function choose(sessionId: string, userId: string, number: number): ChooseResult {
  const round = rounds.get(sessionId);

  if (round === undefined) return { ok: false, reason: "gone" };
  if (round.done) return { ok: false, reason: "closed" };
  if (!Number.isInteger(number) || number < 1 || number > round.choices) {
    return { ok: false, reason: "unknown" };
  }

  const before = round.picks.get(userId);
  round.picks.set(userId, number);

  return { ok: true, changed: before !== number, before };
}

/** 봇이 고른다 — 1 부터 선택지 수까지 고르게. */
export function rollAnswer(choices: number): number {
  return Math.floor(Math.random() * choices) + 1;
}

/**
 * 정답이 나왔다. 판을 닫고 맞힌 사람을 돌려준다.
 *
 * 닫는 것과 세는 것을 **한 번에** 한다. 그 사이에 await 가 끼면 그 틈에 들어온 사람이
 * 답을 보고 찍을 수 있다.
 */
export function reveal(sessionId: string, answer: number): string[] {
  const round = rounds.get(sessionId);
  if (round === undefined) return [];

  round.done = true;

  return [...round.picks].filter(([, picked]) => picked === answer).map(([userId]) => userId);
}

/**
 * 도는 동안 화면에 나가는 **참가한 사람** — 찍은 순서대로.
 *
 * 무엇을 찍었는지는 여기 없다. 들어와 있는 사람은 판만 봐서는 알 수가 없어서 적는 것이고
 * (버튼이 사람이 아니라 숫자다), 무엇을 찍었나는 끝나야 나온다.
 */
export function joinedList(round: Round): string {
  return round.picks.size === 0 ? "아직 없음" : pickerList([...round.picks.keys()]);
}

/** 찍은 사람 멘션. 많으면 앞에서부터 몇 명만 적고 나머지는 수로. */
function pickerList(users: readonly string[]): string {
  const shown = users.slice(0, MAX_SHOWN_PLAYERS).map((userId) => `<@${userId}>`);
  if (users.length > MAX_SHOWN_PLAYERS) shown.push(`_외 ${users.length - MAX_SHOWN_PLAYERS}명_`);

  return shown.join(" ");
}

/**
 * 누가 무엇을 찍었나 — **끝난 뒤에만** 나가는 칸.
 *
 *   `1번` @마이즌 @LAO_2
 *   `3번` @신
 *
 * 아무도 안 찍은 숫자는 적지 않는다. 스무 줄짜리 빈 표를 볼 이유가 없다.
 */
export function pickBoard(round: Round): string {
  const byNumber = new Map<number, string[]>();

  for (const [userId, picked] of round.picks) {
    const seat = byNumber.get(picked) ?? [];
    seat.push(userId);
    byNumber.set(picked, seat);
  }

  return [...byNumber]
    .sort(([a], [b]) => a - b)
    .map(([number, users]) => `\`${number}번\` ${pickerList(users)}`)
    .join("\n");
}

/** 결과에 붙일 「찍은 것」 칸. 아무도 안 찍었으면 칸을 만들지 않는다. */
export function pickField(round: Round): ResponseField[] {
  if (round.picks.size === 0) return [];
  return [{ name: "찍은 것", value: pickBoard(round) }];
}

/**
 * 이 판의 이름 — `찍기대작전 1~5`.
 *
 * 몇 중에 하나였는지를 **제목에** 싣는다. 버튼은 끝나면서 사라지므로, 결과만 남았을 때
 * 「3번」 이 얼마나 맞히기 어려운 것이었는지 알 길이 없어진다.
 */
export function roundName(choices: number): string {
  return `찍기대작전 1~${choices}`;
}

/**
 * 화면에 적을 한 줄 — **누가 고르는가**.
 *
 * 몇 개 중에 고르는지는 제목과 버튼이 이미 말한다. 여기서 말할 것은 무엇을 기다리는지다.
 */
export function pickBody(mode: PickMode, hostId: string): string {
  return mode === MODE.choice
    ? speak(`<@${hostId}> 님이 고를 숫자를 찍으세요.`)
    : speak("봇이 고를 숫자를 찍으세요.");
}

/**
 * 랜덤 방식의 **기간 모달**.
 *
 * 기간은 랜덤 방식에만 있는 값인데, 디스코드에는 「이 옵션을 고르면 저 옵션이 뜬다」 가
 * 없다. 슬래시 옵션으로 두면 선택 방식에도 쓸모없는 칸이 따라다닌다.
 *
 * 선택지 수와 제목은 **customId 에 실어 보낸다.** 모달에 다시 적게 할 수는 없고,
 * 어딘가에 맡겨 두면 그 사이에 봇이 꺼졌을 때 사라진다. 제목은 60자까지라
 * 100자 제한 안에 들어간다.
 */
export function durationModal(choices: number, title: string | null): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(PICK, ACTION.open, String(choices), title ?? ""))
    .setTitle(roundName(choices))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("기간")
        .setDescription(speak("이만큼 지나면 봇이 고릅니다."))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.duration)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("3분 · 2일 · 90(숫자만 쓰면 초). 10초 ~ 365일")
            .setMaxLength(30)
            .setRequired(true),
        ),
    );
}

export default defineGame({
  id: PICK,
  name: "찍기대작전",
  description: speak("숫자 하나를 찍습니다. 고른 숫자와 같으면 이깁니다."),
  mode: "instant",

  start(context) {
    // 방식과 선택지 수는 판을 열 때 맡겨져 있다. 여기서 따로 할 일이 없다.
    if (!rounds.has(context.session.id)) {
      void context.end({ status: "failure", description: speak("판을 잃어버렸습니다.") });
    }
  },

  /**
   * 「참가한 사람」 칸.
   *
   * 참가 형식이 아니라 모집 패널이 없고, 버튼은 사람이 아니라 숫자다 — 판만 보고는 누가
   * 들어와 있는지 알 길이 없다. 그래서 골격이 시작 화면에서 뺀 칸을 여기서 도로 붙인다.
   *
   * **무엇을 찍었는지는 적지 않는다.** 그건 끝나야 나온다.
   */
  fields(session: GameSession): ResponseField[] {
    const round = rounds.get(session.id);
    if (round === undefined) return [];

    return [{ name: "참가한 사람", value: joinedList(round) }];
  },

  /** 숫자마다 버튼 하나. 다섯씩 나눠 담는다 (디스코드가 정한 값). */
  buttons(session: GameSession): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const round = rounds.get(session.id);
    if (round === undefined || round.done) return [];

    const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

    for (let start = 1; start <= round.choices; start += 5) {
      const numbers = Array.from(
        { length: Math.min(5, round.choices - start + 1) },
        (_, index) => start + index,
      );

      rows.push(
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          ...numbers.map((number) =>
            new ButtonBuilder()
              .setCustomId(customId(PICK, ACTION.choose, session.id, String(number)))
              .setLabel(String(number))
              .setStyle(ButtonStyle.Secondary),
          ),
        ),
      );
    }

    return rows;
  },

  /**
   * 판이 마무리되는 자리 — 기간이 다 됐거나, 「종료」가 눌렸거나.
   *
   * 랜덤이면 **여기가 개봉**이다 — 봇이 하나를 고르고 맞힌 사람을 센다.
   * 선택은 시계가 없으니 「종료」로만 들어온다. 연 사람이 고르지 않은 것이라 정답이 없다.
   */
  async onTimeout(context) {
    const round = rounds.get(context.session.id);
    if (round === undefined) {
      await context.end();
      return;
    }

    if (round.mode === MODE.choice) {
      round.done = true;
      const field = pickField(round);
      dropPick(context.session.id);

      await context.end({
        status: "progress",
        description: speak(`<@${context.session.hostId}> 님이 고르지 않았습니다.`),
        fields: field,
      });
      return;
    }

    const answer = rollAnswer(round.choices);
    const winners = reveal(context.session.id, answer);
    const field = pickField(round);
    dropPick(context.session.id);

    await context.end({
      description: [
        speak(`봇이 **${answer}번**을 골랐습니다.`),
        winners.length === 0
          ? speak("아무도 맞히지 못했습니다.")
          : speak(`${winners.map((userId) => `<@${userId}>`).join(" ")} 님이 맞히셨습니다.`),
      ].join(" "),
      fields: field,
    });
  },
});
