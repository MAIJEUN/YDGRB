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

/** 받침 27자. 유니코드 순서 그대로다 — 「받침 없음」 은 0번이라 표에 넣지 않는다. */
const JONGSEONG = "ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";

/** 중성 하나가 거느리는 음절 수 (= 받침 가짓수). */
const PER_JUNGSEONG = 28;

/**
 * 음절의 **받침**을 돌려준다 — `합` → `ㅂ`, `아` → `""`
 *
 * 한글 음절이 아니거나 받침이 없으면 빈 글자다.
 * [말투](ui/tone.ts)가 `합니다`(어미)와 `아니다`(어미 아님)를 가르는 데 쓴다.
 */
export function finalOf(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  if (code < FIRST_SYLLABLE || code > LAST_SYLLABLE) return "";

  const index = (code - FIRST_SYLLABLE) % PER_JUNGSEONG;
  return index === 0 ? "" : (JONGSEONG[index - 1] ?? "");
}

/**
 * 글자를 초성으로 바꾼다 — `안녕하세요` → `ㅇㄴㅎㅅㅇ`
 *
 * 한글 음절이 아닌 것(공백 · 숫자 · 영문 · 기호 · **이미 초성인 것**)은 **그대로 둔다.**
 * 띄어쓰기가 남아야 몇 단어인지 보이고, 숫자는 초성으로 바꿀 것이 없다.
 *
 * 그래서 초성을 그대로 적으면 바뀌는 것 없이 그대로 나온다 — 문제와 정답이 같아지지만
 * 막지 않는다. 적은 사람이 알고 하는 일이다.
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
