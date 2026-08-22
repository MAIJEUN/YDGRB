/** 한 유저가 가진 소원권과 조각. */
export interface Balance {
  tickets: number;
  fragments: number;
}

export type WishStatus = "pending" | "accepted" | "rejected";

export interface WishAttachment {
  name: string;
  /**
   * 소원을 채널에 올리기 전에는 모달 업로드의 **임시** URL,
   * 올린 뒤에는 봇 메시지에 첨부된 영구 URL 로 교체된다.
   */
  url: string;
  size: number;
  contentType: string | null;
}

/** 유저가 빈 소원 한 건. 관리자가 수락/거절할 때까지 pending 으로 남는다. */
export interface WishRecord {
  id: string;
  userId: string;
  content: string;
  attachments: WishAttachment[];
  /** 소원이 전달된 채널과 메시지 — 수락/거절 시 그 메시지를 고치기 위해 들고 있는다. */
  channelId: string;
  messageId: string | null;
  status: WishStatus;
  createdAt: number;
  resolvedBy: string | null;
  resolvedAt: number | null;
}

export interface GuildSettings {
  /** 소원이 전달될 채널. 설정 전에는 null 이고, 이때는 소원을 빌 수 없다. */
  wishChannelId: string | null;
  /** 소원권 1장을 만드는 데 필요한 조각 수. 서버마다 다르게 정할 수 있다. */
  fragmentsPerTicket: number;
  /**
   * 수량의 소수점 자릿수 (0~10).
   *
   * 이 서버의 소원권이 **얼마나 잘게 쪼개지는가**. 0이면 정수만, 1이면 반 장까지.
   * 자릿수를 늘리면 다룰 수 있는 최대 수량이 그만큼 내려간다 ([amount.ts](amount.ts)).
   */
  decimals: number;
}

/**
 * 수량이 바뀐 기록 한 줄 — **역사**.
 *
 * 「누가 · 언제 · 무엇이 얼마나 · 왜」 넷이 전부다. 바뀐 뒤의 잔액은 남기지 않는다 —
 * 중간에 하나만 어긋나도 그 뒤가 전부 거짓이 되고, 어차피 지금 잔액은 `balances` 가 안다.
 */
export interface LedgerEntry {
  /** 바뀐 시각. 날짜별로 묶을 때도 여기서 뽑는다. */
  readonly at: number;
  readonly userId: string;
  /** 소원권 변동. 안 바뀌었으면 0. */
  readonly tickets: number;
  /** 조각 변동. 안 바뀌었으면 0. */
  readonly fragments: number;
  /**
   * 무엇이 바꿨는지 — 「수수 — 지급」 · 「출헉 보상」 · 「제작」.
   *
   * 사람이 사유를 안 적는 시스템(출헉 · 소원 · 제작 · 낭비)도 **왜 바뀌었는지는 남아야**
   * 하므로, 사유와 따로 언제나 채운다.
   */
  readonly source: string;
  /** 사람이 적은 사유. 안 적었으면 null. */
  readonly reason: string | null;
}

export interface GuildData {
  balances: Record<string, Balance>;
  settings: GuildSettings;
  wishes: Record<string, WishRecord>;
  /** 수량이 바뀐 기록. 오래된 것이 앞이다. 예전 파일에는 없다. */
  history: LedgerEntry[];
}

export interface WishData {
  guilds: Record<string, GuildData>;
}
