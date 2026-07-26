import { AttachmentBuilder } from "discord.js";
import type { Attachment, Message, ReadonlyCollection, Snowflake } from "discord.js";


import type { WishAttachment } from "./types.js";

/**
 * 모달로 올라온 파일은 **임시 업로드**라서 그대로 두면 URL 이 만료된다.
 * 그래서 소원을 채널에 올릴 때 봇 메시지에 다시 첨부해 영구 파일로 만든다.
 *
 * 미리보기는 컨테이너 안의 이미지 묶음(MediaGallery)과 File 컴포넌트로 그린다.
 * Components V2 메시지에서는 컴포넌트가 가리킨 첨부만 그려지므로 두 벌로 보이지 않는다.
 *
 * 단, 메시지를 수정할 때는 남길 첨부를 id 로 명시해야 `attachment://` 참조가 풀리지 않는다
 * (`retained` 참고).
 */

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

/**
 * 메시지를 수정할 때 **그대로 남길** 첨부 목록.
 *
 * 수정 요청에 첨부를 아예 안 실으면 컨테이너의 `attachment://` 참조가 풀려 이미지가 사라진다.
 * 원래 붙어 있던 첨부를 id 그대로 다시 넘겨 주면 새로 올리지 않고 유지된다.
 */
export function retained(message: Message): Attachment[] {
  return Array.from(message.attachments.values());
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
 * 컨테이너 안 이미지 묶음(MediaGallery)이 가리킬 참조.
 *
 * CDN URL 대신 `attachment://` 를 쓴다. Components V2 메시지에서는 컴포넌트가 가리킨 첨부만
 * 그려지므로, 이렇게 하면 첨부로 한 번 · 묶음으로 한 번 두 벌로 보이는 일이 없다.
 */
export function galleryImages(files: readonly WishAttachment[]): string[] {
  return files.filter((file) => isImage(file)).map((file) => `attachment://${file.name}`);
}

/** 이미지가 아닌 첨부 — File 컴포넌트로 카드처럼 표시된다. */
export function galleryFiles(files: readonly WishAttachment[]): string[] {
  return files.filter((file) => !isImage(file)).map((file) => `attachment://${file.name}`);
}
