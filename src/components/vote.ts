import {
  ACTION,
  FIELD,
  MAX_PLEDGE_LENGTH,
  VOTE,
  addCandidate,
  castVote,
  pollOf,
} from "../games/list/vote.js";
import { join, liveGame, refreshPanel, startNow } from "../games/runner.js";
import { getSession } from "../games/store.js";
import { noticeView, refusedView } from "../games/views.js";
import { defineComponentHandler, type ComponentInteraction } from "../types.js";
import { response } from "../ui/response.js";
import { speak } from "../ui/tone.js";

/**
 * 국민투표의 **공약 모달**과 **투표 버튼**.
 *
 * customId 규칙: `vote:pledge:<판 id>` · `vote:pick:<판 id>:<후보>`
 *
 * 참가는 골격이 시키지 않고 여기서 시킨다. 모달을 띄우는 것까지가 골격의 일이고,
 * **제출한 사람만** 참가로 세는 것이 이 게임의 규칙이기 때문이다.
 */

const JOIN_PROBLEM: Record<string, string> = {
  gone: speak("이미 끝난 판입니다."),
  closed: speak("모집이 끝났습니다."),
  full: speak("자리가 다 찼습니다."),
};

const VOTE_PROBLEM: Record<string, string> = {
  gone: speak("이미 끝난 투표입니다."),
  self: speak("자기 자신에게는 투표할 수 없어요."),
  unknown: speak("그 후보를 찾지 못했습니다."),
};

export default defineComponentHandler({
  namespace: VOTE,

  async execute(interaction, args) {
    if (!interaction.inCachedGuild()) return;

    const [action, sessionId = "", candidateId = ""] = args;

    if (action === ACTION.pledge) {
      await submitPledge(interaction, sessionId);
      return;
    }
    if (action === ACTION.pick) {
      await pick(interaction, sessionId, candidateId);
      return;
    }
  },
});

/** 적은 공약을 다듬는다. 비어 있으면 null — 안 적고 낸 것이다. */
function normalizePledge(raw: string): string | null {
  const tidy = raw.replaceAll(/\s+/gu, " ").trim();
  if (tidy === "") return null;

  return tidy.length > MAX_PLEDGE_LENGTH ? `${tidy.slice(0, MAX_PLEDGE_LENGTH - 3)}...` : tidy;
}

/**
 * 공약을 내고 출마한다.
 *
 * 이미 나온 사람이 다시 내면 **공약만 바뀐다.** 참가를 두 번 시키지 않고, 「이미 참가해
 * 있어요」 로 돌려보내지도 않는다 — 고치러 들어온 것을 막을 이유가 없다.
 */
async function submitPledge(interaction: ComponentInteraction, sessionId: string): Promise<void> {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.inCachedGuild()) return;

  const session = await getSession(interaction.guildId, sessionId);
  if (session === undefined || pollOf(sessionId) === undefined) {
    await interaction.reply(
      response(refusedView("끝난 판", speak("이미 끝났거나 사라진 판입니다."), interaction.user)),
    );
    return;
  }

  const pledge = normalizePledge(interaction.fields.getTextInputValue(FIELD.pledge));
  const already = session.players.includes(interaction.user.id);

  // 처음 나온 사람만 골격에 참가시킨다. 자리가 없으면 여기서 막힌다.
  const joined = already
    ? { ok: true as const, session, full: false }
    : await join(interaction.guildId, sessionId, interaction.user.id);

  if (!joined.ok) {
    await interaction.reply(
      response(
        refusedView(speak("출마하지 못했어요"), JOIN_PROBLEM[joined.reason] ?? "", interaction.user),
      ),
    );
    return;
  }

  // 버튼에 적을 이름은 **참가할 때의 서버 별명**이다. 화면을 그릴 때마다 물어볼 수는 없다.
  addCandidate(sessionId, {
    userId: interaction.user.id,
    name: interaction.member.displayName,
    pledge,
  });

  await interaction.reply(
    response(
      noticeView(
        already ? "국민투표 — 공약 수정" : "국민투표 — 출마",
        pledge === null
          ? speak("공약 없이 출마했습니다.")
          : speak(`공약을 걸었습니다.\n> ${pledge}`),
        interaction.user,
      ),
    ),
  );

  const host = await interaction.client.users
    .fetch(session.hostId)
    .catch(() => interaction.client.user);
  if (host === null) return;

  await refreshPanel(interaction.client, joined.session, host);

  // 자리가 다 찼으면 기다릴 이유가 없다.
  if (joined.full) {
    await startNow(interaction.client, interaction.guildId, sessionId, host);
  }
}

/**
 * 한 표를 던진다.
 *
 * 누른 사람에게만 답한다 — 누가 누구를 찍었는지 채널에 뜨면 투표가 아니다.
 * 판 화면도 건드리지 않는다. 표는 끝난 뒤 결과에서 한 번에 편다.
 */
async function pick(
  interaction: ComponentInteraction,
  sessionId: string,
  candidateId: string,
): Promise<void> {
  if (!interaction.isButton()) return;

  const running = liveGame(sessionId);
  if (running === undefined) {
    await interaction.reply(
      response(refusedView("끝난 투표", VOTE_PROBLEM["gone"] ?? "", interaction.user)),
    );
    return;
  }

  const result = castVote(sessionId, interaction.user.id, candidateId);
  if (!result.ok) {
    await interaction.reply(
      response(
        refusedView(speak("투표하지 못했어요"), VOTE_PROBLEM[result.reason] ?? "", interaction.user),
      ),
    );
    return;
  }

  await interaction.reply(
    response(
      noticeView(
        "국민투표",
        result.changed
          ? speak(`<@${candidateId}> 님에게 투표했습니다.`)
          : speak(`<@${candidateId}> 님에게 이미 투표해 두셨어요.`),
        interaction.user,
      ),
    ),
  );
}
