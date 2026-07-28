import path from "node:path";

import { JsonFile } from "../storage/json-file.js";

/**
 * 출헉 기록. **서버별로** 따로 센다 (소원권과 같다).
 *
 * 날짜는 한국 날짜 문자열(`2026-07-27`)로 다룬다 — 하루에 한 번이라는 규칙도,
 * 연속 며칠째인지도 "며칠인가" 로만 판단하면 되고, 시각까지 볼 필요가 없다.
 */

export interface AttendanceRecord {
  userId: string;
  /** 누적 출헉 일수. 소원권 조각은 이 수를 기준으로 준다. */
  total: number;
  /** 연속 일수. 하루라도 빠지면 1 부터 다시 센다. */
  streak: number;
  /** 마지막으로 출헉한 날 (`2026-07-27`). */
  lastDate: string;
}

/** 오늘 올라와 있는 출헉. */
export interface TodayCheck {
  date: string;
  /** 받아 적어야 하는 글자. 이미지로만 보여 준다. */
  text: string;
  /** 출헉을 올린 사람. */
  by: string;
  channelId: string;
  messageId: string | null;
}

interface GuildAttendance {
  today: TodayCheck | null;
  records: Record<string, AttendanceRecord>;
}

interface AttendanceData {
  guilds: Record<string, GuildAttendance>;
}

const file = new JsonFile<AttendanceData>(
  path.resolve(process.cwd(), "data", "attendance.json"),
  () => ({ guilds: {} }),
);

function guildOf(data: AttendanceData, guildId: string): GuildAttendance {
  data.guilds[guildId] ??= { today: null, records: {} };
  return data.guilds[guildId];
}

// ─────────────────────────────────────────────────────────────
// 날짜 — 한국 기준
// ─────────────────────────────────────────────────────────────

/** `2026-07-27` 형태의 한국 날짜. 서버가 어느 시간대에 있든 같은 값이 나온다. */
export function dateKey(at: Date = new Date()): string {
  // en-CA 는 YYYY-MM-DD 로 내준다.
  return at.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** 어제 날짜. 연속인지 판단할 때 쓴다. */
export function previousDateKey(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  // UTC 로 만들어 계산해야 서머타임 같은 것에 흔들리지 않는다.
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() - 1);

  return date.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────
// 오늘의 출헉
// ─────────────────────────────────────────────────────────────

/** 오늘 올라온 출헉. 날짜가 지났으면 없는 것으로 본다. */
export async function getToday(guildId: string): Promise<TodayCheck | null> {
  const today = (await file.read()).guilds[guildId]?.today ?? null;
  return today !== null && today.date === dateKey() ? today : null;
}

export async function setToday(guildId: string, today: TodayCheck): Promise<void> {
  await file.update((data) => {
    guildOf(data, guildId).today = today;
  });
}

/** 메시지를 보낸 뒤 id 를 붙여 둔다. */
export async function attachMessage(guildId: string, messageId: string): Promise<void> {
  await file.update((data) => {
    const guild = guildOf(data, guildId);
    if (guild.today !== null) guild.today.messageId = messageId;
  });
}

/** 출헉을 올리지 못했을 때 되돌린다. */
export async function clearToday(guildId: string): Promise<void> {
  await file.update((data) => {
    guildOf(data, guildId).today = null;
  });
}

// ─────────────────────────────────────────────────────────────
// 출헉 기록
// ─────────────────────────────────────────────────────────────

export type CheckInResult =
  | { readonly ok: false; readonly reason: "already" }
  | { readonly ok: true; readonly record: AttendanceRecord; readonly rewarded: boolean };

/**
 * 출헉을 기록한다. 이미 오늘 했으면 아무것도 바꾸지 않는다.
 *
 * 읽고-고치고-쓰기를 한 번의 `update` 안에서 하므로, 버튼을 연타해도 두 번 세지 않는다.
 */
export async function checkIn(
  guildId: string,
  userId: string,
  rewardEvery: number,
): Promise<CheckInResult> {
  return file.update((data) => {
    const guild = guildOf(data, guildId);
    const today = dateKey();
    const previous = guild.records[userId];

    if (previous?.lastDate === today) return { ok: false, reason: "already" } as const;

    const record: AttendanceRecord = {
      userId,
      total: (previous?.total ?? 0) + 1,
      // 어제 했으면 이어서, 아니면 처음부터.
      streak: previous?.lastDate === previousDateKey(today) ? previous.streak + 1 : 1,
      lastDate: today,
    };

    guild.records[userId] = record;

    return { ok: true, record, rewarded: record.total % rewardEvery === 0 } as const;
  });
}

export async function getRecord(
  guildId: string,
  userId: string,
): Promise<AttendanceRecord | undefined> {
  return (await file.read()).guilds[guildId]?.records[userId];
}

/** 가장 많이 출헉한 사람. 같으면 먼저 그 수에 도달한 순서를 알 수 없으므로 id 순으로 고른다. */
export async function topAttender(guildId: string): Promise<AttendanceRecord | null> {
  const records = Object.values((await file.read()).guilds[guildId]?.records ?? {});
  if (records.length === 0) return null;

  return records.reduce((best, candidate) =>
    candidate.total > best.total || (candidate.total === best.total && candidate.userId < best.userId)
      ? candidate
      : best,
  );
}
