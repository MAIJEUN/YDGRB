import {
  ChannelType,
  GuildDefaultMessageNotifications,
  GuildExplicitContentFilter,
  GuildMFALevel,
  GuildNSFWLevel,
  GuildPremiumTier,
  GuildVerificationLevel,
} from "discord.js";
import type { Guild } from "discord.js";

/**
 * 서버·유저 정보를 사람이 읽는 말로 바꾼다.
 *
 * 디스코드가 주는 값은 대부분 숫자 enum 이라 그대로 내보내면 `2` 같은 게 찍힌다.
 * 시각은 여기서 다루지 않는다 — 반드시 [time.ts](../time.ts) 의 타임스탬프 마크다운을 쓴다.
 */

/** `1234` → `1,234`. 숫자 서식이라 날짜와 달리 로케일 API 를 쓰지 않는다. */
export function count(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

/** 값이 없으면 「없음」. 빈 칸을 만들지 않기 위해. */
export function orNone(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "없음" : value;
}

export function verificationLevel(level: GuildVerificationLevel): string {
  return (
    {
      [GuildVerificationLevel.None]: "없음",
      [GuildVerificationLevel.Low]: "낮음 — 이메일 인증",
      [GuildVerificationLevel.Medium]: "중간 — 가입 5분 후",
      [GuildVerificationLevel.High]: "높음 — 서버 참가 10분 후",
      [GuildVerificationLevel.VeryHigh]: "매우 높음 — 전화 인증",
    }[level] ?? "알 수 없음"
  );
}

export function contentFilter(filter: GuildExplicitContentFilter): string {
  return (
    {
      [GuildExplicitContentFilter.Disabled]: "검사 안 함",
      [GuildExplicitContentFilter.MembersWithoutRoles]: "역할 없는 멤버만",
      [GuildExplicitContentFilter.AllMembers]: "모든 멤버",
    }[filter] ?? "알 수 없음"
  );
}

export function notifications(setting: GuildDefaultMessageNotifications): string {
  return (
    {
      [GuildDefaultMessageNotifications.AllMessages]: "모든 메시지",
      [GuildDefaultMessageNotifications.OnlyMentions]: "멘션만",
    }[setting] ?? "알 수 없음"
  );
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

export function mfaLevel(level: GuildMFALevel): string {
  return level === GuildMFALevel.Elevated ? "관리자에게 2단계 인증 필요" : "필요 없음";
}

export function nsfwLevel(level: GuildNSFWLevel): string {
  return (
    {
      [GuildNSFWLevel.Default]: "기본",
      [GuildNSFWLevel.Explicit]: "노골적",
      [GuildNSFWLevel.Safe]: "안전",
      [GuildNSFWLevel.AgeRestricted]: "연령 제한",
    }[level] ?? "알 수 없음"
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

/** 서버가 켠 기능 중 사람이 알아볼 만한 것만. 전부 적으면 스무 줄이 넘는다. */
export function features(guild: Guild): string {
  const known: Record<string, string> = {
    COMMUNITY: "커뮤니티",
    PARTNERED: "파트너",
    VERIFIED: "인증됨",
    DISCOVERABLE: "검색 가능",
    VANITY_URL: "맞춤 초대 링크",
    BANNER: "배너",
    ANIMATED_ICON: "움직이는 아이콘",
    INVITE_SPLASH: "초대 배경",
    ROLE_ICONS: "역할 아이콘",
    WELCOME_SCREEN_ENABLED: "환영 화면",
    MEMBER_VERIFICATION_GATE_ENABLED: "규칙 동의",
    NEWS: "공지 채널",
    SOUNDBOARD: "사운드보드",
  };

  const found = guild.features.map((feature) => known[feature]).filter((name) => name !== undefined);

  return found.length === 0 ? "없음" : found.join(" · ");
}
