/**
 * 배포한 내용을 **업데이트 채널**에 안내한다.
 *
 *   node scripts/announce-update.mjs <버전> [설명 파일]
 *
 * 설명 파일을 안 주면 지난 태그 이후의 커밋으로 직접 만든다 —
 * 배포하지 않고 **미리 보내 보고 싶을 때** 쓴다.
 *
 *   $env:DISCORD_UPDATE_WEBHOOK_URL = "..."      (PowerShell)
 *   node scripts/announce-update.mjs 0.0.0-test
 *
 * 빌드·활동 알림과는 다른 웹훅을 쓴다.
 * 저쪽은 "저장소에 무슨 일이 있었다" 를 개발자에게 알리는 것이고,
 * 이쪽은 "무엇이 바뀌었다" 를 봇을 쓰는 사람에게 알리는 것이다.
 *
 * 모양은 [discord-message.mjs](discord-message.mjs) 가 정한다.
 * 안내가 실패해도 배포를 실패로 만들지 않는다. 경고만 남기고 0 으로 끝낸다.
 */

import { readFileSync } from "node:fs";

import { MAX_BODY, buildMessage, env, repository, send, truncate } from "./discord-message.mjs";

/**
 * 릴리스 설명을 컨테이너 안에서 읽기 좋게 고친다.
 *
 * 분류 제목이 `## 추가` 인데 우리 제목은 `### …` 이라, 그대로 넣으면
 * 분류가 제목보다 커진다. 굵은 글씨로 낮춘다.
 */
export function toContainerMarkdown(notes) {
  const converted = notes
    .trim()
    .split(/\r?\n/u)
    .map((line) => {
      const heading = /^##\s+(.+)$/u.exec(line);
      return heading === null ? line : `**${heading[1].trim()}**`;
    })
    .join("\n");

  if (converted.length <= MAX_BODY) return converted;

  return `${truncate(converted).replace(/_…줄임_$/u, "").trimEnd()}\n\n_…전문은 아래 링크에서 볼 수 있습니다._`;
}

export function buildPayload(version, notes) {
  const name = `YDGRB${version}`;
  const repo = repository();

  return buildMessage({
    status: "info",
    title: `${name} 업데이트`,
    body: toContainerMarkdown(notes),
    buttons: [{ label: `${name}.zip 받기`, url: repo.link(`releases/tag/${version}`) }],
    actor: env("GITHUB_ACTOR", "unknown"),
  });
}

/** 커밋에서 설명을 만든다. release-notes 는 git 을 직접 읽으므로 저장소 안에서만 쓸 수 있다. */
async function buildNotesFromGit() {
  const { buildNotes, readCommits } = await import("./release-notes.mjs");
  return buildNotes(readCommits());
}

async function main() {
  const webhook = env("DISCORD_UPDATE_WEBHOOK_URL");
  if (webhook === "") {
    console.warn("DISCORD_UPDATE_WEBHOOK_URL 이 없어 업데이트 안내를 건너뜁니다.");
    return;
  }

  const [version, notesPath] = process.argv.slice(2);
  if (version === undefined || version === "") throw new Error("버전을 넘겨 주세요.");

  // 파일을 안 주면 커밋에서 직접 만든다 (로컬에서 미리 보낼 때).
  const notes =
    notesPath === undefined || notesPath === ""
      ? await buildNotesFromGit()
      : readFileSync(notesPath, "utf8");

  await send(webhook, buildPayload(version, notes));
  console.log(`업데이트 안내를 보냈습니다 — YDGRB${version}`);
}

if (process.env.ANNOUNCE_UPDATE_IMPORT_ONLY !== "1") {
  try {
    await main();
  } catch (error) {
    console.warn(`업데이트 안내 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}
