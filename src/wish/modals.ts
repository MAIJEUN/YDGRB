import {
  ChannelSelectMenuBuilder,
  ChannelType,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from "discord.js";

import { customId } from "../types.js";
import {
  DIRECTION,
  FIELD,
  ITEM,
  ITEM_LABEL,
  MAX_AMOUNT_DIGITS,
  MODAL_ID,
  WISH,
} from "./ids.js";
import { MAX_FRAGMENTS_PER_TICKET, MIN_FRAGMENTS_PER_TICKET } from "./store.js";
import type { GuildSettings } from "./types.js";

/** 소원권/조각 중 하나를 고르는 셀렉트 — 낭비와 수수에서 같은 모양으로 쓴다. */
function itemSelect(id: string, placeholder: string): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(placeholder)
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(ITEM_LABEL.ticket)
        .setValue(ITEM.ticket)
        .setEmoji("🎫"),
      new StringSelectMenuOptionBuilder()
        .setLabel(ITEM_LABEL.fragment)
        .setValue(ITEM.fragment)
        .setEmoji("🧩"),
    );
}

/** 낭비 — 고른 항목 1개가 사라진다. */
export function wasteModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(WISH, MODAL_ID.waste))
    .setTitle("낭비")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("낭비할 항목")
        .setDescription("고른 항목 1개가 사라집니다. 되돌릴 수 없습니다.")
        .setStringSelectMenuComponent(itemSelect(FIELD.wasteItem, "소원권 또는 소원권 조각")),
    );
}

/** 소원 빌기 — 내용과 첨부파일. */
export function useModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(WISH, MODAL_ID.use))
    .setTitle("소원 빌기")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("소원 내용")
        .setDescription("관리자에게 그대로 전달됩니다.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.wishContent)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("어떤 소원을 빌고 싶나요?")
            .setMinLength(2)
            .setMaxLength(1000)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("첨부파일")
        .setDescription("선택 · 최대 5개")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId(FIELD.wishFiles)
            .setMinValues(0)
            .setMaxValues(5)
            .setRequired(false),
        ),
    );
}

/** 수수 — 지급/회수 · 항목 · 대상 유저(여러 명) · 갯수. */
export function grantModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(WISH, MODAL_ID.grant))
    .setTitle("수수 — 지급과 회수")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("지급할까요, 회수할까요?")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(FIELD.grantDirection)
            .setPlaceholder("지급 또는 회수")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel("지급")
                .setValue(DIRECTION.give)
                .setDescription("대상에게 더해 줍니다")
                .setEmoji("📥"),
              new StringSelectMenuOptionBuilder()
                .setLabel("회수")
                .setValue(DIRECTION.take)
                .setDescription("대상에게서 거둬들입니다")
                .setEmoji("📤"),
            ),
        ),
      new LabelBuilder()
        .setLabel("대상 항목")
        .setStringSelectMenuComponent(itemSelect(FIELD.grantItem, "소원권 또는 소원권 조각")),
      new LabelBuilder()
        .setLabel("대상 유저")
        .setDescription("여러 명을 한 번에 고를 수 있습니다.")
        .setUserSelectMenuComponent(
          new UserSelectMenuBuilder()
            .setCustomId(FIELD.grantUsers)
            .setPlaceholder("유저를 고르세요")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(20),
        ),
      new LabelBuilder()
        .setLabel("갯수")
        .setDescription("1 이상의 정수")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.grantAmount)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("예: 3")
            .setValue("1")
            .setMaxLength(MAX_AMOUNT_DIGITS)
            .setRequired(true),
        ),
    );
}

/** 흡혈 — 한 유저에게서 빼앗아 다른 유저에게 옮긴다. */
export function bloodModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(WISH, MODAL_ID.blood))
    .setTitle("흡혈")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("대상 항목")
        .setStringSelectMenuComponent(itemSelect(FIELD.bloodItem, "소원권 또는 소원권 조각")),
      new LabelBuilder()
        .setLabel("흡혈될 유저")
        .setDescription("이 사람이 빼앗깁니다.")
        .setUserSelectMenuComponent(
          new UserSelectMenuBuilder()
            .setCustomId(FIELD.bloodFrom)
            .setPlaceholder("빼앗길 유저")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1),
        ),
      new LabelBuilder()
        .setLabel("흡혈할 유저")
        .setDescription("이 사람이 가져갑니다.")
        .setUserSelectMenuComponent(
          new UserSelectMenuBuilder()
            .setCustomId(FIELD.bloodTo)
            .setPlaceholder("가져갈 유저")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1),
        ),
      new LabelBuilder()
        .setLabel("흡혈할 갯수")
        .setDescription("1 이상의 정수")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.bloodAmount)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("예: 3")
            .setValue("1")
            .setMaxLength(MAX_AMOUNT_DIGITS)
            .setRequired(true),
        ),
    );
}

/**
 * 설정 — 소원 전달 채널과 제작 비용.
 *
 * 현재 값을 미리 채워 두고 채널은 선택 항목으로 둔다.
 * 그래야 제작 비용만 바꾸고 싶을 때 채널을 다시 고르지 않아도 된다.
 */
export function configModal(current: GuildSettings): ModalBuilder {
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(FIELD.configChannel)
    .setPlaceholder("채널을 하나 고르세요")
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setRequired(false)
    .setMinValues(0)
    .setMaxValues(1);

  if (current.wishChannelId !== null) channelSelect.setDefaultChannels(current.wishChannelId);

  return new ModalBuilder()
    .setCustomId(customId(WISH, MODAL_ID.config))
    .setTitle("소원권 설정")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("소원을 받을 채널")
        .setDescription("여기로 소원이 전달되고, 관리자가 수락/거절합니다. 비워 두면 그대로 둡니다.")
        .setChannelSelectMenuComponent(channelSelect),
      new LabelBuilder()
        .setLabel("소원권 1장을 만드는 데 필요한 조각 수")
        .setDescription(`${MIN_FRAGMENTS_PER_TICKET} 이상 ${MAX_FRAGMENTS_PER_TICKET} 이하의 정수`)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.fragmentsPerTicket)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("예: 5")
            .setValue(String(current.fragmentsPerTicket))
            .setMaxLength(3)
            .setRequired(true),
        ),
    );
}
