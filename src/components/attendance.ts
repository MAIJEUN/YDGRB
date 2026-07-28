import {
  AttachmentBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import {
  ACTION,
  ATTENDANCE,
  FIELD,
  MAX_TEXT_LENGTH,
  MODAL_ID,
  REWARD_EVERY,
  REWARD_FRAGMENTS,
} from "../attendance/ids.js";
import { renderText } from "../attendance/image.js";
import { checkIn, getExtra, getToday } from "../attendance/store.js";
import { IMAGE_NAME, extraSuccessView, successView, todayView } from "../attendance/views.js";
import { logger } from "../logger.js";
import { channelMessage, response } from "../ui/response.js";
import { customId, defineComponentHandler, type ComponentInteraction } from "../types.js";
import { formatBalanceChange } from "../wish/format.js";
import { applyBalanceChange } from "../wish/store.js";

/**
 * 출헉 버튼과 받아쓰기 모달.
 *
 * 버튼은 출헉 메시지에 붙어 있고, 그 메시지는 봇을 재시작해도 그대로 남는다.
 * customId 에 정답을 싣지 않고 저장된 것을 그때그때 읽으므로,
 * 어제 메시지의 버튼을 눌러도 오늘 것으로 판정되지 않는다.
 *
 * 덤(「그래도 계속」으로 올린 것)은 id 를 customId 에 실어 구분한다.
 * 받아쓰기는 똑같이 하지만 출헉으로 세지 않는다.
 */
export default defineComponentHandler({
  namespace: ATTENDANCE,
  async execute(interaction, args) {
    const [action, extraId] = args;

    const guildId = interaction.guildId;
    if (guildId === null) {
      await fail(interaction, "서버 전용", "이 기능은 서버 안에서만 쓸 수 있어요.");
      return;
    }

    switch (action) {
      case ACTION.check:
        await openAnswerModal(interaction, guildId, extraId);
        return;

      case ACTION.again:
        await postExtra(interaction, guildId, extraId);
        return;

      case MODAL_ID.answer:
        await submitAnswer(interaction, guildId, extraId);
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

// ─────────────────────────────────────────────────────────────
// 받아쓰기
// ─────────────────────────────────────────────────────────────

/** 정답은 여기 싣지 않는다 — 모달 내용은 클라이언트가 다 볼 수 있다. */
function answerModal(extraId: string | undefined): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(
      extraId === undefined
        ? customId(ATTENDANCE, MODAL_ID.answer)
        : customId(ATTENDANCE, MODAL_ID.answer, extraId),
    )
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

/** 이 버튼이 가리키는 글자. 오늘 것이 아니면 null. */
async function textOf(guildId: string, extraId: string | undefined): Promise<string | null> {
  if (extraId !== undefined) return (await getExtra(guildId, extraId))?.text ?? null;
  return (await getToday(guildId))?.text ?? null;
}

async function openAnswerModal(
  interaction: ComponentInteraction,
  guildId: string,
  extraId: string | undefined,
): Promise<void> {
  if (!interaction.isButton()) return;

  // 어제 메시지의 버튼일 수 있다.
  if ((await textOf(guildId, extraId)) === null) {
    await fail(interaction, "지난 출헉입니다", "오늘 올라온 출헉에서만 참여할 수 있어요.");
    return;
  }

  await interaction.showModal(answerModal(extraId));
}

/** 받아 적은 글자를 견준다. 앞뒤 공백만 봐 주고 나머지는 그대로 맞아야 한다. */
function matches(answer: string, text: string): boolean {
  return answer.trim() === text.trim();
}

async function submitAnswer(
  interaction: ComponentInteraction,
  guildId: string,
  extraId: string | undefined,
): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  const text = await textOf(guildId, extraId);
  if (text === null) {
    await fail(interaction, "지난 출헉입니다", "오늘 올라온 출헉에서만 참여할 수 있어요.");
    return;
  }

  if (!matches(interaction.fields.getTextInputValue(FIELD.answer), text)) {
    await fail(interaction, "출헉 실패", "적은 글자가 이미지와 다릅니다. 다시 확인해 주세요.");
    return;
  }

  // 덤은 맞혀도 출헉으로 세지 않는다.
  if (extraId !== undefined) {
    await interaction.reply(response(extraSuccessView(interaction.user)));
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

  // 성공은 누른 사람에게만 보인다 (response 기본값이 나만 보기).
  await interaction.reply(response(successView(result.record, rewarded, interaction.user)));
}

// ─────────────────────────────────────────────────────────────
// 그래도 계속 — 기록되지 않는 덤을 하나 더
// ─────────────────────────────────────────────────────────────

async function postExtra(
  interaction: ComponentInteraction,
  guildId: string,
  extraId: string | undefined,
): Promise<void> {
  if (!interaction.isButton()) return;

  // 버튼은 관리자에게만 갔지만, 눌린 것을 그대로 믿지 않는다.
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) !== true) {
    await fail(interaction, "권한이 없습니다", "출헉은 **관리자** 권한을 가진 사람만 올릴 수 있어요.");
    return;
  }

  const extra = extraId === undefined ? null : await getExtra(guildId, extraId);
  if (extra === null) {
    await fail(interaction, "올릴 수 없습니다", "올릴 내용을 찾지 못했어요. 명령을 다시 써 주세요.");
    return;
  }

  const channel = interaction.channel;
  if (channel === null || !channel.isSendable()) {
    await fail(interaction, "출헉 실패", "이 채널에 메시지를 보낼 수 없어요.");
    return;
  }

  await interaction.deferUpdate();

  try {
    await channel.send({
      ...channelMessage(todayView(null, interaction.user, extra.id)),
      files: [new AttachmentBuilder(renderText(extra.text), { name: IMAGE_NAME })],
    });
  } catch (error) {
    logger.error("출헉 덤 올리기 실패", error);

    await interaction.followUp(
      response({
        status: "failure",
        title: "출헉 실패",
        description: "출헉을 올리지 못했습니다.",
        error,
        user: interaction.user,
      }),
    );
  }
}
