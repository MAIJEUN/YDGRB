import { reservations as gameReservations } from "../games/scheduler.js";
import { runningJobs } from "../nickname/registry.js";
import { reservations as nicknameReservations } from "../nickname/scheduler.js";
import { runningLoops } from "../tasalbeo/runner.js";
import { reservations as tasalbeoReservations } from "../tasalbeo/scheduler.js";
import { reservations as timeoutReservations } from "../timeout/scheduler.js";

/**
 * 지금 메모리에 떠 있는 예약과 반복을 한곳에 모은다.
 *
 * 저장된 파일(`data/*.json`)이 아니라 **살아 있는 타이머**를 본다. 둘이 어긋나면
 * 그게 곧 버그다 — 재시작 뒤 되살리기가 빠졌거나, 취소하면서 타이머만 남겼거나.
 */

export interface Reservation {
  readonly kind: "타임아웃" | "뚜따이" | "타살버" | "게임 모집";
  readonly guildId: string;
  /** 대상. null 이면 사람이 아닌 것 — 서버 전원(뚜따이)이나 판 하나(게임). */
  readonly targetId: string | null;
  readonly at: number;
  /** 사람이 아닌 대상을 가리키는 말. 화면에서 멘션 대신 쓴다. */
  readonly label?: string;
}

/** 먼저 터지는 것부터. */
export function allReservations(): Reservation[] {
  const all: Reservation[] = [
    ...timeoutReservations().map((item) => ({
      kind: "타임아웃" as const,
      guildId: item.guildId,
      targetId: item.userId,
      at: item.at,
    })),
    ...nicknameReservations().map((item) => ({
      kind: "뚜따이" as const,
      guildId: item.guildId,
      targetId: item.targetId,
      at: item.at,
    })),
    ...tasalbeoReservations().map((item) => ({
      kind: "타살버" as const,
      guildId: item.guildId,
      targetId: item.userId,
      at: item.at,
    })),
    ...gameReservations().map((item) => ({
      kind: "게임 모집" as const,
      guildId: item.guildId,
      targetId: null,
      at: item.at,
      label: `\`${item.sessionId}\``,
    })),
  ];

  return all.sort((a, b) => a.at - b.at);
}

export { runningJobs, runningLoops };
