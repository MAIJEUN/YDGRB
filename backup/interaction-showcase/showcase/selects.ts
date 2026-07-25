import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  MentionableSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from "discord.js";
import type { MessageActionRowComponentBuilder } from "discord.js";

import { customId } from "../types.js";
import { DEMO } from "./ids.js";

/** 셀렉트 메뉴는 한 줄(액션 로우)을 통째로 차지한다 — 그래서 메시지당 최대 5개. */
function row(component: MessageActionRowComponentBuilder): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(component);
}

/**
 * 셀렉트 메뉴 5종 쇼케이스.
 *
 * - StringSelect: 직접 정의한 옵션 중에서 고름 (설명·이모지·기본선택 지원)
 * - UserSelect / RoleSelect / MentionableSelect / ChannelSelect: 디스코드가 목록을 채워 줌
 *
 * `setMinValues`/`setMaxValues` 로 다중 선택이 되고, 최대 25개까지 고를 수 있다.
 */
export function selectRows(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const string = new StringSelectMenuBuilder()
    .setCustomId(customId(DEMO, "sel", "string"))
    .setPlaceholder("옵션을 1~3개 고르세요 (다중 선택)")
    .setMinValues(1)
    .setMaxValues(3)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("빨강")
        .setValue("red")
        .setDescription("옵션에는 설명을 붙일 수 있어요")
        .setEmoji("🟥"),
      new StringSelectMenuOptionBuilder()
        .setLabel("초록")
        .setValue("green")
        .setDescription("이모지도 붙습니다")
        .setEmoji("🟩"),
      new StringSelectMenuOptionBuilder()
        .setLabel("파랑")
        .setValue("blue")
        .setEmoji("🟦")
        .setDefault(true), // 처음부터 선택된 상태
      new StringSelectMenuOptionBuilder().setLabel("설명 없는 옵션").setValue("plain"),
    );

  const user = new UserSelectMenuBuilder()
    .setCustomId(customId(DEMO, "sel", "user"))
    .setPlaceholder("유저를 최대 5명까지 고르세요")
    .setMinValues(1)
    .setMaxValues(5);

  const role = new RoleSelectMenuBuilder()
    .setCustomId(customId(DEMO, "sel", "role"))
    .setPlaceholder("역할을 고르세요")
    .setMinValues(1)
    .setMaxValues(3);

  // 유저와 역할을 한 메뉴에서 같이 고를 수 있다.
  const mentionable = new MentionableSelectMenuBuilder()
    .setCustomId(customId(DEMO, "sel", "mentionable"))
    .setPlaceholder("유저 또는 역할을 고르세요")
    .setMinValues(1)
    .setMaxValues(4);

  const channel = new ChannelSelectMenuBuilder()
    .setCustomId(customId(DEMO, "sel", "channel"))
    .setPlaceholder("채널을 고르세요 (텍스트·음성·카테고리만)")
    // 종류를 제한하면 목록에 그 채널만 나온다.
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory)
    .setMinValues(1)
    .setMaxValues(3);

  return [row(string), row(user), row(role), row(mentionable), row(channel)];
}
