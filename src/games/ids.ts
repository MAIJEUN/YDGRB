/**
 * 미니게임 공통 상수.
 *
 * customId 규칙: `game:<동작>:<판 id>` (전체 100자 제한)
 * 판 id 는 8자 hex 라 게임 id 를 싣지 않아도 어느 판인지 찾을 수 있다.
 */
export const GAME = "game";

export const ACTION = {
  /** 모집 중인 판에 참가 — `game:join:<판 id>` */
  join: "join",
  /** 참가 취소 — `game:leave:<판 id>` */
  leave: "leave",
  /** 주최자가 지금 시작 — `game:start:<판 id>` */
  start: "start",
  /** 주최자가 판을 접음 — `game:cancel:<판 id>` */
  cancel: "cancel",
} as const;

/** 모집 마감까지. 게임이 따로 정하지 않으면 이만큼. */
export const DEFAULT_RECRUIT_SECONDS = 180;

/** 너무 짧으면 아무도 못 들어오고, 너무 길면 판이 채널에 방치된다. */
export const MIN_RECRUIT_SECONDS = 15;
export const MAX_RECRUIT_SECONDS = 30 * 60;

/**
 * 참가자를 화면에 늘어놓는 최대 인원.
 *
 * 최대 인원이 없는 게임은 수십 명이 될 수 있다. 멘션을 다 적으면 글자 수 한계에 걸린다.
 */
export const MAX_SHOWN_PLAYERS = 15;

/** 판 하나에 받을 수 있는 인원의 절대 상한. 무제한이라도 어딘가에서는 끊어야 한다. */
export const HARD_PLAYER_LIMIT = 100;
