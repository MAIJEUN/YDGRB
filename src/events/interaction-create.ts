import { Events } from "discord.js";
import type { Interaction, RepliableInteraction } from "discord.js";

import { logger } from "../logger.js";
import { response } from "../ui/response.js";
import { contextMenuKey, defineEvent } from "../types.js";
import { speak } from "../ui/tone.js";

/**
 * 오류를 알린다. 어디서 막혔는지 짐작할 수 있게 짧은 원인도 함께 보여 준다.
 * (전체 내용과 스택은 로그에만 남는다)
 */
async function replyWithError(
  interaction: RepliableInteraction,
  error: unknown,
): Promise<void> {
  const payload = response({
    status: "failure",
    title: speak("처리 중 문제가 생겼어요"),
    description: speak("잠시 후 다시 시도해 주세요. 계속 같은 문제가 나오면 관리자에게 알려 주세요."),
    error,
    user: interaction.user,
  });

  try {
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (error) {
    // 3초 안에 응답하지 못해 인터랙션이 만료된 경우 등.
    logger.error("오류 안내 메시지 전송 실패", error);
  }
}

/** 사람이 읽을 수 있는 인터랙션 이름 — 로그용. */
function describe(interaction: Interaction): string {
  if (interaction.isChatInputCommand()) return `/${interaction.commandName}`;
  if (interaction.isContextMenuCommand()) return `컨텍스트 메뉴 "${interaction.commandName}"`;
  if (interaction.isAutocomplete()) return `/${interaction.commandName} (자동완성)`;
  if (interaction.isMessageComponent()) return `컴포넌트 ${interaction.customId}`;
  if (interaction.isModalSubmit()) return `모달 ${interaction.customId}`;
  return `인터랙션 타입 ${interaction.type}`;
}

export default defineEvent({
  name: Events.InteractionCreate,
  async execute(interaction) {
    // ── 자동완성 ───────────────────────────────────────────────
    // 응답 방식이 달라서(choices 만 보냄) 가장 먼저 분기한다.
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command?.autocomplete === undefined) return;

      try {
        await command.autocomplete(interaction);
      } catch (error) {
        // 자동완성은 사용자에게 오류를 보여줄 방법이 없으므로 로그만 남긴다.
        logger.error(`${describe(interaction)} 처리 중 오류`, error);
      }
      return;
    }

    try {
      // ── 슬래시 커맨드 ───────────────────────────────────────
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (command === undefined) {
          // 코드에서 지웠지만 디스코드에는 남아 있는 커맨드. `npm run deploy` 로 동기화한다.
          logger.warn(`등록되지 않은 커맨드 호출: ${describe(interaction)}`);
          await replyWithError(interaction, speak(`등록되지 않은 커맨드입니다: /${interaction.commandName}`));
          return;
        }

        await command.execute(interaction);
      }
      // ── 컨텍스트 메뉴 (유저 우클릭 / 메시지 우클릭 > 앱) ────
      else if (interaction.isContextMenuCommand()) {
        const key = contextMenuKey(interaction.commandType, interaction.commandName);
        const command = interaction.client.contextMenuCommands.get(key);

        if (command === undefined) {
          logger.warn(`등록되지 않은 컨텍스트 메뉴 호출: ${key}`);
          await replyWithError(interaction, speak(`등록되지 않은 컨텍스트 메뉴입니다: ${key}`));
          return;
        }

        if (command.kind === "userContextMenu" && interaction.isUserContextMenuCommand()) {
          await command.execute(interaction);
        } else if (
          command.kind === "messageContextMenu" &&
          interaction.isMessageContextMenuCommand()
        ) {
          await command.execute(interaction);
        } else {
          logger.warn(`컨텍스트 메뉴 종류가 등록된 것과 다릅니다: ${key}`);
          await replyWithError(interaction, speak(`컨텍스트 메뉴 종류가 맞지 않습니다: ${key}`));
        }
      }
      // ── 버튼 · 셀렉트 메뉴 · 모달 제출 ──────────────────────
      else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        const [namespace, ...args] = interaction.customId.split(":");
        const handler =
          namespace === undefined ? undefined : interaction.client.components.get(namespace);

        if (handler === undefined) {
          // 봇을 재시작하기 전에 보낸 오래된 메시지의 버튼 등.
          logger.warn(`처리할 핸들러가 없습니다: ${describe(interaction)}`);
          await replyWithError(
            interaction,
            speak(`처리할 핸들러가 없습니다: ${interaction.customId}\n(봇이 업데이트되기 전 메시지일 수 있어요)`),
          );
          return;
        }

        await handler.execute(interaction, args);
      }
      // ── 그 외 (Ping 등, 게이트웨이 봇에는 오지 않음) ────────
      else {
        logger.debug(`처리하지 않는 ${describe(interaction)}`);
        return;
      }

      logger.debug(`${describe(interaction)} 처리 완료 — ${interaction.user.tag}`);
    } catch (error) {
      logger.error(`${describe(interaction)} 처리 중 오류`, error);
      if (interaction.isRepliable()) await replyWithError(interaction, error);
    }
  },
});
