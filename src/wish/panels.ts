import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from "discord.js";
import type { MessageActionRowComponentBuilder } from "discord.js";

import { customId } from "../types.js";
import { speak } from "../ui/tone.js";
import { formatHistoryDate, formatHistorySummary } from "./format.js";
import { ACTION, MAX_SELECT_OPTIONS, PANEL, WISH, type PanelKind } from "./ids.js";
import type { HistoryDay, RankSort } from "./store.js";

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

function row(...components: MessageActionRowComponentBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

/** 유저 패널 첫 화면 — 확인 · 랭킹 · 제작 · 사용 · 낭비 */
export function userPanelRows(): Row[] {
  return [
    row(
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.check))
        .setLabel("확인")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.rank))
        .setLabel("랭킹")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.craft))
        .setLabel("제작")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.use))
        .setLabel("사용")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.waste))
        .setLabel("낭비")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

/** 관리자 패널 첫 화면 — 수수 · 흡혈 · 설정 */
export function adminPanelRows(): Row[] {
  return [
    row(
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.grant))
        .setLabel("수수")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.blood))
        .setLabel("흡혈")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.config))
        .setLabel("설정")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function panelRows(panel: PanelKind): Row[] {
  return panel === PANEL.admin ? adminPanelRows() : userPanelRows();
}

/**
 * 제목 오른쪽 끝에 붙는 패널 전환 버튼.
 *
 * **관리자에게만** 준다 — 일반 유저에게 관리자 패널로 가는 버튼을 보여 줄 이유가 없다
 * (눌러도 막히지만, 없는 문을 두드리게 하지 않는다).
 *
 * 액션 로우는 한 줄을 통째로 차지하므로 이 버튼은 `accessoryButton` 으로 넘긴다.
 */
export function panelSwitchButton(panel: PanelKind, isAdmin: boolean): ButtonBuilder | undefined {
  if (!isAdmin) return undefined;

  const target = panel === PANEL.admin ? PANEL.user : PANEL.admin;

  return new ButtonBuilder()
    .setCustomId(customId(WISH, ACTION.panel, target))
    .setLabel(target === PANEL.admin ? "관리자 패널" : "유저 패널")
    .setStyle(ButtonStyle.Secondary);
}

/**
 * 확인 화면 — 유저 드롭다운 · 역사 펼치기.
 *
 * **역사는 접어 둔다.** 확인은 「지금 얼마 있나」를 보는 화면이고, 날짜 드롭다운을 늘
 * 펼쳐 두면 그 한 줄이 먼저 눈에 들어온다. 보고 싶은 사람만 편다.
 *
 * 편 상태에서 날짜가 하나도 없으면 드롭다운을 만들지 않는다 — 고를 것이 없는 드롭다운은
 * 눌러 보고 나서야 빈 것을 안다. 그 말은 화면 본문이 한다.
 */
export function checkRows(targetId: string, open: boolean, days: readonly HistoryDay[] = []): Row[] {
  const rows: Row[] = [
    row(
      new UserSelectMenuBuilder()
        // 펼친 상태를 함께 싣는다 — 역사를 펴 둔 채 사람을 바꾸면 그 사람 역사가 이어서 보인다.
        .setCustomId(customId(WISH, ACTION.checkSelect, open ? "1" : "0"))
        .setPlaceholder("다른 유저의 소원권 보기")
        .setMinValues(1)
        .setMaxValues(1),
    ),
  ];

  if (open && days.length > 0) rows.push(row(historySelect(targetId, days)));

  rows.push(
    row(
      new ButtonBuilder()
        // 지금 상태가 아니라 **눌렀을 때 갈 상태**를 싣는다.
        .setCustomId(customId(WISH, ACTION.history, targetId, open ? "0" : "1"))
        .setLabel(open ? "역사 접기" : "역사")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return rows;
}

/**
 * 변동이 있었던 날짜 드롭다운. **최근 날짜가 위**다.
 *
 * 디스코드가 받는 항목이 스물다섯 개뿐이라 그 앞부분만 싣는다. 오래된 쪽을 잘라야
 * 방금 무슨 일이 있었는지를 못 보는 일이 없다.
 */
export function historySelect(
  targetId: string,
  days: readonly HistoryDay[],
  picked?: string,
): StringSelectMenuBuilder {
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId(WISH, ACTION.historyDay, targetId))
    .setPlaceholder(speak("날짜를 고르면 그날의 변동을 봅니다"))
    .setMinValues(1)
    .setMaxValues(1);

  for (const day of days.slice(0, MAX_SELECT_OPTIONS)) {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(formatHistoryDate(day.date))
      .setDescription(formatHistorySummary(day))
      .setValue(day.date);

    if (day.date === picked) option.setDefault(true);
    select.addOptions(option);
  }

  return select;
}

/** 역사 화면 — 날짜 드롭다운은 그대로 두고, 확인으로 돌아가는 길만 붙인다. */
export function historyRows(
  targetId: string,
  days: readonly HistoryDay[],
  picked: string,
): Row[] {
  return [
    row(historySelect(targetId, days, picked)),
    row(
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.history, targetId, "0"))
        .setLabel("확인으로")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/**
 * 랭킹 화면. 확인과 마찬가지로 채널에 **공개로** 올라가고, 누구나 넘겨 볼 수 있다.
 *
 * 셀렉트 메뉴는 액션 로우 한 줄을 통째로 차지해서 버튼과 같은 줄에 못 둔다.
 * 그래서 기준 선택(드롭다운)을 위에, 이전/다음 버튼을 아래에 배치했다.
 */
export function rankRows(sort: RankSort, page: number, pageCount: number): Row[] {
  const lastPage = Math.max(pageCount - 1, 0);

  const sortSelect = new StringSelectMenuBuilder()
    .setCustomId(customId(WISH, ACTION.rankSort, String(page)))
    .setPlaceholder("랭킹 기준")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("소원권 기준")
        .setValue("tickets")
        .setEmoji("🎫")
        .setDefault(sort === "tickets"),
      new StringSelectMenuOptionBuilder()
        .setLabel("소원권 조각 기준")
        .setValue("fragments")
        .setEmoji("🧩")
        .setDefault(sort === "fragments"),
    );

  return [
    row(sortSelect),
    row(
      // 목표 페이지를 범위 안으로 깎으면 안 된다.
      // 페이지가 1개일 때 이전/다음이 같은 customId 가 되어 디스코드가 거부한다
      // (COMPONENT_CUSTOM_ID_DUPLICATED). 범위 밖 값은 눌릴 일이 없고,
      // 혹시 눌려도 rankView 가 알아서 잘라 낸다.
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.rankPage, sort, String(page - 1)))
        .setLabel("이전")
        .setEmoji("◀")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.noop))
        .setLabel(`${page + 1} / ${Math.max(pageCount, 1)}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.rankPage, sort, String(page + 1)))
        .setLabel("다음")
        .setEmoji("▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= lastPage),
    ),
  ];
}

/**
 * 처리가 끝난 소원 메시지에 남기는 상태 표시.
 *
 * 원본 메시지는 이 버튼만 바꾸고 임베드·첨부는 손대지 않는다 — 자세한 이유는
 * `components/wish.ts` 의 `decideWish` 주석 참고.
 */
export function wishDecidedRows(accepted: boolean): Row[] {
  return [
    row(
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.noop))
        .setLabel(accepted ? "수락됨" : "거절됨")
        .setStyle(accepted ? ButtonStyle.Success : ButtonStyle.Danger)
        .setDisabled(true),
    ),
  ];
}

/** 소원 전달 메시지에 붙는 관리자용 수락/거절 버튼. */
export function wishDecisionRows(wishId: string): Row[] {
  return [
    row(
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.accept, wishId))
        .setLabel("수락")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(customId(WISH, ACTION.reject, wishId))
        .setLabel("거절")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}
