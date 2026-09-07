/**
 * customId 규칙: `role:<동작>[:인자…]`
 * 라우터가 `role` 로 핸들러를 찾고, 나머지를 args 로 넘긴다. 전체 100자 제한.
 */
export const ROLE = "role";

export const ACTION = {
  /** 유저 패널 ↔ 관리자 패널 전환 — `role:panel:<유저|관리자>` */
  panel: "panel",
  /** 관리자가 대상 유저를 고른다 — `role:pick:<기능|->` (펴 둔 기능을 그대로 들고 간다) */
  pick: "pick",
  /** 기능을 펴고 접는다 — `role:open:<기능|->:<유저>` (**눌렀을 때 갈 상태**를 싣는다) */
  open: "open",
  /** 「권한」 — 그 유저가 켜고 끌 수 있는 역할을 정한다 — `role:allow:<유저>` */
  allow: "allow",
  /** 「지급/회수」 — 그 유저의 역할을 바로 붙였다 뗀다 — `role:grant:<유저>` */
  grant: "grant",
  /** 유저가 자기 역할을 켜고 끈다 (유저 패널의 역할 드롭다운). */
  toggle: "toggle",
} as const;

export const PANEL = { user: "user", admin: "admin" } as const;
export type PanelKind = (typeof PANEL)[keyof typeof PANEL];

export function isPanelKind(value: string | undefined): value is PanelKind {
  return value === PANEL.user || value === PANEL.admin;
}

/**
 * 관리자 패널이 유저 하나를 놓고 할 수 있는 일.
 *
 * **유저를 고르는 자리는 하나뿐이다.** 기능마다 유저 드롭다운을 두면 같은 사람을 두 번
 * 고르게 되고, 어느 쪽에 고른 사람이 지금 화면의 주인인지도 흐려진다. 그래서 사람을 먼저
 * 고르고, 그 사람을 놓고 무엇을 할지를 버튼으로 고른다.
 */
export const FUNC = {
  /** 명단을 정한다 — 그 사람이 **스스로** 켜고 끌 수 있는 역할. */
  allow: "allow",
  /** 지금 바로 붙였다 뗀다 — 관리자가 그 사람의 역할을 직접. */
  grant: "grant",
} as const;
export type AdminFunc = (typeof FUNC)[keyof typeof FUNC];

export const FUNC_LABEL: Record<AdminFunc, string> = {
  allow: "권한",
  grant: "지급/회수",
};

/** 아무 기능도 펴지 않은 상태. customId 에 실을 자리가 비면 안 되므로 글자를 하나 둔다. */
export const NO_FUNC = "-";

export function isFunc(value: string | undefined): value is AdminFunc {
  return value === FUNC.allow || value === FUNC.grant;
}

/**
 * 드롭다운 하나가 받는 최대 항목 수 — 디스코드가 정한 값이다.
 *
 * 한 사람에게 열어 줄 수 있는 역할 수도 여기에 묶인다. 더 열어 준들 드롭다운에 담기지
 * 않으므로, 담기지 않을 것을 저장해 두지 않는다.
 */
export const MAX_ALLOWED_ROLES = 25;
