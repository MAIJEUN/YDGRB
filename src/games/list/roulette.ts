import { randomInt } from "node:crypto";

import { messageEdit } from "../../ui/response.js";
import { speak } from "../../ui/tone.js";
import { defineGame } from "../types.js";
import type { GameContext } from "../types.js";
import { startedView } from "../views.js";

/**
 * 룰렛 — **참가** 형식. 모인 사람 중 하나를 뽑는다.
 *
 * 참가자를 한 줄에 하나씩 세워 놓고, 표시가 그 줄들을 훑으며 돈다.
 *
 *   <@유저5>
 *   <@유저1>
 *   **>** <@유저2> **<**
 *   <@유저3>
 *   <@유저4>
 *
 * 돌리는 시늉만 하는 것이 아니라 **당첨자를 먼저 뽑고 거기서 멎게** 한다. 화면을 고칠
 * 때마다 다시 뽑으면 편집이 하나라도 밀렸을 때 결과가 달라진다.
 *
 * 자리는 판이 시작될 때 한 번 섞는다. 참가한 차례대로 세우면 먼저 누른 사람이 늘 위라
 * 룰렛이 아니라 대기줄로 보인다.
 */

export const ROULETTE = "roulette";

/** 자리 수의 한계. 둘은 있어야 뽑을 것이 있고, 스무 줄이 넘으면 한눈에 안 들어온다. */
export const MIN_SEATS = 2;
export const MAX_SEATS = 20;

/**
 * 표시를 옮기는 횟수.
 *
 * 한 칸마다 채널 메시지를 한 번 고친다. 디스코드는 한 채널의 편집을 **5초에 다섯 번**으로
 * 끊으므로 칸 사이를 1초 밑으로 좁힐 수 없다. 여덟 칸이면 12초쯤 도는데, 그 이상은
 * 기다리는 쪽이 지친다.
 */
export const SPIN_FRAMES = 8;

/** 첫 칸과 마지막 칸의 간격. 뒤로 갈수록 느려져야 멎는 것처럼 보인다. */
const FIRST_FRAME_MS = 1000;
const LAST_FRAME_MS = 2200;

/** 멎은 자리를 보여 주고 결과를 내기까지의 뜸. */
const LAND_PAUSE_MS = 1200;

/** 멎기 전에 도는 바퀴 수. 자리 수와 무관하게 「한참 돌았다」는 느낌을 준다. */
const LAPS = 2;

/**
 * 자리를 섞는다 (피셔-예이츠).
 *
 * `Math.random` 이 아니라 `randomInt` 를 쓴다 — 뽑기의 공정함이 곧 이 게임의 전부다.
 */
export function shuffle(userIds: readonly string[]): string[] {
  const seats = [...userIds];

  for (let i = seats.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [seats[i], seats[j]] = [seats[j] as string, seats[i] as string];
  }

  return seats;
}

/**
 * 자리표. 표시가 앉은 줄만 화살표로 감싼다.
 *
 * 화살표를 굵게 싸는 이유는 **줄 맨 앞의 `>` 가 인용문이 되기 때문**이다. `> 아무개` 라고
 * 적으면 디스코드가 통째로 인용 상자에 넣어 버린다. `**` 가 먼저 오면 그 일이 없다.
 *
 * 줄을 맞추려 들지 않는다. 디스코드 글꼴은 폭이 제각각이라 공백을 아무리 넣어도
 * 이름 길이에 따라 어긋난다. 화살표가 굵어서 어느 줄인지는 그대로 보인다.
 */
export function board(seats: readonly string[], at: number): string {
  return seats
    .map((userId, index) =>
      index === at ? `**>** <@${userId}> **<**` : `<@${userId}>`,
    )
    .join("\n");
}

/**
 * `frame` 번째 칸에서 표시가 앉을 자리.
 *
 * 마지막 칸은 반드시 당첨자다 — 처음에 뽑아 둔 자리까지의 거리를 **뒤로 갈수록 잘게**
 * 나눠 걷는다. 그래서 앞에서는 몇 칸씩 건너뛰고 끝에서는 한 칸씩 붙는다.
 */
export function seatAt(frame: number, seats: number, winner: number): number {
  if (seats <= 0) return 0;
  if (frame >= SPIN_FRAMES) return winner;

  const distance = seats * LAPS + winner;
  const progress = frame / SPIN_FRAMES;

  return Math.round(distance * (1 - (1 - progress) ** 3)) % seats;
}

/** 칸과 칸 사이. 뒤로 갈수록 벌어진다. */
export function frameDelay(frame: number): number {
  const progress = frame / SPIN_FRAMES;
  return Math.round(FIRST_FRAME_MS + (LAST_FRAME_MS - FIRST_FRAME_MS) * progress ** 2);
}

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const roulette = defineGame({
  id: ROULETTE,
  name: "룰렛",
  description: speak("모인 사람 중 한 명을 뽑습니다."),
  mode: "recruit",
  minPlayers: MIN_SEATS,
  // 몇 명을 받을지는 판마다 다르다. 명령의 「참가인원」 이 판에 실린다.
  maxPlayers: null,

  async start(context) {
    const seats = shuffle(context.session.players);

    if (seats.length < MIN_SEATS) {
      await context.end({
        status: "failure",
        description: speak("사람이 모자라 돌리지 못했습니다."),
      });
      return;
    }

    // 당첨자를 먼저 뽑는다. 회전은 그 자리로 가는 길일 뿐이다.
    const winner = randomInt(seats.length);
    const draw = await painter(context);

    await draw(board(seats, seatAt(0, seats.length, winner)));

    for (let frame = 1; frame <= SPIN_FRAMES; frame += 1) {
      await wait(frameDelay(frame - 1));
      // 도는 동안 「종료」가 눌렸을 수 있다. 끝난 판의 화면을 덮어쓰면 안 된다.
      if (!context.alive()) return;

      await draw(board(seats, seatAt(frame, seats.length, winner)));
    }

    await wait(LAND_PAUSE_MS);
    if (!context.alive()) return;

    await context.end({ description: speak(`<@${seats[winner]}> 님이 당첨되셨습니다.`) });
  },
});

/**
 * 판 화면을 고치는 붓.
 *
 * 메시지는 **한 번만** 집어 둔다. 칸마다 다시 집으면 회전 내내 쓸데없는 요청이 오간다.
 * 못 집었거나 고치다 막히면 조용히 넘긴다 — 회전이 안 보일 뿐, 뽑기는 이미 끝나 있다.
 */
async function painter(context: GameContext): Promise<(body: string) => Promise<void>> {
  const { messageId } = context.session;

  const message =
    messageId === null ? null : await context.channel.messages.fetch(messageId).catch(() => null);

  return async (body: string) => {
    if (message === null) return;

    await message
      .edit(messageEdit(startedView(roulette, { ...context.session, body }, context.host)))
      .catch(() => undefined);
  };
}

export default roulette;
