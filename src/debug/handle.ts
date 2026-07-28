import type { Message } from "discord.js";

import { logger } from "../logger.js";
import { channelMessage } from "../ui/response.js";
import type { MessageOptions } from "../ui/response.js";
import { isOwner } from "./access.js";
import { COMMANDS, findCommand } from "./commands.js";
import type { DebugContext } from "./commands.js";
import { PREFIX } from "./ids.js";
import { card } from "./views.js";

/**
 * `!y …` 를 받아 처리한다.
 *
 * 처리했으면 true — 부르는 쪽(messageCreate)이 거기서 멈추면 된다.
 *
 * 봇 주인이 아니면 **아무 대답도 하지 않는다.** 「권한이 없습니다」 라고 답하면
 * 그 자체가 「여기 뭔가 있다」 는 신호가 된다. 디버그는 있는 줄도 모르는 게 낫다.
 */
export async function handleDebugMessage(message: Message<true>): Promise<boolean> {
  const content = message.content.trim();

  // `!yo` 같은 것에 걸리지 않게, 접두사 뒤는 공백이거나 끝이어야 한다.
  if (content !== PREFIX && !content.startsWith(`${PREFIX} `)) return false;

  if (!(await isOwner(message.client, message.author.id))) {
    logger.debug(`디버그: 주인이 아닌 사람의 시도 — ${message.author.id}`);
    return true;
  }

  const [name = "", ...args] = content
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/u)
    .filter((token) => token !== "");

  const command = findCommand(name);
  const context: DebugContext = { message, args, user: message.author };

  if (command === undefined) {
    await send(message, [unknownView(context, name)]);
    return true;
  }

  logger.debug(`디버그: ${PREFIX} ${command.name} — ${message.author.id}`);

  try {
    await send(message, asViews(await command.run(context)));
  } catch (error) {
    logger.error(`디버그 ${PREFIX} ${command.name} 처리 중 오류`, error);

    await send(message, [
      card(command.name, message.author, {
        status: "failure",
        description: "디버그 명령이 끝까지 돌지 못했습니다.",
        error,
      }),
    ]);
  }

  return true;
}

/** 한 화면이든 여러 화면이든 배열로 맞춘다. */
export function asViews(
  result: MessageOptions | readonly MessageOptions[],
): readonly MessageOptions[] {
  return "status" in result ? [result] : result;
}

function unknownView(context: DebugContext, name: string): MessageOptions {
  return card("도움", context.user, {
    status: "failure",
    description: `\`${name}\` 는 없는 항목입니다.`,
    fields: [
      {
        name: "할 수 있는 것",
        value: COMMANDS.map((command) => `\`${command.usage}\` — ${command.summary}`).join("\n"),
      },
    ],
  });
}

/** 답장으로 단다 — 어느 명령에 대한 답인지 화면에서 바로 이어 보이게. */
async function send(message: Message<true>, views: readonly MessageOptions[]): Promise<void> {
  for (const view of views) {
    try {
      await message.reply(channelMessage(view));
    } catch (error) {
      // 권한이 없어 답장을 못 다는 경우 등. 여기서 더 할 수 있는 게 없다.
      logger.error("디버그 응답 전송 실패", error);
      return;
    }
  }
}
