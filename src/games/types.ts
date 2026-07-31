import type { Awaitable, Client, GuildTextBasedChannel, User } from "discord.js";

import type { ResponseField, Status } from "../ui/response.js";

/**
 * 미니게임의 뼈대.
 *
 * 게임은 두 가지뿐이고, 다른 점은 **참가자를 어떻게 모으느냐** 하나다.
 *
 *   recruit — 모집 패널을 띄우고 사람을 모은 뒤 시작한다.
 *             최소 인원을 채워야 하고, 최대 인원은 없을 수도 있다.
 *   instant — 명령을 치는 순간 시작한다. 모집이 없고, 참가는 게임을 하면서 일어난다
 *             (게임이 `context.join()` 으로 참가자를 기록한다).
 *
 * 그 뒤로는 전부 같다 — 판을 열고 · 사람을 세고 · 시작하고 · 끝내고 · 화면을 그리는 일은
 * 여기 골격이 맡는다. 게임 파일이 하는 일은 `start()` 안쪽뿐이다.
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
  /** 모집 패널이나 시작 안내 메시지. 보내고 나서 채운다. */
  messageId: string | null;
  /** 판을 연 사람. footer 와 「주최자만」 판단에 쓴다. */
  readonly hostId: string;
  players: string[];
  phase: Phase;
  readonly openedAt: number;
  /** 모집 마감 시각. 즉시 시작 게임은 null. */
  closesAt: number | null;
}

/** 게임이 끝나면서 남기는 것. 화면은 골격이 규칙대로 그린다. */
export interface GameResult {
  /** 안 적으면 초록(모든 작업 완료). 중간에 접혔으면 노랑을 준다. */
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
   * 짧은 ASCII 이름. 커맨드 옵션 값과 저장 파일에 쓰인다.
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
   * 모집 게임만. **null 이면 제한 없음** — 마감 시각까지 계속 받는다.
   * 안 적으면 무제한으로 본다.
   */
  readonly maxPlayers?: number | null;
  /** 모집 마감까지 몇 초. 안 적으면 기본값. */
  readonly recruitSeconds?: number;

  /**
   * 판이 시작될 때 불린다. 여기서부터는 게임이 알아서 한다.
   *
   * 끝나면 반드시 `context.end()` 를 불러야 판이 정리된다.
   * 던지면 골격이 잡아서 실패로 끝낸다.
   */
  start(context: GameContext): Awaitable<void>;
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
