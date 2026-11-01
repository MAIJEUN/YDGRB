import { ButtonStyle, ComponentType } from "discord.js";
import type { Message, MessageEditOptions } from "discord.js";

import { logger } from "../logger.js";
import { retained } from "./attachments.js";
import { componentsEdit } from "./response.js";

/**
 * 다 쓴 메시지의 버튼·드롭다운을 **잠근다.** 색과 내용은 손대지 않는다.
 *
 * 판이 끝났는데 판 화면에 「종료」 · 게임 버튼이 살아 있으면, 누른 사람은 「이미 끝난 판」
 * 이라는 말만 듣고 화면은 그대로다 — 닫히지 않는 것처럼 보인다. 그렇다고 화면을 새로
 * 그리면 색이 바뀌거나(규칙 11) 게임이 이미 치운 내용이 빠진다. 그래서 **보이는 것을
 * 그대로 받아** 누를 수 있는 것만 잠근다.
 *
 * 링크 버튼은 그대로 둔다 — 누른다고 봇에 무엇을 시키지 않는다.
 */

/** 누를 수 있는 컴포넌트 — 버튼과 드롭다운 다섯 가지. */
const SELECTS: ReadonlySet<number> = new Set([
  ComponentType.StringSelect,
  ComponentType.UserSelect,
  ComponentType.RoleSelect,
  ComponentType.MentionableSelect,
  ComponentType.ChannelSelect,
]);

/** 잠그지 않는 버튼. 링크는 봇을 부르지 않고, 결제 버튼은 잠글 수 없다. */
const OPEN_BUTTONS: ReadonlySet<number> = new Set([ButtonStyle.Link, ButtonStyle.Premium]);

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 쿼리(서명·만료)를 뗀 주소. 같은 파일인지 견줄 때 쓴다. */
const bare = (url: string): string => url.split("?")[0] ?? url;

/**
 * 받아 온 미디어 칸을 **보낼 수 있는 모양**으로 되돌린다.
 *
 * 디스코드가 돌려주는 것은 이미 풀린 CDN 주소(서명이 붙어 며칠 뒤 만료된다)다. 그대로
 * 다시 보내면 그 주소를 바깥 그림으로 물어 버려 언젠가 깨진다. 이 메시지에 붙은 첨부라면
 * 처음 보낼 때처럼 `attachment://이름` 으로 되돌려 첨부를 계속 가리키게 한다.
 */
function resend(media: Json, files: ReadonlyMap<string, string>, byUrl: ReadonlyMap<string, string>): Json {
  const url = typeof media["url"] === "string" ? media["url"] : "";
  const id = typeof media["attachment_id"] === "string" ? media["attachment_id"] : undefined;
  const name = (id === undefined ? undefined : files.get(id)) ?? byUrl.get(bare(url));

  return { url: name === undefined ? url : `attachment://${name}` };
}

interface Walk {
  readonly files: ReadonlyMap<string, string>;
  readonly byUrl: ReadonlyMap<string, string>;
  /** 새로 잠근 수. 0이면 고칠 것이 없다. */
  locked: number;
}

function lockNode(node: unknown, walk: Walk): unknown {
  if (Array.isArray(node)) return node.map((child) => lockNode(child, walk));
  if (!isObject(node)) return node;

  const next: Json = {};
  for (const [key, value] of Object.entries(node)) {
    next[key] = (key === "media" || key === "file") && isObject(value)
      ? resend(value, walk.files, walk.byUrl)
      : lockNode(value, walk);
  }

  const type = next["type"];
  const pressable =
    (type === ComponentType.Button && !OPEN_BUTTONS.has(next["style"] as number)) ||
    (typeof type === "number" && SELECTS.has(type));

  if (pressable && next["disabled"] !== true) {
    next["disabled"] = true;
    walk.locked += 1;
  }

  return next;
}

/** 메시지에서 잠근 컴포넌트를 만든다. 보내지는 않는다 — 검사가 이 모양을 본다. */
export function lockedComponents(message: Pick<Message, "components" | "attachments">): {
  readonly components: unknown[];
  readonly locked: number;
} {
  const attachments = Array.from(message.attachments.values());
  const walk: Walk = {
    files: new Map(attachments.map((file) => [file.id, file.name])),
    byUrl: new Map(attachments.map((file) => [bare(file.url), file.name])),
    locked: 0,
  };

  const components = message.components.map((component) => lockNode(component.toJSON(), walk));
  return { components, locked: walk.locked };
}

/**
 * 메시지를 잠가 고친다. 잠글 것이 없으면 고치지 않는다.
 *
 * **무슨 일이 있어도 던지지 않는다** — 판은 이미 끝났고, 버튼이 남는 것은 보기 싫을 뿐
 * 해롭지 않다. 여기서 터지면 정작 결과 답장이 안 나간다.
 */
export async function lockMessage(message: Message): Promise<boolean> {
  try {
    const { components, locked } = lockedComponents(message);
    if (locked === 0) return false;

    // 붙어 있던 그림을 그대로 남긴다. 안 실으면 `attachment://` 가 가리킬 것이 없어진다.
    await message.edit(
      componentsEdit(components as NonNullable<MessageEditOptions["components"]>, retained(message)),
    );
    return true;
  } catch (error) {
    logger.debug(`잠그지 못했습니다 (${message.id})`, error);
    return false;
  }
}
