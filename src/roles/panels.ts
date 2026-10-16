import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from "discord.js";
import type { MessageActionRowComponentBuilder, Role } from "discord.js";

import { customId } from "../types.js";
import { speak } from "../ui/tone.js";
import {
  ACTION,
  FUNC,
  FUNC_LABEL,
  MAX_ALLOWED_ROLES,
  MAX_TARGETS,
  NO_FUNC,
  PANEL,
  ROLE,
  type AdminFunc,
  type PanelKind,
} from "./ids.js";

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

function row(...components: MessageActionRowComponentBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

/**
 * 관리자 패널 — **유저 하나, 기능 버튼, 그리고 편 기능의 드롭다운.**
 *
 *   [ 유저 고르기 (여럿 가능)           ▾ ]
 *   [ 권한 ] [ 지급/회수 ]                 ← 유저를 고른 뒤에 붙는다
 *   [ 그 기능의 역할 드롭다운          ▾ ]  ← 기능을 편 뒤에 붙는다
 *
 * 유저를 고르는 자리는 하나뿐이다. 기능마다 유저 드롭다운을 두면 같은 사람을 두 번 고르게
 * 되고, 어느 쪽에 고른 사람이 화면의 주인인지도 흐려진다.
 *
 * 아래로 **펴지는** 모양인 것도 같은 이유다. 누구 것인지 모르는 채로 역할부터 고르게 하면
 * 그 고른 것이 갈 곳이 없고, 두 기능을 한꺼번에 펴 두면 어느 드롭다운이 무엇을 하는
 * 것인지 눌러 보기 전에는 모른다.
 */
export function adminPanelRows(
  targetIds: readonly string[],
  func: AdminFunc | null,
  options: { readonly allowed?: readonly string[]; readonly held?: readonly string[] } = {},
): Row[] {
  const rows: Row[] = [
    row(
      new UserSelectMenuBuilder()
        // 펴 둔 기능을 함께 싣는다 — 기능을 편 채 사람을 바꾸면 그 사람들 것이 이어서 보인다.
        .setCustomId(customId(ROLE, ACTION.pick, func ?? NO_FUNC))
        .setPlaceholder("유저 고르기 (여럿 가능)")
        .setMinValues(1)
        .setMaxValues(MAX_TARGETS)
        // 고른 사람들을 그대로 띄워 둔다. **여기 띄운 사람이 곧 대상이다** — 핸들러는
        // customId 가 아니라 이 드롭다운을 읽는다 (스물다섯 명의 id 는 100자에 안 들어간다).
        .setDefaultUsers(...targetIds.slice(0, MAX_TARGETS)),
    ),
  ];

  if (targetIds.length === 0) return rows;

  rows.push(row(...funcButtons(func)));

  if (func === FUNC.allow) rows.push(row(allowSelect(options.allowed ?? [])));
  if (func === FUNC.grant) rows.push(row(grantSelect(options.held ?? [])));

  return rows;
}

/**
 * 무엇을 할지 고르는 버튼. 펴 둔 것은 **파랑**이라 지금 무엇을 보고 있는지 한눈에 갈린다.
 *
 * customId 에는 지금 상태가 아니라 **눌렀을 때 갈 상태**를 싣는다. 지금 상태를 싣고
 * 뒤집으면 같은 화면을 두 사람이 볼 때 서로 반대로 열린다. 편 것을 다시 누르면 접힌다.
 */
function funcButtons(func: AdminFunc | null): ButtonBuilder[] {
  return [FUNC.allow, FUNC.grant].map((each) =>
    new ButtonBuilder()
      .setCustomId(customId(ROLE, ACTION.open, func === each ? NO_FUNC : each))
      .setLabel(FUNC_LABEL[each])
      .setStyle(func === each ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

/**
 * 「권한」 — 고른 사람들이 **스스로** 켜고 끌 수 있는 역할.
 *
 * **모두에게 열려 있는 것이 골라진 채로** 뜬다. 고른 것을 더하면 모두에게 열리고, 골라 둔
 * 것을 풀면 모두에게서 닫힌다. 일부에게만 열린 것은 드롭다운에 없으므로 건드리지 않는다 —
 * 한 사람만 골랐으면 그 사람 명단이 그대로 뜨니 「이만큼으로 정한다」 와 같다.
 */
export function allowSelect(allowed: readonly string[]): RoleSelectMenuBuilder {
  return new RoleSelectMenuBuilder()
    .setCustomId(customId(ROLE, ACTION.allow))
    .setPlaceholder(speak("스스로 켜고 끌 수 있는 역할"))
    // 하나도 안 고르고 낼 수 있어야 전부 닫을 수 있다.
    .setMinValues(0)
    .setMaxValues(MAX_ALLOWED_ROLES)
    .setDefaultRoles(...allowed.slice(0, MAX_ALLOWED_ROLES));
}

/**
 * 「지급/회수」 — 고른 사람들의 역할을 **지금 바로** 붙였다 뗀다.
 *
 * **모두 가진 것이 골라진 채로** 뜬다. 더한 것은 모두에게 붙이고, 풀어 낸 것은 모두에게서
 * 뗀다. 일부만 가진 역할은 드롭다운에 없으므로 건드리지 않는다.
 *
 * 여기 실려 오는 것은 서버의 아무 역할이나 될 수 있다. 그게 이 기능이다 — 명단과 상관없이
 * 관리자가 직접 주고 뺏는 자리다.
 */
export function grantSelect(held: readonly string[]): RoleSelectMenuBuilder {
  return new RoleSelectMenuBuilder()
    .setCustomId(customId(ROLE, ACTION.grant))
    .setPlaceholder(speak("가질 역할"))
    .setMinValues(0)
    .setMaxValues(MAX_ALLOWED_ROLES)
    .setDefaultRoles(...held.slice(0, MAX_ALLOWED_ROLES));
}

/**
 * 유저 패널 — 열어 준 역할을 켜고 끄는 드롭다운 하나.
 *
 * **지금 가진 것이 골라진 채로** 뜬다. 고른 것이 곧 「이걸 갖겠다」라, 골라 두었던 것을
 * 풀고 내면 벗겨진다. 켜고 끄기를 버튼 스물다섯 개로 늘어놓지 않아도 되는 이유다.
 *
 * 역할 드롭다운이 아니라 **글자 드롭다운**이다. 역할 드롭다운은 서버의 모든 역할을 담고,
 * 담기는 것을 고를 수단이 없다 (채널 드롭다운에만 있다). 열어 준 것만 보여 주려면 이것뿐이다.
 *
 * 열어 준 것이 하나도 없으면 드롭다운을 만들지 않는다 — 고를 것이 없는 드롭다운은
 * 눌러 보고 나서야 빈 것을 안다. 그 말은 화면 본문이 한다.
 */
export function userPanelRows(roles: readonly Role[], held: readonly string[]): Row[] {
  if (roles.length === 0) return [];

  const shown = roles.slice(0, MAX_ALLOWED_ROLES);

  const select = new StringSelectMenuBuilder()
    .setCustomId(customId(ROLE, ACTION.toggle))
    .setPlaceholder(speak("가질 역할을 고릅니다"))
    // 하나도 안 고르고 낼 수 있어야 전부 벗을 수 있다.
    .setMinValues(0)
    .setMaxValues(shown.length);

  for (const role of shown) {
    const option = new StringSelectMenuOptionBuilder()
      // 드롭다운 항목은 글자만 받는다 — 여기만 멘션이 아니다. 화면 본문은 멘션으로 적는다.
      .setLabel(role.name)
      .setValue(role.id);

    if (held.includes(role.id)) option.setDefault(true);
    select.addOptions(option);
  }

  return [row(select)];
}

export function panelRows(
  panel: PanelKind,
  options: {
    readonly targetIds?: readonly string[];
    readonly func?: AdminFunc | null;
    readonly allowed?: readonly string[];
    readonly roles?: readonly Role[];
    readonly held?: readonly string[];
  } = {},
): Row[] {
  return panel === PANEL.admin
    ? adminPanelRows(options.targetIds ?? [], options.func ?? null, {
        allowed: options.allowed,
        held: options.held,
      })
    : userPanelRows(options.roles ?? [], options.held ?? []);
}

/**
 * 제목 오른쪽 끝에 붙는 패널 전환 버튼. **관리자에게만** 준다.
 *
 * 소원권 패널과 같은 자리·같은 모양이다 — 패널이 둘인 시스템은 오가는 문도 같아야 찾는다.
 */
export function panelSwitchButton(panel: PanelKind, isAdmin: boolean): ButtonBuilder | undefined {
  if (!isAdmin) return undefined;

  const target = panel === PANEL.admin ? PANEL.user : PANEL.admin;

  return new ButtonBuilder()
    .setCustomId(customId(ROLE, ACTION.panel, target))
    .setLabel(target === PANEL.admin ? "관리자 패널" : "유저 패널")
    .setStyle(ButtonStyle.Secondary);
}
