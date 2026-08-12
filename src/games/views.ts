import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { MessageActionRowComponentBuilder, User } from "discord.js";

import { count } from "../info/format.js";
import { atWithCountdown } from "../time.js";
import type { MessageOptions, ResponseField } from "../ui/response.js";
import { customId } from "../types.js";
import { ACTION, GAME, MAX_SHOWN_PLAYERS } from "./ids.js";
import type { GameDefinition, GameResult, GameSession } from "./types.js";
import { maxPlayersOf, minPlayersOf, sessionTitle } from "./types.js";

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
  const max = maxPlayersOf(game);
  const limits = [`최소 **${minPlayersOf(game)}명**`, max === null ? "최대 없음" : `최대 **${max}명**`];

  return `**${count(session.players.length)}명** _(${limits.join(" · ")})_`;
}

/** 게임이 판마다 다른 내용을 줬으면 그것, 아니면 게임 설명. */
function body(game: GameDefinition, session: GameSession): string {
  return session.body ?? game.description;
}

/** 마감·종료 시각. 없으면 칸을 만들지 않는다. */
function deadline(session: GameSession, name: string): ResponseField[] {
  return session.closesAt === null
    ? []
    : [{ name, value: atWithCountdown(new Date(session.closesAt)) }];
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
      new ButtonBuilder()
        .setCustomId(customId(GAME, ACTION.cancel, session.id))
        .setLabel("접기")
        .setStyle(ButtonStyle.Danger),
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
    ],
    rows: recruitRows(session),
    user: host,
    ephemeral: false,
  };
}

/**
 * 판이 시작됐다. 모집 패널을 이걸로 갈아 끼우고, 즉시 시작 게임은 이게 첫 화면이다.
 *
 * 참가자 칸은 **모집 게임만** 둔다 — 즉시 시작은 하면서 들어오는 것이라, 시작하는 순간에
 * 늘어놓아 봐야 연 사람 하나뿐이다.
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
    fields: [
      ...deadline(session, "종료"),
      ...(game.mode === "recruit"
        ? [
            {
              name: `참가한 사람 (${count(session.players.length)}명)`,
              value: playerList(session.players),
            },
          ]
        : []),
    ],
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
 */
export function endedView(
  game: GameDefinition,
  session: GameSession,
  host: User,
  result: GameResult | undefined,
): MessageOptions {
  const fields: ResponseField[] = [...(result?.fields ?? [])];

  // 게임이 참가자를 따로 말하지 않았다면 여기서 한 번 적어 준다.
  if (fields.length === 0 && session.players.length > 0) {
    fields.push({
      name: `참가한 사람 (${count(session.players.length)}명)`,
      value: playerList(session.players),
    });
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

/** 판을 열지 못했을 때. 참가·시작이 막혔을 때도 같은 모양을 쓴다. */
export function refusedView(title: string, description: string, user: User): MessageOptions {
  return { status: "failure", title, description, user };
}

/** 짧은 알림 — 참가했다 · 나갔다처럼 누른 사람에게만 보이는 것. */
export function noticeView(title: string, description: string, user: User): MessageOptions {
  return { status: "success", title, description, user };
}
