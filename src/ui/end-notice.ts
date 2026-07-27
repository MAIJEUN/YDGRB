import type { Client, User } from "discord.js";

import { logger } from "../logger.js";
import { atWithCountdown } from "../time.js";
import { channelMessage, type MessageOptions, type ResponseField, type Status } from "./response.js";

/**
 * 기간이 끝나 풀리는 효과의 **종료 알림**.
 *
 * 뚜따이 자동 바사삭, 타임아웃 만료처럼 "나중에 저절로 풀리는" 것들이 전부 여기를 지난다.
 * 시스템마다 다르게 생기면 읽는 사람이 매번 다시 읽어야 하므로 모양을 한곳에 고정한다.
 *
 *   ### <효과> — 기간 만료 | 해제
 *   <대상> 님의 <효과>이(가) 끝났습니다.
 *
 *   **대상**        <@id> · 서버 전원
 *   **풀린 시각**    <t:…:F> (<t:…:R>)      ← 시각은 반드시 타임스탬프 마크다운
 *   **집계**        (뒷정리가 있었으면)
 *   ────
 *   -# @효과를 건 사람
 *
 * 색은 **파랑(정보)** 이 기본이다 — 아무도 요청하지 않은 알림성 응답이다.
 * 뒷정리(자동 바사삭 등)가 실패했을 때만 그 결과 색을 쓴다.
 *
 * 알림은 **효과를 건 메시지에 답장**으로 단다. 그 메시지가 사라졌으면 채널에 그냥 남긴다.
 */

export type EndReason =
  /** 기간이 다 되어 저절로 풀림. */
  | { readonly kind: "expired" }
  /** 사람이 중간에 풀었음. `byId` 를 모르면 null. */
  | { readonly kind: "released"; readonly byId: string | null };

export interface EndNoticeOptions {
  /** 효과 이름. 제목과 본문에 그대로 들어간다 — `타임아웃` · `뚜따이`. */
  readonly effect: string;
  /** 대상 표기. 유저는 멘션(`<@id>`), 서버 전체는 그 문구. */
  readonly target: string;
  /** 기간 만료면 풀린 시각, 중간 해제면 원래 풀릴 예정이던 시각. */
  readonly until: Date;
  readonly reason: EndReason;
  /**
   * 뒷정리 결과. 봇이 무언가를 되돌려야 하는 효과(뚜따이)만 넘긴다.
   * 타임아웃처럼 디스코드가 알아서 푸는 것은 생략한다.
   */
  readonly outcome?: {
    readonly status: Status;
    readonly fields: readonly ResponseField[];
  };
  /** 대상이 서버를 떠났으면 true — 본문에 그 사실을 적는다. */
  readonly targetLeft?: boolean;
  /** footer 에 적을 사람 — 효과를 건 사람. */
  readonly user: User;
}

export function endNoticeView(options: EndNoticeOptions): MessageOptions {
  const released = options.reason.kind === "released";
  const by = options.reason.kind === "released" ? options.reason.byId : null;

  // 「효과」를 붙여 조사 문제를 피한다 — 효과 이름마다 이/가 를 따지지 않아도 된다.
  // 대상이 사람이 아니면(서버 전원 등) 「님」 도 붙이지 않는다.
  const subject = `${options.target}${options.target.startsWith("<@") ? " 님의" : "의"} **${options.effect}** 효과`;

  const description = released
    ? by === null
      ? `${subject}가 풀렸습니다.`
      : `${subject}를 <@${by}> 님이 풀었습니다.`
    : `${subject}가 끝났습니다.`;

  return {
    // 뒷정리가 있었으면 그 결과 색, 없으면 파랑(정보).
    status: options.outcome?.status ?? "info",
    title: `${options.effect} — ${released ? "해제" : "기간 만료"}`,
    description: options.targetLeft === true ? `${description}\n_(서버를 떠난 사람입니다)_` : description,
    // 대상은 내용이 이미 말했다 — 칸을 따로 두지 않는다.
    fields: [
      {
        // 시각은 반드시 타임스탬프 마크다운으로.
        name: released ? "원래 풀릴 시각" : "풀린 시각",
        value: atWithCountdown(options.until),
      },
      ...(options.outcome?.fields ?? []),
    ],
    user: options.user,
    ephemeral: false,
  };
}

/** 알림을 달 자리 — 효과를 건 메시지. */
export interface NoticeAnchor {
  readonly channelId: string | null;
  /** 효과를 건 메시지. 못 찾으면 채널에 그냥 남긴다. */
  readonly messageId: string | null;
}

/**
 * 종료 알림을 보낸다. **효과를 건 메시지에 답장**으로 단다.
 *
 * 알림이 실패해도 효과 자체는 이미 끝났으므로 던지지 않는다 — 로그만 남긴다.
 * 아래 경우들은 정상이고, 그때그때 할 수 있는 만큼만 한다.
 *
 *   - 원본 메시지가 지워짐 → 답장을 포기하고 채널에 그냥 남긴다
 *   - 채널이 지워지거나 봇이 못 봄 → 아무것도 못 한다 (로그만)
 *   - 봇이 그 채널에 글을 못 씀 → 마찬가지
 *   - 스레드가 보관됨 → 보내기가 실패하면 로그만
 */
/**
 * 푼 사람이 봇이면 이름을 지운다.
 *
 * 「<@봇> 님이 풀었습니다」 는 아무 정보도 주지 않는다 — 봇이 푸는 건 기간이 다 됐거나
 * 누가 시켰거나 둘 중 하나이고, 어느 쪽이든 봇 이름은 읽는 사람에게 쓸모가 없다.
 */
function hideBot(client: Client, reason: EndReason): EndReason {
  if (reason.kind !== "released") return reason;
  if (reason.byId !== client.user?.id) return reason;

  return { kind: "released", byId: null };
}

export async function sendEndNotice(
  client: Client,
  anchor: NoticeAnchor,
  options: EndNoticeOptions,
): Promise<void> {
  if (anchor.channelId === null) return;

  try {
    const channel = await client.channels.fetch(anchor.channelId).catch(() => null);
    if (channel === null || !channel.isSendable()) {
      logger.debug(`종료 알림: 보낼 수 없는 채널 ${anchor.channelId}`);
      return;
    }

    const payload = channelMessage(endNoticeView({ ...options, reason: hideBot(client, options.reason) }));

    if (anchor.messageId !== null) {
      // 원본이 살아 있는지 먼저 확인한다. 없는 메시지에 답장하면 디스코드가 통째로 거부한다.
      const origin = await channel.messages.fetch(anchor.messageId).catch(() => null);

      if (origin !== null) {
        await origin.reply(payload);
        return;
      }

      logger.debug(`종료 알림: 원본 메시지가 없어 채널에 남깁니다 (${anchor.messageId})`);
    }

    await channel.send(payload);
  } catch (error) {
    logger.error("종료 알림 전송 실패", error);
  }
}

/** 대상이 아직 서버에 있는지. 못 찾으면 떠난 것으로 본다. */
export async function hasLeft(client: Client, guildId: string, userId: string): Promise<boolean> {
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId).catch(() => null);
    return member === null;
  } catch {
    // 서버 자체를 못 찾는 경우 — 떠났는지 알 길이 없으니 굳이 적지 않는다.
    return false;
  }
}
