/**
 * 한글 다루기.
 *
 * 한글 음절은 유니코드에 규칙적으로 늘어서 있다 —
 * `가`(U+AC00) 부터 `힣`(U+D7A3) 까지, **초성 19 × 중성 21 × 종성 28** 순서다.
 * 그래서 음절 하나에서 초성을 꺼내는 것은 나눗셈 한 번이면 된다.
 */

/** 초성 19자. 유니코드에 박혀 있는 순서 그대로여야 한다. */
const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

const FIRST_SYLLABLE = 0xac00; // 가
const LAST_SYLLABLE = 0xd7a3; // 힣

/** 초성 하나가 거느리는 음절 수 (중성 21 × 종성 28). */
const PER_CHOSEONG = 21 * 28;

/**
 * 글자를 초성으로 바꾼다 — `안녕하세요` → `ㅇㄴㅎㅅㅇ`
 *
 * 한글 음절이 아닌 것(공백 · 숫자 · 영문 · 기호 · 이미 자모인 것)은 **그대로 둔다.**
 * 띄어쓰기가 남아야 몇 단어인지 보이고, 숫자는 초성으로 바꿀 것이 없다.
 */
export function toChoseong(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code < FIRST_SYLLABLE || code > LAST_SYLLABLE) return char;

      return CHOSEONG[Math.floor((code - FIRST_SYLLABLE) / PER_CHOSEONG)] ?? char;
    })
    .join("");
}

/**
 * 초성으로 바꿀 것이 하나라도 있는지.
 *
 * 없으면 초성 문제가 답과 똑같아진다 — 내는 순간 답이 보인다.
 */
export function hasSyllable(text: string): boolean {
  return [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= FIRST_SYLLABLE && code <= LAST_SYLLABLE;
  });
}
