import { randomBytes } from "node:crypto";
import path from "node:path";

import { JsonFile } from "../storage/json-file.js";
import { dateKey } from "../time.js";
import type {
  Balance,
  GuildData,
  GuildSettings,
  LedgerEntry,
  WishAttachment,
  WishData,
  WishRecord,
  WishStatus,
} from "./types.js";

/** 서버에서 따로 정하지 않았을 때 쓰는 제작 비용. */
export const DEFAULT_FRAGMENTS_PER_TICKET = 5;
export const MIN_FRAGMENTS_PER_TICKET = 1;
export const MAX_FRAGMENTS_PER_TICKET = 100;

const file = new JsonFile<WishData>(path.resolve(process.cwd(), "data", "wishes.json"), () => ({
  guilds: {},
}));

function emptyBalance(): Balance {
  return { tickets: 0, fragments: 0 };
}

function defaultSettings(): GuildSettings {
  return { wishChannelId: null, fragmentsPerTicket: DEFAULT_FRAGMENTS_PER_TICKET };
}

function guildOf(data: WishData, guildId: string): GuildData {
  const existing = data.guilds[guildId];
  if (existing !== undefined) {
    // 예전 파일에는 역사가 없다.
    existing.history ??= [];
    return existing;
  }

  const created: GuildData = {
    balances: {},
    settings: defaultSettings(),
    wishes: {},
    history: [],
  };
  data.guilds[guildId] = created;
  return created;
}

function balanceOf(guild: GuildData, userId: string): Balance {
  return { ...emptyBalance(), ...guild.balances[userId] };
}

// ─────────────────────────────────────────────────────────────
// 수량 변경 — 지급 · 회수 · 제작 · 사용 · 낭비 · 환불이 모두 여기를 지난다
// ─────────────────────────────────────────────────────────────

export interface BalanceDelta {
  readonly tickets?: number;
  readonly fragments?: number;
}

export interface BalanceChange {
  readonly before: Balance;
  readonly after: Balance;
}

export type ChangeResult =
  | ({ readonly ok: true } & BalanceChange)
  | { readonly ok: false; readonly reason: "insufficient"; readonly before: Balance };

/**
 * 소원권/조각 수량이 바뀌는 **유일한** 통로.
 *
 * 지급이든 회수든 제작이든 delta 부호만 다르다. 예를 들어
 *   - 지급 3장  → `{ tickets: 3 }`
 *   - 회수 2개  → `{ fragments: -2 }`
 *   - 제작      → `{ fragments: -5, tickets: 1 }`
 *   - 사용/낭비 → `{ tickets: -1 }`
 *
 * 결과가 음수가 되는 유저는 **아무것도 바꾸지 않고** `ok: false` 로 돌려준다
 * (여러 명을 한 번에 처리할 때 일부만 실패할 수 있다).
 */
/**
 * 이 변동이 **왜** 일어났는지.
 *
 * 사람이 사유를 적는 것(수수 · 흡혈)만 남기면 역사가 반쪽이 된다. 출헉 보상도 제작도
 * 소원 환불도 누군가에게는 「내 소원권이 왜 줄었지」다. 그래서 `source` 는 언제나 받는다.
 */
export interface ChangeNote {
  /** 무엇이 바꿨는지 — 「수수 — 지급」 · 「출헉 보상」 · 「제작」. */
  readonly source: string;
  /** 사람이 적은 사유. 없으면 null. */
  readonly reason?: string | null;
}

export interface ChangeOptions {
  /**
   * 역사에 남길 것. **빠뜨릴 수 없다** — 수량이 바뀌는 통로가 여기 하나뿐이라,
   * 여기서 받아 두지 않으면 어디서도 다시 알아낼 방법이 없다.
   */
  readonly note: ChangeNote;
  /**
   * 모자라면 **있는 만큼만** 뺀다 (5장 가진 사람에게서 100장을 회수하면 0장이 된다).
   *
   * 「그 사람이 가진 것을 걷는다」 가 뜻이 통하는 곳에서만 켠다 — 회수가 그렇다.
   * 제작처럼 값을 정확히 치러야 하는 것에는 켜면 안 된다. 조각이 모자란데 반쪽짜리
   * 소원권을 내줄 수는 없다.
   */
  readonly clamp?: boolean;
}

/** 정수로 정확히 다룰 수 있는 한계. 넘겨 두면 더한 값이 슬금슬금 어긋난다. */
const MAX_BALANCE = Number.MAX_SAFE_INTEGER;

/**
 * 역사에 남겨 두는 최대 줄 수.
 *
 * 파일 하나를 통째로 읽고 쓰는 저장소라 무한정 쌓이면 변동 한 번이 점점 비싸진다.
 * 60명짜리 서버가 하루 스무 줄을 쓴다고 보면 이 정도가 반년치다. 넘치면 오래된 것부터
 * 버린다 — 지금 잔액은 `balances` 가 들고 있으므로 역사가 잘려도 수가 틀어지지 않는다.
 */
export const MAX_HISTORY_ENTRIES = 4000;

export async function applyBalanceChanges(
  guildId: string,
  userIds: readonly string[],
  delta: BalanceDelta,
  options: ChangeOptions,
): Promise<Map<string, ChangeResult>> {
  return file.update((data) => {
    const guild = guildOf(data, guildId);
    const results = new Map<string, ChangeResult>();

    for (const userId of userIds) {
      const before = balanceOf(guild, userId);
      const wanted: Balance = {
        tickets: before.tickets + (delta.tickets ?? 0),
        fragments: before.fragments + (delta.fragments ?? 0),
      };

      if (options.clamp !== true && (wanted.tickets < 0 || wanted.fragments < 0)) {
        results.set(userId, { ok: false, reason: "insufficient", before });
        continue;
      }

      // 0 밑으로도, 정확히 셀 수 있는 한계 위로도 가지 않는다.
      const after: Balance = {
        tickets: Math.min(Math.max(wanted.tickets, 0), MAX_BALANCE),
        fragments: Math.min(Math.max(wanted.fragments, 0), MAX_BALANCE),
      };

      guild.balances[userId] = after;
      results.set(userId, { ok: true, before, after });

      // 아무것도 안 바뀐 변동은 역사가 아니다 (0을 더하거나, 이미 0인 데서 걷었거나).
      const tickets = after.tickets - before.tickets;
      const fragments = after.fragments - before.fragments;
      if (tickets === 0 && fragments === 0) continue;

      guild.history.push({
        at: Date.now(),
        userId,
        tickets,
        fragments,
        source: options.note.source,
        reason: options.note.reason ?? null,
      });
    }

    // 넘치면 오래된 것부터 버린다.
    if (guild.history.length > MAX_HISTORY_ENTRIES) {
      guild.history.splice(0, guild.history.length - MAX_HISTORY_ENTRIES);
    }

    return results;
  });
}

/** 한 명만 바꿀 때 쓰는 얇은 래퍼. 실제 로직은 `applyBalanceChanges` 하나뿐이다. */
export async function applyBalanceChange(
  guildId: string,
  userId: string,
  delta: BalanceDelta,
  options: ChangeOptions,
): Promise<ChangeResult> {
  const result = (await applyBalanceChanges(guildId, [userId], delta, options)).get(userId);
  if (result === undefined) throw new Error(`수량 변경 결과가 비어 있습니다: ${userId}`);
  return result;
}

export async function getBalance(guildId: string, userId: string): Promise<Balance> {
  const guild = (await file.read()).guilds[guildId];
  return guild === undefined ? emptyBalance() : balanceOf(guild, userId);
}

// ─────────────────────────────────────────────────────────────
// 역사 — 수량이 언제 왜 바뀌었는지
// ─────────────────────────────────────────────────────────────

/** 하루치 요약. 드롭다운 한 줄이 이만큼을 말한다. */
export interface HistoryDay {
  /** 한국 날짜 (`2026-08-17`). 이 봇의 하루는 어디서나 이 기준이다. */
  readonly date: string;
  /** 그날 있었던 변동 줄 수. */
  readonly count: number;
  readonly tickets: { readonly gained: number; readonly lost: number };
  readonly fragments: { readonly gained: number; readonly lost: number };
}

function emptyMoves(): { gained: number; lost: number } {
  return { gained: 0, lost: 0 };
}

function addMove(into: { gained: number; lost: number }, amount: number): void {
  if (amount > 0) into.gained += amount;
  else into.lost -= amount;
}

/**
 * 변동이 있었던 날들. **최근 날짜가 앞**이다.
 *
 * 드롭다운은 스물다섯 줄까지만 받는데, 오래된 쪽을 먼저 보여 줄 이유가 없다.
 */
export async function getHistoryDays(guildId: string): Promise<HistoryDay[]> {
  const history = (await file.read()).guilds[guildId]?.history ?? [];
  const days = new Map<string, { count: number; tickets: ReturnType<typeof emptyMoves>; fragments: ReturnType<typeof emptyMoves> }>();

  for (const entry of history) {
    const key = dateKey(new Date(entry.at));
    const day = days.get(key) ?? { count: 0, tickets: emptyMoves(), fragments: emptyMoves() };

    day.count += 1;
    addMove(day.tickets, entry.tickets);
    addMove(day.fragments, entry.fragments);
    days.set(key, day);
  }

  return [...days]
    .map(([date, day]) => ({ date, ...day }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * 그날 있었던 변동. **이른 것이 앞**이다 — 하루를 위에서 아래로 읽는다.
 *
 * 날짜는 저장할 때가 아니라 읽을 때 뽑는다. 한 줄에 날짜와 시각을 둘 다 들고 있으면
 * 언젠가 둘이 어긋나고, 그때 어느 쪽이 맞는지 알 방법이 없다.
 */
export async function getHistoryOf(guildId: string, date: string): Promise<LedgerEntry[]> {
  const history = (await file.read()).guilds[guildId]?.history ?? [];

  return history
    .filter((entry) => dateKey(new Date(entry.at)) === date)
    .sort((a, b) => a.at - b.at);
}

// ─────────────────────────────────────────────────────────────
// 랭킹
// ─────────────────────────────────────────────────────────────

export type RankSort = "tickets" | "fragments";

export interface RankEntry {
  readonly userId: string;
  readonly balance: Balance;
}

/**
 * 기준 항목 내림차순, 같으면 나머지 항목 내림차순으로 정렬한다.
 * **기준 항목을 하나도 안 가진 유저는 뺀다** — 소원권 랭킹에 "0장"이 늘어서 있으면 의미가 없다.
 */
export async function getRanking(guildId: string, sort: RankSort): Promise<RankEntry[]> {
  const guild = (await file.read()).guilds[guildId];
  if (guild === undefined) return [];

  const other: RankSort = sort === "tickets" ? "fragments" : "tickets";

  return Object.entries(guild.balances)
    .map(([userId, balance]) => ({ userId, balance: { ...emptyBalance(), ...balance } }))
    .filter((entry) => entry.balance[sort] > 0)
    .sort(
      (a, b) =>
        b.balance[sort] - a.balance[sort] ||
        b.balance[other] - a.balance[other] ||
        a.userId.localeCompare(b.userId),
    );
}

// ─────────────────────────────────────────────────────────────
// 서버 설정
// ─────────────────────────────────────────────────────────────

/** 저장된 값이 없거나 예전 형식이어도 빠진 항목은 기본값으로 채워서 돌려준다. */
export async function getSettings(guildId: string): Promise<GuildSettings> {
  return { ...defaultSettings(), ...(await file.read()).guilds[guildId]?.settings };
}

/** 넘긴 항목만 바꾼다. 설정 모달에서 일부만 고쳐도 나머지가 지워지지 않게. */
export async function updateSettings(
  guildId: string,
  patch: Partial<GuildSettings>,
): Promise<GuildSettings> {
  return file.update((data) => {
    const guild = guildOf(data, guildId);
    guild.settings = { ...defaultSettings(), ...guild.settings, ...patch };
    return guild.settings;
  });
}

// ─────────────────────────────────────────────────────────────
// 소원
// ─────────────────────────────────────────────────────────────

export interface NewWish {
  readonly userId: string;
  readonly content: string;
  readonly attachments: readonly WishAttachment[];
  readonly channelId: string;
}

export async function createWish(guildId: string, wish: NewWish): Promise<WishRecord> {
  return file.update((data) => {
    const guild = guildOf(data, guildId);

    // customId 에 실어야 해서 짧게 만든다.
    let id = randomBytes(4).toString("hex");
    while (guild.wishes[id] !== undefined) id = randomBytes(4).toString("hex");

    const record: WishRecord = {
      id,
      userId: wish.userId,
      content: wish.content,
      attachments: [...wish.attachments],
      channelId: wish.channelId,
      messageId: null,
      status: "pending",
      createdAt: Date.now(),
      resolvedBy: null,
      resolvedAt: null,
    };

    guild.wishes[id] = record;
    return record;
  });
}

/**
 * 소원이 전달된 메시지 id 를 기록한다 (나중에 그 메시지를 고치기 위해).
 *
 * 첨부파일을 함께 넘기면 모달 업로드의 임시 URL 을 메시지에 붙은 영구 URL 로 바꿔 둔다.
 */
export async function attachWishMessage(
  guildId: string,
  wishId: string,
  messageId: string,
  attachments?: readonly WishAttachment[],
): Promise<void> {
  await file.update((data) => {
    const record = guildOf(data, guildId).wishes[wishId];
    if (record === undefined) return;

    record.messageId = messageId;
    if (attachments !== undefined) record.attachments = [...attachments];
  });
}

export async function getWish(guildId: string, wishId: string): Promise<WishRecord | undefined> {
  return (await file.read()).guilds[guildId]?.wishes[wishId];
}

/** 채널에 올리지 못했을 때처럼, 만들자마자 되돌려야 하는 경우. */
export async function deleteWish(guildId: string, wishId: string): Promise<void> {
  await file.update((data) => {
    delete guildOf(data, guildId).wishes[wishId];
  });
}

export type ResolveResult =
  | { readonly ok: true; readonly wish: WishRecord }
  | { readonly ok: false; readonly reason: "missing" }
  | { readonly ok: false; readonly reason: "already"; readonly wish: WishRecord };

/**
 * pending 인 소원만 처리한다.
 * 두 관리자가 동시에 눌러도 한 번만 반영되도록 상태 확인과 변경을 한 트랜잭션에서 한다.
 */
export async function resolveWish(
  guildId: string,
  wishId: string,
  status: Exclude<WishStatus, "pending">,
  adminId: string,
): Promise<ResolveResult> {
  return file.update((data) => {
    const record = guildOf(data, guildId).wishes[wishId];
    if (record === undefined) return { ok: false, reason: "missing" } as const;
    if (record.status !== "pending") return { ok: false, reason: "already", wish: record } as const;

    record.status = status;
    record.resolvedBy = adminId;
    record.resolvedAt = Date.now();

    return { ok: true, wish: record } as const;
  });
}
