# ══════════════════════════════════════════════════════════════════════════════
# messages.py — 봇에서 사용하는 모든 텍스트 메시지 모음
# 수정할 때는 이 파일만 건드리면 됩니다.
# ══════════════════════════════════════════════════════════════════════════════

import random


# ──────────────────────────────────────────────────────────────────────────────
# 랜덤 메시지 시스템
#   메시지 클래스의 속성을 list 로 적어 두면, 사용할 때마다 그 안에서 무작위로
#   한 줄이 선택된다. 고른 값은 평범한 str 이라 .format(...) 등 어디서든 그대로 쓸 수 있다.
#
#       WASTE_SUCCESS_DESC = ["# 🤸\n[{change}]", "# 테스트🤸\n[{change}]"]
#
#   인덱싱·멤버십이 필요한 '고정 데이터'는 list 가 아니라 tuple/set 으로 두면
#   랜덤 처리에서 제외된다. (예: SEQUENCE = ("탕", "수", "육"))
# ──────────────────────────────────────────────────────────────────────────────
class _RandomMessage:
    """list 로 정의된 메시지를 매 접근마다 무작위로 하나 골라 돌려주는 디스크립터."""
    __slots__ = ("options",)

    def __init__(self, options):
        self.options = list(options)

    def __get__(self, obj, owner=None):
        return random.choice(self.options) if self.options else ""


def _enable_random_messages(*namespaces) -> None:
    """주어진 메시지 클래스들의 list 속성을 _RandomMessage 로 자동 변환한다.
    (파일 맨 아래에서 모든 메시지 클래스에 대해 한 번 호출)"""
    for ns in namespaces:
        for name, value in list(vars(ns).items()):
            if name.startswith("__"):
                continue
            if isinstance(value, list):
                setattr(ns, name, _RandomMessage(value))


# ──────────────────────────────────────────────────────────────────────────────
# 슬래시 커맨드 이름 / 설명 / 파라미터 설명
# ──────────────────────────────────────────────────────────────────────────────
class CMD:
    # 룰렛
    ROULETTE_NAME        = "룰렛"
    ROULETTE_DESC        = "우리모두룰렛을즐겨볼까요?"
    ROULETTE_P_COUNT     = "최대 참가 인원 수 (2~50)"
    ROULETTE_P_TITLE     = "룰렛 제목 (기본: 랜덤뽑기)"

    # 숫자야구
    BASEBALL_NAME        = "숫자야구"
    BASEBALL_DESC        = "숫자는야구가아니야!!!"
    BASEBALL_P_DIGITS    = "숫자 자리수 (3~10, 기본: 4)"

    # 퀴즈
    QUIZ_NAME            = "퀴즈"
    QUIZ_DESC            = "퀴즈 뜻 아시죠?"
    QUIZ_P_QUESTION      = "문제 내용"
    QUIZ_P_ANSWER        = "정답"
    QUIZ_P_TIME          = "제한 시간 (초, 선택 · 기본 {default}초)"

    # 초성퀴즈
    CHOSUNG_NAME         = "초성퀴즈"
    CHOSUNG_DESC         = "ㅊㅅㅋㅈ ㄹㅊㄱ"
    CHOSUNG_P_TEXT       = "맞춰야 할 단어"
    CHOSUNG_P_TIME       = "제한 시간 (초, 선택 · 기본 {default}초)"

    # 별명뚜따이
    NICK_SET_NAME        = "별명뚜따이"
    NICK_SET_DESC        = "모든 멤버의 별명을 뚜따이 함"
    NICK_SET_P_NICK      = "설정할 별명"

    # 별명바사삭
    NICK_RESET_NAME      = "별명바사삭"
    NICK_RESET_DESC      = "모든 멤버의 별명을 바사삭 함"

    # 슬로우뿡모드
    SLOWMODE_NAME        = "슬로우뿡모드"
    SLOWMODE_DESC        = "채널에 슬로우모드를 끙끙하비다 0이면 해제일껄?"
    SLOWMODE_P_SEC       = "슬로우모드 시간 (초, 0=해제, 선택 · 기본 {default}초)"

    # 채팅뻥
    CHAT_TOGGLE_NAME     = "채팅뻥"
    CHAT_TOGGLE_DESC     = "메시지 권한을 뻥뻥할까"
    CHAT_TOGGLE_P_ROLE   = "권한을 토글할 역할"

    # 타임아웃
    TIMEOUT_NAME         = "타임아웃"
    TIMEOUT_DESC         = "타임스토프!!!!!!!!!"
    TIMEOUT_P_USER       = "타임아웃할 유저"
    TIMEOUT_P_SEC        = "타임아웃 시간 (초, 최대 28일, 선택 · 기본 {default}초)"

    # 타살버
    TASALBEO_NAME        = "타살버"
    TASALBEO_DESC        = "그러셔?"
    TASALBEO_P_USER      = "대상 유저"
    TASALBEO_P_TIME      = "지속 시간 (초, 0=해제, 선택 · 기본 {default}초)"

    # 선착순한명
    FIRST_NAME           = "선착순한명"
    FIRST_DESC           = "누가 먼저 누를까요 알아 맞춰보세요"
    FIRST_P_TITLE        = "제목"

    # 프로필
    PROFILE_NAME         = "프로필쀼"
    PROFILE_DESC         = "너는 누구인가?"
    PROFILE_P_USER       = "정보를 볼 유저 (선택, 기본: 본인)"

    # 국민투표
    VOTE_NAME            = "국민투표"
    VOTE_DESC            = "국수민족투사경표시기 입니다."
    VOTE_P_COUNT         = "참가 인원 수 (2~5명)"
    VOTE_P_TIME          = "투표 제한 시간 (30~300초, 선택 · 기본 {default}초)"

    # 탕수육게임
    TANGSUYUK_NAME       = "탕수육게임"
    TANGSUYUK_DESC       = "부먹 나가세요"

    # 소원권 그룹
    WISH_GROUP_NAME      = "소원권"
    WISH_GROUP_DESC      = "소원권 뭐시기저시기"
    WISH_CHECK_NAME      = "확인"
    WISH_CHECK_DESC      = "보유 중인 소원권과 조각을 확인ㅇㅇ"
    WISH_CHECK_P_USER    = "확인할 유저 (선택, 기본: 본인)"
    WISH_MAKE_NAME       = "만들기"
    WISH_MAKE_DESC       = "소원권 조각 {pieces}개로 소원권 1장을 만두. (만두는 군만두)"
    WISH_USE_NAME        = "사용"
    WISH_USE_DESC        = "소원권을 사용 렛츠기"
    WISH_USE_P_TEXT      = "소원 내용"
    WISH_USE_P_IMAGE     = "첨부 이미지"
    WISH_WASTE_NAME      = "낭비"
    WISH_WASTE_DESC      = "할 가치가 없는 행동임"
    WISH_GIVE_NAME       = "지급"
    WISH_GIVE_DESC       = "소원권을 지급하다!!ㅋㅋㅋㅋㅋㅋㅋㅋ!!!!ㅋ!ㅋㅋ!ㅋㅋ!!ㅋ"
    WISH_TAKE_NAME       = "회수"
    WISH_TAKE_DESC       = "소원권을 회수하악ㅠㅠ유유유ㅠㅜㅠㅇ"
    PIECE_GIVE_NAME      = "조각지급"
    PIECE_GIVE_DESC      = "소원권 조각을 지급함ㅋㅋㅋㅋㅋㅋㅋㅋ"
    PIECE_TAKE_NAME      = "조각회수"
    PIECE_TAKE_DESC      = "소원권 조각을 회수함ㅠㅠㅠㅠㅠㅠㅠㅠㅠ"

    # 소원권/조각 지급·회수 공통 파라미터 설명
    WISH_BULK_P_USERS    = "대상 유저들 (멘션 또는 ID를 공백/쉼표로 구분 가능)"
    WISH_BULK_P_AMOUNT   = "수량"

    # 소원권 / 조각 랭킹
    WISH_RANK_NAME       = "랭킹"
    WISH_RANK_DESC       = "1등은 항상 마이즌."

    # 소원 전달 채널 설정 (관리자 전용)
    WISH_SET_CHANNEL_NAME = "전달채널설정"
    WISH_SET_CHANNEL_DESC = "당신의 소원이 전달?"
    WISH_SET_CHANNEL_P    = "소원이 전달될 채널"

    # 봇설명 (모든 슬래시 명령어 리스트)
    BOTINFO_NAME         = "봇설명"
    BOTINFO_DESC         = "이게 뭐시냐.. ㅇ;;"


# ──────────────────────────────────────────────────────────────────────────────
# 공통 오류 메시지
# ──────────────────────────────────────────────────────────────────────────────
class ERR:
    TITLE                = "X 오류"
    CHANNEL_BUSY         = "이 채널에서는 이미 게임이 진행 중입니다."
    SERVER_ONLY          = "서버 채널에서만 사용할 수 있습니다."
    WRONG_CHANNEL        = "지정된 채널에서만 명령어를 사용할 수 있습니다."
    DM_CLOSED            = "<@{user_id}> 님의 DM이 닫혀있어 게임을 시작할 수 없습니다."
    NO_PERMISSION        = "호스트 또는 관리자만 시작할 수 있습니다."
    NO_PERMISSION_TITLE  = "X 권한 없음"
    NOT_YOUR_TURN        = "당신의 턴이 아닙니다."
    INVALID_DIGITS       = "자리수는 {min}~{max} 사이여야 합니다."


# ──────────────────────────────────────────────────────────────────────────────
# 모집 세션
# ──────────────────────────────────────────────────────────────────────────────
class RECRUIT:
    DESCRIPTION      = "참가자를 모집합니다. 아래 버튼을 눌러 참가하세요.\n**참가 인원:** {joined}/{max}"
    DONE             = "모집 완료! 잠시 후 시작합니다."
    FIELD_PLAYER_NUM = "{n}번 참가자"
    TIMEOUT          = "{timeout}초 동안 모집이 완료되지 않아 취소되었습니다."
    TIMEOUT_TITLE    = "X 모집 취소"
    BTN_JOIN         = "참가"
    BTN_START        = "시작"
    ALREADY_JOINED   = "이미 참가했습니다."
    ALREADY_TITLE    = "X 중복 참가"
    FULL             = "모집이 이미 마감되었습니다."
    FULL_TITLE       = "X 모집 마감"
    MIN_PLAYERS      = "최소 {min}명 이상 필요합니다."
    MIN_TITLE        = "X 인원 부족"
    RANGE_ERROR      = "참가 인원은 2~{max}명이어야 합니다."
    NOT_ENOUGH       = "유효한 참가자가 부족합니다."
    NOT_ENOUGH_TITLE = "X 취소"
    PLAYER_SEP       = ", "


# ──────────────────────────────────────────────────────────────────────────────
# 룰렛
# ──────────────────────────────────────────────────────────────────────────────
class ROULETTE:
    DEFAULT_TITLE    = "랜덤뽑기"
    WINNER_LABEL     = "당첨자: {winner}"
    RESULT_TITLE     = "당첨"
    RESULT_DESC      = "{mention} ← 당첨된 청년"


# ──────────────────────────────────────────────────────────────────────────────
# 숫자야구
# ──────────────────────────────────────────────────────────────────────────────
class BASEBALL:
    GAME_TITLE          = "숫자야구"
    HISTORY_LINE        = "{tag} → {guess} | {s}S {b}B {o}O"
    DM_SETUP_TITLE      = "숫자 설정"
    DM_SETUP_DESC       = "상대방이 맞출 숫자를 입력하세요.\n\n**입력:** `{display}`\n**남은 자리:** {remaining}"
    DM_SETUP_DONE_FIELD = "O 설정 완료"
    DM_RETURN_LINK      = "[채널로 돌아가기]({url})"
    BTN_BACK            = "되돌리기"
    BOTH_READY          = "두 청년 모두 준비, 곧 시작합니다."
    TABLE_TITLE         = "게임 테이블 - 턴 {turn} ({timestamp} 종료)"
    TABLE_START         = "경기를 시작합니다"
    TABLE_TURN          = "\n**{mention}의 차례입니다.**\n**입력 :** `{display}`"
    TIMEOUT_TITLE       = "⏱ 시간 초과!"
    TIMEOUT_DESC        = "<@{loser}> ← 패배한 청년\n<@{winner}> ← 승리한 청년"
    WIN_TITLE           = "정답"
    WIN_DESC            = "{mention} ← 승리한 청년\n**정답:** `{answer}`"
    DRAW_TITLE          = "무승부"
    DRAW_DESC           = "최대 턴을 초과하여 무승부입니다."


# ──────────────────────────────────────────────────────────────────────────────
# 퀴즈
# ──────────────────────────────────────────────────────────────────────────────
class QUIZ:
    TITLE_DEFAULT        = "퀴즈"
    TITLE_CHOSUNG        = "초성퀴즈"
    START_MSG            = "퀴즈를 시작합니다!"
    START_TITLE          = "퀴즈 시작"
    CHOSUNG_START        = "초성퀴즈를 시작합니다!"
    CHOSUNG_TITLE        = "초성퀴즈 시작"
    DISPLAY_QUIZ         = "문제 : {question}"
    DISPLAY_CHOSUNG      = "초성 : {chosung}"
    TIMER                = "⏱ {timestamp} 종료"
    CORRECT_TITLE        = "O 정답!"
    CORRECT_DESC         = "{display}\n**정답 :** {answer}\n**맞춘 청년 :** {mention}"
    CORRECT_WINNER       = "{mention} ← 맞춘 청년"
    CORRECT_WINNER_TITLE = "정답자"
    END_TITLE            = "퀴즈 종료"
    END_DESC             = "{display}\n**정답 :** {answer}"


# ──────────────────────────────────────────────────────────────────────────────
# 선착순
# ──────────────────────────────────────────────────────────────────────────────
class FIRST_CLICK:
    DEFAULT_TITLE  = "선착순 한 마리"
    BTN_LABEL      = "버튼"
    BODY_WAITING   = "누구보다 빠르게 버튼 누르는 사람은 누굴까\n\n**당첨자**\n아직없"
    BODY_WON       = "누구보다 빠르게 버튼 누르는 사람은 누굴까\n\n**당첨자:**\n{mention}"
    ALREADY_DONE   = "안타까운 청년, 이미 끝났습니다."
    ALREADY_TITLE  = "아쉽냐?ㅋ"
    RESULT_TITLE   = "당첨"
    RESULT_DESC    = "{mention} ← 가장 빠른 청년"


# ──────────────────────────────────────────────────────────────────────────────
# 프로필 (/프로필쀼)
# ──────────────────────────────────────────────────────────────────────────────
class PROFILE:
    TITLE             = "{name} 님의 프로필"
    F_NAME            = "이름 (아이디)"
    F_DISPLAY         = "표시 이름"
    F_NICK            = "별명"
    F_CREATED         = "계정 생성일"
    F_JOINED          = "서버 가입일"
    F_BOOST           = "서버 부스트"
    F_ROLES           = "역할 ({n}개)"
    F_PERMS           = "주요 권한"
    NONE              = "없음"
    DATE_LINE         = "{full}\n({rel})"
    ROLES_MORE        = " 외 {n}개"
    PERM_ADMIN        = "관리자 (모든 권한)"
    PERM_NONE         = "특별한 권한 없음"
    BTN_MORE          = "더보기"
    BTN_LESS          = "접기"
    GUILD_ONLY        = "서버 채널에서만 사용할 수 있습니다."
    # 표시할 주요 권한 (위→아래 순서로 매칭). 키 = discord.Permissions 속성명
    PERM_LABELS = {
        "manage_guild":      "서버 관리",
        "manage_roles":      "역할 관리",
        "manage_channels":   "채널 관리",
        "manage_messages":   "메시지 관리",
        "kick_members":      "추방",
        "ban_members":       "차단",
        "moderate_members":  "타임아웃",
        "manage_nicknames":  "별명 관리",
        "manage_webhooks":   "웹훅 관리",
        "manage_events":     "이벤트 관리",
        "mention_everyone":  "everyone 멘션",
    }


# ──────────────────────────────────────────────────────────────────────────────
# 국민투표
# ──────────────────────────────────────────────────────────────────────────────
class VOTE:
    TITLE               = "국민투표"
    RANGE_ERROR         = "참가 인원은 {min}~{max}명, 제한 시간은 {min_t}~{max_t}초여야 합니다."
    BOARD_TITLE         = "국민투표 진행 중 ({timestamp} 종료)"
    BOARD_DESC          = "아래 버튼을 눌러 투표하세요. 자기 자신에겐 투표할 수 없습니다."
    VOTE_ROW            = "{mention}  —  **{count}표**"
    BTN_LABEL           = "@{name}"
    BTN_END             = "투표 종료"
    BTN_END_NO_PERM     = "투표를 연 사람만 종료할 수 있습니다."
    BTN_END_NO_PERM_TITLE = "X 권한 없음"
    ALREADY_VOTED       = "이미 해당 참가자에게 투표했습니다."
    ALREADY_VOTED_TITLE = "X 중복 투표"
    SELF_VOTE           = "자기 자신에겐 투표할 수 없습니다."
    SELF_VOTE_TITLE     = "X 자기투표"
    NOT_PARTICIPANT     = "참가자만 투표할 수 있습니다."
    NOT_PARTICIPANT_TITLE = "X 투표 불가"
    RESULT_TITLE        = "국민투표 결과"
    RESULT_WINNER       = "우승자"
    RESULT_DRAW         = "무승부"
    RESULT_DRAW_DESC    = "동점으로 무승부입니다."
    RESULT_NO_VOTES     = "투표 없음"
    RESULT_BOARD_TITLE  = "최종 득표"
    TIMEOUT_NOTICE      = "⏱ 투표 시간이 종료되었습니다."

    # 참가 시 공약 입력 모달 (선택 — 비우면 공약 없음)
    PLEDGE_MODAL_TITLE       = "공약 입력 (선택)"
    PLEDGE_INPUT_LABEL       = "공약"
    PLEDGE_INPUT_PLACEHOLDER = "당선되면 무엇을 하실 건가요? (비워두면 공약 없음)"
    PLEDGE_LINE              = "> 📜 {pledge}"
    PLEDGE_NONE              = "공약 없음"


# ──────────────────────────────────────────────────────────────────────────────
# 탕수육게임
# ──────────────────────────────────────────────────────────────────────────────
class TANGSUYUK:
    TITLE        = "탕수육게임"
    START_DESC   = "지금부터 탕수육게임을 시작합니다!\n`탕` → `수` → `육` 순서대로 입력하세요."
    SEQUENCE     = ("탕", "수", "육")   # 고정 데이터: 순서 인덱싱·멤버십용 (랜덤 제외 → tuple)
    FAIL_TITLE   = "탕수육게임 종료"
    FAIL_DESC    = "{mention} ← 틀려서 게임을 망친 한심한 청년"

    # 오타 감지: 한 글자이고 초성이 ㅌ/ㅅ/ㅇ 중 하나이지만 정답이 아닐 때
    TYPO_CHOSUNG   = {"ㅌ", "ㅅ", "ㅇ"}
    # 오타 시 나올 랜덤 메시지 ({mention}, {word} 사용 가능)
    TYPO_MESSAGES  = [
        "오타낸 청년",
        "우승한 청년||라고할뻔||",
        "{word}{word}{word}{word}{word}{word}{word}",
        "우와!!!!!!이게뭐야~???????????????????!!!!!!!!!!!!",
        "{word}레전드!!!!!!!!!!!!",
        "{word}두쫀쿠!!!!!!!!!!!!!!!!!!!!!!!!!",
        "님완전천재시내오",
        "나국어국문학과국문어인데개추눌렀다",
    ]


# ──────────────────────────────────────────────────────────────────────────────
# 별명 관리
# ──────────────────────────────────────────────────────────────────────────────
class NICKNAME:
    SET_PROGRESS_TITLE   = "뚜따이 중..."
    SET_DONE_TITLE       = "O 뚜따이 완료"
    SET_DONE_DESC        = "별명을 **{nick}**(으)로 뚜따이 했습니다.\n완료 : {ok} / 실패 : {fail}"
    RESET_PROGRESS_TITLE = "바사삭 중..."
    RESET_DONE_TITLE     = "O 바사삭 완료"
    RESET_DONE_DESC      = "모든 별명을 바사삭 했습니다.\n완료 : {ok} / 실패 : {fail}"
    PROGRESS_DESC        = "전체 : {total}\n완료 : {ok}\n실패 : {fail}"


# ──────────────────────────────────────────────────────────────────────────────
# 채널/역할 관리
# ──────────────────────────────────────────────────────────────────────────────
class MODERATION:
    SLOWMODE_SET_TITLE  = "O 슬로우모드 설정"
    SLOWMODE_ON         = "{channel} 채널의 슬로우모드를 **{seconds}초**로 뿡 했습니다."
    SLOWMODE_OFF        = "{channel} 채널의 슬로우모드를 뿡 하지 못 하게 했습니다."
    SLOWMODE_FAIL       = "설정 실패: {error}"
    CHAT_TOGGLE_TITLE   = "O 권한 변경"
    CHAT_TOGGLE_DESC    = "{role}의 메시지 권한을 **{state}**으로 뻥 했습니다."
    CHAT_TOGGLE_ALLOW   = "허용"
    CHAT_TOGGLE_BLOCK   = "차단"
    CHAT_TOGGLE_FAIL    = "권한 변경 실패: {error}"
    TIMEOUT_TITLE       = "타임아웃"
    TIMEOUT_DESC        = "{mention}님을 **{seconds}초** 동안 타임아웃했습니다."
    TIMEOUT_FAIL        = "타임아웃 실패: {error}"


# ──────────────────────────────────────────────────────────────────────────────
# 타살버 (/타살버)
# ──────────────────────────────────────────────────────────────────────────────
class TASALBEO:
    ON_TITLE         = "타살버 발동"
    ON_DESC          = "{mention} 님에게 **{seconds}초** 동안 비꼬는 답장 + 반응 도배 + 별명 변경을 시전합니다"
    OFF_TITLE        = "타살버 해제"
    OFF_DESC         = "{mention} 님에 대한 타살버를 해제하고 별명을 원상복구했습니다."
    BOT_TARGET_TITLE = "X 대상 오류"
    BOT_TARGET       = "봇은 타살버 대상으로 지정할 수 없어요."
    NICKNAME         = "타살버맞"
    # 메시지마다 도배할 반응 후보 (tuple = 고정 데이터, 랜덤 처리 제외 → random.sample 로 뽑아 씀)
    REACTIONS = ("💀", "🤡", "👎", "😹", "🤓", "📉", "🫵", "😬", "🥱")
    # 비꼬는 답장 (list → 매번 무작위로 하나 선택)
    REPLIES = [
        "ㅇㅇ 그래서?",
        "와 진짜 대단하다~",
        "오~ 그런 것도 아세요?",
        "네네 다 맞는 말씀이세요~",
        "그래 너 잘났다",
        "헉 천재신가요?? (아님)",
        "음~ 그건 좀...",
        "ㅋㅋㅋㅋ 아 진짜요?",
        "관심 없는데 계속 말하네",
        "그렇구나~ (안 궁금)",
        "오 똑똑한 척 보소",
        "그 말 하려고 키보드 두드렸냐",
        "어 그래 알겠어 알겠어",
        "근데 그게 왜 중요함?",
        "혼자 신나셨네 ㅋㅋ",
        "아~ 네 (영혼 가출)",
        "그래서 결론이 뭔데",
        "오케이~ 다음 분",
        "받아쓰기 시험 보냐",
        "그 얘기 아까도 했잖아",
        "와 처음 듣는 소리네 (아니)",
        "지금 그게 자랑임?",
        "음슴체도 아까운 청년",
        "0.5초 만에 까먹음",
        "응 그것도 니 생각~",
        "팩트는 아무도 안 궁금",
        "스크롤 내리다 봤다",
        "그 정성으로 공부를 했으면",
        "리액션 해드릴게요 …. (끝)",
        "엔터 좀 아껴 써라",
        "오 길게도 쓰셨네",
        "그래 그래 다 맞아 (안 읽음)",
        "혼잣말은 일기장에",
        "캬~ 명언 나왔다 (아님)",
        "그쯤 하면 됐어",
        "또 너야?",
        "근데 아무도 안 물어봤어",
        "그래서 어쩌라고용~",
        "감탄해드리는 척 해줄게",
        "와! (성의 없음)",
    ]


# ──────────────────────────────────────────────────────────────────────────────
# 소원권
# ──────────────────────────────────────────────────────────────────────────────
class WISH:
    CHECK_TITLE         = "{name}의 소원권 현황"
    CHECK_FIELD_WISH    = "소원권"
    CHECK_FIELD_PIECE   = "소원권 조각"
    MAKE_SUCCESS_TITLE  = "O 소원권 제작 완료"
    MAKE_SUCCESS_DESC   = "소원권 **1장**을 성공적으로 만들었습니다!\n{piece_change}\n{wish_change}"
    MAKE_FAIL_TITLE     = "X 조각 부족"
    MAKE_FAIL_DESC      = "소원권 조각이 부족합니다.\n보유: **{have}개** / 필요: **{need}개**"
    USE_NONE_TITLE      = "X 소원권 없음"
    USE_NONE_DESC       = "사용할 소원권이 없습니다."
    USE_SUCCESS_TITLE   = "O 소원권 사용 완료"
    USE_SUCCESS_DESC    = "소원권을 사용했습니다!\n{change}"
    USE_DELIVER_TITLE   = "소원권 사용"
    WASTE_NONE_TITLE    = "X 소원권 없음"
    WASTE_NONE_DESC     = "낭비할 소원권이 없습니다. 낭비도 있어야 하는 법!"
    WASTE_SUCCESS_TITLE = "소원권 낭비"
    WASTE_SUCCESS_DESC  = [
        "# 🤸\n[{change}]",
        "# 대체 왜요..?\n[{change}]",
        "# ㄹㅈㄷ 소비습관\n[{change}]",
        "# 대박적이다\n[{change}]",
        "# 애룽\n[{change}]",
        "# 축하합니다!\n[{change}]",
        "# 감사해요\n[{change}]",
        "# 대체\n[{change}]",
        "# 소원권을 낭비하셨습니다\n[{change}]",
        "# ㄹㅈㄷ\n[{change}]"
    ]
    USE_CH_INVALID_TITLE = "X 채널 오류"
    USE_CH_NOT_TEXT     = "설정된 채널이 텍스트 채널이 아닙니다. 관리자에게 재설정을 요청하세요."
    USE_CH_NO_PERM      = "봇이 {channel} 채널에 메시지를 보낼 권한이 없습니다."
    USE_CH_NOT_SET      = (
        "소원 전달 채널이 설정되지 않았습니다.\n"
        "관리자가 `/소원권 전달채널설정` 명령어로 먼저 채널을 지정해야 합니다."
    )
    USE_CH_NOT_FOUND    = "설정된 소원 전달 채널을 찾을 수 없습니다. 삭제되었을 수 있어요."

    # 채널 설정 관련
    SET_CHANNEL_TITLE   = "O 전달 채널 설정"
    SET_CHANNEL_DESC    = "소원이 전달될 채널이 {channel}(으)로 설정되었습니다."
    SET_CHANNEL_FAIL_PERM_TITLE = "X 설정 실패"
    SET_CHANNEL_FAIL_PERM = "봇이 {channel} 채널에 메시지를 보낼 권한이 없어 설정할 수 없습니다."
    GIVE_TITLE          = "O 소원권 지급"
    GIVE_HEADER         = "**{amount}장**씩 지급"
    GIVE_LINE           = "{mention}: {before}장 → **{after}장**"
    TAKE_TITLE          = "O 소원권 회수"
    TAKE_HEADER         = "소원권 **{amount}장**씩 회수"
    TAKE_LINE           = "{mention}: {before}장 → **{after}장**"
    PIECE_GIVE_TITLE    = "O 조각 지급"
    PIECE_GIVE_HEADER   = "**{amount}개**씩 지급"
    PIECE_GIVE_LINE     = "{mention}: {before}개 → **{after}개**"
    PIECE_TAKE_TITLE    = "O 조각 회수"
    PIECE_TAKE_HEADER   = "조각 **{amount}개**씩 회수"
    PIECE_TAKE_LINE     = "{mention}: {before}개 → **{after}개**"
    BULK_NO_USERS       = "유효한 유저를 찾을 수 없습니다. (멘션 또는 ID를 공백으로 구분해 입력)"
    BULK_NO_USERS_TITLE = "X 유저 없음"

    # 수락/거절 승인 시스템
    BTN_ACCEPT          = "수락"
    BTN_REJECT          = "거절"
    ACCEPTED_FIELD      = "O 수락됨"
    ACCEPTED_VALUE      = "{mod_mention}님이 수락했습니다."
    REJECTED_FIELD      = "X 거절됨"
    REJECTED_VALUE      = "{mod_mention}님이 거절했습니다. 소원권은 환불되었습니다.\n{change}"
    USE_REFUND_TITLE    = "X 전송 실패 — 소원권 환불"
    USE_REFUND_DESC     = "전달 채널에 보낼 수 없어 소원권을 환불했습니다.\n{change}"
    NO_PERM_APPROVE     = "관리자만 수락/거절할 수 있습니다."
    NO_PERM_APPROVE_TITLE = "X 권한 없음"
    ALREADY_PROCESSED   = "이미 처리된 소원입니다."
    ALREADY_PROCESSED_TITLE = "X 처리 완료"


# ──────────────────────────────────────────────────────────────────────────────
# 소원권 / 조각 랭킹
# ──────────────────────────────────────────────────────────────────────────────
class RANK:
    TITLE              = "{guild_name} {kind_label} 랭킹"
    EMPTY              = "표시할 데이터가 없습니다."
    KIND_WISH_LABEL    = "소원권"
    KIND_PIECE_LABEL   = "소원권 조각"
    KIND_WISH_OPTION   = "소원권 (장)"
    KIND_PIECE_OPTION  = "조각 (개)"
    SELECT_PLACEHOLDER = "랭킹 종류 선택"
    BTN_PREV           = "◀ 이전"
    BTN_NEXT           = "다음 ▶"
    LINE               = "{rank_mark} {name} — **{count}{unit}**"
    LEFT_SERVER_NAME   = "(퇴서버) {uid}"
    FOOTER             = "페이지 {page}/{total_pages}  •  총 {n}명"
    NOT_INVOKER_TITLE  = "X 권한 없음"
    MEDALS             = {1: "🥇", 2: "🥈", 3: "🥉"}
    RANK_MARK_DEFAULT  = "`{n}.`"
    OPTION_DESC_TOP    = "1위 {name} {count}{unit} • 총 {n}명"
    OPTION_DESC_EMPTY  = "데이터 없음"


# ──────────────────────────────────────────────────────────────────────────────
# 디버그 명령어
# ──────────────────────────────────────────────────────────────────────────────
class DEBUG:
    PING_TITLE           = "Pong!"
    PING_DESC            = "웹소켓 레이턴시: **{ms}ms**"
    STATUS_TITLE         = "봇 상태"
    STATUS_F_UPTIME      = "업타임"
    STATUS_F_GUILDS      = "서버 수"
    STATUS_F_MEMBERS     = "멤버 수 (합계)"
    STATUS_F_BASEBALL    = "진행 중 야구"
    STATUS_F_QUIZ        = "진행 중 퀴즈"
    STATUS_F_VOTE        = "진행 중 투표"
    STATUS_F_TANGSUYUK   = "진행 중 탕수육"
    STATUS_F_LATENCY     = "레이턴시"
    STATUS_F_PYTHON      = "Python"
    STATUS_F_DISCORDPY   = "discord.py"
    STATUS_V_GUILDS      = "{count}개"
    STATUS_V_MEMBERS     = "{count}명"
    STATUS_V_GAMES       = "{count}개"
    STATUS_V_LATENCY     = "{ms}ms"
    GAMES_TITLE          = "진행 중인 게임"
    GAMES_NO_BASEBALL    = "진행 중인 야구 게임 없음"
    GAMES_NO_QUIZ        = "진행 중인 퀴즈 없음"
    GAMES_NO_VOTE        = "진행 중인 투표 없음"
    GAMES_NO_TANGSUYUK   = "진행 중인 탕수육 게임 없음"
    GAMES_BASEBALL_HDR   = "**[ 숫자야구 ]**"
    GAMES_QUIZ_HDR       = "\n**[ 퀴즈 ]**"
    GAMES_VOTE_HDR       = "\n**[ 국민투표 ]**"
    GAMES_TANGSUYUK_HDR  = "\n**[ 탕수육게임 ]**"
    GAMES_BASEBALL_LINE  = "• 서버 `{guild_id}` | {players} | 턴 {turn} | 시작됨: {started}"
    GAMES_QUIZ_LINE      = "• 채널 `{channel_id}` | {title} | 남은 시간: {time_left}s"
    GAMES_VOTE_LINE      = "• 채널 `{channel_id}` | 남은 시간: {time_left}s"
    GAMES_TANGSUYUK_LINE = "• 채널 `{channel_id}` | 카운트: {count}"
    GAMES_BASEBALL_VS    = " vs "
    KILL_NONE            = "채널 `{channel_id}`에 진행 중인 게임이 없습니다."
    KILL_NONE_TITLE      = "X 없음"
    KILL_OK              = "채널 `{channel_id}`의 **{game_name}** 게임을 강제 종료했습니다."
    KILL_OK_TITLE        = "O 종료"
    WISHDATA_TITLE       = "소원권 디버그 — {name}"
    WISHDATA_F_WISH      = "소원권"
    WISHDATA_F_PIECE     = "조각"
    WISHDATA_F_UID       = "user_id"
    WISHDATA_F_GID       = "guild_id"
    WISHALL_TITLE        = "{guild_name} 소원권 현황"
    WISHALL_NO_DATA      = "이 서버에 소원권 데이터가 없습니다."
    WISHALL_NO_DATA_TITLE = "데이터 없음"
    WISHALL_LEFT_SERVER  = "(퇴서버) {uid}"
    WISHALL_FOOTER       = "\n합계 — 소원권 **{total_w}** / 조각 **{total_p}**"
    WISHALL_LINE         = "`{name}` — 소원권 **{w}** / 조각 **{p}**"
    WISHALL_TRUNCATED    = "\n…(이하 생략)"
    WISHSET_TITLE        = "O 소원권 직접 설정"
    WISHSET_DESC         = "{mention}\n소원권: {old_w} → **{new_w}**\n조각: {old_p} → **{new_p}**"
    SYNC_PROGRESS        = "슬래시 커맨드 동기화 중..."
    SYNC_PROGRESS_TITLE  = "동기화"
    SYNC_DONE            = "**{count}개** 명령어를 동기화했습니다."
    SYNC_DONE_TITLE      = "O 동기화 완료"
    RELOAD_DONE          = "`wishes.json` 로드 완료\n서버 수: **{guilds}** / 유저 수: **{users}**"
    RELOAD_DONE_TITLE    = "O wishes.json 리로드"
    ECHO_FAIL            = "{channel}에 메시지 전송 권한이 없습니다."
    SIM_PASS_TITLE       = "O SIM 통과"
    SIM_FAIL_TITLE       = "X SIM 실패"
    SIM_ERR_TITLE        = "X SIM 오류"
    SIM_CHECK            = "[SIM] {name}의 소원권 현황"
    SIM_CHECK_F_WISH     = "소원권"
    SIM_CHECK_F_PIECE    = "조각"
    SIM_MAKE_FAIL        = "[SIM] {name}: 조각 부족 ({have}/{need})"
    SIM_MAKE_OK          = "[SIM] {name}: 소원권 제작 가능 (조각 {pieces}개)"
    SIM_USE_FAIL         = "[SIM] {name}: 소원권 없음"
    SIM_USE_OK           = "[SIM] {name}: 소원권 사용 가능\n내용: `{content}`"
    SIM_USE_EMPTY        = "(내용 없음)"
    SIM_UNKNOWN          = "알 수 없는 action: `{action}`\n사용 가능: `wish_check`, `wish_make`, `wish_use [내용]`"
    ERROR_LOG_TITLE      = "에러 로그"
    ERROR_NONE           = "최근 에러 없음"
    ERROR_TITLE          = "최근 에러 ({total}건 누적)"
    ERROR_LINE           = "`[{time}]` **{cmd}** — {user}\n↳ {err}"
    CLEARLOG_DONE        = "에러 로그 **{count}건** 초기화 완료"
    CLEARLOG_DONE_TITLE  = "O 로그 초기화"
    BACKUP_DONE          = "백업 완료: `{path}`"
    BACKUP_DONE_TITLE    = "O 백업"
    BACKUP_FAIL          = "백업 실패: {error}"


# ──────────────────────────────────────────────────────────────────────────────
# 봇 시스템 메시지 (로그용)
# ──────────────────────────────────────────────────────────────────────────────
class SYSTEM:
    ON_READY         = "[봇] 로그인 완료: {user}  |  서버: {guilds}개"
    NICK_FAIL        = "[별명] {member} 실패: {error}"
    WISH_LOAD_FAIL   = "[소원권] 파일 로드 실패: {error}"
    WISH_SAVE_FAIL   = "[소원권] 파일 저장 실패: {error}"
    BACKUP_DONE      = "[백업] {path}"
    BACKUP_FAIL      = "[백업] 실패: {error}"


# ──────────────────────────────────────────────────────────────────────────────
# 시간 단위 (fmt_uptime)
# ──────────────────────────────────────────────────────────────────────────────
class TIME:
    DAY    = "{n}일"
    HOUR   = "{n}시간"
    MINUTE = "{n}분"
    SECOND = "{n}초"


# ──────────────────────────────────────────────────────────────────────────────
# 공통 단위 포맷
# ──────────────────────────────────────────────────────────────────────────────
class UNIT:
    COUNT = "{n}개"
    SHEET = "{n}장"


# ──────────────────────────────────────────────────────────────────────────────
# 도움말 (/봇설명, !y help)
# ──────────────────────────────────────────────────────────────────────────────
class HELP:
    # 슬래시 명령어 도움말 (/봇설명)
    SLASH_TITLE      = "📖 봇 명령어 목록"
    SLASH_DESC       = (
        "이 봇이 제공하는 슬래시 명령어 목록입니다.\n"
        "**ℹ️ 슬래시 명령(`/`)은 지정된 채널에서만 사용 가능합니다.**"
    )
    SLASH_FOOTER     = "각 명령어의 자세한 옵션은 `/` 입력 시 Discord UI에서 확인할 수 있습니다."

    # 슬래시 명령어 카테고리 필드 제목
    CAT_GAME         = "🎮 게임"
    CAT_MOD          = "🛠️ 관리"
    CAT_WISH         = "✨ 소원권"
    CAT_INFO         = "ℹ️ 정보"

    # 항목 포맷
    SLASH_ROW        = "`/{name}` — {desc}"
    PREFIX_ROW       = "`!y {name}` — {desc}"

    # 디버그 도움말 (!y help)
    DEBUG_TITLE      = "🔧 디버그 명령어 목록"
    DEBUG_DESC       = (
        "관리자 또는 봇 소유자만 사용할 수 있는 디버그/관리용 명령어입니다.\n"
        "모든 명령은 `!y` 접두어로 시작합니다."
    )
    DEBUG_FOOTER     = "예시: `!y status`, `!y kill 1234567890`"

    # 디버그 명령어 카테고리
    DCAT_STATUS      = "📊 상태 확인"
    DCAT_GAME_CTRL   = "🎮 게임 제어"
    DCAT_WISH_MGMT   = "✨ 소원권 관리"
    DCAT_BOT_MGMT    = "⚙️ 봇 관리"
    DCAT_LOG         = "📝 로그"


# ──────────────────────────────────────────────────────────────────────────────
# 디버그 명령어 설명 사전 (!y help에서 사용)
# 형식: { "명령어명": ("사용법", "설명") }
# ──────────────────────────────────────────────────────────────────────────────
DEBUG_COMMANDS = {
    # 상태 확인
    "ping":      ("ping",                 "봇의 웹소켓 레이턴시(ms)를 확인합니다."),
    "status":    ("status",               "봇 업타임, 서버/멤버 수, 진행 중 게임 등을 표시합니다."),
    "games":     ("games",                "현재 진행 중인 모든 게임 목록을 보여줍니다."),

    # 게임 제어
    "kill":      ("kill [채널ID]",        "현재(또는 지정) 채널의 진행 중 게임을 강제 종료합니다."),

    # 소원권 관리
    "wishdata":  ("wishdata [@유저]",     "유저의 소원권/조각 데이터를 확인합니다. (본인 기본)"),
    "wishall":   ("wishall",              "서버의 모든 유저 소원권 현황을 조회합니다."),
    "wishset":   ("wishset @유저 W P",    "유저의 소원권(W)/조각(P) 수치를 직접 설정합니다."),
    "backup":    ("backup",               "wishes.json을 수동으로 백업합니다."),
    "reload":    ("reload",               "wishes.json을 다시 로드해 통계를 확인합니다."),

    # 봇 관리
    "sync":      ("sync [here|global|clear|nuke]", "슬래시 커맨드 동기화. 기본=모든 서버 즉시, here=현재 서버, global=글로벌(최대 1시간), clear=길드 복사본 제거, nuke=전체 초기화."),
    "echo":      ("echo #채널 메시지",    "지정 채널에 봇 명의로 메시지를 전송합니다."),
    "simulate":  ("simulate @유저 액션",  "특정 유저의 소원권 동작을 시뮬레이션합니다. (wish_check, wish_make, wish_use [내용])"),

    # 로그
    "error":     ("error",                "최근 에러 로그 5건을 표시합니다."),
    "clearlog":  ("clearlog",             "에러 로그를 초기화합니다."),
    "help":      ("help",                 "이 도움말을 표시합니다."),
}

# 디버그 명령어 카테고리 분류 (도움말에 섹션 단위로 표시할 때 사용)
DEBUG_CATEGORIES = [
    ("DCAT_STATUS",    ["ping", "status", "games"]),
    ("DCAT_GAME_CTRL", ["kill"]),
    ("DCAT_WISH_MGMT", ["wishdata", "wishall", "wishset", "backup", "reload"]),
    ("DCAT_BOT_MGMT",  ["sync", "echo", "simulate"]),
    ("DCAT_LOG",       ["error", "clearlog", "help"]),
]


# ──────────────────────────────────────────────────────────────────────────────
# list 로 정의된 메시지 → 자동 랜덤 선택 적용
# (위 메시지 클래스 속성을 ["...", "..."] 처럼 list 로 적으면 매번 무작위로 출력된다)
# ──────────────────────────────────────────────────────────────────────────────
_enable_random_messages(
    CMD, ERR, RECRUIT, ROULETTE, BASEBALL, QUIZ, FIRST_CLICK, VOTE,
    TANGSUYUK, NICKNAME, MODERATION, TASALBEO, WISH, RANK, DEBUG, SYSTEM, TIME, UNIT, HELP,
)