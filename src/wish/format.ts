import { ITEM_LABEL, ITEM_UNIT } from "./ids.js";
import type { BalanceChange, RankSort } from "./store.js";
import type { Balance } from "./types.js";

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
    lines.push(`소원권: ${change.before.tickets}장 → ${change.after.tickets}장`);
  }

  if (change.before.fragments !== change.after.fragments) {
    lines.push(`소원권 조각: ${change.before.fragments}개 → ${change.after.fragments}개`);
  }

  return lines.length === 0 ? undefined : lines.join("\n");
}

/** 여러 명의 변동을 한 번에 보여줄 때 (관리자 수수). */
export function formatBalanceChangeFor(userId: string, change: BalanceChange): string {
  return [`<@${userId}>`, formatBalanceChange(change) ?? "변동 없음"].join("\n");
}

export function formatBalance(balance: Balance): string {
  return `소원권 **${balance.tickets}장** · 소원권 조각 **${balance.fragments}개**`;
}

/** 랭킹처럼 기준이 되는 한 항목만 보여줄 때. */
export function formatBalanceBy(balance: Balance, sort: RankSort): string {
  return sort === "tickets"
    ? `${ITEM_LABEL.ticket} **${balance.tickets}${ITEM_UNIT.ticket}**`
    : `${ITEM_LABEL.fragment} **${balance.fragments}${ITEM_UNIT.fragment}**`;
}
