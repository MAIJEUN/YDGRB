import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { MessageActionRowComponentBuilder, User } from "discord.js";

import { count } from "../info/format.js";
import { customId } from "../types.js";
import type { MessageOptions, ResponseField } from "../ui/response.js";
import { ACTION, AGAIN_LABEL, ATTENDANCE, BUTTON_LABEL } from "./ids.js";
import type { AttendanceRecord } from "./store.js";
import { speak } from "../ui/tone.js";

/** 출헉 이미지 파일 이름. 컨테이너가 `attachment://` 로 가리킨다. */
export const IMAGE_NAME = "attendance.png";

/**
 * 명단에 늘어놓는 최대 인원.
 *
 * 큰 서버는 하루에 수십 명이 찍는다. 멘션을 다 적으면 글자 수 한계에 걸리므로
 * 앞에서부터 이만큼만 적고 나머지는 수로 남긴다.
 */
export const MAX_SHOWN_ATTENDERS = 20;

/** 화면에 그릴 오늘의 판. */
export interface TodayBoard {
  /** 제출많 — 가장 많이 출헉한 사람. 없으면 null. */
  readonly top: AttendanceRecord | null;
  /** 오늘 출헉한 사람. 맞힌 차례 그대로. */
  readonly attenders: readonly string[];
}

/** 아무도 아직 안 한 판 (덤을 올릴 때도 이걸 쓴다). */
export const EMPTY_BOARD: TodayBoard = { top: null, attenders: [] };

function row(...components: MessageActionRowComponentBuilder[]): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

/**
 * 오늘 출헉한 사람 칸. 아무도 없으면 칸을 만들지 않는다.
 *
 * 성공 안내 자체는 여전히 **누른 사람에게만** 간다 — 채널에 하나씩 쌓이면 출헉 메시지가
 * 답글로 묻힌다. 대신 누가 했는지는 이 칸 하나에 모아 둔다.
 */
function attenderField(attenders: readonly string[]): ResponseField[] {
  if (attenders.length === 0) return [];

  const shown = attenders.slice(0, MAX_SHOWN_ATTENDERS).map((userId) => `<@${userId}>`);
  if (attenders.length > MAX_SHOWN_ATTENDERS) {
    shown.push(`_외 ${count(attenders.length - MAX_SHOWN_ATTENDERS)}명_`);
  }

  return [{ name: `오늘 출헉 (${count(attenders.length)}명)`, value: shown.join(" ") }];
}

/**
 * 오늘의 출헉 메시지.
 *
 * 글자는 **이미지로만** 낸다 — 본문에 적으면 그대로 복사해 붙여 넣을 수 있다.
 *
 * `extraId` 를 주면 「그래도 계속」으로 올린 덤이다. 받아쓰기는 똑같이 하지만
 * 출헉으로 세지 않으므로 제목에 그렇게 적는다.
 */
export function todayView(board: TodayBoard, user: User, extraId?: string): MessageOptions {
  const extra = extraId !== undefined;

  return {
    status: "info",
    title: extra ? "출헉 (기록 안 됨)" : "오늘의 출헉",
    // 덤은 출헉으로 세지 않으므로 명단도 제출많도 붙이지 않는다.
    fields: extra
      ? []
      : [
          // 오늘 있었던 일이 먼저, 여태까지의 기록이 그 다음이다.
          ...attenderField(board.attenders),
          ...(board.top === null
            ? []
            : [{ name: "제출많", value: `<@${board.top.userId}> (${board.top.total}일)` }]),
        ],
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
