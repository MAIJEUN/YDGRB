import { PermissionFlagsBits } from "discord.js";
import type { Guild, Role } from "discord.js";

import { logger } from "../logger.js";
import { ROLE_NAME } from "./ids.js";
import { getRoleId, setRoleId } from "./store.js";

/**
 * 채팅을 막는 역할을 준비한다.
 *
 * **역할에서 「메시지 보내기」를 빼는 것만으로는 아무것도 막히지 않는다.** 서버 권한은
 * 가진 역할끼리 더해지므로, `@everyone` 이 허용하는 동안에는 그대로 채팅할 수 있다
 * (`/채팅뻥` 에서 같은 문제를 겪었다).
 *
 * 그래서 역할을 만든 뒤 **모든 채널에 그 역할의 「메시지 보내기」 차단**을 걸어 둔다.
 * 차단은 역할 권한을 이기므로 이때부터 역할을 붙이면 실제로 입이 막힌다.
 */

/** 역할을 만들고, 채널마다 차단을 걸어 둔다. 이미 있으면 빠진 채널만 채운다. */
export async function ensureMuteRole(guild: Guild): Promise<Role> {
  const role = (await findExisting(guild)) ?? (await create(guild));
  await denyEverywhere(guild, role);
  return role;
}

async function findExisting(guild: Guild): Promise<Role | null> {
  const stored = await getRoleId(guild.id);
  if (stored === null) return null;

  const role = await guild.roles.fetch(stored).catch(() => null);
  if (role === null) {
    // 누가 지웠다 — 기억을 비우고 새로 만든다.
    await setRoleId(guild.id, null);
  }

  return role;
}

async function create(guild: Guild): Promise<Role> {
  const role = await guild.roles.create({
    name: ROLE_NAME,
    // 권한은 하나도 주지 않는다. 막는 일은 채널 차단이 한다.
    permissions: [],
    mentionable: false,
    reason: "타살버 — 채팅을 막는 역할",
  });

  await setRoleId(guild.id, role.id);
  logger.info(`타살버: 역할을 만들었습니다 (${guild.name})`);

  return role;
}

/**
 * 모든 채널에 이 역할의 「메시지 보내기」 차단을 건다.
 *
 * 이미 걸려 있는 채널은 건너뛰므로, 두 번째부터는 요청이 거의 나가지 않는다.
 * 스레드는 부모 채널의 권한을 물려받으니 건드리지 않는다.
 */
async function denyEverywhere(guild: Guild, role: Role): Promise<void> {
  const me = guild.members.me;
  if (me === null) return;

  for (const channel of guild.channels.cache.values()) {
    if (channel.isThread()) continue;
    if (!channel.permissionsFor(me).has(PermissionFlagsBits.ManageRoles)) continue;

    const already = channel.permissionOverwrites.cache
      .get(role.id)
      ?.deny.has(PermissionFlagsBits.SendMessages);
    if (already === true) continue;

    try {
      await channel.permissionOverwrites.edit(
        role,
        { SendMessages: false },
        { reason: "타살버 — 채팅 차단" },
      );
    } catch (error) {
      // 한 채널쯤 못 걸어도 나머지는 막힌다. 로그만 남긴다.
      logger.debug(`타살버: #${channel.name} 차단 실패`, error);
    }
  }
}
