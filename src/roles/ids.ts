/**
 * customId 규칙: `role:<동작>[:인자…]`
 * 라우터가 `role` 로 핸들러를 찾고, 나머지를 args 로 넘긴다. 전체 100자 제한.
 */
export const ROLE = "role";

export const ACTION = {
  /** 유저 패널 ↔ 관리자 패널 전환 — `role:panel:<유저|관리자>` */
  panel: "panel",
  /** 관리자가 대상 유저를 고른다 (유저 드롭다운). */
  pick: "pick",
  /** 그 유저에게 열어 줄 역할을 정한다 — `role:allow:<유저>` (역할 드롭다운) */
  allow: "allow",
  /** 유저가 자기 역할을 켜고 끈다 (역할 드롭다운). */
  toggle: "toggle",
} as const;

export const PANEL = { user: "user", admin: "admin" } as const;
export type PanelKind = (typeof PANEL)[keyof typeof PANEL];

export function isPanelKind(value: string | undefined): value is PanelKind {
  return value === PANEL.user || value === PANEL.admin;
}

/**
 * 한 사람에게 열어 줄 수 있는 역할 수 — **스물다섯.**
 *
 * 드롭다운 하나가 받는 항목 수가 그만큼이다(디스코드가 정한 값). 더 열어 준들 유저
 * 패널의 드롭다운에 담기지 않으므로, 담기지 않을 것을 저장해 두지 않는다.
 */
export const MAX_ALLOWED_ROLES = 25;
