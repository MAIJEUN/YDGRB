/** customId 규칙: `nick:<동작>[:인자…]` */
export const NICK = "nick";

export const MODAL_ID = {
  /** 뚜따이 — 별명과 기간을 받는다. */
  dduttai: "m-dduttai",
} as const;

/** 모달 안쪽 입력의 id. */
export const FIELD = {
  nickname: "nickname",
  duration: "duration",
} as const;

export const MODE = {
  dduttai: "dduttai",
  basasak: "basasak",
} as const;

export type Mode = (typeof MODE)[keyof typeof MODE];

export const MODE_LABEL: Record<Mode, string> = {
  dduttai: "뚜따이",
  basasak: "바사삭",
};

/** 디스코드 별명 길이 제한. */
export const MAX_NICKNAME_LENGTH = 32;
