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

import { count } from "../../info/format.js";
import { customId } from "../../types.js";
import type { ResponseField } from "../../ui/response.js";
import { speak } from "../../ui/tone.js";
import { defineGame } from "../types.js";
import type { GameSession } from "../types.js";

/**
 * 국민투표 — **참가** 형식. 모인 사람 중 하나를 투표로 뽑는다.
 *
 * 참가부터 다르다. 「참가」를 누르면 **공약을 적는 모달**이 뜨고, 제출해야 참가로 센다.
 * 공약은 안 적어도 되지만 **제출은 해야 한다** — 적다 만 사람을 후보로 세울 수는 없다.
 *
 * 시작하면 후보마다 버튼이 하나씩 생기고, 기간 동안 누구나 누른다. 기간이 끝나면 가장 많이
 * 받은 사람이 이긴다.
 *
 * **자기 자신은 못 찍는다.** 후보가 스스로를 찍기 시작하면 표가 아니라 참가 여부를 세는
 * 셈이 된다. 후보가 아닌 사람은 얼마든지 찍을 수 있다.
 *
 * 판이 도는 동안의 상태(후보 · 공약 · 표)는 **메모리에만** 둔다. 진행 중인 판은 어차피
 * 재시작을 견디지 않고, 표는 그 판이 끝나면 쓸 일이 없다.
 */

export const VOTE = "vote";

/** customId: `vote:pledge:<판 id>` (모달) · `vote:pick:<판 id>:<후보>` (버튼) */
export const ACTION = { pledge: "pledge", pick: "pick" } as const;

/** 모달 안쪽 입력의 id. */
export const FIELD = { pledge: "vote_pledge" } as const;

/** 후보 수의 한계. 둘은 있어야 겨루고, 열을 넘으면 버튼이 화면을 덮는다. */
export const MIN_CANDIDATES = 2;
export const MAX_CANDIDATES = 10;

/** 공약 길이. 한 줄에 담기고, 후보가 열이어도 화면이 넘치지 않는 선이다. */
export const MAX_PLEDGE_LENGTH = 100;

interface Candidate {
  readonly userId: string;
  /** 화면 버튼에 적을 이름. 참가할 때의 서버 별명. */
  readonly name: string;
  /** 안 적었으면 null. */
  readonly pledge: string | null;
}

interface Poll {
  readonly candidates: Candidate[];
  /** 누가 누구를 찍었는지. 한 사람은 한 표, 바꿔 찍을 수 있다. */
  readonly votes: Map<string, string>;
}

const polls = new Map<string, Poll>();

/** 판을 열 때 빈 투표함을 놓는다. */
export function keepPoll(sessionId: string): void {
  polls.set(sessionId, { candidates: [], votes: new Map() });
}

export function pollOf(sessionId: string): Poll | undefined {
  return polls.get(sessionId);
}

export function dropPoll(sessionId: string): void {
  polls.delete(sessionId);
}

/**
 * 후보로 세운다. 이미 있으면 **공약만 고친다** — 다시 적으러 들어온 것이다.
 *
 * 실제 참가자 명단은 골격이 들고 있다. 여기는 그 사람이 무엇을 걸었는지만 안다.
 */
export function addCandidate(sessionId: string, candidate: Candidate): void {
  const poll = polls.get(sessionId);
  if (poll === undefined) return;

  const index = poll.candidates.findIndex((found) => found.userId === candidate.userId);
  if (index === -1) poll.candidates.push(candidate);
  else poll.candidates[index] = candidate;
}

/** 판에서 빠졌다. 받은 표도 함께 지운다 — 없는 사람에게 표가 남아 있으면 안 된다. */
export function removeCandidate(sessionId: string, userId: string): void {
  const poll = polls.get(sessionId);
  if (poll === undefined) return;

  const index = poll.candidates.findIndex((found) => found.userId === userId);
  if (index !== -1) poll.candidates.splice(index, 1);

  for (const [voter, pick] of poll.votes) {
    if (pick === userId) poll.votes.delete(voter);
  }
}

export type VoteResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly reason: "gone" | "self" | "unknown" };

/**
 * 한 표를 넣는다.
 *
 * 같은 사람을 다시 찍으면 `changed: false` — 취소가 아니라 **그대로**다. 취소를 만들면
 * 「표를 뺀 것」과 「아직 안 찍은 것」이 화면에서 구별되지 않는다.
 */
export function castVote(sessionId: string, voterId: string, candidateId: string): VoteResult {
  const poll = polls.get(sessionId);
  if (poll === undefined) return { ok: false, reason: "gone" };

  if (voterId === candidateId) return { ok: false, reason: "self" };
  if (!poll.candidates.some((found) => found.userId === candidateId)) {
    return { ok: false, reason: "unknown" };
  }

  const before = poll.votes.get(voterId);
  poll.votes.set(voterId, candidateId);

  return { ok: true, changed: before !== candidateId };
}

/** 후보별 표 수. 후보 차례 그대로. */
export function tally(poll: Poll): { readonly candidate: Candidate; readonly votes: number }[] {
  return poll.candidates.map((candidate) => ({
    candidate,
    votes: [...poll.votes.values()].filter((pick) => pick === candidate.userId).length,
  }));
}

/** 공약을 안 적고 낸 사람 자리. 말투를 한 번만 태우고 돌려 쓴다. */
const NO_PLEDGE = speak("_공약 없이 나왔습니다._");

/**
 * 후보와 공약 — **투표하는 동안** 화면에 나가는 내용.
 *
 * 한 사람이 두 줄을 쓰고, 사람 사이만 한 줄 띄운다.
 *
 *   <@마이즌>
 *   - 소원권을 나눠 드리겠ㅅ-
 *
 *   <@LAO_2>
 *   - _공약 없이 나왔ㅅ-_
 *
 * 한 줄에 이름과 공약을 나란히 붙이면 공약이 길 때 어디까지가 누구 것인지 눈이 못 따라간다.
 * 열 명까지 늘어설 수 있으므로 사람마다 끊어 두는 편이 읽힌다.
 *
 * 도는 동안에는 **표를 보여 주지 않는다.** 몇 표인지 보이면 이기고 있는 쪽으로 쏠린다.
 * 표는 끝난 뒤 결과에서 한 번에 편다.
 */
export function pledgeBoard(sessionId: string): string | null {
  const poll = polls.get(sessionId);
  if (poll === undefined || poll.candidates.length === 0) return null;

  return poll.candidates
    .map((candidate) => `<@${candidate.userId}>\n- ${candidate.pledge ?? NO_PLEDGE}`)
    .join("\n\n");
}

/** 끝난 판의 개표 — 많이 받은 순. */
export function resultBoard(poll: Poll): string {
  return [...tally(poll)]
    .sort((a, b) => b.votes - a.votes)
    .map(({ candidate, votes }) => `\`${count(votes)}표\` <@${candidate.userId}>`)
    .join("\n");
}

/** 가장 많이 받은 사람들. 같으면 여럿이다. 아무도 안 찍었으면 빈 배열. */
export function winnersOf(poll: Poll): Candidate[] {
  const scores = tally(poll);
  const top = Math.max(0, ...scores.map((entry) => entry.votes));
  if (top === 0) return [];

  return scores.filter((entry) => entry.votes === top).map((entry) => entry.candidate);
}

/** 참가할 때 뜨는 공약 모달. */
export function pledgeModal(session: GameSession): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(VOTE, ACTION.pledge, session.id))
    .setTitle("국민투표 — 출마")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("공약")
        .setDescription(speak("선택 · 안 적고 제출해도 출마는 됩니다."))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.pledge)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("당선되면 소원권을 나눠 드리겠ㅅ-")
            .setMaxLength(MAX_PLEDGE_LENGTH)
            .setRequired(false),
        ),
    );
}

const vote = defineGame({
  id: VOTE,
  name: "국민투표",
  description: speak("참가한 사람 중 가장 많은 표를 받은 사람이 이깁니다."),
  mode: "recruit",
  minPlayers: MIN_CANDIDATES,
  // 몇 명이 나올지는 판마다 다르다. 명령의 「참가인원」 이 판에 실린다.
  maxPlayers: null,

  // 「참가」가 곧 출마다 — 공약을 적고 제출해야 후보가 된다.
  joinModal: pledgeModal,

  // **투표하는 동안만** 후보 목록을 낸다. 모으는 동안에는 형식이 정한 모집 패널 그대로다 —
  // 그때 필요한 것은 누가 들어왔나와 몇 명 남았나이고, 그건 골격이 이미 적는다.
  body: (session) => (session.phase === "playing" ? pledgeBoard(session.id) : null),

  start(context) {
    if (!polls.has(context.session.id)) {
      void context.end({ status: "failure", description: speak("투표함을 잃어버렸습니다.") });
    }
  },

  /** 후보마다 버튼 하나. 끝난 판에는 남기지 않는다. */
  buttons(session: GameSession): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const poll = polls.get(session.id);
    if (poll === undefined || session.phase !== "playing") return [];

    const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

    // 한 줄에 다섯 개까지 — 디스코드가 정한 값이다.
    for (let start = 0; start < poll.candidates.length; start += 5) {
      rows.push(
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          ...poll.candidates.slice(start, start + 5).map((candidate) =>
            new ButtonBuilder()
              .setCustomId(customId(VOTE, ACTION.pick, session.id, candidate.userId))
              .setLabel(candidate.name)
              .setStyle(ButtonStyle.Primary),
          ),
        ),
      );
    }

    return rows;
  },

  async onTimeout(context) {
    const poll = polls.get(context.session.id);
    if (poll === undefined) {
      await context.end();
      return;
    }

    const winners = winnersOf(poll);
    const board = resultBoard(poll);
    dropPoll(context.session.id);

    const fields: ResponseField[] = [{ name: "개표", value: board }];

    await context.end({
      description:
        winners.length === 0
          ? speak("아무도 표를 받지 못했습니다.")
          : winners.length === 1
            ? speak(`<@${winners[0]?.userId}> 님이 당선되셨습니다.`)
            : speak(`${winners.map((one) => `<@${one.userId}>`).join(" ")} 님이 같은 표로 나란히 1위입니다.`),
      fields,
    });
  },
});

export default vote;
