import { MessageFlags, PermissionFlagsBits } from "discord.js";
import type { ModalBuilder, ModalSubmitInteraction, User } from "discord.js";

import { logger } from "../logger.js";
import { reasonField, readModalReason } from "../ui/reason.js";
import { channelMessage, response, updateResponse, type MessageOptions } from "../ui/response.js";
import { defineComponentHandler, type ComponentInteraction } from "../types.js";
import {
  fromMessage,
  galleryFiles,
  galleryImages,
  prepareUploads,
  retained,
  toUploadFiles,
} from "../wish/attachments.js";
import { amountError, formatAmount, parseAmount } from "../wish/amount.js";
import { formatBalance, formatBalanceChange, formatBalanceChangeFor } from "../wish/format.js";
import {
  ACTION,
  DIRECTION,
  FIELD,
  ITEM,
  ITEM_LABEL,
  ITEM_UNIT,
  MODAL_ID,
  PANEL,
  WISH,
  isDirection,
  isItem,
  isPanelKind,
  type Item,
} from "../wish/ids.js";
import { bloodModal, configModal, grantModal, useModal, wasteModal } from "../wish/modals.js";
import { wishDecidedRows, wishDecisionRows } from "../wish/panels.js";
import {
  MAX_FRAGMENTS_PER_TICKET,
  MIN_FRAGMENTS_PER_TICKET,
  applyBalanceChange,
  applyBalanceChanges,
  attachWishMessage,
  createWish,
  deleteWish,
  getBalance,
  getSettings,
  resolveWish,
  updateSettings,
  type BalanceDelta,
  type RankSort,
} from "../wish/store.js";
import type { WishAttachment, WishRecord } from "../wish/types.js";
import { checkView, historyView, noticeView, panelView, rankView } from "../wish/views.js";
import { speak } from "../ui/tone.js";

/**
 * 소원권 시스템의 모든 버튼 · 셀렉트 메뉴 · 모달을 처리한다.
 * customId 는 `wish:<동작>[:인자…]` 형태다.
 */
export default defineComponentHandler({
  namespace: WISH,
  async execute(interaction, args) {
    const [action, ...rest] = args;

    const guildId = interaction.guildId;
    if (guildId === null) {
      await fail(interaction, "서버 전용", speak("이 기능은 서버 안에서만 쓸 수 있어요."));
      return;
    }

    switch (action) {
      // 비활성 버튼(페이지 표시) — 눌려도 아무 일도 하지 않는다.
      case ACTION.noop:
        await interaction.deferUpdate();
        return;

      case ACTION.panel:
        await switchPanel(interaction, guildId, rest[0]);
        return;

      // ── 확인 · 랭킹 ─────────────────────────────────────────
      // 패널에서 누르면 채널에 공개로 띄우고(패널은 그대로), 그 뒤 드롭다운·페이지 조작은
      // 공개된 그 메시지를 갱신한다. 읽기 전용이라 다른 사람이 눌러도 문제없다.
      case ACTION.check:
        await openPublicView(
          interaction,
          await checkView(guildId, interaction.user.id, interaction.user),
        );
        return;

      case ACTION.checkSelect: {
        if (!interaction.isUserSelectMenu()) return;
        const targetId = interaction.values[0] ?? interaction.user.id;
        await replaceView(interaction, await checkView(guildId, targetId, interaction.user));
        return;
      }

      /**
       * 역사 펼치기·접기. customId 에 **눌렀을 때 갈 상태**가 실려 있다.
       *
       * 「확인으로」 도 같은 자리를 쓴다 — 접힌 확인 화면으로 돌아가는 것이 곧 접기다.
       */
      case ACTION.history: {
        const [targetId = interaction.user.id, open] = rest;
        await replaceView(
          interaction,
          await checkView(guildId, targetId, interaction.user, open === "1"),
        );
        return;
      }

      /** 날짜를 골랐다 — 그날 하루를 통째로 보여 준다. */
      case ACTION.historyDay: {
        if (!interaction.isStringSelectMenu()) return;

        const targetId = rest[0] ?? interaction.user.id;
        const date = interaction.values[0];
        if (date === undefined) return;

        await replaceView(interaction, await historyView(guildId, targetId, date, interaction.user));
        return;
      }

      case ACTION.rank:
        await openPublicView(
          interaction,
          await rankView(guildId, "tickets", 0, interaction.user),
        );
        return;

      case ACTION.rankPage:
        await replaceView(
          interaction,
          await rankView(guildId, parseSort(rest[0]), parsePage(rest[1]), interaction.user),
        );
        return;

      case ACTION.rankSort: {
        if (!interaction.isStringSelectMenu()) return;
        await replaceView(
          interaction,
          await rankView(guildId, parseSort(interaction.values[0]), parsePage(rest[0]), interaction.user),
        );
        return;
      }

      case ACTION.craft:
        await craft(interaction, guildId);
        return;

      case ACTION.use:
        await openWishModal(interaction, guildId);
        return;

      case ACTION.waste:
        await showModal(interaction, wasteModal());
        return;

      case ACTION.grant:
        if (await denyNonAdmin(interaction)) return;
        await showModal(interaction, grantModal());
        return;

      case ACTION.config:
        if (await denyNonAdmin(interaction)) return;
        // 현재 값을 채워서 띄운다 — 한 항목만 바꾸고 싶을 때 나머지를 다시 입력하지 않도록.
        await showModal(interaction, configModal(await getSettings(guildId)));
        return;

      case ACTION.blood:
        if (await denyNonAdmin(interaction)) return;
        await showModal(interaction, bloodModal());
        return;

      case ACTION.accept:
      case ACTION.reject:
        await decideWish(interaction, guildId, rest[0], action === ACTION.accept);
        return;

      // ── 모달 제출 ────────────────────────────────────────────
      case MODAL_ID.waste:
        await submitWaste(interaction, guildId);
        return;

      case MODAL_ID.use:
        await submitWish(interaction, guildId);
        return;

      case MODAL_ID.grant:
        await submitGrant(interaction, guildId);
        return;

      case MODAL_ID.blood:
        await submitBlood(interaction, guildId);
        return;

      case MODAL_ID.config:
        await submitConfig(interaction, guildId);
        return;

      default:
        logger.warn(`소원권: 모르는 customId ${interaction.customId}`);
        await fail(interaction, "처리할 수 없음", speak("알 수 없는 동작입니다."));
    }
  },
});

// ─────────────────────────────────────────────────────────────
// 공통 도우미
// ─────────────────────────────────────────────────────────────

/**
 * 패널 메시지를 그 자리에서 갱신한다.
 * 모달이 패널에서 열렸다면 모달 제출도 같은 메시지를 고친다.
 *
 */
async function replaceView(interaction: ComponentInteraction, view: MessageOptions): Promise<void> {
  if (interaction.isMessageComponent()) {
    await interaction.update(updateResponse(view));
    return;
  }

  if (interaction.isModalSubmit() && interaction.isFromMessage()) {
    await interaction.update(updateResponse(view));
    return;
  }

  await interaction.reply(response(view));
}

/**
 * 패널 결과를 채널에 **모두가 보이게** 한 번 더 남긴다.
 *
 * 패널 자체는 누른 사람에게만 보이는(ephemeral) 컨테이너라, 결과가 남지 않는다.
 * 공개본은 기록용이므로 버튼을 뗀다 —
 * 그대로 두면 지나가던 사람이 눌러 자기 계정으로 동작해 버린다.
 */
async function announce(interaction: ComponentInteraction, view: MessageOptions): Promise<void> {
  if (!interaction.isRepliable()) return;

  try {
    await interaction.followUp(
      response({ ...view, rows: [], accessoryButton: undefined, ephemeral: false }),
    );
  } catch (error) {
    // 공개 알림에 실패해도 본 동작은 이미 끝났으므로 로그만 남긴다.
    logger.error("공개 결과 메시지 전송 실패", error);
  }
}

/** 패널을 갱신하고, 같은 결과를 채널에도 공개로 남긴다. */
async function replaceViewAndAnnounce(
  interaction: ComponentInteraction,
  view: MessageOptions,
): Promise<void> {
  await replaceView(interaction, view);
  await announce(interaction, view);
}

/**
 * 패널에서 누른 화면을 채널에 **공개로 띄운다**. 패널 자체는 건드리지 않는다.
 *
 * `announce` 와 달리 버튼·드롭다운을 그대로 싣는다 — 확인/랭킹은 읽기 전용이라
 * 다른 사람이 조작해도 안전하고, 조작 결과는 이 공개 메시지가 갱신된다.
 */
async function openPublicView(
  interaction: ComponentInteraction,
  view: MessageOptions,
): Promise<void> {
  if (!interaction.isMessageComponent()) return;

  // 패널을 그대로 두기 위해 갱신 없이 인터랙션만 종료한다.
  await interaction.deferUpdate();
  await interaction.followUp(response({ ...view, ephemeral: false }));
}

/**
 * 유저 패널 ↔ 관리자 패널 전환.
 *
 * 버튼은 관리자에게만 보이지만, 눌린 것을 그대로 믿지 않고 여기서 다시 확인한다 —
 * customId 는 누구나 흉내 낼 수 있다.
 */
async function switchPanel(
  interaction: ComponentInteraction,
  guildId: string,
  target: string | undefined,
): Promise<void> {
  const admin = isAdmin(interaction);
  const kind = isPanelKind(target) ? target : PANEL.user;

  if (kind === PANEL.admin && !admin) {
    await fail(
      interaction,
      speak("권한이 없습니다"),
      speak("관리자 패널은 **관리자** 권한을 가진 사람만 열 수 있어요."),
    );
    return;
  }

  await replaceView(interaction, await panelView(guildId, kind, interaction.user, admin));
}

/** 패널과 무관한 단발성 오류 안내 (새 임시 메시지). */
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

function isAdmin(interaction: ComponentInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
}

/** 관리자가 아니면 안내하고 true 를 돌려준다. */
async function denyNonAdmin(interaction: ComponentInteraction): Promise<boolean> {
  if (isAdmin(interaction)) return false;

  await fail(interaction, speak("권한이 없습니다"), speak("이 기능은 **관리자** 권한을 가진 사람만 쓸 수 있어요."));
  return true;
}

async function showModal(interaction: ComponentInteraction, modal: ModalBuilder): Promise<void> {
  // showModal 은 아직 응답하지 않은 인터랙션에서만 가능하다.
  if (!interaction.isButton()) return;
  await interaction.showModal(modal);
}

function parseSort(value: string | undefined): RankSort {
  return value === "fragments" ? "fragments" : "tickets";
}

function parsePage(value: string | undefined): number {
  const page = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(page) && page > 0 ? page : 0;
}

// ─────────────────────────────────────────────────────────────
// 제작 — 조각 5개 → 소원권 1장
// ─────────────────────────────────────────────────────────────

async function craft(interaction: ComponentInteraction, guildId: string): Promise<void> {
  // 제작 비용은 서버마다 다르게 정할 수 있다 (관리자 패널 > 설정).
  const { fragmentsPerTicket } = await getSettings(guildId);

  const delta: BalanceDelta = { fragments: -fragmentsPerTicket, tickets: 1 };
  const result = await applyBalanceChange(guildId, interaction.user.id, delta, {
    note: { source: `제작 (조각 ${fragmentsPerTicket}개)` },
  });

  if (!result.ok) {
    await replaceViewAndAnnounce(
      interaction,
      noticeView({
        status: "failure",
        title: "제작 실패",
        description: speak(`조각이 부족합니다. 소원권 1장을 만들려면 조각 **${fragmentsPerTicket}개**가 필요해요.`),
        fields: [{ name: "현재 보유", value: formatBalance(result.before) }],
        user: interaction.user,
        panel: PANEL.user,
        isAdmin: isAdmin(interaction),
      }),
    );
    return;
  }

  await replaceViewAndAnnounce(
    interaction,
    noticeView({
      status: "success",
      title: "제작 완료",
      description: speak(`조각 ${fragmentsPerTicket}개를 소원권 **1장**으로 바꿨습니다.`),
      balance: formatBalanceChange(result),
      user: interaction.user,
      panel: PANEL.user,
      isAdmin: isAdmin(interaction),
    }),
  );
}

// ─────────────────────────────────────────────────────────────
// 낭비 — 고른 항목 1개 소멸
// ─────────────────────────────────────────────────────────────

async function submitWaste(interaction: ComponentInteraction, guildId: string): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  const picked = interaction.fields.getStringSelectValues(FIELD.wasteItem)[0];
  if (!isItem(picked)) {
    await replaceView(
      interaction,
      noticeView({
        status: "failure",
        title: "낭비 실패",
        description: speak("항목을 고르지 않았습니다."),
        user: interaction.user,
        panel: PANEL.user,
        isAdmin: isAdmin(interaction),
      }),
    );
    return;
  }

  const result = await applyBalanceChange(guildId, interaction.user.id, deltaFor(picked, -1), {
    note: { source: `낭비 (${ITEM_LABEL[picked]})` },
  });

  if (!result.ok) {
    await replaceViewAndAnnounce(
      interaction,
      noticeView({
        status: "failure",
        title: "낭비 실패",
        description: speak(`버릴 ${ITEM_LABEL[picked]}이(가) 없습니다.`),
        fields: [{ name: "현재 보유", value: formatBalance(result.before) }],
        user: interaction.user,
        panel: PANEL.user,
        isAdmin: isAdmin(interaction),
      }),
    );
    return;
  }

  await replaceViewAndAnnounce(
    interaction,
    noticeView({
      status: "success",
      title: "낭비",
      description: "🤸",
      balance: formatBalanceChange(result),
      user: interaction.user,
      panel: PANEL.user,
      isAdmin: isAdmin(interaction),
    }),
  );
}

function deltaFor(item: Item, amount: number): BalanceDelta {
  return item === ITEM.ticket ? { tickets: amount } : { fragments: amount };
}

// ─────────────────────────────────────────────────────────────
// 사용 — 소원 빌기
// ─────────────────────────────────────────────────────────────

async function openWishModal(interaction: ComponentInteraction, guildId: string): Promise<void> {
  // 모달을 띄우기 전에 막을 수 있는 건 미리 막는다 (모달을 띄우면 다른 응답을 못 한다).
  const settings = await getSettings(guildId);
  if (settings.wishChannelId === null) {
    await replaceView(
      interaction,
      noticeView({
        status: "failure",
        title: speak("소원을 빌 수 없습니다"),
        description: speak("관리자가 아직 **소원 전달 채널**을 설정하지 않았어요."),
        user: interaction.user,
        panel: PANEL.user,
        isAdmin: isAdmin(interaction),
      }),
    );
    return;
  }

  const balance = await getBalance(guildId, interaction.user.id);
  if (balance.tickets < 1) {
    await replaceView(
      interaction,
      noticeView({
        status: "failure",
        title: speak("소원권이 없습니다"),
        description: speak(`조각 ${settings.fragmentsPerTicket}개를 모아 제작하면 소원을 빌 수 있어요.`),
        fields: [{ name: "현재 보유", value: formatBalance(balance) }],
        user: interaction.user,
        panel: PANEL.user,
        isAdmin: isAdmin(interaction),
      }),
    );
    return;
  }

  await showModal(interaction, useModal());
}

async function submitWish(interaction: ComponentInteraction, guildId: string): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  const content = interaction.fields.getTextInputValue(FIELD.wishContent).trim();
  const attachments = prepareUploads(interaction.fields.getUploadedFiles(FIELD.wishFiles));

  const channelId = (await getSettings(guildId)).wishChannelId;
  if (channelId === null) {
    await replaceView(
      interaction,
      noticeView({
        status: "failure",
        title: speak("소원을 빌 수 없습니다"),
        description: speak("관리자가 아직 **소원 전달 채널**을 설정하지 않았어요."),
        user: interaction.user,
        panel: PANEL.user,
        isAdmin: isAdmin(interaction),
      }),
    );
    return;
  }

  // 소원권을 먼저 차감한다. 전달에 실패하면 아래에서 되돌린다.
  const spent = await applyBalanceChange(guildId, interaction.user.id, { tickets: -1 }, {
    note: { source: "소원 빌기" },
  });
  if (!spent.ok) {
    await replaceView(
      interaction,
      noticeView({
        status: "failure",
        title: speak("소원권이 없습니다"),
        description: speak("소원을 빌려면 소원권이 1장 필요해요."),
        fields: [{ name: "현재 보유", value: formatBalance(spent.before) }],
        user: interaction.user,
        panel: PANEL.user,
        isAdmin: isAdmin(interaction),
      }),
    );
    return;
  }

  const wish = await createWish(guildId, {
    userId: interaction.user.id,
    content,
    attachments,
    channelId,
  });

  try {
    const channel = await interaction.client.channels.fetch(channelId);
    if (channel === null || !channel.isSendable()) {
      throw new Error(`메시지를 보낼 수 없는 채널입니다: ${channelId}`);
    }

    // 파일을 봇 메시지에 다시 올려 영구 첨부로 만든다.
    // 컨테이너가 그 첨부를 attachment:// 로 가리키므로 파일이 따로 또 그려지지 않는다.
    const message = await channel.send({
      ...channelMessage(wishMessage(content, interaction.user, attachments, wish.id)),
      files: toUploadFiles(attachments),
    });

    // 임시 URL 을 메시지에 붙은 영구 URL 로 교체해 둔다.
    await attachWishMessage(guildId, wish.id, message.id, fromMessage(message));

    await replaceView(
      interaction,
      noticeView({
        status: "success",
        title: speak("소원을 보냈습니다"),
        description: speak(`<#${channelId}> 로 전달했습니다.`),
        fields: [{ name: "소원 내용", value: content.slice(0, 1000) }],
        balance: formatBalanceChange(spent),
        user: interaction.user,
        panel: PANEL.user,
        isAdmin: isAdmin(interaction),
      }),
    );
  } catch (error) {
    logger.error("소원 전달 실패 — 소원권을 되돌립니다", error);

    // 전달에 실패했으므로 차감을 취소한다.
    const refund = await applyBalanceChange(guildId, interaction.user.id, { tickets: 1 }, {
      note: { source: "소원 전달 실패 — 환불" },
    });
    await deleteWish(guildId, wish.id);

    await replaceView(
      interaction,
      noticeView({
        status: "failure",
        title: "소원 전달 실패",
        description: speak("설정된 채널에 메시지를 보내지 못했습니다. 관리자에게 알려 주세요."),
        error,
        balance: refund.ok ? formatBalanceChange(refund) : undefined,
        user: interaction.user,
        panel: PANEL.user,
        isAdmin: isAdmin(interaction),
      }),
    );
  }
}

/** 소원 전달 메시지. 처리 대기 중이므로 진행중(노랑). */
function wishMessage(
  content: string,
  requester: User,
  files: readonly WishAttachment[],
  wishId: string,
): MessageOptions {
  return {
    status: "progress",
    title: "새 소원",
    description: content,
    fields: [{ name: "신청자", value: `<@${requester.id}>` }],
    images: galleryImages(files),
    files: galleryFiles(files),
    user: requester,
    ephemeral: false,
    rows: wishDecisionRows(wishId),
  };
}

// ─────────────────────────────────────────────────────────────
// 소원 수락 / 거절
// ─────────────────────────────────────────────────────────────

async function decideWish(
  interaction: ComponentInteraction,
  guildId: string,
  wishId: string | undefined,
  accepted: boolean,
): Promise<void> {
  if (!interaction.isButton()) return;
  if (await denyNonAdmin(interaction)) return;

  if (wishId === undefined) {
    await fail(interaction, "처리할 수 없음", speak("소원 정보를 찾지 못했습니다."));
    return;
  }

  const resolved = await resolveWish(
    guildId,
    wishId,
    accepted ? "accepted" : "rejected",
    interaction.user.id,
  );

  if (!resolved.ok) {
    await fail(
      interaction,
      "이미 처리된 소원",
      resolved.reason === "missing"
        ? speak("소원 정보를 찾지 못했습니다.")
        : speak("다른 관리자가 먼저 처리했습니다."),
    );
    return;
  }

  const { wish } = resolved;

  // 거절하면 소원권 1장을 돌려준다.
  const refund = accepted
    ? null
    : await applyBalanceChange(guildId, wish.userId, { tickets: 1 }, {
        note: { source: "소원 거절 — 환불", reason: `<@${interaction.user.id}> 님이 거절` },
      });
  const refundText = refund !== null && refund.ok ? formatBalanceChange(refund) : undefined;

  const status = accepted ? "success" : "failure";

  // ① 원본은 **내용을 그대로 두고** 결과 색과 눌리지 않는 버튼으로만 바꾼다.
  //    이미지와 첨부가 여기 붙어 있어서, 결과를 원본에 덮어쓰면 그게 날아간다.
  if (interaction.message.flags.has(MessageFlags.IsComponentsV2)) {
    // 컨테이너가 곧 메시지 전체라 버튼만 따로 갈아 끼울 수 없다 — 같은 내용으로 다시 그린다.
    // 이때 원래 붙어 있던 첨부를 id 그대로 다시 넘겨야 `attachment://` 참조가 풀리지 않는다.
    const requester = await fetchUser(interaction, wish.userId);

    await interaction.update({
      ...updateResponse({
        ...wishMessage(wish.content, requester, wish.attachments, wish.id),
        status,
        rows: wishDecidedRows(accepted),
      }),
      attachments: retained(interaction.message),
    });
  } else {
    // 이 규칙을 정하기 전에 올라간 임베드 메시지 — 메시지의 V2 여부는 나중에 못 바꾼다.
    // embeds / attachments 를 아예 넘기지 않으면 디스코드가 그 필드를 손대지 않는다.
    await interaction.update({ components: wishDecidedRows(accepted) });
  }

  // ② 결과는 원본을 덮지 않고 **답글**로 남긴다.
  await interaction.message.reply(
    channelMessage({
      status,
      title: accepted ? "소원 수락됨" : "소원 거절됨",
      description: wish.content,
      fields: [
        { name: "신청자", value: `<@${wish.userId}>` },
        { name: "처리한 관리자", value: `<@${interaction.user.id}>` },
      ],
      balance: refundText,
      user: interaction.user,
      ephemeral: false,
    }),
  );

  await notifyWisher(interaction, wish, accepted, refundText, interaction.message.url);
}

/**
 * footer 에 쓸 유저. 캐시에 있으면 바로 돌아온다.
 * 못 찾으면 버튼을 누른 사람으로 대신한다 — footer 하나 때문에 처리를 실패시킬 이유는 없다.
 */
async function fetchUser(interaction: ComponentInteraction, userId: string): Promise<User> {
  try {
    return await interaction.client.users.fetch(userId);
  } catch (error) {
    logger.debug(`유저 조회 실패 ${userId}`, error);
    return interaction.user;
  }
}

/** 신청자에게 DM 으로 알린다. DM 이 막혀 있으면 조용히 넘어간다. */
async function notifyWisher(
  interaction: ComponentInteraction,
  wish: WishRecord,
  accepted: boolean,
  refundText: string | undefined,
  messageUrl: string,
): Promise<void> {
  try {
    const target = await interaction.client.users.fetch(wish.userId);

    await target.send(
      channelMessage({
        status: accepted ? "success" : "failure",
        title: accepted ? speak("소원이 수락되었습니다") : speak("소원이 거절되었습니다"),
        description: wish.content,
        fields: [
          // 첨부파일은 원본 메시지에 붙어 있다. 링크로 안내한다
          // (DM 에 다시 올리면 파일이 두 벌이 되고, 저장된 URL 은 언젠가 만료된다).
          { name: "원본", value: `[소원 보러 가기](${messageUrl})` },
          // 환불은 변동 문구(`소원권: 0장 → 1장`)가 이미 말한다. 따로 적지 않는다.
        ],
        balance: refundText,
        user: target,
        ephemeral: false,
      }),
    );
  } catch (error) {
    logger.debug("소원 결과 DM 전송 실패 (DM 차단 등)", error);
  }
}

// ─────────────────────────────────────────────────────────────
// 수수 — 지급 / 회수
// ─────────────────────────────────────────────────────────────

async function submitGrant(interaction: ComponentInteraction, guildId: string): Promise<void> {
  if (!interaction.isModalSubmit()) return;
  if (await denyNonAdmin(interaction)) return;

  const direction = interaction.fields.getStringSelectValues(FIELD.grantDirection)[0];
  const item = interaction.fields.getStringSelectValues(FIELD.grantItem)[0];
  const targets = interaction.fields.getSelectedUsers(FIELD.grantUsers);
  const rawAmount = interaction.fields.getTextInputValue(FIELD.grantAmount);
  const reason = readModalReason(interaction, FIELD.grantReason);

  if (!isDirection(direction) || !isItem(item)) {
    await replaceView(
      interaction,
      adminFailure(interaction, "수수 실패", speak("지급/회수와 항목을 모두 골라 주세요.")),
    );
    return;
  }

  const amount = parseAmount(rawAmount);
  if (amount === undefined) {
    await replaceView(interaction, adminFailure(interaction, "수수 실패", amountError(rawAmount)));
    return;
  }

  const userIds = targets === null ? [] : [...targets.keys()];
  if (userIds.length === 0) {
    await replaceView(
      interaction,
      adminFailure(interaction, "수수 실패", speak("대상 유저를 한 명 이상 골라 주세요.")),
    );
    return;
  }

  const taking = direction === DIRECTION.take;
  const sign = taking ? -1 : 1;

  // 회수는 **있는 만큼만** 걷는다. 5장 가진 사람에게 100장을 회수하면 0장이 된다 —
  // 「가진 걸 다 걷는다」 가 회수의 뜻이라, 모자라다고 아무것도 안 하는 게 더 이상하다.
  const results = await applyBalanceChanges(guildId, userIds, deltaFor(item, sign * amount), {
    note: { source: `수수 — ${taking ? "회수" : "지급"}`, reason },
    clamp: taking,
  });

  const changed: string[] = [];
  const rejected: string[] = [];

  for (const [userId, result] of results) {
    if (result.ok) changed.push(formatBalanceChangeFor(userId, result));
    else rejected.push(speak(`<@${userId}> — 보유량이 부족합니다 (현재 ${formatBalance(result.before)})`));
  }

  const label = taking ? "회수" : "지급";
  const status = rejected.length === 0 ? "success" : changed.length === 0 ? "failure" : "progress";

  await replaceViewAndAnnounce(
    interaction,
    noticeView({
      status,
      // 회수는 적은 만큼 다 걷히지 않을 수 있으므로 「최대」 라고 적는다.
      title: `수수 — ${label}`,
      description: `${ITEM_LABEL[item]} **${taking ? "최대 " : ""}${formatAmount(amount)}${ITEM_UNIT[item]}** · 대상 ${userIds.length}명 중 ${changed.length}명 처리`,
      fields: [
        ...(rejected.length > 0 ? [{ name: "처리하지 못함", value: rejected.join("\n") }] : []),
        // 사유는 늘 맨 끝이다 — 패널티 쪽과 같은 자리.
        ...reasonField(reason),
      ],
      balance: changed.length > 0 ? changed.join("\n\n") : undefined,
      user: interaction.user,
      panel: PANEL.admin,
      isAdmin: isAdmin(interaction),
    }),
  );
}

function adminFailure(
  interaction: ComponentInteraction,
  title: string,
  description: string,
): MessageOptions {
  return noticeView({
    status: "failure",
    title,
    description,
    user: interaction.user,
    panel: PANEL.admin,
    isAdmin: isAdmin(interaction),
  });
}

// ─────────────────────────────────────────────────────────────
// 흡혈 — 한 유저에게서 다른 유저에게로 옮기기
// ─────────────────────────────────────────────────────────────

function firstSelectedUser(
  interaction: ModalSubmitInteraction,
  field: string,
): string | undefined {
  const users = interaction.fields.getSelectedUsers(field);
  return users === null ? undefined : [...users.keys()][0];
}

async function submitBlood(interaction: ComponentInteraction, guildId: string): Promise<void> {
  if (!interaction.isModalSubmit()) return;
  if (await denyNonAdmin(interaction)) return;

  const item = interaction.fields.getStringSelectValues(FIELD.bloodItem)[0];
  const from = firstSelectedUser(interaction, FIELD.bloodFrom);
  const to = firstSelectedUser(interaction, FIELD.bloodTo);
  const rawAmount = interaction.fields.getTextInputValue(FIELD.bloodAmount);
  const reason = readModalReason(interaction, FIELD.bloodReason);

  if (!isItem(item) || from === undefined || to === undefined) {
    await replaceView(
      interaction,
      adminFailure(interaction, "흡혈 실패", speak("항목과 두 유저를 모두 골라 주세요.")),
    );
    return;
  }

  if (from === to) {
    await replaceView(
      interaction,
      adminFailure(interaction, "흡혈 실패", speak("같은 사람에게서 흡혈할 수는 없어요.")),
    );
    return;
  }

  const amount = parseAmount(rawAmount);
  if (amount === undefined) {
    await replaceView(interaction, adminFailure(interaction, "흡혈 실패", amountError(rawAmount)));
    return;
  }

  // 먼저 뺀다. 부족하면 applyBalanceChange 가 아무것도 바꾸지 않고 ok:false 를 돌려준다.
  const drained = await applyBalanceChange(guildId, from, deltaFor(item, -amount), {
    note: { source: `흡혈 — <@${to}> 님에게`, reason },
  });
  if (!drained.ok) {
    await replaceViewAndAnnounce(
      interaction,
      noticeView({
        status: "failure",
        title: "흡혈 실패",
        description: speak(`<@${from}> 님의 ${ITEM_LABEL[item]}이(가) 부족합니다.`),
        fields: [{ name: "현재 보유", value: formatBalance(drained.before) }],
        user: interaction.user,
        panel: PANEL.admin,
        isAdmin: isAdmin(interaction),
      }),
    );
    return;
  }

  const gained = await applyBalanceChange(guildId, to, deltaFor(item, amount), {
    note: { source: `흡혈 — <@${from}> 님에게서`, reason },
  });
  if (!gained.ok) {
    // 더하는 변경은 음수가 될 수 없어 실패하지 않지만, 만에 하나 실패하면 뺀 것을 되돌린다.
    await applyBalanceChange(guildId, from, deltaFor(item, amount), {
      note: { source: "흡혈 되돌림" },
    });
    await replaceView(
      interaction,
      adminFailure(interaction, "흡혈 실패", speak("옮기는 중 문제가 생겨 되돌렸습니다.")),
    );
    return;
  }

  await replaceViewAndAnnounce(
    interaction,
    noticeView({
      status: "success",
      title: "흡혈",
      description: `${ITEM_LABEL[item]} **${formatAmount(amount)}${ITEM_UNIT[item]}** · <@${from}> → <@${to}>`,
      fields: reasonField(reason),
      balance: [formatBalanceChangeFor(from, drained), formatBalanceChangeFor(to, gained)].join("\n\n"),
      user: interaction.user,
      panel: PANEL.admin,
      isAdmin: isAdmin(interaction),
    }),
  );
}

// ─────────────────────────────────────────────────────────────
// 설정 — 소원 전달 채널 · 제작 비용
// ─────────────────────────────────────────────────────────────

async function submitConfig(interaction: ComponentInteraction, guildId: string): Promise<void> {
  if (!interaction.isModalSubmit()) return;
  if (await denyNonAdmin(interaction)) return;

  const rawCost = interaction.fields.getTextInputValue(FIELD.fragmentsPerTicket).trim();
  const cost = Number.parseInt(rawCost, 10);

  if (
    !/^\d+$/.test(rawCost) ||
    cost < MIN_FRAGMENTS_PER_TICKET ||
    cost > MAX_FRAGMENTS_PER_TICKET
  ) {
    await replaceView(
      interaction,
      adminFailure(
        interaction,
        "설정 실패",
        speak(`제작 비용은 ${MIN_FRAGMENTS_PER_TICKET} 이상 ${MAX_FRAGMENTS_PER_TICKET} 이하의 정수여야 해요. (입력: \`${rawCost}\`)`),
      ),
    );
    return;
  }

  // 채널은 선택 항목이다. 고르지 않았으면 기존 값을 그대로 둔다.
  const channels = interaction.fields.getSelectedChannels(FIELD.configChannel);
  const channelId = channels === null ? undefined : [...channels.keys()][0];

  const settings = await updateSettings(guildId, {
    fragmentsPerTicket: cost,
    ...(channelId === undefined ? {} : { wishChannelId: channelId }),
  });

  await replaceView(
    interaction,
    noticeView({
      status: "success",
      title: "설정 완료",
      description:
        settings.wishChannelId === null
          ? speak("소원 전달 채널이 아직 없어서 소원 빌기는 쓸 수 없습니다.")
          : speak(`소원은 <#${settings.wishChannelId}> 로 전달됩니다.`),
      fields: [
        {
          name: "제작 비용",
          value: `조각 **${settings.fragmentsPerTicket}개** = 소원권 1장`,
        },
      ],
      user: interaction.user,
      panel: PANEL.admin,
      isAdmin: isAdmin(interaction),
    }),
  );
}
