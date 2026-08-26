import type { Client, GuildTextBasedChannel, Message, User } from "discord.js";

import { logger } from "../logger.js";
import { announceAt } from "../ui/end-notice.js";
import { channelMessage, messageEdit } from "../ui/response.js";
import type { MessageOptions } from "../ui/response.js";
import { RECRUIT_TIMEOUT_SECONDS } from "./ids.js";
import { getGame } from "./registry.js";
import { cancelClose, scheduleClose } from "./scheduler.js";
import {
  addPlayer,
  advance,
  allSessions,
  attachMessage,
  dropSession,
  getSession,
  newSessionId,
  openSession,
  removePlayer,
} from "./store.js";
import type { GameContext, GameDefinition, GameResult, GameSession } from "./types.js";
import { minPlayersOf, seatsOf } from "./types.js";
import { cancelledView, endedView, recruitView, startedView } from "./views.js";
import { speak } from "../ui/tone.js";

/**
 * 판 하나의 일생.
 *
 *   열기 → (모집 → 시작) → 진행 → 끝
 *            └ 5분 지남 · 주최자가 접음 → 취소
 *
 * 게임 파일은 `start()` 안쪽만 신경 쓰면 된다. 사람을 세고 · 화면을 갈아 끼우고 ·
 * 시계를 재고 · 재시작을 견디는 일은 전부 여기서 한다.
 */

export interface OpenOptions {
  /** 판 제목. 모든 게임에 있는 선택 칸. */
  readonly title?: string | null;
  /** 이 판에서 쓸 게임 이름 (「선착순 3명」). 없으면 게임에 적힌 이름. */
  readonly name?: string | null;
  /** 이 판만의 정원 (룰렛의 「참가 인원」). 없으면 게임에 적힌 것. */
  readonly maxPlayers?: number | null;
  /** 화면 내용 (퀴즈의 문제 같은 것). 없으면 게임 설명. */
  readonly body?: string | null;
  /** 즉시 시작 게임의 진행 시간. 다 되면 `onTimeout` 이 불린다. */
  readonly durationSeconds?: number | null;
  /**
   * 판 id 가 정해진 **직후, 화면을 만들기 전에** 불린다.
   *
   * 퀴즈의 정답이나 선착순의 목표처럼 게임이 판마다 들고 있어야 하는 것을 맡기는 자리다.
   * 화면을 만든 뒤에 맡기면 첫 화면이 그것을 모른 채 그려지고(선착순은 버튼이 빠진다),
   * 시작한 뒤에 맡기면 그 사이에 들어온 답을 놓친다.
   */
  readonly prepare?: (sessionId: string) => void;
}

export type OpenResult =
  | { readonly ok: true; readonly session: GameSession; readonly view: MessageOptions }
  | { readonly ok: false; readonly running: GameSession };

/**
 * 판을 연다. 화면은 **돌려주기만** 한다 — 부르는 쪽이 커맨드 응답으로 띄우고,
 * 그 메시지를 [attach] 로 넘겨 준다. 그래야 판이 메시지 하나로 시작한다.
 */
export async function openGame(
  game: GameDefinition,
  guildId: string,
  channelId: string,
  host: User,
  options: OpenOptions = {},
): Promise<OpenResult> {
  const recruiting = game.mode === "recruit";
  const duration = options.durationSeconds ?? null;

  const session: GameSession = {
    id: newSessionId(),
    gameId: game.id,
    guildId,
    channelId,
    title: options.title ?? null,
    name: options.name ?? null,
    body: options.body ?? null,
    maxPlayers: options.maxPlayers ?? null,
    messageId: null,
    hostId: host.id,
    // **아무도 자동으로 들어가지 않는다.** 판을 연 것과 그 판을 하겠다는 것은 다른 일이라,
    // 남을 위해 열어 주는 경우(관리자가 판만 깔아 두는 것)에 연 사람이 참가자로 세어지면
    // 인원도 결과도 어긋난다. 연 사람도 하려면 「참가」를 누른다.
    players: [],
    phase: recruiting ? "recruiting" : "playing",
    openedAt: Date.now(),
    // 모집 게임은 언제 시작될지 모른다. 기간을 들고 있다가 **시작하는 순간** 시계를 건다.
    playSeconds: duration,
    closesAt: recruiting
      ? Date.now() + RECRUIT_TIMEOUT_SECONDS * 1000
      : duration === null
        ? null
        : Date.now() + duration * 1000,
  };

  const opened = await openSession(session);
  if (!opened.ok) return { ok: false, running: opened.running };

  options.prepare?.(session.id);

  return {
    ok: true,
    session,
    view: recruiting ? recruitView(game, session, host) : startedView(game, session, host),
  };
}

/** 판을 띄운 메시지를 붙인다. 여기서부터 시계가 돈다. */
export async function attach(
  client: Client,
  game: GameDefinition,
  session: GameSession,
  message: Message,
  host: User,
): Promise<void> {
  await attachMessage(session.guildId, session.id, message.id);
  const withMessage: GameSession = { ...session, messageId: message.id };

  if (session.phase === "playing") {
    await beginPlay(client, game, withMessage, host);
    return;
  }

  armClock(client, withMessage, host);
}

/**
 * 시계를 건다.
 *
 * 모집 중이면 5분 뒤 **취소**, 진행 중이면 기간이 다 됐을 때 `onTimeout`.
 */
function armClock(client: Client, session: GameSession, host: User): void {
  if (session.closesAt === null) return;

  scheduleClose(session.guildId, session.id, session.closesAt, () => {
    void (session.phase === "recruiting"
      ? expireRecruiting(client, session.guildId, session.id, host)
      : finishPlay(client, session.guildId, session.id, host));
  });
}

// ─────────────────────────────────────────────────────────────
// 모집
// ─────────────────────────────────────────────────────────────

export type JoinOutcome =
  | { readonly ok: true; readonly session: GameSession; readonly full: boolean }
  | { readonly ok: false; readonly reason: "gone" | "closed" | "already" | "full" };

export async function join(
  guildId: string,
  sessionId: string,
  userId: string,
): Promise<JoinOutcome> {
  const session = await getSession(guildId, sessionId);
  if (session === undefined) return { ok: false, reason: "gone" };
  if (session.phase !== "recruiting") return { ok: false, reason: "closed" };

  const game = getGame(session.gameId);
  if (game === undefined) return { ok: false, reason: "gone" };

  const seats = seatsOf(game, session);

  const result = await addPlayer(guildId, sessionId, userId, seats);
  if (!result.ok) return result;

  // 다 찼으면 기다릴 이유가 없다 — 부르는 쪽이 바로 시작시킨다.
  return {
    ok: true,
    session: result.session,
    full: seats !== null && result.session.players.length >= seats,
  };
}

export async function leave(guildId: string, sessionId: string, userId: string) {
  return removePlayer(guildId, sessionId, userId);
}

/**
 * 모집 시간이 다 됐다 — **취소한다.**
 *
 * 인원이 찼더라도 시작하지 않는다. 형식이 「5분 안에 시작되지 않으면 취소」라고 정했고,
 * 시작하는 것은 사람이 하는 일이다.
 */
export async function expireRecruiting(
  client: Client,
  guildId: string,
  sessionId: string,
  host: User,
  reason = speak("5분 안에 시작되지 않아 판을 접었습니다."),
): Promise<void> {
  const session = await getSession(guildId, sessionId);
  if (session === undefined || session.phase !== "recruiting") return;

  cancelClose(guildId, sessionId);

  // 단계를 먼저 옮겨 둔다 — 마감 타이머와 「접기」 버튼이 겹쳐도 한 번만 처리되게.
  const closed = await advance(guildId, sessionId, "recruiting", "ended");
  if (closed === undefined) return;

  const game = getGame(session.gameId);
  if (game !== undefined) {
    await replaceMessage(client, closed, cancelledView(game, closed, host, reason));
  }

  await dropSession(guildId, sessionId);
}

/** 지금 시작한다. 인원이 모자라면 아무것도 하지 않고 false. */
export async function startNow(
  client: Client,
  guildId: string,
  sessionId: string,
  host: User,
): Promise<boolean> {
  const session = await getSession(guildId, sessionId);
  if (session === undefined || session.phase !== "recruiting") return false;

  const game = getGame(session.gameId);
  if (game === undefined) return false;
  if (session.players.length < minPlayersOf(game)) return false;

  cancelClose(guildId, sessionId);

  // 모집이 끝났으니 이제부터가 판이 도는 시간이다.
  const closesAt = session.playSeconds === null ? null : Date.now() + session.playSeconds * 1000;

  const playing = await advance(guildId, sessionId, "recruiting", "playing", closesAt);
  if (playing === undefined) return false;

  await replaceMessage(client, playing, startedView(game, playing, host));
  await beginPlay(client, game, playing, host);

  return true;
}

/** 주최자가 접었다. 예전 「접기」 버튼이 남은 패널이 아직 이걸 부른다. */
export async function cancel(
  client: Client,
  guildId: string,
  sessionId: string,
  host: User,
): Promise<boolean> {
  const session = await getSession(guildId, sessionId);
  if (session === undefined || session.phase !== "recruiting") return false;

  await expireRecruiting(client, guildId, sessionId, host, speak("주최자가 판을 접었습니다."));
  return true;
}

/**
 * 사람이 판을 끝냈다 — 화면 오른쪽 위의 「종료」.
 *
 * 어느 단계든 같은 버튼이지만 끝나는 모양은 다르다.
 *
 *   모집 중 → **취소**. 굴러가지도 못했으니 결과랄 것이 없다.
 *   진행 중 → **끝**. 기간이 다 됐을 때와 같은 자리로 보낸다 — 게임이 스스로 마무리해야
 *             퀴즈는 정답을 밝히고 선착순은 아무도 못 채웠다고 말할 수 있다.
 *             골격이 임의로 끊으면 그 판이 무엇이었는지 아무도 모르게 끝난다.
 *
 * 누가 끝냈는지는 `end()` 가 결과에 덧붙인다.
 */
export async function stopGame(
  client: Client,
  guildId: string,
  sessionId: string,
  host: User,
  byId: string,
): Promise<boolean> {
  const session = await getSession(guildId, sessionId);
  if (session === undefined) return false;

  if (session.phase === "recruiting") {
    await expireRecruiting(client, guildId, sessionId, host, speak(`<@${byId}> 님이 판을 접었습니다.`));
    return true;
  }

  if (session.phase !== "playing") return false;

  stoppedBy.set(sessionId, byId);
  try {
    await finishPlay(client, guildId, sessionId, host);
  } finally {
    stoppedBy.delete(sessionId);
  }

  return true;
}

/** 모집 패널을 다시 그린다 — 사람이 들고 날 때마다. */
export async function refreshPanel(
  client: Client,
  session: GameSession,
  host: User,
): Promise<void> {
  const game = getGame(session.gameId);
  if (game === undefined || session.phase !== "recruiting") return;

  await replaceMessage(client, session, recruitView(game, session, host));
}

// ─────────────────────────────────────────────────────────────
// 진행
// ─────────────────────────────────────────────────────────────

/**
 * 지금 돌고 있는 판들.
 *
 * 채팅으로 겨루는 게임(`onMessage`)에 메시지를 넘기려면 살아 있는 문맥이 있어야 한다.
 * 진행 중인 판은 재시작을 견디지 않으므로 메모리에만 둔다.
 */
const live = new Map<string, { readonly game: GameDefinition; readonly context: GameContext }>();

/** 두 번 끝나지 않게 하는 표식. 게임이 여러 갈래로 끝나도 한 번만 정리된다. */
const finished = new Set<string>();

/**
 * 사람이 끝낸 판 — 「끝낸 사람」을 결과에 덧붙이려고 잠깐 들고 있는다.
 *
 * 게임이 스스로 `context.end(결과)` 를 부르기 때문에 그 결과에 직접 끼워 넣을 자리가 없다.
 * 판 id 로 여기 적어 두면 `end()` 가 마지막에 붙인다.
 */
const stoppedBy = new Map<string, string>();

async function beginPlay(
  client: Client,
  game: GameDefinition,
  session: GameSession,
  host: User,
): Promise<void> {
  const channel = await fetchChannel(client, session.channelId);
  if (channel === null) {
    logger.warn(`게임: 채널을 찾지 못해 판을 접습니다 (${session.id})`);
    await dropSession(session.guildId, session.id);
    return;
  }

  const context: GameContext = {
    client,
    session,
    channel,
    host,
    join: async (userId) => {
      const result = await addPlayer(session.guildId, session.id, userId, seatsOf(game, session));
      if (result.ok) session.players = [...result.session.players];
      return result.ok;
    },
    alive: () => live.has(session.id),
    end: async (result) => {
      await end(client, game, session, host, result);
    },
  };

  live.set(session.id, { game, context });
  armClock(client, session, host);

  try {
    await game.start(context);
  } catch (error) {
    logger.error(`게임 ${game.id} 진행 중 오류 (${session.id})`, error);
    await end(client, game, session, host, {
      status: "failure",
      description: speak("게임이 끝까지 돌지 못했습니다."),
    });
  }
}

/**
 * 판을 마무리한다. 게임이 마무리를 맡지 않으면 그냥 끝낸다.
 *
 * 기간이 다 됐을 때와 사람이 「종료」 를 눌렀을 때가 **같은 자리**로 온다 —
 * 어느 쪽이든 판은 다 돌지 못하고 멎는 것이고, 그 뒷정리는 게임만 할 수 있다.
 */
async function finishPlay(
  client: Client,
  guildId: string,
  sessionId: string,
  host: User,
): Promise<void> {
  const running = live.get(sessionId);
  if (running === undefined) return;

  try {
    if (running.game.onTimeout === undefined) await running.context.end();
    else await running.game.onTimeout(running.context);
  } catch (error) {
    logger.error(`게임 ${running.game.id} 마무리 중 오류 (${sessionId})`, error);
    await running.context.end({ status: "failure", description: speak("게임이 끝까지 돌지 못했습니다.") });
  }

  // 게임이 end() 를 잊었을 수도 있다. 판을 남겨 두면 그 채널이 영영 막힌다.
  if (live.has(sessionId)) {
    const session = await getSession(guildId, sessionId);
    if (session !== undefined) await end(client, running.game, session, host, undefined);
  }
}

/**
 * 돌고 있는 판을 집는다. 버튼으로 겨루는 게임이 자기 핸들러에서 쓴다.
 *
 * 진행 중인 판은 재시작을 견디지 않으므로, 없으면 이미 끝난 판이다.
 */
export function liveGame(
  sessionId: string,
): { readonly game: GameDefinition; readonly context: GameContext } | undefined {
  return live.get(sessionId);
}

/**
 * 그 채널에서 돌고 있는 판에 메시지를 넘긴다.
 *
 * 저장소를 뒤지지 않는다 — 살아 있는 판은 메모리에 있고, 메시지마다 파일을 읽을 수는 없다.
 */
export async function handleGameMessage(message: Message<true>): Promise<void> {
  for (const { game, context } of live.values()) {
    if (game.onMessage === undefined) continue;
    if (context.session.channelId !== message.channelId) continue;
    if (context.session.guildId !== message.guildId) continue;

    try {
      await game.onMessage(context, message);
    } catch (error) {
      logger.error(`게임 ${game.id} 메시지 처리 중 오류 (${context.session.id})`, error);
    }
    return;
  }
}

async function end(
  client: Client,
  game: GameDefinition,
  session: GameSession,
  host: User,
  result: GameResult | undefined,
): Promise<void> {
  if (finished.has(session.id)) return;
  finished.add(session.id);

  cancelClose(session.guildId, session.id);
  live.delete(session.id);

  try {
    const ended = (await advance(session.guildId, session.id, "playing", "ended")) ?? session;

    // 결과는 **판을 연 메시지에 답장**으로 단다 — 효과의 종료 안내와 같은 자리다.
    // 위쪽 시작 안내를 고치기만 하면 한참 위라 아무도 못 보고, 그냥 새 메시지로 던지면
    // 무엇에 대한 결과인지 스크롤을 올려 찾아야 한다. 답장은 둘 다 해결한다.
    await announceAt(
      client,
      { channelId: session.channelId, messageId: session.messageId },
      // 게임이 뭐라고 끝맺었든, 사람이 끊은 판이면 누가 끊었는지는 남아야 한다.
      endedView(game, ended, host, result, stoppedBy.get(session.id)),
    );

    await dropSession(session.guildId, session.id);
  } catch (error) {
    logger.error(`게임 ${game.id} 마무리 실패 (${session.id})`, error);
  } finally {
    finished.delete(session.id);
  }
}

// ─────────────────────────────────────────────────────────────
// 재시작
// ─────────────────────────────────────────────────────────────

/**
 * 부팅 때 남아 있던 판을 정리한다.
 *
 * **모집 중**이던 판은 되살린다 — 채널에 남은 「참가」 버튼이 죽으면 안 되기 때문이다.
 * **진행 중**이던 판은 접는다. 게임 안쪽 상태(누가 뭘 냈는지, 몇 번째 차례인지)는
 * 게임마다 달라서 일반적으로 이어 붙일 수 없다. 되살리는 척하는 것보다 접고 알리는 게 낫다.
 */
export async function restoreGames(
  client: Client,
): Promise<{ restored: number; aborted: number }> {
  let restored = 0;
  let aborted = 0;

  for (const session of await allSessions()) {
    const host = await client.users.fetch(session.hostId).catch(() => client.user);
    if (host === null) continue;

    if (session.phase !== "recruiting") {
      await abort(client, session, speak("봇이 다시 켜지면서 중단되었습니다."), host);
      aborted += 1;
      continue;
    }

    if (session.closesAt === null || session.closesAt <= Date.now()) {
      // 꺼져 있는 동안 5분이 지났다.
      await expireRecruiting(
        client,
        session.guildId,
        session.id,
        host,
        speak("봇이 꺼져 있는 동안 모집 시간이 지났습니다."),
      );
    } else {
      armClock(client, session, host);
      restored += 1;
    }
  }

  return { restored, aborted };
}

async function abort(
  client: Client,
  session: GameSession,
  reason: string,
  host: User,
): Promise<void> {
  cancelClose(session.guildId, session.id);
  live.delete(session.id);

  const game = getGame(session.gameId);
  if (game !== undefined) {
    await replaceMessage(client, session, cancelledView(game, session, host, reason));
  }

  await dropSession(session.guildId, session.id);
}

// ─────────────────────────────────────────────────────────────
// 메시지
// ─────────────────────────────────────────────────────────────

async function fetchChannel(
  client: Client,
  channelId: string,
): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel === null || !channel.isTextBased() || channel.isDMBased()) return null;

  return channel;
}

/**
 * 판을 띄운 메시지를 갈아 끼운다.
 *
 * 메시지가 지워졌거나 봇이 못 고치면 채널에 그냥 남긴다 — 판이 어떻게 됐는지는
 * 어떻게든 알려야 한다.
 */
async function replaceMessage(
  client: Client,
  session: GameSession,
  view: MessageOptions,
): Promise<void> {
  const channel = await fetchChannel(client, session.channelId);
  if (channel === null) return;

  if (session.messageId !== null) {
    const message = await channel.messages.fetch(session.messageId).catch(() => null);

    if (message !== null) {
      const edited = await message.edit(messageEdit(view)).catch((error: unknown) => {
        logger.debug(`게임: 메시지를 고치지 못했습니다 (${session.id})`, error);
        return null;
      });
      if (edited !== null) return;
    }
  }

  await channel.send(channelMessage(view)).catch((error: unknown) => {
    logger.warn(`게임: 안내를 남기지 못했습니다 (${session.id})`, error);
  });
}
