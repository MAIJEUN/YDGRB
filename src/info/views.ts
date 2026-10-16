import type { Guild, GuildMember, User } from "discord.js";

import { at, atWithCountdown } from "../time.js";
import type { MessageOptions, ResponseField } from "../ui/response.js";
import { speak } from "../ui/tone.js";
import { channelCounts, count, orNone, premiumTier } from "./format.js";
import type { MessageCount } from "./messages.js";

/**
 * 서버·유저 정보 화면.
 *
 * 둘 다 아무것도 바꾸지 않고 보여 주기만 하므로 **파랑(정보)** 이다.
 * 시각은 전부 타임스탬프 마크다운, 사람과 역할·채널은 전부 멘션으로 낸다.
 *
 * **이미지 배치는 순서 규칙의 예외다.** 이 둘은 정보를 늘어놓는 카드라서,
 * 아이콘·아바타를 본문 옆 썸네일로 붙여야 카드처럼 읽힌다.
 * 배너는 넓은 그림이라 아래에 그대로 크게 둔다.
 */

/** 썸네일은 작게 붙으므로 큰 파일을 받을 이유가 없다. */
const THUMBNAIL_SIZE = 256;
/** 배너는 넓게 깔리므로 조금 크게. */
const BANNER_SIZE = 512;

/** 역할을 다 적으면 글자 수 한계를 넘는다. 위에서부터 이만큼만. */
const MAX_ROLES = 20;

/** 값이 있을 때만 칸을 만든다 — 빈 칸을 늘어놓지 않기 위해. */
function field(name: string, value: string | null): ResponseField[] {
  return value === null ? [] : [{ name, value }];
}

// ─────────────────────────────────────────────────────────────
// 서버
// ─────────────────────────────────────────────────────────────

export function serverView(guild: Guild, user: User): MessageOptions {
  const icon = guild.iconURL({ size: THUMBNAIL_SIZE, extension: "png" });
  const banner = guild.bannerURL({ size: BANNER_SIZE, extension: "png" });

  return {
    status: "info",
    title: "서버 정보",
    // 서버 이름은 여기서 말하므로 아래에 「서버」 칸을 따로 두지 않는다.
    description: `**${guild.name}** · \`${guild.id}\``,
    fields: [
      { name: "소유자", value: `<@${guild.ownerId}>` },
      { name: "만든 날", value: atWithCountdown(guild.createdAt) },
      { name: "멤버", value: `**${count(guild.memberCount)}명**` },
      { name: "채널", value: channelCounts(guild) },
      { name: "역할", value: `**${count(guild.roles.cache.size - 1)}개** _(@everyone 제외)_` },
      {
        name: "이모지 · 스티커",
        value: `이모지 **${count(guild.emojis.cache.size)}개** · 스티커 **${count(guild.stickers.cache.size)}개**`,
      },
      {
        name: "부스트",
        value: `${premiumTier(guild.premiumTier)} · **${count(guild.premiumSubscriptionCount ?? 0)}회**`,
      },
      ...field(
        "잠수 채널",
        guild.afkChannelId === null ? null : `<#${guild.afkChannelId}> _(${guild.afkTimeout / 60}분)_`,
      ),
      ...field("시스템 채널", guild.systemChannelId === null ? null : `<#${guild.systemChannelId}>`),
      ...field("규칙 채널", guild.rulesChannelId === null ? null : `<#${guild.rulesChannelId}>`),
      ...field("맞춤 초대", guild.vanityURLCode === null ? null : `\`${guild.vanityURLCode}\``),
      ...field("설명", orNone(guild.description) === "없음" ? null : guild.description),
    ],
    // 아이콘은 본문 옆, 배너는 아래 넓게.
    ...(icon === null ? {} : { thumbnail: icon }),
    images: banner === null ? [] : [banner],
    user,
  };
}

// ─────────────────────────────────────────────────────────────
// 유저
// ─────────────────────────────────────────────────────────────

/** 위에서부터 몇 개만. @everyone 은 모두가 가지므로 뺀다. */
function roles(member: GuildMember): string {
  const list = [...member.roles.cache.values()]
    .filter((role) => role.id !== member.guild.id)
    .sort((a, b) => b.position - a.position);

  if (list.length === 0) return "없음";

  const shown: string[] = list.slice(0, MAX_ROLES).map((role) => role.toString());
  if (list.length > MAX_ROLES) shown.push(`_외 ${list.length - MAX_ROLES}개_`);

  return shown.join(" ");
}

/**
 * 「메시지」 칸 — 지금까지 이 서버에 남긴 메시지 수.
 *
 * 숫자 아래에 **무엇을 기준으로 센 것인지** 작게 붙인다. 디스코드 검색에서 보이는 숫자와
 * 다를 수 있기 때문이다 — 봇이 못 보는 채널은 빠진다.
 *
 * 셀 수 없었으면(권한·디스코드 쪽 문제) 칸을 아예 만들지 않는다. 볼 때마다 「못 셌다」 가
 * 뜨면 프로필이 아니라 오류 화면처럼 보인다. 색인 중일 때만 그렇다고 말한다 — 그건 잠시
 * 뒤 다시 보면 나오는 것이라 알려 줄 만하다.
 */
function messageField(messages: MessageCount | undefined): ResponseField[] {
  if (messages === undefined) return [];

  if (messages.ok) {
    return [{ name: "메시지", value: `**${count(messages.total)}개**\n-# 봇이 볼 수 있는 채널 기준` }];
  }

  return messages.reason === "indexing"
    ? [{ name: "메시지", value: speak("_디스코드가 아직 세는 중입니다. 잠시 뒤 다시 보세요._") }]
    : [];
}

export function profileView(
  member: GuildMember,
  banner: string | null,
  user: User,
  messages?: MessageCount,
): MessageOptions {
  const timeout = member.isCommunicationDisabled() ? member.communicationDisabledUntil : null;

  return {
    status: "info",
    title: "프로필",
    // 대상은 여기서 말하므로 아래에 「유저」 칸을 따로 두지 않는다.
    description: `<@${member.id}> · \`${member.id}\``,
    fields: [
      { name: "사용자명", value: `\`${member.user.username}\`` },
      ...field("표시 이름", member.user.globalName === null ? null : `\`${member.user.globalName}\``),
      ...field("별명", member.nickname === null ? null : `\`${member.nickname}\``),
      { name: "계정 만든 날", value: atWithCountdown(member.user.createdAt) },
      ...field("서버 참가", member.joinedAt === null ? null : atWithCountdown(member.joinedAt)),
      ...messageField(messages),
      ...field("부스트 시작", member.premiumSince === null ? null : at(member.premiumSince)),
      ...field("타임아웃", timeout === null ? null : `${atWithCountdown(timeout)} 까지`),
      { name: `역할 (${count(Math.max(member.roles.cache.size - 1, 0))}개)`, value: roles(member) },
      ...field("봇", member.user.bot ? "네" : null),
    ],
    // 아바타는 본문 옆, 배너는 아래 넓게.
    thumbnail: member.displayAvatarURL({ size: THUMBNAIL_SIZE, extension: "png" }),
    images: banner === null ? [] : [banner],
    user,
  };
}
