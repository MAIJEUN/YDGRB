/**
 * 출헉 — 하루 한 번 관리자가 올리는 출석 체크.
 *
 * 관리자가 정한 텍스트를 **이미지로** 띄우고, 유저는 버튼을 눌러 그 글자를 그대로 받아 적는다.
 * 이미지로 내는 이유는 복사·붙여넣기를 막기 위해서다.
 *
 * customId 규칙: `att:<동작>[:덤 id]` (전체 100자 제한)
 */
export const ATTENDANCE = "att";

export const ACTION = {
  /** 「안녕난버튼이야」 — 누르면 받아쓰기 모달이 뜬다. `att:check[:덤 id]` */
  check: "check",
  /** 오늘 이미 올렸을 때 「그래도 계속」. `att:again:<덤 id>` */
  again: "again",
} as const;

export const MODAL_ID = {
  /** 받아쓰기 — `att:answer[:덤 id]` */
  answer: "answer",
} as const;

export const FIELD = {
  answer: "written",
} as const;

/** 버튼에 적히는 말. */
export const BUTTON_LABEL = "안녕난버튼이야";

/** 오늘 이미 올렸을 때 하나 더 올리는 버튼. */
export const AGAIN_LABEL = "그래도 계속";

/** 출헉 텍스트 길이 한계. 이미지 한 줄에 들어갈 만큼만 받는다. */
export const MAX_TEXT_LENGTH = 24;

/** 출헉일수가 이 수의 배수가 될 때마다 소원권 조각을 준다. */
export const REWARD_EVERY = 4;

/** 한 번에 주는 소원권 조각 수. */
export const REWARD_FRAGMENTS = 1;
