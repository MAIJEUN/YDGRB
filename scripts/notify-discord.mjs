import { execFileSync } from "node:child_process";

import { buildMessage, env, repository, send } from "./discord-message.mjs";

/**
 * 배포 상황을 디스코드 웹훅으로 알린다.
 *
 *   node scripts/notify-discord.mjs start
 *       진행중(노랑) 알림을 올리고 `message_id=<id>` 를 출력한다.
 *
 *   node scripts/notify-discord.mjs finish <success|failure|cancelled> [버전] [메시지 id]
 *       같은 메시지를 결과 색으로 고친다. id 가 없으면 새 메시지를 올린다.
 *
 * 모양은 [discord-message.mjs](discord-message.mjs) 가 정한다 — 저장소 활동 알림과 같다.
 *
 * 알림이 실패해도 배포 자체를 실패로 만들지 않는다. 경고만 남기고 0 으로 끝낸다.
 */

const TITLE = {
  progress: "배포 진행 중",
  success: "배포 완료",
  failure: "배포 실패",
  cancelled: "배포 취소됨",
};

/** 배포 결과를 네 색 중 하나로. 취소는 끝까지 가지 못한 것이라 실패와 같이 본다. */
function statusOf(state) {
  if (state === "success") return "success";
  if (state === "progress") return "progress";
  return "failure";
}

/** 마지막 커밋 제목. 무엇 때문에 도는 배포인지 한눈에 보이게. */
function commitSubject() {
  try {
    // git 이 없거나 저장소가 아니어도 조용히 넘어가도록 stderr 은 버린다.
    return execFileSync("git", ["log", "-1", "--pretty=%s"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function buildPayload(state, version) {
  const repo = repository();
  const sha = env("GITHUB_SHA");
  const runId = env("GITHUB_RUN_ID");

  const fields = [
    {
      name: "저장소",
      value: `\`${repo.name === "" ? "(로컬)" : repo.name}\` · \`${env("GITHUB_REF_NAME", "-")}\``,
    },
  ];

  if (version !== undefined && version !== "") {
    fields.push({ name: "버전", value: `\`YDGRB${version}\`` });
  }

  return buildMessage({
    status: statusOf(state),
    title: TITLE[state] ?? TITLE.failure,
    body: commitSubject(),
    fields,
    buttons: [
      { label: "커밋", url: sha === "" ? "" : repo.link(`commit/${sha}`) },
      { label: "실행 로그", url: runId === "" ? "" : repo.link(`actions/runs/${runId}`) },
    ],
    actor: env("GITHUB_ACTOR", "unknown"),
  });
}

async function main() {
  const webhook = env("DISCORD_WEBHOOK_URL");
  if (webhook === "") {
    console.warn("DISCORD_WEBHOOK_URL 이 없어 알림을 건너뜁니다.");
    return;
  }

  const [command, state, version, messageId] = process.argv.slice(2);

  if (command === "start") {
    const message = await send(webhook, buildPayload("progress"));
    process.stdout.write(`message_id=${message.id}\n`);
    return;
  }

  if (command !== "finish") {
    throw new Error(`알 수 없는 명령: ${command ?? "(없음)"}`);
  }

  // id 가 없으면(시작 알림이 실패했거나) 결과만 새로 올린다.
  await send(webhook, buildPayload(state ?? "failure", version), messageId);
}

if (process.env.NOTIFY_DISCORD_IMPORT_ONLY !== "1") {
  try {
    await main();
  } catch (error) {
    console.warn(`디스코드 알림 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}
