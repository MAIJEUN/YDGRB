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

import {
  MAX_DECIMALS,
  MIN_DECIMALS,
  amountHint,
  amountLength,
  amountPlaceholder,
} from "./amount.js";
import { reasonInput } from "../ui/reason.js";
import { customId } from "../types.js";
import {
  DIRECTION,
  FIELD,
  ITEM,
  ITEM_LABEL,
  MODAL_ID,
  WISH,
} from "./ids.js";
import { MAX_FRAGMENTS_PER_TICKET, MIN_FRAGMENTS_PER_TICKET } from "./store.js";
import type { GuildSettings } from "./types.js";
import { speak } from "../ui/tone.js";

/**
 * 소원권 변동의 사유 칸 설명.
 *
 * 감사 로그로는 안 간다 — 디스코드가 남기는 것은 서버 설정 변경이지 봇이 세는 수가 아니다.
 * 대신 [역사](store.ts)에 남아 날짜별로 다시 들춰 볼 수 있다. 「어디에 남는가」를 적어 주는
 * 이유는, 남는 줄 모르면 아무도 안 적기 때문이다.
 */
const REASON_NOTE = speak("선택 · 왜 주고받는지. 결과와 역사에 남습니다");

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
        .setDescription(speak("고른 항목 1개가 사라집니다. 되돌릴 수 없습니다."))
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
        .setDescription(speak("관리자에게 그대로 전달됩니다."))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.wishContent)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(speak("어떤 소원을 빌고 싶나요?"))
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
export function grantModal(decimals: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(WISH, MODAL_ID.grant))
    .setTitle("수수 — 지급과 회수")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(speak("지급할까요, 회수할까요?"))
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
                .setDescription(speak("대상에게 더해 줍니다"))
                .setEmoji("📥"),
              new StringSelectMenuOptionBuilder()
                .setLabel("회수")
                .setValue(DIRECTION.take)
                .setDescription(speak("대상에게서 거둬들입니다"))
                .setEmoji("📤"),
            ),
        ),
      new LabelBuilder()
        .setLabel("대상 항목")
        .setStringSelectMenuComponent(itemSelect(FIELD.grantItem, "소원권 또는 소원권 조각")),
      new LabelBuilder()
        .setLabel("대상 유저")
        .setDescription(speak("여러 명을 한 번에 고를 수 있습니다."))
        .setUserSelectMenuComponent(
          new UserSelectMenuBuilder()
            .setCustomId(FIELD.grantUsers)
            .setPlaceholder(speak("유저를 고르세요"))
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(20),
        ),
      new LabelBuilder()
        .setLabel("갯수")
        .setDescription(amountHint(decimals))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.grantAmount)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(amountPlaceholder(decimals))
            .setValue("1")
            .setMaxLength(amountLength(decimals))
            .setRequired(true),
        ),
      // 모달 칸은 다섯 개가 한계다. 지급/회수 · 항목 · 유저 · 갯수 · 사유로 딱 찬다.
      reasonInput(FIELD.grantReason, REASON_NOTE),
    );
}

/** 흡혈 — 한 유저에게서 빼앗아 다른 유저에게 옮긴다. */
export function bloodModal(decimals: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(WISH, MODAL_ID.blood))
    .setTitle("흡혈")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("대상 항목")
        .setStringSelectMenuComponent(itemSelect(FIELD.bloodItem, "소원권 또는 소원권 조각")),
      new LabelBuilder()
        .setLabel("흡혈될 유저")
        .setDescription(speak("이 사람이 빼앗깁니다."))
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
        .setDescription(speak("이 사람이 가져갑니다."))
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
        .setDescription(amountHint(decimals))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.bloodAmount)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(amountPlaceholder(decimals))
            .setValue("1")
            .setMaxLength(amountLength(decimals))
            .setRequired(true),
        ),
      // 여기도 다섯 칸이 꽉 찬다 — 항목 · 빼앗길 유저 · 가져갈 유저 · 갯수 · 사유.
      reasonInput(FIELD.bloodReason, REASON_NOTE),
    );
}

/**
 * 설정 — 소원 전달 채널 · 제작 비용 · 소수점 자릿수.
 *
 * 현재 값을 미리 채워 두고 채널은 선택 항목으로 둔다. 그래야 하나만 바꾸고 싶을 때
 * 나머지를 다시 고르거나 적지 않아도 된다.
 *
 * 자릿수를 바꾸면 **가지고 있던 수량도 새 눈금에 맞춰진다** ([store.ts](store.ts) 의
 * `setDecimals`). 그래서 칸 설명에 「늘리면 최대 수량이 내려간다」까지 적어 둔다 —
 * 눌러 보고 나서 알면 늦다.
 */
export function configModal(current: GuildSettings): ModalBuilder {
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(FIELD.configChannel)
    .setPlaceholder(speak("채널을 하나 고르세요"))
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
        .setDescription(speak("여기로 소원이 전달되고, 관리자가 수락/거절합니다. 비워 두면 그대로 둡니다."))
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
      new LabelBuilder()
        .setLabel("소수점 자릿수")
        .setDescription(
          speak(`${MIN_DECIMALS} ~ ${MAX_DECIMALS} · 0이면 정수만, 1이면 반 장까지. 늘리면 최대 수량이 내려갑니다`),
        )
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.decimals)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("예: 1")
            .setValue(String(current.decimals))
            .setMaxLength(2)
            .setRequired(true),
        ),
    );
}
