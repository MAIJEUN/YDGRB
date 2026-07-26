import type { Guild, GuildMember } from "discord.js";

/**
 * 한 칸에 여러 명을 적을 수 있게 해석한다.
 *
 * 슬래시 커맨드에는 여러 명을 고르는 옵션 자체가 없어서 문자열로 받고 여기서 푼다.
 * 받는 형태 — 섞어 써도 된다.
 *
 *   `@마이즌 @아무개`              멘션 (붙여넣기)
 *   `750400239625568306`           ID
 *   `마이즌, 아무개`                이름 — **쉼표로 구분** (이름에 공백이 있을 수 있어서)
 *
 * 자동완성으로 고르면 이름이 쉼표로 이어 붙는다.
 */

const MENTION = /<@!?(\d{17,20})>/gu;
const RAW_ID = /\b\d{17,20}\b/gu;

export interface ResolvedTargets {
  /** 찾아낸 사람들 (중복 제거). */
  readonly ids: string[];
  /** 누구인지 못 찾은 조각. 비어 있지 않으면 실행하지 않는다. */
  readonly unresolved: string[];
}

function namesOf(member: GuildMember): string[] {
  return [member.user.username, member.user.globalName, member.displayName, member.nickname]
    .filter((name): name is string => typeof name === "string" && name !== "")
    .map((name) => name.toLowerCase());
}

/**
 * 캐시에 있는 멤버 중에서 찾는다. 정확히 같은 이름을 먼저, 그다음 부분 일치.
 *
 * 게이트웨이 검색(`fetch({ query })`)은 요청 제한이 빡빡해서 쓰지 않는다.
 * 캐시에 없는 사람은 멘션이나 ID 로 적으면 된다.
 */
export function searchMembers(guild: Guild, query: string, limit: number): GuildMember[] {
  const needle = query.trim().toLowerCase();
  const members = [...guild.members.cache.values()].filter((member) => !member.user.bot);

  if (needle === "") return members.slice(0, limit);

  const exact: GuildMember[] = [];
  const partial: GuildMember[] = [];

  for (const member of members) {
    const names = namesOf(member);
    if (names.includes(needle)) exact.push(member);
    else if (names.some((name) => name.includes(needle))) partial.push(member);
  }

  return [...exact, ...partial].slice(0, limit);
}

/** 이름 하나를 사람 하나로. 여럿이 걸리면 고르지 않는다 — 엉뚱한 사람을 바꾸는 것보다 낫다. */
function resolveName(guild: Guild, name: string): string | undefined {
  const found = searchMembers(guild, name, 2);
  return found.length === 1 ? found[0]?.id : undefined;
}

export function resolveTargets(guild: Guild, raw: string): ResolvedTargets {
  const ids: string[] = [];

  // 멘션과 ID 를 먼저 걷어낸다. 남는 건 이름뿐이다.
  let rest = raw.replace(MENTION, (_, id: string) => {
    ids.push(id);
    return ",";
  });

  rest = rest.replace(RAW_ID, (id) => {
    ids.push(id);
    return ",";
  });

  const unresolved: string[] = [];

  for (const piece of rest.split(",")) {
    const name = piece.trim().replace(/^@/u, "").trim();
    if (name === "") continue;

    const id = resolveName(guild, name);
    if (id === undefined) unresolved.push(name);
    else ids.push(id);
  }

  return { ids: [...new Set(ids)], unresolved };
}
