# TypeScript 디스코드 봇

discord.js v14 + TypeScript(ESM) 기반 봇. 커맨드 · 이벤트 · 컴포넌트를 **파일만 추가하면 자동으로 등록**되는 구조입니다.

- **[소원권 시스템](#소원권-시스템)** — 소원권/조각 관리, 소원 신청과 관리자 수락·거절
- **[배포 자동화](RELEASE.md)** — 푸시하면 빌드·릴리스·디스코드 알림까지 자동 (`npm run ship`)
- 외부 라이브러리 없음 — 런타임 의존성은 discord.js 하나 (`.env` 도 DB 도 Node 기본 기능으로)
- 봇의 모든 출력이 [단일 렌더러](#출력-형식-규칙)를 지나 색상·footer 규칙이 항상 지켜짐
- 커맨드 하나가 터져도 봇이 죽지 않고, 사용자에게는 안내 메시지가 감

> 이전에 만들었던 인터랙션 쇼케이스(`/interaction`, `/ping` 등)는 [backup/interaction-showcase/](backup/interaction-showcase) 에 그대로 보관돼 있습니다. 되살리려면 `src/` 안으로 다시 옮기고 `npm run deploy` 하면 됩니다.

## 1. 봇 만들고 토큰 받기

1. https://discord.com/developers/applications 에서 **New Application**
2. **Bot** 탭 → `Reset Token` → 토큰 복사 (한 번만 보여줍니다)
3. **General Information** 탭 → `Application ID` 복사
4. 봇을 서버에 초대 — **Installation** 탭의 설치 링크를 쓰거나, 아래 URL 의 `<APPLICATION_ID>` 를 바꿔서 접속
   ```
   https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&permissions=0&scope=bot+applications.commands
   ```
   `applications.commands` 스코프가 없으면 슬래시 커맨드가 보이지 않습니다.
5. 개발용 서버 ID 복사 — 디스코드 설정에서 개발자 모드를 켠 뒤 서버 이름 우클릭 → `서버 ID 복사`

## 2. 설정

```bash
npm install
```

`.env.example` 을 `.env` 로 복사하고 값을 채웁니다.

```bash
copy .env.example .env
```

| 변수 | 필수 | 설명 |
|------|------|------|
| `DISCORD_TOKEN` | ✅ | Bot 탭에서 받은 토큰 |
| `DISCORD_CLIENT_ID` | ✅ | Application ID |
| `DISCORD_GUILD_ID` | | 개발용 서버 ID. 있으면 그 서버에만 등록되어 **즉시 반영**. 비우면 글로벌 등록(반영까지 최대 1시간) |
| `LOG_LEVEL` | | `debug` \| `info`(기본) \| `warn` \| `error` |

> `.env` 는 `.gitignore` 에 들어 있습니다. 토큰이 노출되면 Developer Portal 에서 바로 `Reset Token` 하세요.

## 3. 실행

```bash
npm run deploy
```

```bash
npm run dev
```

`deploy` 로 슬래시 커맨드를 디스코드에 등록하고, `dev` 로 봇을 켭니다.
서버에서 `/소원권 패널` 을 입력해 보세요. 소원 기능을 쓰려면 관리자 패널 > **설정** 에서 전달 채널을 먼저 정해야 합니다.

| 스크립트 | 설명 |
|----------|------|
| `npm run dev` | 파일 저장 시 자동 재시작 (tsx watch) |
| `npm run deploy` | 슬래시 커맨드를 디스코드에 등록 |
| `npm run typecheck` | 타입 검사만 |
| `npm run build` | `dist/` 로 컴파일 |
| `npm start` | 빌드된 결과 실행 (배포용) |

**`npm run deploy` 는 언제 다시 실행하나요?** 커맨드를 새로 만들거나 이름·설명·옵션을 바꿨을 때만 하면 됩니다.
커맨드 내부 로직만 고쳤다면 봇 재시작(`dev` 는 자동)으로 충분합니다.

## 폴더 구조

```
src/
├─ index.ts               봇 진입점 — 설정 로드 → 커맨드/이벤트/컴포넌트 등록 → 로그인
├─ deploy-commands.ts     슬래시 커맨드 등록 스크립트
├─ client.ts              Client 생성 + 인텐트 설정
├─ config.ts              .env 읽고 검증
├─ env.ts                 .env 파일 로딩 (부수효과 전용)
├─ logger.ts              레벨별 로거
├─ types.ts               Command / EventHandler / ComponentHandler 타입 + define* 헬퍼
├─ loaders/               파일 스캔 → 커맨드·이벤트·컴포넌트 자동 등록
├─ commands/              ← 커맨드 파일을 여기에 추가
│  └─ wish.ts                 /소원권
├─ components/           ← 버튼·셀렉트·모달 응답 핸들러를 여기에 추가
│  └─ wish.ts                 customId 가 `wish:` 로 시작하는 모든 컴포넌트 처리
├─ events/                ← 이벤트 파일을 여기에 추가
│  ├─ client-ready.ts
│  └─ interaction-create.ts   모든 인터랙션 라우팅 + 에러 처리
├─ ui/
│  └─ response.ts             ★ 봇의 모든 출력이 지나는 단일 렌더러
├─ storage/
│  └─ json-file.ts            원자적 쓰기 + 큐를 갖춘 작은 JSON 저장소
└─ wish/                  소원권 도메인 (자동 로딩 대상 아님)
   ├─ store.ts                영속 데이터 + applyBalanceChanges (수량 변경의 유일한 통로)
   ├─ types.ts                Balance · WishRecord · GuildData
   ├─ format.ts               "소원권: n장 → n장" 변동 문구
   ├─ ids.ts                  customId · 모달 필드 id · 상수
   ├─ attachments.ts          첨부파일 재업로드 · 이름 정리 · 미리보기 참조
   ├─ panels.ts               버튼/셀렉트 줄 빌더
   ├─ modals.ts               모달 4종
   └─ views.ts                화면(패널·확인·랭킹·결과) 구성

data/wishes.json         런타임에 생성됨 (gitignore 됨)
```

## 커맨드 추가하기

`src/commands/` 에 파일을 만들고 `defineCommand` 를 **default export** 하면 끝입니다.
하위 폴더로 카테고리를 나눠도 됩니다 (`src/commands/fun/hello.ts`).

```ts
// src/commands/hello.ts
import { SlashCommandBuilder } from "discord.js";

import { defineCommand } from "../types.js";

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName("hello")
    .setDescription("인사합니다."),

  async execute(interaction) {
    await interaction.reply(`안녕하세요, ${interaction.user.displayName}님!`);
  },
});
```

그다음 `npm run deploy` 한 번.

알아 두면 좋은 것들:

- **3초 규칙** — 인터랙션은 3초 안에 응답해야 합니다. 오래 걸리는 작업은 먼저
  `await interaction.deferReply()` 로 "생각 중" 상태를 만들고, 끝나면 `interaction.editReply(...)`.
- **나만 보이는 응답** — `{ content: "...", flags: MessageFlags.Ephemeral }`
- **옵션 값** — `interaction.options.getString("name")` 등. `.setRequired(true)` 를 붙이지 않으면 `null` 이 올 수 있습니다.
- **커맨드 이름** 은 소문자만 됩니다. 한글 이름을 보이게 하려면 `.setNameLocalizations({ ko: "인사" })` 를 쓰세요.

## 이벤트 추가하기

`src/events/` 에 `defineEvent` 를 default export 하면 자동 연결됩니다. `execute` 의 인자 타입은 이벤트 이름에서 추론됩니다.

```ts
// src/events/guild-member-add.ts
import { Events } from "discord.js";

import { defineEvent } from "../types.js";

export default defineEvent({
  name: Events.GuildMemberAdd,
  execute(member) {
    console.log(`${member.user.tag} 입장`);
  },
});
```

`once: true` 를 넣으면 최초 1회만 실행됩니다.

## 출력 형식 규칙

봇의 모든 출력은 [src/ui/response.ts](src/ui/response.ts) 한 곳을 지납니다. 호출부에서 색이나 footer 를
직접 만들지 않기 때문에 형식이 어긋날 수가 없습니다.

| 규칙 | 구현 |
|------|------|
| 색상은 세 가지뿐 | `status: "success"`(초록 `#57F287`) · `"failure"`(빨강 `#ED4245`) · `"progress"`(노랑 `#FEE75C`) |
| footer 에 명령어를 쓴 유저 | `@사용자명` 이 자동으로 붙음. **프로필 사진은 넣지 않는다** |
| 수량이 바뀌면 반드시 표기 | `balance` 에 [`formatBalanceChange()`](src/wish/format.ts) 결과를 넘기면 본문에 자동 삽입 |
| 오류도 같은 임베드로 | 실패(빨강) + `원인` 필드에 짧은 오류 메시지 ([errors.ts](src/errors.ts)) |

```
소원권: 3장 → 4장          ← 소원권이 바뀐 경우에만
소원권 조각: 7개 → 2개      ← 조각이 바뀐 경우에만
```

### Embed 와 Container

디스코드는 **한 메시지에 Embed 와 Container(Components V2)를 같이 넣지 못합니다.**
"모든 출력은 Embed" 와 "패널의 인터랙션은 컨테이너 안에" 를 동시에 만족시키려면 둘 중 하나를 골라야 하므로,
두 레이아웃을 같은 규칙으로 렌더링하도록 만들었습니다.

| `layout` | 쓰는 곳 | 색 | footer |
|----------|---------|-----|--------|
| `"embed"` (기본) | 일반 출력, 소원 전달 메시지 | 임베드 색 띠 | 임베드 footer `@이름` |
| `"container"` | 패널 등 인터랙션을 감싸야 하는 화면 | 컨테이너 accent color | Separator + 작은 글씨 `-# @이름` |

### 오류 표시

오류가 나면 사용자에게도 짧은 원인을 보여 줍니다. 어디서 막혔는지 바로 알 수 있어서
로그를 열어 보지 않아도 대충 짐작이 됩니다.

```
┌ 처리 중 문제가 생겼어요 (빨강) ──────────────
│ 잠시 후 다시 시도해 주세요. …
│ 원인
│ ```
│ DiscordAPIError[50035]: Invalid Form Body
│ ```
│ @사용자명
└────────────────────────────────────────────
```

[describeError()](src/errors.ts) 는 **메시지만** 뽑습니다 — 스택 트레이스와 요청 URL 에는
인터랙션 토큰이 섞여 있어서 채널에 남기면 안 됩니다. 전체 내용은 로그에만 남습니다.

- **최대 3줄** · 최대 300자. 넘치는 부분은 `...` 으로 줄입니다
- 메시지에 ``` 가 있으면 코드블록이 깨지지 않게 바꿉니다

> **footer 에 프로필 사진을 넣지 마세요.** Components V2 에는 임베드 footer 같은 작은 아이콘 자리가
> 없습니다 — 이미지 프리미티브가 `Thumbnail`(Section 액세서리)과 `MediaGallery` 뿐인데
> 둘 다 크기 지정이 안 되고 본문만큼 크게 그려집니다. 임베드와 모양을 맞추기 위해 양쪽 다 이름만 씁니다.

컨테이너로 만든 메시지는 나중에 임베드로 바꿀 수 없습니다(그 반대도 마찬가지). 그래서 패널에서 파생되는
화면은 전부 `layout: "container"` 로 유지합니다.

## 소원권 시스템

소원권과 소원권 조각을 관리하고, 소원을 신청/승인하는 시스템입니다. 데이터는 서버(길드)별로 나뉩니다.

- **소원권 조각 N개 → 소원권 1장** — N 은 서버마다 정합니다 (관리자 패널 > 설정, 기본 5, 1~100)
- **소원권 1장 → 소원 1건**
- 수량이 음수가 되는 변경은 **적용되지 않고** 부족 안내가 나갑니다.

### 명령어

```
/소원권 패널 종류:유저
/소원권 패널 종류:관리자     ← 관리자 권한 필요
```

패널은 누른 사람에게만 보입니다(ephemeral). 모든 버튼과 셀렉트는 컨테이너 안에 들어 있고,
동작 후에도 패널 버튼이 그대로 남아 이어서 쓸 수 있습니다.

### 공개 결과 메시지

패널은 누른 사람에게만 보이므로 결과가 채널에 남지 않습니다. 그래서 결과를 채널에도 공개로 남깁니다.
공개 방식은 두 가지입니다.

**① 기록만 남기기** — 제작 · 낭비 · 수수 · 흡혈

패널은 결과 화면으로 바뀌고, 같은 내용이 채널에 **버튼 없는 임베드**로 한 번 더 올라갑니다.
버튼을 그대로 두면 지나가던 사람이 눌러 **자기 계정으로** 제작·낭비가 실행되기 때문에 떼어 냅니다.

**② 조작까지 공개** — 확인 · 랭킹

패널은 **그대로 두고**, 드롭다운·페이지 버튼을 그대로 실은 화면을 채널에 공개로 띄웁니다.
이후 조작은 그 공개 메시지를 갱신하므로 페이지를 넘겨도 메시지가 쌓이지 않습니다.
읽기 전용이라 다른 사람이 조회해도 안전합니다.

```
패널 [랭킹] 클릭
  └ 패널은 그대로, 채널에 공개 랭킹 메시지 생성
       [랭킹 기준 ▼]
       [이전] [1/3] [다음]     ← 누르면 이 메시지가 갱신됨
```

| 동작 | 공개 |
|------|------|
| 확인 · 랭킹 | ✅ 드롭다운·버튼째 공개, 조작은 그 메시지를 갱신 |
| 제작 · 낭비 · 수수 · 흡혈 | ✅ 버튼 없는 임베드로 기록 |
| **사용** | ❌ 이미 소원 전달 채널로 따로 감 |
| **설정** | ❌ 서버 설정이라 공개하지 않음 |
| 권한 없음 · 입력값 오류 | ❌ 누른 사람에게만 |

**유저 패널**

| 버튼 | 동작 |
|------|------|
| 🔍 확인 | 내 보유량. 드롭다운으로 다른 유저의 보유량도 조회 |
| 🏆 랭킹 | 10명씩 페이지. 드롭다운으로 소원권/조각 기준 전환, 이전/다음 버튼. **기준 항목만 표기하고, 그 항목이 0인 사람은 명단에서 뺍니다** |
| 🔨 제작 | 조각 5개 → 소원권 1장 |
| 🌠 사용 | 모달(소원 내용 + 첨부파일) → 관리자 채널로 전달 |
| 🤸 낭비 | 모달(드롭다운으로 소원권/조각 선택) → 1개 소멸, 출력은 `🤸` |

**관리자 패널** (관리자 권한 필요 — 패널을 열 때와 버튼을 누를 때 모두 확인)

| 버튼 | 동작 |
|------|------|
| 🤝 수수 | 모달 4항목: 지급/회수 · 소원권/조각 · 대상 유저(여러 명) · 갯수 |
| 🩸 흡혈 | 모달 4항목: 소원권/조각 · 흡혈**될** 유저 · 흡혈**할** 유저 · 갯수 |
| ⚙️ 설정 | 소원 전달 채널 + 제작 비용(조각 몇 개로 소원권 1장) |

**설정 모달**은 현재 값을 미리 채워서 띄웁니다. 채널은 **선택 항목**이라 비워 두면 그대로 유지되므로,
제작 비용만 바꾸고 싶을 때 채널을 다시 고를 필요가 없습니다.

제작 비용을 바꾸면 제작 · 확인의 "제작 가능" · 패널 안내문이 모두 그 값을 따릅니다.
저장 파일에 이 항목이 없던 기존 서버는 자동으로 기본값 5가 적용됩니다.

**흡혈** 은 한 사람에게서 빼서 다른 사람에게 옮깁니다. 먼저 빼고, 성공했을 때만 더합니다 —
빼앗길 사람의 보유량이 모자라면 `applyBalanceChange` 가 아무것도 바꾸지 않고 실패를 돌려주므로
**어느 쪽도 변하지 않습니다.** 결과에는 두 사람의 변동 문구가 모두 표시됩니다.

```
🩸 흡혈
소원권 조각 3개 · @빼앗긴사람 → @가져간사람

@빼앗긴사람
소원권 조각: 4개 → 1개

@가져간사람
소원권 조각: 0개 → 3개
```

같은 사람을 양쪽에 고르면 거부합니다.

### 소원 흐름

```
유저: 사용 → 모달 제출
  └ 소원권 1장 차감 → 소원 기록 생성 → 설정된 채널에 전달
        └ 채널 전송 실패 시 차감을 되돌리고 기록 삭제

관리자: 전달된 메시지의 [수락] / [거절]
  ├ 원본 메시지는 버튼만 비활성 「수락됨 / 거절됨」 으로 바뀜 (임베드·첨부는 그대로)
  ├ 결과 임베드(초록/빨강)는 그 메시지에 답글로 달림
  ├ 거절이면 소원권 1장 환불 + 변동 문구 표기
  └ 두 경우 모두 신청자에게 DM 으로 알림 (DM 이 막혀 있으면 조용히 넘어감)
```

동시에 두 관리자가 눌러도 한 번만 반영됩니다 — 상태 확인과 변경이 한 트랜잭션 안에서 일어납니다.

**봇을 껐다 켜도 수락/거절 버튼은 그대로 동작합니다.** 소원 기록은 `data/wishes.json` 에 있고,
버튼은 `wish:accept:<소원 id>` 처럼 필요한 정보를 `customId` 에 싣고 있으며, 핸들러는 부팅할 때
다시 등록되기 때문입니다. 메모리에 들고 있는 상태가 없습니다.

### 첨부파일

모달로 올라온 파일은 **임시 업로드**라서 그 URL 을 그대로 두면 나중에 만료됩니다.
그래서 소원을 채널에 올릴 때 봇 메시지에 **다시 첨부**해 영구 파일로 만듭니다.

이미지는 **임베드 안에 묶음으로** 표시합니다. 임베드 하나에는 이미지를 한 장만 넣을 수 있지만,
**`url` 이 글자 하나까지 똑같은 임베드를 여러 개** 보내면 디스코드가 그것들을 하나로 합쳐 격자로 그려 줍니다.

```ts
// src/ui/response.ts — buildEmbeds()
[본문 임베드 (url=A, image=1장)] + [url=A, image=2장] + [url=A, image=3장]
        ↓ 디스코드가 합침
[본문 + 이미지 3장 격자] 임베드 하나
```

- 표시되는 건 **4장까지**입니다. 나머지는 첨부파일로 아래에 남습니다
- 이미지가 2장 이상일 때만 `url` 을 세팅합니다 — 1장이면 제목이 링크로 바뀌지 않게 두기 위해서입니다
- 본문·필드·footer 는 첫 임베드에만 있고, 나머지는 이미지만 실어 나릅니다
- 컨테이너 레이아웃(`layout: "container"`)에서는 임베드를 못 쓰므로 `MediaGallery` 로 그립니다

이미지는 **`attachment://<파일명>`** 으로 가리킵니다. CDN URL 을 그대로 쓰면 디스코드가 첨부파일을
임베드 **밖에도** 한 번 더 그려서 같은 이미지가 두 번 보입니다. `attachment://` 로 참조하면
"이 첨부는 임베드가 쓴다"고 판단해 밖에는 그리지 않습니다.

그래서 합치기용 링크(`galleryKey`)를 따로 받습니다 — `url` 은 실제 링크여야 하는데
`attachment://` 는 링크가 될 수 없기 때문입니다. 소원 메시지는 채널 링크를,
수락/거절 후에는 그 메시지 링크를 씁니다.

수정할 때 파일명은 **메시지에서 직접 읽습니다**(`fromMessage`). 저장된 이름을 쓰면 어긋날 수 있습니다.

> **이미 보낸 메시지의 임베드는 다시 그리지 마세요.** `attachment://` 참조는 그 요청에 올라가는
> 파일을 기준으로 풀리는데, 수정 요청에는 올릴 파일이 없어서 참조가 깨집니다.
> 그러면 임베드 이미지도, 첨부파일도 함께 사라집니다.
>
> 수락/거절은 그래서 **`components` 만** 보냅니다.
> `embeds` 와 `attachments` 를 넘기지 않으면 디스코드가 그 필드를 손대지 않습니다
> (discord.js 의 `MessagePayload` 도 `undefined` 면 body 에서 빼 버립니다).
> 상태 변화는 버튼을 비활성 「수락됨 / 거절됨」 으로 바꾸고, 결과 임베드는 **답글**로 남깁니다.

> **임베드 안에 파일 카드를 넣을 수는 없습니다.** 임베드가 지원하는 건 이미지와 썸네일 뿐입니다.
> 파일 카드 UI 는 Components V2 의 `File` 컴포넌트인데, `IsComponentsV2` 플래그가 필요해서
> 임베드와 같은 메시지에 못 씁니다. 이미지가 아닌 파일은 임베드 아래에 카드로 표시됩니다.

### 수량 변경은 한 곳에서만

지급 · 회수 · 제작 · 사용 · 낭비 · 환불이 전부 같은 함수를 지납니다. 부호와 항목만 다릅니다.

```ts
// src/wish/store.ts
applyBalanceChanges(guildId, userIds, delta)   // 여러 명
applyBalanceChange(guildId, userId, delta)     // 한 명 (위 함수를 감싼 것)
```

| 상황 | delta |
|------|-------|
| 지급 3장 | `{ tickets: 3 }` |
| 회수 2개 | `{ fragments: -2 }` |
| 제작 | `{ fragments: -5, tickets: 1 }` |
| 사용 · 낭비 | `{ tickets: -1 }` |
| 거절 환불 | `{ tickets: 1 }` |

반환값은 `{ ok: true, before, after }` 또는 `{ ok: false, reason: "insufficient", before }` 입니다.
여러 명을 한 번에 처리할 때 일부만 실패할 수 있고, 실패한 사람은 **아무것도 바뀌지 않습니다.**

### 데이터 저장

`data/wishes.json` 한 파일에 서버별로 저장됩니다(gitignore 됨).
임시 파일에 쓴 뒤 `rename` 하므로 저장 중에 프로세스가 죽어도 파일이 깨지지 않고,
쓰기는 큐로 직렬화되어 읽고-고치고-쓰는 사이에 다른 요청이 끼어들 수 없습니다.

```
data/wishes.json
└ guilds
  └ <서버 ID>
    ├ balances  { <유저 ID>: { tickets, fragments } }
    ├ settings  { wishChannelId }
    └ wishes    { <소원 ID>: { userId, content, attachments, status, … } }
```

백업은 이 파일 하나만 복사하면 됩니다.

## 컴포넌트(버튼·셀렉트·모달) 응답 처리하기

버튼을 눌렀는데 아무 응답이 없으면 디스코드가 「이 인터랙션에 실패했습니다」를 띄웁니다.
그래서 `customId` 앞부분을 네임스페이스로 삼아 핸들러를 찾는 라우터를 씁니다.

```
customId:  demo:counter:3
           └┬─┘ └───┬──┘
    네임스페이스   args (핸들러가 받는 값)
```

`src/components/` 에 파일을 만들고 `defineComponentHandler` 를 default export 하면 등록됩니다.

```ts
// src/components/vote.ts
import { MessageFlags } from "discord.js";

import { defineComponentHandler } from "../types.js";

export default defineComponentHandler({
  namespace: "vote",
  async execute(interaction, args) {
    if (!interaction.isButton()) return;

    await interaction.reply({
      content: `${args[0]} 에 투표했습니다.`,
      flags: MessageFlags.Ephemeral,
    });
  },
});
```

버튼 쪽에서는 `customId("vote", "yes")` 로 `vote:yes` 를 만들면 됩니다.

> 흔히 쓰는 `awaitMessageComponent`(컬렉터)와 달리, 이 방식은 봇이 켜져 있는 한 계속 동작합니다.
> 대신 봇을 재시작하면 이전 메시지의 버튼은 핸들러를 못 찾으니, 상태가 필요하면 `customId` 에 실어 두세요
> (랭킹의 이전/다음 버튼이 페이지 번호를 `customId` 에 실어 두는 방식입니다).

## 주의할 점 두 가지

**1. 인텐트** — [src/client.ts](src/client.ts) 에서 관리합니다. 기본값은 `Guilds` 하나뿐입니다.
`GuildMembers`, `GuildPresences`, `MessageContent` 는 **특권 인텐트**라서
Developer Portal → Bot → *Privileged Gateway Intents* 에서 먼저 켜야 하고,
켜지 않은 채로 코드에서 요청하면 로그인할 때 `Used disallowed intents` 로 실패합니다.

**2. import 확장자** — ESM 프로젝트라서 상대 경로 import 에는 `.js` 를 붙입니다.
소스 파일이 `types.ts` 여도 `import { defineCommand } from "../types.js";` 가 맞습니다
(빌드 후 실제로 `.js` 가 되기 때문). 확장자를 빼면 실행 시 `ERR_MODULE_NOT_FOUND` 가 납니다.

## 문제가 생기면

| 증상 | 원인 |
|------|------|
| `환경변수 DISCORD_TOKEN 가 비어 있습니다` | `.env` 가 없거나 값이 빔 |
| `An invalid token was provided` | 토큰 오타. Client Secret 이 아니라 **Bot 토큰**이 맞는지 확인 |
| `401: Unauthorized` (deploy) | 토큰이 틀렸거나 `DISCORD_CLIENT_ID` 가 다른 앱의 ID |
| 서버에서 커맨드가 안 보임 | `npm run deploy` 안 함 / 초대 시 `applications.commands` 스코프 누락 / 글로벌 등록 반영 대기 |
| 버튼 누르면 「이 인터랙션에 실패했습니다」 | 3초 안에 응답하지 않았거나, `customId` 네임스페이스에 맞는 핸들러가 없음. 봇 재시작 전에 보낸 메시지의 버튼일 수도 있음 |
| 모달이 안 뜸 | `showModal()` 은 첫 응답으로만 됩니다. 이미 `reply()`/`deferReply()` 했으면 못 띄웁니다 |
| Components V2 메시지가 400 에러 | `MessageFlags.IsComponentsV2` 를 켠 메시지에는 `content`/`embeds` 를 같이 못 씁니다 |
| 패널 갱신이 400 에러 | 컨테이너로 만든 메시지를 임베드로 바꾸려 한 경우. 패널에서 파생되는 화면은 `layout: "container"` 유지 |
| `COMPONENT_CUSTOM_ID_DUPLICATED` | 한 메시지 안에 같은 `customId` 가 두 번. 비활성 버튼도 검사 대상입니다 — 페이지네이션에서 이전/다음 목표 페이지를 범위로 깎으면 같아질 수 있으니 깎지 마세요 |
| 메시지를 수정하니 첨부파일이 사라짐 | `attachments: [{ id }, …]` 로 남길 첨부를 명시하지 않았거나, 임베드가 `attachment://` 로 참조하고 있음 |
| 「소원을 빌 수 없습니다」 | 관리자 패널 > 설정 에서 전달 채널을 먼저 지정해야 합니다 |
| 소원이 채널로 안 감 | 봇이 그 채널에 **메시지 보내기** 권한이 있는지 확인 (실패하면 소원권은 자동 환불됩니다) |
| `Used disallowed intents` | 위 "주의할 점 1" 참고 |
| `ERR_MODULE_NOT_FOUND` | import 에 `.js` 확장자 누락 |

## 배포

```bash
npm run build
npm start
```

`dist/` 와 `node_modules/`, `.env` 가 있으면 실행됩니다. `SIGINT`/`SIGTERM` 을 받으면 게이트웨이 연결을 정리하고 종료하므로 프로세스 매니저와 함께 쓰기 좋습니다.

소원권 데이터는 실행 위치 기준 `data/wishes.json` 에 쌓이므로, 봇을 옮길 때는 이 파일도 함께 옮기세요.
