import { AttachmentBuilder } from "discord.js";
import type { Attachment, Message, ReadonlyCollection, Snowflake } from "discord.js";


import type { WishAttachment } from "./types.js";

/**
 * 모달로 올라온 파일은 **임시 업로드**라서 그대로 두면 URL 이 만료된다.
 * 그래서 소원을 채널에 올릴 때 봇 메시지에 다시 첨부해 영구 파일로 만든다.
 *
 * 미리보기는 임베드에 넣지 않고 **첨부파일 자체로** 보여 준다:
 *   - 이미지가 여러 장이면 디스코드가 알아서 격자로 묶어 준다
 *   - 임베드가 아니라 메시지에 속하므로, 수락/거절로 임베드를 고쳐도 그대로 남는다
 *   - `attachment://` 로 임베드 이미지를 지정하면 메시지를 수정할 때 참조가 풀려 사라진다
 *
 * 단, 메시지를 수정할 때 남길 첨부를 id 로 명시해야 한다 (`retainable` 참고).
 */

const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // Number() 로 감싸 "2.0KB" 같은 불필요한 소수점을 없앤다.
  return `${unit === 0 ? Math.round(value) : Number(value.toFixed(1))}${UNITS[unit]}`;
}

export function isImage(file: Pick<WishAttachment, "contentType">): boolean {
  return file.contentType?.startsWith("image/") === true;
}

/** `attachment://` 로 참조하려면 이름이 안전하고 서로 겹치지 않아야 한다. */
function sanitize(name: string): string {
  const cleaned = name.replace(/\s+/gu, "_").replace(/[^\w.\-가-힣]/gu, "");
  return cleaned === "" ? "file" : cleaned.slice(-80);
}

function withSuffix(name: string, index: number): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? `${name}_${index}` : `${name.slice(0, dot)}_${index}${name.slice(dot)}`;
}

/** 모달 제출로 받은 파일 목록을 겹치지 않는 이름으로 정리한다. */
export function prepareUploads(
  uploaded: ReadonlyCollection<Snowflake, Attachment> | null,
): WishAttachment[] {
  if (uploaded === null) return [];

  const used = new Set<string>();

  return Array.from(uploaded.values(), (file) => {
    const base = sanitize(file.name);

    let name = base;
    let counter = 2;
    while (used.has(name.toLowerCase())) {
      name = withSuffix(base, counter);
      counter += 1;
    }
    used.add(name.toLowerCase());

    return { name, url: file.url, size: file.size, contentType: file.contentType };
  });
}

/** 채널에 보낼 때 함께 올릴 파일. URL 을 주면 discord.js 가 받아서 다시 올려 준다. */
export function toUploadFiles(files: readonly WishAttachment[]): AttachmentBuilder[] {
  return files.map((file) => new AttachmentBuilder(file.url, { name: file.name }));
}

/** 전송된 메시지에서 **영구** 첨부 정보를 읽어 온다 (URL 이 임시 업로드가 아닌 것으로 바뀐다). */
export function fromMessage(message: Message): WishAttachment[] {
  return Array.from(message.attachments.values(), (file) => ({
    name: file.name,
    url: file.url,
    size: file.size,
    contentType: file.contentType,
  }));
}

/**
 * 임베드 안에 넣을 이미지 참조.
 *
 * CDN URL 대신 `attachment://` 를 쓰는 이유: 디스코드는 임베드가 참조한 첨부를 "임베드가 쓴 것"으로
 * 보고 임베드 **밖에** 따로 그리지 않는다. URL 로 주면 첨부로 한 번, 임베드로 한 번 두 번 나온다.
 */
export function embedImages(files: readonly WishAttachment[]): string[] {
  return files.filter((file) => isImage(file)).map((file) => `attachment://${file.name}`);
}

/** 임베드 안에 넣을 첨부파일 목록. 파일 자체는 임베드 아래에 이미지/카드로 표시된다. */
export function attachmentField(files: readonly WishAttachment[]): string {
  return files
    .map((file) => `${isImage(file) ? "🖼️" : "📄"} [${file.name}](${file.url}) · ${formatBytes(file.size)}`)
    .join("\n");
}

/** "이미지 2장 · 파일 1개" 처럼 요약한 이름 — 필드 제목에 쓴다. */
export function attachmentSummary(files: readonly WishAttachment[]): string {
  const images = files.filter((file) => isImage(file)).length;
  const others = files.length - images;

  return [images > 0 ? `이미지 ${images}장` : "", others > 0 ? `파일 ${others}개` : ""]
    .filter((part) => part !== "")
    .join(" · ");
}
