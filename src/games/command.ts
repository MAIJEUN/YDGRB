import { ActionRowBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from "discord.js";
import type {
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction,
  SlashCommandStringOption,
  User,
} from "discord.js";

import {
  MAX_DURATION_SECONDS,
  describeDurationError,
  formatDuration,
  parseDuration,
} from "../time.js";
import { channelMessage, messageLink, response } from "../ui/response.js";
import type { MessageOptions } from "../ui/response.js";
import { MAX_TITLE_LENGTH, TITLE_OPTION } from "./ids.js";
import { keepPending, type PendingOpen } from "./pending.js";
import { getGame } from "./registry.js";
import { attach, openGame } from "./runner.js";
import type { OpenOptions, OpenResult } from "./runner.js";
import type { GameDefinition, GameSession } from "./types.js";
import { busyView, refusedView } from "./views.js";
import { speak } from "../ui/tone.js";

/**
 * 게임 명령이 쓰는 부품.
 *
 * 게임마다 자기 명령을 갖지만(`/퀴즈` 처럼), **제목 칸**과 **판을 여는 절차**는 형식이
 * 정한 것이라 여기서 한 번만 만든다. 게임 쪽은 값을 읽어 넘기기만 하면 된다.
 *
 * 입력을 슬래시 옵션으로 받을 수도, 모달로 받을 수도 있다 —
 * **남에게 보이면 안 되는 값(퀴즈의 정답 같은)이 있으면 모달이어야 한다.**
 * 디스코드는 슬래시 커맨드에 넣은 값을 채널에 그대로 보여 준다.
 */

/** 슬래시 옵션으로 받는 제목 — `.addStringOption(titleOption)` */
export function titleOption(option: SlashCommandStringOption): SlashCommandStringOption {
  return option
    .setName(TITLE_OPTION)
    .setDescription("이 판이 무엇인지 한 줄로 — 「보상은 소원권 1개」 처럼")
    .setMaxLength(MAX_TITLE_LENGTH);
}

/** 모달로 받는 제목. 슬래시 쪽과 같은 이름·같은 길이를 쓴다. */
export function titleInput(fieldId: string): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(fieldId)
      .setLabel(TITLE_OPTION)
      .setPlaceholder("보상은 소원권 1개")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(MAX_TITLE_LENGTH),
  );
}

/** 적은 제목을 다듬는다. 비어 있으면 null. */
export function normalizeTitle(raw: string | null | undefined): string | null {
  const tidy = raw?.replaceAll(/\s+/gu, " ").trim() ?? "";
  return tidy === "" ? null : tidy.slice(0, MAX_TITLE_LENGTH);
}

/** 슬래시 옵션에서 제목을 읽는다. */
export function readTitle(interaction: ChatInputCommandInteraction): string | null {
  return normalizeTitle(interaction.options.getString(TITLE_OPTION));
}

/**
 * 기간이 있는 게임의 한계.
 *
 * 아래만 게임이 정한다 — 너무 짧으면 문제를 읽기도 전에 끝난다.
 *
 * 위는 [기간 파서](../time.ts)의 한계를 그대로 쓴다 (**365일**). 예전에는 한 시간으로
 * 끊었는데, 한 채널에 한 판이라 오래 걸리는 판이 채널을 묶는다는 이유였다. 그런데 며칠
 * 걸리는 판(출제해 두고 천천히 맞히는 퀴즈 같은)이 있을 수 있고, 묶인 채널은 이제
 * [오른쪽 위 종료](views.ts)로 언제든 풀 수 있다. 골격이 미리 막을 일이 아니다.
 *
 * 다만 **진행 중인 판은 재시작을 못 견딘다** ([runner](runner.ts) 의 `restoreGames`).
 * 며칠짜리 판은 그 사이에 봇이 한 번 꺼지면 중단된다.
 */
export const MIN_GAME_SECONDS = 10;
export const MAX_GAME_SECONDS = MAX_DURATION_SECONDS;

export type DurationCheck =
  | { readonly ok: true; readonly seconds: number }
  | { readonly ok: false; readonly view: MessageOptions };

/** 사람이 적은 기간을 읽고 한계 안인지 본다. 어긋나면 그대로 띄울 화면을 준다. */
export function checkDuration(raw: string, user: User): DurationCheck {
  const parsed = parseDuration(raw);

  if (!parsed.ok) {
    return {
      ok: false,
      view: {
        status: "failure",
        title: speak("기간을 읽을 수 없습니다"),
        description: describeDurationError(parsed.reason),
        fields: [{ name: "입력한 값", value: `\`${raw}\`` }],
        user,
      },
    };
  }

  if (parsed.seconds < MIN_GAME_SECONDS || parsed.seconds > MAX_GAME_SECONDS) {
    return {
      ok: false,
      view: {
        status: "failure",
        title: speak("기간이 맞지 않습니다"),
        description: speak(`**${formatDuration(MIN_GAME_SECONDS)}** 부터 **${formatDuration(MAX_GAME_SECONDS)}** 사이로 적어 주세요.`),
        fields: [{ name: "입력한 값", value: `\`${raw}\` (${formatDuration(parsed.seconds)})` }],
        user,
      },
    };
  }

  return { ok: true, seconds: parsed.seconds };
}

/** 커맨드로 열든 모달로 열든 이만큼은 할 수 있어야 한다. */
type GameOpener = ChatInputCommandInteraction | ModalSubmitInteraction;

/**
 * 판을 열고 응답으로 띄운다.
 *
 * 판은 **메시지 하나로 시작한다** — 이 응답이 곧 모집 패널이자 시작 안내다.
 * 못 열었으면 그 이유를 대신 띄우고 false 를 돌려준다.
 */
export async function openGameHere(
  interaction: GameOpener,
  game: GameDefinition,
  options: OpenOptions = {},
): Promise<boolean> {
  if (!interaction.inCachedGuild() || interaction.channel === null) {
    await interaction.reply(
      response(refusedView("서버 전용", speak("이 명령은 서버 안에서만 사용할 수 있어요."), interaction.user)),
    );
    return false;
  }

  const opened = await openGame(game, interaction.guildId, interaction.channel.id, interaction.user, options);

  if (!opened.ok) {
    await interaction.reply(response(busyNotice(interaction, opened.running, game, options)));
    return false;
  }

  await interaction.reply(response(opened.view));
  const message = await interaction.fetchReply();

  await attach(interaction.client, game, opened.session, message, interaction.user);
  return true;
}

/**
 * 막혔다는 안내를 만든다 — 도는 판으로 가는 **링크**와, 접고 대신 여는 **버튼**.
 *
 * 버튼은 **그 판을 끝낼 수 있는 사람에게만** 준다 (그 판을 연 사람과 관리자).
 * 지나가던 사람이 명령 한 번으로 남의 판을 밀어낼 수는 없다. 못 누르는 버튼을 보여 주고
 * 눌렀을 때 막는 것보다, 아예 안 보이는 편이 낫다.
 *
 * 열려던 것은 [잠깐 맡겨 둔다](pending.ts) — 문제와 정답, 인원, 제목은 그 명령 한 번에만
 * 실려 오고 응답한 순간 사라지기 때문이다.
 */
function busyNotice(
  interaction: GameOpener & { guildId: string },
  running: GameSession,
  game: GameDefinition,
  options: OpenOptions,
): MessageOptions {
  const link = messageLink(interaction.guildId, running.channelId, running.messageId);

  const mayStop =
    interaction.user.id === running.hostId ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;

  const takeoverId = mayStop
    ? keepPending({
        game,
        options,
        guildId: interaction.guildId,
        channelId: running.channelId,
        host: interaction.user,
      })
    : null;

  return busyView(running, getGame(running.gameId), interaction.user, { link, takeoverId });
}

/**
 * 맡겨 둔 판을 **채널에 연다.** 도는 판을 접은 직후에 부른다.
 *
 * 커맨드로 열 때와 달리 인터랙션 응답을 판으로 쓸 수 없다 — 막혔다는 안내가 이미 그 자리를
 * 차지했고, 그 안내는 **누른 사람에게만** 보이는 것이라 판이 될 수 없다.
 */
export async function openPending(client: Client, open: PendingOpen): Promise<OpenResult> {
  const opened = await openGame(open.game, open.guildId, open.channelId, open.host, open.options);
  if (!opened.ok) return opened;

  const channel = await client.channels.fetch(open.channelId).catch(() => null);
  if (channel === null || !channel.isTextBased() || !channel.isSendable()) return opened;

  const message = await channel.send(channelMessage(opened.view));
  await attach(client, open.game, opened.session, message, open.host);

  return opened;
}
