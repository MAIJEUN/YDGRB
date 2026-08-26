import { PermissionFlagsBits } from "discord.js";
import type { ButtonInteraction } from "discord.js";

import { ACTION, GAME } from "../games/ids.js";
import { getGame } from "../games/registry.js";
import { openPending } from "../games/command.js";
import { takePending } from "../games/pending.js";
import { cancel, join, leave, refreshPanel, startNow, stopGame } from "../games/runner.js";
import { activeInChannel, getSession } from "../games/store.js";
import { minPlayersOf } from "../games/types.js";
import { noticeView, refusedView } from "../games/views.js";
import { logger } from "../logger.js";
import { defineComponentHandler } from "../types.js";
import { response, updateResponse } from "../ui/response.js";
import { speak } from "../ui/tone.js";

/**
 * 판 화면의 버튼 — 참가 · 나가기 · 시작(모집 패널) · 종료(오른쪽 위, 언제나).
 *
 * customId 규칙: `game:<동작>:<판 id>`
 *
 * 누른 사람에게만 보이는 짧은 답을 주고, **패널 자체는 따로 다시 그린다.**
 * `interaction.update()` 로 패널을 고치면 누른 사람에게 답을 줄 자리가 없어진다.
 *
 * 시작과 종료는 **판을 연 사람과 관리자**만 쓸 수 있다. 버튼은 채널에 공개로 남아 있어
 * 지나가던 사람도 누를 수 있으므로, 막는 것은 언제나 여기서 한다.
 */

const JOIN_PROBLEM: Record<string, string> = {
  gone: speak("이미 끝난 판입니다."),
  closed: speak("모집이 끝났습니다."),
  already: speak("이미 참가해 있어요."),
  full: speak("자리가 다 찼습니다."),
  notJoined: speak("참가하지 않은 판입니다."),
};

/** 시작 · 종료는 **판을 연 사람과 관리자**만 할 수 있다. */
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

    // 넘겨받기만은 **판 id 가 아니라 맡긴 id** 를 싣는다. 판을 찾기 전에 가른다.
    if (action === ACTION.takeover) {
      await takeover(interaction, sessionId);
      return;
    }

    const session = await getSession(interaction.guildId, sessionId);

    if (session === undefined) {
      await interaction.reply(
        response(refusedView("끝난 판", speak("이미 끝났거나 사라진 판입니다."), interaction.user)),
      );
      return;
    }

    const game = getGame(session.gameId);
    if (game === undefined) {
      await interaction.reply(
        response(
          refusedView("없는 게임", speak("이 판의 게임을 찾지 못했습니다."), interaction.user),
        ),
      );
      return;
    }

    const host = await interaction.client.users
      .fetch(session.hostId)
      .catch(() => interaction.client.user);

    switch (action) {
      case ACTION.join: {
        // 참가하면서 적을 것이 있는 게임(국민투표의 공약)은 모달을 먼저 띄운다.
        // 실제 참가는 그 게임의 모달 핸들러가 시킨다 — 적다 만 사람은 참가가 아니다.
        if (game.joinModal !== undefined) {
          await interaction.showModal(game.joinModal(session));
          return;
        }

        const result = await join(interaction.guildId, sessionId, interaction.user.id);

        if (!result.ok) {
          await interaction.reply(
            response(
              refusedView(
                speak("참가하지 못했어요"),
                JOIN_PROBLEM[result.reason] ?? "",
                interaction.user,
              ),
            ),
          );
          return;
        }

        await interaction.reply(
          response(
            noticeView(`${game.name} — 참가`, speak("판에 들어왔습니다."), interaction.user),
          ),
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
              refusedView(
                speak("나가지 못했어요"),
                JOIN_PROBLEM[result.reason] ?? "",
                interaction.user,
              ),
            ),
          );
          return;
        }

        await interaction.reply(
          response(
            noticeView(`${game.name} — 나가기`, speak("판에서 빠졌습니다."), interaction.user),
          ),
        );
        if (host !== null) await refreshPanel(interaction.client, result.session, host);
        return;
      }

      case ACTION.start: {
        if (!mayControl(interaction, session.hostId)) {
          await interaction.reply(
            response(
              refusedView(
                speak("시작하지 못했어요"),
                speak("판을 연 사람과 관리자만 시작할 수 있습니다."),
                interaction.user,
              ),
            ),
          );
          return;
        }

        if (session.players.length < minPlayersOf(game)) {
          await interaction.reply(
            response(
              refusedView(
                speak("시작하지 못했어요"),
                speak(`최소 **${minPlayersOf(game)}명**이 모여야 시작할 수 있습니다.`),
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

      case ACTION.stop: {
        if (!mayControl(interaction, session.hostId)) {
          await interaction.reply(
            response(
              refusedView(
                speak("종료하지 못했어요"),
                speak("판을 연 사람과 관리자만 종료할 수 있습니다."),
                interaction.user,
              ),
            ),
          );
          return;
        }

        // 게임이 마무리하면서 메시지를 뱉을 수 있으니 인터랙션부터 닫는다.
        await interaction.deferUpdate();
        if (host !== null) {
          await stopGame(
            interaction.client,
            interaction.guildId,
            sessionId,
            host,
            interaction.user.id,
          );
        }
        return;
      }

      // 종료로 합치기 전에 뜬 모집 패널의 「접기」. 채널에 남아 있는 동안은 계속 받는다.
      case ACTION.cancel: {
        if (!mayControl(interaction, session.hostId)) {
          await interaction.reply(
            response(
              refusedView(
                speak("접지 못했어요"),
                speak("판을 연 사람과 관리자만 접을 수 있습니다."),
                interaction.user,
              ),
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

/**
 * 도는 판을 접고 **막혔던 판을 대신 연다.**
 *
 * 이 버튼은 그 판을 끝낼 수 있는 사람에게만 붙지만, 붙은 것을 그대로 믿지 않는다 —
 * customId 는 누구나 흉내 낼 수 있다.
 */
async function takeover(
  interaction: ButtonInteraction<"cached">,
  pendingId: string,
): Promise<void> {
  const pending = takePending(pendingId);
  if (pending === undefined) {
    await interaction.reply(
      response(
        refusedView(
          speak("지난 요청입니다"),
          speak("열려던 것을 잊었습니다. 명령을 다시 써 주세요."),
          interaction.user,
        ),
      ),
    );
    return;
  }

  const running = await activeInChannel(interaction.guildId, pending.channelId);

  if (running !== undefined && !mayControl(interaction, running.hostId)) {
    await interaction.reply(
      response(
        refusedView(
          speak("접지 못했어요"),
          speak("판을 연 사람과 관리자만 접을 수 있습니다."),
          interaction.user,
        ),
      ),
    );
    return;
  }

  await interaction.deferUpdate();

  // 돌던 판을 먼저 끝낸다. 그 사이에 저절로 끝났으면 그냥 새로 연다.
  if (running !== undefined) {
    const runningHost = await interaction.client.users
      .fetch(running.hostId)
      .catch(() => interaction.client.user);

    if (runningHost !== null) {
      await stopGame(
        interaction.client,
        interaction.guildId,
        running.id,
        runningHost,
        interaction.user.id,
      );
    }
  }

  const opened = await openPending(interaction.client, pending);

  await interaction.editReply(
    updateResponse(
      opened.ok
        ? noticeView(
            speak("새 판을 열었습니다"),
            speak(`<#${pending.channelId}> 에 올렸어요.`),
            interaction.user,
          )
        : refusedView(
            speak("열지 못했어요"),
            speak("접는 사이에 다른 판이 열렸습니다. 다시 시도해 주세요."),
            interaction.user,
          ),
    ),
  );
  return;
}
