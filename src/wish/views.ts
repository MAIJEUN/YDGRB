import type { User } from "discord.js";

import type { MessageOptions, ResponseField, Status } from "../ui/response.js";
import { day } from "../time.js";
import {
  formatBalance,
  formatBalanceBy,
  formatHistorySummary,
  formatLedgerEntry,
  historyDayStamp,
} from "./format.js";
import { MAX_HISTORY_LINES, PANEL, RANK_PAGE_SIZE, type PanelKind } from "./ids.js";
import { checkRows, historyRows, panelRows, panelSwitchButton, rankRows } from "./panels.js";
import {
  getBalance,
  getHistoryDays,
  getHistoryOf,
  getRanking,
  getSettings,
  type RankSort,
} from "./store.js";
import { speak } from "../ui/tone.js";

/**
 * 패널·확인·랭킹은 무언가를 바꾸는 게 아니라 보여 주기만 한다 — 전부 파랑(정보).
 * 실제로 수량이 바뀌는 화면만 초록/빨강을 쓴다 (`noticeView` 호출부 참고).
 */

const MEDALS = ["🥇", "🥈", "🥉"];

export async function panelView(
  guildId: string,
  panel: PanelKind,
  user: User,
  isAdmin: boolean,
): Promise<MessageOptions> {
  const settings = await getSettings(guildId);
  const accessoryButton = panelSwitchButton(panel, isAdmin);

  if (panel === PANEL.admin) {
    return {
      status: "info",
      title: "소원권 · 관리자 패널",
      description: [
        speak("**수수** — 소원권/조각을 지급하거나 회수합니다."),
        speak("**흡혈** — 한 유저의 소원권/조각을 다른 유저에게 옮깁니다."),
        speak("**설정** — 소원 전달 채널과 제작 비용을 정합니다."),
      ].join("\n"),
      fields: [
        {
          name: "소원 전달 채널",
          value:
            settings.wishChannelId === null
              ? speak("_아직 설정되지 않았습니다._")
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
      accessoryButton,
      rows: panelRows(panel),
    };
  }

  const balance = await getBalance(guildId, user.id);

  return {
    status: "info",
    title: "소원권 · 유저 패널",
    description: [
      speak("**확인** — 내 보유 수량과 다른 사람의 보유 수량을 봅니다."),
      speak("**랭킹** — 소원권/조각 보유 순위를 봅니다."),
      speak(`**제작** — 조각 ${settings.fragmentsPerTicket}개로 소원권 1장을 만듭니다.`),
      speak("**사용** — 소원권 1장으로 소원을 빕니다."),
      speak("**낭비** — 소원권이나 조각 1개를 버립니다."),
    ].join("\n"),
    fields: [{ name: "내 보유", value: formatBalance(balance) }],
    user,
    accessoryButton,
    rows: panelRows(panel),
  };
}

/**
 * 확인 — 한 사람의 보유 현황.
 *
 * `showHistory` 를 켜면 아래에 **날짜 드롭다운**이 하나 더 붙는다. 무엇을 보는지는
 * 그대로고, 고를 것이 하나 늘어날 뿐이다.
 */
export async function checkView(
  guildId: string,
  targetId: string,
  user: User,
  showHistory = false,
): Promise<MessageOptions> {
  const balance = await getBalance(guildId, targetId);
  const { fragmentsPerTicket } = await getSettings(guildId);
  const craftable = Math.floor(balance.fragments / fragmentsPerTicket);

  const days = showHistory ? await getHistoryDays(guildId) : [];

  return {
    status: "info",
    title: "소원권 확인",
    description: speak(`<@${targetId}> 님의 보유 현황입니다.`),
    fields: [
      { name: "보유", value: formatBalance(balance) },
      {
        name: "제작 가능",
        value: `${craftable}장 _(조각 ${fragmentsPerTicket}개당 소원권 1장)_`,
      },
      // 펼쳤는데 아무것도 없으면 그 말을 해 준다. 빈 드롭다운을 눌러 보게 두지 않는다.
      ...(showHistory && days.length === 0
        ? [{ name: "역사", value: speak("_아직 소원권이 오간 적이 없습니다._") }]
        : []),
    ],
    user,
    rows: checkRows(targetId, showHistory, days),
  };
}

/**
 * 역사 — 하루치 변동 전부.
 *
 * **서버 전체**를 본다. 확인 화면이 한 사람을 보는 것과 달리, 소원권이 어떻게 돌았는지는
 * 주고받은 양쪽이 다 보여야 뜻이 있다 (흡혈은 두 사람이 한 일이다).
 *
 * 사람이 사유를 적는 것(수수 · 흡혈)만 남기면 반쪽이 되므로, 출헉 보상도 제작도 소원 환불도
 * **무엇이 바꿨는지**가 함께 나온다. [저장할 때 받아 둔 것](store.ts)을 그대로 쓴다.
 */
export async function historyView(
  guildId: string,
  targetId: string,
  date: string,
  user: User,
): Promise<MessageOptions> {
  const days = await getHistoryDays(guildId);
  const entries = await getHistoryOf(guildId, date);
  const summary = days.find((candidate) => candidate.date === date);

  // 넘치면 이른 것부터 자른다 — 하루를 위에서 아래로 읽으므로 끝이 남아야 한다.
  const shown = entries.slice(-MAX_HISTORY_LINES);
  const hidden = entries.length - shown.length;

  const lines = shown.map((entry) => formatLedgerEntry(entry));
  if (hidden > 0) lines.unshift(speak(`_앞의 ${hidden}건은 접었습니다._`));

  return {
    status: "info",
    title: "소원권 역사",
    description:
      entries.length === 0
        ? speak("_그날은 오간 것이 없습니다._")
        : [`**${day(historyDayStamp(date))}**`, "", ...lines].join("\n"),
    fields: summary === undefined ? [] : [{ name: "집계", value: formatHistorySummary(summary) }],
    user,
    rows: historyRows(targetId, days, date),
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
      ? speak("_아직 소원권을 가진 사람이 없습니다._")
      : speak("_아직 소원권 조각을 가진 사람이 없습니다._");

  return {
    status: "info",
    title: sort === "tickets" ? "소원권 랭킹" : "소원권 조각 랭킹",
    description: lines.length === 0 ? emptyMessage : lines.join("\n"),
    fields: [{ name: "집계", value: `총 ${entries.length}명 · ${current + 1}/${pageCount} 페이지` }],
    user,
    rows: rankRows(sort, current, pageCount),
  };
}

export interface NoticeOptions {
  readonly status: Status;
  readonly title: string;
  readonly description?: string;
  readonly error?: unknown;
  readonly fields?: readonly ResponseField[];
  readonly balance?: string;
  readonly user: User;
  readonly panel: PanelKind;
  /** 관리자면 패널 전환 버튼도 그대로 달아 둔다. */
  readonly isAdmin?: boolean;
}

/** 동작 결과 화면. 패널 버튼을 그대로 달아 두어 이어서 쓸 수 있게 한다. */
export function noticeView(options: NoticeOptions): MessageOptions {
  return {
    status: options.status,
    title: options.title,
    description: options.description,
    error: options.error,
    fields: options.fields,
    balance: options.balance,
    user: options.user,
    accessoryButton: panelSwitchButton(options.panel, options.isAdmin === true),
    rows: panelRows(options.panel),
  };
}
