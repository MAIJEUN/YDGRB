import { setTimeout as sleep } from "node:timers/promises";

import { MessageFlags } from "discord.js";
import type { ModalSubmitInteraction, ReadonlyCollection, Snowflake } from "discord.js";

import { logger } from "../logger.js";
import { buttonRows } from "../showcase/buttons.js";
import { DEMO, FIELD, MODAL, type ModalKind } from "../showcase/ids.js";
import { buildModal } from "../showcase/modals.js";
import { defineComponentHandler, type ComponentInteraction } from "../types.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/**
 * `/interaction` 쇼케이스에서 나온 버튼 · 셀렉트 메뉴 · 모달을 모두 처리한다.
 * customId 는 `demo:<구분>:<값>` 형태이고, args 는 `["<구분>", "<값>"]` 로 들어온다.
 */
export default defineComponentHandler({
  namespace: DEMO,
  async execute(interaction, args) {
    const [kind, value] = args;

    switch (kind) {
      case "btn":
        await handleButton(interaction, value);
        return;
      case "counter":
        await handleCounter(interaction, value);
        return;
      case "sel":
        await handleSelect(interaction);
        return;
      case "openmodal":
        await handleOpenModal(interaction, value);
        return;
      case "modal":
        await handleModalSubmit(interaction, value);
        return;
      default:
        logger.warn(`쇼케이스에서 모르는 customId: ${interaction.customId}`);
        if (interaction.isRepliable()) {
          await interaction.reply({ content: "처리할 수 없는 컴포넌트입니다.", ...EPHEMERAL });
        }
    }
  },
});

// ─────────────────────────────────────────────────────────────
// 버튼
// ─────────────────────────────────────────────────────────────

async function handleButton(interaction: ComponentInteraction, value?: string): Promise<void> {
  if (!interaction.isButton()) return;

  switch (value) {
    // 3초 안에 끝나지 않는 작업: 먼저 defer 해서 시간을 벌고 나중에 editReply.
    case "defer": {
      await interaction.deferReply(EPHEMERAL);
      await sleep(3000);
      await interaction.editReply("⏳ `deferReply()` 로 시간을 번 뒤 `editReply()` 로 마무리했습니다.");
      return;
    }

    // 응답을 아예 보내지 않고 "로딩 표시만 끄는" 방식.
    case "section": {
      await interaction.deferUpdate();
      await interaction.followUp({
        content: "✅ `deferUpdate()` 는 원본 메시지를 그대로 두고 인터랙션만 종료합니다.",
        ...EPHEMERAL,
      });
      return;
    }

    case "ephemeral": {
      await interaction.reply({
        content: "👀 이 메시지는 누른 사람에게만 보입니다 (`MessageFlags.Ephemeral`).",
        ...EPHEMERAL,
      });
      return;
    }

    default: {
      await interaction.reply({
        content: `🔘 \`${interaction.customId}\` 버튼을 눌렀습니다.`,
        ...EPHEMERAL,
      });
    }
  }
}

/**
 * 버튼 상태를 customId 에 실어 두는 방식.
 * 저장소가 없어도 되고, 봇을 재시작해도 눌리던 버튼이 계속 동작한다.
 */
async function handleCounter(interaction: ComponentInteraction, value?: string): Promise<void> {
  if (!interaction.isButton()) return;

  const current = Number.parseInt(value ?? "0", 10);
  const next = Number.isNaN(current) ? 1 : current + 1;

  // update() 는 새 메시지를 보내지 않고 버튼이 달린 원본 메시지를 고친다.
  await interaction.update({
    content: interaction.message.content,
    components: buttonRows(next),
  });
}

// ─────────────────────────────────────────────────────────────
// 셀렉트 메뉴
// ─────────────────────────────────────────────────────────────

function mentions(ids: ReadonlyCollection<Snowflake, unknown>, prefix: string): string[] {
  return Array.from(ids.keys(), (id) => `<${prefix}${id}>`);
}

function list(items: readonly string[]): string {
  return items.length === 0 ? "_(없음)_" : items.join(", ");
}

async function handleSelect(interaction: ComponentInteraction): Promise<void> {
  if (!interaction.isAnySelectMenu()) return;

  const lines: string[] = [];

  if (interaction.isStringSelectMenu()) {
    lines.push("**StringSelect** — 직접 정의한 옵션", `고른 값: \`${interaction.values.join("`, `")}\``);
  } else if (interaction.isUserSelectMenu()) {
    lines.push("**UserSelect** — 유저 다중 선택", `고른 유저: ${list(mentions(interaction.users, "@"))}`);
  } else if (interaction.isRoleSelectMenu()) {
    lines.push("**RoleSelect** — 역할 선택", `고른 역할: ${list(mentions(interaction.roles, "@&"))}`);
  } else if (interaction.isMentionableSelectMenu()) {
    lines.push(
      "**MentionableSelect** — 유저와 역할을 한 메뉴에서",
      `유저: ${list(mentions(interaction.users, "@"))}`,
      `역할: ${list(mentions(interaction.roles, "@&"))}`,
    );
  } else if (interaction.isChannelSelectMenu()) {
    lines.push("**ChannelSelect** — 채널 선택", `고른 채널: ${list(mentions(interaction.channels, "#"))}`);
  }

  await interaction.reply({ content: lines.join("\n"), ...EPHEMERAL });
}

// ─────────────────────────────────────────────────────────────
// 모달
// ─────────────────────────────────────────────────────────────

function isModalKind(value: string | undefined): value is ModalKind {
  return value !== undefined && Object.values<string>(MODAL).includes(value);
}

async function handleOpenModal(interaction: ComponentInteraction, value?: string): Promise<void> {
  if (!interaction.isButton()) return;

  if (!isModalKind(value)) {
    await interaction.reply({ content: "알 수 없는 모달입니다.", ...EPHEMERAL });
    return;
  }

  // showModal 은 아직 응답하지 않은 인터랙션에서만 호출할 수 있다.
  await interaction.showModal(buildModal(value));
}

async function handleModalSubmit(interaction: ComponentInteraction, value?: string): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  if (!isModalKind(value)) {
    await interaction.reply({ content: "알 수 없는 모달입니다.", ...EPHEMERAL });
    return;
  }

  const lines =
    value === MODAL.text
      ? textModalSummary(interaction)
      : value === MODAL.pickers
        ? pickerModalSummary(interaction)
        : checkboxModalSummary(interaction);

  await interaction.reply({ content: ["### 제출된 값", ...lines].join("\n"), ...EPHEMERAL });
}

function textModalSummary(interaction: ModalSubmitInteraction): string[] {
  const { fields } = interaction;
  const paragraph = fields.getTextInputValue(FIELD.textParagraph);

  return [
    `**한 줄 입력**: \`${fields.getTextInputValue(FIELD.textShort)}\``,
    `**여러 줄 입력**: ${paragraph === "" ? "_(비어 있음)_" : `\`\`\`\n${paragraph}\n\`\`\``}`,
    `**문자열 선택**: \`${fields.getStringSelectValues(FIELD.stringSelect).join("`, `")}\``,
    `**라디오 그룹**: \`${fields.getRadioGroup(FIELD.radioGroup) ?? "없음"}\``,
    `**체크박스**: ${fields.getCheckbox(FIELD.checkbox) ? "☑️ 켜짐" : "⬜ 꺼짐"}`,
  ];
}

function pickerModalSummary(interaction: ModalSubmitInteraction): string[] {
  const { fields } = interaction;

  const users = fields.getSelectedUsers(FIELD.userSelect);
  const roles = fields.getSelectedRoles(FIELD.roleSelect);
  const mentionables = fields.getSelectedMentionables(FIELD.mentionableSelect);
  const channels = fields.getSelectedChannels(FIELD.channelSelect);
  const files = fields.getUploadedFiles(FIELD.fileUpload);

  return [
    `**유저 선택**: ${list(users === null ? [] : mentions(users, "@"))}`,
    `**역할 선택**: ${list(roles === null ? [] : mentions(roles, "@&"))}`,
    `**유저 또는 역할**: ${list(
      mentionables === null
        ? []
        : [...mentions(mentionables.users, "@"), ...mentions(mentionables.roles, "@&")],
    )}`,
    `**채널 선택**: ${list(channels === null ? [] : mentions(channels, "#"))}`,
    `**업로드한 파일**: ${list(
      files === null ? [] : Array.from(files.values(), (file) => `[${file.name}](${file.url})`),
    )}`,
  ];
}

function checkboxModalSummary(interaction: ModalSubmitInteraction): string[] {
  const checked = interaction.fields.getCheckboxGroup(FIELD.checkboxGroup);

  return [
    `**체크박스 그룹**: ${list(checked.map((item) => `\`${item}\``))}`,
    "_TextDisplay 는 표시 전용이라 제출값에 포함되지 않습니다._",
  ];
}
