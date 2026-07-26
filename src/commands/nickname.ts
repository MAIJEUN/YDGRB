import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";

import { runNicknameChange } from "../nickname/execute.js";
import { MAX_NICKNAME_LENGTH, MODE } from "../nickname/ids.js";
import { describeDurationError, parseDuration } from "../time.js";
import { response } from "../ui/response.js";
import { defineCommand } from "../types.js";

const OPTION = { nickname: "별명", duration: "기간" } as const;

/**
 * 유저 선택 칸.
 *
 * 슬래시 커맨드에는 여러 명을 한 번에 고르는 옵션이 없어서 칸을 여러 개 둔다.
 * 문자열로 멘션을 받는 방법도 있지만, 정식 유저 선택기라야 id 가 정확히 들어온다.
 */
const USER_SLOTS = ["유저", "유저2", "유저3", "유저4", "유저5"] as const;

function addUserSlots<T extends SlashCommandSubcommandBuilder>(sub: T): T {
  for (const [index, name] of USER_SLOTS.entries()) {
    sub.addUserOption((option) =>
      option
        .setName(name)
        .setDescription(
          index === 0 ? "지목한 사람만 바꿉니다. 비우면 서버 전원" : `추가로 지목할 사람 ${index + 1}`,
        ),
    );
  }

  return sub;
}

/** 고른 사람들. 같은 사람을 두 칸에 넣어도 한 번만 센다. */
function targetIdsFrom(interaction: ChatInputCommandInteraction): string[] {
  const ids = USER_SLOTS.map((name) => interaction.options.getUser(name)?.id).filter(
    (id): id is string => id !== undefined,
  );

  return [...new Set(ids)];
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("별명")
    .setDescription("서버 전체의 별명을 한꺼번에 바꿉니다.")
    .setContexts(InteractionContextType.Guild)
    // 디스코드 쪽에서도 권한 없는 사람에게는 아예 안 보이게 한다.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addSubcommand((sub) => {
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
        );

      addUserSlots(sub);

      return sub.addStringOption((option) =>
        option
          .setName(OPTION.duration)
          .setDescription("1일 4시간 45초 · 64(숫자만 쓰면 초). 비우면 직접 풀 때까지"),
      );
    })
    .addSubcommand((sub) =>
      addUserSlots(sub.setName("바사삭").setDescription("별명을 초기화합니다.")),
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

    const targetIds = targetIdsFrom(interaction);

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

    await runNicknameChange(interaction, { mode: MODE.dduttai, nickname, expiresAt, targetIds });
  },
});
