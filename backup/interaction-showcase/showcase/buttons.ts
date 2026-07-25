import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import { customId } from "../types.js";
import { DEMO } from "./ids.js";

/**
 * 버튼 쇼케이스.
 *
 * 제한: 액션 로우 한 줄에 버튼 5개, 메시지 하나에 액션 로우 5줄.
 * ButtonStyle 은 Primary/Secondary/Success/Danger/Link/Premium 6종이며,
 * Link 는 customId 대신 setURL, Premium 은 setSKUId 가 필요하다(스토어 상품이 있어야 해서 여기선 제외).
 */
export function buttonRows(counter: number): ActionRowBuilder<ButtonBuilder>[] {
  const styles = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(DEMO, "btn", "primary"))
      .setLabel("Primary")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(customId(DEMO, "btn", "secondary"))
      .setLabel("Secondary")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(customId(DEMO, "btn", "success"))
      .setLabel("Success")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(customId(DEMO, "btn", "danger"))
      .setLabel("Danger")
      .setStyle(ButtonStyle.Danger),
    // Link 버튼은 인터랙션이 발생하지 않는다 — 그냥 링크로 이동만 한다.
    new ButtonBuilder().setLabel("Link").setStyle(ButtonStyle.Link).setURL("https://discord.js.org"),
  );

  const behaviours = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(DEMO, "btn", "emoji"))
      .setLabel("이모지")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(customId(DEMO, "btn", "disabled"))
      .setLabel("비활성")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    // 현재 값을 customId 에 실어 두면 상태를 따로 저장하지 않아도 된다.
    new ButtonBuilder()
      .setCustomId(customId(DEMO, "counter", String(counter)))
      .setLabel(`카운터 ${counter}`)
      .setEmoji("➕")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(customId(DEMO, "btn", "defer"))
      .setLabel("지연 응답")
      .setEmoji("⏳")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(customId(DEMO, "btn", "ephemeral"))
      .setLabel("나만 보기")
      .setEmoji("👀")
      .setStyle(ButtonStyle.Secondary),
  );

  return [styles, behaviours];
}
