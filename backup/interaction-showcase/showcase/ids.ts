/**
 * 쇼케이스에서 쓰는 식별자 모음.
 *
 * customId 는 `demo:구분:인자` 형태다. 라우터가 첫 구간(`demo`)으로 핸들러를 찾고,
 * 핸들러는 두 번째 구간으로 어떤 컴포넌트인지 판단한다.
 * 디스코드 제한: customId 는 100자 이내.
 */
export const DEMO = "demo";

/** 모달 **안쪽** 필드의 id. 이건 라우팅에 쓰이지 않고 `interaction.fields` 로 읽을 때만 쓴다. */
export const FIELD = {
  textShort: "text_short",
  textParagraph: "text_paragraph",
  stringSelect: "string_select",
  radioGroup: "radio_group",
  checkbox: "checkbox",
  userSelect: "user_select",
  roleSelect: "role_select",
  mentionableSelect: "mentionable_select",
  channelSelect: "channel_select",
  fileUpload: "file_upload",
  checkboxGroup: "checkbox_group",
} as const;

/** 어떤 모달을 열지 구분하는 값. `demo:openmodal:<종류>` / `demo:modal:<종류>` */
export const MODAL = {
  text: "text",
  pickers: "pickers",
  checkbox: "checkbox",
} as const;

export type ModalKind = (typeof MODAL)[keyof typeof MODAL];

/** 아바타 CDN — 항상 접근 가능한 공개 이미지라 썸네일/갤러리 예제에 쓴다. */
export function sampleImage(index: number): string {
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
