import { randomBytes } from "node:crypto";
import path from "node:path";

import { JsonFile } from "../storage/json-file.js";
import type {
  Balance,
  GuildData,
  GuildSettings,
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
  if (existing !== undefined) return existing;

  const created: GuildData = { balances: {}, settings: defaultSettings(), wishes: {} };
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
export async function applyBalanceChanges(
  guildId: string,
  userIds: readonly string[],
  delta: BalanceDelta,
): Promise<Map<string, ChangeResult>> {
  return file.update((data) => {
    const guild = guildOf(data, guildId);
    const results = new Map<string, ChangeResult>();

    for (const userId of userIds) {
      const before = balanceOf(guild, userId);
      const after: Balance = {
        tickets: before.tickets + (delta.tickets ?? 0),
        fragments: before.fragments + (delta.fragments ?? 0),
      };

      if (after.tickets < 0 || after.fragments < 0) {
        results.set(userId, { ok: false, reason: "insufficient", before });
        continue;
      }

      guild.balances[userId] = after;
      results.set(userId, { ok: true, before, after });
    }

    return results;
  });
}

/** 한 명만 바꿀 때 쓰는 얇은 래퍼. 실제 로직은 `applyBalanceChanges` 하나뿐이다. */
export async function applyBalanceChange(
  guildId: string,
  userId: string,
  delta: BalanceDelta,
): Promise<ChangeResult> {
  const result = (await applyBalanceChanges(guildId, [userId], delta)).get(userId);
  if (result === undefined) throw new Error(`수량 변경 결과가 비어 있습니다: ${userId}`);
  return result;
}

export async function getBalance(guildId: string, userId: string): Promise<Balance> {
  const guild = (await file.read()).guilds[guildId];
  return guild === undefined ? emptyBalance() : balanceOf(guild, userId);
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
