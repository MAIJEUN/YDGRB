import { checkDuration, normalizeTitle, openGameHere } from "../games/command.js";
import pick, {
  ACTION,
  FIELD,
  MODE,
  PICK,
  choose,
  dropPick,
  keepPick,
  pickBody,
  pickField,
  pickOf,
  reveal,
  roundName,
} from "../games/list/pick.js";
import { liveGame, refreshPanel } from "../games/runner.js";
import { noticeView, refusedView, startedView } from "../games/views.js";
import { defineComponentHandler, type ComponentInteraction } from "../types.js";
import { response, updateResponse } from "../ui/response.js";
import { speak } from "../ui/tone.js";

/**
 * 찍기대작전의 **기간 모달**과 **숫자 버튼**.
 *
 * customId 규칙: `pick:open:<선택지 수>:<제목>` · `pick:choose:<판 id>:<숫자>`
 *
 * **무엇을** 찍었는지는 누른 사람에게만 알린다. 도는 동안 그게 보이면 선택 방식의 연
 * 사람이 그걸 보고 고르게 된다 — 아무도 안 찍은 숫자를 고르면 그만이다.
 *
 * 판 화면이 바뀌는 것은 **명단에 새 사람이 붙을 때**와, **정답이 나오는 순간**(버튼을
 * 떼기 위해)뿐이다. 바꿔 찍은 것으로는 그리지 않는다.
 */

const PROBLEM: Record<string, string> = {
  gone: speak("이미 끝난 판입니다."),
  closed: speak("이미 정답이 나왔습니다."),
  unknown: speak("그 숫자를 찾지 못했습니다."),
};

export default defineComponentHandler({
  namespace: PICK,

  async execute(interaction, args) {
    if (!interaction.inCachedGuild()) return;

    const [action = ""] = args;

    if (action === ACTION.open) {
      // 제목에 콜론이 들어 있어도 잘리지 않게 뒤쪽을 통째로 잇는다.
      await openRandom(interaction, args[1] ?? "", args.slice(2).join(":"));
      return;
    }
    if (action === ACTION.choose) {
      await press(interaction, args[1] ?? "", args[2] ?? "");
    }
  },
});

/**
 * 랜덤 방식의 판을 연다 — 기간을 적고 제출한 순간이 곧 시작이다.
 *
 * 선택지 수와 제목은 명령에서 실려 온 것이고, 모달이 받는 것은 기간 하나뿐이다.
 */
async function openRandom(
  interaction: ComponentInteraction,
  rawChoices: string,
  rawTitle: string,
): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  const choices = Number(rawChoices);
  if (!Number.isInteger(choices)) {
    await interaction.reply(
      response(refusedView("찍기대작전 실패", speak("선택지 수를 잃어버렸습니다."), interaction.user)),
    );
    return;
  }

  const duration = checkDuration(interaction.fields.getTextInputValue(FIELD.duration), interaction.user);
  if (!duration.ok) {
    await interaction.reply(response(duration.view));
    return;
  }

  await openGameHere(interaction, pick, {
    title: normalizeTitle(rawTitle),
    name: roundName(choices),
    body: pickBody(MODE.random, interaction.user.id),
    durationSeconds: duration.seconds,
    // 화면을 만들기 전에 맡긴다 — 여는 순간이 곧 시작이라 첫 화면에 버튼이 붙어야 한다.
    prepare: (sessionId) => {
      keepPick(sessionId, MODE.random, choices);
    },
  });
}

/**
 * 숫자 버튼을 눌렀다.
 *
 * 누가 눌렀느냐로 갈린다. **선택 방식의 연 사람**이 누른 것은 찍는 것이 아니라
 * **고르는 것**이다 — 그 숫자가 정답이 되고 판이 그 자리에서 끝난다.
 */
async function press(
  interaction: ComponentInteraction,
  sessionId: string,
  rawNumber: string,
): Promise<void> {
  if (!interaction.isButton()) return;

  const running = liveGame(sessionId);
  if (running === undefined) {
    await interaction.reply(
      response(refusedView("끝난 판", PROBLEM["gone"] ?? "", interaction.user)),
    );
    return;
  }

  const { context } = running;
  const round = pickOf(sessionId);
  const number = Number(rawNumber);

  if (round === undefined || !Number.isInteger(number)) {
    await interaction.reply(
      response(refusedView("끝난 판", PROBLEM["gone"] ?? "", interaction.user)),
    );
    return;
  }

  if (round.mode === MODE.choice && interaction.user.id === context.session.hostId) {
    await settle(interaction, sessionId, number);
    return;
  }

  const result = choose(sessionId, interaction.user.id, number);
  if (!result.ok) {
    await interaction.reply(
      response(refusedView(speak("찍지 못했어요"), PROBLEM[result.reason] ?? "", interaction.user)),
    );
    return;
  }

  await interaction.reply(
    response(
      noticeView(
        "찍기대작전",
        result.before === undefined
          ? speak(`**${number}번**을 찍으셨습니다.`)
          : result.changed
            ? speak(`**${result.before}번**에서 **${number}번**으로 바꾸셨습니다.`)
            : speak(`**${number}번**을 찍어 두셨어요.`),
        interaction.user,
      ),
    ),
  );

  await context.join(interaction.user.id);

  // **새 사람이 들어왔을 때만** 판 화면을 고친다. 바꿔 찍은 것은 명단을 바꾸지 않고,
  // 누를 때마다 채널 메시지를 고치면 여럿이 몰릴 때 편집 제한에 걸린다.
  if (result.before === undefined) {
    await refreshPanel(interaction.client, context.session, context.host);
  }
}

/**
 * 연 사람이 골랐다 — 여기가 개봉이다.
 *
 * 이 인터랙션으로 화면을 갈아 끼워 버튼부터 뗀다. 결과가 나온 판에 누를 수 있는 숫자가
 * 남아 있으면 누른 사람은 아무 일도 안 일어나는 버튼을 누른 셈이 된다.
 */
async function settle(
  interaction: ComponentInteraction,
  sessionId: string,
  number: number,
): Promise<void> {
  if (!interaction.isButton()) return;

  const running = liveGame(sessionId);
  const round = pickOf(sessionId);
  if (running === undefined || round === undefined) return;

  const { context } = running;
  const winners = reveal(sessionId, number);
  const field = pickField(round);
  dropPick(sessionId);

  await interaction.update(updateResponse(startedView(pick, context.session, context.host)));

  await context.end({
    description: [
      speak(`<@${context.session.hostId}> 님이 **${number}번**을 골랐습니다.`),
      winners.length === 0
        ? speak("아무도 맞히지 못했습니다.")
        : speak(`${winners.map((userId) => `<@${userId}>`).join(" ")} 님이 맞히셨습니다.`),
    ].join(" "),
    fields: field,
  });
}
