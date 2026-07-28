import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { MessageActionRowComponentBuilder, User } from "discord.js";

import { customId } from "../types.js";
import type { MessageOptions } from "../ui/response.js";
import { ACTION, ATTENDANCE, BUTTON_LABEL } from "./ids.js";
import type { AttendanceRecord } from "./store.js";

/** 출헉 이미지 파일 이름. 컨테이너가 `attachment://` 로 가리킨다. */
export const IMAGE_NAME = "attendance.png";

function checkRows(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(customId(ATTENDANCE, ACTION.check))
        .setLabel(BUTTON_LABEL)
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

/**
 * 오늘의 출헉 메시지.
 *
 * 글자는 **이미지로만** 낸다 — 본문에 적으면 그대로 복사해 붙여 넣을 수 있다.
 */
export function todayView(top: AttendanceRecord | null, user: User): MessageOptions {
  return {
    status: "info",
    title: "오늘의 출헉",
    fields:
      top === null
        ? []
        : [{ name: "제출많", value: `<@${top.userId}> (${top.total}일)` }],
    images: [`attachment://${IMAGE_NAME}`],
    user,
    ephemeral: false,
    rows: checkRows(),
  };
}

/** 출헉에 성공했을 때 채널에 남기는 메시지. */
export function successView(
  record: AttendanceRecord,
  rewarded: string | undefined,
  user: User,
): MessageOptions {
  return {
    status: "success",
    title: "출헉 성공",
    description: `<@${record.userId}> 출헉 성공! (연속 ${record.streak}일째)`,
    fields: [{ name: "누적", value: `**${record.total}일**` }],
    balance: rewarded,
    user,
    ephemeral: false,
  };
}
