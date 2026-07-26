import {
  InteractionContextType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { Guild, GuildMember, Role } from "discord.js";

import { describeError } from "../errors.js";
import { editResponse, response } from "../ui/response.js";
import { defineCommand } from "../types.js";

const OPTION = { role: "역할" } as const;

/**
 * 역할 이름을 그대로 코드로 적는다 — 멘션을 쓰면 알림이 갈 수 있다.
 *
 * `@everyone` 과 `@here` 는 이름 자체에 `@` 가 들어 있어서 또 붙이면 `@@everyone` 이 된다.
 */
function label(role: Role): string {
  return `\`${role.name.startsWith("@") ? role.name : `@${role.name}`}\``;
}

/**
 * 이 역할을 봇이 건드릴 수 있는지.
 *
 * 디스코드 규칙상 자기보다 높거나 같은 역할은 바꿀 수 없고,
 * 봇·연동이 관리하는 역할은 누구도 바꿀 수 없다.
 */
function whyNotEditable(guild: Guild, role: Role, actor: GuildMember): string | undefined {
  if (role.managed) {
    return "봇이나 연동이 관리하는 역할이라 아무도 권한을 바꿀 수 없습니다.";
  }

  const me = guild.members.me;
  if (me === null || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return "봇에게 **역할 관리(Manage Roles)** 권한을 주세요.";
  }

  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return "이 역할이 봇의 역할보다 높습니다. 서버 설정 > 역할 에서 봇 역할을 더 위로 올려 주세요.";
  }

  // 서버 소유자는 서열과 무관하게 다 만질 수 있다.
  if (guild.ownerId !== actor.id && actor.roles.highest.comparePositionTo(role) <= 0) {
    return "자신의 역할보다 높거나 같은 역할은 바꿀 수 없습니다.";
  }

  return undefined;
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
          title: "권한을 바꿀 수 없습니다",
          description: blocked,
          fields: [{ name: "역할", value: label(role) }],
          user: interaction.user,
        }),
      );
      return;
    }

    const wasAllowed = role.permissions.has(PermissionFlagsBits.SendMessages);

    const permissions = new PermissionsBitField(role.permissions.bitfield);
    if (wasAllowed) permissions.remove(PermissionFlagsBits.SendMessages);
    else permissions.add(PermissionFlagsBits.SendMessages);

    await interaction.deferReply();

    try {
      await role.setPermissions(permissions, `채팅뻥 — ${interaction.user.tag}`);
    } catch (error) {
      await interaction.editReply(
        editResponse({
          status: "failure",
          title: "채팅뻥 실패",
          description: "역할 권한을 바꾸지 못했습니다.",
          fields: [
            { name: "역할", value: label(role) },
            { name: "원인", value: `\`\`\`\n${describeError(error)}\n\`\`\`` },
          ],
          user: interaction.user,
        }),
      );
      return;
    }

    await interaction.editReply(
      editResponse({
        status: "success",
        title: wasAllowed ? "채팅뻥 — 껐습니다" : "채팅뻥 — 켰습니다",
        description: `${label(role)} 의 채팅을 ${wasAllowed ? "막았습니다" : "풀었습니다"}.`,
        fields: [
          {
            name: "메시지 보내기",
            value: `${wasAllowed ? "켜짐" : "꺼짐"} → **${wasAllowed ? "꺼짐" : "켜짐"}**`,
          },
        ],
        user: interaction.user,
      }),
    );
  },
});
