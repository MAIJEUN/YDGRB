import { PermissionFlagsBits } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { describeError } from "../errors.js";
import { logger } from "../logger.js";
import { channelMessage, editResponse, response } from "../ui/response.js";
import { MODE_LABEL, type Mode } from "./ids.js";
import { beginRun, type ActiveRun } from "./registry.js";
import { applyNickname, memberFetchRetryDelay } from "./runner.js";
import { cancelAllExpiry, cancelExpiry, scheduleExpiry } from "./scheduler.js";
import { clearAllStates, clearState, setState } from "./store.js";
import { preparingView, progressView, resultView, type ViewOptions } from "./views.js";

export interface RunOptions {
  readonly mode: Mode;
  /** null 이면 별명을 지운다 (바사삭). */
  readonly nickname: string | null;
  readonly expiresAt: number | null;
  /** null 이면 서버 전원. */
  readonly targetId: string | null;
}

async function refuse(
  interaction: ChatInputCommandInteraction,
  title: string,
  description: string,
): Promise<void> {
  await interaction.reply(
    response({ status: "failure", title, description, user: interaction.user }),
  );
}

/** 저장된 예약을 이번 작업에 맞게 갈아 끼운다. */
async function updateSchedule(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  options: RunOptions,
): Promise<void> {
  if (options.mode === "dduttai" && options.nickname !== null) {
    await setState(guildId, {
      nickname: options.nickname,
      appliedBy: interaction.user.id,
      appliedAt: Date.now(),
      expiresAt: options.expiresAt,
      channelId: interaction.channelId,
      targetId: options.targetId,
    });

    if (options.expiresAt === null) cancelExpiry(guildId, options.targetId);
    else scheduleExpiry(interaction.client, guildId, options.targetId, options.expiresAt);
    return;
  }

  // 서버 전체 바사삭은 모두의 별명을 지우므로 개별 예약까지 전부 정리한다.
  if (options.targetId === null) {
    cancelAllExpiry(guildId);
    await clearAllStates(guildId);
  } else {
    cancelExpiry(guildId, options.targetId);
    await clearState(guildId, options.targetId);
  }
}

/**
 * 뚜따이와 바사삭이 공유하는 실행 흐름.
 *
 * 서버 전원이 대상일 때만 작업 레지스트리를 지난다 — 돌던 작업을 취소하고 멈출 때까지 기다린다.
 * 한 명만 바꾸는 경우는 요청 한 번이면 끝나므로 취소할 새도 없고, 큰 작업을 밀어낼 이유도 없다.
 */
export async function runNicknameChange(
  interaction: ChatInputCommandInteraction,
  options: RunOptions,
): Promise<void> {
  const { guild } = interaction;
  if (guild === null) {
    await refuse(interaction, "서버 전용", "이 명령은 서버 안에서만 사용할 수 있어요.");
    return;
  }

  // 봇에게 권한이 없으면 전원 실패한다. 한 명씩 실패시키지 말고 미리 막는다.
  if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames) !== true) {
    await refuse(
      interaction,
      "봇 권한이 없습니다",
      "봇에게 **별명 관리(Manage Nicknames)** 권한을 주세요. 서버 설정 > 역할 에서 봇 역할에 추가할 수 있습니다.",
    );
    return;
  }

  const view: ViewOptions = { ...options, user: interaction.user };
  const label = MODE_LABEL[options.mode];

  const wholeServer = options.targetId === null;
  const run: ActiveRun | null = wholeServer
    ? await beginRun(guild.id, options.mode, interaction.user.id)
    : null;

  try {
    // deferReply 가 아니라 바로 답한다 — 컨테이너(Components V2) 속성은
    // 메시지를 만들 때 정해지고 나중에 바꿀 수 없기 때문이다.
    await interaction.reply(response(preparingView(view, run)));

    // 예약을 먼저 저장한다 — 작업 중에 봇이 꺼져도 만료 예약은 남아 있어야 한다.
    await updateSchedule(interaction, guild.id, options);

    let result;
    try {
      result = await applyNickname({
        guild,
        nickname: options.nickname,
        targetId: options.targetId,
        reason: `${label} — ${interaction.user.tag}`,
        shouldStop: () => run?.cancelled === true,
        onProgress: async (progress) => {
          await interaction.editReply(editResponse(progressView(view, progress, run)));
        },
      });
    } catch (error) {
      const throttled = memberFetchRetryDelay(error) !== undefined;

      // 요청 제한은 스택 트레이스를 남길 만한 오류가 아니다.
      if (throttled) logger.warn(`${label}: 멤버 목록 요청이 제한되어 포기했습니다.`);
      else logger.error(`${label} 실행 중 오류`, error);

      await interaction.editReply(
        editResponse({
          status: "failure",
          title: `${label} 실패`,
          description: throttled
            ? "디스코드가 멤버 목록 요청을 잠시 제한했습니다. 조금 뒤에 다시 시도해 주세요."
            : wholeServer
              ? "멤버 목록을 받아오지 못했습니다. 봇의 **서버 멤버(Server Members)** 특권 인텐트가 켜져 있는지 확인해 주세요."
              : "대상을 찾지 못했습니다. 서버에 없는 사람일 수 있어요.",
          fields: [{ name: "원인", value: `\`\`\`\n${describeError(error)}\n\`\`\`` }],
          user: interaction.user,
          layout: "container",
        }),
      );
      return;
    }

    if (result.failures.length > 0) {
      logger.info(`${label} 실패 사유 — ${result.failures.join(" / ")}`);
    }
    if (result.cancelled) {
      logger.info(`${label} 취소됨 — ${result.done}/${result.total}명까지 진행`);
    }

    const final = resultView(view, result, run);

    try {
      await interaction.editReply(editResponse(final));
    } catch (error) {
      // 15분을 넘겨 토큰이 만료된 경우 — 결과를 잃지 않도록 채널에 새로 남긴다.
      logger.warn("결과 표시 실패 — 채널에 새로 보냅니다", error);
      if (interaction.channel?.isSendable() === true) {
        await interaction.channel.send(channelMessage(final));
      }
    }
  } finally {
    // 다음 작업이 이 작업을 기다리고 있을 수 있으므로 반드시 알린다.
    run?.finish();
  }
}
