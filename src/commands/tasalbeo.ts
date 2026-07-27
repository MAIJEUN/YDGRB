import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { GuildMember } from "discord.js";

import { logger } from "../logger.js";
import { MAX_SECONDS, NICKNAME } from "../tasalbeo/ids.js";
import { ensureMuteRole } from "../tasalbeo/role.js";
import { startLoop } from "../tasalbeo/runner.js";
import { releaseTasalbeo, scheduleEnd } from "../tasalbeo/scheduler.js";
import { getState, setState } from "../tasalbeo/store.js";
import { atWithCountdown, describeDurationError, formatDuration, parseDuration } from "../time.js";
import { editResponse, response } from "../ui/response.js";
import { defineCommand } from "../types.js";

/**
 * `/타살버` — 타임아웃인데 살짝 약한 버전.
 *
 * 기간을 비우면 **해제**한다 (`/타임아웃` 과 같은 규칙).
 * 걸린 사람에게 일어나는 일은 [ids.ts](../tasalbeo/ids.ts) 참고.
 */

const OPTION = { user: "유저", duration: "기간" } as const;

/** 이 사람에게 타살버를 걸 수 있는지. 디스코드가 거부할 경우를 미리 걸러 안내한다. */
function whyNotEligible(target: GuildMember, actor: GuildMember): string | undefined {
  const { guild } = target;

  if (target.id === guild.ownerId) {
    return "서버 소유자는 별명을 바꿀 수 없어서 타살버를 걸 수 없습니다.";
  }

  if (target.user.bot) {
    return "봇에게는 걸 수 없습니다.";
  }

  const me = guild.members.me;
  if (me === null) return "봇 정보를 읽지 못했습니다.";

  const missing = [
    me.permissions.has(PermissionFlagsBits.ManageRoles) ? "" : "**역할 관리(Manage Roles)**",
    me.permissions.has(PermissionFlagsBits.ManageNicknames) ? "" : "**별명 관리(Manage Nicknames)**",
  ].filter((name) => name !== "");

  if (missing.length > 0) {
    return `봇에게 ${missing.join(" 과(와) ")} 권한을 주세요.`;
  }

  // 별명도 역할도 서열이 높으면 못 건드린다.
  if (me.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return "이 사람의 역할이 봇보다 높습니다. 서버 설정 > 역할 에서 봇 역할을 더 위로 올려 주세요.";
  }

  // 서버 소유자는 서열과 무관하게 다 만질 수 있다.
  if (guild.ownerId !== actor.id && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return "자신보다 높거나 같은 역할을 가진 사람에게는 걸 수 없습니다.";
  }

  return undefined;
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("타살버")
    .setDescription("타임아웃인데 살짝 약한 버전. 기간을 비우면 해제합니다.")
    .setContexts(InteractionContextType.Guild)
    // 디스코드 쪽에서도 권한 없는 사람에게는 아예 안 보이게 한다.
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName(OPTION.user).setDescription("타살버를 걸 사람").setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName(OPTION.duration)
        .setDescription("1일 4시간 45초 · 64(숫자만 쓰면 초). 비우면 해제. 최대 1일"),
    ),

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
          title: "타살버 실패",
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

      // 7초마다 역할을 넣었다 뺐다 하므로 오래 걸면 요청이 끝없이 나간다.
      if (parsed.seconds > MAX_SECONDS) {
        await interaction.reply(
          response({
            status: "failure",
            title: "기간이 너무 깁니다",
            description: `타살버는 최대 **${formatDuration(MAX_SECONDS)}** 까지만 걸 수 있어요. 역할을 계속 넣었다 뺐다 하기 때문입니다.`,
            fields: [
              { name: "입력한 값", value: `\`${rawDuration}\` (${formatDuration(parsed.seconds)})` },
            ],
            user: interaction.user,
          }),
        );
        return;
      }

      seconds = parsed.seconds;
    }

    const current = await getState(interaction.guildId, target.id);

    // ── 해제 ────────────────────────────────────────────────
    if (seconds === null) {
      if (current === undefined) {
        await interaction.reply(
          response({
            status: "failure",
            title: "타살버 실패",
            description: `<@${target.id}> 님은 타살버 상태가 아닙니다.`,
            user: interaction.user,
          }),
        );
        return;
      }

      await interaction.deferReply();
      await releaseTasalbeo(interaction.client, interaction.guildId, target.id, interaction.user.id);

      await interaction.editReply(
        editResponse({
          status: "success",
          title: "타살버 — 해제",
          description: `<@${target.id}> 님의 타살버를 풀었습니다.`,
          fields: [{ name: "대상", value: `<@${target.id}>` }],
          user: interaction.user,
        }),
      );
      return;
    }

    // ── 걸기 ────────────────────────────────────────────────
    const blocked = whyNotEligible(target, interaction.member);
    if (blocked !== undefined) {
      await interaction.reply(
        response({
          status: "failure",
          title: "타살버 실패",
          description: blocked,
          fields: [{ name: "대상", value: `<@${target.id}>` }],
          user: interaction.user,
        }),
      );
      return;
    }

    await interaction.deferReply();

    const until = new Date(Date.now() + seconds * 1000);

    // 이미 걸려 있으면 기간만 늘린다 — 걸기 전 별명은 처음 것을 그대로 지킨다.
    // 안 그러면 두 번째 실행에서 「타살버맞」 이 원래 별명으로 저장돼 영영 못 되돌린다.
    const previousNickname = current?.previousNickname ?? target.nickname;

    try {
      const role = await ensureMuteRole(interaction.guild);

      await target.setNickname(NICKNAME, `타살버 — ${interaction.user.tag}`);

      await setState(interaction.guildId, {
        userId: target.id,
        until: until.getTime(),
        appliedBy: interaction.user.id,
        appliedAt: Date.now(),
        channelId: interaction.channelId,
        messageId: await interaction
          .fetchReply()
          .then((message) => message.id)
          .catch(() => null),
        previousNickname,
      });

      scheduleEnd(interaction.client, interaction.guildId, target.id, until.getTime());
      startLoop(interaction.client, interaction.guildId, target.id, role.id);
    } catch (error) {
      logger.error("타살버 적용 실패", error);

      await interaction.editReply(
        editResponse({
          status: "failure",
          title: "타살버 실패",
          description: "타살버를 걸지 못했습니다.",
          error,
          fields: [{ name: "대상", value: `<@${target.id}>` }],
          user: interaction.user,
        }),
      );
      return;
    }

    await interaction.editReply(
      editResponse({
        status: "success",
        title: "타살버 — 적용",
        description: `<@${target.id}> 님에게 ${formatDuration(seconds)} 동안 타살버를 걸었습니다.`,
        fields: [
          { name: "대상", value: `<@${target.id}>` },
          { name: "풀리는 시각", value: atWithCountdown(until) },
        ],
        user: interaction.user,
      }),
    );
  },
});
