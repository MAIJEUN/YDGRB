import { count } from "../../info/format.js";
import { speak } from "../../ui/tone.js";
import { defineGame } from "../types.js";

/**
 * 탕수육 — **즉시 시작** 형식. 채팅으로 겨룬다.
 *
 * 판이 도는 채널에 **탕 → 수 → 육 → 탕 → …** 을 차례로 친다. 틀리게 친 사람이 진다.
 *
 * 규칙은 차례 하나다 — 다음에 나와야 할 글자만 맞고, 그 밖의 것은 전부 틀린 것이다.
 * 혼자 탕수육을 세 번 쳐도 된다.
 *
 * **번갈아**를 켜면 규칙이 하나 붙는다. 한 사람이 잇달아 칠 수 없다 — 맞는 글자라도
 * 그렇다. 판을 열 때 정하고 도중에 바뀌지 않는다.
 *
 * **그 채널에 올라오는 모든 메시지가 한 수다.** 「탕수육 하는 채널에서 딴 소리를 하면
 * 진다」 가 이 게임이라, 게임과 상관없는 말이라고 봐주면 게임이 아니게 된다. 판이 도는
 * 동안 그 채널은 탕수육 판이다.
 *
 * 시계는 걸지 않는다 — 기다리는 것이 시간이 아니라 사람이다. 아무도 안 치면 판은 그대로
 * 있고, 그만두려면 오른쪽 위 「종료」를 누른다.
 *
 * 판이 도는 동안의 상태(어디까지 왔나)는 **메모리에만** 둔다. 진행 중인 판은 어차피
 * 재시작을 견디지 않는다.
 */

export const TANGSUYUK = "tangsuyuk";

/** 돌아가는 차례. 이 순서가 곧 게임이다. */
export const STEPS = ["탕", "수", "육"] as const;

interface Chain {
  /** 다음에 나와야 하는 자리. 0이 탕이다. */
  step: number;
  /** 마지막으로 친 사람. 「번갈아」 를 켠 판에서는 이 사람이 잇달아 칠 수 없다. */
  last: string | null;
  /** 여기까지 이어 온 횟수. */
  moves: number;
  /** 한 사람이 잇달아 칠 수 없는가. 판을 열 때 정하고 도중에 바뀌지 않는다. */
  readonly alternate: boolean;
}

const chains = new Map<string, Chain>();

/** 판을 열 때 빈 사슬을 놓는다. 「번갈아」 는 **안 주면 꺼진 것**이다. */
export function keepChain(sessionId: string, alternate = false): void {
  chains.set(sessionId, { step: 0, last: null, moves: 0, alternate });
}

export function chainOf(sessionId: string): Chain | undefined {
  return chains.get(sessionId);
}

export function dropChain(sessionId: string): void {
  chains.delete(sessionId);
}

/** 다음에 나와야 하는 글자. */
export function nextOf(chain: Chain): string {
  return STEPS[chain.step % STEPS.length] ?? STEPS[0];
}

export type Move =
  | { readonly ok: true; readonly moves: number }
  | {
      readonly ok: false;
      readonly reason: "gone" | "wrong" | "twice";
      /** 쳐야 했던 글자. */
      readonly expected: string;
      /** 여기까지 이어 온 횟수. */
      readonly moves: number;
    };

/**
 * 한 수 둔다.
 *
 * **동기로 끝낸다.** 차례를 보는 것과 넘기는 것 사이에 await 가 끼면, 그 틈에 들어온
 * 다음 사람이 같은 차례를 가져간다.
 *
 * 틀린 글자를 먼저 본다. 잇달아 친 데다 글자까지 틀렸으면 **글자가 틀렸다**고 말하는
 * 편이 알아듣기 쉽다 — 「잇달아 쳤다」는 맞는 글자를 쳤을 때만, 그것도 「번갈아」 를 켠
 * 판에서만 나온다.
 */
export function play(sessionId: string, userId: string, text: string): Move {
  const chain = chains.get(sessionId);
  if (chain === undefined) {
    return { ok: false, reason: "gone", expected: STEPS[0], moves: 0 };
  }

  const expected = nextOf(chain);

  if (text.trim() !== expected) {
    return { ok: false, reason: "wrong", expected, moves: chain.moves };
  }
  if (chain.alternate && chain.last === userId) {
    return { ok: false, reason: "twice", expected, moves: chain.moves };
  }

  chain.step = (chain.step + 1) % STEPS.length;
  chain.last = userId;
  chain.moves += 1;

  return { ok: true, moves: chain.moves };
}

/**
 * 이 판의 이름 — 「번갈아」 를 켠 판만 그렇다고 적는다.
 *
 * 같은 `12번` 이라도 번갈아 친 판이 더 어렵다. 그게 제목에 없으면 결과만 남았을 때
 * 무슨 판이었는지 알 길이 없다.
 */
export function chainName(alternate: boolean): string | null {
  return alternate ? "탕수육 · 번갈아" : null;
}

/** 화면에 적을 두 줄 — 무엇을 치는지와, 무엇이 지는 것인지. */
export function chainBody(alternate: boolean): string {
  return [
    speak(`**${STEPS.join("** → **")}** 을 ${alternate ? "번갈아" : "차례로"} 칩니다.`),
    alternate ? speak("틀리게 치거나 잇달아 치면 집니다.") : speak("틀리게 치면 집니다."),
  ].join("\n");
}

/** 결과에 붙일 「이어 간 횟수」 칸. 이 판이 얼마나 갔는지가 곧 점수다. */
export function movesField(moves: number): { readonly name: string; readonly value: string }[] {
  return [{ name: "이어 간 횟수", value: `\`${count(moves)}번\`` }];
}

export default defineGame({
  id: TANGSUYUK,
  name: "탕수육",
  // 판마다 다르므로 커맨드가 `body` 로 넘긴다. 이건 그것이 없을 때의 자리다.
  description: chainBody(false),
  mode: "instant",

  start(context) {
    // 사슬은 판을 열 때 놓여 있다. 여기서 따로 할 일이 없다.
    if (!chains.has(context.session.id)) {
      void context.end({ status: "failure", description: speak("판을 잃어버렸습니다.") });
    }
  },

  /**
   * 그 채널에 올라온 메시지 하나가 한 수다.
   *
   * 맞으면 조용히 넘어간다 — 한 수마다 봇이 끼어들면 판이 봇 메시지로 덮이고, 판 화면을
   * 고치면 여럿이 몰릴 때 편집 제한에 걸린다. 사람들이 보는 것은 채널의 그 줄들이다.
   */
  async onMessage(context, message) {
    const result = play(context.session.id, message.author.id, message.content);

    if (result.ok) {
      await context.join(message.author.id);
      return;
    }
    if (result.reason === "gone") return;

    dropChain(context.session.id);

    await context.end({
      description: [
        speak(`<@${message.author.id}> 님이 졌습니다.`),
        result.reason === "twice"
          ? speak("한 사람이 잇달아 칠 수는 없습니다.")
          : speak(`**${result.expected}** 차례였습니다.`),
      ].join(" "),
      fields: movesField(result.moves),
    });
  },

  /**
   * 「종료」로 접혔다. 시계가 없으니 이 길로만 들어온다.
   *
   * 진 사람 없이 멎은 것이라 노랑이다 — 온전히 끝나지 못했다.
   */
  async onTimeout(context) {
    const chain = chains.get(context.session.id);
    const moves = chain?.moves ?? 0;
    dropChain(context.session.id);

    await context.end({
      status: "progress",
      description: speak("아무도 지지 않고 판이 끝났습니다."),
      fields: movesField(moves),
    });
  },
});
