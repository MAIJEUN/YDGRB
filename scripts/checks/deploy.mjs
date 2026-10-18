// 슬래시 커맨드 등록 · 즉시 등록 · 초기화 — 무엇을 올리고 무엇을 지우는지.
//
// 디스코드에 실제로 붙지 않는다. 가짜 REST 를 물려, 어느 자리(글로벌 · 서버)에 무엇이
// 실렸는지를 본다. 초기화는 되돌릴 수 없으니 엉뚱한 자리를 지우지 않는지가 핵심이다.
import { readFileSync } from "node:fs";

import { DIST, PROJECT, assert, finish } from "./_harness.mjs";

const read = (rel) => readFileSync(`${PROJECT}/${rel}`, "utf8");

const { deploy, modeOf, guildsOf } = await import(`${DIST}/deploy/run.js`);

const APP = "100000000000000000";
const G1 = "200000000000000001";
const G2 = "200000000000000002";

const GLOBAL = `/applications/${APP}/commands`;
const inGuild = (id) => `/applications/${APP}/guilds/${id}/commands`;

/** 자리마다 등록된 것을 들고 있는 가짜 디스코드. */
function fakeRest({ guilds = [], registered = {} } = {}) {
  const store = new Map(Object.entries(registered));
  const puts = [];

  return {
    puts,
    store,
    get: async (route, options) => {
      if (route === "/users/@me/guilds") {
        const after = options?.query?.get("after");
        const start = after === null || after === undefined ? 0 : guilds.findIndex((g) => g.id === after) + 1;
        return guilds.slice(start, start + 200);
      }
      return store.get(route) ?? [];
    },
    put: async (route, { body }) => {
      puts.push({ route, count: body.length });
      store.set(route, body);
      return body;
    },
  };
}

const body = [{ name: "가" }, { name: "나" }, { name: "다" }];

// ── 1. 무엇을 할지 ─────────────────────────────────────────
console.log("\n=== 1. 무엇을 할지 ===");
assert("아무것도 안 주면 등록", modeOf([]) === "deploy");
assert("--now 면 즉시 등록", modeOf(["--now"]) === "now");
assert("--reset 이면 초기화", modeOf(["--reset"]) === "reset");
{
  let threw = false;
  try {
    modeOf(["--now", "--reset"]);
  } catch {
    threw = true;
  }
  assert("  └ 둘을 같이 주면 아무것도 안 함", threw, "지우라는 것인지 올리라는 것인지 모르는 채로 지우면 되돌릴 수 없다");
}

// ── 2. 등록 (예전 그대로) ──────────────────────────────────
console.log("\n=== 2. 등록 ===");
{
  const rest = fakeRest();
  await deploy(rest, "deploy", { clientId: APP, guildId: undefined, body });
  assert("서버가 안 정해졌으면 글로벌로", rest.puts.length === 1 && rest.puts[0].route === GLOBAL, JSON.stringify(rest.puts));

  const one = fakeRest();
  await deploy(one, "deploy", { clientId: APP, guildId: G1, body });
  assert("정해졌으면 그 서버로", one.puts.length === 1 && one.puts[0].route === inGuild(G1), JSON.stringify(one.puts));
}

// ── 3. 즉시 등록 ───────────────────────────────────────────
//
// 서버마다 올리면 바로 보인다. 글로벌에 남은 것은 비운다 — 안 그러면 두 번 보인다.
console.log("\n=== 3. 즉시 등록 ===");
{
  const rest = fakeRest({
    guilds: [{ id: G1, name: "하나" }, { id: G2, name: "둘" }],
    registered: { [GLOBAL]: [{ name: "옛것" }] },
  });
  const log = await deploy(rest, "now", { clientId: APP, guildId: undefined, body });

  assert("봇이 있는 서버마다 올림", rest.store.get(inGuild(G1))?.length === 3 && rest.store.get(inGuild(G2))?.length === 3);
  assert("  └ 글로벌에 남은 것은 비움", rest.store.get(GLOBAL)?.length === 0, "남겨 두면 같은 커맨드가 두 번 보인다");
  assert("  └ 비웠다고 알림", log.some((line) => line.includes("남아 있던 1개는 지움")), log.join(" / "));

  const clean = fakeRest({ guilds: [{ id: G1, name: "하나" }] });
  await deploy(clean, "now", { clientId: APP, guildId: undefined, body });
  assert("글로벌이 이미 비었으면 손대지 않음", !clean.puts.some((put) => put.route === GLOBAL));

  const only = fakeRest({ guilds: [{ id: G1, name: "하나" }, { id: G2, name: "둘" }] });
  await deploy(only, "now", { clientId: APP, guildId: G2, body });
  assert("시험 서버가 정해졌으면 거기만", only.puts.every((put) => put.route !== inGuild(G1)) && only.store.get(inGuild(G2))?.length === 3);

  const none = fakeRest();
  const empty = await deploy(none, "now", { clientId: APP, guildId: undefined, body });
  assert("들어간 서버가 없으면 아무것도 안 함", none.puts.length === 0 && empty[0].includes("없습니다"), empty.join(" / "));
}

// ── 4. 초기화 ──────────────────────────────────────────────
console.log("\n=== 4. 초기화 ===");
{
  const rest = fakeRest({
    guilds: [{ id: G1, name: "하나" }, { id: G2, name: "둘" }],
    registered: {
      [GLOBAL]: [{ name: "가" }, { name: "나" }],
      [inGuild(G1)]: [{ name: "가" }],
      [inGuild(G2)]: [],
    },
  });
  const log = await deploy(rest, "reset", { clientId: APP, guildId: undefined, body: [] });

  assert("글로벌을 비움", rest.store.get(GLOBAL)?.length === 0);
  assert("  └ 서버마다도", rest.store.get(inGuild(G1))?.length === 0 && rest.store.get(inGuild(G2))?.length === 0);
  assert("  └ 몇 개를 지웠는지 알림", log.some((line) => line.includes("글로벌 — 2개 지움")) && log.some((line) => line.includes("서버 하나 — 1개 지움")), log.join(" / "));
  assert("  └ 아무것도 새로 올리지 않음", rest.puts.every((put) => put.count === 0), JSON.stringify(rest.puts));
}

// ── 5. 서버가 많아도 ───────────────────────────────────────
console.log("\n=== 5. 서버가 많아도 ===");
{
  const many = Array.from({ length: 450 }, (_, i) => ({ id: String(300000000000000000n + BigInt(i)), name: `서버${i}` }));
  const found = await guildsOf(fakeRest({ guilds: many }), undefined);
  assert("200개씩 이어서 다 받아 옴", found.length === 450, String(found.length));
}

// ── 6. 실행기 ──────────────────────────────────────────────
console.log("\n=== 6. 실행기와 npm ===");
{
  const pkg = JSON.parse(read("package.json"));
  assert("npm run deploy:now", pkg.scripts["deploy:now"]?.includes("--now"));
  assert("npm run deploy:reset", pkg.scripts["deploy:reset"]?.includes("--reset"));

  const bat = read("run.bat");
  assert("run.bat 메뉴에 즉시 등록", bat.includes("goto deploy_now") && bat.includes("deploy-commands.js --now"));
  assert("  └ 초기화도", bat.includes("goto deploy_reset") && bat.includes("deploy-commands.js --reset"));
  assert(
    "  └ 초기화는 한 번 묻고",
    bat.indexOf('if /i not "%SURE%"=="Y"') > 0 && bat.indexOf('if /i not "%SURE%"=="Y"') < bat.indexOf("deploy-commands.js --reset"),
    "되돌릴 수 없다",
  );
}

finish();
