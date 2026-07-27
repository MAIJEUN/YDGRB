import type { User } from "discord.js";

import { atWithCountdown } from "../time.js";
import type { MessageOptions } from "../ui/response.js";

/**
 * 타임아웃이 끝났을 때 채널에 남기는 알림.
 *
 * 아무도 요청하지 않은, 알려 주기만 하는 응답이라 파랑(정보)이다.
 */

export interface EndNoticeOptions {
  readonly targetId: string;
  /** 기간 만료면 풀린 시각, 중간 해제면 원래 풀릴 예정이던 시각. */
  readonly until: Date;
  /** 중간에 푼 사람. `null` 이면 기간이 다 되어 저절로 풀린 것. */
  readonly releasedBy: string | null;
  /** footer 에 적을 사람 — 타임아웃을 건 사람. */
  readonly user: User;
}

export function endNoticeView(options: EndNoticeOptions): MessageOptions {
  const released = options.releasedBy !== null;

  return {
    status: "info",
    title: released ? "타임아웃 — 해제" : "타임아웃 — 기간 만료",
    description: released
      ? `<@${options.targetId}> 님의 타임아웃이 <@${options.releasedBy}> 님에 의해 풀렸습니다.`
      : `<@${options.targetId}> 님의 타임아웃이 끝났습니다.`,
    fields: [
      { name: "대상", value: `<@${options.targetId}>` },
      {
        // 시각은 반드시 타임스탬프 마크다운으로.
        name: released ? "원래 풀릴 시각" : "풀린 시각",
        value: atWithCountdown(options.until),
      },
    ],
    user: options.user,
    ephemeral: false,
  };
}
