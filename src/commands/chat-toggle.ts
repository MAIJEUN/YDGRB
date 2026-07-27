import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { GuildBasedChannel, GuildMember, Role } from "discord.js";

import { editResponse, response } from "../ui/response.js";
import { defineCommand } from "../types.js";

/**
 * 역할의 채팅을 **명령을 쓴 채널에서** 켜고 끈다.
 *
 * 채널 권한 덮어쓰기로 막는다. 역할 자체의 권한을 끄는 방법은 쓸 수 없다 —
 * 서버 권한은 가진 역할끼리 **더해지기** 때문에, `@손님` 의 메시지 보내기를 꺼도
 * `@everyone` 이 허용하는 동안에는 아무 일도 일어나지 않는다.
 * 채널 덮어쓰기의 차단은 역할 권한을 이기므로 이쪽만 확실히 동작한다.
 */

const OPTION = { role: "역할" } as const;

/**
 * 역할은 멘션으로 가리킨다 (규칙: 유저·역할을 가리킬 때는 항상 멘션).
 *
 * `Role#toString()` 이 `@everyone` 은 그 문자열로, 나머지는 `<@&id>` 로 만들어 준다.
 * 이름을 직접 이어 붙이지 않으므로 `@@everyone` 이 될 일도 없다.
 *
 * 알림은 렌더러가 `allowed_mentions` 를 비워서 막는다 — 표시만 되고 알림은 안 간다.
 */
function label(role: Role): string {
  return role.toString();
}

/** 이 채널에서 이 역할의 채팅을 막을 수 있는지. */
function whyNotEditable(
  channel: GuildBasedChannel,
  role: Role,
  actor: GuildMember,
): string | undefined {
  // 관리자는 모든 권한을 갖고, 채널 덮어쓰기의 차단도 무시한다.
  if (role.permissions.has(PermissionFlagsBits.Administrator, false)) {
    return "**관리자** 권한이 있는 역할입니다. 관리자는 채널 차단도 무시하기 때문에 채팅만 따로 막을 수 없어요.";
  }

  const me = channel.guild.members.me;
  if (me === null || !channel.permissionsFor(me).has(PermissionFlagsBits.ManageRoles)) {
    return "이 채널에서 봇에게 **역할 관리(Manage Roles)** 권한이 없습니다.";
  }

  // 서버 소유자는 서열과 무관하게 다 만질 수 있다.
  if (channel.guild.ownerId !== actor.id && actor.roles.highest.comparePositionTo(role) <= 0) {
    return "자신의 역할보다 높거나 같은 역할은 바꿀 수 없습니다.";
  }

  return undefined;
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("채팅뻥")
    .setDescription("이 채널에서 역할의 채팅 권한(메시지 보내기)을 켜고 끕니다.")
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

    // 스레드에는 자체 권한이 없다 — 부모 채널의 권한을 물려받으므로 그쪽을 바꾼다.
    const here = interaction.channel;
    const channel = here === null ? null : here.isThread() ? here.parent : here;

    if (channel === null) {
      await interaction.reply(
        response({
          status: "failure",
          title: "채널을 찾지 못했습니다",
          description: "이 채널의 권한을 읽을 수 없어요. 스레드라면 부모 채널에서 다시 시도해 주세요.",
          user: interaction.user,
        }),
      );
      return;
    }

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

    const blocked = whyNotEditable(channel, role, interaction.member);
    if (blocked !== undefined) {
      await interaction.reply(
        response({
          status: "failure",
          title: "채팅뻥 실패",
          description: blocked,
          fields: [
            { name: "역할", value: label(role) },
            { name: "채널", value: `<#${channel.id}>` },
          ],
          user: interaction.user,
        }),
      );
      return;
    }

    // 이 채널에서 이미 막혀 있으면 풀고, 아니면 막는다.
    const wasBlocked =
      channel.permissionOverwrites.cache
        .get(role.id)
        ?.deny.has(PermissionFlagsBits.SendMessages) === true;

    await interaction.deferReply();

    try {
      // edit 은 지정한 권한만 손댄다 — 같은 덮어쓰기의 다른 항목은 그대로 둔다.
      // null 을 주면 덮어쓰기에서 빼서 원래대로(상속) 되돌린다.
      await channel.permissionOverwrites.edit(
        role,
        { SendMessages: wasBlocked ? null : false },
        { reason: `채팅뻥 — ${interaction.user.tag}` },
      );
    } catch (error) {
      await interaction.editReply(
        editResponse({
          status: "failure",
          title: "채팅뻥 실패",
          description: "채널 권한을 바꾸지 못했습니다.",
          error,
          fields: [
            { name: "역할", value: label(role) },
            { name: "채널", value: `<#${channel.id}>` },
          ],
          user: interaction.user,
        }),
      );
      return;
    }

    await interaction.editReply(
      editResponse({
        status: "success",
        title: wasBlocked ? "채팅뻥 — 켰습니다" : "채팅뻥 — 껐습니다",
        description: `<#${channel.id}> 에서 ${label(role)} 의 채팅을 ${wasBlocked ? "풀었습니다" : "막았습니다"}.`,
        fields: [
          {
            name: "메시지 보내기",
            value: `${wasBlocked ? "차단" : "허용"} → **${wasBlocked ? "허용" : "차단"}**`,
          },
        ],
        user: interaction.user,
      }),
    );
  },
});
