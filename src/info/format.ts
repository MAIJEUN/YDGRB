import { ChannelType, GuildPremiumTier } from "discord.js";
import type { Guild } from "discord.js";

/**
 * 서버 정보를 사람이 읽는 말로 바꾼다.
 *
 * 디스코드가 주는 값은 대부분 숫자 enum 이라 그대로 내보내면 `2` 같은 게 찍힌다.
 * 시각은 여기서 다루지 않는다 — 반드시 [time.ts](../time.ts) 의 타임스탬프 마크다운을 쓴다.
 */

/**
 * `1234` → `1,234` · `1234.5` → `1,234.5`
 *
 * 숫자 서식이라 날짜와 달리 로케일 API 를 쓰지 않는다.
 * **소수점 아래는 건드리지 않는다** — 콤마는 정수 자리를 세는 것이지 자릿수를 세는 것이 아니다.
 */
export function count(value: number): string {
  const [whole = "", fraction] = value.toString().split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");

  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** 값이 없으면 「없음」. 빈 칸을 만들지 않기 위해. */
export function orNone(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "없음" : value;
}

export function premiumTier(tier: GuildPremiumTier): string {
  return (
    {
      [GuildPremiumTier.None]: "없음",
      [GuildPremiumTier.Tier1]: "1단계",
      [GuildPremiumTier.Tier2]: "2단계",
      [GuildPremiumTier.Tier3]: "3단계",
    }[tier] ?? "알 수 없음"
  );
}

/** 채널을 종류별로 센다. 스레드는 부모에 딸린 것이라 따로 센다. */
export function channelCounts(guild: Guild): string {
  const tally = new Map<string, number>();

  const label: Partial<Record<ChannelType, string>> = {
    [ChannelType.GuildText]: "텍스트",
    [ChannelType.GuildVoice]: "음성",
    [ChannelType.GuildCategory]: "카테고리",
    [ChannelType.GuildAnnouncement]: "공지",
    [ChannelType.GuildStageVoice]: "무대",
    [ChannelType.GuildForum]: "포럼",
    [ChannelType.GuildMedia]: "미디어",
  };

  let threads = 0;

  for (const channel of guild.channels.cache.values()) {
    if (channel.isThread()) {
      threads += 1;
      continue;
    }

    const name = label[channel.type];
    if (name !== undefined) tally.set(name, (tally.get(name) ?? 0) + 1);
  }

  const parts = [...tally].map(([name, value]) => `${name} **${value}**`);
  if (threads > 0) parts.push(`스레드 **${threads}**`);

  return parts.length === 0 ? "없음" : parts.join(" · ");
}
