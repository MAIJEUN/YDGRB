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
import { ACTION, PANEL, WISH, type PanelKind } from "./ids.js";
import type { RankSort } from "./store.js";

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
 * 확인 화면 — 다른 유저를 골라서 볼 수 있다.
 *
 * 이 화면은 채널에 **공개로** 올라간다. 누구나 드롭다운으로 다른 사람을 조회할 수 있고,
 * 고르면 그 공개 메시지가 갱신된다 (읽기 전용이라 남이 눌러도 문제없다).
 */
export function checkRows(): Row[] {
  return [
    row(
      new UserSelectMenuBuilder()
        .setCustomId(customId(WISH, ACTION.checkSelect))
        .setPlaceholder("다른 유저의 소원권 보기")
        .setMinValues(1)
        .setMaxValues(1),
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
