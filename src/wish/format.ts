import { clock, dayLabel, dayStamp } from "../time.js";
import { formatAmount } from "./amount.js";
import { ITEM, ITEM_EMOJI, ITEM_LABEL, ITEM_UNIT, type Item } from "./ids.js";
import type { BalanceChange, HistoryDay, RankSort } from "./store.js";
import type { Balance, LedgerEntry } from "./types.js";

/**
 * 수량이 바뀌었을 때 봇 응답에 반드시 들어가야 하는 문구.
 * 바뀐 항목만 줄로 남기고, 아무 변화가 없으면 undefined 를 돌려준다.
 *
 *   소원권: 3장 → 4장
 *   소원권 조각: 5개 → 0개
 */
export function formatBalanceChange(change: BalanceChange): string | undefined {
  const lines: string[] = [];

  if (change.before.tickets !== change.after.tickets) {
    lines.push(`소원권: ${formatAmount(change.before.tickets)}장 → ${formatAmount(change.after.tickets)}장`);
  }

  if (change.before.fragments !== change.after.fragments) {
    lines.push(
      `소원권 조각: ${formatAmount(change.before.fragments)}개 → ${formatAmount(change.after.fragments)}개`,
    );
  }

  return lines.length === 0 ? undefined : lines.join("\n");
}

/** 여러 명의 변동을 한 번에 보여줄 때 (관리자 수수). */
export function formatBalanceChangeFor(userId: string, change: BalanceChange): string {
  return [`<@${userId}>`, formatBalanceChange(change) ?? "변동 없음"].join("\n");
}

export function formatBalance(balance: Balance): string {
  return `소원권 **${formatAmount(balance.tickets)}장** · 소원권 조각 **${formatAmount(balance.fragments)}개**`;
}

/** 랭킹처럼 기준이 되는 한 항목만 보여줄 때. */
export function formatBalanceBy(balance: Balance, sort: RankSort): string {
  return sort === "tickets"
    ? `${ITEM_LABEL.ticket} **${formatAmount(balance.tickets)}${ITEM_UNIT.ticket}**`
    : `${ITEM_LABEL.fragment} **${formatAmount(balance.fragments)}${ITEM_UNIT.fragment}**`;
}

// ─────────────────────────────────────────────────────────────
// 역사
// ─────────────────────────────────────────────────────────────

/** `+3장` · `-5개` — 부호를 반드시 붙인다. 역사는 「얼마가 됐나」가 아니라 「얼마나 움직였나」다. */
function moved(amount: number, item: Item): string {
  return `${amount > 0 ? "+" : "−"}${formatAmount(Math.abs(amount))}${ITEM_UNIT[item]}`;
}

/**
 * 역사 한 줄.
 *
 *   `오후 8:25` @마이즌 · 🎫 **+1장** · 소원 거절 — 환불
 *
 * 시각은 [타임스탬프 마크다운](../time.ts)이라 보는 사람의 시간대로 나온다.
 * 한 번에 둘이 움직인 것(제작)은 한 줄에 둘 다 적는다 — 같은 일이기 때문이다.
 */
export function formatLedgerEntry(entry: LedgerEntry): string {
  const items: string[] = [];
  if (entry.tickets !== 0) items.push(`${ITEM_EMOJI.ticket} **${moved(entry.tickets, ITEM.ticket)}**`);
  if (entry.fragments !== 0) {
    items.push(`${ITEM_EMOJI.fragment} **${moved(entry.fragments, ITEM.fragment)}**`);
  }

  // 「수수 — 지급 — 이벤트 보상」 처럼 줄표가 겹치지 않게, 사유는 콜론으로 잇는다
  // (감사 로그도 같은 꼴이다).
  const why = entry.reason === null ? entry.source : `${entry.source}: ${entry.reason}`;

  return `${clock(new Date(entry.at))} <@${entry.userId}> · ${items.join(" ")} · ${why}`;
}

/** `12건 · 🎫 +5 −2 · 🧩 +8` — 그날 얼마나 움직였는지 한 줄로. */
export function formatHistorySummary(day: HistoryDay): string {
  const parts = [`${day.count}건`];

  for (const [item, moves] of [
    [ITEM.ticket, day.tickets],
    [ITEM.fragment, day.fragments],
  ] as const) {
    if (moves.gained === 0 && moves.lost === 0) continue;

    const swing = [
      moves.gained > 0 ? `+${formatAmount(moves.gained)}` : "",
      moves.lost > 0 ? `−${formatAmount(moves.lost)}` : "",
    ]
      .filter((part) => part !== "")
      .join(" ");

    parts.push(`${ITEM_EMOJI[item]} ${swing}`);
  }

  return parts.join(" · ");
}

/** 드롭다운에 적을 날짜. 날짜 다루기는 [time.ts](../time.ts) 가 한다. */
export const formatHistoryDate = dayLabel;

/** 화면 본문에서 그날을 가리킬 시각. */
export const historyDayStamp = dayStamp;
