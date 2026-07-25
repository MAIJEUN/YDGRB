import type {
  AutocompleteInteraction,
  Awaitable,
  ChatInputCommandInteraction,
  ClientEvents,
  Collection,
  ContextMenuCommandBuilder,
  MessageComponentInteraction,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  UserContextMenuCommandInteraction,
} from "discord.js";

// ─────────────────────────────────────────────────────────────
// 커맨드
// ─────────────────────────────────────────────────────────────

/**
 * SlashCommandBuilder 는 `.addIntegerOption()` / `.addSubcommand()` 를 붙이면
 * 반환 타입이 좁아진다. 세 형태를 모두 받아준다.
 */
export type SlashCommandData =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

/** `/이름` 으로 실행하는 일반 슬래시 커맨드. */
export interface ChatInputCommand {
  readonly kind: "chatInput";
  readonly data: SlashCommandData;
  execute(interaction: ChatInputCommandInteraction): Awaitable<void>;
  /** 옵션에 `.setAutocomplete(true)` 를 붙였을 때만 구현한다. */
  autocomplete?(interaction: AutocompleteInteraction): Awaitable<void>;
}

/** 유저 우클릭 > 앱 메뉴에 뜨는 커맨드. */
export interface UserContextMenuCommand {
  readonly kind: "userContextMenu";
  readonly data: ContextMenuCommandBuilder;
  execute(interaction: UserContextMenuCommandInteraction): Awaitable<void>;
}

/** 메시지 우클릭 > 앱 메뉴에 뜨는 커맨드. */
export interface MessageContextMenuCommand {
  readonly kind: "messageContextMenu";
  readonly data: ContextMenuCommandBuilder;
  execute(interaction: MessageContextMenuCommandInteraction): Awaitable<void>;
}

export type ContextMenuCommand = MessageContextMenuCommand | UserContextMenuCommand;

export type Command = ChatInputCommand | ContextMenuCommand;

/** 커맨드 파일에서 `export default defineCommand({...})` 로 쓴다. */
export function defineCommand(command: Omit<ChatInputCommand, "kind">): ChatInputCommand {
  return { kind: "chatInput", ...command };
}

export function defineUserContextMenuCommand(
  command: Omit<UserContextMenuCommand, "kind">,
): UserContextMenuCommand {
  return { kind: "userContextMenu", ...command };
}

export function defineMessageContextMenuCommand(
  command: Omit<MessageContextMenuCommand, "kind">,
): MessageContextMenuCommand {
  return { kind: "messageContextMenu", ...command };
}

/**
 * 컨텍스트 메뉴는 슬래시 커맨드와 이름 공간이 달라서
 * 유저용/메시지용이 같은 이름을 가질 수 있다. 그래서 타입까지 합쳐 키로 쓴다.
 */
export function contextMenuKey(type: number, name: string): string {
  return `${type}:${name}`;
}

// ─────────────────────────────────────────────────────────────
// 컴포넌트 (버튼 · 셀렉트 메뉴 · 모달 제출)
// ─────────────────────────────────────────────────────────────

export type ComponentInteraction = MessageComponentInteraction | ModalSubmitInteraction;

/**
 * customId 는 `네임스페이스:인자1:인자2` 형태로 쓴다.
 * 라우터가 첫 구간으로 핸들러를 찾고, 나머지를 args 로 넘긴다.
 *
 * 예) `demo:counter:3` → namespace `demo`, args `["counter", "3"]`
 *
 * 컬렉터(`awaitMessageComponent`)와 달리 봇이 켜져 있는 한 계속 동작하므로,
 * 시간이 지나 "인터랙션 실패"가 뜨는 문제가 없다.
 */
export interface ComponentHandler {
  readonly namespace: string;
  execute(interaction: ComponentInteraction, args: readonly string[]): Awaitable<void>;
}

export function defineComponentHandler(handler: ComponentHandler): ComponentHandler {
  return handler;
}

/** customId 를 만들 때 쓰는 헬퍼. 100자 제한을 넘지 않게 짧게 유지한다. */
export function customId(namespace: string, ...args: readonly string[]): string {
  return [namespace, ...args].join(":");
}

// ─────────────────────────────────────────────────────────────
// 이벤트
// ─────────────────────────────────────────────────────────────

export interface EventHandler<K extends keyof ClientEvents> {
  readonly name: K;
  /** true 면 최초 1회만 실행된다. */
  readonly once?: boolean;
  execute(...args: ClientEvents[K]): Awaitable<void>;
}

/**
 * 모든 이벤트 종류의 유니온.
 * 로더가 서로 다른 이벤트의 핸들러를 한 배열에 담기 위해 필요하다.
 */
export type AnyEventHandler = {
  [K in keyof ClientEvents]: EventHandler<K>;
}[keyof ClientEvents];

/** 이벤트 파일에서 `export default defineEvent({...})` 로 쓴다. execute 인자 타입이 추론된다. */
export function defineEvent<K extends keyof ClientEvents>(
  handler: EventHandler<K>,
): EventHandler<K> {
  return handler;
}

// discord.js 의 Client 에 레지스트리를 추가해, 어디서든 타입 안전하게 접근한다.
declare module "discord.js" {
  interface Client {
    commands: Collection<string, ChatInputCommand>;
    contextMenuCommands: Collection<string, ContextMenuCommand>;
    components: Collection<string, ComponentHandler>;
  }
}
