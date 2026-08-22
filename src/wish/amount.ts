import { count } from "../info/format.js";
import { speak } from "../ui/tone.js";

/**
 * 소원권/조각의 **수량이란 무엇인가**.
 *
 * 반 장도 셀 수 있어야 하지만, 그렇다고 아무 실수나 담을 수는 없다. 부동소수점은
 * `0.1 + 0.2` 가 `0.3` 이 아니고, 더할수록 조금씩 어긋난다. 소원권은 사람이 세는 것이라
 * 어긋난 값이 한 번 저장되면 아무도 되돌리지 못한다.
 *
 * 그래서 **눈금을 정해 두고 그 배수만** 존재하게 한다. 몇째 자리까지 쓸지는 서버가
 * [설정](modals.ts)에서 정하고, 수량이 바뀌는 [단 하나의 통로](store.ts)가 저장 직전에
 * 그 눈금에 맞춘다. 저장된 값은 언제나 눈금 위에 있다.
 *
 * **적는 것은 눈금을 묻지 않는다.** 저장된 값이 이미 눈금 위에 있으므로 그대로 적으면 된다 —
 * 화면마다 서버 설정을 들고 다니지 않아도 되는 이유다.
 */

/** 서버가 고를 수 있는 소수점 자릿수. */
export const MIN_DECIMALS = 0;
export const MAX_DECIMALS = 10;

/** 안 정한 서버의 기본값 — 반 장까지. */
export const DEFAULT_DECIMALS = 1;

/** 설정 값을 범위 안으로 밀어 넣는다. 예전 파일이나 손으로 고친 파일도 여기서 걸러진다. */
export function clampDecimals(value: number | undefined | null): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_DECIMALS;
  return Math.min(Math.max(value, MIN_DECIMALS), MAX_DECIMALS);
}

/** 눈금 — 모든 수량은 `1/step` 의 배수다. */
function step(decimals: number): number {
  return 10 ** clampDecimals(decimals);
}

/** 그 눈금에서 가장 작은 수량. 0자리면 1, 1자리면 0.1. */
export function smallestAmount(decimals: number): number {
  return 1 / step(decimals);
}

/**
 * 그 눈금에서 다룰 수 있는 가장 큰 수량.
 *
 * 눈금 단위로 세어도 **정수로 정확히** 남아야 한다. 그 위로는 더한 값이 슬금슬금
 * 어긋나기 시작하므로 여기서 끊는다.
 *
 * **자릿수를 늘리면 이 한계가 내려간다** — 10자리를 고르면 90만쯤에서 멎는다.
 * 정밀도와 크기를 동시에 가질 수는 없다.
 */
export function maxAmount(decimals: number): number {
  return Math.floor(Number.MAX_SAFE_INTEGER / step(decimals));
}

/** 입력 칸에 적어 줄 한 줄. 설정을 고치면 화면도 따라 바뀐다. */
export function amountHint(decimals: number): string {
  const places = clampDecimals(decimals);
  return places === 0 ? "0보다 큰 정수" : `0보다 큰 수 · 소수점 아래 ${places}자리까지`;
}

/** 입력 칸을 열어 둘 길이 — 그 눈금의 최대값 + 소수점 + 소수 자릿수. */
export function amountLength(decimals: number): number {
  const places = clampDecimals(decimals);
  return String(maxAmount(places)).length + (places === 0 ? 0 : 1 + places);
}

/** 입력 칸 예시. 0자리면 소수를 보여 줄 이유가 없다. */
export function amountPlaceholder(decimals: number): string {
  const places = clampDecimals(decimals);
  // 가장 작은 수량을 그대로 적으면 자릿수가 많을 때 `1e-10` 이 된다 — 그건 입력 칸이
  // 받지도 않는 꼴이라, 예시가 오히려 사람을 속인다.
  return places === 0 ? "예: 3" : `예: 3 · ${formatAmount(smallestAmount(places))}`;
}

/**
 * 눈금에 맞춘다.
 *
 * 저장하기 직전에 한 번 부른다. `0.1 + 0.2` 가 `0.30000000000000004` 로 나와도 여기서
 * `0.3` 이 되고, 그 값이 다시 들어와도 그대로 남는다.
 */
export function quantize(value: number, decimals: number): number {
  return Math.round(value * step(decimals)) / step(decimals);
}

/**
 * 사람이 적은 갯수를 읽는다. 못 읽으면 undefined.
 *
 * 눈금보다 잘게 적은 것은 **몰래 반올림하지 않고 돌려보낸다.** 적은 값과 처리된 값이
 * 다르면 그게 더 놀랍다.
 */
export function parseAmount(raw: string, decimals: number): number | undefined {
  const places = clampDecimals(decimals);
  const trimmed = raw.trim();

  // 부호도 지수도 받지 않는다. 「3」 · 「0.5」 만.
  if (!/^\d+(?:\.\d+)?$/u.test(trimmed)) return undefined;

  const fraction = trimmed.split(".")[1] ?? "";
  if (fraction.length > places) return undefined;

  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount <= 0 || amount > maxAmount(places)) return undefined;

  return quantize(amount, places);
}

/** 갯수를 잘못 적었을 때의 안내. 무엇이 어긋났는지 대신 **무엇이 되는지**를 적는다. */
export function amountError(raw: string, decimals: number): string {
  return speak(
    `갯수는 0보다 크고 ${formatAmount(maxAmount(decimals))} 이하여야 하고, ${amountHint(decimals)}예요. (입력: \`${raw.trim()}\`)`,
  );
}

/**
 * 수량을 글자로 — `3` · `1.5` · `1,234.25`
 *
 * **눈금을 묻지 않는다.** 저장된 값은 이미 눈금 위에 있으므로 그대로 적으면 된다.
 * 뒤에 붙는 0 도 만들지 않는다 — 대부분의 수량은 여전히 정수라 `3.0장` 이라고 적으면
 * 읽는 사람이 매번 소수점을 지나쳐 읽어야 한다.
 */
export function formatAmount(value: number): string {
  // `toString` 은 아주 작은 수를 지수 꼴(`1e-10`)로 낸다. 사람이 세는 수량에 그런 표기가
  // 나오면 읽을 수도, 그대로 다시 적을 수도 없다. 자릿수만큼 펴 두고 남는 0 을 떼어 낸다.
  const plain = value.toFixed(MAX_DECIMALS).replace(/0+$/u, "").replace(/\.$/u, "");
  return count(plain === "" || plain === "-" ? "0" : plain);
}
