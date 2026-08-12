import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { MessageActionRowComponentBuilder } from "discord.js";

import { customId } from "../../types.js";
import type { ResponseField } from "../../ui/response.js";
import { defineGame } from "../types.js";
import type { GameSession } from "../types.js";

/**
 * 선착순 — **즉시 시작** 형식. 버튼으로 겨룬다.
 *
 * 두 방식이 있지만 장치는 하나다 — **N번째 누름이 나올 때까지 센다.**
 * 다른 것은 그 N을 채웠을 때 **누구를 이긴 것으로 보느냐** 뿐이다.
 *
 *   n명    — 먼저 누른 N명이 다 가져간다 (기본 1명)
 *   n번째  — 딱 N번째로 누른 한 사람이 가져간다 (기본 5번째)
 *
 * 한 사람은 한 번만 누를 수 있다. 연타로 자리를 쓸어 담을 수는 없다.
 */

export const FIRSTCOME = "firstcome";

/** customId: `firstcome:press:<판 id>` */
export const ACTION = { press: "press" } as const;

export const MODE = { count: "count", nth: "nth" } as const;
export type RaceMode = (typeof MODE)[keyof typeof MODE];

export const MODE_LABEL: Record<RaceMode, string> = {
  count: "n명",
  nth: "n번째",
};

/** 방식마다 기본값이 다르다. */
export const DEFAULT_TARGET: Record<RaceMode, number> = {
  count: 1,
  nth: 5,
};

export const MIN_TARGET = 1;
/** 판 하나에 받을 사람 수의 상한. 이보다 크면 아무도 못 채운다. */
export const MAX_TARGET = 100;

/** 눌린 사람을 화면에 늘어놓는 최대 인원. 넘치면 최근 것부터 잘라 보여 준다. */
export const MAX_SHOWN_PRESSES = 10;

/**
 * 판이 방치되지 않게 두는 시계.
 *
 * 한 채널에 한 판이라, 아무도 안 누르면 그 채널이 영영 묶인다.
 * 모집 형식의 마감과 같은 5분으로 맞춘다.
 */
export const RACE_SECONDS = 5 * 60;

export function isRaceMode(value: string | undefined): value is RaceMode {
  return value === MODE.count || value === MODE.nth;
}

interface Race {
  readonly mode: RaceMode;
  readonly target: number;
  /** 누른 순서대로. 앞이 1번째다. */
  readonly pressed: string[];
  done: boolean;
}

const races = new Map<string, Race>();

/** 판을 열 때 방식과 목표를 맡겨 둔다. */
export function keepRace(sessionId: string, mode: RaceMode, target: number): void {
  races.set(sessionId, { mode, target, pressed: [], done: false });
}

export function raceOf(sessionId: string): Race | undefined {
  return races.get(sessionId);
}

export function dropRace(sessionId: string): void {
  races.delete(sessionId);
}

export type PressResult =
  | { readonly ok: true; readonly order: number; readonly filled: boolean }
  | { readonly ok: false; readonly reason: "gone" | "closed" | "already" };

/**
 * 눌렀다.
 *
 * **동기로 끝낸다.** 자리를 잡는 것과 다 찼는지 보는 것 사이에 await 가 끼면, 그 틈에
 * 들어온 다음 사람이 같은 자리를 가져갈 수 있다.
 */
export function press(sessionId: string, userId: string): PressResult {
  const race = races.get(sessionId);

  if (race === undefined) return { ok: false, reason: "gone" };
  if (race.done) return { ok: false, reason: "closed" };
  if (race.pressed.includes(userId)) return { ok: false, reason: "already" };

  race.pressed.push(userId);
  const order = race.pressed.length;

  if (order >= race.target) race.done = true;

  return { ok: true, order, filled: race.done };
}

/** 이긴 사람 — n명이면 앞에서부터 N명, n번째면 그 자리 한 사람. */
export function winnersOf(race: Race): string[] {
  if (race.mode === MODE.count) return race.pressed.slice(0, race.target);

  const nth = race.pressed[race.target - 1];
  return nth === undefined ? [] : [nth];
}

/**
 * 눌린 순서 — **늦게 누른 사람이 위**로 최대 10명.
 *
 *   4번째 : @…
 *   3번째 : @…
 *
 * 방금 누른 사람이 맨 위라 갱신될 때 눈이 따라가기 쉽다.
 */
export function pressBoard(race: Race): string {
  if (race.pressed.length === 0) return "아직 없음";

  return race.pressed
    .map((userId, index) => `${index + 1}번째 : <@${userId}>`)
    .slice(-MAX_SHOWN_PRESSES)
    .reverse()
    .join("\n");
}

/** 목표를 한 줄로 — 화면 맨 위에 그대로 실린다. */
export function goalText(mode: RaceMode, target: number): string {
  return mode === MODE.count ? `선착순 **${target}명**` : `**${target}번째**로 누른 사람`;
}

function bodyOf(goal: string, board: string): string {
  return [goal, "**눌린 순서**", board].join("\n\n");
}

/** 판 화면에 실을 내용 (목표 + 눌린 순서). */
export function raceBody(race: Race): string {
  return bodyOf(goalText(race.mode, race.target), pressBoard(race));
}

/**
 * 아직 아무도 안 누른 판의 화면.
 *
 * 판을 여는 시점에는 race 가 만들어지기 전이라 따로 둔다 — 칸 모양은 같아야 한다.
 */
export function openingBody(mode: RaceMode, target: number): string {
  return bodyOf(goalText(mode, target), "아직 없음");
}

/** 결과에 붙일 「눌린 순서」 칸. */
export function pressField(race: Race): ResponseField[] {
  return race.pressed.length === 0 ? [] : [{ name: "눌린 순서", value: pressBoard(race) }];
}

export default defineGame({
  id: FIRSTCOME,
  name: "선착순",
  description: "버튼을 먼저 누른 사람이 가져가는 게임.",
  mode: "instant",

  start(context) {
    // 목표는 판을 열 때 맡겨져 있다. 여기서 따로 할 일이 없다.
    if (!races.has(context.session.id)) {
      void context.end({ status: "failure", description: "판을 잃어버렸습니다." });
    }
  },

  /** 끝난 판에는 버튼을 남기지 않는다 — 눌러도 아무 일이 없으면 헷갈린다. */
  buttons(session: GameSession): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const race = races.get(session.id);
    if (race === undefined || race.done) return [];

    return [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(customId(FIRSTCOME, ACTION.press, session.id))
          .setLabel("누르기")
          .setStyle(ButtonStyle.Success),
      ),
    ];
  },

  async onTimeout(context) {
    const race = races.get(context.session.id);
    if (race === undefined) {
      await context.end();
      return;
    }

    race.done = true;
    const winners = winnersOf(race);
    dropRace(context.session.id);

    // n번째는 그 자리에 아무도 못 닿으면 이긴 사람이 없다.
    // n명은 덜 찼어도 누른 사람들이 가져간다.
    await context.end({
      description:
        winners.length === 0
          ? "시간이 다 되도록 아무도 채우지 못했습니다."
          : `시간이 다 되어 ${winners.map((id) => `<@${id}>`).join(" ")} 님이 가져갑니다.`,
      fields: pressField(race),
    });
  },
});
