import {
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";
import type { ButtonBuilder } from "discord.js";
import type {
  ActionRowBuilder,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  InteractionUpdateOptions,
  MessageActionRowComponentBuilder,
  MessageCreateOptions,
  User,
} from "discord.js";

/**
 * 봇의 모든 출력이 지나가는 단일 통로.
 *
 * 규칙 (여기서만 강제한다 — 호출부에서 색이나 footer 를 직접 만들지 말 것):
 *   - 색상은 성공(초록) · 실패(빨강) · 진행중(노랑) 세 가지뿐
 *   - footer 에는 명령어를 사용한 유저의 프로필 사진과 `@사용자명`
 *   - 소원권/조각에 변동이 있으면 그 문구를 본문에 반드시 붙인다
 *
 * 레이아웃이 둘인 이유: 디스코드는 한 메시지에 Embed 와 Container(Components V2)를
 * **같이 넣지 못한다.** 인터랙션을 컨테이너 안에 담아야 하는 패널은 "container",
 * 그 외 일반 출력은 "embed" 를 쓴다. 어느 쪽이든 위 규칙은 동일하게 적용된다.
 */

export type Status = "success" | "failure" | "progress";

const COLOR: Record<Status, number> = {
  success: 0x57f287, // 초록
  failure: 0xed4245, // 빨강
  progress: 0xfee75c, // 노랑
};

export interface ResponseField {
  readonly name: string;
  readonly value: string;
  readonly inline?: boolean;
}

export interface ResponseOptions {
  readonly status: Status;
  readonly title: string;
  readonly description?: string;
  readonly fields?: readonly ResponseField[];
  /** footer 에 표기할, 명령어를 사용한 유저. */
  readonly user: User;
  /** 소원권/조각 변동 문구 (`formatBalanceChange` 결과). 있으면 본문 끝에 붙는다. */
  readonly balance?: string;
  /**
   * 임베드 **안에** 표시할 이미지들. 여러 장이면 격자로 묶인다 (최대 4장).
   *
   * 메시지에 첨부한 파일이면 `attachment://<파일명>` 으로 주는 게 좋다.
   * CDN URL 을 그대로 주면 디스코드가 첨부파일을 임베드 **밖에도** 한 번 더 그려서 두 번 보인다.
   */
  readonly images?: readonly string[];
  /**
   * 이미지 2장 이상을 합칠 때 모든 임베드에 넣을 링크.
   * `images` 가 `attachment://` 라면 합치기용 링크를 따로 줘야 한다(제목이 이 링크가 된다).
   * 생략하면 첫 이미지 URL 을 쓴다.
   */
  readonly galleryKey?: string;
}

/**
 * 임베드 하나에는 이미지를 한 장만 넣을 수 있다.
 * 대신 **url 이 글자 하나까지 똑같은 임베드**를 여러 개 보내면 디스코드가 그것들을 하나로 합쳐서
 * 이미지를 격자로 보여 준다. 표시되는 건 4장까지고, 나머지는 첨부파일로 아래에 남는다.
 */
const MAX_GALLERY_IMAGES = 4;

export interface MessageOptions extends ResponseOptions {
  /** 기본값 "embed". 인터랙션을 컨테이너 안에 넣어야 하면 "container". */
  readonly layout?: "embed" | "container";
  readonly rows?: readonly ActionRowBuilder<MessageActionRowComponentBuilder>[];
  /**
   * 본문 **오른쪽 위**에 붙는 버튼 하나 (컨테이너 전용).
   *
   * 액션 로우는 항상 한 줄을 통째로 차지하지만, Section 의 액세서리로 넣으면
   * 제목과 같은 줄 오른쪽 끝에 붙는다. 임베드에는 이런 자리가 없어 무시된다.
   */
  readonly accessoryButton?: ButtonBuilder;
  /** 기본값 true. 채널에 공개로 남겨야 하는 메시지만 false. */
  readonly ephemeral?: boolean;
}

/**
 * footer 표기는 이름만. 프로필 사진은 넣지 않는다.
 *
 * 컨테이너(Components V2)에는 작은 아이콘 자리가 없어서 프로필 사진을 넣으면 본문만큼 커지는데,
 * 임베드와 컨테이너의 모양을 맞추기 위해 양쪽 다 이름만 쓴다.
 */
function footerText(user: User): string {
  return `@${user.username}`;
}

/** 본문(설명 + 변동 문구)을 하나로 합친다. */
function body(options: ResponseOptions): string {
  return [options.description, options.balance].filter((part) => part !== undefined && part !== "").join("\n\n");
}

// ─────────────────────────────────────────────────────────────
// Embed 레이아웃
// ─────────────────────────────────────────────────────────────

export function buildEmbed(options: ResponseOptions): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLOR[options.status])
    .setTitle(options.title)
    .setFooter({ text: footerText(options.user) })
    .setTimestamp();

  const content = body(options);
  if (content !== "") embed.setDescription(content);

  if (options.fields !== undefined && options.fields.length > 0) {
    embed.addFields(
      options.fields.map((field) => ({
        name: field.name,
        value: field.value,
        inline: field.inline ?? false,
      })),
    );
  }

  return embed;
}

/**
 * 본문 임베드 + 이미지 격자를 만들기 위한 병합용 임베드들.
 * 이미지가 한 장이면 그냥 임베드 하나에 이미지를 넣는다.
 */
export function buildEmbeds(options: ResponseOptions): EmbedBuilder[] {
  const main = buildEmbed(options);

  const [first, ...rest] = (options.images ?? []).slice(0, MAX_GALLERY_IMAGES);
  if (first === undefined) return [main];

  main.setImage(first);
  if (rest.length === 0) return [main];

  const key = options.galleryKey ?? (first.startsWith("http") ? first : undefined);
  if (key === undefined) return [main];

  // 여기서만 url 을 세팅한다 — 합치기 위한 것이라 한 장일 때는 제목이 링크가 되지 않게 둔다.
  main.setURL(key);

  return [main, ...rest.map((url) => new EmbedBuilder().setURL(key).setImage(url))];
}

// ─────────────────────────────────────────────────────────────
// Container 레이아웃 (Components V2)
// ─────────────────────────────────────────────────────────────

function divider(): SeparatorBuilder {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

export function buildContainer(options: MessageOptions): ContainerBuilder {
  const container = new ContainerBuilder()
    // 왼쪽 색 띠가 임베드와 같은 역할을 한다.
    .setAccentColor(COLOR[options.status]);

  const rows = options.rows ?? [];
  const header = [`### ${options.title}`];

  const content = body(options);
  if (content !== "") header.push(content);

  for (const field of options.fields ?? []) {
    header.push(`**${field.name}**\n${field.value}`);
  }

  const headerText = new TextDisplayBuilder().setContent(header.join("\n\n"));

  if (options.accessoryButton === undefined) {
    container.addTextDisplayComponents(headerText);
  } else {
    // Section 은 본문과 액세서리를 좌우로 나눈다 — 버튼이 제목 오른쪽 끝에 붙는다.
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(headerText)
        .setButtonAccessory(options.accessoryButton),
    );
  }

  // 컨테이너에는 임베드를 못 넣으므로 이미지 묶음은 MediaGallery 로 그린다.
  const images = options.images ?? [];
  if (images.length > 0) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        images.map((url) => new MediaGalleryItemBuilder().setURL(url)),
      ),
    );
  }

  if (rows.length > 0) {
    container.addSeparatorComponents(divider());
    container.addActionRowComponents(...rows);
  }

  // footer — 임베드와 같은 규칙으로 이름만 작은 글씨로.
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${footerText(options.user)}`),
  );

  return container;
}

// ─────────────────────────────────────────────────────────────
// 인터랙션에 넘길 페이로드
// ─────────────────────────────────────────────────────────────

interface Rendered {
  readonly embeds: EmbedBuilder[];
  readonly components: (ActionRowBuilder<MessageActionRowComponentBuilder> | ContainerBuilder)[];
  readonly isContainer: boolean;
}

function render(options: MessageOptions): Rendered {
  if (options.layout === "container") {
    return { embeds: [], components: [buildContainer(options)], isContainer: true };
  }

  return {
    embeds: buildEmbeds(options),
    components: [...(options.rows ?? [])],
    isContainer: false,
  };
}

/** `interaction.reply()` / `followUp()` / `channel.send()` 에 그대로 넘길 수 있는 페이로드. */
export function response(options: MessageOptions): InteractionReplyOptions {
  const { embeds, components, isContainer } = render(options);

  const flags: (MessageFlags.Ephemeral | MessageFlags.IsComponentsV2)[] = [];
  if (options.ephemeral !== false) flags.push(MessageFlags.Ephemeral);
  if (isContainer) flags.push(MessageFlags.IsComponentsV2);

  return { embeds, components, flags };
}

/**
 * `interaction.update()` 용. ephemeral 여부는 메시지를 만들 때 정해지므로 여기선 건드리지 않는다.
 *
 * 주의: 이미 만들어진 메시지의 Components V2 여부는 나중에 못 바꾼다.
 * 컨테이너로 띄운 패널은 갱신할 때도 반드시 `layout: "container"` 를 유지해야 한다.
 */
export function updateResponse(options: MessageOptions): InteractionUpdateOptions {
  const { embeds, components, isContainer } = render(options);

  // content 는 건드리지 않는다 — Components V2 메시지에는 content 를 실을 수 없다.
  return { embeds, components, flags: isContainer ? [MessageFlags.IsComponentsV2] : [] };
}

/**
 * `interaction.editReply()` 용 — 이미 defer/reply 한 응답을 갈아 끼울 때.
 *
 * ephemeral 여부는 처음 응답할 때 정해지므로 여기서 다루지 않는다.
 */
export function editResponse(options: MessageOptions): InteractionEditReplyOptions {
  const { embeds, components, isContainer } = render(options);

  return { embeds, components, flags: isContainer ? [MessageFlags.IsComponentsV2] : [] };
}

/** 인터랙션 응답이 아니라 채널에 직접 보낼 때 (소원 전달 메시지 등). */
export function channelMessage(options: MessageOptions): MessageCreateOptions {
  const { embeds, components, isContainer } = render(options);

  return { embeds, components, flags: isContainer ? [MessageFlags.IsComponentsV2] : [] };
}
