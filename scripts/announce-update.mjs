/**
 * 배포한 내용을 **업데이트 채널**에 안내한다.
 *
 *   node scripts/announce-update.mjs <버전> <설명 파일>
 *
 * 빌드 알림(`notify-discord.mjs`)과는 다른 웹훅을 쓴다.
 * 저쪽은 "빌드가 돌고 있다/끝났다" 를 개발자에게 알리는 것이고,
 * 이쪽은 "무엇이 바뀌었다" 를 쓰는 사람에게 알리는 것이다.
 *
 * 봇의 [출력 형식 규칙](../README.md#출력-형식-규칙)을 그대로 따른다 —
 * Components V2 컨테이너 하나, 파랑(정보), 제목·내용·가로줄·인터랙션·가로줄·footer 순.
 *
 * 안내가 실패해도 배포를 실패로 만들지 않는다. 경고만 남기고 0 으로 끝낸다.
 */

import { readFileSync } from "node:fs";

/** Components V2 를 켜는 메시지 플래그. */
const IS_COMPONENTS_V2 = 1 << 15;

/** 파랑 — 정보/알림성 응답. */
const INFO = 0x5865f2;

const TYPE = { actionRow: 1, linkButton: 2, textDisplay: 10, separator: 14, container: 17 };
const LINK_STYLE = 5;

/**
 * 컨테이너 하나에 들어갈 수 있는 글자 수에 한계가 있다.
 * 넘치면 잘라 내고 전문은 릴리스 페이지에서 보게 한다.
 */
const MAX_NOTES = 3_000;

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

/**
 * 릴리스 설명을 컨테이너 안에서 읽기 좋게 고친다.
 *
 * 분류 제목이 `## 추가` 인데, 우리 제목은 `### …` 이라 그대로 넣으면
 * 분류가 제목보다 커진다. 굵은 글씨로 낮춘다.
 */
function toContainerMarkdown(notes) {
  const converted = notes
    .trim()
    .split(/\r?\n/u)
    .map((line) => {
      const heading = /^##\s+(.+)$/u.exec(line);
      return heading === null ? line : `**${heading[1].trim()}**`;
    })
    .join("\n");

  if (converted.length <= MAX_NOTES) return converted;

  return `${converted.slice(0, MAX_NOTES).trimEnd()}\n\n_…전문은 아래 링크에서 볼 수 있습니다._`;
}

function buildPayload(version, notes) {
  const name = `YDGRB${version}`;
  const repository = env("GITHUB_REPOSITORY");
  const serverUrl = env("GITHUB_SERVER_URL", "https://github.com");
  const actor = env("GITHUB_ACTOR", "unknown");

  const releaseUrl =
    repository === "" ? "" : `${serverUrl}/${repository}/releases/tag/${version}`;

  const container = {
    type: TYPE.container,
    accent_color: INFO,
    components: [
      {
        type: TYPE.textDisplay,
        content: `### ${name} 업데이트\n\n${toContainerMarkdown(notes)}`,
      },
    ],
  };

  // 다운로드 버튼 — 인터랙션이므로 앞에 가로줄을 둔다.
  if (releaseUrl !== "") {
    container.components.push(
      { type: TYPE.separator, divider: true, spacing: 1 },
      {
        type: TYPE.actionRow,
        components: [
          { type: TYPE.linkButton, style: LINK_STYLE, label: `${name}.zip 받기`, url: releaseUrl },
        ],
      },
    );
  }

  container.components.push(
    { type: TYPE.separator, divider: true, spacing: 1 },
    { type: TYPE.textDisplay, content: `-# @${actor}` },
  );

  return {
    flags: IS_COMPONENTS_V2,
    components: [container],
    // 설명에 섞인 @ 가 알림을 보내지 않게 막는다.
    allowed_mentions: { parse: [] },
  };
}

async function main() {
  const webhook = env("DISCORD_UPDATE_WEBHOOK_URL");
  if (webhook === "") {
    console.warn("DISCORD_UPDATE_WEBHOOK_URL 이 없어 업데이트 안내를 건너뜁니다.");
    return;
  }

  const [version, notesPath] = process.argv.slice(2);
  if (version === undefined || version === "") throw new Error("버전을 넘겨 주세요.");
  if (notesPath === undefined || notesPath === "") throw new Error("설명 파일을 넘겨 주세요.");

  const notes = readFileSync(notesPath, "utf8");

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildPayload(version, notes)),
  });

  if (!response.ok) {
    throw new Error(`POST ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  console.log(`업데이트 안내를 보냈습니다 — YDGRB${version}`);
}

// 검사에서 불러 쓸 수 있게 내보낸다.
export { buildPayload, toContainerMarkdown, MAX_NOTES };

if (process.env.ANNOUNCE_UPDATE_IMPORT_ONLY !== "1") {
  try {
    await main();
  } catch (error) {
    console.warn(`업데이트 안내 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}
