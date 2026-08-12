// 끝나는 효과의 종료 안내 검증.
//
// 뚜따이 · 타임아웃 · 타살버가 전부 이 한 곳을 지난다. 모양이 갈라지면 읽는 사람이
// 매번 다시 읽어야 하므로, 색 · 문구 · 다는 자리를 여기서 못 박는다.
import { DIST, PROJECT, assert, finish, speak } from "./_harness.mjs";

const { readFileSync } = await import("node:fs");
const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const { endNoticeView, hasLeft, sendEndNotice } = await import(`${DIST}/ui/end-notice.js`);
const { buildContainer } = await import(`${DIST}/ui/response.js`);

const G = "111111111111111111";
const U = "222222222222222222";
const BY = "333333333333333333";
const BOT = "444444444444444444";
const CH = "555555555555555555";
const MSG = "666666666666666666";

const user = { username: "마이즌" };
const until = new Date(1_800_000_000_000);
const stamp = Math.floor(until.getTime() / 1000);

function render(view) {
  const json = buildContainer(view).toJSON();
  const head = json.components[0];
  return { json, text: head.type === 9 ? head.components[0].content : head.content };
}

console.log("\n=== 1. 기간 만료 ===");
{
  const view = endNoticeView({ effect: "타임아웃", target: `<@${U}>`, until, reason: { kind: "expired" }, user });
  const { json, text } = render(view);

  assert("제목이 「효과 — 기간 만료」", text.startsWith("### 타임아웃 — 기간 만료"), text);
  assert("  └ 파랑(알림성)", json.accent_color === 0x5865f2, String(json.accent_color));
  assert("대상을 멘션으로", text.includes(`<@${U}> 님의`), text);
  assert("  └ 끝났다고 말함", text.includes(speak("끝났습니다")), text);
  assert("풀린 시각을 적음", text.includes("**풀린 시각**"), text);
  assert("  └ 타임스탬프 마크다운", text.includes(`<t:${stamp}:F> (<t:${stamp}:R>)`), text);
  assert("대상을 칸으로 또 적지 않음", !text.includes("**대상**"), text);
  assert("채널에 남는 메시지 (임시가 아님)", view.ephemeral === false);
}

console.log("\n=== 2. 사람이 풀었을 때 ===");
{
  const { text } = render(
    endNoticeView({ effect: "타살버", target: `<@${U}>`, until, reason: { kind: "released", byId: BY }, user }),
  );

  assert("제목이 「효과 — 해제」", text.startsWith("### 타살버 — 해제"), text);
  assert("  └ 푼 사람을 멘션으로", text.includes(speak(`<@${BY}> 님이 풀었습니다`)), text);
  assert("  └ 원래 풀릴 시각을 적음", text.includes("**원래 풀릴 시각**"), text);
}
{
  // 누가 풀었는지 모를 때는 이름 없이.
  const { text } = render(
    endNoticeView({ effect: "타임아웃", target: `<@${U}>`, until, reason: { kind: "released", byId: null }, user }),
  );
  assert("푼 사람을 모르면 그냥 풀렸다고", text.includes(speak("풀렸습니다")) && !text.includes("님이 풀었"), text);
}

console.log("\n=== 3. 조사 ===");
{
  const { text } = render(
    endNoticeView({ effect: "뚜따이", target: "**서버 전원**", until, reason: { kind: "expired" }, user }),
  );
  assert("사람이 아니면 「님」 을 안 붙임", text.includes("**서버 전원**의") && !text.includes("님의"), text);
}

console.log("\n=== 4. 서버를 떠난 사람 ===");
{
  const { text } = render(
    endNoticeView({ effect: "타임아웃", target: `<@${U}>`, until, reason: { kind: "expired" }, targetLeft: true, user }),
  );
  assert("떠났다고 덧붙임", text.includes(speak("서버를 떠난 사람입니다")), text);
}

console.log("\n=== 5. 뒷정리가 실패했을 때 ===");
{
  const { json, text } = render(
    endNoticeView({
      effect: "뚜따이",
      target: "**서버 전원**",
      until,
      reason: { kind: "expired" },
      outcome: { status: "progress", fields: [{ name: "집계", value: "전체 **10명** · 실패 **1명**" }] },
      user,
    }),
  );

  assert("일부만 실패면 노랑", json.accent_color === 0xfee75c, String(json.accent_color));
  assert("  └ 집계를 붙임", text.includes("**집계**"), text);
}
{
  const { json } = render(
    endNoticeView({
      effect: "뚜따이",
      target: "**서버 전원**",
      until,
      reason: { kind: "expired" },
      outcome: { status: "failure", fields: [] },
      user,
    }),
  );
  assert("전부 실패면 빨강", json.accent_color === 0xed4245, String(json.accent_color));
}

// ── 어디에 다는가 ──────────────────────────────────────────
function makeClient({ origin = true, sendable = true } = {}) {
  const sent = [];

  return {
    sent,
    user: { id: BOT },
    channels: {
      fetch: async (id) => {
        if (id !== CH) throw new Error("없는 채널");
        return {
          isSendable: () => sendable,
          send: async (payload) => sent.push({ how: "채널", payload }),
          messages: {
            fetch: async (messageId) => {
              if (!origin || messageId !== MSG) throw new Error("없는 메시지");
              return { reply: async (payload) => sent.push({ how: "답장", payload }) };
            },
          },
        };
      },
    },
    guilds: { fetch: async () => ({ members: { fetch: async () => null } }) },
  };
}

const notice = { effect: "타임아웃", target: `<@${U}>`, until, reason: { kind: "expired" }, user };

console.log("\n=== 6. 효과를 건 메시지에 답장 ===");
{
  const client = makeClient();
  await sendEndNotice(client, { channelId: CH, messageId: MSG }, notice);

  assert("답장으로 담", client.sent[0]?.how === "답장", JSON.stringify(client.sent.map((s) => s.how)));
  assert("  └ 한 번만", client.sent.length === 1);
  assert(
    "  └ 답장이 원본 작성자를 울리지 않음",
    JSON.stringify(client.sent[0]?.payload.allowedMentions) === '{"parse":[],"repliedUser":false}',
    JSON.stringify(client.sent[0]?.payload.allowedMentions),
  );
}
{
  const client = makeClient({ origin: false });
  await sendEndNotice(client, { channelId: CH, messageId: MSG }, notice);
  assert("원본이 지워졌으면 채널에 그냥 남김", client.sent[0]?.how === "채널", JSON.stringify(client.sent));
}
{
  const client = makeClient();
  await sendEndNotice(client, { channelId: CH, messageId: null }, notice);
  assert("달 자리가 없으면 채널에", client.sent[0]?.how === "채널");
}
{
  const client = makeClient({ sendable: false });
  await sendEndNotice(client, { channelId: CH, messageId: MSG }, notice);
  assert("글을 못 쓰는 채널이면 아무것도 안 함", client.sent.length === 0, JSON.stringify(client.sent));
}
{
  const client = makeClient();
  await sendEndNotice(client, { channelId: null, messageId: null }, notice);
  assert("채널을 모르면 아무것도 안 함", client.sent.length === 0);
}
{
  // 채널이 지워졌어도 던지지 않는다 — 효과는 이미 끝났다.
  const client = makeClient();
  let threw = false;
  try {
    await sendEndNotice(client, { channelId: "999999999999999999", messageId: null }, notice);
  } catch {
    threw = true;
  }
  assert("채널이 없어도 던지지 않음", !threw && client.sent.length === 0);
}

console.log("\n=== 7. 푼 사람이 봇이면 이름을 지움 ===");
//
// 「<@봇> 님이 풀었습니다」 는 아무 정보도 주지 않는다. `/타임아웃` 으로 사람이 푼 것을
// 봇이 푼 것으로 찍던 회귀가 여기서 잡힌다.
{
  const client = makeClient();
  await sendEndNotice(
    client,
    { channelId: CH, messageId: MSG },
    { ...notice, reason: { kind: "released", byId: BOT } },
  );

  const body = JSON.stringify(client.sent[0]?.payload.components[0].toJSON());
  assert("봇 멘션이 안 나옴", !body.includes(`<@${BOT}>`), body);
  assert("  └ 그냥 풀렸다고만", body.includes(speak("풀렸습니다")), body);
}
{
  const client = makeClient();
  await sendEndNotice(
    client,
    { channelId: CH, messageId: MSG },
    { ...notice, reason: { kind: "released", byId: BY } },
  );

  const body = JSON.stringify(client.sent[0]?.payload.components[0].toJSON());
  assert("사람이면 그대로 적음", body.includes(`<@${BY}>`), body);
}

console.log("\n=== 8. 떠났는지 확인 ===");
{
  const gone = makeClient();
  assert("멤버를 못 찾으면 떠난 것", (await hasLeft(gone, G, U)) === true);

  const here = {
    guilds: { fetch: async () => ({ members: { fetch: async () => ({ id: U }) } }) },
  };
  assert("  └ 있으면 false", (await hasLeft(here, G, U)) === false);

  const broken = { guilds: { fetch: async () => { throw new Error("없는 서버"); } } };
  assert("  └ 서버를 못 찾으면 굳이 적지 않음", (await hasLeft(broken, G, U)) === false);
}

console.log("\n=== 9. 세 시스템이 같은 곳을 지남 ===");
for (const rel of [
  "src/timeout/scheduler.ts",
  "src/tasalbeo/scheduler.ts",
  "src/nickname/scheduler.ts",
]) {
  assert(`${rel} 이 sendEndNotice 를 씀`, read(rel).includes("sendEndNotice"));
}

const timeoutScheduler = read("src/timeout/scheduler.ts");
assert(
  "알림이 두 번 나가지 않게 읽으면서 지움",
  timeoutScheduler.includes("takeState"),
  "예약 타이머와 guildMemberUpdate 가 거의 같은 순간에 들어올 수 있다",
);
assert(
  "봇이 한 일은 guildMemberUpdate 가 넘김",
  read("src/events/guild-member-update.ts").includes("newMember.client.user?.id"),
  "명령으로 푼 것을 봇이 푼 것으로 찍지 않기 위해",
);

finish();
