import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { MessageActionRowComponentBuilder, User } from "discord.js";

import { customId } from "../types.js";
import type { MessageOptions } from "../ui/response.js";
import { ACTION, AGAIN_LABEL, ATTENDANCE, BUTTON_LABEL } from "./ids.js";
import type { AttendanceRecord } from "./store.js";
import { speak } from "../ui/tone.js";

/** 출헉 이미지 파일 이름. 컨테이너가 `attachment://` 로 가리킨다. */
export const IMAGE_NAME = "attendance.png";

function row(...components: MessageActionRowComponentBuilder[]): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

/**
 * 오늘의 출헉 메시지.
 *
 * 글자는 **이미지로만** 낸다 — 본문에 적으면 그대로 복사해 붙여 넣을 수 있다.
 *
 * `extraId` 를 주면 「그래도 계속」으로 올린 덤이다. 받아쓰기는 똑같이 하지만
 * 출헉으로 세지 않으므로 제목에 그렇게 적는다.
 */
export function todayView(
  top: AttendanceRecord | null,
  user: User,
  extraId?: string,
): MessageOptions {
  const extra = extraId !== undefined;

  return {
    status: "info",
    title: extra ? "출헉 (기록 안 됨)" : "오늘의 출헉",
    fields:
      extra || top === null
        ? []
        : [{ name: "제출많", value: `<@${top.userId}> (${top.total}일)` }],
    images: [`attachment://${IMAGE_NAME}`],
    user,
    ephemeral: false,
    rows: [
      row(
        new ButtonBuilder()
          .setCustomId(
            extra ? customId(ATTENDANCE, ACTION.check, extraId) : customId(ATTENDANCE, ACTION.check),
          )
          .setLabel(BUTTON_LABEL)
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

/** 오늘 이미 올렸을 때 — 그래도 하나 더 올릴 수 있게 버튼을 단다. */
export function alreadyView(link: string, extraId: string, user: User): MessageOptions {
  return {
    status: "failure",
    title: speak("오늘은 이미 올렸습니다"),
    description: speak(`${link}이 이미 올라와 있어요.`),
    user,
    rows: [
      row(
        new ButtonBuilder()
          .setCustomId(customId(ATTENDANCE, ACTION.again, extraId))
          .setLabel(AGAIN_LABEL)
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

/**
 * 출헉에 성공했을 때. **누른 사람에게만** 보인다.
 *
 * 채널에 공개로 남기면 정답을 맞힌 사람이 늘어날수록 메시지가 쌓이고,
 * 누가 아직 안 했는지도 다 드러난다.
 */
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
  };
}

/** 덤을 맞혔을 때. 기록되지 않았다는 것을 제목으로 분명히 한다. */
export function extraSuccessView(user: User): MessageOptions {
  return {
    status: "info",
    title: speak("맞혔습니다 (기록 안 됨)"),
    description: speak(`<@${user.id}> 맞혔어요!`),
    user,
  };
}
