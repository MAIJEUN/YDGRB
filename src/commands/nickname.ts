import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { runNicknameChange } from "../nickname/execute.js";
import { MAX_NICKNAME_LENGTH, MODE } from "../nickname/ids.js";
import { describeDurationError, parseDuration } from "../time.js";
import { response } from "../ui/response.js";
import { defineCommand } from "../types.js";

const OPTION = { nickname: "별명", user: "유저", duration: "기간" } as const;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("별명")
    .setDescription("서버 전체의 별명을 한꺼번에 바꿉니다.")
    .setContexts(InteractionContextType.Guild)
    // 디스코드 쪽에서도 권한 없는 사람에게는 아예 안 보이게 한다.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addSubcommand((sub) =>
      sub
        .setName("뚜따이")
        .setDescription("별명을 정한 값으로 바꿉니다. 기간이 지나면 자동으로 풀립니다.")
        .addStringOption((option) =>
          option
            .setName(OPTION.nickname)
            .setDescription("바꿀 별명")
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(MAX_NICKNAME_LENGTH),
        )
        .addUserOption((option) =>
          option.setName(OPTION.user).setDescription("이 사람만 바꿉니다. 비우면 서버 전원"),
        )
        .addStringOption((option) =>
          option
            .setName(OPTION.duration)
            .setDescription("1일 4시간 45초 · 64(숫자만 쓰면 초). 비우면 직접 풀 때까지"),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("바사삭").setDescription("모두의 별명을 초기화합니다."),
    ),

  async execute(interaction) {
    if (interaction.guildId === null) {
      await interaction.reply(
        response({
          status: "failure",
          title: "서버 전용",
          description: "이 명령은 서버 안에서만 사용할 수 있어요.",
          user: interaction.user,
        }),
      );
      return;
    }

    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageNicknames) !== true) {
      await interaction.reply(
        response({
          status: "failure",
          title: "권한이 없습니다",
          description: "이 기능은 **별명 관리** 권한을 가진 사람만 쓸 수 있어요.",
          user: interaction.user,
        }),
      );
      return;
    }

    if (interaction.options.getSubcommand() === "바사삭") {
      await runNicknameChange(interaction, {
        mode: MODE.basasak,
        nickname: null,
        expiresAt: null,
        targetId: null,
      });
      return;
    }

    const nickname = interaction.options.getString(OPTION.nickname, true).trim();
    if (nickname === "") {
      await interaction.reply(
        response({
          status: "failure",
          title: "뚜따이 실패",
          description: "별명이 비어 있어요.",
          user: interaction.user,
        }),
      );
      return;
    }

    // 기간을 비우면 직접 풀 때까지 유지한다.
    const raw = interaction.options.getString(OPTION.duration)?.trim() ?? "";
    let expiresAt: number | null = null;

    if (raw !== "") {
      const parsed = parseDuration(raw);
      if (!parsed.ok) {
        await interaction.reply(
          response({
            status: "failure",
            title: "기간을 읽을 수 없습니다",
            description: describeDurationError(parsed.reason),
            fields: [{ name: "입력한 값", value: `\`${raw}\`` }],
            user: interaction.user,
          }),
        );
        return;
      }

      expiresAt = Date.now() + parsed.seconds * 1000;
    }

    await runNicknameChange(interaction, {
      mode: MODE.dduttai,
      nickname,
      expiresAt,
      targetId: interaction.options.getUser(OPTION.user)?.id ?? null,
    });
  },
});
