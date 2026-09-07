import type { Guild, GuildMember, Role, User } from "discord.js";

import type { MessageOptions, ResponseField, Status } from "../ui/response.js";
import { speak } from "../ui/tone.js";
import { PANEL, type PanelKind } from "./ids.js";
import { panelRows, panelSwitchButton } from "./panels.js";
import { allowedRoles, openedUsers } from "./store.js";

/**
 * 역할 패널.
 *
 * 패널은 무언가를 바꾸는 게 아니라 보여 주기만 한다 — 전부 파랑(정보).
 * 실제로 역할이 붙었다 떨어지는 화면만 초록/노랑/빨강을 쓴다 (`noticeView` 호출부 참고).
 */

/**
 * 명단에 적힌 역할 중 **지금 살아 있고 봇이 만질 수 있는** 것만.
 *
 * 지워진 역할, 봇보다 높은 역할, 봇·연동이 들고 있는 역할(`managed`)은 붙였다 뗄 수가
 * 없다. 드롭다운에 실어 봐야 눌렀을 때 실패하므로 그리기 전에 걸러 낸다.
 */
export function usableRoles(guild: Guild, ids: readonly string[]): Role[] {
  return ids
    .map((id) => guild.roles.cache.get(id))
    .filter((role): role is Role => role !== undefined && canManage(guild, role));
}

/** 봇이 이 역할을 붙였다 뗄 수 있는가. */
export function canManage(guild: Guild, role: Role): boolean {
  // @everyone 은 벗길 수도 붙일 수도 없고, managed 는 디스코드가 들고 있는 것이다.
  if (role.id === guild.id || role.managed) return false;
  return role.editable;
}

/** 역할 멘션을 늘어놓는다. 없으면 그렇게 적는다. */
function roleList(ids: readonly string[]): string {
  return ids.length === 0
    ? speak("_아직 없습니다._")
    : ids.map((id) => `<@&${id}>`).join(" ");
}

export async function panelView(
  member: GuildMember,
  panel: PanelKind,
  isAdmin: boolean,
  targetId: string | null = null,
): Promise<MessageOptions> {
  return panel === PANEL.admin
    ? adminPanelView(member, targetId, isAdmin)
    : userPanelView(member, isAdmin);
}

/**
 * 관리자 패널 — 누구에게 무엇을 열어 줄지.
 *
 * 유저를 고르기 전에는 **이미 열어 준 사람들**을 보여 준다. 빈 화면에 드롭다운 하나만
 *두면 누구를 이미 손봐 뒀는지 알 길이 없어 같은 사람을 두 번 만지게 된다.
 */
async function adminPanelView(
  member: GuildMember,
  targetId: string | null,
  isAdmin: boolean,
): Promise<MessageOptions> {
  const guild = member.guild;
  const allowed = targetId === null ? [] : await allowedRoles(guild.id, targetId);

  const fields: ResponseField[] = [];

  if (targetId === null) {
    fields.push({ name: "열어 준 사람", value: mentionUsers(await openedUsers(guild.id)) });
  } else {
    fields.push({ name: "열어 준 역할", value: roleList(allowed) });

    // 명단에 있어도 봇이 못 만지는 것이 있으면 미리 말한다 — 유저가 눌러 보고 나서
    // 알게 두면, 왜 안 되는지 물어볼 곳이 관리자밖에 없다.
    const stuck = allowed.filter((id) => {
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

  return {
    status: "info",
    title: "역할 · 관리자 패널",
    description: [
      speak("**유저**를 고르고, 그 사람이 켜고 끌 수 있는 **역할**을 정합니다."),
      speak("고른 사람은 권한 없이도 유저 패널에서 그 역할들만 스스로 붙였다 뗍니다."),
    ].join("\n"),
    fields,
    user: member.user,
    accessoryButton: panelSwitchButton(PANEL.admin, isAdmin),
    rows: panelRows(PANEL.admin, { targetId, allowed }),
  };
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

function mentionUsers(ids: readonly string[]): string {
  return ids.length === 0 ? speak("_아직 없습니다._") : ids.map((id) => `<@${id}>`).join(" ");
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
 * 무언가를 바꾸고 나서 그 자리에 그리는 화면.
 *
 * 패널로 돌아가는 길을 없애지 않는다 — 바꾸고 나면 대개 한 번 더 바꾸고 싶어진다.
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
