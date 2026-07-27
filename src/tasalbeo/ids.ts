/**
 * 타살버 — "타임아웃인데 살짝 약한 버전".
 *
 * 걸린 사람은 이렇게 된다:
 *   1. 별명이 `타살버맞` 으로 바뀐다 (끝나면 원래 별명으로 되돌린다)
 *   2. 채팅을 막는 역할이 **2초 붙었다 5초 빠졌다** 를 반복한다
 *   3. 그 사람이 보내는 모든 메시지에 굴러가는 이모지가 무작위 개수만큼 달린다
 */

/** 걸려 있는 동안 쓰는 별명. */
export const NICKNAME = "타살버맞";

/** 채팅을 막기 위해 만드는 역할 이름. */
export const ROLE_NAME = "타살버";

/** 역할이 붙어 있는 시간 / 빠져 있는 시간. */
export const ON_MS = 2_000;
export const OFF_MS = 5_000;

/**
 * 기간 상한.
 *
 * 7초마다 역할을 넣었다 뺐다 하므로 요청이 계속 나간다 —
 * 하루면 약 1만 2천 번이다. 그보다 길게 걸 이유가 없다.
 */
export const MAX_SECONDS = 24 * 60 * 60;

/**
 * 메시지에 달 이모지들. **이름으로** 찾는다 — 봇이 들어가 있는 서버의 이모지를 쓴다.
 * 없는 이름은 조용히 건너뛴다 (서버마다 이모지가 다르다).
 */
export const EMOJI_NAMES = [
  "_cartwheel",
  "_ccccccccc",
  "_dol_li_gi_yup",
  "_pcw",
  "_personcartwheeling",
  "_shuoooong",
  "_wheelcart",
  "_yup_dol_gi",
] as const;
