import type { ButtonInteraction, Client, Message } from "discord.js";

import { isOwner } from "../debug/access.js";
import { findCommand } from "../debug/commands.js";
import { asViews } from "../debug/handle.js";
import { NAMESPACE, RESTART_EXIT_CODE } from "../debug/ids.js";
import { card } from "../debug/views.js";
import { logger } from "../logger.js";
import { stopAllLoops } from "../tasalbeo/runner.js";
import { defineComponentHandler } from "../types.js";
import { updateResponse } from "../ui/response.js";

/**
 * 디버그 화면의 버튼 — 새로고침 · 재시작 · 종료.
 *
 * customId 규칙: `debug:<동작>[:항목]`
 *
 * 버튼도 **누를 때마다** 주인인지 다시 본다. 메시지는 채널에 남아 있어서
 * 지나가던 사람이 누를 수 있고, customId 는 누구나 볼 수 있다.
 */
export default defineComponentHandler({
  namespace: NAMESPACE,

  async execute(interaction, args) {
    if (!interaction.isButton()) return;

    if (!(await isOwner(interaction.client, interaction.user.id))) {
      logger.debug(`디버그 버튼: 주인이 아닌 사람의 시도 — ${interaction.user.id}`);
      await interaction.deferUpdate();
      return;
    }

    const [action, target] = args;

    switch (action) {
      case "refresh":
        await refresh(interaction, target);
        return;

      case "cancel":
        await interaction.update(
          updateResponse(
            card("취소", interaction.user, {
              status: "progress",
              description: "아무것도 하지 않았습니다.",
            }),
          ),
        );
        return;

      case "restart":
      case "stop":
        await finish(interaction, action === "restart");
        return;

      default:
        // 보기용 버튼은 잠겨 있어서 눌릴 일이 없다. 눌렸다면 조용히 넘긴다.
        await interaction.deferUpdate();
    }
  },
});

/**
 * 같은 항목을 다시 그려 넣는다.
 *
 * 원래 명령을 친 메시지가 아니라 **봇이 답한 메시지**를 넘긴다. 서버·채널·클라이언트는
 * 그대로라 화면을 다시 만드는 데 부족한 것이 없다.
 */
async function refresh(interaction: ButtonInteraction, target: string | undefined): Promise<void> {
  const command = findCommand(target);
  const message: Message = interaction.message;

  if (command === undefined || !message.inGuild()) {
    await interaction.deferUpdate();
    return;
  }

  const [view] = asViews(await command.run({ message, args: [], user: interaction.user }));

  if (view === undefined) {
    await interaction.deferUpdate();
    return;
  }

  await interaction.update(updateResponse(view));
}

async function finish(interaction: ButtonInteraction, restarting: boolean): Promise<void> {
  // 끄기 전에 화면부터 바꾼다 — 끄고 나면 응답할 방법이 없다.
  await interaction.update(
    updateResponse(
      card(restarting ? "재시작" : "종료", interaction.user, {
        status: "progress",
        description: restarting ? "지금 끕니다. 실행기가 다시 켭니다." : "지금 끕니다.",
      }),
    ),
  );

  logger.warn(`디버그: ${restarting ? "재시작" : "종료"} 요청 — ${interaction.user.id}`);

  await shutdown(interaction.client, restarting ? RESTART_EXIT_CODE : 0);
}

async function shutdown(client: Client, code: number): Promise<void> {
  // 타살버의 역할 넣었다 빼기 타이머가 남아 있으면 프로세스가 안 끝난다.
  stopAllLoops();

  try {
    await client.destroy();
  } catch (error) {
    logger.error("종료 중 오류", error);
  }

  process.exit(code);
}
