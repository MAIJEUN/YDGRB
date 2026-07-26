import { ButtonBuilder, ButtonStyle } from "discord.js";

import { customId } from "../types.js";
import { ACTION, NICK } from "./ids.js";

/**
 * 진행 중인 작업을 멈추는 버튼. 뚜따이·바사삭 어느 쪽이든 같은 버튼으로 취소한다.
 *
 * 액션 로우가 아니라 Section 의 액세서리로 붙여서 제목 오른쪽 끝에 놓는다
 * (`accessoryButton` 참고). 액션 로우는 한 줄을 통째로 차지한다.
 *
 * 작업 id 를 customId 에 실어 둔다 — 이미 끝난 메시지의 버튼을 눌러
 * 그 뒤에 시작된 다른 작업이 죽는 일이 없게 하기 위해서다.
 */
export function cancelButton(runId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(customId(NICK, ACTION.cancel, runId))
    .setLabel("취소")
    .setStyle(ButtonStyle.Danger);
}
