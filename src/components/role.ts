import { PermissionFlagsBits } from "discord.js";
import type { GuildMember, Role } from "discord.js";

import { logger } from "../logger.js";
import { ACTION, MAX_ALLOWED_ROLES, PANEL, ROLE, isPanelKind } from "../roles/ids.js";
import { allowedRoles, pruneMissingRoles, setAllowedRoles } from "../roles/store.js";
import { canManage, noticeView, panelView, usableRoles } from "../roles/views.js";
import { response, updateResponse, type MessageOptions } from "../ui/response.js";
import { speak } from "../ui/tone.js";
import { defineComponentHandler, type ComponentInteraction } from "../types.js";

/**
 * 역할 패널의 드롭다운과 패널 전환 버튼.
 *
 * customId 규칙: `role:panel:<유저|관리자>` · `role:pick` · `role:allow:<유저>` · `role:toggle`
 *
 * **유저 쪽에는 권한을 묻지 않는다.** 그게 이 시스템이 있는 이유다. 대신 명단에 없는
 * 역할은 여기서 막는다 — 드롭다운이 보내온 값을 그대로 믿으면 아무 역할이나 붙일 수 있다.
 */
export default defineComponentHandler({
  namespace: ROLE,

  async execute(interaction, args) {
    if (!interaction.inCachedGuild()) return;

    const [action, ...rest] = args;

    switch (action) {
      case ACTION.panel:
        await switchPanel(interaction, rest[0]);
        return;

      case ACTION.pick:
        await pickUser(interaction);
        return;

      case ACTION.allow:
        await allow(interaction, rest[0] ?? "");
        return;

      case ACTION.toggle:
        await toggle(interaction);
        return;

      default:
        return;
    }
  },
});

/**
 * 유저 패널 ↔ 관리자 패널 전환.
 *
 * 버튼은 관리자에게만 보이지만, 눌린 것을 그대로 믿지 않고 여기서 다시 확인한다 —
 * customId 는 누구나 흉내 낼 수 있다.
 */
async function switchPanel(
  interaction: ComponentInteraction,
  target: string | undefined,
): Promise<void> {
  if (!interaction.inCachedGuild()) return;

  const admin = isAdmin(interaction);
  const panel = isPanelKind(target) && admin ? target : PANEL.user;

  await replaceView(interaction, await panelView(interaction.member, panel, admin));
}

/** 관리자가 대상 유저를 골랐다. 그 사람 몫의 역할 드롭다운이 아래에 붙는다. */
async function pickUser(interaction: ComponentInteraction): Promise<void> {
  if (!interaction.isUserSelectMenu()) return;
  if (!interaction.inCachedGuild()) return;
  if (await denyNonAdmin(interaction)) return;

  const targetId = interaction.values[0];
  if (targetId === undefined) return;

  await replaceView(
    interaction,
    await panelView(interaction.member, PANEL.admin, true, targetId),
  );
}

/**
 * 그 사람에게 열어 줄 역할을 정했다.
 *
 * 드롭다운이 「지금 열려 있는 것」을 골라 둔 채로 뜨므로, 여기 실려 온 목록이 곧 결과다.
 * 하나도 안 고르고 냈으면 전부 닫는다.
 */
async function allow(interaction: ComponentInteraction, targetId: string): Promise<void> {
  if (!interaction.isRoleSelectMenu()) return;
  if (!interaction.inCachedGuild()) return;
  if (await denyNonAdmin(interaction)) return;

  if (targetId === "") {
    await replaceView(interaction, refused(interaction, speak("누구에게 열어 줄지를 잃어버렸습니다.")));
    return;
  }

  const guild = interaction.guild;
  const picked = interaction.values.slice(0, MAX_ALLOWED_ROLES);

  // 봇이 못 만지는 역할은 명단에 넣어 봐야 유저 쪽에서 눌렀을 때 실패한다. 여기서 가른다.
  const usable = picked.filter((id) => {
    const role = guild.roles.cache.get(id);
    return role !== undefined && canManage(guild, role);
  });
  const stuck = picked.filter((id) => !usable.includes(id));

  const saved = await setAllowedRoles(guild.id, targetId, usable);

  await replaceView(
    interaction,
    await panelView(interaction.member, PANEL.admin, true, targetId),
  );

  if (stuck.length === 0) return;

  // 일부만 담겼으면 그 말을 따로 한다. 화면은 이미 담긴 것을 보여 주고 있다.
  await interaction.followUp(
    response(
      noticeView({
        status: saved.length === 0 ? "failure" : "progress",
        title: speak("일부는 열어 주지 못했어요"),
        description: speak(`${stuck.map((id) => `<@&${id}>`).join(" ")} 는 봇이 만질 수 없습니다.`),
        fields: [{ name: "어떻게 하나", value: speak("서버 설정에서 봇 역할을 그 역할들보다 위로 올려 주세요.") }],
        user: interaction.user,
        panel: PANEL.admin,
        isAdmin: true,
      }),
    ),
  );
}

/**
 * 유저가 자기 역할을 켜고 껐다.
 *
 * 고른 것이 곧 「이걸 갖겠다」다. 열어 준 역할 중 고른 것은 붙이고, 안 고른 것은 뗀다.
 * **열어 주지 않은 역할은 손대지 않는다** — 그 사람이 다른 데서 받은 역할까지 벗기면
 * 이 패널이 남의 것을 건드리는 셈이 된다.
 */
async function toggle(interaction: ComponentInteraction): Promise<void> {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.inCachedGuild()) return;

  const member = interaction.member;
  const guild = interaction.guild;

  const ids = await allowedRoles(guild.id, member.id);
  const roles = usableRoles(guild, ids);

  // 지워졌거나 못 만지게 된 역할은 명단에서도 걷어 낸다.
  await pruneMissingRoles(guild.id, member.id, roles.map((role) => role.id));

  if (roles.length === 0) {
    await replaceView(interaction, refused(interaction, speak("열어 준 역할이 없습니다.")));
    return;
  }

  // 드롭다운이 보내온 값을 그대로 믿지 않는다. 명단에 있는 것만 남긴다.
  const wanted = new Set(interaction.values.filter((id) => roles.some((role) => role.id === id)));

  const add = roles.filter((role) => wanted.has(role.id) && !member.roles.cache.has(role.id));
  const remove = roles.filter((role) => !wanted.has(role.id) && member.roles.cache.has(role.id));

  if (add.length === 0 && remove.length === 0) {
    await replaceView(interaction, await panelView(member, PANEL.user, isAdmin(interaction)));
    return;
  }

  const failed = await applyRoles(member, add, remove);

  await replaceView(
    interaction,
    noticeView({
      status: failed.length === 0 ? "success" : add.length + remove.length === failed.length ? "failure" : "progress",
      title: "역할",
      description: describe(add, remove, failed),
      fields: failed.length === 0 ? [] : [{ name: "붙이지 못한 역할", value: failed.map((role) => `<@&${role.id}>`).join(" ") }],
      user: interaction.user,
      panel: PANEL.user,
      isAdmin: isAdmin(interaction),
    }),
  );
}

/** 실제로 붙였다 뗀다. 하나가 실패해도 나머지는 계속한다. */
async function applyRoles(
  member: GuildMember,
  add: readonly Role[],
  remove: readonly Role[],
): Promise<Role[]> {
  const failed: Role[] = [];

  for (const role of add) {
    try {
      await member.roles.add(role);
    } catch (error) {
      logger.warn(`역할을 붙이지 못했습니다 (${role.id})`, error);
      failed.push(role);
    }
  }

  for (const role of remove) {
    try {
      await member.roles.remove(role);
    } catch (error) {
      logger.warn(`역할을 떼지 못했습니다 (${role.id})`, error);
      failed.push(role);
    }
  }

  return failed;
}

/** 무엇이 붙고 무엇이 떨어졌는지 한 줄로. 실패한 것은 뺀다 — 그건 따로 적는다. */
function describe(add: readonly Role[], remove: readonly Role[], failed: readonly Role[]): string {
  const done = (list: readonly Role[]): string[] =>
    list.filter((role) => !failed.includes(role)).map((role) => `<@&${role.id}>`);

  const put = done(add);
  const off = done(remove);

  const parts: string[] = [];
  if (put.length > 0) parts.push(speak(`${put.join(" ")} 를 받았습니다.`));
  if (off.length > 0) parts.push(speak(`${off.join(" ")} 를 내려놓았습니다.`));

  return parts.length === 0 ? speak("바뀐 것이 없습니다.") : parts.join(" ");
}

async function replaceView(
  interaction: ComponentInteraction,
  view: MessageOptions,
): Promise<void> {
  if (interaction.isMessageComponent()) {
    await interaction.update(updateResponse(view));
    return;
  }

  await interaction.reply(response(view));
}

function refused(interaction: ComponentInteraction, description: string): MessageOptions {
  return {
    status: "failure",
    title: "역할",
    description,
    user: interaction.user,
  };
}

function isAdmin(interaction: ComponentInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
}

/** 관리자가 아니면 안내하고 true 를 돌려준다. 유저 쪽에서는 부르지 않는다. */
async function denyNonAdmin(interaction: ComponentInteraction): Promise<boolean> {
  if (isAdmin(interaction)) return false;
  if (!interaction.isRepliable()) return true;

  await interaction.reply(
    response({
      status: "failure",
      title: speak("권한이 없습니다"),
      description: speak("이 기능은 **관리자** 권한을 가진 사람만 쓸 수 있어요."),
      user: interaction.user,
    }),
  );
  return true;
}
