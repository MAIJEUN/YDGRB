import { randomBytes } from "node:crypto";

import type { Mode } from "./ids.js";

/**
 * 서버마다 지금 돌고 있는 별명 작업을 하나만 두고 관리한다.
 *
 * 뚜따이 도중에 바사삭이 시작되면(또는 반대로) 먼저 돌던 쪽을 취소하고,
 * **완전히 멈출 때까지 기다린 뒤** 새 작업을 시작한다.
 * 기다리지 않으면 두 루프가 같은 사람의 별명을 번갈아 바꿔서 결과를 알 수 없게 된다.
 */

export interface ActiveRun {
  readonly id: string;
  readonly mode: Mode;
  /** 루프가 매번 확인하고, true 가 되면 멈춘다. */
  cancelled: boolean;
  /** 취소를 일으킨 사람. */
  cancelledBy: string | null;
  /** 새 작업 때문에 밀렸다면 그 작업의 종류. 사용자가 버튼으로 취소했으면 null. */
  supersededBy: Mode | null;
  /** 루프가 완전히 끝나면 resolve 된다. */
  readonly finished: Promise<void>;
  /** 작업이 끝났음을 알린다 — 반드시 finally 에서 부른다. */
  finish(): void;
}

const runs = new Map<string, Run>();

class Run implements ActiveRun {
  readonly id = randomBytes(4).toString("hex");
  cancelled = false;
  cancelledBy: string | null = null;
  supersededBy: Mode | null = null;
  readonly finished: Promise<void>;

  #resolve: () => void = () => {};

  constructor(
    readonly guildId: string,
    readonly mode: Mode,
  ) {
    // executor 는 동기로 실행되므로 생성자를 벗어나기 전에 #resolve 가 채워진다.
    this.finished = new Promise((done) => {
      this.#resolve = done;
    });
  }

  finish(): void {
    if (runs.get(this.guildId) === this) runs.delete(this.guildId);
    this.#resolve();
  }
}

/**
 * 새 작업을 등록한다. 돌고 있던 작업이 있으면 취소하고 멈출 때까지 기다린다.
 */
export async function beginRun(
  guildId: string,
  mode: Mode,
  startedBy: string,
): Promise<ActiveRun> {
  const previous = runs.get(guildId);

  if (previous !== undefined) {
    previous.cancelled = true;
    previous.cancelledBy = startedBy;
    previous.supersededBy = mode;
    await previous.finished;
  }

  const run = new Run(guildId, mode);
  runs.set(guildId, run);
  return run;
}

/**
 * 취소 버튼용. `expectedId` 가 지금 돌고 있는 작업과 다르면 아무것도 하지 않는다 —
 * 이미 끝난 작업의 버튼을 눌러 새 작업이 죽는 것을 막는다.
 */
export function cancelRun(
  guildId: string,
  cancelledBy: string,
  expectedId: string | undefined,
): ActiveRun | undefined {
  const run = runs.get(guildId);
  if (run === undefined) return undefined;
  if (expectedId !== undefined && run.id !== expectedId) return undefined;

  run.cancelled = true;
  run.cancelledBy = cancelledBy;
  run.supersededBy = null;
  return run;
}

export function activeRun(guildId: string): ActiveRun | undefined {
  return runs.get(guildId);
}
