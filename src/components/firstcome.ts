import firstcome, {
  ACTION,
  FIRSTCOME,
  MODE,
  dropRace,
  press,
  pressField,
  raceBody,
  raceOf,
  winnersOf,
} from "../games/list/firstcome.js";
import { liveGame } from "../games/runner.js";
import { refusedView, startedView } from "../games/views.js";
import { defineComponentHandler } from "../types.js";
import { response, updateResponse } from "../ui/response.js";

/**
 * 선착순의 「누르기」 버튼.
 *
 * customId 규칙: `firstcome:press:<판 id>`
 *
 * 화면은 **누른 사람의 인터랙션으로** 갈아 끼운다. 채널 메시지를 봇이 직접 고치면
 * 여럿이 몰릴 때 채널 편집 제한에 걸리는데, 인터랙션 응답은 각자의 것이라 걸리지 않는다.
 */
const PROBLEM: Record<string, string> = {
  gone: "이미 끝난 판입니다.",
  closed: "자리가 다 찼습니다.",
  already: "이미 누르셨어요. 한 번만 누를 수 있습니다.",
};

export default defineComponentHandler({
  namespace: FIRSTCOME,

  async execute(interaction, args) {
    if (!interaction.isButton()) return;

    const [action, sessionId = ""] = args;
    if (action !== ACTION.press) return;

    const running = liveGame(sessionId);
    if (running === undefined) {
      await interaction.reply(
        response(refusedView("끝난 판", PROBLEM["gone"] ?? "", interaction.user)),
      );
      return;
    }

    const { context } = running;

    // 자리를 잡는 것은 동기로 끝난다 — 그 사이에 다른 사람이 끼어들 수 없다.
    const result = press(sessionId, interaction.user.id);
    if (!result.ok) {
      await interaction.reply(
        response(refusedView("누르지 못했어요", PROBLEM[result.reason] ?? "", interaction.user)),
      );
      return;
    }

    const race = raceOf(sessionId);
    if (race === undefined) {
      await interaction.deferUpdate();
      return;
    }

    // 누른 사람이 참가자로도 남는다.
    await context.join(interaction.user.id);

    // 화면을 이 인터랙션으로 갈아 끼운다. 다 찼으면 버튼도 같이 사라진다.
    await interaction.update(
      updateResponse(
        startedView(firstcome, { ...context.session, body: raceBody(race) }, context.host),
      ),
    );

    if (!result.filled) return;

    const winners = winnersOf(race);
    const only = race.mode === MODE.nth;
    dropRace(sessionId);

    await context.end({
      description: only
        ? `**${race.target}번째**로 누른 ${winners.map((id) => `<@${id}>`).join(" ")} 님이 가져갑니다.`
        : `${winners.map((id) => `<@${id}>`).join(" ")} 님이 가져갑니다.`,
      fields: pressField(race),
    });
  },
});
