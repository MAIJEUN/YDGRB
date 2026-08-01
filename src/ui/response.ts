import {
  ContainerBuilder,
  FileBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";
import type { ButtonBuilder } from "discord.js";
import type {
  ActionRowBuilder,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  InteractionUpdateOptions,
  MessageActionRowComponentBuilder,
  MessageCreateOptions,
  MessageEditOptions,
  MessageMentionOptions,
  User,
} from "discord.js";

import { describeError } from "../errors.js";

/**
 * 봇의 모든 출력이 지나가는 단일 통로.
 *
 * 규칙 (여기서만 강제한다 — 호출부에서 색이나 순서를 직접 만들지 말 것):
 *
 *   1. 모든 응답은 Components V2 로 그린다. 임베드는 쓰지 않는다.
 *   2. 모든 요소는 Container 하나 안에 들어간다.
 *   3. 색은 네 가지뿐 — 초록(완료) · 노랑(끝나지 않음) · 빨강(실패) · 파랑(정보/알림)
 *      노랑은 **아직 도는 중**이거나 **온전히 끝나지 못한** 것에 쓴다 —
 *      진행 중 · 중간에 취소됨 · 일부만 실패. 전부 실패면 빨강이다.
 *   4. 순서:
 *
 *        제목 (명령어 이름)          ← 고정
 *        내용   — 오류가 있으면 `코드` 형식으로 최대 3줄
 *        변동 (권한, 소원권 갯수 …)
 *        ── 가로줄 (이미지가 있을 때만)
 *        이미지 묶음 / 첨부파일       ← 권장
 *        ── 가로줄 (인터랙션이 있을 때만)
 *        인터랙션                    ← 권장
 *        ── 가로줄
 *        footer (@유저)             ← 고정
 *
 *      **이미지와 인터랙션의 자리는 권장일 뿐이다.** 그 명령·시스템에 더 어울리는 배치가
 *      있으면 마음대로 놓아도 된다 — `order` 로 둘의 순서를 바꾸거나,
 *      `thumbnail`·`accessoryButton` 으로 본문 옆에 붙일 수 있다.
 *      고정인 것은 **제목·내용·변동이 맨 위, footer 가 가로줄 아래 맨 끝**이라는 것뿐이다.
 *
 *   5. 유저와 역할을 가리킬 때는 항상 멘션을 쓴다. 이름을 글자로 적지 않는다.
 *      footer 만 예외 — 규칙이 `@유저` 텍스트다.
 *      멘션 알림은 `NO_PINGS` 로 막는다 — 표시는 되고 알림만 안 간다.
 *
 *   6. 시각과 남은 시간은 반드시 디스코드 타임스탬프 마크다운으로 낸다.
 *      [time.ts](../time.ts) 의 `at()` · `countdown()` · `atWithCountdown()` 만 쓴다.
 *      날짜를 글자로 적으면 보는 사람의 시간대가 반영되지 않고, 남은 시간도 멈춰 버린다.
 *
 *      **날짜가 바뀌지 않으면 남은 시간만 적는다** — 「한 시간 후」.
 *      오늘 안에 끝나는 일에까지 날짜를 붙이면 한 줄이 화면을 가로지르는데, 정작 알고
 *      싶은 것은 얼마나 남았나 하나다. `atWithCountdown()` 이 알아서 가른다.
 *
 *   7. **끝났다는 알림은 그 일을 시작한 메시지에 답장으로 단다.**
 *      나중에 저절로 풀리는 효과(뚜따이 기간, 타임아웃 …)도, 게임 결과도 마찬가지다.
 *      다는 자리는 [end-notice.ts](end-notice.ts) 의 `announceAt` 한곳에서 정한다.
 *
 *      이런 알림은 **아무도 요청하지 않은 순간**에 나가므로 색은 **파랑**이다.
 *      초록은 요청한 일이 끝났을 때의 색이라, 게임 결과나 효과 만료에는 쓰지 않는다.
 *
 *   8. **결과만 적는다.** 명령이 무엇을 하는지, 앞으로 무슨 일이 일어날지 설명하지 않는다.
 *      다른 칸이 이미 말한 것을 다시 적지도 않는다 (환불 금액은 변동 문구가 말한다).
 *      실패한 이유는 그 자체가 결과이므로 적는다.
 *
 *   9. **내용에 이미 나온 대상을 변동 칸에 또 적지 않는다.**
 *      「<@마이즌> 님을 타임아웃했습니다」 밑에 「대상: <@마이즌>」 을 두지 않는다.
 *      내용이 대상을 말하지 않을 때만(실패 이유 등) 칸으로 둔다.
 */

export type Status = "success" | "failure" | "progress" | "info";

/** 디스코드 공식 팔레트. 다른 색은 쓰지 않는다. */
const COLOR: Record<Status, number> = {
  success: 0x57f287, // 초록 — 모든 작업 완료
  progress: 0xfee75c, // 노랑 — 아직 도는 중이거나 온전히 끝나지 못함 (취소 · 일부 실패)
  failure: 0xed4245, // 빨강 — 작업 실패
  info: 0x5865f2, // 파랑 — 정보 또는 알림성 응답
};

export interface ResponseField {
  readonly name: string;
  readonly value: string;
  /** 컨테이너에는 좌우 배치가 없다. 호출부 호환을 위해 받기만 하고 무시한다. */
  readonly inline?: boolean;
}

export interface MessageOptions {
  readonly status: Status;
  /** 제목 — 명령어 이름을 그대로 쓴다. */
  readonly title: string;
  /** 내용. */
  readonly description?: string;
  /**
   * 오류. 내용 바로 아래에 `코드` 형식으로 최대 3줄 붙는다.
   *
   * 원본 오류를 그대로 넘긴다 — 문구를 다듬는 건 [describeError](../errors.ts) 의 일이다.
   * 스택 트레이스와 요청 URL(인터랙션 토큰이 섞여 있다)은 여기로 새 나가지 않는다.
   */
  readonly error?: unknown;
  /** 변동 — 권한, 보유 수량처럼 이번 동작으로 바뀐 것. */
  readonly fields?: readonly ResponseField[];
  /** 변동 중 소원권/조각 문구 (`formatBalanceChange` 결과). 변동 맨 끝에 붙는다. */
  readonly balance?: string;
  /** footer 에 표기할, 명령어를 사용한 유저. */
  readonly user: User;
  /**
   * 이미지 묶음. 메시지에 첨부한 파일이면 `attachment://<파일명>` 으로 준다.
   *
   * Components V2 메시지에서는 컴포넌트가 가리키지 않은 첨부는 그려지지 않는다.
   * 그래서 임베드 때처럼 이미지가 두 번 보이는 일이 없다.
   */
  readonly images?: readonly string[];
  /** 이미지가 아닌 첨부파일. `attachment://<파일명>` 만 받는다. */
  readonly files?: readonly string[];
  readonly rows?: readonly ActionRowBuilder<MessageActionRowComponentBuilder>[];
  /**
   * 제목 **오른쪽 끝**에 붙는 버튼 하나.
   *
   * 액션 로우는 항상 한 줄을 통째로 차지한다. Section 의 액세서리로 넣어야 제목과 같은 줄에 붙는다.
   */
  readonly accessoryButton?: ButtonBuilder;
  /**
   * 본문 **오른쪽**에 붙는 작은 이미지.
   *
   * 이미지를 가로줄 아래에 크게 두는 대신 쓴다 — 정보를 늘어놓는 카드(서버 정보·프로필)는
   * 아이콘·아바타가 본문 옆에 붙어야 카드처럼 읽힌다.
   *
   * 액세서리 자리는 하나뿐이라 `accessoryButton` 과 같이 쓸 수 없다. 버튼이 있으면 버튼이 이긴다.
   */
  readonly thumbnail?: string;
  /**
   * 이미지와 인터랙션을 놓는 순서. 기본은 이미지가 먼저다.
   *
   * 그 명령에 더 어울리는 배치가 있으면 뒤집어도 된다 — 예를 들어 버튼을 먼저 보여 주고
   * 그림을 아래에 깔고 싶으면 `["rows", "images"]`.
   * 적지 않은 것은 뒤에 기본 순서대로 붙으므로 하나만 적어도 된다.
   */
  readonly order?: readonly ("images" | "rows")[];
  /** 기본값 true. 채널에 공개로 남겨야 하는 메시지만 false. */
  readonly ephemeral?: boolean;
}

/** MediaGallery 한 개에 들어갈 수 있는 최대 항목 수. */
const MAX_GALLERY_ITEMS = 10;

/** 권장 순서 — 이미지 다음 인터랙션. `order` 로 바꿀 수 있다. */
const BLOCK_ORDER = ["images", "rows"] as const;

/**
 * footer 표기는 이름만. 프로필 사진은 넣지 않는다.
 *
 * 컨테이너에는 작은 아이콘 자리가 없어서 프로필 사진을 넣으면 본문만큼 커진다.
 */
function footerText(user: User): string {
  return `@${user.username}`;
}

function divider(): SeparatorBuilder {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

/**
 * 제목 · 내용 · 변동을 텍스트 한 덩어리로 합친다.
 *
 * 세 구역을 각각 TextDisplay 로 나누면 줄간격이 벌어져 가로줄 없이도 칸이 나뉘어 보인다.
 * 가로줄로만 구역을 나눈다는 규칙을 지키려고 하나로 합친다.
 */
/**
 * 오류를 `코드` 형식 최대 3줄로.
 *
 * 코드블록(```) 대신 줄마다 인라인 코드를 쓴다 — 컨테이너에서 코드블록은 위아래 여백이 크고
 * 한 줄짜리 오류에도 큰 덩어리가 생긴다.
 */
function errorLines(error: unknown): string {
  return describeError(error)
    .split("\n")
    .map((line) => `\`${line}\``)
    .join("\n");
}

function headerContent(options: MessageOptions): string {
  const parts = [`### ${options.title}`];

  if (options.description !== undefined && options.description !== "") {
    parts.push(options.description);
  }

  if (options.error !== undefined) {
    parts.push(errorLines(options.error));
  }

  for (const field of options.fields ?? []) {
    parts.push(`**${field.name}**\n${field.value}`);
  }

  if (options.balance !== undefined && options.balance !== "") {
    parts.push(options.balance);
  }

  return parts.join("\n\n");
}

export function buildContainer(options: MessageOptions): ContainerBuilder {
  // 왼쪽 색 띠가 상태를 나타낸다.
  const container = new ContainerBuilder().setAccentColor(COLOR[options.status]);

  const header = new TextDisplayBuilder().setContent(headerContent(options));

  // 액세서리 자리는 하나뿐이다 — 버튼이 있으면 버튼, 없고 썸네일이 있으면 썸네일.
  if (options.accessoryButton !== undefined) {
    container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(header).setButtonAccessory(options.accessoryButton),
    );
  } else if (options.thumbnail !== undefined) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(header)
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(options.thumbnail)),
    );
  } else {
    container.addTextDisplayComponents(header);
  }

  const images = (options.images ?? []).slice(0, MAX_GALLERY_ITEMS);
  const files = options.files ?? [];
  const rows = options.rows ?? [];

  const block = {
    images: () => {
      if (images.length === 0 && files.length === 0) return;

      container.addSeparatorComponents(divider());

      if (images.length > 0) {
        container.addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            images.map((url) => new MediaGalleryItemBuilder().setURL(url)),
          ),
        );
      }

      for (const url of files) container.addFileComponents(new FileBuilder().setURL(url));
    },

    rows: () => {
      if (rows.length === 0) return;

      container.addSeparatorComponents(divider());
      container.addActionRowComponents(...rows);
    },
  };

  // 적지 않은 것은 뒤에 기본 순서대로 붙는다 — 하나만 적어도 나머지가 사라지지 않게.
  for (const name of [...new Set([...(options.order ?? []), ...BLOCK_ORDER])]) block[name]();

  container.addSeparatorComponents(divider());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${footerText(options.user)}`),
  );

  return container;
}

// ─────────────────────────────────────────────────────────────
// 페이로드
//
// Components V2 메시지에는 content 도 embeds 도 실을 수 없다.
// 그래서 어느 함수든 components · flags · allowedMentions 만 돌려준다.
// ─────────────────────────────────────────────────────────────

/**
 * 멘션은 **보이기만** 하고 알림은 보내지 않는다.
 *
 * 규칙상 유저와 역할을 가리킬 때는 항상 멘션을 쓴다. 그런데 알림까지 나가면
 * 랭킹 한 번에 열 명이 울리고, `@everyone` 을 적는 순간 서버 전체에 알림이 간다.
 * `allowed_mentions` 를 비우면 표시는 그대로(파란 칩)이고 알림만 빠진다.
 *
 * `repliedUser` 도 꺼야 한다 — 답장은 기본값이 **알림 보냄**이라, 종료 알림처럼
 * 답장으로 다는 메시지가 원본 작성자를 계속 울린다.
 */
const NO_PINGS: MessageMentionOptions = { parse: [], repliedUser: false };

/** `interaction.reply()` / `followUp()` 에 그대로 넘길 수 있는 페이로드. */
export function response(options: MessageOptions): InteractionReplyOptions {
  const flags: (MessageFlags.Ephemeral | MessageFlags.IsComponentsV2)[] = [MessageFlags.IsComponentsV2];
  if (options.ephemeral !== false) flags.push(MessageFlags.Ephemeral);

  return { components: [buildContainer(options)], flags, allowedMentions: NO_PINGS };
}

/** `interaction.update()` 용. ephemeral 여부는 메시지를 만들 때 정해지므로 건드리지 않는다. */
export function updateResponse(options: MessageOptions): InteractionUpdateOptions {
  return {
    components: [buildContainer(options)],
    flags: [MessageFlags.IsComponentsV2],
    allowedMentions: NO_PINGS,
  };
}

/** `interaction.editReply()` 용 — 이미 defer/reply 한 응답을 갈아 끼울 때. */
export function editResponse(options: MessageOptions): InteractionEditReplyOptions {
  return {
    components: [buildContainer(options)],
    flags: [MessageFlags.IsComponentsV2],
    allowedMentions: NO_PINGS,
  };
}

/**
 * 채널에 이미 보낸 메시지를 갈아 끼울 때.
 *
 * 인터랙션 응답이 아니다 — 게임 모집 패널처럼 봇이 **스스로** 고치는 메시지에 쓴다.
 */
export function messageEdit(options: MessageOptions): MessageEditOptions {
  return {
    components: [buildContainer(options)],
    flags: [MessageFlags.IsComponentsV2],
    allowedMentions: NO_PINGS,
  };
}

/** 인터랙션 응답이 아니라 채널이나 DM 으로 직접 보낼 때. */
export function channelMessage(options: MessageOptions): MessageCreateOptions {
  return {
    components: [buildContainer(options)],
    flags: [MessageFlags.IsComponentsV2],
    allowedMentions: NO_PINGS,
  };
}
