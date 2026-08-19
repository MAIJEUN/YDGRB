import { count } from "../info/format.js";
import { speak } from "../ui/tone.js";

/**
 * 소원권/조각의 **수량이란 무엇인가**.
 *
 * 반 장도 셀 수 있어야 하지만, 그렇다고 아무 실수나 담을 수는 없다. 부동소수점은
 * `0.1 + 0.2` 가 `0.3` 이 아니고, 더할수록 조금씩 어긋난다. 소원권은 사람이 세는 것이라
 * 어긋난 값이 한 번 저장되면 아무도 되돌리지 못한다.
 *
 * 그래서 **눈금을 정해 두고 그 배수만** 존재하게 한다 — 소수점 아래 둘째 자리, 곧 0.01 이다.
 * 수량이 바뀌는 [단 하나의 통로](store.ts)가 저장 직전에 눈금에 맞추므로, 저장된 값은
 * 언제나 눈금 위에 있다.
 *
 * 읽고 · 맞추고 · 적는 세 가지를 여기 모아 둔다. 세 곳에 흩어지면 입력에서 받아 준 값을
 * 화면이 다르게 적거나, 저장은 됐는데 다시 못 읽는 일이 생긴다.
 */

/** 소수점 아래 자릿수. */
export const DECIMALS = 2;

/** 눈금 — 모든 수량은 `1/STEP` 의 배수다. */
const STEP = 10 ** DECIMALS;

/**
 * 다룰 수 있는 가장 큰 수량.
 *
 * 눈금 단위로 세어도 **정수로 정확히** 남아야 한다. 그 위로는 더한 값이 슬금슬금
 * 어긋나기 시작하므로 여기서 끊는다.
 */
export const MAX_AMOUNT = Math.floor(Number.MAX_SAFE_INTEGER / STEP);

/** 입력 칸을 열어 둘 길이 — 최대값 + 소수점 + 소수 자릿수. */
export const MAX_AMOUNT_LENGTH = String(MAX_AMOUNT).length + 1 + DECIMALS;

/**
 * 눈금에 맞춘다.
 *
 * 저장하기 직전에 한 번 부른다. `0.1 + 0.2` 가 `0.30000000000000004` 로 나와도 여기서
 * `0.3` 이 되고, 그 값이 다시 들어와도 그대로 남는다.
 */
export function quantize(value: number): number {
  return Math.round(value * STEP) / STEP;
}

/**
 * 사람이 적은 갯수를 읽는다. 못 읽으면 undefined.
 *
 * 눈금보다 잘게 적은 것은 **몰래 반올림하지 않고 돌려보낸다.** 적은 값과 처리된 값이
 * 다르면 그게 더 놀랍다.
 */
export function parseAmount(raw: string): number | undefined {
  const trimmed = raw.trim();

  // 부호도 지수도 받지 않는다. 「3」 · 「0.5」 · 「1.25」 만.
  if (!/^\d+(?:\.\d+)?$/u.test(trimmed)) return undefined;

  const fraction = trimmed.split(".")[1] ?? "";
  if (fraction.length > DECIMALS) return undefined;

  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return undefined;

  return quantize(amount);
}

/** 갯수를 잘못 적었을 때의 안내. 무엇이 어긋났는지 대신 **무엇이 되는지**를 적는다. */
export function amountError(raw: string): string {
  return speak(
    `갯수는 0보다 크고 ${formatAmount(MAX_AMOUNT)} 이하여야 하고, 소수점 아래는 ${DECIMALS}자리까지예요. (입력: \`${raw.trim()}\`)`,
  );
}

/**
 * 수량을 글자로 — `3` · `1.5` · `1,234.25`
 *
 * 뒤에 붙는 0 은 떼어 낸다. 대부분의 수량은 여전히 정수라 `3.00장` 이라고 적으면
 * 읽는 사람이 매번 소수점을 지나쳐 읽어야 한다.
 */
export function formatAmount(value: number): string {
  return count(quantize(value));
}
