import path from "node:path";

import { ChannelType, IntentsBitField, Status as GatewayStatus } from "discord.js";
import type { Guild, Message, User } from "discord.js";

import { getRecord } from "../attendance/store.js";
import { LEVEL_LABEL, atLeast } from "./access.js";
import type { Level } from "./access.js";
import { allow, allowedIds, disallow } from "./store.js";
import { channelCounts, count } from "../info/format.js";
import { registeredEvents } from "../loaders/events.js";
import { LOG_LEVELS, isLogLevel, logLevel, recentLogs, setLogLevel } from "../logger.js";
import { MODE_LABEL } from "../nickname/ids.js";
import { getState as nicknameState } from "../nickname/store.js";
import { getState as tasalbeoState } from "../tasalbeo/store.js";
import {
  at,
  atWithCountdown,
  clock,
  countdown,
  describeDurationError,
  formatDuration,
  parseDuration,
} from "../time.js";
import { getState as timeoutState } from "../timeout/store.js";
import type { MessageOptions } from "../ui/response.js";
import { getBalance } from "../wish/store.js";
import { PREFIX } from "./ids.js";
import { createdAt, parseId, resolveId } from "./inspect.js";
import {
  BOOTED_AT,
  botVersion,
  cpuPercent,
  formatBytes,
  loopLag,
  memory,
  versions,
} from "./runtime.js";
import type { DataFile } from "./storage.js";
import { dataFiles } from "./storage.js";
import { allReservations, runningJobs, runningLoops } from "./timers.js";
import { speak } from "../ui/tone.js";
import {
  card,
  chips,
  confirmRow,
  field,
  lines,
  permissionTable,
  refreshButton,
  sampleRow,
  yesNo,
} from "./views.js";

/**
 * `!y` 로 부르는 것들.
 *
 * 하나하나가 「봇이 지금 어떤 상태인지」의 한 면이다. 화면을 만드는 일만 하고,
 * 상태를 바꾸는 것은 로그 기준·재시작·종료 셋뿐이다 — 나머지는 읽기만 한다.
 */

export interface DebugContext {
  readonly message: Message<true>;
  /** 서브커맨드 뒤에 붙은 것들. */
  readonly args: readonly string[];
  readonly user: User;
  /** 이 사람이 어느 등급인지. 화면 내용도 여기에 따라 달라진다. */
  readonly level: Level;
}

export interface DebugCommand {
  readonly name: string;
  readonly aliases: readonly string[];
  /** 도움말에 그대로 찍히는 사용법. */
  readonly usage: string;
  readonly summary: string;
  /** 쓰려면 최소 이 등급이어야 한다. 안 적으면 셋 다 쓸 수 있다. */
  readonly level?: Level;
  run(context: DebugContext): Promise<MessageOptions | readonly MessageOptions[]>;
}

/** 이 사람이 쓸 수 있는 항목인지. */
export function canUse(command: DebugCommand, level: Level): boolean {
  return atLeast(level, command.level ?? "guest");
}

/**
 * 도움말 한 줄. 자기 등급으로 못 쓰는 것은 그렇다고 적어 준다 —
 * 목록에서 아예 빼면 「왜 안 되지」 하고 헤매게 된다.
 */
function helpLines(level: Level): string {
  return COMMANDS.map((command) => {
    const locked = canUse(command, level) ? "" : ` _(${LEVEL_LABEL[command.level ?? "guest"]} 전용)_`;
    return `\`${command.usage}\` — ${command.summary}${locked}`;
  }).join("\n");
}

/** 호스트 경로는 주인에게만. 계정 이름이 섞여 있다. */
function showPath(level: Level, full: string): string {
  return atLeast(level, "owner") ? `\`${full}\`` : `\`…${path.sep}${path.basename(full)}\``;
}

/** 목록이 길어지면 컨테이너 글자 수 한계에 걸린다. 화면마다 이만큼만. */
const MAX_ROWS = 12;
const MAX_LOG_LINES = 15;

const GATEWAY: Record<GatewayStatus, string> = {
  [GatewayStatus.Ready]: "정상",
  [GatewayStatus.Connecting]: "연결 중",
  [GatewayStatus.Reconnecting]: "다시 연결 중",
  [GatewayStatus.Idle]: "쉬는 중",
  [GatewayStatus.Nearly]: "거의 완료",
  [GatewayStatus.Disconnected]: "끊김",
  [GatewayStatus.WaitingForGuilds]: "서버 받는 중",
  [GatewayStatus.Identifying]: "인증 중",
  [GatewayStatus.Resuming]: "이어받는 중",
};

/** 특권 인텐트 — Developer Portal 에서 켜지 않으면 로그인 자체가 실패한다. */
const PRIVILEGED = new Set(["GuildMembers", "MessageContent", "GuildPresences"]);

const CHANNEL_KIND: Partial<Record<ChannelType, string>> = {
  [ChannelType.GuildText]: "텍스트",
  [ChannelType.GuildVoice]: "음성",
  [ChannelType.GuildCategory]: "카테고리",
  [ChannelType.GuildAnnouncement]: "공지",
  [ChannelType.GuildStageVoice]: "무대",
  [ChannelType.GuildForum]: "포럼",
  [ChannelType.GuildMedia]: "미디어",
  [ChannelType.PublicThread]: "공개 스레드",
  [ChannelType.PrivateThread]: "비공개 스레드",
  [ChannelType.AnnouncementThread]: "공지 스레드",
};

/** 인자를 안 줬으면 명령을 친 사람. */
function targetId(context: DebugContext): string {
  return parseId(context.args[0]) ?? context.user.id;
}

function describeDataFile(file: DataFile): string {
  if (file.problem !== null) return speak(`**JSON 이 깨졌습니다** — \`${file.problem}\``);
  if (!file.exists) return "아직 없음 _(아무도 안 썼다는 뜻)_";

  const head = `${formatBytes(file.bytes)} · 서버 **${file.guilds ?? 0}개** · 고침 ${
    file.modifiedAt === null ? "?" : countdown(file.modifiedAt)
  }`;

  return `${head}\n${lines(file.entries, 3)}`;
}

/** 이 봇이 그 사람에게 걸어 둔 것들. 화면 여러 곳에서 쓴다. */
async function effectsOf(guild: Guild, userId: string): Promise<string> {
  const [timeout, tasalbeo, nickname, everyone, attendance, balance] = await Promise.all([
    timeoutState(guild.id, userId),
    tasalbeoState(guild.id, userId),
    nicknameState(guild.id, userId),
    nicknameState(guild.id, null),
    getRecord(guild.id, userId),
    getBalance(guild.id, userId),
  ]);

  const found: string[] = [];

  if (timeout !== undefined) found.push(`타임아웃 — ${countdown(new Date(timeout.until))} 해제`);
  if (tasalbeo !== undefined) found.push(`타살버 — ${countdown(new Date(tasalbeo.until))} 해제`);

  for (const [state, label] of [
    [nickname, "뚜따이 (개별)"],
    [everyone, "뚜따이 (서버 전원)"],
  ] as const) {
    if (state === undefined) continue;
    found.push(
      state.expiresAt === null
        ? `${label} — 만료 없음`
        : `${label} — ${countdown(new Date(state.expiresAt))} 바사삭`,
    );
  }

  if (attendance !== undefined) {
    found.push(`출헉 — 누적 **${attendance.total}일** · 연속 **${attendance.streak}일**`);
  }
  found.push(`소원권 **${balance.tickets}장** · 조각 **${balance.fragments}개**`);

  return found.join("\n");
}

// ─────────────────────────────────────────────────────────────

export const COMMANDS: readonly DebugCommand[] = [
  {
    name: "도움",
    aliases: ["help", "?", ""],
    usage: `${PREFIX}`,
    summary: "이 목록",
    async run({ user, level }) {
      return card("도움", user, {
        description: speak("이름 대신 영문 별칭도 통합니다."),
        fields: [
          { name: "내 등급", value: `**${LEVEL_LABEL[level]}**` },
          { name: "할 수 있는 것", value: helpLines(level) },
        ],
      });
    },
  },

  {
    name: "상태",
    aliases: ["status", "요약"],
    usage: `${PREFIX} 상태`,
    summary: "한눈에 보는 요약",
    async run({ message, user }) {
      const { client } = message;
      const version = await botVersion();
      const used = memory();

      return card("상태", user, {
        description: `<@${client.user.id}> · \`${client.user.id}\``,
        fields: [
          {
            name: "버전",
            value: version === null ? "소스에서 실행 중 _(VERSION 파일 없음)_" : `**YDGRB${version}**`,
          },
          { name: "켜진 시각", value: atWithCountdown(BOOTED_AT) },
          {
            name: "게이트웨이",
            value: `${GATEWAY[client.ws.status] ?? "알 수 없음"} · 핑 **${Math.round(client.ws.ping)}ms** · 샤드 **${client.ws.shards.size}개**`,
          },
          {
            name: "규모",
            value: `서버 **${count(client.guilds.cache.size)}** · 채널 **${count(client.channels.cache.size)}** · 캐시된 유저 **${count(client.users.cache.size)}**`,
          },
          {
            name: "적재",
            value: `슬래시 **${client.commands.size}** · 컨텍스트 **${client.contextMenuCommands.size}** · 컴포넌트 **${client.components.size}** · 이벤트 **${registeredEvents().length}**`,
          },
          {
            name: "메모리",
            value: `RSS **${formatBytes(used.rss)}** · 힙 **${formatBytes(used.heapUsed)}** / ${formatBytes(used.heapTotal)}`,
          },
          {
            name: "돌고 있는 것",
            value: `예약 **${allReservations().length}건** · 타살버 반복 **${runningLoops().length}개** · 별명 작업 **${runningJobs().length}개**`,
          },
          { name: "로그 기준", value: `\`${logLevel()}\`` },
        ],
        accessoryButton: refreshButton("상태"),
      });
    },
  },

  {
    name: "핑",
    aliases: ["ping", "지연"],
    usage: `${PREFIX} 핑`,
    summary: "게이트웨이 · REST · 이벤트 루프 지연",
    async run({ message, user }) {
      // 진짜 REST 왕복을 잰다 — 캐시를 무시하고 다시 받아 오게 한다.
      const started = Date.now();
      await message.fetch(true);
      const rest = Date.now() - started;

      const lag = loopLag();

      return card("핑", user, {
        fields: [
          { name: "게이트웨이", value: `**${Math.round(message.client.ws.ping)}ms** _(하트비트 왕복)_` },
          { name: "REST", value: `**${rest}ms** _(이 메시지를 다시 받아오는 데 걸린 시간)_` },
          {
            name: "이벤트 루프 지연",
            value: `평균 **${lag.mean}ms** · p99 **${lag.p99}ms** · 최대 **${lag.max}ms**`,
          },
        ],
        accessoryButton: refreshButton("핑"),
      });
    },
  },

  {
    name: "런타임",
    aliases: ["runtime", "시스템"],
    usage: `${PREFIX} 런타임`,
    summary: "Node · 프로세스 · 메모리 상세",
    async run({ user, level }) {
      const info = await versions();
      const used = memory();
      const lag = loopLag();

      return card("런타임", user, {
        fields: [
          { name: "Node", value: `\`v${info.node}\` · discord.js \`v${info.discord}\`` },
          { name: "플랫폼", value: `\`${info.platform}/${info.arch}\` · PID \`${info.pid}\`` },
          { name: "실행 폴더", value: showPath(level, info.cwd) },
          { name: "켜진 시각", value: atWithCountdown(BOOTED_AT) },
          { name: "가동", value: `**${formatDuration(process.uptime())}** · CPU 평균 **${cpuPercent()}%**` },
          {
            name: "메모리",
            value: [
              `RSS **${formatBytes(used.rss)}**`,
              `힙 **${formatBytes(used.heapUsed)}** / ${formatBytes(used.heapTotal)}`,
              `외부 ${formatBytes(used.external)} · 버퍼 ${formatBytes(used.arrayBuffers)}`,
            ].join("\n"),
          },
          {
            name: "이벤트 루프 지연",
            value: `평균 **${lag.mean}ms** · p99 **${lag.p99}ms** · 최대 **${lag.max}ms**`,
          },
        ],
        accessoryButton: refreshButton("런타임"),
      });
    },
  },

  {
    name: "인텐트",
    aliases: ["intents"],
    usage: `${PREFIX} 인텐트`,
    summary: "켜져 있는 인텐트 (특권 표시)",
    async run({ message, user }) {
      const enabled = new IntentsBitField(message.client.options.intents).toArray();

      return card("인텐트", user, {
        fields: [
          {
            name: `켜짐 (${enabled.length}개)`,
            value: enabled
              .map((name) => `${PRIVILEGED.has(name) ? "🔒" : "•"} \`${name}\``)
              .join("\n"),
          },
          {
            name: "🔒 특권 인텐트",
            value:
              speak("Developer Portal > Bot > Privileged Gateway Intents 에서 켜야 합니다.\n켜지 않으면 로그인이 `Used disallowed intents` 로 실패합니다."),
          },
        ],
      });
    },
  },

  {
    name: "커맨드",
    aliases: ["commands", "명령"],
    usage: `${PREFIX} 커맨드`,
    summary: "적재된 커맨드 · 컴포넌트 · 이벤트",
    async run({ message, user }) {
      const { client } = message;

      return card("커맨드", user, {
        fields: [
          {
            name: `슬래시 (${client.commands.size}개)`,
            value: chips([...client.commands.keys()].map((name) => `/${name}`), 20),
          },
          {
            name: `컨텍스트 메뉴 (${client.contextMenuCommands.size}개)`,
            value: chips(
              [...client.contextMenuCommands.values()].map((command) => command.data.name),
              20,
            ),
          },
          {
            name: `컴포넌트 (${client.components.size}개)`,
            value: chips([...client.components.keys()], 20),
          },
          {
            name: `이벤트 (${registeredEvents().length}개)`,
            value: lines(
              registeredEvents().map(
                (event) => `\`${event.name}\`${event.once ? " _(once)_" : ""} — \`${event.file}\``,
              ),
              MAX_ROWS,
            ),
          },
        ],
      });
    },
  },

  {
    name: "캐시",
    aliases: ["cache"],
    usage: `${PREFIX} 캐시`,
    summary: "클라이언트 캐시 크기",
    async run({ message, user }) {
      const { client } = message;

      let members = 0;
      let roles = 0;
      for (const guild of client.guilds.cache.values()) {
        members += guild.members.cache.size;
        roles += guild.roles.cache.size;
      }

      let messages = 0;
      for (const channel of client.channels.cache.values()) {
        if (channel.isTextBased()) messages += channel.messages.cache.size;
      }

      return card("캐시", user, {
        description: speak("캐시는 받은 것만 들고 있는 것이라, 적다고 문제가 있는 것은 아닙니다."),
        fields: [
          {
            name: "개수",
            value: [
              `서버 **${count(client.guilds.cache.size)}**`,
              `채널 **${count(client.channels.cache.size)}**`,
              `유저 **${count(client.users.cache.size)}**`,
              `멤버 **${count(members)}**`,
              `역할 **${count(roles)}**`,
              `이모지 **${count(client.emojis.cache.size)}**`,
              `메시지 **${count(messages)}**`,
            ].join("\n"),
          },
          { name: "힙", value: `**${formatBytes(memory().heapUsed)}**` },
        ],
        accessoryButton: refreshButton("캐시"),
      });
    },
  },

  {
    name: "서버",
    aliases: ["guild", "길드"],
    usage: `${PREFIX} 서버 [서버id]`,
    summary: "서버 하나 뜯어보기 (봇 권한 포함)",
    async run({ message, user, args, level }) {
      const id = parseId(args[0]) ?? message.guild.id;

      // 다른 서버는 주인만. 이 서버의 관리자가 저 서버를 볼 이유는 없다.
      if (id !== message.guild.id && !atLeast(level, "owner")) {
        return card("서버", user, {
          status: "failure",
          description: speak("다른 서버는 봇 주인만 볼 수 있어요."),
        });
      }

      const guild = message.client.guilds.cache.get(id);

      if (guild === undefined) {
        return card("서버", user, {
          status: "failure",
          description: speak(`\`${id}\` — 이 봇이 들어가 있지 않은 서버입니다.`),
        });
      }

      const me = guild.members.me;
      const joined = me?.joinedAt ?? null;

      return card("서버", user, {
        description: `**${guild.name}** · \`${guild.id}\``,
        fields: [
          { name: "소유자", value: `<@${guild.ownerId}>` },
          { name: "만든 날", value: atWithCountdown(guild.createdAt) },
          {
            name: "규모",
            value: `멤버 **${count(guild.memberCount)}명** _(캐시 ${count(guild.members.cache.size)})_\n${channelCounts(guild)}\n역할 **${count(guild.roles.cache.size - 1)}개**`,
          },
          { name: "샤드", value: `\`${guild.shardId}\`` },
          ...field("봇 참가", joined === null ? null : atWithCountdown(joined)),
          ...field(
            "봇 최고 역할",
            me === null ? null : `${me.roles.highest.toString()} _(위치 ${me.roles.highest.position})_`,
          ),
          { name: "봇 권한 (서버 전체)", value: permissionTable(me?.permissions ?? null).table },
        ],
      });
    },
  },

  {
    name: "채널",
    aliases: ["channel"],
    usage: `${PREFIX} 채널 [채널]`,
    summary: "채널 하나 뜯어보기 (덮어쓰기 포함)",
    async run({ message, user, args }) {
      const id = parseId(args[0]) ?? message.channel.id;
      const channel = message.guild.channels.cache.get(id);

      if (channel === undefined) {
        return card("채널", user, {
          status: "failure",
          description: speak(`\`${id}\` — 이 서버에서 찾지 못했습니다.`),
        });
      }

      const me = message.guild.members.me;
      const everyone = message.guild.roles.everyone;

      // 스레드에는 덮어쓰기가 없다 — 권한은 부모 채널 것을 그대로 따른다.
      const overwrite = channel.isThread()
        ? undefined
        : channel.permissionOverwrites.cache.get(everyone.id);

      return card("채널", user, {
        description: `<#${channel.id}> · \`${channel.id}\``,
        fields: [
          { name: "종류", value: CHANNEL_KIND[channel.type] ?? `타입 ${channel.type}` },
          ...field("카테고리", channel.parentId === null ? null : `<#${channel.parentId}>`),
          ...field(
            "만든 날",
            channel.createdAt === null ? null : atWithCountdown(channel.createdAt),
          ),
          {
            name: `${everyone.toString()} 덮어쓰기`,
            value: channel.isThread()
              ? "스레드에는 없음 _(부모 채널을 따름)_"
              : overwrite === undefined
                ? "없음 _(서버 권한을 그대로 따름)_"
                : `허용 ${chips(overwrite.allow.toArray(), 8)}\n거부 ${chips(overwrite.deny.toArray(), 8)}`,
          },
          {
            name: "봇 권한 (여기)",
            value: me === null ? "확인할 수 없음" : permissionTable(channel.permissionsFor(me)).table,
          },
        ],
      });
    },
  },

  {
    name: "유저",
    aliases: ["user", "멤버", "member"],
    usage: `${PREFIX} 유저 [대상]`,
    summary: "멤버 + 이 봇이 걸어 둔 것 전부",
    async run(context) {
      const { message, user } = context;
      const id = targetId(context);
      const member = await message.guild.members.fetch(id).catch(() => null);

      if (member === null) {
        // 서버에 없어도 계정 자체는 볼 수 있다 — 나간 사람을 좇을 때 필요하다.
        const found = await message.client.users.fetch(id).catch(() => null);

        return card("유저", user, {
          status: found === null ? "failure" : "info",
          description:
            found === null
              ? speak(`\`${id}\` — 어디에서도 찾지 못했습니다.`)
              : speak(`<@${id}> · \`${id}\` — **이 서버에 없습니다.**`),
          fields:
            found === null
              ? []
              : [
                  { name: "계정 만든 날", value: atWithCountdown(found.createdAt) },
                  { name: "봇", value: yesNo(found.bot) },
                  { name: "이 봇이 걸어 둔 것", value: await effectsOf(message.guild, id) },
                ],
        });
      }

      return card("유저", user, {
        description: `<@${member.id}> · \`${member.id}\``,
        fields: [
          { name: "사용자명", value: `\`${member.user.username}\`` },
          ...field("별명", member.nickname === null ? null : `\`${member.nickname}\``),
          { name: "계정 만든 날", value: atWithCountdown(member.user.createdAt) },
          ...field("서버 참가", member.joinedAt === null ? null : atWithCountdown(member.joinedAt)),
          {
            name: `역할 (${count(Math.max(member.roles.cache.size - 1, 0))}개)`,
            value: lines(
              [...member.roles.cache.values()]
                .filter((role) => role.id !== member.guild.id)
                .sort((a, b) => b.position - a.position)
                .map((role) => role.toString()),
              MAX_ROWS,
            ),
          },
          { name: "봇", value: yesNo(member.user.bot) },
          { name: "이 봇이 걸어 둔 것", value: await effectsOf(message.guild, member.id) },
        ],
      });
    },
  },

  {
    name: "역할",
    aliases: ["role"],
    usage: `${PREFIX} 역할 [역할]`,
    summary: "역할 하나 뜯어보기",
    async run({ message, user, args }) {
      const id = parseId(args[0]);
      const role = id === null ? undefined : message.guild.roles.cache.get(id);

      if (role === undefined) {
        return card("역할", user, {
          status: "failure",
          description:
            id === null
              ? speak("역할을 멘션하거나 id 를 붙여 주세요.")
              : speak(`\`${id}\` — 이 서버에서 찾지 못했습니다.`),
        });
      }

      return card("역할", user, {
        description: `${role.toString()} · \`${role.id}\``,
        fields: [
          { name: "만든 날", value: atWithCountdown(role.createdAt) },
          {
            name: "설정",
            value: [
              `위치 **${role.position}**`,
              `색 \`${role.hexColor}\``,
              `따로 표시 ${yesNo(role.hoist)}`,
              `멘션 허용 ${yesNo(role.mentionable)}`,
              `봇·연동 전용 ${yesNo(role.managed)}`,
            ].join("\n"),
          },
          { name: "가진 사람", value: `**${count(role.members.size)}명** _(캐시된 것 기준)_` },
          { name: "권한", value: chips(role.permissions.toArray(), 14) },
        ],
      });
    },
  },

  {
    name: "권한",
    aliases: ["perms", "permissions"],
    usage: `${PREFIX} 권한`,
    summary: "여기서 봇이 가진 · 빠뜨린 권한",
    async run({ message, user }) {
      const me = message.guild.members.me;
      const here = me === null ? null : message.channel.permissionsFor(me);

      const guildWide = permissionTable(me?.permissions ?? null);
      const channelWide = permissionTable(here);

      return card("권한", user, {
        status: channelWide.missing.length === 0 ? "success" : "progress",
        description: speak(`<#${message.channel.id}> 기준입니다.`),
        fields: [
          { name: "여기", value: channelWide.table },
          {
            name: "빠진 것",
            value:
              channelWide.missing.length === 0
                ? "없음"
                : channelWide.missing.map((name) => `**${name}**`).join(" · "),
          },
          {
            name: "서버 전체와 다른 점",
            value:
              guildWide.missing.join() === channelWide.missing.join()
                ? "없음 _(채널 덮어쓰기가 영향을 주지 않음)_"
                : `서버에서는 ${guildWide.missing.length === 0 ? "다 가지고 있음" : guildWide.missing.join(" · ")}`,
          },
          {
            name: "관리자",
            value: me?.permissions.has("Administrator", false) === true ? "가지고 있음" : "없음",
          },
        ],
      });
    },
  },

  {
    name: "예약",
    aliases: ["timers", "타이머"],
    usage: `${PREFIX} 예약`,
    summary: "살아 있는 타이머 · 반복 · 진행 중 작업",
    async run({ user }) {
      const reservations = allReservations();
      const loops = runningLoops();
      const jobs = runningJobs();

      return card("예약", user, {
        description:
          speak("파일이 아니라 **지금 메모리에 떠 있는 타이머**입니다. 저장된 것과 어긋나면 그게 버그입니다."),
        fields: [
          {
            name: `예약 (${reservations.length}건)`,
            value: lines(
              reservations.map(
                (item) =>
                  `**${item.kind}** ${item.targetId === null ? (item.label ?? "_서버 전원_") : `<@${item.targetId}>`} — ${countdown(new Date(item.at))}`,
              ),
              MAX_ROWS,
            ),
          },
          {
            name: `타살버 반복 (${loops.length}개)`,
            value: lines(
              loops.map(
                (loop) => `<@${loop.userId}>${loop.failures > 0 ? ` — 연속 실패 **${loop.failures}회**` : ""}`,
              ),
              MAX_ROWS,
            ),
          },
          {
            name: `별명 작업 (${jobs.length}개)`,
            value: lines(
              jobs.map(
                (job) =>
                  `${MODE_LABEL[job.mode]} \`${job.id}\`${job.cancelled ? " — 취소 중" : ""}`,
              ),
              MAX_ROWS,
            ),
          },
        ],
        accessoryButton: refreshButton("예약"),
      });
    },
  },

  {
    name: "저장소",
    aliases: ["data", "데이터"],
    usage: `${PREFIX} 저장소`,
    summary: "data 폴더의 파일 상태",
    async run({ user, level }) {
      const files = await dataFiles();
      const broken = files.some((file) => file.problem !== null);

      return card("저장소", user, {
        status: broken ? "failure" : "info",
        description: showPath(level, path.resolve(process.cwd(), "data")),
        fields: files.map((file) => ({ name: file.name, value: describeDataFile(file) })),
        accessoryButton: refreshButton("저장소"),
      });
    },
  },

  {
    name: "로그",
    aliases: ["logs", "log"],
    usage: `${PREFIX} 로그 [줄수] [레벨]`,
    summary: "최근 기록 (콘솔에 안 찍힌 것까지)",
    async run({ user, args }) {
      const requested = Number.parseInt(args[0] ?? "", 10);
      const limit = Number.isFinite(requested)
        ? Math.min(Math.max(requested, 1), MAX_LOG_LINES)
        : MAX_LOG_LINES;

      const level = args.find((token) => isLogLevel(token.toLowerCase()))?.toLowerCase();
      const entries = recentLogs(limit, isLogLevel(level) ? level : undefined);

      const worst = entries.some((entry) => entry.level === "error");

      return card("로그", user, {
        status: worst ? "failure" : "info",
        description:
          entries.length === 0
            ? speak("남아 있는 기록이 없습니다.")
            : `최근 **${entries.length}줄**${level === undefined ? "" : ` · \`${level}\` 이상`}`,
        fields:
          entries.length === 0
            ? []
            : [
                {
                  name: "기록",
                  value: entries
                    .map(
                      (entry) =>
                        `${clock(new Date(entry.at))} \`${entry.level.toUpperCase()}\` ${entry.text.replaceAll("`", "'")}`,
                    )
                    .join("\n"),
                },
              ],
        accessoryButton: refreshButton("로그"),
      });
    },
  },

  {
    name: "로그레벨",
    aliases: ["loglevel", "레벨"],
    usage: `${PREFIX} 로그레벨 [기준]`,
    summary: "콘솔에 찍히는 기준 바꾸기",
    async run({ user, args }) {
      const wanted = args[0]?.toLowerCase();

      if (wanted === undefined) {
        return card("로그레벨", user, {
          fields: [
            { name: "지금", value: `\`${logLevel()}\`` },
            { name: "고를 수 있는 것", value: chips(LOG_LEVELS, LOG_LEVELS.length) },
          ],
        });
      }

      if (!isLogLevel(wanted)) {
        return card("로그레벨", user, {
          status: "failure",
          description: speak(`\`${wanted}\` 는 없는 기준입니다.`),
          fields: [{ name: "고를 수 있는 것", value: chips(LOG_LEVELS, LOG_LEVELS.length) }],
        });
      }

      const before = logLevel();
      setLogLevel(wanted);

      return card("로그레벨", user, {
        status: "success",
        fields: [
          { name: "기준", value: `\`${before}\` → \`${wanted}\`` },
          { name: "되돌리기", value: speak("봇을 껐다 켜면 `.env` 의 `LOG_LEVEL` 로 돌아갑니다.") },
        ],
      });
    },
  },

  {
    name: "조회",
    aliases: ["id", "스노플레이크"],
    usage: `${PREFIX} 조회 <id>`,
    summary: "id 가 무엇인지 · 언제 만들어졌는지",
    async run({ message, user, args, level }) {
      const id = parseId(args[0]);

      if (id === null) {
        return card("조회", user, {
          status: "failure",
          description: speak("17~20자리 id 를 붙이거나 멘션해 주세요."),
        });
      }

      const found = await resolveId(
        message.client,
        message.guild,
        message.channel,
        id,
        atLeast(level, "owner"),
      );

      return card("조회", user, {
        status: found === null ? "progress" : "info",
        description: `\`${id}\``,
        fields: [
          { name: "만들어진 때", value: atWithCountdown(createdAt(id)) },
          {
            name: "무엇인지",
            value: found === null ? speak("찾지 못했습니다 _(이 봇이 볼 수 없는 것일 수 있어요)_") : `${found.kind} · ${found.label}`,
          },
        ],
      });
    },
  },

  {
    name: "시간",
    aliases: ["duration", "기간"],
    usage: `${PREFIX} 시간 <입력>`,
    summary: "기간 파서에 넣어 보기",
    async run({ user, args }) {
      const input = args.join(" ");
      const parsed = parseDuration(input);

      if (!parsed.ok) {
        return card("시간", user, {
          status: "failure",
          description: `\`${input === "" ? "(빈 입력)" : input}\``,
          fields: [{ name: "사유", value: describeDurationError(parsed.reason) }],
        });
      }

      const until = new Date(Date.now() + parsed.seconds * 1000);

      return card("시간", user, {
        status: "success",
        description: `\`${input}\``,
        fields: [
          { name: "읽은 값", value: `**${count(parsed.seconds)}초** = ${formatDuration(parsed.seconds)}` },
          { name: "지금 걸면", value: speak(`${at(until)} 에 끝납니다 (${countdown(until)})`) },
        ],
      });
    },
  },

  {
    name: "허용",
    aliases: ["allow", "지정"],
    usage: `${PREFIX} 허용 [대상]`,
    summary: "관리자가 아닌 사람에게 디버그 열어 주기",
    // 지정할 수 있는 것은 관리자부터. 지정된 사람이 또 다른 사람을 부르지는 못한다.
    level: "admin",
    async run({ message, user, args, level }) {
      const listed = await allowedIds(message.guild.id);

      if (args.length === 0) {
        return card("허용", user, {
          fields: [
            {
              name: `지정된 사람 (${listed.length}명)`,
              value: lines(
                listed.map((id) => `<@${id}>`),
                MAX_ROWS,
              ),
            },
            { name: "내 등급", value: `**${LEVEL_LABEL[level]}**` },
            {
              name: "따로 지정하지 않아도 되는 사람",
              value: speak("봇 주인과 이 서버의 **관리자**는 지정 없이 그냥 쓸 수 있어요."),
            },
          ],
        });
      }

      const id = parseId(args[0]);
      if (id === null) {
        return card("허용", user, {
          status: "failure",
          description: speak("지정할 사람을 멘션하거나 id 를 붙여 주세요."),
        });
      }

      const added = await allow(message.guild.id, id);

      return card("허용", user, {
        status: added ? "success" : "progress",
        description: added ? speak(`<@${id}> 님이 디버그를 쓸 수 있습니다.`) : speak(`<@${id}> 님은 이미 지정돼 있어요.`),
        fields: [{ name: "지정된 사람", value: `**${listed.length + (added ? 1 : 0)}명**` }],
      });
    },
  },

  {
    name: "해제",
    aliases: ["disallow", "취소"],
    usage: `${PREFIX} 해제 <대상>`,
    summary: "지정 거둬들이기",
    level: "admin",
    async run({ message, user, args }) {
      const id = parseId(args[0]);

      if (id === null) {
        return card("해제", user, {
          status: "failure",
          description: speak("거둬들일 사람을 멘션하거나 id 를 붙여 주세요."),
        });
      }

      const removed = await disallow(message.guild.id, id);
      const left = await allowedIds(message.guild.id);

      return card("해제", user, {
        status: removed ? "success" : "progress",
        description: removed ? speak(`<@${id}> 님의 지정을 거뒀습니다.`) : speak(`<@${id}> 님은 지정돼 있지 않았어요.`),
        fields: [
          { name: "지정된 사람", value: `**${left.length}명**` },
          ...field(
            "그래도 쓸 수 있는 경우",
            removed ? speak("관리자 권한이 있으면 지정과 상관없이 계속 쓸 수 있어요.") : null,
          ),
        ],
      });
    },
  },

  {
    name: "미리보기",
    aliases: ["preview", "색"],
    usage: `${PREFIX} 미리보기`,
    summary: "네 가지 색을 한 번에 그려 보기",
    async run({ user }) {
      // 색은 컨테이너 하나에 하나뿐이라, 네 개를 보려면 메시지도 네 개여야 한다.
      return [
        card("미리보기 · 초록", user, {
          status: "success",
          description: "모든 작업 완료.",
          fields: [{ name: "변동", value: "권한: 켜짐 → **꺼짐**" }],
        }),
        card("미리보기 · 노랑", user, {
          status: "progress",
          description: "아직 도는 중이거나 온전히 끝나지 못함 (취소 · 일부 실패).",
          fields: [{ name: "집계", value: "전체 **10명** · 완료 **9명** · 실패 **1명**" }],
          rows: [sampleRow()],
        }),
        card("미리보기 · 빨강", user, {
          status: "failure",
          description: "작업 실패.",
          error: new Error(speak("보기용 오류입니다")),
        }),
        card("미리보기 · 파랑", user, {
          status: "info",
          description: "정보 또는 알림성 응답.",
          accessoryButton: refreshButton("미리보기"),
        }),
      ];
    },
  },

  {
    name: "오류",
    aliases: ["throw", "예외"],
    usage: `${PREFIX} 오류`,
    summary: "일부러 터뜨려 실패 경로 보기",
    async run() {
      // 오류가 화면에 어떻게 나오는지, 로그에 어떻게 남는지 한 번에 확인한다.
      throw new Error("일부러 낸 오류입니다 (!y 오류)");
    },
  },

  {
    name: "재시작",
    aliases: ["restart"],
    usage: `${PREFIX} 재시작`,
    summary: "봇 껐다 켜기 (run.bat 이 다시 켬)",
    // 프로세스를 끄는 것이라 이 서버뿐 아니라 **다른 서버까지** 끊긴다. 주인만.
    level: "owner",
    async run({ user }) {
      return card("재시작", user, {
        status: "progress",
        description: speak("지금 처리 중인 것이 있으면 끊깁니다."),
        fields: [
          {
            name: speak("다시 켜는 것은 실행기가 합니다"),
            value: speak("`run.bat` 으로 돌리고 있어야 다시 켜집니다. 아니면 그대로 꺼진 채로 남습니다."),
          },
        ],
        rows: [confirmRow("restart")],
      });
    },
  },

  {
    name: "종료",
    aliases: ["stop", "끄기"],
    usage: `${PREFIX} 종료`,
    summary: "봇 끄기 (다시 켜지지 않음)",
    level: "owner",
    async run({ user }) {
      return card("종료", user, {
        status: "progress",
        description: speak("다시 켜려면 직접 실행해야 합니다."),
        rows: [confirmRow("stop")],
      });
    },
  },
];

/** 이름이나 별칭으로 찾는다. 없으면 undefined — 호출부가 도움말을 보여 준다. */
export function findCommand(token: string | undefined): DebugCommand | undefined {
  const wanted = (token ?? "").toLowerCase();

  return COMMANDS.find(
    (command) =>
      command.name === wanted || command.aliases.some((alias) => alias.toLowerCase() === wanted),
  );
}
