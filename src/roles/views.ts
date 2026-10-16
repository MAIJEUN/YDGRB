import type { Guild, GuildMember, Role, User } from "discord.js";

import type { MessageOptions, ResponseField, Status } from "../ui/response.js";
import { speak } from "../ui/tone.js";
import { FUNC, FUNC_LABEL, MAX_ALLOWED_ROLES, PANEL, type AdminFunc, type PanelKind } from "./ids.js";
import { panelRows, panelSwitchButton } from "./panels.js";
import { allowedRoles } from "./store.js";

/**
 * 역할 패널.
 *
 * 패널은 무언가를 바꾸는 게 아니라 보여 주기만 한다 — 전부 파랑(정보).
 * 실제로 역할이 붙었다 떨어지는 화면만 초록/노랑/빨강을 쓴다 (`noticeView` 호출부 참고).
 */

/**
 * 봇이 이 역할을 붙였다 뗄 수 있는가.
 *
 * @everyone 은 벗길 수도 붙일 수도 없고, `managed` 는 봇·연동이 들고 있는 것이라
 * 사람이 손으로 옮길 수 없다. 그 위로는 봇보다 높은 역할이 남는다.
 */
export function canManage(guild: Guild, role: Role): boolean {
  if (role.id === guild.id || role.managed) return false;
  return role.editable;
}

/**
 * 명단에 적힌 역할 중 **지금 살아 있고 봇이 만질 수 있는** 것만.
 *
 * 지워진 역할이나 못 만지는 역할을 드롭다운에 실어 봐야 눌렀을 때 실패한다. 그리기 전에
 * 걸러 낸다.
 */
export function usableRoles(guild: Guild, ids: readonly string[]): Role[] {
  return ids
    .map((id) => guild.roles.cache.get(id))
    .filter((role): role is Role => role !== undefined && canManage(guild, role));
}

/**
 * 그 사람이 지금 가진 역할 중 **봇이 만질 수 있는** 것.
 *
 * 「지급/회수」 는 이 목록을 골라 둔 채로 뜨고, 이 목록 안에서만 뺀다. 봇이 못 만지는
 * 역할은 애초에 골라 두지 않으므로 실수로 벗기려 들 일도 없다.
 */
export function manageableHeld(member: GuildMember): Role[] {
  return [...member.roles.cache.values()].filter((role) => canManage(member.guild, role));
}

/** 역할 멘션을 늘어놓는다. 없으면 그렇게 적는다. */
function roleList(ids: readonly string[]): string {
  return ids.length === 0 ? speak("_아직 없습니다._") : ids.map((id) => `<@&${id}>`).join(" ");
}

export async function panelView(
  member: GuildMember,
  panel: PanelKind,
  isAdmin: boolean,
  targetIds: readonly string[] = [],
  func: AdminFunc | null = null,
  targets: readonly GuildMember[] = [],
): Promise<MessageOptions> {
  return panel === PANEL.admin
    ? adminPanelView(member, targetIds, func, isAdmin, targets)
    : userPanelView(member, isAdmin);
}

/**
 * 여럿이 **모두** 가진 것 — 첫 목록의 차례 그대로.
 *
 * 여럿을 놓고 드롭다운을 띄울 때 「골라 둔 것」은 이것이다. 일부만 가진 것을 골라 두면
 * 풀었을 때 그걸 가진 사람에게서도 빼고, 안 골라 두면 고른 적 없는 사람에게 붙인다 —
 * 어느 쪽이든 관리자가 손대지 않은 것을 바꾸게 된다.
 */
export function shared(lists: readonly (readonly string[])[]): string[] {
  const [first = [], ...rest] = lists;
  return first.filter((id) => rest.every((list) => list.includes(id)));
}

/** 누군가는 가졌지만 모두가 가지지는 않은 것. 드롭다운에 없으므로 건드리지 않는다. */
export function partly(lists: readonly (readonly string[])[]): string[] {
  const all = [...new Set(lists.flat())];
  const common = shared(lists);
  return all.filter((id) => !common.includes(id));
}

/**
 * 관리자 패널 — 유저를 고르고(여럿도 된다), 그 사람들을 놓고 무엇을 할지 고른다.
 *
 * **목록은 편 기능의 것만 적는다.** 아무것도 안 폈으면 아무 목록도 없다 — 그 화면에서
 * 정할 것은 누구를 고를지, 무엇을 할지뿐이라 어느 목록도 「이 화면의 것」이 아니다.
 *
 * 여럿을 골랐으면 목록이 둘로 갈린다 — **모두**의 것과 **일부**의 것. 드롭다운은 모두의 것만
 * 골라 둔 채로 뜨고, 일부의 것은 건드리지 않는다는 말과 함께 따로 보여 준다.
 */
async function adminPanelView(
  member: GuildMember,
  targetIds: readonly string[],
  func: AdminFunc | null,
  isAdmin: boolean,
  targets: readonly GuildMember[],
): Promise<MessageOptions> {
  const guild = member.guild;

  const base = {
    status: "info" as const,
    title: "역할 · 관리자 패널",
    user: member.user,
    accessoryButton: panelSwitchButton(PANEL.admin, isAdmin),
  };

  // 홈에는 목록을 두지 않는다. 아직 아무 기능도 고르지 않았으므로 어느 목록도 「이
  // 화면의 것」이 아니고, 여기서 정할 것은 누구를 고를지 하나뿐이다.
  if (targetIds.length === 0) {
    return {
      ...base,
      description: [
        speak("**유저**를 고르면 무엇을 할지 고를 수 있습니다. 여럿을 함께 골라도 됩니다."),
        speak(`**${FUNC_LABEL.allow}** — 그 사람이 스스로 켜고 끌 수 있는 역할을 정합니다.`),
        speak(`**${FUNC_LABEL.grant}** — 그 사람의 역할을 지금 바로 붙였다 뗍니다.`),
      ].join("\n"),
      rows: panelRows(PANEL.admin, { targetIds, func }),
    };
  }

  const many = targetIds.length > 1;

  const allowedLists = await Promise.all(targetIds.map((id) => allowedRoles(guild.id, id)));
  const heldLists = targets.map((target) => manageableHeld(target).map((role) => role.id));

  const allowed = shared(allowedLists);
  const held = shared(heldLists);

  /**
   * **편 기능의 것만 적는다.**
   *
   * 「지급/회수」 를 열어 놓고 명단이 함께 떠 있으면, 지금 손대는 것이 둘 중 어느
   * 쪽인지가 흐려진다. 아무것도 안 폈으면 아무 목록도 적지 않는다 — 그때 정할 것은
   * 무엇을 할지 하나뿐이다.
   */
  const fields: ResponseField[] = [];

  if (func === FUNC.allow) {
    fields.push({ name: many ? "모두에게 열린 역할" : "열어 준 역할", value: roleList(allowed) });
    fields.push(...partlyField("일부에게만 열린 역할", partly(allowedLists)));

    // 명단에 있어도 봇이 못 만지는 것이 있으면 미리 말한다 — 유저가 눌러 보고 나서
    // 알게 두면, 왜 안 되는지 물어볼 곳이 관리자밖에 없다.
    const stuck = [...new Set(allowedLists.flat())].filter((id) => {
      const role = guild.roles.cache.get(id);
      return role !== undefined && !canManage(guild, role);
    });

    if (stuck.length > 0) {
      fields.push({
        name: "봇이 만지지 못하는 역할",
        value: [roleList(stuck), speak("봇 역할을 이 역할들보다 위로 올려 주세요.")].join("\n"),
      });
    }
  }

  if (func === FUNC.grant) {
    fields.push({ name: many ? "모두 가진 역할" : "지금 가진 역할", value: roleList(held) });
    fields.push(...partlyField("일부만 가진 역할", partly(heldLists)));
  }

  return {
    ...base,
    description: [targetIds.map((id) => `<@${id}>`).join(" "), guide(func, many)].join("\n"),
    fields,
    rows: panelRows(PANEL.admin, { targetIds, func, allowed, held }),
  };
}

/** 지금 편 기능이 무엇을 하는지 한 줄로. 여럿이면 「모두」 라는 말이 붙는다. */
function guide(func: AdminFunc | null, many: boolean): string {
  if (func === null) return speak("무엇을 할지 고르세요.");

  if (func === FUNC.allow) {
    return many
      ? speak("고른 것은 모두에게 열고, 풀어 낸 것은 모두에게서 닫습니다.")
      : speak("이 사람이 스스로 켜고 끌 수 있는 역할을 정합니다.");
  }

  return many
    ? speak("고른 것은 모두에게 붙이고, 풀어 낸 것은 모두에게서 뗍니다.")
    : speak("고른 것만 남습니다 — 골라 두었던 것을 풀고 내면 벗겨집니다.");
}

/** 「일부」 칸 — 있을 때만. 건드리지 않는다는 말을 함께 붙인다. */
function partlyField(name: string, ids: readonly string[]): ResponseField[] {
  if (ids.length === 0) return [];
  return [{ name, value: [roleList(ids), speak("_여기 있는 것은 건드리지 않습니다._")].join("\n") }];
}

/** 유저 패널 — 열어 준 역할을 켜고 끈다. */
async function userPanelView(member: GuildMember, isAdmin: boolean): Promise<MessageOptions> {
  const ids = await allowedRoles(member.guild.id, member.id);
  const roles = usableRoles(member.guild, ids);
  const held = roles.filter((role) => member.roles.cache.has(role.id)).map((role) => role.id);

  return {
    status: "info",
    title: "역할 · 유저 패널",
    description:
      roles.length === 0
        ? speak("아직 열어 준 역할이 없습니다. 관리자에게 말해 주세요.")
        : speak("고른 것만 남습니다 — 골라 두었던 것을 풀고 내면 벗겨집니다."),
    fields:
      roles.length === 0
        ? []
        : [
            { name: "열려 있는 역할", value: roleList(roles.map((role) => role.id)) },
            { name: "지금 가진 것", value: roleList(held) },
          ],
    user: member.user,
    accessoryButton: panelSwitchButton(PANEL.user, isAdmin),
    rows: panelRows(PANEL.user, { roles, held }),
  };
}

/**
 * 「지급/회수」 를 열 수 있는가.
 *
 * 드롭다운이 스물다섯 개까지만 골라 둘 수 있어서, 그보다 많이 **모두** 가진 경우에는 골라
 * 둘 것을 다 띄울 수가 없다. 그대로 열면 못 띄운 것이 「풀어 낸 것」으로 보여 그 자리에서
 * 벗겨진다. 그래서 아예 열지 않는다. (일부만 가진 것은 애초에 안 띄우므로 상관없다.)
 */
export function tooManyToGrant(targets: readonly GuildMember[]): boolean {
  return shared(targets.map((target) => manageableHeld(target).map((role) => role.id))).length > MAX_ALLOWED_ROLES;
}

export interface NoticeOptions {
  readonly status: Status;
  readonly title: string;
  readonly description: string;
  readonly fields?: ResponseField[];
  readonly user: User;
  readonly panel: PanelKind;
  readonly isAdmin?: boolean;
}

/**
 * 무언가를 바꾸고 나서 **따로** 내는 화면 (규칙 12).
 *
 * 패널 자리에 그리지 않는다 — 드롭다운은 지금 상태를 비추는 것이라, 결과로 덮으면
 * 한 번 쓰고 끝나는 화면이 된다.
 */
export function noticeView(options: NoticeOptions): MessageOptions {
  return {
    status: options.status,
    title: options.title,
    description: options.description,
    fields: options.fields,
    user: options.user,
    accessoryButton: panelSwitchButton(options.panel, options.isAdmin === true),
  };
}
