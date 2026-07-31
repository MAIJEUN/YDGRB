import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { GuildMember } from "discord.js";

import { logger } from "../logger.js";
import { atWithCountdown, describeDurationError, formatDuration, parseDuration } from "../time.js";
import { announceRelease, scheduleEnd } from "../timeout/scheduler.js";
import { setState } from "../timeout/store.js";
import { auditReason, reasonField, reasonOption, readReason } from "../ui/reason.js";
import { editResponse, response } from "../ui/response.js";
import { defineCommand } from "../types.js";

/**
 * 타임아웃 — 정해진 시각까지 말도 못 하고 반응도 못 달게 만든다.
 *
 * 기간을 비우면 **해제**한다. 걸린 걸 푸는 다른 방법이 없어서 같은 명령에 담았다.
 *
 * 끝날 때 한 번 더 알린다 (뚜따이 기간 만료와 같은 방식):
 *   - 기간이 다 되어 저절로 풀림 → [scheduler](../timeout/scheduler.ts) 의 예약
 *   - 이 명령으로 풀림 → 아래에서 바로 `announceRelease`
 *   - 디스코드 화면에서 풀림 → [guildMemberUpdate](../events/guild-member-update.ts)
 */

const OPTION = { user: "유저", duration: "기간" } as const;

/** 디스코드가 허용하는 타임아웃 최대 길이. 이보다 길게 요청하면 API 가 거부한다. */
const MAX_TIMEOUT_SECONDS = 28 * 24 * 60 * 60;

/** 지금 걸려 있는 타임아웃. 이미 지난 것은 걸려 있지 않은 것으로 본다. */
function currentTimeout(member: GuildMember): Date | null {
  return member.isCommunicationDisabled() ? member.communicationDisabledUntil : null;
}

/** 시각은 반드시 타임스탬프 마크다운으로. 없으면 「없음」. */
function describeTimeout(until: Date | null): string {
  return until === null ? "없음" : atWithCountdown(until);
}

/** 이 사람을 타임아웃할 수 있는지. 디스코드가 거부할 경우를 미리 걸러 안내한다. */
function whyNotModeratable(target: GuildMember, actor: GuildMember): string | undefined {
  const { guild } = target;

  if (target.id === guild.ownerId) {
    return "서버 소유자는 타임아웃할 수 없습니다.";
  }

  // 관리자 권한이 있으면 디스코드가 타임아웃을 걸어 주지 않는다.
  if (target.permissions.has(PermissionFlagsBits.Administrator, false)) {
    return "**관리자** 권한이 있는 사람은 타임아웃할 수 없습니다.";
  }

  const me = guild.members.me;
  if (me === null || !me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return "봇에게 **멤버 타임아웃(Moderate Members)** 권한을 주세요.";
  }

  if (me.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return "이 사람의 역할이 봇보다 높습니다. 서버 설정 > 역할 에서 봇 역할을 더 위로 올려 주세요.";
  }

  // 서버 소유자는 서열과 무관하게 다 만질 수 있다.
  if (guild.ownerId !== actor.id && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return "자신보다 높거나 같은 역할을 가진 사람은 타임아웃할 수 없습니다.";
  }

  return undefined;
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("타임아웃")
    .setDescription("정한 기간 동안 채팅과 반응을 막습니다. 기간을 비우면 해제합니다.")
    .setContexts(InteractionContextType.Guild)
    // 디스코드 쪽에서도 권한 없는 사람에게는 아예 안 보이게 한다.
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName(OPTION.user).setDescription("타임아웃할 사람").setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName(OPTION.duration)
        .setDescription("1일 4시간 45초 · 64(숫자만 쓰면 초). 비우면 해제. 최대 28일"),
    )
    .addStringOption(reasonOption),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply(
        response({
          status: "failure",
          title: "서버 전용",
          description: "이 명령은 서버 안에서만 사용할 수 있어요.",
          user: interaction.user,
        }),
      );
      return;
    }

    const target = interaction.options.getMember(OPTION.user);
    if (target === null) {
      await interaction.reply(
        response({
          status: "failure",
          title: "타임아웃 실패",
          description: "서버에 없는 사람입니다.",
          user: interaction.user,
        }),
      );
      return;
    }

    // 기간을 비우면 해제.
    const rawDuration = interaction.options.getString(OPTION.duration)?.trim() ?? "";
    let seconds: number | null = null;

    if (rawDuration !== "") {
      const parsed = parseDuration(rawDuration);
      if (!parsed.ok) {
        await interaction.reply(
          response({
            status: "failure",
            title: "기간을 읽을 수 없습니다",
            description: describeDurationError(parsed.reason),
            fields: [{ name: "입력한 값", value: `\`${rawDuration}\`` }],
            user: interaction.user,
          }),
        );
        return;
      }

      // parseDuration 은 365일까지 받지만 타임아웃은 28일이 한계다.
      if (parsed.seconds > MAX_TIMEOUT_SECONDS) {
        await interaction.reply(
          response({
            status: "failure",
            title: "기간이 너무 깁니다",
            description: `타임아웃은 최대 **${formatDuration(MAX_TIMEOUT_SECONDS)}** 까지만 걸 수 있어요.`,
            fields: [{ name: "입력한 값", value: `\`${rawDuration}\` (${formatDuration(parsed.seconds)})` }],
            user: interaction.user,
          }),
        );
        return;
      }

      seconds = parsed.seconds;
    }

    const reason = readReason(interaction);

    const blocked = whyNotModeratable(target, interaction.member);
    if (blocked !== undefined) {
      await interaction.reply(
        response({
          status: "failure",
          title: "타임아웃 실패",
          description: blocked,
          fields: [{ name: "대상", value: `<@${target.id}>` }],
          user: interaction.user,
        }),
      );
      return;
    }

    const before = currentTimeout(target);

    if (seconds === null && before === null) {
      await interaction.reply(
        response({
          status: "failure",
          title: "타임아웃 실패",
          description: `<@${target.id}> 님은 타임아웃 상태가 아닙니다.`,
          user: interaction.user,
        }),
      );
      return;
    }

    await interaction.deferReply();

    const after = seconds === null ? null : new Date(Date.now() + seconds * 1000);

    try {
      await target.timeout(
        seconds === null ? null : seconds * 1000,
        auditReason(after === null ? "타임아웃 해제" : "타임아웃", interaction.user.tag, reason),
      );
    } catch (error) {
      await interaction.editReply(
        editResponse({
          status: "failure",
          title: "타임아웃 실패",
          description: "타임아웃을 적용하지 못했습니다.",
          error,
          fields: [{ name: "대상", value: `<@${target.id}>` }],
          user: interaction.user,
        }),
      );
      return;
    }

    // 해제했으면 **여기서 바로** 종료 알림을 낸다.
    //
    // 타임아웃을 풀면 guildMemberUpdate 도 같은 해제를 본다. 그쪽이 먼저 알리면
    // 감사 로그의 실행자가 **봇**이라 푼 사람이 봇으로 찍힌다.
    // 상태를 먼저 가져가면(takeState) 이벤트 쪽은 아무것도 못 찾고 지나간다.
    if (after === null) {
      await announceRelease(
        interaction.client,
        interaction.guildId,
        target.id,
        interaction.user.id,
      );
    }

    // 끝날 때 알리기 위해 기억해 둔다.
    if (after !== null) {
      try {
        // 종료 알림을 이 응답에 답장으로 달기 위해 id 를 챙겨 둔다.
        // 못 가져와도 그냥 진행한다 — 그때는 채널에 남긴다.
        const messageId = await interaction
          .fetchReply()
          .then((message) => message.id)
          .catch(() => null);

        await setState(interaction.guildId, {
          userId: target.id,
          until: after.getTime(),
          appliedBy: interaction.user.id,
          appliedAt: Date.now(),
          channelId: interaction.channelId,
          messageId,
          reason,
        });

        scheduleEnd(interaction.client, interaction.guildId, target.id, after.getTime());
      } catch (error) {
        // 알림 예약에 실패해도 타임아웃 자체는 이미 걸렸다. 결과는 그대로 보여 준다.
        logger.error("타임아웃 종료 알림 예약 실패", error);
      }
    }

    await interaction.editReply(
      editResponse({
        status: "success",
        title: after === null ? "타임아웃 — 해제" : "타임아웃 — 적용",
        // 대상은 내용이 이미 말했다 — 칸을 따로 두지 않는다.
        description:
          after === null
            ? `<@${target.id}> 님의 타임아웃을 풀었습니다.`
            : `<@${target.id}> 님을 ${formatDuration(seconds ?? 0)} 동안 타임아웃했습니다.`,
        fields: [
          { name: "풀리는 시각", value: `${describeTimeout(before)} → **${describeTimeout(after)}**` },
          ...reasonField(reason),
        ],
        user: interaction.user,
      }),
    );
  },
});
