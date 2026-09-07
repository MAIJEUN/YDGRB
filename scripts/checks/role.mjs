// /역할 검증 — 관리자가 사람마다 열어 준 역할만, 그 사람이 권한 없이 켜고 끈다.
//
// 이 시스템의 핵심은 **권한을 주지 않는 것**이다. 유저 쪽에 권한을 묻는 줄이 하나라도
// 들어가면 있으나 마나 한 것이 되고, 명단을 안 보고 드롭다운 값을 믿으면 아무 역할이나
// 붙일 수 있게 된다. 그 둘을 잠근다.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DIST, PROJECT, assert, finish, speak } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const sandbox = mkdtempSync(path.join(tmpdir(), "role-"));
mkdirSync(path.join(sandbox, "data"));
process.chdir(sandbox);

const ids = await import(`${DIST}/roles/ids.js`);
const store = await import(`${DIST}/roles/store.js`);
const views = await import(`${DIST}/roles/views.js`);
const { buildContainer } = await import(`${DIST}/ui/response.js`);

const G = "111111111111111111";
const ADMIN = "222222222222222222";
const USER = "333333333333333333";

/** 역할 하나. `editable` 이 false 면 봇이 못 만지는 것이다. */
const role = (id, name, over = {}) => ({ id, name, managed: false, editable: true, ...over });

const roles = new Map([
  ["r1", role("r1", "알림받기")],
  ["r2", role("r2", "게임")],
  ["r3", role("r3", "높은역할", { editable: false })],
  ["r4", role("r4", "봇역할", { managed: true })],
  [G, role(G, "@everyone")],
]);

const guild = { id: G, roles: { cache: { get: (id) => roles.get(id) } } };
const member = (id, held = []) => ({
  id,
  guild,
  user: { id, username: "마이즌" },
  roles: { cache: { has: (roleId) => held.includes(roleId) } },
});

const jsonOf = (view) => buildContainer(view).toJSON();
const bodyOf = (view) => {
  const head = jsonOf(view).components[0];
  return head.type === 9 ? head.components[0].content : head.content;
};
const selectsOf = (view) =>
  jsonOf(view)
    .components.filter((component) => component.type === 1)
    .flatMap((row) => row.components)
    .filter((component) => component.type !== 2);
const accessoryOf = (view) => jsonOf(view).components[0]?.accessory;

// ── 1. 커맨드 ──────────────────────────────────────────────
console.log("\n=== 1. 커맨드 ===");
const { collectCommands } = await import(`${DIST}/loaders/commands.js`);
const command = (await collectCommands()).find((c) => c.data.name === "역할");

assert("/역할 등록됨", command !== undefined);

const json = command.data.toJSON();
assert("패널 하나뿐", (json.options ?? []).map((o) => o.name).join(",") === "패널");
assert("  └ 서버 전용", JSON.stringify(json.contexts) === "[0]");
assert(
  "  └ 명령 자체에는 권한을 걸지 않음",
  json.default_member_permissions === undefined || json.default_member_permissions === null,
  "권한을 건 명령이면 열어 준 사람이 패널을 열 수가 없다",
);
assert("여는 방식은 소원권 패널과 같음", read("src/commands/role.ts").includes("PANEL.admin : PANEL.user"));

// ── 2. 명단 ────────────────────────────────────────────────
//
// 권한이 아니라 명단이다. 사람마다 「이 역할들만」 을 적어 둔다.
console.log("\n=== 2. 명단 ===");
{
  assert("아무것도 없으면 빈 목록", (await store.allowedRoles(G, USER)).length === 0);

  const saved = await store.setAllowedRoles(G, USER, ["r1", "r2", "r1"]);
  assert("정한 대로 담김", saved.join(",") === "r1,r2", saved.join(","));
  assert("  └ 같은 역할은 한 번만", saved.length === 2);
  assert("  └ 다시 읽어도 그대로", (await store.allowedRoles(G, USER)).join(",") === "r1,r2");

  // 통째로 정한다 — 드롭다운이 「지금 열려 있는 것」을 골라 둔 채로 뜨기 때문이다.
  await store.setAllowedRoles(G, USER, ["r2"]);
  assert("낸 목록이 곧 결과", (await store.allowedRoles(G, USER)).join(",") === "r2");

  assert("열어 준 사람을 셈", (await store.openedUsers(G)).join(",") === USER);

  // 빈 목록이면 칸을 아예 지운다.
  await store.setAllowedRoles(G, USER, []);
  assert("전부 닫으면 명단에서 빠짐", (await store.openedUsers(G)).length === 0);
  assert("  └ 파일에도 안 남음", !readFileSync(path.join(sandbox, "data", "roles.json"), "utf8").includes(USER));

  // 스물다섯을 넘으면 뒤를 자른다 — 드롭다운에 담기지 않을 것을 저장하지 않는다.
  const many = Array.from({ length: 40 }, (_, i) => `x${i}`);
  const capped = await store.setAllowedRoles(G, USER, many);
  assert(`${ids.MAX_ALLOWED_ROLES}개까지만`, capped.length === ids.MAX_ALLOWED_ROLES, String(capped.length));

  await store.setAllowedRoles(G, USER, ["r1", "r2", "r3", "r4", G]);
}

// ── 3. 봇이 만질 수 있는 역할만 ────────────────────────────
console.log("\n=== 3. 봇이 만질 수 있는 역할만 ===");
{
  const usable = views.usableRoles(guild, ["r1", "r2", "r3", "r4", G, "없는역할"]);

  assert("쓸 수 있는 것만 남김", usable.map((r) => r.id).join(",") === "r1,r2", usable.map((r) => r.id).join(","));
  assert("  └ 봇보다 높은 역할은 뺌", !usable.some((r) => r.id === "r3"));
  assert("  └ 연동이 들고 있는 역할도", !usable.some((r) => r.id === "r4"));
  assert("  └ @everyone 도", !usable.some((r) => r.id === G));
  assert("  └ 지워진 역할도", !usable.some((r) => r.id === "없는역할"));

  assert("낱개로도 같은 판단", views.canManage(guild, roles.get("r1")) && !views.canManage(guild, roles.get("r3")));
}

// ── 4. 관리자 패널 ─────────────────────────────────────────
console.log("\n=== 4. 관리자 패널 ===");
{
  const before = await views.panelView(member(ADMIN), "admin", true, null);
  const beforeSelects = selectsOf(before);

  assert("유저 드롭다운이 하나", beforeSelects.length === 1, String(beforeSelects.length));
  assert("  └ 유저를 고르는 것 (type 5)", beforeSelects[0].type === 5, String(beforeSelects[0].type));
  assert("  └ 한 명만", beforeSelects[0].min_values === 1 && beforeSelects[0].max_values === 1);
  assert("고르기 전에는 열어 준 사람을 보여 줌", bodyOf(before).includes("열어 준 사람"), bodyOf(before));
  assert("  └ 멘션으로", bodyOf(before).includes(`<@${USER}>`), bodyOf(before));
  assert("  └ 역할 드롭다운은 아직 없음", !beforeSelects.some((s) => s.type === 6));

  const after = await views.panelView(member(ADMIN), "admin", true, USER);
  const afterSelects = selectsOf(after);

  assert("유저를 고르면 역할 드롭다운이 붙음", afterSelects.length === 2, String(afterSelects.length));
  assert("  └ 역할을 고르는 것 (type 6)", afterSelects[1].type === 6, String(afterSelects[1].type));
  assert("  └ 고른 사람을 띄워 둠", JSON.stringify(afterSelects[0].default_values ?? []).includes(USER));
  assert(
    "  └ 지금 열려 있는 것이 골라진 채로",
    JSON.stringify(afterSelects[1].default_values ?? []).includes("r1"),
    JSON.stringify(afterSelects[1].default_values),
  );
  assert("  └ 하나도 안 고르고 낼 수 있음", afterSelects[1].min_values === 0, "그래야 전부 닫을 수 있다");
  assert(`  └ ${ids.MAX_ALLOWED_ROLES}개까지`, afterSelects[1].max_values === ids.MAX_ALLOWED_ROLES);

  assert("열어 준 역할을 멘션으로", bodyOf(after).includes("<@&r1>"), bodyOf(after));

  // 명단에 있어도 봇이 못 만지는 것은 미리 말한다.
  assert("못 만지는 역할을 미리 알림", bodyOf(after).includes("봇이 만지지 못하는 역할"), bodyOf(after));
  assert("  └ 어떻게 하면 되는지도", bodyOf(after).includes(speak("봇 역할을 이 역할들보다 위로 올려 주세요.")), bodyOf(after));

  assert("파랑 (보여 주기만)", jsonOf(after).accent_color === 0x5865f2);
  assert("패널을 오가는 버튼", accessoryOf(after)?.label === "유저 패널", JSON.stringify(accessoryOf(after)));
}

// ── 5. 유저 패널 ───────────────────────────────────────────
console.log("\n=== 5. 유저 패널 ===");
{
  const view = await views.panelView(member(USER, ["r1"]), "user", false);
  const selects = selectsOf(view);

  assert("역할 드롭다운이 하나", selects.length === 1, String(selects.length));
  assert("  └ 글자 드롭다운 (명단 안에서만 고르게)", selects[0].type === 3, String(selects[0].type));
  assert(
    "  └ 열어 준 것만 담김",
    selects[0].options.map((o) => o.value).join(",") === "r1,r2",
    JSON.stringify(selects[0].options.map((o) => o.value)),
  );
  assert("  └ 지금 가진 것이 골라진 채로", selects[0].options.find((o) => o.value === "r1")?.default === true);
  assert("    · 안 가진 것은 안 골라짐", selects[0].options.find((o) => o.value === "r2")?.default !== true);
  assert("  └ 하나도 안 고르고 낼 수 있음", selects[0].min_values === 0, "그래야 전부 벗을 수 있다");

  assert("가진 것을 멘션으로", bodyOf(view).includes("지금 가진 것"), bodyOf(view));
  assert("  └ 관리자가 아니면 패널 전환 버튼도 없음", accessoryOf(view) === undefined);

  // 열어 준 것이 없으면 드롭다운을 만들지 않는다 — 빈 드롭다운을 눌러 보게 두지 않는다.
  const empty = await views.panelView(member("444444444444444444"), "user", false);
  assert("열어 준 게 없으면 드롭다운도 없음", selectsOf(empty).length === 0);
  assert("  └ 그 말을 본문이 함", bodyOf(empty).includes(speak("아직 열어 준 역할이 없습니다. 관리자에게 말해 주세요.")), bodyOf(empty));
}

// ── 6. 권한 ────────────────────────────────────────────────
//
// 유저 쪽에 권한을 묻는 줄이 하나라도 들어가면 이 시스템은 있으나 마나 한 것이 된다.
console.log("\n=== 6. 권한 ===");
{
  const handler = read("src/components/role.ts");
  const toggle = handler.slice(handler.indexOf("async function toggle"), handler.indexOf("async function applyRoles"));

  assert("관리자 쪽은 권한을 봄", handler.includes("if (await denyNonAdmin(interaction)) return;"));
  assert(
    "  └ 유저 쪽은 안 봄",
    !toggle.includes("denyNonAdmin"),
    "권한을 물으면 권한 없이 쓰라고 만든 것이 아니게 된다",
  );
  assert(
    "드롭다운 값을 그대로 믿지 않음",
    toggle.includes("roles.some((role) => role.id === id)"),
    "명단을 안 보면 흉내 낸 값으로 아무 역할이나 붙일 수 있다",
  );
  assert(
    "열어 주지 않은 역할은 손대지 않음",
    handler.includes("열어 주지 않은 역할은 손대지 않는다"),
    "다른 데서 받은 역할까지 벗기면 남의 것을 건드리는 셈이다",
  );
  assert("패널 전환도 다시 확인", handler.includes("isPanelKind(target) && admin"));
  assert("붙이지 못해도 나머지는 계속", handler.includes("failed.push(role)"));
}

finish();
