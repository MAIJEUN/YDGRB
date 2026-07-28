import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

import { ACTION, ATTENDANCE, FIELD, MAX_TEXT_LENGTH, MODAL_ID, REWARD_EVERY, REWARD_FRAGMENTS } from "../attendance/ids.js";
import { checkIn, getToday } from "../attendance/store.js";
import { successView } from "../attendance/views.js";
import { logger } from "../logger.js";
import { response } from "../ui/response.js";
import { customId, defineComponentHandler, type ComponentInteraction } from "../types.js";
import { formatBalanceChange } from "../wish/format.js";
import { applyBalanceChange } from "../wish/store.js";

/**
 * 출헉 버튼과 받아쓰기 모달.
 *
 * 버튼은 오늘의 출헉 메시지에 붙어 있고, 그 메시지는 봇을 재시작해도 그대로 남는다.
 * customId 에 상태를 싣지 않고 저장된 「오늘의 출헉」을 그때그때 읽으므로,
 * 어제 메시지의 버튼을 눌러도 오늘 것으로 판정되지 않는다.
 */
export default defineComponentHandler({
  namespace: ATTENDANCE,
  async execute(interaction, args) {
    const guildId = interaction.guildId;
    if (guildId === null) {
      await fail(interaction, "서버 전용", "이 기능은 서버 안에서만 쓸 수 있어요.");
      return;
    }

    switch (args[0]) {
      case ACTION.check:
        await openModal(interaction, guildId);
        return;

      case MODAL_ID.check:
        await submit(interaction, guildId);
        return;

      default:
        logger.warn(`출헉: 모르는 customId ${interaction.customId}`);
        await fail(interaction, "처리할 수 없음", "알 수 없는 동작입니다.");
    }
  },
});

async function fail(
  interaction: ComponentInteraction,
  title: string,
  description: string,
): Promise<void> {
  if (!interaction.isRepliable()) return;

  await interaction.reply(
    response({ status: "failure", title, description, user: interaction.user }),
  );
}

/** 받아쓰기 모달. 정답은 여기 싣지 않는다 — 모달 내용은 클라이언트가 다 볼 수 있다. */
function checkModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(ATTENDANCE, MODAL_ID.check))
    .setTitle("출헉")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("이미지에 적힌 글자를 그대로 적어 주세요")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.answer)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(MAX_TEXT_LENGTH),
        ),
    );
}

async function openModal(interaction: ComponentInteraction, guildId: string): Promise<void> {
  if (!interaction.isButton()) return;

  // 어제 메시지의 버튼일 수 있다.
  if ((await getToday(guildId)) === null) {
    await fail(interaction, "오늘의 출헉이 없습니다", "관리자가 오늘의 출헉을 올리면 참여할 수 있어요.");
    return;
  }

  await interaction.showModal(checkModal());
}

/** 받아 적은 글자를 견준다. 앞뒤 공백만 봐 주고 나머지는 그대로 맞아야 한다. */
function matches(answer: string, text: string): boolean {
  return answer.trim() === text.trim();
}

async function submit(interaction: ComponentInteraction, guildId: string): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  const today = await getToday(guildId);
  if (today === null) {
    await fail(interaction, "오늘의 출헉이 없습니다", "관리자가 오늘의 출헉을 올리면 참여할 수 있어요.");
    return;
  }

  const answer = interaction.fields.getTextInputValue(FIELD.answer);
  if (!matches(answer, today.text)) {
    await fail(interaction, "출헉 실패", "적은 글자가 이미지와 다릅니다. 다시 확인해 주세요.");
    return;
  }

  const result = await checkIn(guildId, interaction.user.id, REWARD_EVERY);
  if (!result.ok) {
    await fail(interaction, "이미 했습니다", "오늘은 이미 출헉했어요.");
    return;
  }

  // 출헉일수가 4의 배수면 소원권 조각을 준다.
  let rewarded: string | undefined;
  if (result.rewarded) {
    const change = await applyBalanceChange(guildId, interaction.user.id, {
      fragments: REWARD_FRAGMENTS,
    });
    if (change.ok) rewarded = formatBalanceChange(change);
    else logger.warn(`출헉: 조각을 주지 못했습니다 (${interaction.user.id})`);
  }

  // 성공은 모두가 보게 남긴다 (successView 가 ephemeral: false 로 만든다).
  await interaction.reply(response(successView(result.record, rewarded, interaction.user)));
}
