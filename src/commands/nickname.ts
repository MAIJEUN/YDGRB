import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { SlashCommandSubcommandBuilder } from "discord.js";

import { runNicknameChange } from "../nickname/execute.js";
import { MAX_NICKNAME_LENGTH, MODE } from "../nickname/ids.js";
import { resolveTargets, searchMembers } from "../nickname/targets.js";
import { describeDurationError, parseDuration } from "../time.js";
import { response } from "../ui/response.js";
import { defineCommand } from "../types.js";

const OPTION = { nickname: "별명", users: "유저", duration: "기간" } as const;

/** 자동완성 후보 값은 100자를 넘을 수 없다. */
const MAX_CHOICE_VALUE = 100;
const MAX_CHOICES = 25;

/**
 * 대상 칸.
 *
 * 슬래시 커맨드에는 여러 명을 고르는 옵션이 없어서 문자열 한 칸으로 받는다.
 * 자동완성으로 고르면 이름이 쉼표로 이어 붙고, 멘션이나 ID 를 붙여넣어도 된다.
 */
function addTargetOption<T extends SlashCommandSubcommandBuilder>(sub: T): T {
  return sub.addStringOption((option) =>
    option
      .setName(OPTION.users)
      .setDescription("여러 명은 쉼표로 구분. 멘션·ID 도 됩니다. 비우면 서버 전원")
      .setAutocomplete(true),
  ) as T;
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

      addTargetOption(sub);

      return sub.addStringOption((option) =>
        option
          .setName(OPTION.duration)
          .setDescription("1일 4시간 45초 · 64(숫자만 쓰면 초). 비우면 직접 풀 때까지"),
      );
    })
    .addSubcommand((sub) =>
      addTargetOption(sub.setName("바사삭").setDescription("별명을 초기화합니다.")),
    ),

  /**
   * 대상 칸 자동완성.
   *
   * 마지막 쉼표 뒤를 검색어로 보고, 앞부분은 그대로 두고 이름만 이어 붙인다.
   * 값이 100자를 넘는 후보는 디스코드가 거부하므로 빼 둔다 —
   * 그쯤이면 멘션을 붙여넣는 편이 낫다.
   */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const guild = interaction.guild;

    if (focused.name !== OPTION.users || guild === null) {
      await interaction.respond([]);
      return;
    }

    const lastComma = focused.value.lastIndexOf(",");
    const prefix = lastComma === -1 ? "" : focused.value.slice(0, lastComma + 1).trimEnd();
    const query = (lastComma === -1 ? focused.value : focused.value.slice(lastComma + 1)).trim();

    const choices = searchMembers(guild, query, MAX_CHOICES)
      .map((member) => ({
        name: `${member.displayName} (@${member.user.username})`.slice(0, MAX_CHOICE_VALUE),
        value: prefix === "" ? member.displayName : `${prefix} ${member.displayName}`,
      }))
      .filter((choice) => choice.value.length <= MAX_CHOICE_VALUE);

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const guild = interaction.guild;
    if (guild === null) {
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

    const raw = interaction.options.getString(OPTION.users)?.trim() ?? "";
    const { ids: targetIds, unresolved } = resolveTargets(guild, raw);

    // 한 명이라도 못 찾으면 실행하지 않는다 — 의도한 인원보다 적게 바꾸는 게 더 나쁘다.
    if (unresolved.length > 0) {
      await interaction.reply(
        response({
          status: "failure",
          title: "누구인지 알 수 없어요",
          description:
            "이름이 정확하지 않거나 같은 이름이 여럿입니다. 멘션이나 ID 로 적으면 확실합니다.",
          fields: [{ name: "못 찾은 값", value: unresolved.map((name) => `\`${name}\``).join(", ") }],
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
    const rawDuration = interaction.options.getString(OPTION.duration)?.trim() ?? "";
    let expiresAt: number | null = null;

    if (rawDuration !== "") {
      const parsed = parseDuration(rawDuration);
      if (!parsed.ok) {
        await interaction.reply(
          response({
            status: "failure",
            title: "기간을 읽을 수 없습니다",
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
