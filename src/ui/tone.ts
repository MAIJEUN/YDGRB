import { finalOf, toChoseong } from "../hangul.js";

/**
 * 봇의 말투 — **끝을 맺지 않는다.**
 *
 * 종결 어미를 잘라 내고 잘린 자리의 **초성 하나**만 남긴 뒤 `-` 를 붙인다.
 *
 *   안녕하세요        →  안녕하ㅅ-
 *   패배하셨습니다     →  패배하셨ㅅ-
 *   제가 짱입니다      →  제가 짱입ㄴ-
 *   승기는 가져가겠습니다 →  승기는 가져가겠ㅅ-
 *
 * 규칙은 하나다. **어미를 지우고 그 첫 음절의 초성을 남긴다** —
 * `습니다`의 `습`은 `ㅅ`, `니다`의 `니`는 `ㄴ`, `세요`의 `세`는 `ㅅ`.
 * 어디서 자를지 매번 고민하지 않게 표 하나로 못 박아 둔다.
 *
 * 한 곳에서 정하는 이유는 말투를 바꿀 일이 생기면 여기만 고치면 되기 때문이다.
 * 문장마다 손으로 잘라 두면 다음에 쓰는 문장이 반드시 어긋난다.
 *
 * **봇이 하는 말에만 쓴다.** 유저가 적은 글(퀴즈의 문제·정답, 별명, 사유)은 그대로 둔다 —
 * 그건 봇의 말이 아니라 데이터다.
 */

/**
 * 잘라 낼 어미. **긴 것부터** 본다 — `습니다`가 `니다`보다, `세요`가 `요`보다 먼저다.
 *
 * 남길 초성은 따로 적지 않는다. 잘린 첫 음절에서 뽑으면 되기 때문이다.
 */
const ENDINGS = [
  "습니다",
  "습니까",
  "ㅂ니다",
  "니다",
  "니까",
  "세요",
  "셔요",
  "어요",
  "아요",
  "여요",
  "예요",
  "에요",
  "해요",
  "네요",
  "게요",
  "나요",
  "까요",
  "군요",
  "지요",
  "어라",
  "죠",
] as const;

/**
 * `니다`·`니까` 는 **받침 ㅂ 뒤에서만** 어미다.
 *
 * `합니다`·`엽니다`·`아닙니다` 의 `합`·`엽`·`닙` 에는 받침 ㅂ 이 있다. 없으면 어미가 아니다 —
 * `아니다` 를 자르면 「아ㄴ-」 이 되어 무슨 말인지 알 수 없다.
 *
 * 홑 `요` 를 표에서 뺀 것도 같은 이유다. `필요`·`중요` 가 「필ㅇ-」 이 되어 버린다.
 * 실제로 쓰는 `~어요`·`~세요` 는 전부 따로 적어 두었다.
 */
function endsHere(ending: string, kept: string): boolean {
  if (ending !== "니다" && ending !== "니까") return true;

  return finalOf(kept.at(-1) ?? "") === "ㅂ";
}

/**
 * 어미 **뒤에 붙는 꾸밈** — 굵게 표시하는 `**`, 기울임 `_`, 닫는 괄호·따옴표.
 *
 * 자를 자리를 찾을 때만 잠깐 걷어 냈다가 그대로 도로 붙인다. 걷어 내지 않으면
 * `**이 서버에 없습니다.**` 의 어미가 문장 끝으로 보이지 않아 그냥 지나간다.
 */
const DECORATION = /[*_`~)\]}」』»>"']*$/u;

/** 문장 끝에 붙어 있던 마침표는 지운다 — `-` 가 이미 말끝을 흐린다. */
const TRAILING = /[.\s]+$/u;

/**
 * 한 문장을 말끝 흐린 꼴로.
 *
 * 어미를 못 찾으면 **손대지 않는다** — 명사로 끝나는 짧은 말(「없음」·「3명」)까지
 * 건드리면 오히려 읽기 어렵고, 공백 하나라도 지우면 `??` 같은 코드가 붙어 버린다.
 */
function trail(sentence: string): string {
  const decoration = DECORATION.exec(sentence)?.[0] ?? "";
  const bare = decoration === "" ? sentence : sentence.slice(0, -decoration.length);
  const body = bare.replace(TRAILING, "");
  if (body === "") return sentence;

  for (const ending of ENDINGS) {
    if (!body.endsWith(ending)) continue;

    const kept = body.slice(0, body.length - ending.length);
    // 어미만 남는 말(「죠」 하나짜리)은 자를 것이 없다.
    if (kept === "") return sentence;
    if (!endsHere(ending, kept)) continue;

    return `${kept}${toChoseong(ending[0] ?? "")}-${decoration}`;
  }

  return sentence;
}

/**
 * 문장이 끝나는 자리에서 잘라 하나씩 손본다.
 *
 * 마침표·물음표·느낌표·줄바꿈만이 아니다. 봇의 말은 뒤에 값이나 토를 달고 다닌다 —
 * `커맨드입니다: /퀴즈`, `깨졌습니다 — data.json`, `못했습니다 (못 보는 것일 수 있어요)`.
 * 이 자리들도 문장이 끝난 자리다.
 *
 * `?` 와 `!` 는 남긴다 — 묻는 말인지 아닌지는 뜻이 달라진다. 마침표만 지운다.
 */
const SPLIT = /([?!]|\.(?=\s|$)|\n|:(?=\s)|\s+[—–]\s+|\s+(?=[_*]?\())/u;

export function speak(text: string): string {
  const parts = text.split(SPLIT);
  const out: string[] = [];
  let clipped = false;

  parts.forEach((part, index) => {
    // 홀수 자리는 잘라 낸 구분자 자체다.
    if (index % 2 === 1) {
      // 마침표는 **잘린 자리에서만** 지운다. `-` 가 이미 그 노릇을 하기 때문이다.
      // 자를 것이 없던 문장(「90(숫자만 쓰면 초). 10초 ~ 1시간」)의 마침표까지 지우면
      // 봇의 말투가 아니라 그냥 글이 깨진다.
      out.push(part === "." && clipped ? "" : part);
      return;
    }

    const said = trail(part);
    clipped = said !== part;
    out.push(said);
  });

  return out.join("");
}
