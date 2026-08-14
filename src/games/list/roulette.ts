import { randomInt } from "node:crypto";

import { messageEdit } from "../../ui/response.js";
import { speak } from "../../ui/tone.js";
import { defineGame } from "../types.js";
import type { GameContext } from "../types.js";
import { startedView } from "../views.js";

/**
 * 룰렛 — **참가** 형식. 모인 사람 중 하나를 뽑는다.
 *
 * 화살표는 **가운데에 못 박혀 있고 이름이 그 앞을 지나간다.** 실제 룰렛이 그렇다 —
 * 바늘은 가만히 있고 판이 돈다.
 *
 *   ```
 *     @유저4
 *     @유저5
 *   > @유저1 <
 *     @유저2
 *     @유저3
 *   ```
 *
 * 한 번에 **다섯 줄**만 보인다. 스무 명이 다 늘어서 있으면 어디가 도는지 안 보이고,
 * 창이 좁아야 지나가는 것이 보인다.
 *
 * 돌리는 시늉만 하는 것이 아니라 **당첨자를 먼저 뽑고 거기서 멎게** 한다. 화면을 고칠
 * 때마다 다시 뽑으면 편집이 하나라도 밀렸을 때 결과가 달라진다.
 *
 * 자리는 판이 시작될 때 한 번 섞는다. 참가한 차례대로 세우면 먼저 누른 사람이 늘 위라
 * 룰렛이 아니라 대기줄로 보인다.
 *
 * ── 여기만 멘션이 아니다 ──
 *
 * 판이 **코드블록 안**이라 그 안에서는 멘션이 `<@123…>` 날것으로 나온다. 그래서 회전판에는
 * 이름을 글자로 적는다 — [출력 규칙](../../ui/response.ts)의 「유저는 언제나 멘션」에서
 * 일부러 뺀 자리다. 칸이 있어야 줄이 맞고, 줄이 맞아야 도는 것으로 보인다.
 *
 * **당첨자를 알리는 결과는 멘션 그대로다.** 규칙이 지켜져야 하는 곳은 거기다 —
 * 뽑힌 사람은 알림 없이도 자기가 불린 것을 알아야 한다.
 */

export const ROULETTE = "roulette";

/** 자리 수의 한계. 둘은 있어야 뽑을 것이 있고, 스무 명이 넘으면 모으다 마감이 온다. */
export const MIN_SEATS = 2;
export const MAX_SEATS = 20;

/**
 * 한 번에 보이는 줄 수.
 *
 * 사람이 이보다 적으면 있는 만큼만 보인다. 창을 넓히면 이름은 많이 보이지만 무엇이
 * 지나가는지는 오히려 안 보인다.
 */
export const WINDOW = 5;

/** 코드블록에 넣을 이름의 길이. 넘으면 잘라 「…」 을 붙인다. */
export const MAX_NAME_LENGTH = 24;

/**
 * 표시를 옮기는 횟수.
 *
 * 한 칸마다 채널 메시지를 한 번 고친다. 디스코드는 한 채널의 편집을 **5초에 다섯 번**으로
 * 끊으므로 칸 사이를 1초 밑으로 좁힐 수 없다. 여덟 칸이면 12초쯤 도는데, 그 이상은
 * 기다리는 쪽이 지친다.
 */
export const SPIN_FRAMES = 8;

/** 첫 칸과 마지막 칸의 간격. 뒤로 갈수록 느려져야 멎는 것처럼 보인다. */
const FIRST_FRAME_MS = 1500;
const LAST_FRAME_MS = 3200;

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
 * 코드블록에 넣을 이름 한 줄.
 *
 * 백틱과 줄바꿈을 걷어낸다. 이름은 **유저가 정하는 것**이라, 백틱이 섞이면 칸이 그 자리에서
 * 닫히고 뒤의 글이 통째로 밖으로 새어 나온다.
 */
export function label(name: string): string {
  const tidy = name.replaceAll(/[`\r\n]/gu, "").trim();
  if (tidy === "") return "@?";

  return `@${tidy.length > MAX_NAME_LENGTH ? `${tidy.slice(0, MAX_NAME_LENGTH - 1)}…` : tidy}`;
}

/**
 * 회전판. **화살표는 가운데에 못 박혀 있고 이름이 그 앞을 지나간다.**
 *
 * 창은 다섯 줄이고, 사람이 그보다 적으면 있는 만큼만 연다 (덜 찬 창에 같은 사람을 두 번
 * 세우면 몇 명이 겨루는지 알 수 없게 된다).
 *
 * 칸(코드블록)으로 싸는 이유는 **글꼴 폭이 같아야 줄이 맞기 때문**이다. 줄이 맞아야
 * 이름이 위로 흘러가는 것으로 보인다. 대신 그 안에서는 멘션이 날것으로 나오므로
 * 이름을 글자로 적는다 — 이 게임의 회전판만 그렇다.
 */
export function board(names: readonly string[], at: number): string {
  const shown = Math.min(WINDOW, names.length);
  if (shown === 0) return "```\n(비어 있음)\n```";

  const center = Math.floor(shown / 2);

  const lines = Array.from({ length: shown }, (_, offset) => {
    const index = (((at - center + offset) % names.length) + names.length) % names.length;
    const name = names[index] ?? "@?";

    return offset === center ? `> ${name} <` : `  ${name}`;
  });

  return ["```", ...lines, "```"].join("\n");
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
    const names = await namesOf(context, seats);
    const draw = await painter(context);

    await draw(board(names, seatAt(0, seats.length, winner)));

    for (let frame = 1; frame <= SPIN_FRAMES; frame += 1) {
      await wait(frameDelay(frame - 1));
      // 도는 동안 「종료」가 눌렸을 수 있다. 끝난 판의 화면을 덮어쓰면 안 된다.
      if (!context.alive()) return;

      await draw(board(names, seatAt(frame, seats.length, winner)));
    }

    await wait(LAND_PAUSE_MS);
    if (!context.alive()) return;

    await context.end({ description: speak(`<@${seats[winner]}> 님이 당첨되셨습니다.`) });
  },
});

/**
 * 회전판에 적을 이름들. 자리 차례 그대로 돌려준다.
 *
 * **한 번만** 모은다 — 칸마다 다시 물으면 회전 내내 서버에 사람을 캐묻는 셈이다.
 * 못 찾은 사람(도중에 나갔다든지)은 이름 자리를 비워 두지 않고 물음표로 채운다.
 * 자리 수가 어긋나면 화살표가 엉뚱한 줄을 가리킨다.
 */
async function namesOf(context: GameContext, seats: readonly string[]): Promise<string[]> {
  return Promise.all(
    seats.map(async (userId) => {
      const member = await context.channel.guild.members.fetch(userId).catch(() => null);
      if (member !== null) return label(member.displayName);

      const user = await context.client.users.fetch(userId).catch(() => null);
      return user === null ? "@?" : label(user.displayName);
    }),
  );
}

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
