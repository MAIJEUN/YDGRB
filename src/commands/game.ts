import { InteractionContextType, SlashCommandBuilder } from "discord.js";

import { MAX_TITLE_LENGTH } from "../games/ids.js";
import { allGames, getGame } from "../games/registry.js";
import { attach, openGame } from "../games/runner.js";
import { listView, refusedView } from "../games/views.js";
import { response } from "../ui/response.js";
import { defineCommand } from "../types.js";

/**
 * `/게임 [종류]` — 판을 연다. 비우면 무엇이 있는지 보여 준다.
 *
 * 종류는 **자동완성**이다. 목록을 실행 중에 읽으므로, 게임 파일을 하나 넣으면
 * `npm run deploy` 를 다시 돌리지 않아도 바로 고를 수 있다.
 */

const OPTION = { kind: "종류", title: "제목" } as const;

/** 자동완성은 한 번에 25개까지만 보낼 수 있다. */
const MAX_CHOICES = 25;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("게임")
    .setDescription("미니게임 판을 엽니다.")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName(OPTION.kind)
        .setDescription("비우면 무엇이 있는지 보여 줍니다")
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName(OPTION.title)
        .setDescription("이 판이 무엇인지 한 줄로 — 「보상은 소원권 1개」 처럼")
        .setMaxLength(MAX_TITLE_LENGTH),
    ),

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();

    const matched = allGames()
      .filter((game) => `${game.id} ${game.name}`.toLowerCase().includes(typed))
      .slice(0, MAX_CHOICES)
      .map((game) => ({ name: game.name, value: game.id }));

    await interaction.respond(matched);
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild() || interaction.channel === null) {
      await interaction.reply(
        response(
          refusedView("서버 전용", "이 명령은 서버 안에서만 사용할 수 있어요.", interaction.user),
        ),
      );
      return;
    }

    const wanted = interaction.options.getString(OPTION.kind);

    if (wanted === null) {
      await interaction.reply(response(listView(allGames(), interaction.user)));
      return;
    }

    const game = getGame(wanted);
    if (game === undefined) {
      await interaction.reply(
        response(
          refusedView("없는 게임", `\`${wanted}\` 라는 게임이 없습니다.`, interaction.user),
        ),
      );
      return;
    }

    // 제목을 적으면 컴포넌트 제목이 「보상은 소원권 1개 (가위바위보)」 가 된다.
    const title = interaction.options.getString(OPTION.title)?.replaceAll(/\s+/gu, " ").trim() ?? "";

    const opened = await openGame(
      game,
      interaction.guildId,
      interaction.channel.id,
      interaction.user,
      title === "" ? null : title,
    );

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
      return;
    }

    // 판은 메시지 하나로 시작한다 — 이 응답이 곧 모집 패널이자 시작 안내다.
    await interaction.reply(response(opened.view));
    const message = await interaction.fetchReply();

    await attach(interaction.client, game, opened.session, message, interaction.user);
  },
});
