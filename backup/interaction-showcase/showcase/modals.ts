import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  CheckboxBuilder,
  CheckboxGroupBuilder,
  CheckboxGroupOptionBuilder,
  FileUploadBuilder,
  LabelBuilder,
  MentionableSelectMenuBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from "discord.js";

import { customId } from "../types.js";
import { DEMO, FIELD, MODAL, type ModalKind } from "./ids.js";

/**
 * 모달은 예전엔 텍스트 입력만 가능했지만, 지금은 셀렉트 메뉴 · 파일 업로드 ·
 * 체크박스 · 라디오 그룹까지 넣을 수 있다.
 *
 * 각 입력은 **LabelBuilder 로 감싸야** 한다 (예전 방식인 액션 로우 + TextInput.setLabel 은 deprecated).
 * 모달 하나에 들어가는 최상위 컴포넌트는 5개까지라서, 전부 보여주려고 3개로 나눴다.
 */
export function buildModal(kind: ModalKind): ModalBuilder {
  switch (kind) {
    case MODAL.text:
      return textModal();
    case MODAL.pickers:
      return pickerModal();
    case MODAL.checkbox:
      return checkboxModal();
  }
}

/**
 * 모달은 슬래시 커맨드나 버튼에 대한 **첫 응답**으로만 띄울 수 있다.
 * (한 번 reply/defer 한 뒤에는 못 띄운다) 그래서 버튼으로 여는 예시를 만든다.
 */
export function modalTriggerRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(DEMO, "openmodal", MODAL.text))
      .setLabel("모달 1 · 텍스트/선택")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(customId(DEMO, "openmodal", MODAL.pickers))
      .setLabel("모달 2 · 대상/파일")
      .setEmoji("📎")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(customId(DEMO, "openmodal", MODAL.checkbox))
      .setLabel("모달 3 · 체크박스")
      .setEmoji("☑️")
      .setStyle(ButtonStyle.Primary),
  );
}

/** 텍스트 입력 2종 + 문자열 선택 + 라디오 + 체크박스. */
function textModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(DEMO, "modal", MODAL.text))
    .setTitle("모달 1 · 텍스트와 선택")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("한 줄 입력")
        .setDescription("TextInputStyle.Short · 필수 · 2~50자")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.textShort)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("여기에 입력하세요")
            .setMinLength(2)
            .setMaxLength(50)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("여러 줄 입력")
        .setDescription("TextInputStyle.Paragraph · 선택 · 기본값이 채워져 있음")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.textParagraph)
            .setStyle(TextInputStyle.Paragraph)
            .setValue("미리 채워진 값입니다.\n줄바꿈도 됩니다.")
            .setMaxLength(500)
            .setRequired(false),
        ),
      new LabelBuilder()
        .setLabel("문자열 선택")
        .setDescription("모달 안에서도 셀렉트 메뉴를 쓸 수 있다 · 1~2개")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(FIELD.stringSelect)
            .setPlaceholder("골라 주세요")
            .setMinValues(1)
            .setMaxValues(2)
            .addOptions(
              new StringSelectMenuOptionBuilder().setLabel("사과").setValue("apple").setEmoji("🍎"),
              new StringSelectMenuOptionBuilder().setLabel("바나나").setValue("banana").setEmoji("🍌"),
              new StringSelectMenuOptionBuilder().setLabel("포도").setValue("grape").setEmoji("🍇"),
            ),
        ),
      new LabelBuilder()
        .setLabel("라디오 그룹")
        .setDescription("여러 개 중 하나만 고르는 입력")
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId(FIELD.radioGroup)
            .setRequired(true)
            .addOptions(
              new RadioGroupOptionBuilder()
                .setLabel("쉬움")
                .setValue("easy")
                .setDescription("옵션마다 설명도 붙는다")
                .setDefault(true),
              new RadioGroupOptionBuilder().setLabel("보통").setValue("normal"),
              new RadioGroupOptionBuilder().setLabel("어려움").setValue("hard"),
            ),
        ),
      new LabelBuilder()
        .setLabel("체크박스 하나")
        .setDescription("켜짐/꺼짐만 받는 단일 체크박스")
        .setCheckboxComponent(new CheckboxBuilder().setCustomId(FIELD.checkbox).setDefault(false)),
    );
}

/** 유저 · 역할 · 멘션 가능 · 채널 선택 + 파일 업로드. */
function pickerModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(DEMO, "modal", MODAL.pickers))
    .setTitle("모달 2 · 대상 선택과 파일")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("유저 선택")
        .setDescription("최대 3명")
        .setUserSelectMenuComponent(
          new UserSelectMenuBuilder()
            .setCustomId(FIELD.userSelect)
            .setPlaceholder("유저를 고르세요")
            .setMinValues(1)
            .setMaxValues(3),
        ),
      new LabelBuilder()
        .setLabel("역할 선택")
        .setRoleSelectMenuComponent(
          new RoleSelectMenuBuilder()
            .setCustomId(FIELD.roleSelect)
            .setPlaceholder("역할을 고르세요")
            .setMinValues(1)
            .setMaxValues(2),
        ),
      new LabelBuilder()
        .setLabel("유저 또는 역할 선택")
        .setMentionableSelectMenuComponent(
          new MentionableSelectMenuBuilder()
            .setCustomId(FIELD.mentionableSelect)
            .setPlaceholder("멘션 가능한 대상")
            .setMinValues(1)
            .setMaxValues(3),
        ),
      new LabelBuilder()
        .setLabel("채널 선택")
        .setDescription("텍스트 채널만 목록에 나온다")
        .setChannelSelectMenuComponent(
          new ChannelSelectMenuBuilder()
            .setCustomId(FIELD.channelSelect)
            .setPlaceholder("채널을 고르세요")
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(2),
        ),
      new LabelBuilder()
        .setLabel("파일 업로드")
        .setDescription("모달 안에서 파일을 첨부받는다 · 선택 · 최대 3개")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId(FIELD.fileUpload)
            .setMinValues(0)
            .setMaxValues(3)
            .setRequired(false),
        ),
    );
}

/** 안내 문구(TextDisplay) + 체크박스 그룹. */
function checkboxModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId(DEMO, "modal", MODAL.checkbox))
    .setTitle("모달 3 · 체크박스 그룹")
    .addTextDisplayComponents(
      // 모달에도 마크다운 안내문을 넣을 수 있다 (입력값이 아니라 표시 전용).
      new TextDisplayBuilder().setContent(
        "**TextDisplay** — 모달 안에 넣는 설명문입니다.\n입력 항목이 아니라 안내용이라 제출값에는 포함되지 않아요.",
      ),
    )
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("관심 있는 것을 모두 고르세요")
        .setDescription("체크박스 그룹 · 1~3개")
        .setCheckboxGroupComponent(
          new CheckboxGroupBuilder()
            .setCustomId(FIELD.checkboxGroup)
            .setMinValues(1)
            .setMaxValues(3)
            .setRequired(true)
            .addOptions(
              new CheckboxGroupOptionBuilder()
                .setLabel("버튼")
                .setValue("button")
                .setDescription("Primary · Secondary · Success · Danger · Link")
                .setDefault(true),
              new CheckboxGroupOptionBuilder().setLabel("셀렉트 메뉴").setValue("select"),
              new CheckboxGroupOptionBuilder().setLabel("모달").setValue("modal"),
              new CheckboxGroupOptionBuilder().setLabel("Components V2").setValue("layout"),
            ),
        ),
    );
}
