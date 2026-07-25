/** 사용자에게 보여줄 오류 문구의 한도. 임베드 필드 한도(1024)보다 넉넉히 짧게 잡는다. */
const MAX_LINES = 3;
const MAX_LENGTH = 300;
const ELLIPSIS = "...";

function truncate(text: string): string {
  const lines = text.trim().replaceAll("```", "'''").split(/\r?\n/u);

  // 최대 3줄까지만. 넘치면 마지막 줄 끝에 생략 표시를 붙인다.
  const kept = lines.slice(0, MAX_LINES);
  const lastLine = kept.at(-1);
  if (lines.length > MAX_LINES && lastLine !== undefined) {
    kept[kept.length - 1] = `${lastLine} ${ELLIPSIS}`;
  }

  const joined = kept.join("\n");
  if (joined.length <= MAX_LENGTH) return joined;

  return `${joined.slice(0, MAX_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`;
}

/**
 * 오류를 사용자에게 보여줄 한 줄로 만든다.
 *
 * **메시지만** 쓴다 — 스택 트레이스나 요청 URL 에는 인터랙션 토큰 같은 게 섞여 있어서
 * 채널에 남기면 안 된다. 전체 내용은 로그에만 남긴다.
 *
 * `DiscordAPIError` 는 name 에 코드가 들어 있어서 그대로 쓰면 `DiscordAPIError[50035]: ...` 가 된다.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return truncate(error.message === "" ? error.name : `${error.name}: ${error.message}`);
  }

  if (typeof error === "string") return truncate(error);

  try {
    return truncate(JSON.stringify(error) ?? String(error));
  } catch {
    return truncate(String(error));
  }
}
