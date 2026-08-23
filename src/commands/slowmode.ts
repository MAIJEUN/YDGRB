import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { GuildBasedChannel } from "discord.js";

import { describeDurationError, formatDuration, parseDuration } from "../time.js";
import { editResponse, response } from "../ui/response.js";
import { defineCommand } from "../types.js";
import { speak } from "../ui/tone.js";

/**
 * 슬로우뿡모드 — **명령을 쓴 채널**의 슬로우 모드를 정한다.
 *
 * 사람에게 거는 것이 아니라 **채널 설정**이라, [사유](../ui/reason.ts) 칸이 없다
 * (채팅뻥과 같은 이유다). 누가 걸었는지는 감사 로그에 남는다.
 *
 * 스레드는 부모로 올라가지 않는다 — 채팅뻥은 권한 덮어쓰기라 부모를 봐야 했지만,
 * 슬로우 모드는 스레드가 **자기 것**을 따로 갖는다.
 */

const OPTION = { time: "시간" } as const;

/** 디스코드가 받는 최대 슬로우 모드 — 여섯 시간. 그 위는 API 가 거절한다. */
export const MAX_SLOWMODE_SECONDS = 6 * 60 * 60;

/** 슬로우 모드를 걸 수 있는 채널인가. 카테고리처럼 글이 안 올라가는 곳에는 없다. */
function canSlow(
  channel: GuildBasedChannel,
): channel is GuildBasedChannel & { rateLimitPerUser: number } {
  return "setRateLimitPerUser" in channel && "rateLimitPerUser" in channel;
}

/** `없음` · `30초` — 0은 「몇 초」가 아니라 꺼진 상태다. */
function describe(seconds: number): string {
  return seconds === 0 ? "없음" : formatDuration(seconds);
}

/**
 * 적은 시간을 읽는다. **0은 해제**다.
 *
 * [기간 파서](../time.ts)는 0을 거절한다 — 「10초 동안 타임아웃」 같은 곳에서는 0이
 * 뜻을 갖지 않기 때문이다. 여기서만 그 거절을 **해제로 받아 준다.**
 */
function readSeconds(raw: string): { readonly ok: true; readonly seconds: number } | { readonly ok: false; readonly why: string } {
  const parsed = parseDuration(raw);

  if (!parsed.ok) {
    if (parsed.reason === "zero") return { ok: true, seconds: 0 };
    return { ok: false, why: describeDurationError(parsed.reason) };
  }

  if (parsed.seconds > MAX_SLOWMODE_SECONDS) {
    return {
      ok: false,
      why: speak(`슬로우 모드는 **${formatDuration(MAX_SLOWMODE_SECONDS)}** 까지만 걸 수 있어요.`),
    };
  }

  return { ok: true, seconds: parsed.seconds };
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("슬로우뿡모드")
    .setDescription(speak("이 채널의 슬로우 모드를 정합니다. 0이면 해제합니다."))
    .setContexts(InteractionContextType.Guild)
    // 디스코드 쪽에서도 권한 없는 사람에게는 아예 안 보이게 한다.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((option) =>
      option
        .setName(OPTION.time)
        .setDescription(`0 이면 해제 · 30 · 5분 (숫자만 쓰면 초). 최대 ${formatDuration(MAX_SLOWMODE_SECONDS)}`)
        .setRequired(true)
        .setMaxLength(30),
    ),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply(
        response({
          status: "failure",
          title: "서버 전용",
          description: speak("이 명령은 서버 안에서만 사용할 수 있어요."),
          user: interaction.user,
        }),
      );
      return;
    }

    const channel = interaction.channel;
    if (channel === null || !canSlow(channel)) {
      await interaction.reply(
        response({
          status: "failure",
          title: speak("걸 수 없는 채널입니다"),
          description: speak("이 채널에는 슬로우 모드가 없어요."),
          user: interaction.user,
        }),
      );
      return;
    }

    const me = interaction.guild.members.me;
    if (me === null || !channel.permissionsFor(me).has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply(
        response({
          status: "failure",
          title: "슬로우뿡모드 실패",
          description: speak("이 채널에서 봇에게 **채널 관리(Manage Channels)** 권한이 없습니다."),
          fields: [{ name: "채널", value: `<#${channel.id}>` }],
          user: interaction.user,
        }),
      );
      return;
    }

    const raw = interaction.options.getString(OPTION.time, true);
    const wanted = readSeconds(raw);

    if (!wanted.ok) {
      await interaction.reply(
        response({
          status: "failure",
          title: speak("시간을 읽을 수 없습니다"),
          description: wanted.why,
          fields: [{ name: "입력한 값", value: `\`${raw.trim()}\`` }],
          user: interaction.user,
        }),
      );
      return;
    }

    const before = channel.rateLimitPerUser;
    await interaction.deferReply();

    try {
      await channel.setRateLimitPerUser(
        wanted.seconds,
        `슬로우뿡모드 — ${interaction.user.tag}`,
      );
    } catch (error) {
      await interaction.editReply(
        editResponse({
          status: "failure",
          title: "슬로우뿡모드 실패",
          description: speak("슬로우 모드를 바꾸지 못했습니다."),
          error,
          fields: [{ name: "채널", value: `<#${channel.id}>` }],
          user: interaction.user,
        }),
      );
      return;
    }

    const off = wanted.seconds === 0;

    await interaction.editReply(
      editResponse({
        status: "success",
        title: off ? speak("슬로우뿡모드 — 껐습니다") : speak("슬로우뿡모드 — 걸었습니다"),
        description: off
          ? speak(`<#${channel.id}> 의 슬로우 모드를 풀었습니다.`)
          : speak(`<#${channel.id}> 에서 한 사람당 **${formatDuration(wanted.seconds)}** 에 한 번만 쓸 수 있습니다.`),
        fields: [{ name: "슬로우 모드", value: `${describe(before)} → **${describe(wanted.seconds)}**` }],
        user: interaction.user,
      }),
    );
  },
});
