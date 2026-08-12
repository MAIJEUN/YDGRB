import type {
  ActionRowBuilder,
  Awaitable,
  Client,
  GuildTextBasedChannel,
  Message,
  MessageActionRowComponentBuilder,
  User,
} from "discord.js";

import type { ResponseField, Status } from "../ui/response.js";

/**
 * 미니게임이 따라야 하는 **형식**.
 *
 * 게임마다 자기 명령을 갖는다 (`/퀴즈` 처럼). 다만 판을 굴리는 방식은 둘 중 하나여야 하고,
 * 그 둘의 다른 점은 **참가자를 어떻게 모으느냐** 하나뿐이다.
 *
 *   recruit — 모집 패널을 띄우고 사람을 모은다.
 *             · 최대 인원이 다 차면 **자동으로 시작**
 *             · 최소 인원만 넘으면 주최자·관리자가 「시작」 으로 먼저 시작
 *             · **5분** 안에 시작되지 않으면 판은 취소
 *             · 최대 인원은 없을 수도 있다
 *   instant — 명령을 치는 순간 시작한다. 모집이 없고, 참가는 게임을 하면서 일어난다.
 *
 * 그 뒤로는 전부 같다 — 판을 열고 · 사람을 세고 · 시작하고 · 끝내고 · 화면을 그리는 일은
 * 골격이 맡는다. 게임 파일이 하는 일은 `start()` 안쪽뿐이다.
 */

export type GameMode = "recruit" | "instant";

export type Phase = "recruiting" | "playing" | "ended";

/** 저장되는 판 하나. `data/games.json` 에 그대로 들어간다. */
export interface GameSession {
  readonly id: string;
  readonly gameId: string;
  readonly guildId: string;
  readonly channelId: string;
  /**
   * 판을 열면서 붙인 제목. 안 적었으면 null.
   *
   * 「보상은 소원권 1개」 처럼 이 판이 무엇인지 한 줄로 말하는 자리다.
   */
  readonly title: string | null;
  /**
   * 화면 내용. 게임이 판마다 다른 것을 보여 줄 때 쓴다 (퀴즈의 문제 같은 것).
   * 없으면 게임 설명을 쓴다.
   */
  readonly body: string | null;
  /** 모집 패널이나 시작 안내 메시지. 보내고 나서 채운다. */
  messageId: string | null;
  /** 판을 연 사람. footer 와 「주최자만」 판단에 쓴다. */
  readonly hostId: string;
  players: string[];
  phase: Phase;
  readonly openedAt: number;
  /**
   * 시계가 멎는 시각.
   *
   * 모집 중이면 **모집 마감**(지나면 취소), 진행 중이면 **판 종료 시각**이다.
   * 둘 다 없으면 null.
   */
  closesAt: number | null;
}

/** 게임이 끝나면서 남기는 것. 화면은 골격이 규칙대로 그린다. */
export interface GameResult {
  /** 안 적으면 초록(모든 작업 완료). 아무도 못 맞혔다거나 중간에 접혔으면 노랑을 준다. */
  readonly status?: Status;
  readonly description?: string;
  readonly fields?: readonly ResponseField[];
}

/** `start()` 에 넘어오는 것. 게임이 바깥과 이야기하는 통로다. */
export interface GameContext {
  readonly client: Client;
  readonly session: GameSession;
  readonly channel: GuildTextBasedChannel;
  /** 판을 연 사람. 화면 footer 에 쓴다. */
  readonly host: User;
  /**
   * 참가자를 늘린다. **즉시 시작** 게임이 쓴다 — 모집이 없으니 게임 도중에 들어온다.
   *
   * 이미 참가했거나 정원이 찼으면 false.
   */
  join(userId: string): Promise<boolean>;
  /**
   * 판을 끝낸다. 결과를 주면 채널에 남긴다.
   *
   * 두 번 불러도 한 번만 먹는다 — 게임이 여러 갈래로 끝나도 안전하게.
   */
  end(result?: GameResult): Promise<void>;
}

export interface GameDefinition {
  /**
   * 짧은 ASCII 이름. 저장 파일과 판 되짚기에 쓰인다.
   * 화면에 보이는 것은 `name` 이므로 여기는 바꾸지 않는 것이 좋다.
   */
  readonly id: string;
  /** 화면에 나오는 이름. 제목이 된다. */
  readonly name: string;
  readonly description: string;
  readonly mode: GameMode;

  /** 모집 게임만. 이만큼은 모여야 시작한다. 안 적으면 2명. */
  readonly minPlayers?: number;
  /**
   * 모집 게임만. **null 이면 제한 없음** — 마감까지 계속 받는다.
   * 안 적으면 무제한으로 본다. 다 차면 자동으로 시작한다.
   */
  readonly maxPlayers?: number | null;

  /**
   * 판이 시작될 때 불린다. 여기서부터는 게임이 알아서 한다.
   *
   * 끝나면 `context.end()` 를 부른다. 기간이 있는 게임은 골격이 `onTimeout` 으로
   * 불러 주므로 여기서 타이머를 따로 둘 필요가 없다.
   * 던지면 골격이 잡아서 실패로 끝낸다.
   */
  start(context: GameContext): Awaitable<void>;

  /**
   * 판 화면에 붙는 버튼. 선착순처럼 **버튼으로 겨루는** 게임이 쓴다.
   *
   * 판이 그려질 때마다 불리므로, 끝난 판에는 빈 배열을 돌려주면 버튼이 사라진다.
   */
  buttons?(session: GameSession): ActionRowBuilder<MessageActionRowComponentBuilder>[];

  /**
   * 판이 도는 동안 그 채널에 올라온 메시지. 퀴즈처럼 **채팅으로 겨루는** 게임이 쓴다.
   *
   * 봇 메시지와 다른 채널은 걸러서 온다.
   */
  onMessage?(context: GameContext, message: Message<true>): Awaitable<void>;

  /**
   * 기간이 다 됐을 때. 안 만들면 골격이 그냥 끝낸다.
   *
   * 기간은 판을 열 때 `durationSeconds` 로 준다.
   */
  onTimeout?(context: GameContext): Awaitable<void>;
}

export function defineGame(game: GameDefinition): GameDefinition {
  return game;
}

/**
 * 화면에 나갈 제목.
 *
 * 제목을 적었으면 **「<제목> (<게임 이름>)」**, 안 적었으면 게임 이름 그대로.
 * 어느 게임인지는 언제나 보여야 하므로 게임 이름을 떼지 않는다.
 */
export function sessionTitle(game: GameDefinition, session: GameSession): string {
  const title = session.title?.trim() ?? "";
  return title === "" ? game.name : `${title} (${game.name})`;
}

/** 최소 인원 — 적지 않았으면 둘. 혼자 하는 게임은 즉시 시작 쪽이 맞다. */
export function minPlayersOf(game: GameDefinition): number {
  return game.minPlayers ?? 2;
}

/** 최대 인원 — 적지 않았거나 null 이면 제한 없음. */
export function maxPlayersOf(game: GameDefinition): number | null {
  return game.maxPlayers ?? null;
}
