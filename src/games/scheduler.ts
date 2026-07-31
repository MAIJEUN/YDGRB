/**
 * 모집 마감 예약.
 *
 * 여기는 **타이머만** 든다 — 마감했을 때 무엇을 할지는 부르는 쪽(runner)이 넘긴다.
 * 그래야 서로를 불러 대는 고리가 생기지 않는다.
 *
 * 예약 자체는 파일에 저장된 마감 시각을 기준으로 하므로 봇을 재시작해도 되살아난다
 * (`restoreGames` 를 clientReady 에서 호출).
 */

/** setTimeout 이 한 번에 감당하는 최대 지연 (약 24.8일). 모집이 이보다 길 일은 없지만 대비해 둔다. */
const MAX_DELAY_MS = 2 ** 31 - 1;

interface Reservation {
  readonly timer: NodeJS.Timeout;
  readonly at: number;
}

const timers = new Map<string, Reservation>();

function key(guildId: string, sessionId: string): string {
  return `${guildId}:${sessionId}`;
}

export function cancelClose(guildId: string, sessionId: string): void {
  const id = key(guildId, sessionId);
  const reservation = timers.get(id);
  if (reservation !== undefined) clearTimeout(reservation.timer);
  timers.delete(id);
}

export function scheduleClose(
  guildId: string,
  sessionId: string,
  at: number,
  close: () => void,
): void {
  cancelClose(guildId, sessionId);

  const id = key(guildId, sessionId);
  const delay = at - Date.now();

  if (delay > MAX_DELAY_MS) {
    timers.set(id, {
      at,
      timer: setTimeout(() => {
        scheduleClose(guildId, sessionId, at, close);
      }, MAX_DELAY_MS),
    });
    return;
  }

  timers.set(id, {
    at,
    timer: setTimeout(() => {
      timers.delete(id);
      close();
    }, Math.max(delay, 0)),
  });
}

/** 디버그용 — 지금 걸려 있는 마감. */
export function reservations(): { guildId: string; sessionId: string; at: number }[] {
  return [...timers].map(([id, reservation]) => {
    const [guildId = "", sessionId = ""] = id.split(":");
    return { guildId, sessionId, at: reservation.at };
  });
}

/** 종료할 때 타이머를 남기지 않기 위해. */
export function cancelAllCloses(): void {
  for (const [id, reservation] of timers) {
    clearTimeout(reservation.timer);
    timers.delete(id);
  }
}
