import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * `data/` 안의 저장 파일을 들여다본다.
 *
 * 봇을 옮기거나 실행 위치를 잘못 잡으면 「기록이 사라졌다」 로 보인다. 실제로는
 * 다른 폴더의 빈 파일을 보고 있는 것이다. 그래서 **절대 경로와 수정 시각**을 같이 낸다.
 */

interface Shape {
  readonly name: string;
  readonly file: string;
  /** 서버 한 칸에 무엇이 몇 개 들었는지 한 줄로. */
  readonly describe: (guild: Record<string, unknown>) => string;
}

function size(value: unknown): number {
  return typeof value === "object" && value !== null ? Object.keys(value).length : 0;
}

const SHAPES: readonly Shape[] = [
  {
    name: "소원권",
    file: "wishes.json",
    describe: (guild) => `잔고 ${size(guild["balances"])} · 소원 ${size(guild["wishes"])}`,
  },
  {
    name: "별명",
    file: "nicknames.json",
    describe: (guild) => `전원 ${guild["all"] === null ? 0 : 1} · 개별 ${size(guild["members"])}`,
  },
  { name: "타임아웃", file: "timeouts.json", describe: (guild) => `${size(guild)}명` },
  { name: "타살버", file: "tasalbeo.json", describe: (guild) => `${size(guild["targets"])}명` },
  {
    name: "출헉",
    file: "attendance.json",
    describe: (guild) =>
      `기록 ${size(guild["records"])}명 · 오늘 ${guild["today"] === null ? "없음" : "있음"}`,
  },
  {
    name: "디버그 허용",
    file: "debug.json",
    describe: (guild) =>
      `${Array.isArray(guild["allowed"]) ? guild["allowed"].length : 0}명`,
  },
];

export interface DataFile {
  readonly name: string;
  readonly path: string;
  readonly exists: boolean;
  readonly bytes: number;
  readonly modifiedAt: Date | null;
  /** 서버 수. 파일을 못 읽었으면 null. */
  readonly guilds: number | null;
  /** 서버별 요약. 너무 길어지지 않게 호출부에서 자른다. */
  readonly entries: readonly string[];
  /** JSON 이 깨졌을 때의 사유. */
  readonly problem: string | null;
}

async function inspect(shape: Shape): Promise<DataFile> {
  const filePath = path.resolve(process.cwd(), "data", shape.file);

  const base = {
    name: shape.name,
    path: filePath,
    exists: false,
    bytes: 0,
    modifiedAt: null,
    guilds: null,
    entries: [],
    problem: null,
  } satisfies DataFile;

  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    // 아직 아무도 안 썼으면 파일이 없다. 그건 문제가 아니다.
    return base;
  }

  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    const guilds = (parsed as { guilds?: Record<string, Record<string, unknown>> }).guilds ?? {};

    return {
      ...base,
      exists: true,
      bytes: stats.size,
      modifiedAt: stats.mtime,
      guilds: Object.keys(guilds).length,
      entries: Object.entries(guilds).map(([guildId, guild]) => `${guildId} — ${shape.describe(guild)}`),
    };
  } catch (error) {
    // 깨진 JSON 은 조용히 지나가면 안 된다. 저장소가 그걸 덮어쓰지 않고 던지기 때문이다.
    return {
      ...base,
      exists: true,
      bytes: stats.size,
      modifiedAt: stats.mtime,
      problem: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function dataFiles(): Promise<DataFile[]> {
  return Promise.all(SHAPES.map(inspect));
}
