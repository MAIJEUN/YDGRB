import firstcome, {
  ACTION,
  FIRSTCOME,
  MODE,
  dropRace,
  press,
  pressField,
  raceOf,
  winnersOf,
} from "../games/list/firstcome.js";
import { liveGame } from "../games/runner.js";
import { noticeView, refusedView, startedView } from "../games/views.js";
import { defineComponentHandler } from "../types.js";
import { response, updateResponse } from "../ui/response.js";

/**
 * 선착순의 「누르기」 버튼.
 *
 * customId 규칙: `firstcome:press:<판 id>`
 *
 * 누른 사람에게는 **몇 번째인지만** 임시 메시지로 알려 준다. 판 화면은 건드리지 않는다 —
 *   · 눌린 순서는 **끝났을 때만** 보여 준다. 도는 동안 순위표를 띄우면 남이 누른 것을
 *     보고 눈치를 보게 된다.
 *   · 누를 때마다 채널 메시지를 고치면 여럿이 몰릴 때 편집 제한에 걸린다.
 *
 * 마지막 한 사람이 채웠을 때만 화면을 갈아 끼운다 — 버튼을 떼기 위해서다.
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

    // 아직 안 찼다 — 누른 사람에게만 몇 번째인지 알려 주고 화면은 그대로 둔다.
    if (!result.filled) {
      await interaction.reply(
        response(noticeView("선착순", `**${result.order}번째**로 누르셨습니다.`, interaction.user)),
      );
      await context.join(interaction.user.id);
      return;
    }

    // 다 찼다 — 이 인터랙션으로 화면을 갈아 끼워 버튼을 뗀다.
    await interaction.update(updateResponse(startedView(firstcome, context.session, context.host)));
    await context.join(interaction.user.id);

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
