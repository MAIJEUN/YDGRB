import { execFileSync } from "node:child_process";

/**
 * 배포 상황을 디스코드 웹훅으로 알린다.
 *
 *   node scripts/notify-discord.mjs start
 *       진행중(노랑) 알림을 올리고 `message_id=<id>` 를 출력한다.
 *
 *   node scripts/notify-discord.mjs finish <success|failure|cancelled> [버전] [메시지 id]
 *       같은 메시지를 결과 색으로 고친다. id 가 없으면 새 메시지를 올린다.
 *
 * 봇 출력과 같은 규칙을 따른다 — 색은 성공(초록)·실패(빨강)·진행중(노랑) 세 가지뿐이고,
 * footer 에는 이름만 넣는다(프로필 사진은 쓰지 않는다).
 *
 * 알림이 실패해도 배포 자체를 실패로 만들지 않는다. 경고만 남기고 0 으로 끝낸다.
 */

const COLOR = {
  success: 0x57f287, // 초록
  failure: 0xed4245, // 빨강
  progress: 0xfee75c, // 노랑
};

const TITLE = {
  progress: "배포 진행 중",
  success: "배포 완료",
  failure: "배포 실패",
  cancelled: "배포 취소됨",
};

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

const repository = env("GITHUB_REPOSITORY", "(로컬)");
const serverUrl = env("GITHUB_SERVER_URL", "https://github.com");
const sha = env("GITHUB_SHA");
const actor = env("GITHUB_ACTOR", "unknown");
const runId = env("GITHUB_RUN_ID");
const branch = env("GITHUB_REF_NAME", "-");

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

function link(text, path) {
  return `[${text}](${serverUrl}/${repository}/${path})`;
}

function buildEmbed(state, version) {
  const fields = [
    { name: "저장소", value: `\`${repository}\` · \`${branch}\``, inline: true },
    { name: "커밋", value: sha === "" ? "—" : link(`\`${sha.slice(0, 7)}\``, `commit/${sha}`), inline: true },
    { name: "실행 로그", value: runId === "" ? "—" : link(`#${runId}`, `actions/runs/${runId}`), inline: true },
  ];

  if (version !== undefined && version !== "") {
    fields.push({ name: "버전", value: `\`${version}\`` });
  }

  const subject = commitSubject();

  return {
    color: COLOR[state === "success" ? "success" : state === "progress" ? "progress" : "failure"],
    title: TITLE[state] ?? TITLE.failure,
    description: subject === "" ? undefined : subject,
    fields,
    footer: { text: `@${actor}` },
    timestamp: new Date().toISOString(),
  };
}

async function request(url, method, embed) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!response.ok) {
    throw new Error(`${method} ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  return response.json();
}

async function main() {
  const webhook = env("DISCORD_WEBHOOK_URL");
  if (webhook === "") {
    console.warn("DISCORD_WEBHOOK_URL 이 없어 알림을 건너뜁니다.");
    return;
  }

  const [command, status, version, messageId] = process.argv.slice(2);

  if (command === "start") {
    // wait=true 를 붙여야 응답으로 메시지 정보를 돌려준다 (나중에 이 메시지를 고치기 위해).
    const message = await request(`${webhook}?wait=true`, "POST", buildEmbed("progress"));
    process.stdout.write(`message_id=${message.id}\n`);
    return;
  }

  if (command !== "finish") {
    throw new Error(`알 수 없는 명령: ${command ?? "(없음)"}`);
  }

  const embed = buildEmbed(status ?? "failure", version);

  if (messageId !== undefined && messageId !== "") {
    await request(`${webhook}/messages/${messageId}`, "PATCH", embed);
    return;
  }

  // 시작 알림이 실패했거나 id 를 못 받은 경우 — 결과만 새로 올린다.
  await request(webhook, "POST", embed);
}

try {
  await main();
} catch (error) {
  console.warn(`디스코드 알림 실패: ${error instanceof Error ? error.message : String(error)}`);
}
