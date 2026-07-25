import "./env.js";

export interface Config {
  readonly token: string;
  readonly clientId: string;
  /** 값이 있으면 이 서버에만 커맨드를 등록한다(반영 즉시). 없으면 글로벌 등록. */
  readonly guildId: string | undefined;
}

/** 디스코드 ID(스노플레이크)는 17~20자리 숫자다. */
const SNOWFLAKE = /^\d{17,20}$/;

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function readRequired(name: string): string {
  const value = read(name);
  if (value === undefined) {
    throw new Error(
      `환경변수 ${name} 가 비어 있습니다. .env.example 을 .env 로 복사한 뒤 값을 채워주세요.`,
    );
  }
  return value;
}

function assertSnowflake(name: string, value: string): string {
  if (!SNOWFLAKE.test(value)) {
    throw new Error(`환경변수 ${name} 의 형식이 올바르지 않습니다(17~20자리 숫자 ID): ${value}`);
  }
  return value;
}

function readOptionalSnowflake(name: string): string | undefined {
  const value = read(name);
  return value === undefined ? undefined : assertSnowflake(name, value);
}

let cached: Config | undefined;

/** .env 를 읽어 검증한 설정을 돌려준다. 값이 잘못되면 Error 를 던진다. */
export function loadConfig(): Config {
  cached ??= {
    token: readRequired("DISCORD_TOKEN"),
    clientId: assertSnowflake("DISCORD_CLIENT_ID", readRequired("DISCORD_CLIENT_ID")),
    guildId: readOptionalSnowflake("DISCORD_GUILD_ID"),
  };
  return cached;
}
