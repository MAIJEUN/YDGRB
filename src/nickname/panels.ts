import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { MessageActionRowComponentBuilder } from "discord.js";

import { customId } from "../types.js";
import { ACTION, NICK } from "./ids.js";

/**
 * 진행 중인 작업을 멈추는 버튼. 뚜따이·바사삭 어느 쪽이든 같은 버튼으로 취소한다.
 *
 * 작업 id 를 customId 에 실어 둔다 — 이미 끝난 메시지의 버튼을 눌러
 * 그 뒤에 시작된 다른 작업이 죽는 일이 없게 하기 위해서다.
 */
export function cancelRows(runId: string): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(customId(NICK, ACTION.cancel, runId))
        .setLabel("취소")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}
