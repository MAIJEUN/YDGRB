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
  /**
   * 주최자가 판을 끝냄 — `game:stop:<판 id>`
   *
   * 모집 중이든 진행 중이든 같은 버튼이다. 판 화면 **오른쪽 위**에 붙는다.
   */
  stop: "stop",
  /**
   * 도는 판을 접고 **막혔던 판을 대신 연다** — `game:takeover:<맡긴 id>`
   *
   * 한 채널에 한 판이라 거절된 명령이, 그 자리에서 다시 살아나는 유일한 길이다.
   */
  takeover: "takeover",
  /**
   * 예전 「접기」 버튼 — `game:cancel:<판 id>`
   *
   * 이제 종료 하나로 합쳤다. 봇을 올리기 전에 뜬 모집 패널이 채널에 남아 있으므로
   * 받기는 계속 받는다. 새로 그리는 화면에는 붙지 않는다.
   */
  cancel: "cancel",
} as const;

/**
 * 모집 형식의 마감 — **5분.**
 *
 * 그 안에 시작되지 않으면 판은 취소된다. 게임마다 다르게 두지 않는다.
 * 형식이 정한 값이라 게임이 고를 여지가 없다.
 */
export const RECRUIT_TIMEOUT_SECONDS = 5 * 60;

/**
 * 참가자를 화면에 늘어놓는 최대 인원.
 *
 * 최대 인원이 없는 게임은 수십 명이 될 수 있다. 멘션을 다 적으면 글자 수 한계에 걸린다.
 */
export const MAX_SHOWN_PLAYERS = 15;

/** 판 하나에 받을 수 있는 인원의 절대 상한. 무제한이라도 어딘가에서는 끊어야 한다. */
export const HARD_PLAYER_LIMIT = 100;

/**
 * 판 제목의 길이 한계.
 *
 * 제목 뒤에 게임 이름과 단계(「— 모집 중」)가 더 붙는다. 제목만 길면 그게 다 밀린다.
 */
export const MAX_TITLE_LENGTH = 60;

/** 모든 게임 명령에 붙는 제목 칸의 이름. */
export const TITLE_OPTION = "제목";
