import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { MessageActionRowComponentBuilder, User } from "discord.js";

import { count } from "../info/format.js";
import { atWithCountdown } from "../time.js";
import type { MessageOptions, ResponseField } from "../ui/response.js";
import { customId } from "../types.js";
import { ACTION, GAME, MAX_SHOWN_PLAYERS } from "./ids.js";
import type { GameDefinition, GameResult, GameSession } from "./types.js";
import { minPlayersOf, seatsOf, sessionTitle } from "./types.js";
import { speak } from "../ui/tone.js";

/**
 * 미니게임 화면.
 *
 * 색은 판이 어디까지 왔는지를 **한눈에** 갈라 준다 —
 *
 *   모집 중 · 진행 중 → **노랑**  아직 도는 중이다.
 *   끝               → **파랑**  아무도 요청하지 않은 순간에 나가는 **알림**이다.
 *                                효과의 종료 안내가 파랑인 것과 같은 이유다.
 *   취소             → **노랑**  판이 굴러가지도 못하고 접혔다.
 *   열지 못함         → **빨강**
 *
 * 「끝」을 초록으로 두면 안 된다. 초록은 **요청한 일이 끝났을 때**의 색이다.
 * 게임 결과는 타이머나 남의 채팅이 끌어낸 것이라 요청한 사람이 없다.
 *
 * 그러면 진행 중(노랑)과 끝(파랑)이 색으로 갈라진다 — 판이 도는지 끝났는지를
 * 글자를 읽지 않고도 알 수 있다.
 *
 * 게임이 직접 화면을 만들지 않고 내용과 결과만 넘기게 해서, 게임을 몇 개를 붙이든
 * 형식이 갈라지지 않게 한다.
 */

/** 참가자 멘션. 많으면 앞에서부터 몇 명만 적고 나머지는 수로. */
function playerList(players: readonly string[]): string {
  if (players.length === 0) return "아직 없음";

  const shown = players.slice(0, MAX_SHOWN_PLAYERS).map((id) => `<@${id}>`);
  if (players.length > MAX_SHOWN_PLAYERS) shown.push(`_외 ${players.length - MAX_SHOWN_PLAYERS}명_`);

  return shown.join(" ");
}

/** `**3명** (최소 2명 · 최대 6명)` — 최대가 없으면 그렇게 적는다. */
function headcount(game: GameDefinition, session: GameSession): string {
  const max = seatsOf(game, session);
  const limits = [`최소 **${minPlayersOf(game)}명**`, max === null ? "최대 없음" : `최대 **${max}명**`];

  return `**${count(session.players.length)}명** _(${limits.join(" · ")})_`;
}

/**
 * 화면에 적을 내용.
 *
 * 게임이 **지금 만들어 주는 것**이 가장 앞이다 (국민투표의 공약 목록처럼 도는 동안 바뀌는 것).
 * 없으면 판을 열 때 준 것, 그것도 없으면 게임 설명.
 */
function body(game: GameDefinition, session: GameSession): string {
  return game.body?.(session) ?? session.body ?? game.description;
}

/** 마감·종료 시각. 없으면 칸을 만들지 않는다. */
function deadline(session: GameSession, name: string): ResponseField[] {
  return session.closesAt === null
    ? []
    : [{ name, value: atWithCountdown(new Date(session.closesAt)) }];
}

/**
 * 판을 끝내는 버튼 — **제목 오른쪽 위**에 붙는다.
 *
 * 도는 판(모집 중 · 진행 중)에는 언제나 있다. 게임마다 자기 버튼이 몇 개든, 판을 멈추는
 * 자리는 늘 같은 곳에 있어야 찾는다. 액션 로우에 두면 게임 버튼에 밀려 자리가 옮겨 다닌다.
 *
 * 누를 수 있는 사람은 **판을 연 사람과 관리자**뿐이다. 그 판단은 버튼을 받는
 * [핸들러](../components/game.ts)가 한다 — 디스코드에는 버튼을 사람마다 숨기는 방법이 없다.
 */
function stopButton(session: GameSession): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(customId(GAME, ACTION.stop, session.id))
    .setLabel("종료")
    .setStyle(ButtonStyle.Danger);
}

function recruitRows(session: GameSession): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(customId(GAME, ACTION.join, session.id))
        .setLabel("참가")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(customId(GAME, ACTION.leave, session.id))
        .setLabel("나가기")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(customId(GAME, ACTION.start, session.id))
        .setLabel("시작")
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

/** 모집 중인 판. 사람이 들고 날 때마다 이 화면을 다시 그린다. */
export function recruitView(
  game: GameDefinition,
  session: GameSession,
  host: User,
): MessageOptions {
  return {
    status: "progress",
    title: `${sessionTitle(game, session)} — 모집 중`,
    description: body(game, session),
    fields: [
      { name: "인원", value: headcount(game, session) },
      ...deadline(session, "마감"),
      { name: "참가한 사람", value: playerList(session.players) },
      ...(game.fields?.(session) ?? []),
    ],
    accessoryButton: stopButton(session),
    rows: recruitRows(session),
    user: host,
    ephemeral: false,
  };
}

/**
 * 판이 시작됐다. 모집 패널을 이걸로 갈아 끼우고, 즉시 시작 게임은 이게 첫 화면이다.
 *
 * **골격은 참가자를 적지 않는다.** 모으는 동안에는 누가 들어왔는지가 곧 정보지만, 시작하고
 * 나면 볼 것은 판 자체다 — 룰렛은 회전판이, 국민투표는 후보 버튼이 이미 그 사람들을 보여
 * 준다. 같은 이름을 위에 한 번 더 늘어놓으면 정작 봐야 할 것이 아래로 밀린다.
 *
 * 판만 보고는 누가 들어와 있는지 알 수 없는 게임은 **스스로 적는다** (`fields`) —
 * 찍기대작전처럼 버튼이 사람이 아니라 숫자인 것.
 */
export function startedView(
  game: GameDefinition,
  session: GameSession,
  host: User,
): MessageOptions {
  return {
    status: "progress",
    title: `${sessionTitle(game, session)} — 시작`,
    description: body(game, session),
    // 게임이 덧붙이는 칸은 골격이 적는 것 뒤다 — 언제 끝나는지가 먼저다.
    fields: [...deadline(session, "종료"), ...(game.fields?.(session) ?? [])],
    accessoryButton: stopButton(session),
    // 버튼으로 겨루는 게임(선착순 같은)은 여기에 자기 버튼을 싣는다.
    rows: game.buttons?.(session) ?? [],
    user: host,
    ephemeral: false,
  };
}

/**
 * 게임이 끝났다. 결과 내용은 게임이 준 것을 그대로 쓴다.
 *
 * 이 화면은 **판을 연 메시지에 답장**으로 달린다 — 효과의 종료 안내와 같은 자리다.
 * 새 메시지로만 던지면 무엇에 대한 결과인지 스크롤을 올려 찾아야 한다.
 *
 * **참가자는 적지 않는다.** 답장이 달리는 그 메시지가 바로 위에서 이미 누가 있었는지
 * 보여 주고 있고, 결과는 누가 이겼는지를 말한다. 그 사이에 명단을 한 번 더 끼우면
 * 정작 봐야 할 한 줄이 밀린다 — [결과만 적는다](../ui/response.ts)는 규칙 그대로다.
 */
export function endedView(
  game: GameDefinition,
  session: GameSession,
  host: User,
  result: GameResult | undefined,
  /** 「종료」 를 누른 사람. 기간이 다 돼서 끝났으면 없다. */
  stoppedById?: string,
): MessageOptions {
  const fields: ResponseField[] = [...(result?.fields ?? [])];

  // 맨 끝에 붙인다 — 게임의 결과가 먼저고, 왜 여기서 멎었는지가 그 다음이다.
  if (stoppedById !== undefined) {
    fields.push({ name: "끝낸 사람", value: `<@${stoppedById}>` });
  }

  return {
    // 파랑(알림)이 기본. 게임이 실패로 끝났을 때만 그 색을 준다.
    status: result?.status ?? "info",
    title: `${sessionTitle(game, session)} — 끝`,
    description: result?.description,
    fields,
    user: host,
    ephemeral: false,
  };
}

/** 취소된 판 — 사람이 접었거나, 5분이 지났거나, 봇이 꺼졌거나. */
export function cancelledView(
  game: GameDefinition,
  session: GameSession,
  host: User,
  reason: string,
): MessageOptions {
  return {
    status: "progress",
    title: `${sessionTitle(game, session)} — 취소`,
    description: reason,
    fields: session.phase === "recruiting" ? [{ name: "인원", value: headcount(game, session) }] : [],
    user: host,
    ephemeral: false,
  };
}

/**
 * 이 채널에 이미 판이 돌고 있어서 열지 못했다.
 *
 * **막혔다고만 말하면 막힌 사람이 할 수 있는 일이 없다.** 그래서 둘을 준다 —
 *
 *   · 도는 판으로 **바로 가는 링크** (거기서 무슨 판인지 보고 기다리든 끝내든 한다)
 *   · **접고 대신 시작**하는 버튼 (그 판을 끝낼 수 있는 사람에게만)
 *
 * 끝낼 수 있는 사람은 [종료 버튼](../components/game.ts)과 같다 — 그 판을 연 사람과
 * 관리자. 지나가던 사람이 남의 판을 명령 한 번으로 밀어낼 수는 없다.
 */
export function busyView(
  running: GameSession,
  runningGame: GameDefinition | undefined,
  user: User,
  options: { readonly link: string | null; readonly takeoverId: string | null },
): MessageOptions {
  const name = runningGame === undefined ? "판" : sessionTitle(runningGame, running);

  return {
    status: "failure",
    title: speak("이미 판이 돌고 있어요"),
    description: speak(`이 채널에서는 **${name}** 이(가) 돌고 있습니다.`),
    fields: [
      { name: "연 사람", value: `<@${running.hostId}>` },
      ...(running.closesAt === null
        ? []
        : [{ name: running.phase === "recruiting" ? "모집 마감" : "종료", value: atWithCountdown(new Date(running.closesAt)) }]),
    ],
    rows: busyRows(options.link, options.takeoverId),
    user,
  };
}

/**
 * 막힌 안내에 붙는 줄 — [바로 가기] [접고 시작]
 *
 * 링크 버튼은 customId 를 갖지 않는다 (디스코드가 그렇게 정했다). 그래서 눌러도
 * 인터랙션이 오지 않고, 봇이 꺼져 있어도 열린다.
 */
function busyRows(
  link: string | null,
  takeoverId: string | null,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const buttons: ButtonBuilder[] = [];

  if (link !== null) {
    buttons.push(new ButtonBuilder().setURL(link).setLabel("바로 가기").setStyle(ButtonStyle.Link));
  }

  if (takeoverId !== null) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(customId(GAME, ACTION.takeover, takeoverId))
        .setLabel("접고 시작")
        .setStyle(ButtonStyle.Danger),
    );
  }

  return buttons.length === 0
    ? []
    : [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons)];
}

/** 판을 열지 못했을 때. 참가·시작이 막혔을 때도 같은 모양을 쓴다. */
export function refusedView(title: string, description: string, user: User): MessageOptions {
  return { status: "failure", title, description, user };
}

/** 짧은 알림 — 참가했다 · 나갔다처럼 누른 사람에게만 보이는 것. */
export function noticeView(title: string, description: string, user: User): MessageOptions {
  return { status: "success", title, description, user };
}
