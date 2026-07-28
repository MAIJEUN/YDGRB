import { readFile } from "node:fs/promises";
import { monitorEventLoopDelay } from "node:perf_hooks";
import path from "node:path";

import { version as discordVersion } from "discord.js";

/**
 * 프로세스 자체를 들여다보는 계측.
 *
 * 봇이 「느려요」 라는 말을 들었을 때 어디가 느린지 가르는 데 필요한 것들이다 —
 * 게이트웨이가 느린 것(핑)과 이벤트 루프가 막힌 것(지연)과 메모리가 새는 것은 전부 다르다.
 */

/** 이 모듈이 불려 오는 순간이 곧 부팅 시각이다. */
export const BOOTED_AT = new Date();

/**
 * 이벤트 루프가 얼마나 밀리는지 재는 히스토그램.
 *
 * `process.uptime()` 이나 setTimeout 지연으로 어림하는 것과 달리, 커널 타이머로
 * 실제 지연을 계속 모아 준다. 켜 두는 비용은 사실상 없다.
 */
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

export interface LoopLag {
  /** 밀리초. */
  readonly mean: number;
  readonly max: number;
  readonly p99: number;
}

export function loopLag(): LoopLag {
  const ms = (nanoseconds: number): number => Math.round((nanoseconds / 1e6) * 100) / 100;

  return {
    mean: ms(loopDelay.mean),
    max: ms(loopDelay.max),
    p99: ms(loopDelay.percentile(99)),
  };
}

export interface Memory {
  readonly rss: number;
  readonly heapUsed: number;
  readonly heapTotal: number;
  readonly external: number;
  readonly arrayBuffers: number;
}

export function memory(): Memory {
  const usage = process.memoryUsage();

  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  };
}

/** `12.3MB` — 자릿수를 맞춰 눈으로 비교하기 쉽게. */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"] as const;

  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${unit === 0 ? value : value.toFixed(1)}${units[unit] ?? "B"}`;
}

/**
 * 켜진 뒤 지금까지 CPU 를 얼마나 썼는지 — 벽시계 대비 백분율.
 *
 * 순간값이 아니라 **누적 평균**이다. 100% 를 넘을 수 있다 (코어를 여러 개 쓰면).
 */
export function cpuPercent(): number {
  const { user, system } = process.cpuUsage();
  const elapsedMicroseconds = process.uptime() * 1e6;
  if (elapsedMicroseconds <= 0) return 0;

  return Math.round(((user + system) / elapsedMicroseconds) * 1000) / 10;
}

/**
 * 릴리스 zip 에 들어 있는 버전 표식. 소스에서 바로 돌리면 없다.
 *
 * run.bat 이 업데이트 여부를 판단하는 것과 같은 파일이라, 여기 찍힌 값이
 * 곧 「실행기가 최신이라고 믿는 버전」이다.
 */
export async function botVersion(): Promise<string | null> {
  try {
    const raw = (await readFile(path.resolve(process.cwd(), "VERSION"), "utf8")).trim();
    return raw === "" ? null : raw;
  } catch {
    return null;
  }
}

export interface Versions {
  readonly node: string;
  readonly discord: string;
  readonly bot: string | null;
  readonly platform: string;
  readonly arch: string;
  readonly pid: number;
  readonly cwd: string;
}

export async function versions(): Promise<Versions> {
  return {
    node: process.versions.node,
    discord: discordVersion,
    bot: await botVersion(),
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    cwd: process.cwd(),
  };
}
