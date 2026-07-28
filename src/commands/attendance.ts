import {
  AttachmentBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import { MAX_TEXT_LENGTH } from "../attendance/ids.js";
import { renderText } from "../attendance/image.js";
import {
  addExtra,
  attachMessage,
  clearToday,
  dateKey,
  getToday,
  setToday,
  topAttender,
} from "../attendance/store.js";
import { IMAGE_NAME, alreadyView, todayView } from "../attendance/views.js";
import { logger } from "../logger.js";
import { channelMessage, editResponse, response } from "../ui/response.js";
import { defineCommand } from "../types.js";

/**
 * `/출헉체흐 [텍스트]` — 오늘의 출헉을 올린다.
 *
 * 관리자만 쓸 수 있고, 서버마다 **하루에 한 번**이다.
 * 적은 글자는 이미지로만 보여 준다 — 복사해서 붙여 넣으면 받아쓰기가 아니다.
 */

const OPTION = { text: "텍스트" } as const;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("출헉체흐")
    .setDescription("오늘의 출헉을 올립니다. 하루에 한 번만 쓸 수 있어요.")
    .setContexts(InteractionContextType.Guild)
    // 디스코드 쪽에서도 권한 없는 사람에게는 아예 안 보이게 한다.
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName(OPTION.text)
        .setDescription("받아 적게 할 글자")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(MAX_TEXT_LENGTH),
    ),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
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

    const channel = interaction.channel;
    if (channel === null || !channel.isSendable()) {
      await interaction.reply(
        response({
          status: "failure",
          title: "출헉 실패",
          description: "이 채널에 메시지를 보낼 수 없어요.",
          user: interaction.user,
        }),
      );
      return;
    }

    const text = interaction.options.getString(OPTION.text, true).trim();
    if (text === "") {
      await interaction.reply(
        response({
          status: "failure",
          title: "출헉 실패",
          description: "받아 적게 할 글자를 적어 주세요.",
          user: interaction.user,
        }),
      );
      return;
    }

    // 하루에 한 번. 그래도 올리고 싶으면 버튼으로 — 대신 출헉으로 세지 않는다.
    const already = await getToday(interaction.guildId);
    if (already !== null) {
      // 「오늘의 출헉」 자체를 링크로 건다. 링크를 못 만들면 글자만 남는다.
      const label =
        already.messageId === null
          ? "오늘의 출헉"
          : `[오늘의 출헉](https://discord.com/channels/${interaction.guildId}/${already.channelId}/${already.messageId})`;

      // 방금 적은 글자를 덤 자리에 담아 둔다 — 버튼을 누르면 그대로 올라간다.
      // customId 에 글자를 실을 수는 없다. 그게 곧 정답이다.
      const extra = await addExtra(interaction.guildId, text);

      await interaction.reply(response(alreadyView(label, extra.id, interaction.user)));
      return;
    }

    await interaction.deferReply({ flags: ["Ephemeral"] });

    // 먼저 자리를 잡아 둔다 — 그림을 그리는 사이에 다른 관리자가 또 올리지 못하게.
    await setToday(interaction.guildId, {
      date: dateKey(),
      text,
      by: interaction.user.id,
      channelId: channel.id,
      messageId: null,
    });

    try {
      const image = new AttachmentBuilder(renderText(text), { name: IMAGE_NAME });

      const message = await channel.send({
        ...channelMessage(todayView(await topAttender(interaction.guildId), interaction.user)),
        files: [image],
      });

      await attachMessage(interaction.guildId, message.id);

      await interaction.editReply(
        editResponse({
          status: "success",
          title: "출헉을 올렸습니다",
          description: `<#${channel.id}> 에 올렸어요.`,
          user: interaction.user,
        }),
      );
    } catch (error) {
      // 못 올렸으면 자리도 비워 둔다. 안 그러면 오늘 하루 출헉을 못 하게 된다.
      await clearToday(interaction.guildId);
      logger.error("출헉 올리기 실패", error);

      await interaction.editReply(
        editResponse({
          status: "failure",
          title: "출헉 실패",
          description: "출헉을 올리지 못했습니다.",
          error,
          user: interaction.user,
        }),
      );
    }
  },
});
