import { PermissionFlagsBits } from "discord.js";
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from "discord.js";

import { describeError } from "../errors.js";
import { logger } from "../logger.js";
import { channelMessage, editResponse, response } from "../ui/response.js";
import { MODE_LABEL, type Mode } from "./ids.js";
import { beginRun } from "./registry.js";
import { applyNickname, memberFetchRetryDelay } from "./runner.js";
import { cancelExpiry, scheduleExpiry } from "./scheduler.js";
import { clearState, setState } from "./store.js";
import { preparingView, progressView, resultView, type ViewOptions } from "./views.js";

type Runnable = ChatInputCommandInteraction | ModalSubmitInteraction;

export interface RunOptions {
  readonly mode: Mode;
  /** null 이면 별명을 지운다 (바사삭). */
  readonly nickname: string | null;
  readonly expiresAt: number | null;
}

async function refuse(interaction: Runnable, title: string, description: string): Promise<void> {
  await interaction.reply(
    response({ status: "failure", title, description, user: interaction.user }),
  );
}

/**
 * 뚜따이와 바사삭이 공유하는 실행 흐름.
 *
 * 시작할 때 같은 서버에서 돌던 작업을 취소하고 그 작업이 멈출 때까지 기다린다.
 * 오래 걸리므로 진행률을 같은 메시지에 계속 갈아 끼우고,
 * 인터랙션 토큰(15분)이 만료돼 결과를 못 보여주면 채널에 새로 남긴다.
 */
export async function runNicknameChange(interaction: Runnable, options: RunOptions): Promise<void> {
  const { guild } = interaction;
  if (guild === null) {
    await refuse(interaction, "서버 전용", "이 명령은 서버 안에서만 사용할 수 있어요.");
    return;
  }

  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageNicknames) !== true) {
    await refuse(
      interaction,
      "권한이 없습니다",
      "이 기능은 **별명 관리** 권한을 가진 사람만 쓸 수 있어요.",
    );
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

  // 돌고 있던 작업을 취소하고 멈출 때까지 기다린다.
  // 여기서 기다리지 않으면 두 루프가 같은 사람의 별명을 번갈아 바꾼다.
  const run = await beginRun(guild.id, options.mode, interaction.user.id);

  try {
    // deferReply 가 아니라 바로 답한다 — 컨테이너(Components V2) 속성은
    // 메시지를 만들 때 정해지고 나중에 바꿀 수 없기 때문이다.
    await interaction.reply(response(preparingView(view, run)));

    // 상태를 먼저 저장한다 — 작업 중에 봇이 꺼져도 만료 예약은 남아 있어야 한다.
    if (options.mode === "dduttai" && options.nickname !== null) {
      await setState(guild.id, {
        nickname: options.nickname,
        appliedBy: interaction.user.id,
        appliedAt: Date.now(),
        expiresAt: options.expiresAt,
        channelId: interaction.channelId,
      });

      if (options.expiresAt === null) cancelExpiry(guild.id);
      else scheduleExpiry(interaction.client, guild.id, options.expiresAt);
    } else {
      cancelExpiry(guild.id);
      await clearState(guild.id);
    }

    let result;
    try {
      result = await applyNickname({
        guild,
        nickname: options.nickname,
        reason: `${label} — ${interaction.user.tag}`,
        shouldStop: () => run.cancelled,
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
            : "멤버 목록을 받아오지 못했습니다. 봇의 **서버 멤버(Server Members)** 특권 인텐트가 켜져 있는지 확인해 주세요.",
          fields: [{ name: "원인", value: `\`\`\`\n${describeError(error)}\n\`\`\`` }],
          user: interaction.user,
          layout: "container",
          rows: [],
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
    run.finish();
  }
}
