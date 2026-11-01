// 다 쓴 메시지 잠그기 — 판이 끝났는데 「종료」 가 살아 있던 것.
//
// 끝난 판의 버튼을 누르면 「이미 끝난 판」 이라는 말만 듣고 화면은 그대로라, 닫히지
// 않는 것처럼 보였다. 이제 끝날 때 버튼을 잠근다. 색과 내용, 그림은 그대로여야 한다(규칙 11).
import { DIST, assert, finish } from "./_harness.mjs";

const { lockedComponents } = await import(`${DIST}/ui/lock.js`);

const CDN = "https://cdn.discordapp.com/attachments/1/2/quiz.png";

/** 디스코드가 돌려주는 모양 그대로 — 그림은 이미 풀린 CDN 주소로 온다. */
const fetched = [
  {
    type: 17,
    accent_color: 16705372,
    components: [
      {
        type: 9,
        components: [{ type: 10, content: "### 퀴즈 — 시작\n문제입니다" }],
        accessory: { type: 2, style: 4, label: "종료", custom_id: "game:stop:abc" },
      },
      {
        type: 12,
        items: [{ media: { url: `${CDN}?ex=1&is=2&hm=3`, proxy_url: "https://media/x", width: 10, height: 10, attachment_id: "900" } }],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 1, label: "1", custom_id: "pick:choose:abc:1" },
          { type: 2, style: 5, label: "바로가기", url: "https://discord.com/channels/1/2/3" },
        ],
      },
      { type: 1, components: [{ type: 3, custom_id: "x", options: [{ label: "가", value: "a" }] }] },
      { type: 10, content: "-# @주최자" },
    ],
  },
];

const message = {
  components: fetched.map((json) => ({ toJSON: () => json })),
  attachments: new Map([["900", { id: "900", name: "quiz.png", url: `${CDN}?ex=9&is=9&hm=9` }]]),
};

const { components, locked } = lockedComponents(message);
const [container] = components;
const [section, gallery, buttons, select, footer] = container.components;

console.log("\n=== 1. 누를 수 있는 것만 잠근다 ===");
assert("「종료」 가 잠김", section.accessory.disabled === true, JSON.stringify(section.accessory));
assert("  └ 게임 버튼도", buttons.components[0].disabled === true);
assert("  └ 드롭다운도", select.components[0].disabled === true);
assert("  └ 링크 버튼은 그대로", buttons.components[1].disabled !== true, "누른다고 봇에 무엇을 시키지 않는다");
assert("잠근 수를 셈", locked === 3, String(locked));

console.log("\n=== 2. 나머지는 그대로 (규칙 11) ===");
assert("색이 그대로", container.accent_color === 16705372);
assert("  └ 내용도", section.components[0].content.includes("문제입니다"));
assert("  └ footer 도", footer.content === "-# @주최자");

console.log("\n=== 3. 그림은 첨부를 계속 가리킨다 ===");
assert(
  "붙어 있던 그림은 attachment:// 로 되돌림",
  gallery.items[0].media.url === "attachment://quiz.png",
  JSON.stringify(gallery.items[0].media),
);
{
  const outside = lockedComponents({
    components: [{ toJSON: () => ({ type: 12, items: [{ media: { url: "https://example.com/a.png", width: 1 } }] }) }],
    attachments: new Map(),
  });
  const media = outside.components[0].items[0].media;
  assert("바깥 그림은 주소 그대로", media.url === "https://example.com/a.png" && media.width === undefined, JSON.stringify(media));
}

console.log("\n=== 4. 잠글 것이 없으면 ===");
{
  const done = lockedComponents({ components: [{ toJSON: () => ({ type: 17, components: [{ type: 10, content: "끝" }] }) }], attachments: new Map() });
  assert("아무것도 안 셈 — 고치지 않는다", done.locked === 0);

  const again = lockedComponents({ components: components.map((json) => ({ toJSON: () => json })), attachments: message.attachments });
  assert("  └ 이미 잠긴 것도", again.locked === 0, String(again.locked));
}

finish();
