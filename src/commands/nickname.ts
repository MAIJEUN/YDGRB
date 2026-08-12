import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { SlashCommandSubcommandBuilder } from "discord.js";

import { runNicknameChange } from "../nickname/execute.js";
import { MAX_NICKNAME_LENGTH, MODE } from "../nickname/ids.js";
import { describeDurationError, parseDuration } from "../time.js";
import { response } from "../ui/response.js";
import { defineCommand } from "../types.js";
import { speak } from "../ui/tone.js";

const OPTION = { nickname: "별명", user: "유저", duration: "기간" } as const;

/** 대상 칸 — 비우면 서버 전원. */
function addTargetOption<T extends SlashCommandSubcommandBuilder>(sub: T): T {
  return sub.addUserOption((option) =>
    option.setName(OPTION.user).setDescription(speak("지목한 사람만 바꿉니다. 비우면 서버 전원")),
  ) as T;
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("별명")
    .setDescription(speak("서버 전체의 별명을 한꺼번에 바꿉니다."))
    .setContexts(InteractionContextType.Guild)
    // 디스코드 쪽에서도 권한 없는 사람에게는 아예 안 보이게 한다.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addSubcommand((sub) => {
      sub
        .setName("뚜따이")
        .setDescription(speak("별명을 정한 값으로 바꿉니다. 기간이 지나면 자동으로 풀립니다."))
        .addStringOption((option) =>
          option
            .setName(OPTION.nickname)
            .setDescription("바꿀 별명")
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(MAX_NICKNAME_LENGTH),
        );

      addTargetOption(sub);

      return sub.addStringOption((option) =>
        option
          .setName(OPTION.duration)
          .setDescription("1일 4시간 45초 · 64(숫자만 쓰면 초). 비우면 직접 풀 때까지"),
      );
    })
    .addSubcommand((sub) =>
      addTargetOption(sub.setName("바사삭").setDescription(speak("별명을 초기화합니다."))),
    ),

  async execute(interaction) {
    if (interaction.guildId === null) {
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

    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageNicknames) !== true) {
      await interaction.reply(
        response({
          status: "failure",
          title: speak("권한이 없습니다"),
          description: speak("이 기능은 **별명 관리** 권한을 가진 사람만 쓸 수 있어요."),
          user: interaction.user,
        }),
      );
      return;
    }

    // 아래 흐름은 여러 명도 받을 수 있게 되어 있다. 지금은 최대 한 명만 넘긴다.
    const target = interaction.options.getUser(OPTION.user);
    const targetIds = target === null ? [] : [target.id];

    if (interaction.options.getSubcommand() === "바사삭") {
      await runNicknameChange(interaction, {
        mode: MODE.basasak,
        nickname: null,
        expiresAt: null,
        targetIds,
      });
      return;
    }

    const nickname = interaction.options.getString(OPTION.nickname, true).trim();
    if (nickname === "") {
      await interaction.reply(
        response({
          status: "failure",
          title: "뚜따이 실패",
          description: speak("별명이 비어 있어요."),
          user: interaction.user,
        }),
      );
      return;
    }

    // 기간을 비우면 직접 풀 때까지 유지한다.
    const rawDuration = interaction.options.getString(OPTION.duration)?.trim() ?? "";
    let expiresAt: number | null = null;

    if (rawDuration !== "") {
      const parsed = parseDuration(rawDuration);
      if (!parsed.ok) {
        await interaction.reply(
          response({
            status: "failure",
            title: speak("기간을 읽을 수 없습니다"),
            description: describeDurationError(parsed.reason),
            fields: [{ name: "입력한 값", value: `\`${rawDuration}\`` }],
            user: interaction.user,
          }),
        );
        return;
      }

      expiresAt = Date.now() + parsed.seconds * 1000;
    }

    await runNicknameChange(interaction, { mode: MODE.dduttai, nickname, expiresAt, targetIds });
  },
});
