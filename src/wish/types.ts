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
}

export interface GuildData {
  balances: Record<string, Balance>;
  settings: GuildSettings;
  wishes: Record<string, WishRecord>;
}

export interface WishData {
  guilds: Record<string, GuildData>;
}
