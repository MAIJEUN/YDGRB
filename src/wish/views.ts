import type { User } from "discord.js";

import type { MessageOptions, ResponseField, Status } from "../ui/response.js";
import { formatBalance, formatBalanceBy } from "./format.js";
import { PANEL, RANK_PAGE_SIZE, type PanelKind } from "./ids.js";
import { checkRows, panelRows, rankRows } from "./panels.js";
import { getBalance, getRanking, getSettings, type RankSort } from "./store.js";

/**
 * 패널 화면은 전부 컨테이너(Components V2)로 만든다.
 *
 * 이미 만들어진 메시지의 Components V2 여부는 바꿀 수 없으므로,
 * 패널에서 파생되는 모든 화면은 반드시 `layout: "container"` 를 유지해야 한다.
 */

const MEDALS = ["🥇", "🥈", "🥉"];

export async function panelView(
  guildId: string,
  panel: PanelKind,
  user: User,
): Promise<MessageOptions> {
  const settings = await getSettings(guildId);

  if (panel === PANEL.admin) {
    return {
      status: "progress",
      title: "소원권 · 관리자 패널",
      description: [
        "**수수** — 소원권/조각을 지급하거나 회수합니다.",
        "**흡혈** — 한 유저의 소원권/조각을 다른 유저에게 옮깁니다.",
        "**설정** — 소원 전달 채널과 제작 비용을 정합니다.",
      ].join("\n"),
      fields: [
        {
          name: "소원 전달 채널",
          value:
            settings.wishChannelId === null
              ? "_아직 설정되지 않았습니다._"
              : `<#${settings.wishChannelId}>`,
          inline: true,
        },
        {
          name: "제작 비용",
          value: `조각 **${settings.fragmentsPerTicket}개** = 소원권 1장`,
          inline: true,
        },
      ],
      user,
      layout: "container",
      rows: panelRows(panel),
    };
  }

  const balance = await getBalance(guildId, user.id);

  return {
    status: "progress",
    title: "소원권 · 유저 패널",
    description: [
      "**확인** — 내 보유 수량과 다른 사람의 보유 수량을 봅니다.",
      "**랭킹** — 소원권/조각 보유 순위를 봅니다.",
      `**제작** — 조각 ${settings.fragmentsPerTicket}개로 소원권 1장을 만듭니다.`,
      "**사용** — 소원권 1장으로 소원을 빕니다.",
      "**낭비** — 소원권이나 조각 1개를 버립니다.",
    ].join("\n"),
    fields: [{ name: "내 보유", value: formatBalance(balance) }],
    user,
    layout: "container",
    rows: panelRows(panel),
  };
}

export async function checkView(
  guildId: string,
  targetId: string,
  user: User,
): Promise<MessageOptions> {
  const balance = await getBalance(guildId, targetId);
  const { fragmentsPerTicket } = await getSettings(guildId);
  const craftable = Math.floor(balance.fragments / fragmentsPerTicket);

  return {
    status: "success",
    title: "소원권 확인",
    description: `<@${targetId}> 님의 보유 현황입니다.`,
    fields: [
      { name: "보유", value: formatBalance(balance) },
      {
        name: "제작 가능",
        value: `${craftable}장 _(조각 ${fragmentsPerTicket}개당 소원권 1장)_`,
      },
    ],
    user,
    layout: "container",
    rows: checkRows(),
  };
}

export async function rankView(
  guildId: string,
  sort: RankSort,
  page: number,
  user: User,
): Promise<MessageOptions> {
  const entries = await getRanking(guildId, sort);
  const pageCount = Math.max(Math.ceil(entries.length / RANK_PAGE_SIZE), 1);
  const current = Math.min(Math.max(page, 0), pageCount - 1);

  const slice = entries.slice(current * RANK_PAGE_SIZE, (current + 1) * RANK_PAGE_SIZE);

  const lines = slice.map((entry, index) => {
    const rank = current * RANK_PAGE_SIZE + index + 1;
    const prefix = MEDALS[rank - 1] ?? `**${rank}.**`;
    // 기준이 되는 항목만 보여 준다 — 소원권 랭킹에 조각 수까지 붙으면 읽기 번거롭다.
    return `${prefix} <@${entry.userId}> — ${formatBalanceBy(entry.balance, sort)}`;
  });

  const emptyMessage =
    sort === "tickets"
      ? "_아직 소원권을 가진 사람이 없습니다._"
      : "_아직 소원권 조각을 가진 사람이 없습니다._";

  return {
    status: "success",
    title: sort === "tickets" ? "소원권 랭킹" : "소원권 조각 랭킹",
    description: lines.length === 0 ? emptyMessage : lines.join("\n"),
    fields: [{ name: "집계", value: `총 ${entries.length}명 · ${current + 1}/${pageCount} 페이지` }],
    user,
    layout: "container",
    rows: rankRows(sort, current, pageCount),
  };
}

export interface NoticeOptions {
  readonly status: Status;
  readonly title: string;
  readonly description?: string;
  readonly fields?: readonly ResponseField[];
  readonly balance?: string;
  readonly user: User;
  readonly panel: PanelKind;
}

/** 동작 결과 화면. 패널 버튼을 그대로 달아 두어 이어서 쓸 수 있게 한다. */
export function noticeView(options: NoticeOptions): MessageOptions {
  return {
    status: options.status,
    title: options.title,
    description: options.description,
    fields: options.fields,
    balance: options.balance,
    user: options.user,
    layout: "container",
    rows: panelRows(options.panel),
  };
}
