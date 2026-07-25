/**
 * customId 규칙: `wish:<동작>[:인자…]`
 * 라우터가 `wish` 로 핸들러를 찾고, 나머지를 args 로 넘긴다. 전체 100자 제한.
 */
export const WISH = "wish";

export const ACTION = {
  /** 패널에서 확인 화면을 공개로 연다. */
  check: "check",
  /** 공개된 확인 화면의 유저 드롭다운 — 그 메시지를 갱신한다. */
  checkSelect: "checksel",
  /** 패널에서 랭킹 화면을 공개로 연다. */
  rank: "rank",
  /** 공개된 랭킹의 페이지 이동 — `wish:rankpage:<정렬>:<페이지>` */
  rankPage: "rankpage",
  /** 공개된 랭킹의 기준 드롭다운 — `wish:ranksort:<페이지>` (고른 값이 정렬 기준) */
  rankSort: "ranksort",
  craft: "craft",
  use: "use",
  waste: "waste",
  grant: "grant",
  blood: "blood",
  config: "config",
  /** `wish:accept:<소원 id>` / `wish:reject:<소원 id>` */
  accept: "accept",
  reject: "reject",
  /** 아무 동작도 하지 않는 비활성 버튼(페이지 표시)용 */
  noop: "noop",
} as const;

/** 모달의 customId. */
export const MODAL_ID = {
  waste: "m-waste",
  use: "m-use",
  grant: "m-grant",
  blood: "m-blood",
  config: "m-config",
} as const;

/** 모달 안쪽 입력의 id — `interaction.fields` 로 읽을 때 쓴다. */
export const FIELD = {
  wasteItem: "waste_item",
  wishContent: "wish_content",
  wishFiles: "wish_files",
  grantDirection: "grant_direction",
  grantItem: "grant_item",
  grantUsers: "grant_users",
  grantAmount: "grant_amount",
  /** 흡혈 — from 이 빼앗기고 to 가 가져간다. */
  bloodItem: "blood_item",
  bloodFrom: "blood_from",
  bloodTo: "blood_to",
  bloodAmount: "blood_amount",
  configChannel: "config_channel",
  fragmentsPerTicket: "config_fragments_per_ticket",
} as const;

export const PANEL = { user: "user", admin: "admin" } as const;
export type PanelKind = (typeof PANEL)[keyof typeof PANEL];

export const ITEM = { ticket: "ticket", fragment: "fragment" } as const;
export type Item = (typeof ITEM)[keyof typeof ITEM];

export const DIRECTION = { give: "give", take: "take" } as const;
export type Direction = (typeof DIRECTION)[keyof typeof DIRECTION];

/** 랭킹 한 페이지에 보여줄 인원. */
export const RANK_PAGE_SIZE = 10;

export const ITEM_LABEL: Record<Item, string> = {
  ticket: "소원권",
  fragment: "소원권 조각",
};

/** 소원권은 "장", 조각은 "개". */
export const ITEM_UNIT: Record<Item, string> = {
  ticket: "장",
  fragment: "개",
};

export function isItem(value: string | undefined): value is Item {
  return value === ITEM.ticket || value === ITEM.fragment;
}

export function isDirection(value: string | undefined): value is Direction {
  return value === DIRECTION.give || value === DIRECTION.take;
}

export function isPanelKind(value: string | undefined): value is PanelKind {
  return value === PANEL.user || value === PANEL.admin;
}
