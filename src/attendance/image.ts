import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

import { logger } from "../logger.js";

/**
 * 출헉 글자를 이미지로 그린다.
 *
 * **복사·붙여넣기를 막는 것이 목적**이다. 글자를 그대로 메시지에 적으면 드래그해서
 * 그대로 붙여 넣으면 그만이라 받아쓰기가 되지 않는다.
 *
 * 그래서 배경에 잡선을 깔고 글자를 조금씩 기울여 놓는다 —
 * 사람은 읽을 수 있고, 화면에서 긁어 갈 수는 없다.
 */

const FONT_SIZE = 56;
const PADDING = 32;
const HEIGHT = FONT_SIZE + PADDING * 2;

/** 글자 하나를 최대 이만큼 기울인다 (라디안). 너무 크면 읽기 어려워진다. */
const MAX_TILT = 0.12;
/** 글자 하나를 위아래로 최대 이만큼 흔든다 (픽셀). */
const MAX_SHIFT = 5;

/** 배경에 까는 잡선 수. */
const NOISE_LINES = 14;

const BACKGROUND = "#2b2d31"; // 디스코드 어두운 배경과 비슷하게
const NOISE = "#4a4d55";
const TEXT = "#f2f3f5";

/**
 * 한글이 나오는 폰트를 고른다.
 *
 * 리눅스 서버에는 한글 폰트가 아예 없을 수 있다. 그때는 네모(두부)로 그려지므로
 * 시작할 때 한 번 확인해서 로그로 알려 준다 — 조용히 깨진 이미지를 내보내지 않도록.
 */
function pickFontFamily(): string {
  const families = GlobalFonts.families.map((entry) => entry.family);

  const korean = ["Malgun Gothic", "Noto Sans KR", "NanumGothic", "Gulim", "Dotum", "AppleGothic"];
  const found = korean.find((name) => families.includes(name));

  if (found === undefined) {
    logger.warn(
      "출헉: 한글 폰트를 찾지 못했습니다. 한글이 네모로 보일 수 있습니다 " +
        "(리눅스라면 fonts-noto-cjk 를 설치하세요).",
    );
  }

  return found ?? "sans-serif";
}

/** 폰트 목록을 매번 훑을 이유가 없다. 처음 한 번만 고른다. */
let fontFamily: string | undefined;

function font(): string {
  fontFamily ??= pickFontFamily();
  return `${FONT_SIZE}px "${fontFamily}"`;
}

/** -1 ~ 1 사이의 무작위 값. */
function jitter(): number {
  return Math.random() * 2 - 1;
}

/** 출헉 글자를 PNG 로. 디스코드에 그대로 첨부할 수 있다. */
export function renderText(text: string): Buffer {
  // 글자 폭을 재려면 캔버스가 하나 필요하다. 크기는 곧 다시 정한다.
  const measure = createCanvas(1, 1).getContext("2d");
  measure.font = font();

  const width = Math.ceil(measure.measureText(text).width) + PADDING * 2;

  const canvas = createCanvas(Math.max(width, 160), HEIGHT);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 잡선 — 글자 뒤에 깔아 자동 인식을 어렵게 한다.
  ctx.strokeStyle = NOISE;
  ctx.lineWidth = 1;
  for (let index = 0; index < NOISE_LINES; index += 1) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * canvas.width, Math.random() * canvas.height);
    ctx.lineTo(Math.random() * canvas.width, Math.random() * canvas.height);
    ctx.stroke();
  }

  ctx.font = font();
  ctx.fillStyle = TEXT;
  ctx.textBaseline = "middle";

  // 글자를 하나씩, 조금씩 기울이고 흔들어 그린다.
  let cursor = PADDING;
  for (const character of text) {
    const advance = measure.measureText(character).width;

    ctx.save();
    ctx.translate(cursor + advance / 2, HEIGHT / 2 + jitter() * MAX_SHIFT);
    ctx.rotate(jitter() * MAX_TILT);
    ctx.fillText(character, -advance / 2, 0);
    ctx.restore();

    cursor += advance;
  }

  return canvas.toBuffer("image/png");
}
