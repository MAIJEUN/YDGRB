import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Guild, GuildMember, NonThreadGuildBasedChannel, Role } from "discord.js";

import { logger } from "../logger.js";
import { editResponse, response } from "../ui/response.js";
import { defineCommand } from "../types.js";

/**
 * 역할의 채팅을 켜고 끈다.
 *
 * **채널 권한 덮어쓰기**로 막는다. 역할 자체의 권한을 끄는 방법은 쓸 수 없다 —
 * 서버 권한은 가진 역할끼리 **더해지기** 때문에, `@손님` 의 메시지 보내기를 꺼도
 * `@everyone` 이 허용하는 동안에는 아무 일도 일어나지 않는다.
 * 채널 덮어쓰기의 차단은 역할 권한을 이기므로 이쪽만 확실히 동작한다.
 */

const OPTION = { role: "역할" } as const;

/** 진행률을 갱신하는 간격. 메시지 수정에도 요청 제한이 있다. */
const PROGRESS_INTERVAL = 1_500;

/**
 * 역할 이름을 그대로 코드로 적는다 — 역할 멘션을 쓰면 알림이 갈 수 있다.
 * (`@everyone` 을 멘션하면 서버 전체에 알림이 간다)
 *
 * `@everyone` 과 `@here` 는 이름 자체에 `@` 가 들어 있어서 또 붙이면 `@@everyone` 이 된다.
 */
function label(role: Role): string {
  return `\`${role.name.startsWith("@") ? role.name : `@${role.name}`}\``;
}

/** 이 역할의 채팅을 막을 수 있는지. */
function whyNotEditable(guild: Guild, role: Role, actor: GuildMember): string | undefined {
  // 관리자는 모든 권한을 갖고, 채널 덮어쓰기의 차단도 무시한다.
  if (role.permissions.has(PermissionFlagsBits.Administrator, false)) {
    return "**관리자** 권한이 있는 역할입니다. 관리자는 채널 차단도 무시하기 때문에 채팅만 따로 막을 수 없어요.";
  }

  const me = guild.members.me;
  if (me === null || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return "봇에게 **역할 관리(Manage Roles)** 권한을 주세요.";
  }

  // 서버 소유자는 서열과 무관하게 다 만질 수 있다.
  if (guild.ownerId !== actor.id && actor.roles.highest.comparePositionTo(role) <= 0) {
    return "자신의 역할보다 높거나 같은 역할은 바꿀 수 없습니다.";
  }

  return undefined;
}

/**
 * 덮어쓰기를 바꿀 수 있는 채널들.
 *
 * 스레드는 부모 채널의 권한을 물려받으므로 건드리지 않는다.
 * 카테고리는 포함한다 — 나중에 만들어지는 채널도 같은 상태로 시작한다.
 */
function targetChannels(guild: Guild): NonThreadGuildBasedChannel[] {
  const me = guild.members.me;
  if (me === null) return [];

  const targets: NonThreadGuildBasedChannel[] = [];

  // filter() 로는 스레드가 타입에서 걸러지지 않아 루프로 모은다.
  for (const channel of guild.channels.cache.values()) {
    if (channel.isThread()) continue;
    if (!channel.permissionsFor(me).has(PermissionFlagsBits.ManageRoles)) continue;
    targets.push(channel);
  }

  return targets;
}

/** 모든 대상 채널에서 이미 막혀 있으면 "막힌 상태" 로 본다. */
function isBlocked(channels: readonly NonThreadGuildBasedChannel[], role: Role): boolean {
  return (
    channels.length > 0 &&
    channels.every(
      (channel) =>
        channel.permissionOverwrites.cache
          .get(role.id)
          ?.deny.has(PermissionFlagsBits.SendMessages) === true,
    )
  );
}

interface Tally {
  readonly total: number;
  done: number;
  failed: number;
}

function tallyText(tally: Tally): string {
  return `전체 **${tally.total}개** · 완료 **${tally.done - tally.failed}개** · 실패 **${tally.failed}개**`;
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("채팅뻥")
    .setDescription("역할의 채팅 권한(메시지 보내기)을 켜고 끕니다.")
    .setContexts(InteractionContextType.Guild)
    // 디스코드 쪽에서도 권한 없는 사람에게는 아예 안 보이게 한다.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addRoleOption((option) =>
      option.setName(OPTION.role).setDescription("비우면 @everyone (서버 전체)"),
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

    const { guild } = interaction;

    // 역할 선택기에 @everyone 이 안 보이는 경우가 있어, 비워 두면 @everyone 으로 본다.
    const picked = interaction.options.getRole(OPTION.role);
    const role = picked === null ? guild.roles.everyone : await guild.roles.fetch(picked.id);

    if (role === null) {
      await interaction.reply(
        response({
          status: "failure",
          title: "역할을 찾지 못했습니다",
          description: "방금 지워진 역할일 수 있어요.",
          user: interaction.user,
        }),
      );
      return;
    }

    const blocked = whyNotEditable(guild, role, interaction.member);
    if (blocked !== undefined) {
      await interaction.reply(
        response({
          status: "failure",
          title: "채팅뻥 실패",
          description: blocked,
          fields: [{ name: "역할", value: label(role) }],
          user: interaction.user,
        }),
      );
      return;
    }

    const channels = targetChannels(guild);
    if (channels.length === 0) {
      await interaction.reply(
        response({
          status: "failure",
          title: "채팅뻥 실패",
          description:
            "권한을 바꿀 수 있는 채널이 없습니다. 봇이 채널을 볼 수 있고 **역할 관리** 권한이 있는지 확인해 주세요.",
          fields: [{ name: "역할", value: label(role) }],
          user: interaction.user,
        }),
      );
      return;
    }

    // 이미 전부 막혀 있으면 풀고, 아니면 막는다.
    const wasBlocked = isBlocked(channels, role);
    const subject = `${label(role)} 의 채팅을 모든 채널에서 ${wasBlocked ? "풉니다" : "막습니다"}.`;

    await interaction.deferReply();

    const tally: Tally = { total: channels.length, done: 0, failed: 0 };
    let lastUpdate = 0;

    for (const channel of channels) {
      try {
        // edit 은 지정한 권한만 손댄다 — 같은 덮어쓰기의 다른 항목은 그대로 둔다.
        // null 을 주면 덮어쓰기에서 빼서 원래대로(상속) 되돌린다.
        await channel.permissionOverwrites.edit(
          role,
          { SendMessages: wasBlocked ? null : false },
          { reason: `채팅뻥 — ${interaction.user.tag}` },
        );
      } catch (error) {
        tally.failed += 1;
        logger.warn(`채팅뻥: #${channel.name} 실패 — ${String(error)}`);
      }

      tally.done += 1;

      const now = Date.now();
      if (now - lastUpdate >= PROGRESS_INTERVAL && tally.done < tally.total) {
        lastUpdate = now;
        await interaction.editReply(
          editResponse({
            status: "progress",
            title: "채팅뻥 진행 중",
            description: subject,
            fields: [{ name: "집계", value: tallyText(tally) }],
            user: interaction.user,
          }),
        );
      }
    }

    // 한 채널도 못 바꿨으면 실패, 일부만 못 바꿨으면 진행중(노랑)으로 구분한다.
    const status =
      tally.failed === 0 ? "success" : tally.failed === tally.total ? "failure" : "progress";

    await interaction.editReply(
      editResponse({
        status,
        title: wasBlocked ? "채팅뻥 — 켰습니다" : "채팅뻥 — 껐습니다",
        description: subject,
        fields: [
          {
            name: "메시지 보내기",
            value: `${wasBlocked ? "차단" : "허용"} → **${wasBlocked ? "허용" : "차단"}**`,
          },
          { name: "집계", value: tallyText(tally) },
        ],
        user: interaction.user,
      }),
    );
  },
});
