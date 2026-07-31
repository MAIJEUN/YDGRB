import { PermissionFlagsBits } from "discord.js";
import type { ButtonInteraction } from "discord.js";

import { ACTION, GAME } from "../games/ids.js";
import { getGame } from "../games/registry.js";
import { cancel, join, leave, refreshPanel, startNow } from "../games/runner.js";
import { getSession } from "../games/store.js";
import { minPlayersOf } from "../games/types.js";
import { noticeView, refusedView } from "../games/views.js";
import { logger } from "../logger.js";
import { defineComponentHandler } from "../types.js";
import { response } from "../ui/response.js";

/**
 * 모집 패널의 버튼 — 참가 · 나가기 · 시작 · 접기.
 *
 * customId 규칙: `game:<동작>:<판 id>`
 *
 * 누른 사람에게만 보이는 짧은 답을 주고, **패널 자체는 따로 다시 그린다.**
 * `interaction.update()` 로 패널을 고치면 누른 사람에게 답을 줄 자리가 없어진다.
 */

const JOIN_PROBLEM: Record<string, string> = {
  gone: "이미 끝난 판입니다.",
  closed: "모집이 끝났습니다.",
  already: "이미 참가해 있어요.",
  full: "자리가 다 찼습니다.",
  notJoined: "참가하지 않은 판입니다.",
};

/**
 * 시작 · 접기는 **판을 연 사람과 관리자**만 할 수 있다.
 *
 * 버튼은 채널에 공개로 남아 있어 지나가던 사람도 누를 수 있다.
 */
function mayControl(interaction: ButtonInteraction, hostId: string): boolean {
  if (interaction.user.id === hostId) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
}

export default defineComponentHandler({
  namespace: GAME,

  async execute(interaction, args) {
    if (!interaction.isButton()) return;
    if (!interaction.inCachedGuild()) return;

    const [action, sessionId = ""] = args;
    const session = await getSession(interaction.guildId, sessionId);

    if (session === undefined) {
      await interaction.reply(
        response(refusedView("끝난 판", "이미 끝났거나 사라진 판입니다.", interaction.user)),
      );
      return;
    }

    const game = getGame(session.gameId);
    if (game === undefined) {
      await interaction.reply(
        response(refusedView("없는 게임", "이 판의 게임을 찾지 못했습니다.", interaction.user)),
      );
      return;
    }

    const host = await interaction.client.users
      .fetch(session.hostId)
      .catch(() => interaction.client.user);

    switch (action) {
      case ACTION.join: {
        const result = await join(interaction.guildId, sessionId, interaction.user.id);

        if (!result.ok) {
          await interaction.reply(
            response(
              refusedView("참가하지 못했어요", JOIN_PROBLEM[result.reason] ?? "", interaction.user),
            ),
          );
          return;
        }

        await interaction.reply(
          response(noticeView(`${game.name} — 참가`, "판에 들어왔습니다.", interaction.user)),
        );
        if (host !== null) await refreshPanel(interaction.client, result.session, host);

        // 자리가 다 찼으면 기다릴 이유가 없다.
        if (result.full && host !== null) {
          await startNow(interaction.client, interaction.guildId, sessionId, host);
        }
        return;
      }

      case ACTION.leave: {
        const result = await leave(interaction.guildId, sessionId, interaction.user.id);

        if (!result.ok) {
          await interaction.reply(
            response(
              refusedView("나가지 못했어요", JOIN_PROBLEM[result.reason] ?? "", interaction.user),
            ),
          );
          return;
        }

        await interaction.reply(
          response(noticeView(`${game.name} — 나가기`, "판에서 빠졌습니다.", interaction.user)),
        );
        if (host !== null) await refreshPanel(interaction.client, result.session, host);
        return;
      }

      case ACTION.start: {
        if (!mayControl(interaction, session.hostId)) {
          await interaction.reply(
            response(
              refusedView("시작하지 못했어요", "판을 연 사람과 관리자만 시작할 수 있습니다.", interaction.user),
            ),
          );
          return;
        }

        if (session.players.length < minPlayersOf(game)) {
          await interaction.reply(
            response(
              refusedView(
                "시작하지 못했어요",
                `최소 **${minPlayersOf(game)}명**이 모여야 시작할 수 있습니다.`,
                interaction.user,
              ),
            ),
          );
          return;
        }

        // 게임이 곧바로 메시지를 뱉을 수 있으니 인터랙션부터 닫는다.
        await interaction.deferUpdate();
        if (host !== null) await startNow(interaction.client, interaction.guildId, sessionId, host);
        return;
      }

      case ACTION.cancel: {
        if (!mayControl(interaction, session.hostId)) {
          await interaction.reply(
            response(
              refusedView("접지 못했어요", "판을 연 사람과 관리자만 접을 수 있습니다.", interaction.user),
            ),
          );
          return;
        }

        await interaction.deferUpdate();
        if (host !== null) await cancel(interaction.client, interaction.guildId, sessionId, host);
        return;
      }

      default:
        logger.debug(`게임: 모르는 버튼 ${interaction.customId}`);
        await interaction.deferUpdate();
    }
  },
});
