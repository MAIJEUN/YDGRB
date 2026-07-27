import { AuditLogEvent, Events, PermissionFlagsBits } from "discord.js";
import type { Guild } from "discord.js";

import { logger } from "../logger.js";
import { announceRelease } from "../timeout/scheduler.js";
import { defineEvent } from "../types.js";

/**
 * 타임아웃이 **중간에 풀리는** 것을 잡는다.
 *
 * 기간이 다 되어 저절로 풀릴 때는 디스코드가 아무 이벤트도 보내지 않는다 (그건 스케줄러가 맡는다).
 * 여기로 오는 건 사람이 직접 푼 경우 — `/타임아웃` 으로 풀었든, 디스코드 화면에서 풀었든.
 */

/** 방금 타임아웃을 푼 사람. 감사 로그에서 찾는다. 못 찾으면 null. */
async function whoReleased(guild: Guild, userId: string): Promise<string | null> {
  const me = guild.members.me;
  if (me === null || !me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;

  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 5 });

    const entry = logs.entries.find(
      (candidate) =>
        candidate.target?.id === userId &&
        candidate.changes.some((change) => change.key === "communication_disabled_until") &&
        // 방금 것만 본다 — 오래된 기록을 집어 오면 엉뚱한 사람이 적힌다.
        Date.now() - candidate.createdTimestamp < 10_000,
    );

    return entry?.executor?.id ?? null;
  } catch (error) {
    logger.debug("감사 로그 조회 실패 (타임아웃 해제자)", error);
    return null;
  }
}

export default defineEvent({
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    const before = oldMember.communicationDisabledUntilTimestamp ?? null;
    const after = newMember.communicationDisabledUntilTimestamp ?? null;
    if (before === after) return;

    // 지난 시각은 걸려 있지 않은 것과 같다.
    const now = Date.now();
    const wasActive = before !== null && before > now;
    const isActive = after !== null && after > now;

    // 새로 걸리거나 기간이 바뀐 건 명령 쪽에서 이미 알렸다. 풀린 것만 다룬다.
    if (!wasActive || isActive) return;

    const releasedBy = await whoReleased(newMember.guild, newMember.id);

    // 봇이 푼 것 = `/타임아웃` 으로 푼 것이다. 그 명령이 **푼 사람을 정확히 알고**
    // 이미 알렸으므로 여기서는 넘어간다. 감사 로그만 보면 실행자가 봇이라
    // 여기서 알리면 "봇이 풀었다" 로 잘못 나간다.
    if (releasedBy === newMember.client.user?.id) return;

    await announceRelease(newMember.client, newMember.guild.id, newMember.id, releasedBy);
  },
});
