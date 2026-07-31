import type { ChatInputCommandInteraction, SlashCommandStringOption } from "discord.js";

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
 * 정한 것이라 여기서 한 번만 만든다. 게임 쪽 커맨드는 옵션을 읽어 넘기기만 하면 된다.
 */

/** 커맨드 빌더에 그대로 넘긴다 — `.addStringOption(titleOption)` */
export function titleOption(option: SlashCommandStringOption): SlashCommandStringOption {
  return option
    .setName(TITLE_OPTION)
    .setDescription("이 판이 무엇인지 한 줄로 — 「보상은 소원권 1개」 처럼")
    .setMaxLength(MAX_TITLE_LENGTH);
}

/** 적은 제목. 안 적었으면 null. */
export function readTitle(interaction: ChatInputCommandInteraction): string | null {
  const raw = interaction.options.getString(TITLE_OPTION)?.replaceAll(/\s+/gu, " ").trim() ?? "";
  return raw === "" ? null : raw;
}

/**
 * 판을 열고 커맨드 응답으로 띄운다.
 *
 * 판은 **메시지 하나로 시작한다** — 이 응답이 곧 모집 패널이자 시작 안내다.
 * 못 열었으면 그 이유를 대신 띄우고 false 를 돌려준다.
 */
export async function openGameHere(
  interaction: ChatInputCommandInteraction,
  game: GameDefinition,
  options: Omit<OpenOptions, "title"> & {
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

  const opened = await openGame(game, interaction.guildId, interaction.channel.id, interaction.user, {
    ...options,
    title: readTitle(interaction),
  });

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
