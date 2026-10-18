import { Routes } from "discord.js";
import type { REST, RESTGetAPICurrentUserGuildsResult, RESTPostAPIApplicationCommandsJSONBody } from "discord.js";

/**
 * 슬래시 커맨드를 올리고 지우는 일 — [deploy-commands.ts](../deploy-commands.ts) 가 부른다.
 *
 *   등록       DISCORD_GUILD_ID 가 있으면 그 서버에, 없으면 글로벌로
 *   즉시 등록   봇이 들어가 있는 **서버마다** 올려 바로 보이게 하고, 글로벌 쪽은 비운다
 *   초기화     글로벌과 서버마다 등록된 것을 **전부 지운다**
 *
 * **글로벌과 서버 등록은 따로 쌓인다.** 둘 다 해 두면 그 서버에서는 같은 커맨드가 두 번
 * 보인다. 그래서 「즉시 등록」 은 서버마다 올리면서 글로벌 쪽을 비운다. 이미 겹쳐 버렸으면
 * 「초기화」 로 다 지우고 하나만 다시 올리면 된다.
 *
 * 화면에 찍는 것은 부르는 쪽이 한다. 여기는 무엇을 했는지 줄로 돌려준다 — 그래야 검사가
 * 가짜 REST 를 물려 무엇을 지우고 올렸는지 볼 수 있다.
 */

export type Mode = "deploy" | "now" | "reset";

/**
 * 무엇을 할지. 둘을 같이 주면 **아무것도 하지 않는다** — 지우라는 것인지 올리라는 것인지
 * 모르는 채로 지우는 쪽을 고르면 되돌릴 수 없다.
 */
export function modeOf(argv: readonly string[]): Mode {
  const reset = argv.includes("--reset");
  const now = argv.includes("--now");

  if (reset && now) throw new Error("--now 와 --reset 은 함께 쓸 수 없습니다. 하나만 주세요.");
  if (reset) return "reset";
  if (now) return "now";
  return "deploy";
}

export interface DeployOptions {
  readonly clientId: string;
  readonly guildId: string | undefined;
  /** 올릴 것. 초기화에서는 쓰지 않는다. */
  readonly body: readonly RESTPostAPIApplicationCommandsJSONBody[];
}

type Rest = Pick<REST, "get" | "put">;

/** 한 번에 받는 서버 수. 디스코드가 정한 최대치다. */
const GUILDS_PER_PAGE = 200;

/**
 * 손댈 서버들.
 *
 * DISCORD_GUILD_ID 가 있으면 그 서버 하나만 — 시험 서버를 따로 두고 쓰는 경우다.
 * 없으면 **봇이 들어가 있는 서버 전부**를 디스코드에 물어 온다 (게이트웨이에 붙지 않고
 * REST 로만 묻는다 — 봇이 켜져 있지 않아도 된다).
 */
export async function guildsOf(rest: Rest, guildId: string | undefined): Promise<{ id: string; name: string }[]> {
  if (guildId !== undefined) return [{ id: guildId, name: guildId }];

  const found: { id: string; name: string }[] = [];
  let after: string | undefined;

  for (;;) {
    const query = new URLSearchParams({
      limit: String(GUILDS_PER_PAGE),
      ...(after === undefined ? {} : { after }),
    });
    const page = (await rest.get(Routes.userGuilds(), { query })) as RESTGetAPICurrentUserGuildsResult;

    found.push(...page.map((guild) => ({ id: guild.id, name: guild.name })));
    if (page.length < GUILDS_PER_PAGE) break;
    after = page.at(-1)?.id;
  }

  return found;
}

/** 그 자리에 등록된 커맨드 수. 지우기 전에 몇 개였는지 알려 주려고 센다. */
async function countAt(rest: Rest, route: `/${string}`): Promise<number> {
  return ((await rest.get(route)) as unknown[]).length;
}

export async function deploy(rest: Rest, mode: Mode, options: DeployOptions): Promise<string[]> {
  const log: string[] = [];
  const global = Routes.applicationCommands(options.clientId);
  const inGuild = (id: string): `/${string}` => Routes.applicationGuildCommands(options.clientId, id);

  // ── 초기화 ───────────────────────────────────────────────
  if (mode === "reset") {
    const before = await countAt(rest, global);
    await rest.put(global, { body: [] });
    log.push(`글로벌 — ${before}개 지움`);

    for (const guild of await guildsOf(rest, options.guildId)) {
      const count = await countAt(rest, inGuild(guild.id));
      await rest.put(inGuild(guild.id), { body: [] });
      log.push(`서버 ${guild.name} — ${count}개 지움`);
    }

    log.push("초기화 끝 — 다시 쓰려면 등록이나 즉시 등록을 하세요.");
    return log;
  }

  // ── 즉시 등록 ────────────────────────────────────────────
  if (mode === "now") {
    const guilds = await guildsOf(rest, options.guildId);
    if (guilds.length === 0) {
      log.push("봇이 들어가 있는 서버가 없습니다.");
      return log;
    }

    for (const guild of guilds) {
      const result = (await rest.put(inGuild(guild.id), { body: options.body })) as unknown[];
      log.push(`서버 ${guild.name} — ${result.length}개 등록`);
    }

    // 서버마다 올렸으니 글로벌 쪽은 비운다. 남겨 두면 같은 커맨드가 두 번 보인다.
    const leftover = await countAt(rest, global);
    if (leftover > 0) {
      await rest.put(global, { body: [] });
      log.push(`글로벌에 남아 있던 ${leftover}개는 지움 (두 번 보이지 않게)`);
    }

    log.push(`즉시 등록 끝 — 서버 ${guilds.length}곳, 커맨드 ${options.body.length}개`);
    return log;
  }

  // ── 등록 (예전 그대로) ───────────────────────────────────
  const route = options.guildId === undefined ? global : inGuild(options.guildId);
  const result = (await rest.put(route, { body: options.body })) as unknown[];
  const target = options.guildId === undefined ? "글로벌" : `길드 ${options.guildId}`;

  log.push(`커맨드 ${result.length}개 등록 완료 (${target})`);
  return log;
}
