import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  FileBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";

import { customId } from "../types.js";
import { DEMO, sampleImage } from "./ids.js";

const ATTACHMENT_NAME = "components-v2.txt";
const ACCENT = 0x5865f2;

/**
 * Components V2 (레이아웃 컴포넌트).
 *
 * `MessageFlags.IsComponentsV2` 를 켜면 메시지 전체를 컴포넌트로 조립할 수 있다.
 * 대신 그 메시지에서는 **content 와 embeds 를 못 쓴다** — 모든 텍스트가 TextDisplay 로 들어간다.
 *
 * 종류: Container · Section(+Thumbnail/Button 액세서리) · TextDisplay ·
 *       Separator · MediaGallery · File · 그리고 기존 ActionRow.
 */
export function layoutComponents(): (ContainerBuilder | TextDisplayBuilder)[] {
  const intro = new TextDisplayBuilder().setContent(
    "### Components V2\n컨테이너 **바깥**에도 텍스트를 놓을 수 있습니다.",
  );

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT) // 임베드처럼 왼쪽에 색 띠가 생긴다
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "# Container\n마크다운이 그대로 먹습니다 — **굵게**, *기울임*, `코드`, ~~취소선~~, [링크](https://discord.js.org)",
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large),
    )
    .addSectionComponents(
      // Section = 텍스트 + 오른쪽 액세서리(썸네일 또는 버튼) 한 개
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "**Section + Thumbnail**\n오른쪽에 작은 이미지를 붙일 수 있어요.",
          ),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(sampleImage(0)).setDescription("썸네일 대체 텍스트"),
        ),
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "**Section + Button**\n액세서리로 버튼을 붙이면 오른쪽 끝에 붙습니다.",
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(customId(DEMO, "btn", "section"))
            .setLabel("눌러보기")
            .setStyle(ButtonStyle.Success),
        ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("**MediaGallery** — 이미지 묶음"))
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(sampleImage(1)).setDescription("첫 번째"),
        new MediaGalleryItemBuilder().setURL(sampleImage(2)).setDescription("두 번째"),
        new MediaGalleryItemBuilder().setURL(sampleImage(3)).setDescription("스포일러").setSpoiler(true),
      ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("**File** — 첨부파일 표시"))
    .addFileComponents(
      // 실제로 첨부한 파일을 attachment:// 로 참조한다 (layoutFiles 와 이름이 같아야 함)
      new FileBuilder().setURL(`attachment://${ATTACHMENT_NAME}`),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(customId(DEMO, "btn", "primary"))
          .setLabel("컨테이너 안의 버튼")
          .setStyle(ButtonStyle.Primary),
      ),
    );

  return [intro, container];
}

/** File 컴포넌트가 참조할 실제 첨부파일. */
export function layoutFiles(): AttachmentBuilder[] {
  const content = [
    "Components V2 예제 첨부파일",
    "",
    "File 컴포넌트는 메시지에 실제로 첨부된 파일을",
    "attachment://<파일명> 으로 참조해서 보여줍니다.",
  ].join("\n");

  return [new AttachmentBuilder(Buffer.from(content, "utf8"), { name: ATTACHMENT_NAME })];
}
