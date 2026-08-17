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

/**
 * 글자에서 뽑은 씨앗으로 도는 난수 (mulberry32).
 *
 * `Math.random` 이 아닌 이유는 **같은 글자가 늘 같은 그림이 되어야** 하기 때문이다.
 * [명단](views.ts)이 늘 때마다 이 그림을 다시 올리는데, 그때마다 잡선과 기울기가 달라지면
 * 받아쓰는 사람 눈앞에서 그림이 계속 흔들린다.
 *
 * 예측 가능해도 상관없는 자리다 — 막으려는 것은 **복사·붙여넣기**지 사람의 추측이 아니고,
 * 씨앗이 곧 정답이라 미리 알아낼 것도 없다.
 */
function seededRandom(text: string): () => number {
  // FNV-1a 로 글자를 32비트 씨앗 하나로 접는다.
  let state = 0x811c9dc5;
  for (const character of text) {
    state = Math.imul(state ^ (character.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 출헉 글자를 PNG 로. 디스코드에 그대로 첨부할 수 있다.
 *
 * **같은 글자를 넣으면 늘 같은 바이트가 나온다.** 명단이 늘 때마다 다시 올려도 화면은
 * 그대로여야 한다.
 */
export function renderText(text: string): Buffer {
  const random = seededRandom(text);

  /** -1 ~ 1 사이의 값. 같은 글자면 늘 같은 차례로 나온다. */
  const jitter = (): number => random() * 2 - 1;

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
    ctx.moveTo(random() * canvas.width, random() * canvas.height);
    ctx.lineTo(random() * canvas.width, random() * canvas.height);
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
