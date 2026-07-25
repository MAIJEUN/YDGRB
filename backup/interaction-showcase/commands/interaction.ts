import { InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { InteractionReplyOptions } from "discord.js";

import { buttonRows } from "../showcase/buttons.js";
import { layoutComponents, layoutFiles } from "../showcase/layout.js";
import { modalTriggerRow } from "../showcase/modals.js";
import { selectRows } from "../showcase/selects.js";
import { defineCommand } from "../types.js";

const AUTOCOMPLETE_CHOICES = [
  "Button",
  "StringSelect",
  "UserSelect",
  "RoleSelect",
  "MentionableSelect",
  "ChannelSelect",
  "TextInput (Short)",
  "TextInput (Paragraph)",
  "Checkbox",
  "CheckboxGroup",
  "RadioGroup",
  "FileUpload",
  "Label",
  "TextDisplay",
  "Section",
  "Thumbnail",
  "MediaGallery",
  "File",
  "Separator",
  "Container",
] as const;

function buttonsMessage(): InteractionReplyOptions {
  return {
    content: [
      "## 🔘 버튼 (Button)",
      "`ButtonStyle` 5종 + 동작 예시입니다. Link 버튼만 인터랙션이 발생하지 않아요.",
      "-# Premium(SKU) 버튼은 스토어 상품이 있어야 해서 제외했습니다.",
    ].join("\n"),
    components: buttonRows(0),
  };
}

function selectsMessage(): InteractionReplyOptions {
  return {
    content: [
      "## 📋 셀렉트 메뉴 (Select Menu)",
      "셀렉트 메뉴는 한 줄을 통째로 차지해서 메시지당 5개가 최대입니다.",
    ].join("\n"),
    components: selectRows(),
  };
}

function modalMessage(): InteractionReplyOptions {
  return {
    content: [
      "## 🪟 모달 (Modal)",
      "모달은 **버튼이나 커맨드의 첫 응답**으로만 띄울 수 있습니다.",
      "요즘 모달에는 텍스트 입력뿐 아니라 셀렉트 메뉴 · 파일 업로드 · 체크박스 · 라디오 그룹도 들어갑니다.",
    ].join("\n"),
    components: [modalTriggerRow()],
  };
}

function layoutMessage(): InteractionReplyOptions {
  return {
    // Components V2 를 켜면 content 와 embeds 를 쓸 수 없다 — 텍스트도 전부 컴포넌트로 넣는다.
    flags: MessageFlags.IsComponentsV2,
    components: layoutComponents(),
    files: layoutFiles(),
  };
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("interaction")
    .setNameLocalizations({ ko: "인터렉션" })
    .setDescription("디스코드의 모든 인터랙션 컴포넌트를 테스트합니다.")
    // 역할·채널 셀렉트 메뉴가 서버에서만 동작하므로 서버 전용으로 둔다.
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName("all")
        .setNameLocalizations({ ko: "전체" })
        .setDescription("아래 쇼케이스를 전부 한 번에 띄웁니다."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("buttons")
        .setNameLocalizations({ ko: "버튼" })
        .setDescription("버튼 스타일과 동작(update · defer · ephemeral)을 보여줍니다."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("selects")
        .setNameLocalizations({ ko: "선택메뉴" })
        .setDescription("문자열 · 유저 · 역할 · 멘션 · 채널 셀렉트 메뉴 5종."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("modal")
        .setNameLocalizations({ ko: "모달" })
        .setDescription("모달에 들어갈 수 있는 모든 입력 컴포넌트."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("layout")
        .setNameLocalizations({ ko: "레이아웃" })
        .setDescription("Components V2 — Container · Section · MediaGallery 등."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("autocomplete")
        .setNameLocalizations({ ko: "자동완성" })
        .setDescription("입력할 때마다 후보를 채워 주는 자동완성 옵션.")
        .addStringOption((option) =>
          option
            .setName("component")
            .setNameLocalizations({ ko: "컴포넌트" })
            .setDescription("컴포넌트 이름을 입력해 보세요")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    ),

  async execute(interaction) {
    switch (interaction.options.getSubcommand()) {
      case "buttons":
        await interaction.reply(buttonsMessage());
        return;

      case "selects":
        await interaction.reply(selectsMessage());
        return;

      case "modal":
        await interaction.reply(modalMessage());
        return;

      case "layout":
        await interaction.reply(layoutMessage());
        return;

      case "autocomplete": {
        const picked = interaction.options.getString("component", true);
        await interaction.reply({
          content: `⌨️ 자동완성으로 \`${picked}\` 를 골랐습니다.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case "all": {
        // 첫 응답은 reply, 그 뒤로는 followUp 으로 이어 붙인다.
        await interaction.reply(buttonsMessage());
        await interaction.followUp(selectsMessage());
        await interaction.followUp(modalMessage());
        await interaction.followUp(layoutMessage());
        return;
      }

      default:
        await interaction.reply({
          content: "알 수 없는 하위 명령입니다.",
          flags: MessageFlags.Ephemeral,
        });
    }
  },

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();

    const matched = AUTOCOMPLETE_CHOICES.filter((choice) =>
      choice.toLowerCase().includes(typed),
    ).slice(0, 25); // 자동완성 후보는 최대 25개

    await interaction.respond(matched.map((choice) => ({ name: choice, value: choice })));
  },
});
