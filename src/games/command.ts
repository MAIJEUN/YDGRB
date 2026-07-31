import { ActionRowBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  SlashCommandStringOption,
} from "discord.js";

import { response } from "../ui/response.js";
import { MAX_TITLE_LENGTH, TITLE_OPTION } from "./ids.js";
import { attach, openGame } from "./runner.js";
import type { OpenOptions } from "./runner.js";
import type { GameDefinition } from "./types.js";
import { refusedView } from "./views.js";

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
  options: OpenOptions & {
    /**
     * 판 id 가 정해진 **직후, 시작하기 전에** 불린다.
     *
     * 퀴즈의 정답처럼 게임이 판마다 들고 있어야 하는 것을 맡기는 자리다.
     * 시작한 뒤에 맡기면 그 사이에 들어온 답을 놓친다.
     */
    readonly prepare?: (sessionId: string) => void;
  } = {},
): Promise<boolean> {
  if (!interaction.inCachedGuild() || interaction.channel === null) {
    await interaction.reply(
      response(refusedView("서버 전용", "이 명령은 서버 안에서만 사용할 수 있어요.", interaction.user)),
    );
    return false;
  }

  const opened = await openGame(game, interaction.guildId, interaction.channel.id, interaction.user, options);

  if (!opened.ok) {
    await interaction.reply(
      response(
        refusedView(
          "이미 판이 돌고 있어요",
          "이 채널에서 도는 판이 끝나야 새로 열 수 있습니다.",
          interaction.user,
        ),
      ),
    );
    return false;
  }

  options.prepare?.(opened.session.id);

  await interaction.reply(response(opened.view));
  const message = await interaction.fetchReply();

  await attach(interaction.client, game, opened.session, message, interaction.user);
  return true;
}
