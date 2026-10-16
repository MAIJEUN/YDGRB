import { PermissionFlagsBits } from "discord.js";
import type { Guild, GuildMember, Message, Role } from "discord.js";

import { logger } from "../logger.js";
import {
  ACTION,
  FUNC,
  FUNC_LABEL,
  MAX_ALLOWED_ROLES,
  MAX_TARGETS,
  PANEL,
  ROLE,
  isFunc,
  isPanelKind,
} from "../roles/ids.js";
import type { AdminFunc } from "../roles/ids.js";
import { allowedRoles, pruneMissingRoles, setAllowedRoles } from "../roles/store.js";
import {
  canManage,
  manageableHeld,
  noticeView,
  panelView,
  shared,
  tooManyToGrant,
  usableRoles,
} from "../roles/views.js";
import { editResponse, response, updateResponse, type MessageOptions } from "../ui/response.js";
import { speak } from "../ui/tone.js";
import { defineComponentHandler, type ComponentInteraction } from "../types.js";

/**
 * 역할 패널의 드롭다운·버튼.
 *
 * customId 규칙:
 *   `role:panel:<유저|관리자>` · `role:pick:<기능|->` · `role:open:<기능|->`
 *   `role:allow` · `role:grant` · `role:toggle`
 *
 * **유저 쪽에는 권한을 묻지 않는다.** 그게 이 시스템이 있는 이유다. 대신 명단에 없는
 * 역할은 여기서 막는다 — 드롭다운이 보내온 값을 그대로 믿으면 아무 역할이나 붙일 수 있다.
 *
 * 관리자 쪽은 반대다. 누를 때마다 권한을 다시 본다 — customId 는 누구나 흉내 낼 수 있다.
 *
 * 관리자 쪽의 **대상은 customId 가 아니라 패널의 유저 드롭다운**에서 읽는다
 * ([targetsOf](#targetsOf)). 여럿을 고를 수 있어 id 를 다 실으면 100자를 넘고, 그렇게 하면
 * 관리자가 보고 있는 사람과 손대는 사람이 갈라질 수도 없다.
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
        await pickUsers(interaction, rest[0]);
        return;

      case ACTION.open:
        await openFunc(interaction, rest[0]);
        return;

      case ACTION.allow:
        await allow(interaction);
        return;

      case ACTION.grant:
        await grant(interaction);
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
 * 버튼은 관리자에게만 보이지만, 눌린 것을 그대로 믿지 않고 여기서 다시 확인한다.
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

/**
 * 관리자가 대상 유저를 골랐다 — 한 명이든 여럿이든.
 *
 * 펴 둔 기능은 그대로 들고 간다 — 「지급/회수」 를 펴 놓고 사람을 바꾸면 그 사람들 것이
 * 이어서 보인다. 사람마다 버튼을 다시 누르게 할 이유가 없다.
 */
async function pickUsers(
  interaction: ComponentInteraction,
  rawFunc: string | undefined,
): Promise<void> {
  if (!interaction.isUserSelectMenu()) return;
  if (!interaction.inCachedGuild()) return;
  if (await denyNonAdmin(interaction)) return;

  const targetIds = interaction.values.slice(0, MAX_TARGETS);
  if (targetIds.length === 0) return;

  await showAdmin(interaction, targetIds, isFunc(rawFunc) ? rawFunc : null);
}

/**
 * 기능을 펴고 접는다.
 *
 * customId 에 **눌렀을 때 갈 상태**가 실려 있다 — 편 것을 다시 누르면 접힌다.
 */
async function openFunc(interaction: ComponentInteraction, rawFunc: string | undefined): Promise<void> {
  if (!interaction.isButton()) return;
  if (!interaction.inCachedGuild()) return;
  if (await denyNonAdmin(interaction)) return;

  const targetIds = targetsOf(interaction);
  if (targetIds.length === 0) {
    await lostTargets(interaction);
    return;
  }

  await showAdmin(interaction, targetIds, isFunc(rawFunc) ? rawFunc : null);
}

/**
 * 「권한」 — 고른 사람들이 스스로 켜고 끌 수 있는 역할을 정했다.
 *
 * 드롭다운은 **모두에게 열린 것**을 골라 둔 채로 떴다. 그래서 —
 *
 *   더한 것   (골랐는데 모두에게 열려 있지 않던 것) → 모두에게 연다
 *   풀어 낸 것 (모두에게 열려 있었는데 안 고른 것)   → 모두에게서 닫는다
 *   일부에게만 열린 것                              → 드롭다운에 없었으니 그대로 둔다
 *
 * 한 사람만 골랐으면 그 사람 명단이 그대로 떴으므로 「이만큼으로 정한다」 와 같다.
 *
 * 새로 연 역할은 **바로 붙여 둔다** (아래에 이유).
 */
async function allow(interaction: ComponentInteraction): Promise<void> {
  if (!interaction.isRoleSelectMenu()) return;
  if (!interaction.inCachedGuild()) return;
  if (await denyNonAdmin(interaction)) return;

  const targetIds = targetsOf(interaction);
  if (targetIds.length === 0) {
    await lostTargets(interaction);
    return;
  }

  // 열어 준 역할을 사람마다 붙여 주므로 3초를 넘길 수 있다. 먼저 받았다고 답해 둔다.
  await interaction.deferUpdate();

  const guild = interaction.guild;
  const picked = interaction.values.slice(0, MAX_ALLOWED_ROLES);

  const lists = await Promise.all(targetIds.map((id) => allowedRoles(guild.id, id)));
  const before = shared(lists);

  // 봇이 못 만지는 역할은 명단에 넣어 봐야 유저 쪽에서 눌렀을 때 실패한다. 여기서 가른다.
  const added = picked.filter((id) => !before.includes(id));
  const usable = added.filter((id) => canManageId(guild, id));
  const stuck = added.filter((id) => !usable.includes(id));
  const removed = before.filter((id) => !picked.includes(id));

  let full = 0;
  for (const [index, id] of targetIds.entries()) {
    const current = lists[index] ?? [];
    const next = [...current.filter((roleId) => !removed.includes(roleId)), ...usable.filter((roleId) => !current.includes(roleId))];

    // 스물다섯을 넘는 사람은 저장소가 뒤를 자른다. 몇 명이 그랬는지는 따로 센다.
    if (next.length > MAX_ALLOWED_ROLES) full += 1;
    await setAllowedRoles(guild.id, id, next);
  }

  /**
   * **새로 열어 준 역할은 바로 붙여 둔다.**
   *
   * 열어 주는 것은 대개 「이 역할을 가져라, 대신 싫으면 스스로 빼라」 다. 열어만 두고 안
   * 붙이면 받은 사람이 유저 패널을 찾아가 직접 켜야 비로소 가진다.
   *
   * 이미 가진 사람에게는 다시 붙이지 않는다. **닫은 역할은 떼지 않는다** — 닫는 것은 「이제
   * 스스로 못 만진다」 이지 「빼앗는다」 가 아니다. 빼앗으려면 「지급/회수」 를 쓴다.
   */
  const opened = usable
    .map((id) => guild.roles.cache.get(id))
    .filter((role): role is Role => role !== undefined);

  const targets = opened.length === 0 ? [] : await fetchMembers(guild, targetIds);
  const failed: { readonly userId: string; readonly role: Role }[] = [];

  for (const target of targets) {
    const give = opened.filter((role) => !target.roles.cache.has(role.id));
    for (const role of await applyRoles(target, give, [])) failed.push({ userId: target.id, role });
  }

  await showAdmin(interaction, targetIds, FUNC.allow);

  if (opened.length === 0 && stuck.length === 0 && full === 0) return;

  // 무슨 일이 있었는지는 따로 낸다 (규칙 12). 화면은 이미 담긴 것을 보여 주고 있다.
  const problems = failed.length + stuck.length + full;

  await aside(
    interaction,
    noticeView({
      status: problems === 0 ? "success" : opened.length === 0 ? "failure" : "progress",
      title: `역할 · ${FUNC_LABEL.allow}`,
      description: [
        targetIds.map((id) => `<@${id}>`).join(" "),
        opened.length === 0
          ? speak("새로 열어 준 역할이 없습니다.")
          : speak(`${mentionRoles(opened.map((role) => role.id))} 를 열고, 없던 사람에게는 바로 붙여 두었습니다.`),
      ].join("\n"),
      fields: [
        ...stuckField(stuck),
        ...(stuck.length === 0
          ? []
          : [{ name: "어떻게 하나", value: speak("서버 설정에서 봇 역할을 그 역할들보다 위로 올려 주세요.") }]),
        ...(failed.length === 0
          ? []
          : [
              {
                name: "붙이지 못한 것",
                value: failed.map((entry) => `<@${entry.userId}> — <@&${entry.role.id}>`).join("\n"),
              },
            ]),
        ...(full === 0
          ? []
          : [{ name: "다 담지 못한 사람", value: speak(`${full}명은 열어 준 역할이 ${MAX_ALLOWED_ROLES}개를 넘어 뒤가 잘렸습니다.`) }]),
      ],
      user: interaction.user,
      panel: PANEL.admin,
      isAdmin: true,
    }),
  );
}

/**
 * 「지급/회수」 — 고른 사람들의 역할을 지금 바로 붙였다 뗀다.
 *
 * 드롭다운은 **모두 가진 것**을 골라 둔 채로 떴다. 「권한」 과 같은 규칙이다 —
 * 더한 것은 모두에게 붙이고, 풀어 낸 것은 모두에게서 떼고, 일부만 가진 것은 그대로 둔다.
 *
 * 명단과 상관없다. 관리자가 직접 주고 뺏는 자리라, 서버의 아무 역할이나 실려 올 수 있다.
 * **뺄 수 있는 것은 봇이 만질 수 있는 것뿐**이라, 그 밖의 역할은 골라 두지도 않았고
 * 여기서도 건드리지 않는다.
 *
 * 사람 수만큼 역할을 붙였다 떼므로 3초 안에 끝난다는 보장이 없다. **먼저 「받았다」고
 * 답해 두고** 일을 한 뒤 패널을 고친다 — 안 그러면 디스코드가 「응답하지 않음」 을 띄운다.
 */
async function grant(interaction: ComponentInteraction): Promise<void> {
  if (!interaction.isRoleSelectMenu()) return;
  if (!interaction.inCachedGuild()) return;
  if (await denyNonAdmin(interaction)) return;

  const targetIds = targetsOf(interaction);
  if (targetIds.length === 0) {
    await lostTargets(interaction);
    return;
  }

  await interaction.deferUpdate();

  const guild = interaction.guild;
  const targets = await fetchMembers(guild, targetIds);

  if (targets.length === 0) {
    await aside(interaction, refused(interaction, speak("고른 사람을 찾지 못했습니다.")));
    return;
  }

  const picked = interaction.values;
  const before = shared(targets.map((target) => manageableHeld(target).map((role) => role.id)));

  const add = picked
    .filter((id) => !before.includes(id) && canManageId(guild, id))
    .map((id) => guild.roles.cache.get(id))
    .filter((role): role is Role => role !== undefined);
  const remove = before
    .filter((id) => !picked.includes(id))
    .map((id) => guild.roles.cache.get(id))
    .filter((role): role is Role => role !== undefined);

  const stuck = picked.filter((id) => !before.includes(id) && !canManageId(guild, id));

  // 사람마다 이미 가진 것은 다시 붙이지 않고, 없는 것은 떼려 들지 않는다.
  const failed: { readonly userId: string; readonly role: Role }[] = [];
  let tried = 0;

  for (const target of targets) {
    const give = add.filter((role) => !target.roles.cache.has(role.id));
    const take = remove.filter((role) => target.roles.cache.has(role.id));
    tried += give.length + take.length;

    for (const role of await applyRoles(target, give, take)) failed.push({ userId: target.id, role });
  }

  // 패널은 그 자리에 새 상태로 다시 그린다 (규칙 12).
  await showAdmin(interaction, targetIds, FUNC.grant);

  if (add.length + remove.length + stuck.length === 0) return;

  const failedRoles = failed.map((entry) => entry.role);

  await aside(
    interaction,
    noticeView({
      status: statusOf(tried, failed.length + stuck.length),
      title: `역할 · ${FUNC_LABEL.grant}`,
      description: [
        targets.map((target) => `<@${target.id}>`).join(" "),
        describe(add, remove, failedRoles),
      ].join("\n"),
      fields: [
        ...stuckField(stuck),
        ...(failed.length === 0
          ? []
          : [
              {
                name: "붙이거나 떼지 못한 것",
                value: failed.map((entry) => `<@${entry.userId}> — <@&${entry.role.id}>`).join("\n"),
              },
            ]),
      ],
      user: interaction.user,
      panel: PANEL.admin,
      isAdmin: true,
    }),
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

  const roles = usableRoles(guild, await allowedRoles(guild.id, member.id));

  // 지워졌거나 못 만지게 된 역할은 명단에서도 걷어 낸다.
  await pruneMissingRoles(guild.id, member.id, roles.map((role) => role.id));

  // 열어 준 것이 없으면 패널 본문이 이미 그 말을 한다. 알림을 겹쳐 놓지 않는다.
  if (roles.length === 0) {
    await replaceView(interaction, await panelView(member, PANEL.user, isAdmin(interaction)));
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

  // 여러 개를 한 번에 바꾸면 3초를 넘길 수 있다. 먼저 받았다고 답해 둔다.
  await interaction.deferUpdate();

  const failed = await applyRoles(member, add, remove);

  // **패널은 그 자리에 그대로 둔다** (규칙 12). 드롭다운은 지금 가진 것을 비추는 것이라,
  // 알림으로 덮으면 방금 무엇을 가졌는지도, 다음에 무엇을 고를지도 사라진다.
  await replaceView(interaction, await panelView(member, PANEL.user, isAdmin(interaction)));

  await aside(
    interaction,
    noticeView({
      status: statusOf(add.length + remove.length, failed.length),
      title: "역할",
      description: describe(add, remove, failed),
      fields: stuckField(failed.map((role) => role.id)),
      user: interaction.user,
      panel: PANEL.user,
      isAdmin: isAdmin(interaction),
    }),
  );
}

/**
 * 관리자 패널을 그 자리에 다시 그린다. 「지급/회수」 를 편 때만 대상들의 지금 역할이 필요하다.
 */
async function showAdmin(
  interaction: ComponentInteraction,
  targetIds: readonly string[],
  func: AdminFunc | null,
): Promise<void> {
  if (!interaction.inCachedGuild()) return;

  const targets = func === FUNC.grant ? await fetchMembers(interaction.guild, targetIds) : [];

  // 모두 가진 역할이 드롭다운에 다 안 담기면 열지 않는다 — 못 담긴 것이 그 자리에서
  // 벗겨진다. 그 말을 따로 하고 기능은 접어 둔 채로 그린다.
  if (targets.length > 0 && tooManyToGrant(targets)) {
    await replaceView(interaction, await panelView(interaction.member, PANEL.admin, true, targetIds, null));
    await aside(
      interaction,
      noticeView({
        status: "failure",
        title: speak("지급/회수를 열 수 없어요"),
        description: speak(
          `고른 사람들이 모두 가진, 봇이 만질 수 있는 역할이 **${MAX_ALLOWED_ROLES}개**보다 많습니다.`,
        ),
        fields: [
          { name: "왜", value: speak("드롭다운이 그만큼만 골라 둘 수 있어, 못 담긴 것이 그 자리에서 벗겨집니다.") },
        ],
        user: interaction.user,
        panel: PANEL.admin,
        isAdmin: true,
      }),
    );
    return;
  }

  await replaceView(
    interaction,
    await panelView(interaction.member, PANEL.admin, true, targetIds, func, targets),
  );
}

/**
 * 패널이 지금 띄우고 있는 대상 — **그 패널의 유저 드롭다운에 골라 둔 사람들.**
 *
 * customId 에 실을 수 없으므로(스물다섯 명이면 100자를 넘는다) 눌린 메시지에서 그 드롭다운을
 * 찾아 읽는다. 봇이 그려 둔 메시지라 흉내 낼 수 없고, 관리자가 보고 있는 사람이 곧 대상이다.
 */
export function targetsOf(interaction: ComponentInteraction): string[] {
  if (!interaction.isMessageComponent()) return [];
  return pickedUsers(interaction.message);
}

interface Node {
  readonly type?: number;
  readonly custom_id?: string;
  readonly default_values?: readonly { readonly id: string }[];
  readonly components?: readonly Node[];
  readonly component?: Node;
}

/** 메시지의 컴포넌트 나무를 훑어 유저 드롭다운(type 5)의 골라 둔 값을 꺼낸다. */
export function pickedUsers(message: Pick<Message, "components">): string[] {
  const visit = (node: Node): string[] | null => {
    if (node.type === 5 && node.custom_id?.startsWith(`${ROLE}:${ACTION.pick}`) === true) {
      return (node.default_values ?? []).map((value) => value.id);
    }

    for (const child of [...(node.components ?? []), ...(node.component === undefined ? [] : [node.component])]) {
      const found = visit(child);
      if (found !== null) return found;
    }
    return null;
  };

  for (const top of message.components) {
    const found = visit(top.toJSON() as Node);
    if (found !== null) return found.slice(0, MAX_TARGETS);
  }
  return [];
}

/** 대상이 사라졌다 — 패널이 너무 오래됐거나 모양이 바뀐 것이다. */
async function lostTargets(interaction: ComponentInteraction): Promise<void> {
  await aside(interaction, refused(interaction, speak("누구를 골랐는지 잃어버렸습니다. 유저를 다시 골라 주세요.")));
}

/** 고른 사람들을 한 번에 불러온다. 서버를 떠난 사람은 빠진다. */
async function fetchMembers(guild: Guild, ids: readonly string[]): Promise<GuildMember[]> {
  if (ids.length === 0) return [];

  const found = await guild.members.fetch({ user: [...ids] }).catch(() => null);
  if (found === null) return [];

  // 고른 차례 그대로 — 화면에 적는 차례와 드롭다운의 차례가 어긋나지 않게.
  return ids.map((id) => found.get(id)).filter((member): member is GuildMember => member !== undefined);
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

/** 전부 됐으면 초록, 전부 안 됐으면 빨강, 반쯤이면 노랑. */
function statusOf(tried: number, failed: number): "success" | "progress" | "failure" {
  if (failed === 0) return "success";
  return tried === 0 || tried <= failed ? "failure" : "progress";
}

function stuckField(ids: readonly string[]): { name: string; value: string }[] {
  return ids.length === 0 ? [] : [{ name: "손대지 못한 역할", value: mentionRoles(ids) }];
}

function mentionRoles(ids: readonly string[]): string {
  return ids.map((id) => `<@&${id}>`).join(" ");
}

function canManageId(guild: Guild, id: string): boolean {
  const role = guild.roles.cache.get(id);
  return role !== undefined && canManage(guild, role);
}

/**
 * 패널을 그 자리에서 다시 그린다. 드롭다운이 지금 상태를 비추게 하는 유일한 길이다.
 *
 * 먼저 「받았다」고만 답해 둔 인터랙션(deferUpdate)이면 그 답을 고친다.
 */
async function replaceView(
  interaction: ComponentInteraction,
  view: MessageOptions,
): Promise<void> {
  if (interaction.isMessageComponent()) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(editResponse(view));
      return;
    }

    await interaction.update(updateResponse(view));
    return;
  }

  await interaction.reply(response(view));
}

/**
 * 알림을 **따로** 낸다 — 패널을 밀어내지 않고 그 옆에 붙인다 (규칙 12).
 *
 * 패널 자리에 결과를 그리면 드롭다운이 사라져 한 번 쓰고 끝나는 화면이 된다. 무슨 일이
 * 있었는지는 알아야 하지만, 그것 때문에 쓰던 것을 빼앗지는 않는다.
 *
 * 패널이 누른 사람에게만 보이므로 이 알림도 그 사람에게만 간다.
 */
async function aside(interaction: ComponentInteraction, view: MessageOptions): Promise<void> {
  if (!interaction.isRepliable()) return;

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(response(view));
    return;
  }

  await interaction.reply(response(view));
}

function refused(interaction: ComponentInteraction, description: string): MessageOptions {
  return { status: "failure", title: "역할", description, user: interaction.user };
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
