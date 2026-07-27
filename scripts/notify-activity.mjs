/**
 * 저장소에서 일어나는 **모든 일**을 디스코드로 알린다.
 *
 *   node scripts/notify-activity.mjs
 *
 * 워크플로가 넣어 주는 `GITHUB_EVENT_NAME` 과 `GITHUB_EVENT_PATH`(이벤트 원본 JSON)를 읽어
 * 무슨 일인지 알아낸다. 모르는 이벤트도 이름만이라도 알린다 — 조용히 삼키지 않는다.
 *
 * 배포 알림(`notify-discord.mjs`)과 같은 웹훅·같은 모양을 쓴다.
 * 저쪽은 "이 배포가 어떻게 됐다", 이쪽은 "저장소에 무슨 일이 있었다" 다.
 *
 * 알림이 실패해도 워크플로를 실패시키지 않는다. 경고만 남기고 0 으로 끝낸다.
 */

import { readFileSync } from "node:fs";

import { buildMessage, env, repository, send, truncate } from "./discord-message.mjs";

/** 커밋 목록에 보여 줄 최대 개수. 그 이상은 「외 n개」 로 줄인다. */
const MAX_COMMITS = 10;

function readEvent() {
  const path = env("GITHUB_EVENT_PATH");
  if (path === "") return {};

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** `refs/heads/main` → `main` */
function shortRef(ref) {
  return String(ref ?? "").replace(/^refs\/(?:heads|tags)\//u, "");
}

/** 커밋 메시지의 첫 줄만. */
function subject(message) {
  return String(message ?? "").split("\n")[0].trim();
}

// ─────────────────────────────────────────────────────────────
// 이벤트별 화면
//
// 어느 것이든 { status, title, body, fields, buttons } 를 돌려준다.
// null 을 돌려주면 알리지 않는다.
// ─────────────────────────────────────────────────────────────

function onPush(event, repo) {
  const commits = Array.isArray(event.commits) ? event.commits : [];
  const branch = shortRef(event.ref);

  // 브랜치/태그를 지운 푸시는 커밋이 없다. create/delete 가 따로 알린다.
  if (commits.length === 0) return null;

  const shown = commits.slice(0, MAX_COMMITS).map((commit) => {
    const sha = String(commit.id ?? "").slice(0, 7);
    return `[\`${sha}\`](${commit.url}) ${subject(commit.message)}`;
  });

  if (commits.length > MAX_COMMITS) shown.push(`_외 ${commits.length - MAX_COMMITS}개_`);

  return {
    status: "info",
    title: `커밋 ${commits.length}개 — \`${branch}\``,
    body: shown.join("\n"),
    buttons: [{ label: "변경 내용 보기", url: String(event.compare ?? repo.link(`tree/${branch}`)) }],
  };
}

function onPullRequest(event) {
  const pull = event.pull_request ?? {};
  const merged = pull.merged === true;

  const label = {
    opened: "열림",
    reopened: "다시 열림",
    closed: merged ? "병합됨" : "닫힘",
    ready_for_review: "리뷰 준비됨",
    converted_to_draft: "초안으로",
  }[event.action];

  if (label === undefined) return null;

  return {
    status: merged ? "success" : "info",
    title: `풀 리퀘스트 — ${label}`,
    body: `#${pull.number} ${subject(pull.title)}`,
    fields: [{ name: "가는 곳", value: `\`${shortRef(pull.head?.ref)}\` → \`${shortRef(pull.base?.ref)}\`` }],
    buttons: [{ label: "보러 가기", url: String(pull.html_url ?? "") }],
  };
}

function onIssue(event) {
  const issue = event.issue ?? {};

  const label = { opened: "열림", reopened: "다시 열림", closed: "닫힘" }[event.action];
  if (label === undefined) return null;

  return {
    status: event.action === "closed" ? "success" : "info",
    title: `이슈 — ${label}`,
    body: `#${issue.number} ${subject(issue.title)}`,
    buttons: [{ label: "보러 가기", url: String(issue.html_url ?? "") }],
  };
}

function onComment(event) {
  if (event.action !== "created") return null;

  const comment = event.comment ?? {};
  const issue = event.issue ?? {};

  return {
    status: "info",
    title: "댓글",
    body: truncate(String(comment.body ?? ""), 500),
    fields: [{ name: "어디에", value: `#${issue.number} ${subject(issue.title)}` }],
    buttons: [{ label: "보러 가기", url: String(comment.html_url ?? "") }],
  };
}

function onRelease(event) {
  if (event.action !== "published") return null;

  const release = event.release ?? {};

  return {
    status: "success",
    title: `릴리스 — ${release.name ?? release.tag_name}`,
    body: truncate(String(release.body ?? ""), 1_000),
    buttons: [{ label: "받으러 가기", url: String(release.html_url ?? "") }],
  };
}

function onCreateOrDelete(event, repo, created) {
  const kind = event.ref_type === "tag" ? "태그" : "브랜치";

  return {
    status: "info",
    title: `${kind} ${created ? "만듦" : "지움"} — \`${event.ref}\``,
    buttons: created ? [{ label: "보러 가기", url: repo.link(`tree/${event.ref}`) }] : [],
  };
}

function onFork(event, repo) {
  return {
    status: "info",
    title: "포크됨",
    body: `\`${event.forkee?.full_name ?? "?"}\``,
    buttons: [{ label: "보러 가기", url: String(event.forkee?.html_url ?? repo.link("")) }],
  };
}

function onStar(event, repo) {
  if (event.action !== "started") return null;

  return {
    status: "info",
    title: "별을 받았습니다",
    fields: [{ name: "지금", value: `**${event.repository?.stargazers_count ?? "?"}개**` }],
    buttons: [{ label: "저장소", url: repo.link("") }],
  };
}

/** 위에 없는 이벤트 — 이름만이라도 알린다. */
function onOther(name, event, repo) {
  return {
    status: "info",
    title: `저장소 활동 — \`${name}\``,
    fields: event.action === undefined ? [] : [{ name: "동작", value: `\`${event.action}\`` }],
    buttons: [{ label: "저장소", url: repo.link("") }],
  };
}

export function buildView(name, event, repo) {
  switch (name) {
    case "push":
      return onPush(event, repo);
    case "pull_request":
      return onPullRequest(event);
    case "issues":
      return onIssue(event);
    case "issue_comment":
      return onComment(event);
    case "release":
      return onRelease(event);
    case "create":
      return onCreateOrDelete(event, repo, true);
    case "delete":
      return onCreateOrDelete(event, repo, false);
    case "fork":
      return onFork(event, repo);
    case "watch":
      return onStar(event, repo);
    default:
      return onOther(name, event, repo);
  }
}

async function main() {
  const webhook = env("DISCORD_WEBHOOK_URL");
  if (webhook === "") {
    console.warn("DISCORD_WEBHOOK_URL 이 없어 활동 알림을 건너뜁니다.");
    return;
  }

  const name = env("GITHUB_EVENT_NAME", "unknown");
  const repo = repository();
  const view = buildView(name, readEvent(), repo);

  if (view === null) {
    console.log(`알릴 것이 없는 이벤트입니다 — ${name}`);
    return;
  }

  await send(webhook, buildMessage({ ...view, actor: env("GITHUB_ACTOR", "unknown") }));
  console.log(`활동 알림을 보냈습니다 — ${name}`);
}

if (process.env.NOTIFY_ACTIVITY_IMPORT_ONLY !== "1") {
  try {
    await main();
  } catch (error) {
    console.warn(`활동 알림 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}
