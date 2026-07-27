/**
 * CI 가 디스코드로 보내는 모든 메시지가 지나는 단 하나의 통로.
 *
 * 봇의 [출력 형식 규칙](../README.md#출력-형식-규칙)을 그대로 따른다 —
 * 같은 채널에 봇 메시지와 나란히 놓이므로 모양이 달라서는 안 된다.
 *
 *   Components V2 컨테이너 하나
 *   색은 초록(완료) · 노랑(진행중) · 빨강(실패) · 파랑(정보) 네 가지
 *   제목 → 내용 → 변동 → 가로줄 → 인터랙션 → 가로줄 → footer(@이름)
 *
 * 웹훅이라 임베드도 쓸 수 있지만 쓰지 않는다. 규칙은 규칙이다.
 */

/** Components V2 를 켜는 메시지 플래그. */
export const IS_COMPONENTS_V2 = 1 << 15;

/** 디스코드 공식 팔레트. 다른 색은 쓰지 않는다. */
export const COLOR = {
  success: 0x57f287, // 초록 — 모든 작업 완료
  progress: 0xfee75c, // 노랑 — 작업 진행중
  failure: 0xed4245, // 빨강 — 작업 실패
  info: 0x5865f2, // 파랑 — 정보 또는 알림성 응답
};

const TYPE = { actionRow: 1, button: 2, textDisplay: 10, separator: 14, container: 17 };
const LINK_STYLE = 5;

/** 컨테이너 하나에 들어갈 수 있는 글자 수 한계. 넘치면 잘라 낸다. */
export const MAX_BODY = 3_000;

export function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function truncate(text, limit = MAX_BODY) {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;

  return `${trimmed.slice(0, limit).trimEnd()}\n\n_…줄임_`;
}

function separator() {
  return { type: TYPE.separator, divider: true, spacing: 1 };
}

/**
 * 메시지 하나를 만든다.
 *
 * @param {object} options
 * @param {"success"|"progress"|"failure"|"info"} options.status
 * @param {string} options.title 제목 — 무슨 일이 있었는지
 * @param {string} [options.body] 내용
 * @param {{name: string, value: string}[]} [options.fields] 변동
 * @param {{label: string, url: string}[]} [options.buttons] 링크 버튼
 * @param {string} options.actor footer 에 적을 이름
 */
export function buildMessage({ status, title, body = "", fields = [], buttons = [], actor }) {
  // 제목 · 내용 · 변동은 한 덩어리로 — 규칙상 구역은 가로줄로만 나눈다.
  const blocks = [`### ${title}`];
  if (body.trim() !== "") blocks.push(truncate(body));
  for (const field of fields) blocks.push(`**${field.name}**\n${field.value}`);

  const container = {
    type: TYPE.container,
    accent_color: COLOR[status] ?? COLOR.info,
    components: [{ type: TYPE.textDisplay, content: blocks.join("\n\n") }],
  };

  const links = buttons.filter((button) => button.url !== "");
  if (links.length > 0) {
    container.components.push(separator(), {
      type: TYPE.actionRow,
      components: links.map((button) => ({
        type: TYPE.button,
        style: LINK_STYLE,
        label: button.label,
        url: button.url,
      })),
    });
  }

  container.components.push(separator(), {
    type: TYPE.textDisplay,
    content: `-# @${actor}`,
  });

  return {
    flags: IS_COMPONENTS_V2,
    components: [container],
    // 커밋 메시지에 섞인 @ 가 알림을 보내지 않게 막는다.
    allowed_mentions: { parse: [] },
  };
}

/** 웹훅으로 보낸다. `messageId` 를 주면 그 메시지를 고친다. */
export async function send(webhook, payload, messageId) {
  const url =
    messageId === undefined || messageId === ""
      ? `${webhook}?wait=true`
      : `${webhook}/messages/${messageId}`;

  const response = await fetch(url, {
    method: messageId === undefined || messageId === "" ? "POST" : "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  return response.json();
}

// ─────────────────────────────────────────────────────────────
// 저장소 정보 — 워크플로가 넣어 주는 환경변수에서 읽는다
// ─────────────────────────────────────────────────────────────

export function repository() {
  const name = env("GITHUB_REPOSITORY");
  const serverUrl = env("GITHUB_SERVER_URL", "https://github.com");

  return {
    name,
    serverUrl,
    /** 저장소 안의 경로로 링크를 만든다. 저장소를 모르면 빈 문자열. */
    link: (path) => (name === "" ? "" : `${serverUrl}/${name}/${path}`),
  };
}
