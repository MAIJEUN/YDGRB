import netcounter  # 대시보드 네트워크 계측 (config.NETCOUNTER_ENABLED 로 on/off, 아래에서 start)

import asyncio
import base64
import contextlib
import contextvars
import functools
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import platform
import random
import re
import shutil
import time
from collections import Counter
from datetime import timedelta, datetime
from pathlib import Path

import discord
from discord import app_commands
from discord.ext import commands
from discord.ui import Button, Select, View, Modal, TextInput
from discord.utils import utcnow

from config import (
    TOKEN, ALLOWED_CHANNEL_ID, WISH_FILE, WISH_PENDING_FILE, SETTINGS_FILE,
    WISH_BACKUP_DIR, WISH_BACKUP_KEEP, OWNER_IDS,
    PIECES_PER_WISH,
    ROULETTE_MAX_PLAYERS, ROULETTE_RECRUIT_TIMEOUT, ROULETTE_SCHEDULE,
    BASEBALL_RECRUIT_TIMEOUT, BASEBALL_TURN_TIMEOUT,
    BASEBALL_MAX_TURNS, BASEBALL_DEFAULT_DIGITS,
    BASEBALL_MIN_DIGITS, BASEBALL_MAX_DIGITS,
    QUIZ_MIN_TIME, QUIZ_MAX_TIME, QUIZ_DEFAULT_TIME, CHOSUNG_DEFAULT_TIME,
    VOTE_MIN_PLAYERS, VOTE_MAX_PLAYERS, VOTE_MIN_TIME, VOTE_MAX_TIME,
    VOTE_RECRUIT_TIMEOUT, VOTE_DEFAULT_TIME,
    SLOWMODE_DEFAULT_SEC, TIMEOUT_DEFAULT_SEC,
    SARCASM_DEFAULT_SEC, SARCASM_COOLDOWN_SEC, SARCASM_REACTION_COUNT, SARCASM_FILE,
    TANGSUYUK_TIMEOUT,
    ERROR_LOG_MAX,
    NETCOUNTER_ENABLED,
    LOG_MAX_BYTES, LOG_BACKUP_COUNT, LOG_INTERACTIONS,
)
from messages import (
    CMD, ERR, RECRUIT, ROULETTE, BASEBALL, QUIZ,
    VOTE, TANGSUYUK, FIRST_CLICK, PROFILE, NICKNAME, MODERATION, TASALBEO, WISH, RANK, DEBUG,
    SYSTEM, TIME, UNIT, HELP, DEBUG_COMMANDS, DEBUG_CATEGORIES,
)


# ══════════════════════════════════════════════════════════════════════════════
# ⓪ 로깅 설정
# ══════════════════════════════════════════════════════════════════════════════

Path("logs").mkdir(exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        RotatingFileHandler(
            "logs/bot.log", maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUP_COUNT,
            encoding="utf-8",
        ),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("bot")


# ══════════════════════════════════════════════════════════════════════════════
# ⓪-B 네트워크 계측 (대시보드용) — config 로 on/off
# ══════════════════════════════════════════════════════════════════════════════
# 봇이 연결을 시작하기 전(여기, 모듈 로드 시점)에 후킹을 설치해야 하므로 여기서 호출.
if NETCOUNTER_ENABLED:
    netcounter.start()
    log.info("netcounter: 네트워크 계측 활성화 (netstats.json 기록)")
else:
    log.info("netcounter: 비활성화됨 (config.NETCOUNTER_ENABLED=False)")


# ══════════════════════════════════════════════════════════════════════════════
# ① 초성 리스트
# ══════════════════════════════════════════════════════════════════════════════

CHOSUNG_LIST = [
    "ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ",
    "ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ",
]


# ══════════════════════════════════════════════════════════════════════════════
# ② 봇 초기화 & 런타임 상태
# ══════════════════════════════════════════════════════════════════════════════

intents = discord.Intents.default()
intents.messages = True
intents.guilds = True
intents.members = True
intents.message_content = True

bot = commands.Bot(
    command_prefix="!y ",
    intents=intents,
    owner_ids=OWNER_IDS if OWNER_IDS else None,
    help_command=None,  # 내장 help 제거 — 커스텀 !y help 사용
    allowed_mentions=discord.AllowedMentions(users=True, roles=False, everyone=False),
)

baseball_games: dict[int, dict] = {}
active_quizzes: dict[int, "QuizEngine"] = {}
active_votes:   dict[int, "VoteView"] = {}
active_tangsuyuk: dict[int, dict] = {}


# ──────────────────────────────────────────────────────────────────────────────
# 게임 레지스트리
# 새 게임 추가 시: GameRegistry.register(GameKind(...)) 한 줄만 추가하면
# is_channel_busy / !y kill / !y status / !y games 가 자동으로 반영된다.
# ──────────────────────────────────────────────────────────────────────────────

class GameKind:
    """게임 종류별 메타: 이름 + 활성 dict + 강제 종료 콜백."""
    def __init__(self, name: str, store: dict, stopper=None):
        self.name    = name      # "숫자야구"
        self.store   = store     # 채널ID → 게임상태 dict
        self.stopper = stopper   # 종료 시 게임 객체에 호출할 콜백 (None이면 pop만)

    def is_active(self, channel_id: int) -> bool:
        return channel_id in self.store

    def stop(self, channel_id: int) -> bool:
        """채널의 게임을 강제 종료. 종료됐으면 True, 진행 중인 게임이 없었으면 False."""
        game = self.store.pop(channel_id, None)
        if game is None:
            return False
        if self.stopper:
            with contextlib.suppress(Exception):
                self.stopper(game)
        return True

    def count(self) -> int:
        return len(self.store)


class GameRegistry:
    """모든 게임 종류를 한 곳에서 관리하는 중앙 레지스트리."""
    def __init__(self):
        self._kinds: list[GameKind] = []

    def register(self, kind: GameKind) -> GameKind:
        self._kinds.append(kind)
        return kind

    def __iter__(self):
        return iter(self._kinds)

    def is_busy(self, channel_id: int) -> bool:
        return any(k.is_active(channel_id) for k in self._kinds)

    def kill(self, channel_id: int) -> list[str]:
        """채널에서 진행 중인 모든 게임을 종료. 종료된 게임 이름 목록을 돌려줌."""
        return [k.name for k in self._kinds if k.stop(channel_id)]

    def total_count(self) -> int:
        return sum(k.count() for k in self._kinds)


def _stop_baseball(g):
    # 타이머 루프를 깨우기 위해 turn_event set
    if "turn_event" in g:
        g["turn_event"].set()


def _stop_event_attr(obj):
    # quiz/vote 처럼 .stop_event Event 속성을 갖는 객체용
    ev = getattr(obj, "stop_event", None)
    if ev is not None:
        ev.set()


games = GameRegistry()
GAME_BASEBALL  = games.register(GameKind("숫자야구",   baseball_games,   _stop_baseball))
GAME_QUIZ      = games.register(GameKind("퀴즈",       active_quizzes,   _stop_event_attr))
GAME_VOTE      = games.register(GameKind("국민투표",   active_votes,     _stop_event_attr))
GAME_TANGSUYUK = games.register(GameKind("탕수육게임", active_tangsuyuk))

_error_log: list[dict] = []
_bot_start_time = time.time()


# ══════════════════════════════════════════════════════════════════════════════
# ③ 공통 유틸리티
# ══════════════════════════════════════════════════════════════════════════════

# 현재 명령어를 사용한 유저를 저장하는 contextvar.
# 슬래시 명령(easter_egg), prefix 명령(before_invoke)에서 설정하며,
# 아래 monkey-patch에서 Embed footer를 자동 부착할 때 참조한다.
_invoker_var: contextvars.ContextVar = contextvars.ContextVar("invoker", default=None)


def _attach_footer(embed: discord.Embed, user) -> None:
    if embed is None or user is None:
        return
    if embed.footer and embed.footer.text:
        return
    name = getattr(user, "display_name", None) or getattr(user, "name", str(user))
    icon_url = None
    avatar = getattr(user, "display_avatar", None)
    if avatar is not None:
        icon_url = getattr(avatar, "url", None)
    embed.set_footer(text=name, icon_url=icon_url)


def _apply_footer_to_kwargs(kwargs: dict, user) -> None:
    if user is None:
        return
    e = kwargs.get("embed")
    if isinstance(e, discord.Embed):
        _attach_footer(e, user)
    es = kwargs.get("embeds")
    if es:
        for item in es:
            if isinstance(item, discord.Embed):
                _attach_footer(item, user)


def _resolve_invoker(interaction) -> object | None:
    """
    슬래시 명령을 친 원래 사용자를 돌려준다.
    버튼/셀렉트 같은 component interaction은 interaction.user가 클릭한 사람이라서
    그대로 쓰면 footer가 잘못 표시된다.
    대신 message.interaction_metadata.user 를 우선 본다.
    """
    if interaction is None:
        return None
    msg = getattr(interaction, "message", None)
    if msg is not None:
        meta = getattr(msg, "interaction_metadata", None)
        if meta is not None:
            u = getattr(meta, "user", None)
            if u is not None:
                return u
    return getattr(interaction, "user", None)


def _install_embed_footer_hooks() -> None:
    _orig_resp_send = discord.InteractionResponse.send_message
    _orig_resp_edit = discord.InteractionResponse.edit_message
    _orig_inter_edit = discord.Interaction.edit_original_response
    _orig_msg_edit   = discord.Message.edit
    _orig_webhook_send = discord.Webhook.send
    _orig_messageable_send = discord.abc.Messageable.send

    async def _patched_resp_send(self, *args, **kwargs):
        user = _resolve_invoker(getattr(self, "_parent", None)) or _invoker_var.get()
        if user is not None:
            _invoker_var.set(user)
        _apply_footer_to_kwargs(kwargs, user)
        return await _orig_resp_send(self, *args, **kwargs)

    async def _patched_resp_edit(self, *args, **kwargs):
        user = _resolve_invoker(getattr(self, "_parent", None)) or _invoker_var.get()
        if user is not None:
            _invoker_var.set(user)
        _apply_footer_to_kwargs(kwargs, user)
        return await _orig_resp_edit(self, *args, **kwargs)

    async def _patched_inter_edit(self, *args, **kwargs):
        user = _resolve_invoker(self) or _invoker_var.get()
        if user is not None:
            _invoker_var.set(user)
        _apply_footer_to_kwargs(kwargs, user)
        return await _orig_inter_edit(self, *args, **kwargs)

    async def _patched_msg_edit(self, *args, **kwargs):
        _apply_footer_to_kwargs(kwargs, _invoker_var.get())
        return await _orig_msg_edit(self, *args, **kwargs)

    async def _patched_webhook_send(self, *args, **kwargs):
        _apply_footer_to_kwargs(kwargs, _invoker_var.get())
        return await _orig_webhook_send(self, *args, **kwargs)

    async def _patched_messageable_send(self, *args, **kwargs):
        _apply_footer_to_kwargs(kwargs, _invoker_var.get())
        return await _orig_messageable_send(self, *args, **kwargs)

    discord.InteractionResponse.send_message     = _patched_resp_send
    discord.InteractionResponse.edit_message     = _patched_resp_edit
    discord.Interaction.edit_original_response   = _patched_inter_edit
    discord.Message.edit                         = _patched_msg_edit
    discord.Webhook.send                         = _patched_webhook_send
    discord.abc.Messageable.send                 = _patched_messageable_send


_install_embed_footer_hooks()


def emb(
    description: str,
    *,
    title: str = "",
    color: discord.Color | None = None,
    success: bool | None = None,
) -> discord.Embed:
    if color is None:
        if success is True:    color = discord.Color.green()
        elif success is False: color = discord.Color.red()
        else:                  color = discord.Color.blurple()
    return discord.Embed(title=title, description=description, color=color)


# ──────────────────────────────────────────────────────────────────────────────
# 응답 헬퍼 — slash interaction / prefix context 모두 동일 호출 인터페이스
# ──────────────────────────────────────────────────────────────────────────────

async def reply(
    target,
    description: str,
    *,
    title: str = "",
    success: bool | None = None,
    color: discord.Color | None = None,
    ephemeral: bool = False,
) -> None:
    """
    slash interaction(`discord.Interaction`)이든 prefix `commands.Context`든
    동일한 시그니처로 임베드 응답을 보낸다.
    interaction이 이미 응답된 상태면 자동으로 followup 사용.
    ephemeral은 interaction일 때만 의미 있음.
    """
    e = emb(description, title=title, color=color, success=success)
    if isinstance(target, discord.Interaction):
        if target.response.is_done():
            with contextlib.suppress(Exception):
                await target.followup.send(embed=e, ephemeral=ephemeral)
        else:
            await target.response.send_message(embed=e, ephemeral=ephemeral)
    else:
        # commands.Context 또는 channel 등 .send() 가능한 객체
        await target.send(embed=e)


async def reply_error(
    target,
    description: str,
    *,
    title: str | None = None,
    ephemeral: bool = True,
) -> None:
    """오류 응답 (기본 ephemeral=True, 기본 title=ERR.TITLE)."""
    await reply(
        target, description,
        title=title if title is not None else ERR.TITLE,
        success=False,
        ephemeral=ephemeral,
    )


async def reply_success(
    target,
    description: str,
    *,
    title: str = "",
    ephemeral: bool = False,
) -> None:
    """성공 응답 (기본 ephemeral=False)."""
    await reply(target, description, title=title, success=True, ephemeral=ephemeral)


async def reply_info(
    target,
    description: str,
    *,
    title: str = "",
    color: discord.Color | None = None,
    ephemeral: bool = False,
) -> None:
    """일반/안내 응답."""
    await reply(target, description, title=title, color=color, ephemeral=ephemeral)


def fmt_uptime(seconds: float) -> str:
    d, r = divmod(int(seconds), 86400)
    h, r = divmod(r, 3600)
    m, s = divmod(r, 60)
    parts = []
    if d: parts.append(TIME.DAY.format(n=d))
    if h: parts.append(TIME.HOUR.format(n=h))
    if m: parts.append(TIME.MINUTE.format(n=m))
    parts.append(TIME.SECOND.format(n=s))
    return " ".join(parts)


def get_chosung(word: str) -> str:
    result = ""
    for ch in word:
        if "가" <= ch <= "힣":
            result += CHOSUNG_LIST[(ord(ch) - 0xAC00) // 588]
        else:
            result += ch
    return result


def compute_baseball(secret: str, guess: str) -> tuple[int, int, int]:
    """
    Strike/Ball/Out 계산.
    중복 숫자가 있어도 올바르게 동작하도록 Counter의 교집합 사용.
    """
    strike = sum(g == s for g, s in zip(guess, secret))
    # 숫자별 일치 개수의 합 = strike + ball
    common = sum((Counter(guess) & Counter(secret)).values())
    ball = common - strike
    out = len(guess) - strike - ball
    return strike, ball, out


def log_error(cmd: str, user: str, err: str):
    _error_log.append({"time": time.strftime("%H:%M:%S"), "cmd": cmd, "user": user, "err": err})
    if len(_error_log) > ERROR_LOG_MAX:
        _error_log.pop(0)


def is_channel_busy(channel_id: int) -> bool:
    """어느 게임이든 해당 채널에서 진행 중이면 True."""
    return games.is_busy(channel_id)


def normalize_answer(text: str) -> str:
    """퀴즈 정답 비교용: 앞뒤 공백 제거 + 내부 공백 정규화."""
    return " ".join(text.split()).strip()


# ══════════════════════════════════════════════════════════════════════════════
# ④ JSON 영속 저장소 (wishes / pending / settings)
# ══════════════════════════════════════════════════════════════════════════════

class JsonStore:
    """
    JSON 파일에 대한 락 + 원자적 읽기/쓰기 트랜잭션을 캡슐화.

    사용법:
        store = JsonStore(Path("foo.json"), name="foo")
        async with store.transaction() as data:
            data["x"] = 1
        snapshot = await store.load_readonly()
    """

    def __init__(self, path: Path, *, name: str = ""):
        self.path  = path
        self.name  = name or path.stem
        self._lock = asyncio.Lock()

    def _read_sync(self) -> dict:
        if not self.path.exists():
            return {}
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            log.error(f"[{self.name}] 파일 로드 실패: {e}")
            return {}

    def _write_sync(self, data: dict):
        # 원자적 쓰기: 임시 파일에 쓴 뒤 rename.
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            os.replace(tmp, self.path)
        except OSError as e:
            log.error(f"[{self.name}] 파일 저장 실패: {e}")
            with contextlib.suppress(OSError):
                tmp.unlink()
            raise

    async def load_readonly(self) -> dict:
        """단순 조회용 (수정 없음)."""
        async with self._lock:
            return self._read_sync()

    @contextlib.asynccontextmanager
    async def transaction(self):
        """읽기-수정-쓰기를 하나의 락 안에서 처리. with 블록 종료 시 자동 저장."""
        async with self._lock:
            data = self._read_sync()
            yield data
            self._write_sync(data)


# 인스턴스 — 새 영속 저장소가 필요하면 여기에 인스턴스 하나만 추가하면 끝.
_wish_db     = JsonStore(WISH_FILE,         name="소원권")
_pending_db  = JsonStore(WISH_PENDING_FILE, name="pending")
_settings_db = JsonStore(SETTINGS_FILE,     name="settings")
_sarcasm_db  = JsonStore(SARCASM_FILE,      name="타살버")

# 타살버 상태 (재시작에도 별명 복구가 되도록 영속).
#   _sarcasm: { "guild_id": { "user_id": {"nick": <원래 별명|None>, "end": <종료 시각 time.time()>} } }
#   _sarcasm_last: (guild_id, user_id) → 마지막 답장 시각 (쿨다운용, 메모리 전용)
try:
    _sarcasm: dict[str, dict[str, dict]] = _sarcasm_db._read_sync()
except Exception:
    _sarcasm = {}
_sarcasm_last: dict[tuple[int, int], float] = {}


async def _sarcasm_save() -> None:
    """현재 타살버 상태를 디스크에 저장 (발동/해제/만료 시에만 호출 — 드묾)."""
    with contextlib.suppress(Exception):
        async with _sarcasm_db.transaction() as data:
            data.clear()
            data.update(_sarcasm)


async def _sarcasm_restore_nick(guild: discord.Guild | None, user_id: int, nick) -> None:
    if guild is None:
        return
    member = guild.get_member(user_id)
    if member is not None:
        with contextlib.suppress(Exception):
            await member.edit(nick=nick)


async def _sarcasm_expire(guild: discord.Guild, user_id: int, end: float) -> None:
    """end 시각까지 기다렸다가 별명 원상복구 + 대상 해제. (재실행/해제로 세션이 바뀌면 아무것도 안 함)"""
    delay = end - time.time()
    if delay > 0:
        await asyncio.sleep(delay)
    users = _sarcasm.get(str(guild.id))
    entry = users.get(str(user_id)) if users else None
    if entry is None or entry.get("end") != end:
        return   # 이미 해제됐거나 시간이 갱신됨 → 이 태스크는 무시
    users.pop(str(user_id), None)
    if not users:
        _sarcasm.pop(str(guild.id), None)
    _sarcasm_last.pop((guild.id, user_id), None)
    await _sarcasm_restore_nick(guild, user_id, entry.get("nick"))
    await _sarcasm_save()


async def _sarcasm_restore_on_start() -> None:
    """봇 시작 시: 만료된 건 즉시 별명 복구, 진행 중인 건 만료 예약 재등록."""
    now = time.time()
    changed = False
    for gid_s, users in list(_sarcasm.items()):
        guild = bot.get_guild(int(gid_s))
        for uid_s, entry in list(users.items()):
            end = entry.get("end", 0)
            if now >= end:
                await _sarcasm_restore_nick(guild, int(uid_s), entry.get("nick"))
                users.pop(uid_s, None)
                changed = True
            elif guild is not None:
                bot.loop.create_task(_sarcasm_expire(guild, int(uid_s), end))
        if not users:
            _sarcasm.pop(gid_s, None)
            changed = True
    if changed:
        await _sarcasm_save()


# ── 기존 코드 호환 래퍼 (외부 호출부는 함수명을 그대로 쓰면 됨) ──
async def wish_load_readonly() -> dict:        return await _wish_db.load_readonly()
def        wish_transaction():                 return _wish_db.transaction()
async def pending_load_readonly() -> dict:     return await _pending_db.load_readonly()
def        pending_transaction():              return _pending_db.transaction()
async def settings_load_readonly() -> dict:    return await _settings_db.load_readonly()
def        settings_transaction():             return _settings_db.transaction()


def wish_get_user(data: dict, guild_id: int | str, user_id: int | str) -> dict:
    return (
        data
        .setdefault(str(guild_id), {})
        .setdefault("users", {})
        .setdefault(str(user_id), {"wishes": 0, "pieces": 0})
    )


# ──────────────────────────────────────────────────────────────────────────────
# 소원권/조각 잔액 변동 — 클래스 기반
#
# 모든 지급/회수/사용/제작/직접설정은 WishWallet 의 메서드로만 처리한다.
# 각 연산은 변동 결과(WishDelta)를 돌려주고, 호출부는 그 객체의 fmt_change()
# 로 "변동 전 → 변동 후" 라인을 메시지에 그대로 끼워 넣을 수 있다.
# ──────────────────────────────────────────────────────────────────────────────

class WishDelta:
    """단일 항목(wishes 또는 pieces)에 대한 변동 결과."""
    KIND_WISH  = "wishes"
    KIND_PIECE = "pieces"

    def __init__(self, kind: str, before: int, after: int, requested: int = 0):
        self.kind      = kind         # "wishes" | "pieces"
        self.before    = before
        self.after     = after
        self.requested = requested    # 요청한 변동량 (음수=차감, 양수=증가)

    @property
    def delta(self) -> int:
        return self.after - self.before

    @property
    def changed(self) -> bool:
        return self.before != self.after

    @property
    def unit(self) -> str:
        # 소원권은 "장", 조각은 "개"
        return "장" if self.kind == self.KIND_WISH else "개"

    def fmt_change(self) -> str:
        """`3장 → **5장**` 형식의 변동 라인."""
        u = self.unit
        return f"{self.before}{u} → **{self.after}{u}**"

    def fmt_change_labeled(self) -> str:
        """`소원권: 3장 → **5장**` 형식 (제작·직접설정처럼 항목명을 같이 보여줄 때)."""
        label = "소원권" if self.kind == self.KIND_WISH else "조각"
        return f"{label}: {self.fmt_change()}"


class WishMakeResult:
    """소원권 제작 결과."""
    def __init__(self, success: bool, *, have: int = 0,
                 piece_delta: WishDelta | None = None,
                 wish_delta:  WishDelta | None = None):
        self.success     = success
        self.have        = have            # 실패 시 보유 조각 수
        self.piece_delta = piece_delta
        self.wish_delta  = wish_delta


class WishSetResult:
    """직접 설정(wishset) 결과 — 소원권/조각 양쪽 변동."""
    def __init__(self, wish_delta: WishDelta, piece_delta: WishDelta):
        self.wish_delta  = wish_delta
        self.piece_delta = piece_delta


class WishWallet:
    """
    소원권/조각 잔액에 대한 모든 변동 연산을 모아 둔 진입점.
    내부적으로 wish_transaction() 으로 락+읽기+쓰기를 보장한다.
    """

    @staticmethod
    async def _apply(guild_id, user_id, kind: str, delta: int,
                     *, floor_zero: bool = True) -> WishDelta:
        async with wish_transaction() as data:
            ud = wish_get_user(data, guild_id, user_id)
            before = ud[kind]
            new_val = before + delta
            if floor_zero and new_val < 0:
                new_val = 0
            ud[kind] = new_val
            after = ud[kind]
        return WishDelta(kind=kind, before=before, after=after, requested=delta)

    # --- 소원권 ---
    @classmethod
    async def give_wish(cls, guild_id, user_id, amount: int) -> WishDelta:
        return await cls._apply(guild_id, user_id, WishDelta.KIND_WISH,
                                 abs(amount), floor_zero=False)

    @classmethod
    async def take_wish(cls, guild_id, user_id, amount: int) -> WishDelta:
        return await cls._apply(guild_id, user_id, WishDelta.KIND_WISH,
                                 -abs(amount), floor_zero=True)

    @classmethod
    async def use_wish(cls, guild_id, user_id) -> WishDelta | None:
        """소원권 1장 사용. 보유 0장이면 None."""
        async with wish_transaction() as data:
            ud = wish_get_user(data, guild_id, user_id)
            if ud["wishes"] <= 0:
                return None
            before = ud["wishes"]
            ud["wishes"] -= 1
            after = ud["wishes"]
        return WishDelta(WishDelta.KIND_WISH, before, after, -1)

    @classmethod
    async def refund_wish(cls, guild_id, user_id, amount: int = 1) -> WishDelta:
        """사용·거절 등으로 인한 환불."""
        return await cls.give_wish(guild_id, user_id, amount)

    # --- 조각 ---
    @classmethod
    async def give_piece(cls, guild_id, user_id, amount: int) -> WishDelta:
        return await cls._apply(guild_id, user_id, WishDelta.KIND_PIECE,
                                 abs(amount), floor_zero=False)

    @classmethod
    async def take_piece(cls, guild_id, user_id, amount: int) -> WishDelta:
        return await cls._apply(guild_id, user_id, WishDelta.KIND_PIECE,
                                 -abs(amount), floor_zero=True)

    # --- 복합 연산 ---
    @classmethod
    async def make_wish(cls, guild_id, user_id) -> WishMakeResult:
        """조각 PIECES_PER_WISH 개를 소비해 소원권 1장 제작. 부족하면 success=False."""
        async with wish_transaction() as data:
            ud = wish_get_user(data, guild_id, user_id)
            if ud["pieces"] < PIECES_PER_WISH:
                return WishMakeResult(success=False, have=ud["pieces"])
            bp, bw = ud["pieces"], ud["wishes"]
            ud["pieces"] -= PIECES_PER_WISH
            ud["wishes"] += 1
            ap, aw = ud["pieces"], ud["wishes"]
        return WishMakeResult(
            success=True,
            piece_delta=WishDelta(WishDelta.KIND_PIECE, bp, ap, -PIECES_PER_WISH),
            wish_delta =WishDelta(WishDelta.KIND_WISH,  bw, aw, +1),
        )

    @classmethod
    async def set_balance(cls, guild_id, user_id, *,
                          wishes: int, pieces: int) -> WishSetResult:
        """소원권·조각 값을 직접 지정 (음수면 0으로 절하)."""
        async with wish_transaction() as data:
            ud = wish_get_user(data, guild_id, user_id)
            ow, op = ud["wishes"], ud["pieces"]
            ud["wishes"] = max(0, wishes)
            ud["pieces"] = max(0, pieces)
            nw, np_ = ud["wishes"], ud["pieces"]
        return WishSetResult(
            wish_delta =WishDelta(WishDelta.KIND_WISH,  ow, nw, nw - ow),
            piece_delta=WishDelta(WishDelta.KIND_PIECE, op, np_, np_ - op),
        )


# ──────────────────────────────────────────────────────────────────────────────
# 복수 유저 입력 트랜스포머
# 슬래시 명령 옵션은 USER 타입이 단일 선택만 지원하므로,
# 문자열 안의 멘션(<@123>, <@!123>)과 raw ID(15자리 이상)를 파싱해서 멤버 리스트로 변환.
# ──────────────────────────────────────────────────────────────────────────────

_MEMBER_TOKEN_RE = re.compile(r"<@!?(\d+)>|(\d{15,})")


class MembersTransformer(app_commands.Transformer):
    """`유저들: @A @B 1234567890` 같은 문자열을 길드 멤버 리스트로 변환."""

    async def transform(
        self, interaction: discord.Interaction, value: str,
    ) -> list[discord.Member]:
        if not interaction.guild or not value:
            return []
        # 토큰 추출 + 순서 유지 dedup
        seen: set[int] = set()
        ids: list[int] = []
        for m in _MEMBER_TOKEN_RE.finditer(value):
            uid = int(m.group(1) or m.group(2))
            if uid not in seen:
                seen.add(uid)
                ids.append(uid)
        # 캐시(get_member)만 사용한다. fetch_member(API 호출)를 인자 해석 단계에서 여러 번 돌리면
        # 3초 ACK 제한을 넘겨 "상호작용 실패"가 날 수 있다. members 인텐트로 길드가 시작 시
        # 청크되어 멤버가 캐시되므로 일반적으로 충분하다.
        members: list[discord.Member] = []
        for uid in ids:
            member = interaction.guild.get_member(uid)
            if member is not None:
                members.append(member)
        return members


# 슬래시 옵션 어노테이션 단축형
MembersInput = app_commands.Transform[list[discord.Member], MembersTransformer]


def _format_bulk_delta(
    header: str,
    line_tmpl: str,
    deltas: list[tuple[discord.Member, WishDelta]],
    *,
    amount: int,
) -> str:
    """헤더(수량) + 유저별 변동 라인을 합쳐 임베드 description 으로 만든다."""
    lines = [
        line_tmpl.format(mention=m.mention, before=d.before, after=d.after)
        for m, d in deltas
    ]
    return header.format(amount=amount) + "\n" + "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────────
# 대기 중 소원 (wish_pending.json) — wishes.json과 별도 파일로 관리
# 구조: { "guild_id": { "message_id": {user_id, text, image_url, channel_id}, ... }, ... }
# ──────────────────────────────────────────────────────────────────────────────

def pending_store(data: dict, guild_id: int | str, message_id: int | str, payload: dict):
    """대기 중인 소원을 기록."""
    data.setdefault(str(guild_id), {})[str(message_id)] = payload


def pending_pop(data: dict, guild_id: int | str, message_id: int | str) -> dict | None:
    """대기 중인 소원을 꺼내고 제거. 없으면 None."""
    guild_data = data.get(str(guild_id))
    if not guild_data:
        return None
    payload = guild_data.pop(str(message_id), None)
    # 빈 길드 객체는 정리
    if not guild_data:
        data.pop(str(guild_id), None)
    return payload


def pending_all(data: dict) -> list[tuple[str, str, dict]]:
    """모든 대기 중 소원. [(guild_id, message_id, payload), ...]"""
    result = []
    for gid, gdata in data.items():
        for mid, payload in gdata.items():
            result.append((gid, mid, payload))
    return result


# ──────────────────────────────────────────────────────────────────────────────
# 서버별 설정 (settings.json)
# 구조: { "guild_id": { "wish_deliver_channel": 123456, ... }, ... }
# ──────────────────────────────────────────────────────────────────────────────

def settings_get_guild(data: dict, guild_id: int | str) -> dict:
    """길드의 설정 딕셔너리를 반환 (없으면 새로 생성)."""
    return data.setdefault(str(guild_id), {})


async def get_wish_deliver_channel_id(guild_id: int | str) -> int | None:
    """특정 길드의 소원 전달 채널 ID를 조회. 설정 없으면 None."""
    data = await settings_load_readonly()
    gdata = data.get(str(guild_id), {})
    ch_id = gdata.get("wish_deliver_channel")
    return int(ch_id) if ch_id else None


def backup_wish_file() -> Path | None:
    """wishes.json을 타임스탬프 붙여 백업. 오래된 백업은 정리."""
    if not WISH_FILE.exists():
        return None
    WISH_BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = WISH_BACKUP_DIR / f"wishes_{stamp}.json"
    shutil.copy2(WISH_FILE, dest)
    # 오래된 백업 정리
    backups = sorted(WISH_BACKUP_DIR.glob("wishes_*.json"))
    for old in backups[:-WISH_BACKUP_KEEP]:
        with contextlib.suppress(OSError):
            old.unlink()
    log.info(SYSTEM.BACKUP_DONE.format(path=dest))
    return dest


# ══════════════════════════════════════════════════════════════════════════════
# ⑤ 권한 체크
# ══════════════════════════════════════════════════════════════════════════════

_DEBUG_CMDS = {
    "ping", "status", "games", "kill",
    "wishdata", "wishall", "wishset", "sync", "reload",
    "echo", "simulate", "error", "clearlog", "backup", "help",
}


def is_debug_allowed(ctx: commands.Context) -> bool:
    if isinstance(ctx.author, discord.Member) and ctx.author.guild_permissions.administrator:
        return True
    if OWNER_IDS and ctx.author.id in OWNER_IDS:
        return True
    return False


@bot.check
async def prefix_channel_check(ctx: commands.Context) -> bool:
    if not isinstance(ctx.author, discord.Member):
        return False
    if ctx.command and ctx.command.name in _DEBUG_CMDS:
        return True
    return ctx.author.guild_permissions.administrator or ctx.channel.id == ALLOWED_CHANNEL_ID


def slash_channel_check():
    async def predicate(interaction: discord.Interaction) -> bool:
        if not isinstance(interaction.user, discord.Member):
            await reply_error(interaction, ERR.SERVER_ONLY)
            return False
        if interaction.user.guild_permissions.administrator or interaction.channel_id == ALLOWED_CHANNEL_ID:
            return True
        await reply_error(interaction, ERR.WRONG_CHANNEL)
        return False
    return app_commands.check(predicate)


async def reject_if_busy(interaction: discord.Interaction) -> bool:
    """채널 busy면 에러 메시지 보내고 True 반환 (즉 early return용)."""
    if is_channel_busy(interaction.channel_id):
        await reply_error(interaction, ERR.CHANNEL_BUSY)
        return True
    return False


# ══════════════════════════════════════════════════════════════════════════════
# ⑥ 이스터에그 데코레이터
# ══════════════════════════════════════════════════════════════════════════════

_EASTER_EGG_URL = base64.b64decode(
    "aHR0cHM6Ly9jZG4uZGlzY29yZGFwcC5jb20vYXR0YWNobWVudHMvMTQ4OTk3NTg1Mzc0Mjk0ODU0NC8xNDg5OTc1ODc2MzIwODkxMDgyLzc3MzZiNzg1ZjY1OGEzNTkuZ2lmP2V4PTY5ZDI1ZmFiJmlzPTY5ZDEwZTJiJmhtPTgzNjk2N2QxNjI3ZGI2NDUxOWM2MGVhYmFiYzZkYzZhYWI3MzgyM2RiODBlMjdmNTNhZmI1NDhlMzgyYmQxMTM="
).decode()


def easter_egg(func):
    @functools.wraps(func)
    async def wrapper(interaction: discord.Interaction, *args, **kwargs):
        _invoker_var.set(interaction.user)
        if random.random() < 0.01:
            with contextlib.suppress(Exception):
                await interaction.response.send_message(_EASTER_EGG_URL, ephemeral=True)
            return
        return await func(interaction, *args, **kwargs)
    return wrapper


@bot.before_invoke
async def _set_prefix_invoker(ctx: commands.Context):
    _invoker_var.set(ctx.author)


# ══════════════════════════════════════════════════════════════════════════════
# ⑦ 공통 모집 세션
# ══════════════════════════════════════════════════════════════════════════════

class RecruitSession:
    def __init__(
        self,
        interaction: discord.Interaction,
        title: str,
        *,
        max_players: int,
        min_players: int = 2,
        host_can_start: bool = True,
        timeout: int = 180,
        collect_pledge: bool = False,
    ):
        self.interaction    = interaction
        self.title          = title
        self.max_players    = max_players
        self.min_players    = min_players
        self.host_can_start = host_can_start
        self.timeout        = timeout
        self.collect_pledge = collect_pledge          # True면 참가 시 공약 입력 모달 표시
        self.host_id        = interaction.user.id
        self.guild          = interaction.guild
        self.players: list[int] = []
        self.pledges: dict[int, str] = {}             # user_id → 공약 (없으면 "")
        self._done          = asyncio.Event()
        self._lock          = asyncio.Lock()
        self._closed        = False

    def _embed(self, *, done: bool = False) -> discord.Embed:
        desc = RECRUIT.DONE if done else RECRUIT.DESCRIPTION.format(
            joined=len(self.players), max=self.max_players
        )
        e = discord.Embed(title=self.title, description=desc, color=0x00AE86)
        for i, pid in enumerate(self.players, start=1):
            member = self.guild.get_member(pid)
            mention = member.mention if member else f"<@{pid}>"
            e.add_field(
                name=RECRUIT.FIELD_PLAYER_NUM.format(n=i),
                value=mention,
                inline=True,
            )
        # footer는 항상 모집을 연 호스트로 고정 (참가/모달 클릭자로 바뀌지 않도록)
        host = self.guild.get_member(self.host_id) if self.guild else None
        _attach_footer(e, host)
        return e

    def _view(self, *, disabled: bool = False) -> View:
        view = View(timeout=None)
        join_disabled = disabled or len(self.players) >= self.max_players
        btn_join = Button(label=RECRUIT.BTN_JOIN, style=discord.ButtonStyle.success, disabled=join_disabled)
        btn_join.callback = self._on_join
        view.add_item(btn_join)
        if self.host_can_start:
            btn_start = Button(
                label=RECRUIT.BTN_START,
                style=discord.ButtonStyle.primary,
                disabled=disabled or len(self.players) < self.min_players,
            )
            btn_start.callback = self._on_start
            view.add_item(btn_start)
        return view

    async def _on_join(self, inter: discord.Interaction):
        # 공약 모드: 모달을 먼저 띄우고, 실제 참가 등록은 모달 제출(_finish_join)에서 처리.
        if self.collect_pledge:
            # 모달 표시 전 가벼운 사전 검사 (정식 검사는 제출 시 락 안에서 다시 한다)
            if self._closed or self._done.is_set() or len(self.players) >= self.max_players:
                return await reply_error(inter, RECRUIT.FULL, title=RECRUIT.FULL_TITLE)
            if inter.user.id in self.players:
                return await reply_error(inter, RECRUIT.ALREADY_JOINED, title=RECRUIT.ALREADY_TITLE)
            return await inter.response.send_modal(_PledgeModal(self))

        # 기본(공약 없음) 흐름 — 동시 클릭 race 방지를 위해 락 안에서 검사·append·UI갱신을 묶는다.
        async with self._lock:
            await self._register_join(inter, pledge="")

    async def _finish_join(self, inter: discord.Interaction, pledge: str):
        """공약 모달 제출 시 호출 — 락 안에서 정식 참가 등록."""
        async with self._lock:
            await self._register_join(inter, pledge=pledge)

    async def _register_join(self, inter: discord.Interaction, *, pledge: str):
        """참가 등록 공통 본체. 반드시 self._lock 을 잡은 상태에서 호출."""
        if self._closed or self._done.is_set() or len(self.players) >= self.max_players:
            return await reply_error(inter, RECRUIT.FULL, title=RECRUIT.FULL_TITLE)
        if inter.user.id in self.players:
            return await reply_error(inter, RECRUIT.ALREADY_JOINED, title=RECRUIT.ALREADY_TITLE)
        self.players.append(inter.user.id)
        if self.collect_pledge:
            self.pledges[inter.user.id] = normalize_answer(pledge)  # 공백 정규화 (빈 값이면 "")
        now_full = len(self.players) >= self.max_players
        if now_full:
            self._done.set()
        try:
            await inter.response.edit_message(
                embed=self._embed(done=now_full),
                view=self._view(disabled=now_full),
            )
        except discord.HTTPException:
            # edit 실패 시에도 player는 이미 등록됨. 원래 메시지를 다시 동기화 시도.
            with contextlib.suppress(Exception):
                await self.interaction.edit_original_response(
                    embed=self._embed(done=now_full),
                    view=self._view(disabled=now_full),
                )

    async def _on_start(self, inter: discord.Interaction):
        async with self._lock:
            if self._closed or self._done.is_set():
                return await reply_error(inter, RECRUIT.FULL, title=RECRUIT.FULL_TITLE)
            is_admin = isinstance(inter.user, discord.Member) and inter.user.guild_permissions.administrator
            if inter.user.id != self.host_id and not is_admin:
                return await reply_error(inter, ERR.NO_PERMISSION, title=ERR.NO_PERMISSION_TITLE)
            if len(self.players) < self.min_players:
                return await reply_error(
                    inter, RECRUIT.MIN_PLAYERS.format(min=self.min_players), title=RECRUIT.MIN_TITLE,
                )
            self._done.set()
            try:
                await inter.response.edit_message(embed=self._embed(done=True), view=self._view(disabled=True))
            except discord.HTTPException:
                with contextlib.suppress(Exception):
                    await self.interaction.edit_original_response(
                        embed=self._embed(done=True), view=self._view(disabled=True),
                    )

    async def run(self) -> list[int] | None:
        try:
            await self.interaction.response.send_message(embed=self._embed(), view=self._view())
            try:
                await asyncio.wait_for(self._done.wait(), timeout=self.timeout)
            except asyncio.TimeoutError:
                with contextlib.suppress(Exception):
                    await self.interaction.edit_original_response(
                        embed=emb(RECRUIT.TIMEOUT.format(timeout=self.timeout), title=RECRUIT.TIMEOUT_TITLE, success=False),
                        view=self._view(disabled=True),
                    )
                return None
            return self.players if len(self.players) >= self.min_players else None
        finally:
            # 모집 종료 후 늦은 버튼 클릭이 들어와도 FULL/이미 종료 처리되도록 닫음.
            self._closed = True


class _PledgeModal(Modal):
    """국민투표 참가 시 공약을 입력받는 모달 (선택 — 비우면 공약 없음)."""
    def __init__(self, session: "RecruitSession"):
        super().__init__(title=VOTE.PLEDGE_MODAL_TITLE)
        self._session = session
        self.pledge = TextInput(
            label=VOTE.PLEDGE_INPUT_LABEL,
            style=discord.TextStyle.paragraph,
            required=False,
            max_length=200,
            placeholder=VOTE.PLEDGE_INPUT_PLACEHOLDER,
        )
        self.add_item(self.pledge)

    async def on_submit(self, interaction: discord.Interaction):
        await self._session._finish_join(interaction, self.pledge.value or "")


async def recruit_and_validate(
    interaction: discord.Interaction,
    title: str,
    *,
    max_players: int,
    min_players: int = 2,
    host_can_start: bool = True,
    timeout: int = 180,
    min_valid: int | None = None,
    collect_pledge: bool = False,
) -> tuple[list[int], list[discord.Member], dict[int, str]] | None:
    """
    모집(`RecruitSession`) 돌리고, 길드에서 실제 조회 가능한 멤버만 추려서 돌려준다.

    - 모집 취소/시간초과 → None
    - 유효 멤버 수가 `min_valid`(생략 시 `min_players`) 미만 → NOT_ENOUGH 메시지 후 None
    - 정상 → ([player_id, ...], [discord.Member, ...], {player_id: 공약}) 튜플
      (앞 둘은 같은 순서·길이, 공약 dict는 collect_pledge=False면 빈 값으로 채워짐)
    """
    session = RecruitSession(
        interaction, title,
        max_players=max_players, min_players=min_players,
        host_can_start=host_can_start, timeout=timeout,
        collect_pledge=collect_pledge,
    )
    player_ids = await session.run()
    if not player_ids:
        return None
    pairs = [(pid, interaction.guild.get_member(pid)) for pid in player_ids]
    pairs = [(pid, m) for pid, m in pairs if m is not None]
    threshold = min_valid if min_valid is not None else min_players
    if len(pairs) < threshold:
        await reply_error(interaction.channel, RECRUIT.NOT_ENOUGH, title=RECRUIT.NOT_ENOUGH_TITLE)
        return None
    ids, members = zip(*pairs)
    pledges = {pid: session.pledges.get(pid, "") for pid in ids}
    return list(ids), list(members), pledges


# ══════════════════════════════════════════════════════════════════════════════
# ⑧ 룰렛
# ══════════════════════════════════════════════════════════════════════════════

def _roulette_slot(players: list[str], center: int, window: int = 2) -> str:
    n = len(players)
    lines = []
    for offset in range(-window, window + 1):
        name = players[(center + offset) % n]
        lines.append(f"> {name} <" if offset == 0 else f"  {name}")
    return "\n".join(lines)


def _roulette_embed(
    players: list[str], center: int, title: str,
    *, finished: bool = False, winner: str | None = None,
) -> discord.Embed:
    slot = f"```\n{_roulette_slot(players, center)}\n```"
    desc = slot + f"\n**{ROULETTE.WINNER_LABEL.format(winner=winner)}**" if (finished and winner) else slot
    return discord.Embed(
        title=title,
        description=desc,
        color=discord.Color.gold() if (finished and winner) else discord.Color.blurple(),
    )


async def _run_roulette(msg: discord.Message, players: list[str], title: str, player_ids: list[int]):
    n = len(players)
    winner_idx  = random.randint(0, n - 1)
    total_steps = sum(f for f, _ in ROULETTE_SCHEDULE)
    current     = (winner_idx - total_steps) % n

    for frames_count, sleep_time in ROULETTE_SCHEDULE:
        frames = []
        for _ in range(frames_count):
            frames.append(current)
            current = (current + 1) % n
        sections = [f"```\n{_roulette_slot(players, c)}\n```" for c in frames]
        with contextlib.suppress(discord.HTTPException):
            await msg.edit(embed=discord.Embed(
                title=title, description="\n".join(sections), color=discord.Color.blurple()
            ))
        await asyncio.sleep(sleep_time)

    winner_name    = players[winner_idx]
    winner_mention = f"<@{player_ids[winner_idx]}>"
    with contextlib.suppress(discord.HTTPException):
        await msg.edit(embed=_roulette_embed(players, winner_idx, title, finished=True, winner=winner_name))
    await msg.channel.send(embed=discord.Embed(
        title=ROULETTE.RESULT_TITLE,
        description=ROULETTE.RESULT_DESC.format(mention=winner_mention),
        color=discord.Color.gold(),
    ))


@bot.tree.command(name=CMD.ROULETTE_NAME, description=CMD.ROULETTE_DESC)
# @slash_channel_check()
@easter_egg
@app_commands.describe(사람수=CMD.ROULETTE_P_COUNT, 제목=CMD.ROULETTE_P_TITLE)
async def cmd_roulette(interaction: discord.Interaction, 사람수: int, 제목: str = ROULETTE.DEFAULT_TITLE):
    if await reject_if_busy(interaction):
        return
    if not (2 <= 사람수 <= ROULETTE_MAX_PLAYERS):
        return await reply_error(interaction, RECRUIT.RANGE_ERROR.format(max=ROULETTE_MAX_PLAYERS))
    result = await recruit_and_validate(
        interaction, 제목,
        max_players=사람수, min_players=2,
        timeout=ROULETTE_RECRUIT_TIMEOUT,
    )
    if result is None:
        return
    ids, members, _pledges = result
    names = [f"@{m.display_name}" for m in members]
    roulette_msg = await interaction.channel.send(embed=_roulette_embed(names, 0, 제목))
    await _run_roulette(roulette_msg, names, 제목, ids)


# ══════════════════════════════════════════════════════════════════════════════
# ⑨ 숫자야구
# ══════════════════════════════════════════════════════════════════════════════

class BaseballDMPad(View):
    def __init__(self, channel_id: int, channel_discord_id: int, user_id: int, length: int):
        super().__init__(timeout=None)
        self.channel_id         = channel_id
        self.channel_discord_id = channel_discord_id
        self.user_id            = user_id
        self.length             = length
        self.current            = ""
        self._rebuild_buttons()

    def _make_embed(self) -> discord.Embed:
        display     = self.current.ljust(self.length, ".")
        channel_url = f"https://discord.com/channels/0/{self.channel_discord_id}"
        e = discord.Embed(
            title=BASEBALL.DM_SETUP_TITLE,
            description=BASEBALL.DM_SETUP_DESC.format(
                display=display, remaining=self.length - len(self.current)
            ),
            color=0x5865F2,
        )
        if len(self.current) == self.length:
            e.add_field(
                name=BASEBALL.DM_SETUP_DONE_FIELD,
                value=BASEBALL.DM_RETURN_LINK.format(url=channel_url),
            )
        return e

    def _rebuild_buttons(self):
        self.clear_items()
        is_full = len(self.current) >= self.length
        for num in [str(i) for i in range(1, 10)] + ["0"]:
            btn = Button(
                label=num,
                style=discord.ButtonStyle.secondary,
                disabled=(num in self.current or is_full),
            )
            btn.callback = self._make_num_cb(num)
            self.add_item(btn)
        back_btn = Button(
            label=BASEBALL.BTN_BACK,
            style=discord.ButtonStyle.danger,
            disabled=(is_full or len(self.current) == 0),
        )
        back_btn.callback = self._on_back
        self.add_item(back_btn)

    def _make_num_cb(self, num: str):
        async def callback(interaction: discord.Interaction):
            self.current += num
            self._rebuild_buttons()
            if len(self.current) == self.length:
                game = baseball_games.get(self.channel_id)
                if game:
                    game["secrets"][self.user_id] = self.current
                    await interaction.response.edit_message(embed=self._make_embed(), view=self)
                    if len(game["secrets"]) == 2:
                        await _baseball_start_match(game)
                else:
                    # 게임이 이미 종료됨
                    await interaction.response.edit_message(embed=self._make_embed(), view=self)
            else:
                await interaction.response.edit_message(embed=self._make_embed(), view=self)
        return callback

    async def _on_back(self, interaction: discord.Interaction):
        self.current = self.current[:-1]
        self._rebuild_buttons()
        await interaction.response.edit_message(embed=self._make_embed(), view=self)


class BaseballGamePad(View):
    def __init__(self, game: dict):
        super().__init__(timeout=None)
        self.game        = game
        self._processing = False
        self.build()

    def build(self) -> "BaseballGamePad":
        self.clear_items()
        guess   = self.game["current_guess"]
        is_full = len(guess) >= self.game["length"]
        for num in [str(i) for i in range(1, 10)] + ["0"]:
            btn = Button(
                label=num,
                style=discord.ButtonStyle.secondary,
                disabled=(num in guess or is_full or self._processing),
            )
            btn.callback = self._make_num_cb(num)
            self.add_item(btn)
        back_btn = Button(
            label=BASEBALL.BTN_BACK,
            style=discord.ButtonStyle.danger,
            disabled=(len(guess) == 0 or self._processing),
        )
        back_btn.callback = self._on_back
        self.add_item(back_btn)
        return self

    def _make_num_cb(self, num: str):
        async def callback(interaction: discord.Interaction):
            if interaction.user.id != self.game["players"][self.game["turn_index"]]:
                return await reply_error(interaction, ERR.NOT_YOUR_TURN)
            if self._processing:
                return
            self._processing = True
            try:
                self.game["current_guess"] += num
                await _baseball_process_turn(self.game, interaction)
            finally:
                self._processing = False
        return callback

    async def _on_back(self, interaction: discord.Interaction):
        if interaction.user.id != self.game["players"][self.game["turn_index"]]:
            return await reply_error(interaction, ERR.NOT_YOUR_TURN)
        if self._processing:
            return
        self._processing = True
        try:
            self.game["current_guess"] = self.game["current_guess"][:-1]
            await interaction.response.edit_message(view=BaseballGamePad(self.game).build())
            await _baseball_update_table(self.game)
        finally:
            self._processing = False


def _baseball_host(game: dict):
    """게임을 시작(/숫자야구 입력)한 유저. footer 표시용. 없으면 None."""
    gid   = game.get("host_id")
    ch    = game.get("channel")
    guild = ch.guild if ch is not None else None
    return guild.get_member(gid) if (guild is not None and gid) else None


async def _baseball_update_table(game: dict):
    cur_player = game["channel"].guild.get_member(game["players"][game["turn_index"]])
    end_at     = game.get("turn_end_at")
    timestamp  = discord.utils.format_dt(end_at, "R") if end_at else ""
    embed_obj  = discord.Embed(
        title=BASEBALL.TABLE_TITLE.format(turn=game["turn_count"], timestamp=timestamp),
        color=0xFAA61A,
    )
    lines = []
    for i, h in enumerate(game["history"]):
        if i > 0 and i % 2 == 0:
            lines.append("")
        lines.append(BASEBALL.HISTORY_LINE.format(tag=h['tag'], guess=h['guess'], s=h['s'], b=h['b'], o=h['o']))
    display = game["current_guess"].ljust(game["length"], ".")
    mention = cur_player.mention if cur_player else f"<@{game['players'][game['turn_index']]}>"
    status  = BASEBALL.TABLE_TURN.format(mention=mention, display=display)
    embed_obj.description = ("\n".join(lines) if lines else BASEBALL.TABLE_START) + "\n" + status
    _attach_footer(embed_obj, _baseball_host(game))

    if game.get("table_msg"):
        try:
            await game["table_msg"].edit(embed=embed_obj)
        except Exception:
            game["table_msg"] = await game["channel"].send(embed=embed_obj)
    else:
        game["table_msg"] = await game["channel"].send(embed=embed_obj)


async def _baseball_start_match(game: dict):
    notice = await game["channel"].send(
        embed=emb(BASEBALL.BOTH_READY, title=BASEBALL.GAME_TITLE, color=discord.Color.blurple())
    )
    await asyncio.sleep(2)
    with contextlib.suppress(discord.HTTPException):
        await notice.delete()
    game["started"] = True
    game["turn_end_at"] = utcnow() + timedelta(seconds=BASEBALL_TURN_TIMEOUT)
    await _baseball_update_table(game)
    pad_view        = BaseballGamePad(game)
    game["pad_msg"] = await game["channel"].send(view=pad_view.build())
    game["turn_event"] = asyncio.Event()
    bot.loop.create_task(_baseball_turn_timer(game, game["turn_count"], game["turn_index"]))


async def _baseball_turn_timer(game: dict, turn: int, index: int):
    # 카운트다운 표시는 테이블의 타임스탬프가 담당 → 초당 edit 없이, 턴 종료까지 한 번만 대기.
    # 입력 완료/턴 변경/게임 종료 시 turn_event 가 set 되어 즉시 깨어난다.
    event = game.get("turn_event")
    if event is None:
        return
    try:
        await asyncio.wait_for(event.wait(), timeout=BASEBALL_TURN_TIMEOUT)
        return
    except asyncio.TimeoutError:
        pass

    # 타임아웃 — 상대방 승리
    if (game["channel_id"] in baseball_games
            and game["turn_count"] == turn
            and game["turn_index"] == index):
        winner_id = game["players"][(index + 1) % 2]
        timeout_embed = discord.Embed(
            title=BASEBALL.TIMEOUT_TITLE,
            description=BASEBALL.TIMEOUT_DESC.format(loser=game["players"][index], winner=winner_id),
            color=discord.Color.red(),
        )
        _attach_footer(timeout_embed, _baseball_host(game))
        await game["channel"].send(embed=timeout_embed)
        baseball_games.pop(game["channel_id"], None)


async def _baseball_process_turn(game: dict, interaction: discord.Interaction):
    guess  = game["current_guess"]
    length = game["length"]
    if len(guess) < length:
        with contextlib.suppress(discord.NotFound):
            await interaction.response.edit_message(view=BaseballGamePad(game).build())
            await _baseball_update_table(game)
        return
    try:
        disabled = BaseballGamePad(game).build()
        for item in disabled.children:
            item.disabled = True
        await interaction.response.edit_message(view=disabled)
    except discord.NotFound:
        return
    opponent_id  = game["players"][(game["turn_index"] + 1) % 2]
    s, b, o      = compute_baseball(game["secrets"][opponent_id], guess)
    game["history"].append({"tag": interaction.user.display_name, "guess": guess, "s": s, "b": b, "o": o})
    game["current_guess"] = ""
    # 기존 타이머 정지
    game.get("turn_event", asyncio.Event()).set()

    if s == length:
        await _baseball_update_table(game)
        win_embed = discord.Embed(
            title=BASEBALL.WIN_TITLE,
            description=BASEBALL.WIN_DESC.format(mention=interaction.user.mention, answer=guess),
            color=discord.Color.gold(),
        )
        _attach_footer(win_embed, _baseball_host(game))
        await interaction.edit_original_response(embed=win_embed, view=None)
        baseball_games.pop(game["channel_id"], None)
        return

    game["turn_index"] = (game["turn_index"] + 1) % 2
    if game["turn_index"] == 0:
        game["turn_count"] += 1
    if game["turn_count"] > BASEBALL_MAX_TURNS:
        await _baseball_update_table(game)
        draw_embed = emb(BASEBALL.DRAW_DESC, title=BASEBALL.DRAW_TITLE, color=discord.Color.greyple())
        _attach_footer(draw_embed, _baseball_host(game))
        await interaction.edit_original_response(embed=draw_embed, view=None)
        baseball_games.pop(game["channel_id"], None)
        return

    game["turn_event"] = asyncio.Event()
    game["turn_end_at"] = utcnow() + timedelta(seconds=BASEBALL_TURN_TIMEOUT)
    await _baseball_update_table(game)
    await interaction.edit_original_response(view=BaseballGamePad(game).build())
    bot.loop.create_task(_baseball_turn_timer(game, game["turn_count"], game["turn_index"]))


@bot.tree.command(name=CMD.BASEBALL_NAME, description=CMD.BASEBALL_DESC)
# @slash_channel_check()
@easter_egg
@app_commands.describe(자리수=CMD.BASEBALL_P_DIGITS)
async def cmd_baseball(interaction: discord.Interaction, 자리수: int = BASEBALL_DEFAULT_DIGITS):
    if await reject_if_busy(interaction):
        return
    # 자리수 범위 검증 (0~9 = 10자리가 한계)
    if not (BASEBALL_MIN_DIGITS <= 자리수 <= BASEBALL_MAX_DIGITS):
        return await reply_error(
            interaction,
            ERR.INVALID_DIGITS.format(min=BASEBALL_MIN_DIGITS, max=BASEBALL_MAX_DIGITS),
        )
    channel_id = interaction.channel_id
    result = await recruit_and_validate(
        interaction, BASEBALL.GAME_TITLE,
        max_players=2, min_players=2,
        host_can_start=False,
        timeout=BASEBALL_RECRUIT_TIMEOUT,
    )
    if result is None:
        return
    player_ids, _members, _pledges = result
    game = {
        "channel_id": channel_id, "channel": interaction.channel, "length": 자리수,
        "players": player_ids, "secrets": {}, "history": [],
        "turn_index": 0, "turn_count": 1, "current_guess": "",
        "started": False, "table_msg": None, "turn_end_at": None,
        "host_id": interaction.user.id,   # footer 표시용 (명령어 친 사람)
    }
    baseball_games[channel_id] = game
    for pid in player_ids:
        user   = await bot.fetch_user(pid)
        dm_pad = BaseballDMPad(channel_id, interaction.channel.id, pid, 자리수)
        try:
            await user.send(embed=dm_pad._make_embed(), view=dm_pad)
        except discord.Forbidden:
            await reply_error(interaction.channel, ERR.DM_CLOSED.format(user_id=pid))
            baseball_games.pop(channel_id, None)
            return


# ══════════════════════════════════════════════════════════════════════════════
# ⑩ 퀴즈 엔진
# ══════════════════════════════════════════════════════════════════════════════

class QuizEngine:
    def __init__(
        self, channel: discord.TextChannel,
        *, question: str, display: str, answer: str,
        time_limit: int, title: str = QUIZ.TITLE_DEFAULT,
    ):
        self.channel    = channel
        self.question   = question
        self.display    = display
        self.answer     = normalize_answer(answer)
        self.time_limit = time_limit
        self.title      = title
        self.msg        = None
        self.winner     = None
        # 카운트다운은 디스코드 타임스탬프(<t:..:R>)로 클라이언트가 직접 표시.
        # 봇은 초당 edit 하지 않고, 종료 시각까지 한 번만 기다린다.
        self.end_at     = utcnow() + timedelta(seconds=time_limit)
        self.stop_event = asyncio.Event()

    @property
    def time_left(self) -> int:
        """남은 시간(초) — 디버그/조회용 (표시는 타임스탬프가 담당)."""
        return max(0, int((self.end_at - utcnow()).total_seconds()))

    async def run(self):
        if self.channel.id in active_quizzes:
            return await reply_error(self.channel, ERR.CHANNEL_BUSY)
        active_quizzes[self.channel.id] = self
        self.end_at = utcnow() + timedelta(seconds=self.time_limit)  # 게시 시점 기준으로 재설정
        self.msg = await self.channel.send(embed=self._make_embed())
        try:
            await self._wait_answer()
            await self._finish()
        finally:
            active_quizzes.pop(self.channel.id, None)

    def _make_embed(self) -> discord.Embed:
        return discord.Embed(
            title=self.title,
            description=f"{self.display}\n{QUIZ.TIMER.format(timestamp=discord.utils.format_dt(self.end_at, 'R'))}",
            color=discord.Color.random(),
        )

    async def _wait_answer(self):
        def check(m: discord.Message):
            return (
                m.channel.id == self.channel.id
                and not m.author.bot
                and normalize_answer(m.content) == self.answer
            )
        # 정답 대기와 stop_event(=!y kill 등)를 동시에 기다린다 → 킬 시 즉시 종료.
        answer_task = asyncio.ensure_future(bot.wait_for("message", check=check))
        stop_task   = asyncio.ensure_future(self.stop_event.wait())
        done, pending = await asyncio.wait(
            {answer_task, stop_task},
            timeout=self.time_limit,
            return_when=asyncio.FIRST_COMPLETED,
        )
        for t in pending:
            t.cancel()
        if answer_task in done and not answer_task.cancelled():
            with contextlib.suppress(Exception):
                self.winner = answer_task.result().author
        self.stop_event.set()

    async def _finish(self):
        if self.winner:
            result = discord.Embed(
                title=QUIZ.CORRECT_TITLE,
                description=QUIZ.CORRECT_DESC.format(
                    display=self.display, answer=self.answer, mention=self.winner.mention
                ),
                color=discord.Color.green(),
            )
        else:
            result = discord.Embed(
                title=QUIZ.END_TITLE,
                description=QUIZ.END_DESC.format(display=self.display, answer=self.answer),
                color=discord.Color.red(),
            )
        # 원본 퀴즈 메시지를 결과로 갱신 + 채널에 결과를 한 번 더 알림
        # (퀴즈 메시지가 위로 밀려 안 보일 수 있어, 종료 시 새 메시지로 한 번 더 공지)
        with contextlib.suppress(discord.HTTPException):
            await self.msg.edit(embed=result)
        with contextlib.suppress(discord.HTTPException):
            await self.channel.send(embed=result)


async def _start_quiz(
    interaction: discord.Interaction,
    *,
    text: str,         # 일반: 문제, 초성: 정답 단어
    answer: str,       # 일반: 정답, 초성: 원본 단어
    time_limit: int,
    chosung: bool,
):
    """일반 퀴즈와 초성 퀴즈 공통 시작 흐름."""
    if await reject_if_busy(interaction):
        return
    if chosung:
        ch = get_chosung(text)
        question, display = ch, QUIZ.DISPLAY_CHOSUNG.format(chosung=ch)
        title             = QUIZ.TITLE_CHOSUNG
        start_msg, start_title = QUIZ.CHOSUNG_START, QUIZ.CHOSUNG_TITLE
    else:
        display  = QUIZ.DISPLAY_QUIZ.format(question=text)
        question = display
        title             = QUIZ.TITLE_DEFAULT
        start_msg, start_title = QUIZ.START_MSG, QUIZ.START_TITLE

    await reply_success(interaction, start_msg, title=start_title, ephemeral=True)
    await QuizEngine(
        interaction.channel,
        question=question, display=display,
        answer=answer,
        time_limit=max(QUIZ_MIN_TIME, min(time_limit, QUIZ_MAX_TIME)),
        title=title,
    ).run()


@bot.tree.command(name=CMD.QUIZ_NAME, description=CMD.QUIZ_DESC)
# @slash_channel_check()
@easter_egg
@app_commands.describe(
    문제=CMD.QUIZ_P_QUESTION, 정답=CMD.QUIZ_P_ANSWER,
    시간=CMD.QUIZ_P_TIME.format(default=QUIZ_DEFAULT_TIME),
)
async def cmd_quiz(interaction: discord.Interaction, 문제: str, 정답: str, 시간: int = QUIZ_DEFAULT_TIME):
    await _start_quiz(interaction, text=문제, answer=정답, time_limit=시간, chosung=False)


@bot.tree.command(name=CMD.CHOSUNG_NAME, description=CMD.CHOSUNG_DESC)
# @slash_channel_check()
@easter_egg
@app_commands.describe(
    텍스트=CMD.CHOSUNG_P_TEXT,
    시간초=CMD.CHOSUNG_P_TIME.format(default=CHOSUNG_DEFAULT_TIME),
)
async def cmd_chosung_quiz(interaction: discord.Interaction, 텍스트: str, 시간초: int = CHOSUNG_DEFAULT_TIME):
    await _start_quiz(interaction, text=텍스트, answer=텍스트, time_limit=시간초, chosung=True)


# ══════════════════════════════════════════════════════════════════════════════
# ⑪ 별명 관리
# ══════════════════════════════════════════════════════════════════════════════

async def _bulk_nickname(
    interaction: discord.Interaction,
    new_nick: str | None,
    progress_title: str,
    done_title: str,
    done_desc_template: str,
):
    guild         = interaction.guild
    total         = len(guild.members)
    success, fail = 0, 0
    embed_obj = discord.Embed(
        title=progress_title,
        description=NICKNAME.PROGRESS_DESC.format(total=total, ok=0, fail=0),
        color=discord.Color.orange(),
    )
    await interaction.response.send_message(embed=embed_obj)
    msg = await interaction.original_response()
    for member in guild.members:
        try:
            await member.edit(nick=new_nick)
            success += 1
        except Exception as ex:
            log.warning(SYSTEM.NICK_FAIL.format(member=member, error=ex))
            fail += 1
        embed_obj.description = NICKNAME.PROGRESS_DESC.format(total=total, ok=success, fail=fail)
        with contextlib.suppress(discord.HTTPException):
            await msg.edit(embed=embed_obj)
        await asyncio.sleep(0.3)
    await msg.edit(embed=discord.Embed(
        title=done_title,
        description=done_desc_template.format(ok=success, fail=fail),
        color=discord.Color.green(),
    ))


@bot.tree.command(name=CMD.NICK_SET_NAME, description=CMD.NICK_SET_DESC)
@easter_egg
@app_commands.checks.has_permissions(administrator=True)
@app_commands.describe(새별명=CMD.NICK_SET_P_NICK)
async def cmd_nickname_set(interaction: discord.Interaction, 새별명: str):
    await _bulk_nickname(
        interaction, 새별명,
        NICKNAME.SET_PROGRESS_TITLE,
        NICKNAME.SET_DONE_TITLE,
        NICKNAME.SET_DONE_DESC.replace("{nick}", 새별명),
    )


@bot.tree.command(name=CMD.NICK_RESET_NAME, description=CMD.NICK_RESET_DESC)
@easter_egg
@app_commands.checks.has_permissions(administrator=True)
async def cmd_nickname_reset(interaction: discord.Interaction):
    await _bulk_nickname(
        interaction, None,
        NICKNAME.RESET_PROGRESS_TITLE,
        NICKNAME.RESET_DONE_TITLE,
        NICKNAME.RESET_DONE_DESC,
    )


# ══════════════════════════════════════════════════════════════════════════════
# ⑫ 채널 / 역할 관리
# ══════════════════════════════════════════════════════════════════════════════

@bot.tree.command(name=CMD.SLOWMODE_NAME, description=CMD.SLOWMODE_DESC)
@easter_egg
@app_commands.describe(시간초=CMD.SLOWMODE_P_SEC.format(default=SLOWMODE_DEFAULT_SEC))
@app_commands.checks.has_permissions(manage_channels=True)
async def cmd_slowmode(interaction: discord.Interaction, 시간초: int = SLOWMODE_DEFAULT_SEC):
    try:
        await interaction.channel.edit(slowmode_delay=max(0, 시간초))
        msg = (MODERATION.SLOWMODE_OFF if 시간초 == 0 else MODERATION.SLOWMODE_ON).format(
            channel=interaction.channel.mention, seconds=시간초
        )
        await reply_success(interaction, msg, title=MODERATION.SLOWMODE_SET_TITLE, ephemeral=True)
    except Exception as ex:
        await reply_error(interaction, MODERATION.SLOWMODE_FAIL.format(error=ex))


@bot.tree.command(name=CMD.CHAT_TOGGLE_NAME, description=CMD.CHAT_TOGGLE_DESC)
@easter_egg
@app_commands.describe(역할=CMD.CHAT_TOGGLE_P_ROLE)
@app_commands.checks.has_permissions(manage_roles=True)
async def cmd_toggle_chat(interaction: discord.Interaction, 역할: discord.Role):
    overwrite = interaction.channel.overwrites_for(역할)
    if overwrite.send_messages is False:
        overwrite.send_messages = True
        상태 = MODERATION.CHAT_TOGGLE_ALLOW
    else:
        overwrite.send_messages = False
        상태 = MODERATION.CHAT_TOGGLE_BLOCK
    try:
        await interaction.channel.set_permissions(역할, overwrite=overwrite)
        await reply_success(
            interaction,
            MODERATION.CHAT_TOGGLE_DESC.format(role=역할.mention, state=상태),
            title=MODERATION.CHAT_TOGGLE_TITLE,
        )
    except Exception as ex:
        await reply_error(interaction, MODERATION.CHAT_TOGGLE_FAIL.format(error=ex))


@bot.tree.command(name=CMD.TIMEOUT_NAME, description=CMD.TIMEOUT_DESC)
@easter_egg
@app_commands.describe(
    유저=CMD.TIMEOUT_P_USER,
    시간초=CMD.TIMEOUT_P_SEC.format(default=TIMEOUT_DEFAULT_SEC),
)
@app_commands.checks.has_permissions(moderate_members=True)
async def cmd_timeout(interaction: discord.Interaction, 유저: discord.Member, 시간초: int = TIMEOUT_DEFAULT_SEC):
    try:
        until = utcnow() + timedelta(seconds=max(1, min(시간초, 2_419_200)))
        await 유저.timeout(until)
        await reply_info(
            interaction,
            MODERATION.TIMEOUT_DESC.format(mention=유저.mention, seconds=시간초),
            title=MODERATION.TIMEOUT_TITLE,
            color=discord.Color.orange(),
        )
    except Exception as ex:
        await reply_error(interaction, MODERATION.TIMEOUT_FAIL.format(error=ex))


# ══════════════════════════════════════════════════════════════════════════════
# ⑫-B 타살버 — 특정 유저 메시지에 기간 동안 비꼬는 답장
# ══════════════════════════════════════════════════════════════════════════════

@bot.listen("on_message")
async def _sarcasm_reply(message: discord.Message):
    # listen() 으로 등록 → 기본 명령 처리(on_message)를 덮어쓰지 않는다.
    if message.guild is None or message.author.bot:
        return
    users = _sarcasm.get(str(message.guild.id))
    entry = users.get(str(message.author.id)) if users else None
    if entry is None:
        return
    if time.time() >= entry.get("end", 0):       # 기간 종료 → 별명 복구 + 대상 해제 (안전망)
        users.pop(str(message.author.id), None)
        if not users:
            _sarcasm.pop(str(message.guild.id), None)
        _sarcasm_last.pop((message.guild.id, message.author.id), None)
        await _sarcasm_restore_nick(message.guild, message.author.id, entry.get("nick"))
        await _sarcasm_save()
        return
    if SARCASM_COOLDOWN_SEC > 0:                  # 쿨다운(설정 시) — 도배 빈도 제한
        key = (message.guild.id, message.author.id)
        now = time.time()
        if now - _sarcasm_last.get(key, 0.0) < SARCASM_COOLDOWN_SEC:
            return
        _sarcasm_last[key] = now
    # 비꼬는 답장
    with contextlib.suppress(discord.HTTPException):
        await message.reply(TASALBEO.REPLIES, mention_author=False)
    # 무작위 반응 도배
    k = min(SARCASM_REACTION_COUNT, len(TASALBEO.REACTIONS))
    for emoji in random.sample(TASALBEO.REACTIONS, k) if k > 0 else []:
        with contextlib.suppress(discord.HTTPException):
            await message.add_reaction(emoji)


@bot.tree.command(name=CMD.TASALBEO_NAME, description=CMD.TASALBEO_DESC)
@easter_egg
@app_commands.describe(
    유저=CMD.TASALBEO_P_USER,
    시간=CMD.TASALBEO_P_TIME.format(default=SARCASM_DEFAULT_SEC),
)
@app_commands.checks.has_permissions(manage_messages=True)
async def cmd_tasalbeo(interaction: discord.Interaction, 유저: discord.Member, 시간: int = SARCASM_DEFAULT_SEC):
    if 유저.bot:
        return await reply_error(interaction, TASALBEO.BOT_TARGET, title=TASALBEO.BOT_TARGET_TITLE)
    gid_s, uid_s = str(interaction.guild.id), str(유저.id)
    users = _sarcasm.setdefault(gid_s, {})

    if 시간 <= 0:   # 해제 → 별명 원상복구
        entry = users.pop(uid_s, None)
        if not users:
            _sarcasm.pop(gid_s, None)
        _sarcasm_last.pop((interaction.guild.id, 유저.id), None)
        if entry is not None:
            await _sarcasm_restore_nick(interaction.guild, 유저.id, entry.get("nick"))
            await _sarcasm_save()
        return await reply_success(
            interaction, TASALBEO.OFF_DESC.format(mention=유저.mention), title=TASALBEO.OFF_TITLE,
        )

    seconds = 시간   # 상한 없음 (원하는 만큼)
    end = time.time() + seconds
    if uid_s in users:
        users[uid_s]["end"] = end          # 이미 진행 중 → 시간만 연장 (원래 별명 유지)
    else:
        users[uid_s] = {"nick": 유저.nick, "end": end}   # 원래 별명 저장 후 변경
        try:
            await 유저.edit(nick=TASALBEO.NICKNAME)
        except Exception as ex:
            log.warning(f"[타살버] 별명 변경 실패 ({유저}): {ex}")
    _sarcasm_last.pop((interaction.guild.id, 유저.id), None)
    await _sarcasm_save()
    bot.loop.create_task(_sarcasm_expire(interaction.guild, 유저.id, end))
    await reply_success(
        interaction,
        TASALBEO.ON_DESC.format(mention=유저.mention, seconds=seconds),
        title=TASALBEO.ON_TITLE,
    )


# ══════════════════════════════════════════════════════════════════════════════
# ⑬ 국민투표
# ══════════════════════════════════════════════════════════════════════════════

class VoteView(View):
    def __init__(self, players: list[discord.Member], time_limit: int, host_id: int,
                 *, pledges: dict[int, str] | None = None):
        super().__init__(timeout=None)
        self.players    = players
        self.time_limit = time_limit
        # 카운트다운은 디스코드 타임스탬프(<t:..:R>)로 표시 → 초당 edit 없음.
        self.end_at     = utcnow() + timedelta(seconds=time_limit)
        self.host_id    = host_id
        self.pledges    = pledges or {}   # user_id → 공약 (없으면 "" 또는 키 없음)
        self.votes: dict[int, int] = {}
        self.tally: dict[int, int] = {m.id: 0 for m in players}
        self.stop_event = asyncio.Event()
        self.board_msg: discord.Message | None = None
        # footer 표시용: 투표를 시작한 호스트 (다른 사람이 버튼을 눌러도 footer가 안 바뀌도록)
        guild = players[0].guild if players else None
        self.host = guild.get_member(host_id) if guild is not None else None
        self._build_buttons()

    def _build_buttons(self, *, disabled: bool = False):
        self.clear_items()
        for member in self.players:
            btn = Button(
                label=VOTE.BTN_LABEL.format(name=member.display_name),
                style=discord.ButtonStyle.primary,
                custom_id=str(member.id),
                disabled=disabled,
            )
            btn.callback = self._make_vote_cb(member.id)
            self.add_item(btn)
        end_btn = Button(
            label=VOTE.BTN_END,
            style=discord.ButtonStyle.danger,
            custom_id="vote_end",
            disabled=disabled,
        )
        end_btn.callback = self._on_end
        self.add_item(end_btn)

    async def _on_end(self, interaction: discord.Interaction):
        is_admin = isinstance(interaction.user, discord.Member) and interaction.user.guild_permissions.administrator
        if interaction.user.id != self.host_id and not is_admin:
            return await reply_error(interaction, VOTE.BTN_END_NO_PERM, title=VOTE.BTN_END_NO_PERM_TITLE)
        await interaction.response.defer()
        self.stop_event.set()

    def _make_vote_cb(self, target_id: int):
        async def callback(interaction: discord.Interaction):
            voter_id = interaction.user.id
            if voter_id == target_id:
                return await reply_error(interaction, VOTE.SELF_VOTE, title=VOTE.SELF_VOTE_TITLE)
            if self.votes.get(voter_id) == target_id:
                return await reply_error(interaction, VOTE.ALREADY_VOTED, title=VOTE.ALREADY_VOTED_TITLE)
            if voter_id in self.votes:
                self.tally[self.votes[voter_id]] -= 1
            self.votes[voter_id] = target_id
            self.tally[target_id] += 1
            await interaction.response.edit_message(embed=self._make_board_embed(), view=self)
        return callback

    def _candidate_block(self, m: discord.Member) -> str:
        """후보 1명의 표시 블록: 득표 라인 + 공약 라인."""
        row    = VOTE.VOTE_ROW.format(mention=m.mention, count=self.tally[m.id])
        pledge = self.pledges.get(m.id, "").strip()
        return row + "\n" + VOTE.PLEDGE_LINE.format(pledge=pledge or VOTE.PLEDGE_NONE)

    @property
    def time_left(self) -> int:
        """남은 시간(초) — 디버그/조회용 (표시는 타임스탬프가 담당)."""
        return max(0, int((self.end_at - utcnow()).total_seconds()))

    def _make_board_embed(self, *, finished: bool = False) -> discord.Embed:
        title = (
            VOTE.RESULT_TITLE if finished
            else VOTE.BOARD_TITLE.format(timestamp=discord.utils.format_dt(self.end_at, "R"))
        )
        desc  = VOTE.TIMEOUT_NOTICE + "\n" if finished else VOTE.BOARD_DESC + "\n"
        desc += "\n".join(self._candidate_block(m) for m in self.players)
        color = discord.Color.gold() if finished else discord.Color.blurple()
        e = discord.Embed(title=title, description=desc, color=color)
        _attach_footer(e, self.host)
        return e

    async def run(self):
        # 종료 시각까지 한 번만 대기 (카운트다운 표시는 타임스탬프, 투표 변동 시에만 edit).
        # 조기 종료 버튼(_on_end)이 stop_event 를 set 하면 즉시 깨어난다.
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(self.stop_event.wait(), timeout=self.time_limit)
        await self._finish()

    async def _finish(self):
        self._build_buttons(disabled=True)
        if self.board_msg:
            with contextlib.suppress(Exception):
                await self.board_msg.edit(
                    embed=self._make_board_embed(finished=True), view=self
                )
        max_votes = max(self.tally.values(), default=0)
        result_embed = discord.Embed(title=VOTE.RESULT_TITLE, color=discord.Color.gold())
        _attach_footer(result_embed, self.host)
        result_embed.add_field(
            name=VOTE.RESULT_BOARD_TITLE,
            value="\n".join(self._candidate_block(m) for m in self.players),
            inline=False,
        )
        if max_votes == 0:
            result_embed.add_field(name=VOTE.RESULT_WINNER, value=VOTE.RESULT_NO_VOTES, inline=False)
        else:
            winners = [m for m in self.players if self.tally[m.id] == max_votes]
            if len(winners) > 1:
                result_embed.add_field(name=VOTE.RESULT_DRAW, value=VOTE.RESULT_DRAW_DESC, inline=False)
            else:
                result_embed.add_field(name=VOTE.RESULT_WINNER, value=winners[0].mention, inline=False)
        if self.board_msg:
            await self.board_msg.channel.send(embed=result_embed)


@bot.tree.command(name=CMD.VOTE_NAME, description=CMD.VOTE_DESC)
# @slash_channel_check()
@easter_egg
@app_commands.describe(
    사람수=CMD.VOTE_P_COUNT,
    시간=CMD.VOTE_P_TIME.format(default=VOTE_DEFAULT_TIME),
)
async def cmd_vote(interaction: discord.Interaction, 사람수: int, 시간: int = VOTE_DEFAULT_TIME):
    if await reject_if_busy(interaction):
        return
    if not (VOTE_MIN_PLAYERS <= 사람수 <= VOTE_MAX_PLAYERS) or not (VOTE_MIN_TIME <= 시간 <= VOTE_MAX_TIME):
        return await reply_error(
            interaction,
            VOTE.RANGE_ERROR.format(
                min=VOTE_MIN_PLAYERS, max=VOTE_MAX_PLAYERS,
                min_t=VOTE_MIN_TIME,  max_t=VOTE_MAX_TIME,
            ),
        )
    channel_id = interaction.channel_id
    result = await recruit_and_validate(
        interaction, VOTE.TITLE,
        max_players=사람수, min_players=사람수,
        host_can_start=False,
        timeout=VOTE_RECRUIT_TIMEOUT,
        min_valid=VOTE_MIN_PLAYERS,
        collect_pledge=True,   # 참가 시 공약 입력 모달 표시
    )
    if result is None:
        return
    _player_ids, members, pledges = result
    view = VoteView(members, 시간, interaction.user.id, pledges=pledges)
    board_msg = await interaction.channel.send(embed=view._make_board_embed(), view=view)
    view.board_msg = board_msg
    active_votes[channel_id] = view
    try:
        await view.run()
    finally:
        active_votes.pop(channel_id, None)


# ══════════════════════════════════════════════════════════════════════════════
# ⑭ 탕수육게임
# ══════════════════════════════════════════════════════════════════════════════

@bot.tree.command(name=CMD.TANGSUYUK_NAME, description=CMD.TANGSUYUK_DESC)
# @slash_channel_check()
@easter_egg
async def cmd_tangsuyuk(interaction: discord.Interaction):
    if await reject_if_busy(interaction):
        return
    channel_id = interaction.channel_id
    game = {"step": 0, "count": 0}
    active_tangsuyuk[channel_id] = game

    await interaction.response.send_message(embed=discord.Embed(
        title=TANGSUYUK.TITLE,
        description=TANGSUYUK.START_DESC,
        color=discord.Color.orange(),
    ))

    def check(m: discord.Message) -> bool:
        # 해당 채널의 사람 메시지면 전부 인식 (정답이 아니어도 게임에 영향)
        if m.channel.id != channel_id or m.author.bot:
            return False
        return bool(m.content.strip())

    try:
        while channel_id in active_tangsuyuk:
            try:
                msg = await bot.wait_for("message", timeout=TANGSUYUK_TIMEOUT, check=check)
            except asyncio.TimeoutError:
                break

            if channel_id not in active_tangsuyuk:
                break

            word     = msg.content.strip()
            expected = TANGSUYUK.SEQUENCE[game["step"]]

            # 정답 처리
            if word == expected:
                game["step"]  = (game["step"] + 1) % len(TANGSUYUK.SEQUENCE)
                game["count"] += 1
                continue

            # 시퀀스 글자이지만 순서가 틀린 경우 → 게임 종료
            if word in TANGSUYUK.SEQUENCE:
                await msg.channel.send(TANGSUYUK.FAIL_DESC.format(mention=msg.author.mention))
                break

            # 한 글자 + 초성 ㅌ/ㅅ/ㅇ 인 경우만 오타로 간주 (랜덤 답장 후 게임 종료)
            is_typo = False
            if len(word) == 1 and "가" <= word <= "힣":
                chosung = CHOSUNG_LIST[(ord(word) - 0xAC00) // 588]
                if chosung in TANGSUYUK.TYPO_CHOSUNG:
                    is_typo = True

            if is_typo:
                # TYPO_MESSAGES 는 list → 접근만으로 자동 랜덤 선택됨 (random.choice 불필요)
                typo_msg = TANGSUYUK.TYPO_MESSAGES.format(
                    mention=msg.author.mention, word=word
                )
                with contextlib.suppress(discord.HTTPException):
                    await msg.reply(typo_msg, mention_author=False)

            # 긴 문장/그 외 메시지는 오타 랜덤 메시지 없이 바로 게임 종료
            await msg.channel.send(TANGSUYUK.FAIL_DESC.format(mention=msg.author.mention))
            break
    finally:
        active_tangsuyuk.pop(channel_id, None)


# ══════════════════════════════════════════════════════════════════════════════
# ⑮ 선착순 버튼
# ══════════════════════════════════════════════════════════════════════════════

class FirstClickView(View):
    def __init__(self):
        super().__init__(timeout=None)
        self.winner = None

    @discord.ui.button(label=FIRST_CLICK.BTN_LABEL, style=discord.ButtonStyle.green)
    async def on_click(self, interaction: discord.Interaction, button: Button):
        if self.winner is not None:
            return await reply_error(interaction, FIRST_CLICK.ALREADY_DONE, title=FIRST_CLICK.ALREADY_TITLE)
        self.winner = interaction.user
        for child in self.children:
            child.disabled = True
        title = interaction.message.embeds[0].title
        await interaction.response.edit_message(
            embed=discord.Embed(
                title=title,
                description=FIRST_CLICK.BODY_WON.format(mention=interaction.user.mention),
                color=discord.Color.gold(),
            ),
            view=self,
        )
        await reply_info(
            interaction.channel,
            FIRST_CLICK.RESULT_DESC.format(mention=interaction.user.mention),
            title=FIRST_CLICK.RESULT_TITLE, color=discord.Color.gold(),
        )
        self.stop()  # View를 정리하여 메모리 누수 방지


@bot.tree.command(name=CMD.FIRST_NAME, description=CMD.FIRST_DESC)
# @slash_channel_check()
@easter_egg
@app_commands.describe(제목=CMD.FIRST_P_TITLE)
async def cmd_first_click(interaction: discord.Interaction, 제목: str = FIRST_CLICK.DEFAULT_TITLE):
    await interaction.response.send_message(
        embed=discord.Embed(
            title=제목,
            description=FIRST_CLICK.BODY_WAITING,
            color=discord.Color.random(),
        ),
        view=FirstClickView(),
    )


# ══════════════════════════════════════════════════════════════════════════════
# ⑮-B 프로필
# ══════════════════════════════════════════════════════════════════════════════

class ProfileView(View):
    """유저 프로필 카드. 프로필 사진을 크게 보여주고, '더보기'로 상세 정보를 펼친다.

    참고: 대명사·소개글·연결 계정·좋아하는 게임은 디스코드 봇 API로 조회할 수 없어 표시하지 않는다.
    """
    def __init__(self, member: discord.Member, invoker):
        super().__init__(timeout=180)
        self.member   = member
        self.invoker  = invoker            # footer 표시용 (명령어 친 사람)
        self.expanded = False
        self.message: discord.Message | None = None
        self._build()

    def _build(self) -> None:
        self.clear_items()
        btn = Button(
            label=PROFILE.BTN_LESS if self.expanded else PROFILE.BTN_MORE,
            style=discord.ButtonStyle.secondary,
        )
        btn.callback = self._toggle
        self.add_item(btn)

    def _base_embed(self) -> discord.Embed:
        m = self.member
        color = m.color if m.color.value else discord.Color.blurple()
        e = discord.Embed(title=PROFILE.TITLE.format(name=m.display_name), color=color)
        # 프로필 사진을 크게 (썸네일 대신 본문 이미지)
        e.set_image(url=m.display_avatar.with_size(1024).url)
        e.add_field(name=PROFILE.F_NAME, value=f"`@{m.name}`", inline=True)
        if m.global_name and m.global_name != m.name:
            e.add_field(name=PROFILE.F_DISPLAY, value=m.global_name, inline=True)
        e.add_field(name=PROFILE.F_NICK, value=m.nick or PROFILE.NONE, inline=True)
        _attach_footer(e, self.invoker)
        return e

    @staticmethod
    def _roles_value(m: discord.Member) -> tuple[int, str]:
        """(@everyone 제외) 역할 개수와 멘션 문자열(필드 길이 제한 내 잘라냄)."""
        roles = [r.mention for r in reversed(m.roles) if not r.is_default()]
        if not roles:
            return 0, PROFILE.NONE
        text = " ".join(roles)
        if len(text) <= 1000:
            return len(roles), text
        shown, total = [], 0
        for r in roles:
            if total + len(r) + 1 > 950:
                break
            shown.append(r)
            total += len(r) + 1
        return len(roles), " ".join(shown) + PROFILE.ROLES_MORE.format(n=len(roles) - len(shown))

    @staticmethod
    def _perms_value(m: discord.Member) -> str:
        perms = m.guild_permissions
        if perms.administrator:
            return PROFILE.PERM_ADMIN
        labels = [lbl for attr, lbl in PROFILE.PERM_LABELS.items() if getattr(perms, attr, False)]
        return " · ".join(labels) if labels else PROFILE.PERM_NONE

    def make_embed(self) -> discord.Embed:
        e = self._base_embed()
        if not self.expanded:
            return e
        m = self.member
        # 계정 생성일 / 서버 가입일 (디스코드 타임스탬프 → 보는 사람 시간대로 자동 표시)
        e.add_field(
            name=PROFILE.F_CREATED,
            value=PROFILE.DATE_LINE.format(
                full=discord.utils.format_dt(m.created_at, "F"),
                rel=discord.utils.format_dt(m.created_at, "R"),
            ),
            inline=False,
        )
        if m.joined_at:
            e.add_field(
                name=PROFILE.F_JOINED,
                value=PROFILE.DATE_LINE.format(
                    full=discord.utils.format_dt(m.joined_at, "F"),
                    rel=discord.utils.format_dt(m.joined_at, "R"),
                ),
                inline=False,
            )
        # 서버 부스트
        if m.premium_since:
            e.add_field(name=PROFILE.F_BOOST, value=discord.utils.format_dt(m.premium_since, "R"), inline=True)
        # 소유 역할
        role_count, role_text = self._roles_value(m)
        e.add_field(name=PROFILE.F_ROLES.format(n=role_count), value=role_text, inline=False)
        # 소유(주요) 권한
        e.add_field(name=PROFILE.F_PERMS, value=self._perms_value(m), inline=False)
        return e

    async def _toggle(self, interaction: discord.Interaction):
        self.expanded = not self.expanded
        self._build()
        await interaction.response.edit_message(embed=self.make_embed(), view=self)

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True
        if self.message is not None:
            with contextlib.suppress(Exception):
                await self.message.edit(view=self)


@bot.tree.command(name=CMD.PROFILE_NAME, description=CMD.PROFILE_DESC)
@easter_egg
@app_commands.describe(유저=CMD.PROFILE_P_USER)
async def cmd_profile(interaction: discord.Interaction, 유저: discord.Member | None = None):
    if not isinstance(interaction.user, discord.Member):
        return await reply_error(interaction, PROFILE.GUILD_ONLY)
    target = 유저 or interaction.user
    view = ProfileView(target, interaction.user)
    await interaction.response.send_message(embed=view.make_embed(), view=view)
    with contextlib.suppress(Exception):
        view.message = await interaction.original_response()


# ══════════════════════════════════════════════════════════════════════════════
# ⑯ 소원권
# ══════════════════════════════════════════════════════════════════════════════

class WishApprovalView(View):
    """
    소원 수락/거절 승인용 Persistent View.
    재시작 후에도 살아있도록 모든 버튼에 custom_id를 지정.
    """
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label=WISH.BTN_ACCEPT,
        style=discord.ButtonStyle.success,
        custom_id="wish_approval:accept",
    )
    async def on_accept(self, interaction: discord.Interaction, button: Button):
        await _wish_handle_decision(interaction, accept=True)

    @discord.ui.button(
        label=WISH.BTN_REJECT,
        style=discord.ButtonStyle.danger,
        custom_id="wish_approval:reject",
    )
    async def on_reject(self, interaction: discord.Interaction, button: Button):
        await _wish_handle_decision(interaction, accept=False)


async def _wish_handle_decision(interaction: discord.Interaction, *, accept: bool):
    """수락/거절 공통 처리."""
    # 관리자 권한 체크
    if not (isinstance(interaction.user, discord.Member)
            and interaction.user.guild_permissions.administrator):
        return await reply_error(interaction, WISH.NO_PERM_APPROVE, title=WISH.NO_PERM_APPROVE_TITLE)

    guild_id   = interaction.guild.id
    message_id = interaction.message.id

    # 1) pending 파일에서 해당 소원 꺼내기
    async with pending_transaction() as pending_data:
        payload = pending_pop(pending_data, guild_id, message_id)
        if payload is None:
            return await reply_error(interaction, WISH.ALREADY_PROCESSED, title=WISH.ALREADY_PROCESSED_TITLE)

    # 2) 거절이면 wishes 파일에서 소원권 환불
    refund_delta: WishDelta | None = None
    if not accept:
        refund_delta = await WishWallet.refund_wish(guild_id, int(payload["user_id"]), 1)

    # 3) 임베드 업데이트 (상태 필드 추가, 버튼 제거)
    original_embed = interaction.message.embeds[0] if interaction.message.embeds else discord.Embed()
    if accept:
        original_embed.color = discord.Color.green()
        original_embed.add_field(
            name=WISH.ACCEPTED_FIELD,
            value=WISH.ACCEPTED_VALUE.format(mod_mention=interaction.user.mention),
            inline=False,
        )
    else:
        original_embed.color = discord.Color.red()
        original_embed.add_field(
            name=WISH.REJECTED_FIELD,
            value=WISH.REJECTED_VALUE.format(
                mod_mention=interaction.user.mention,
                change=refund_delta.fmt_change_labeled() if refund_delta else "",
            ),
            inline=False,
        )

    # 처리 완료된 메시지에서는 버튼 자체를 제거 (view=None)
    # 첨부 이미지가 있으면 그대로 유지하고 attachment:// 로 재참조 (편집 시 이미지 유실 방지)
    kept = interaction.message.attachments
    if kept and original_embed.image and original_embed.image.url:
        original_embed.set_image(url=f"attachment://{kept[0].filename}")
    await interaction.response.edit_message(embed=original_embed, view=None, attachments=kept)


wish_group = app_commands.Group(name=CMD.WISH_GROUP_NAME, description=CMD.WISH_GROUP_DESC)
bot.tree.add_command(wish_group)


# ──────────────────────────────────────────────────────────────────────────────
# 소원권/조각 보유 랭킹 — 드롭다운 + 페이지네이션 View
# ──────────────────────────────────────────────────────────────────────────────

class WishRankingView(View):
    PAGE_SIZE = 10

    def __init__(self, guild: discord.Guild, invoker_id: int,
                 *, kind: str = WishDelta.KIND_WISH):
        super().__init__(timeout=None)   # 무제한 — 누구나 언제든 조작 가능
        self.guild       = guild
        self.invoker_id  = invoker_id    # footer 표시용으로만 유지
        self.kind        = kind  # "wishes" | "pieces"
        self.page        = 0
        self.entries: list[tuple[int, int, int]] = []   # 현재 종류의 [(rank, user_id, count), ...]
        # 드롭다운 옵션 description 용으로 양쪽 종류 모두 보관
        self._all_entries: dict[str, list[tuple[int, int, int]]] = {
            WishDelta.KIND_WISH: [],
            WishDelta.KIND_PIECE: [],
        }

    # --- 데이터 로딩 ---
    @staticmethod
    def _build_entries(users: dict, kind: str) -> list[tuple[int, int, int]]:
        ranked = sorted(users.items(), key=lambda kv: kv[1].get(kind, 0), reverse=True)
        out, rank = [], 0
        for uid, ud in ranked:
            count = ud.get(kind, 0)
            if count <= 0:
                continue   # 0개 보유는 랭킹에서 제외
            rank += 1
            out.append((rank, int(uid), count))
        return out

    async def load(self) -> None:
        data = await wish_load_readonly()
        users = data.get(str(self.guild.id), {}).get("users", {})
        for k in (WishDelta.KIND_WISH, WishDelta.KIND_PIECE):
            self._all_entries[k] = self._build_entries(users, k)
        self.entries = self._all_entries[self.kind]
        # 페이지가 범위 밖이면 보정
        max_page = max(0, self.total_pages - 1)
        if self.page > max_page:
            self.page = max_page

    @property
    def total_pages(self) -> int:
        if not self.entries:
            return 1
        return (len(self.entries) + self.PAGE_SIZE - 1) // self.PAGE_SIZE

    # --- 표시 ---
    def _kind_label(self) -> str:
        return RANK.KIND_WISH_LABEL if self.kind == WishDelta.KIND_WISH else RANK.KIND_PIECE_LABEL

    def _unit(self) -> str:
        return "장" if self.kind == WishDelta.KIND_WISH else "개"

    def _set_combined_footer(self, embed: discord.Embed) -> None:
        """명령어 사용자 이름 + 페이지 정보를 합쳐 footer에 세팅.
        (auto-footer 훅은 이미 footer가 있으면 건너뛰므로 여기서 한 번에 설정)"""
        invoker = self.guild.get_member(self.invoker_id)
        if invoker is not None:
            inv_name   = getattr(invoker, "display_name", None) or invoker.name
            inv_avatar = getattr(getattr(invoker, "display_avatar", None), "url", None)
        else:
            inv_name, inv_avatar = f"User {self.invoker_id}", None

        if self.entries:
            paging = RANK.FOOTER.format(
                page=self.page + 1, total_pages=self.total_pages, n=len(self.entries),
            )
            text = f"{inv_name}  •  {paging}"
        else:
            text = inv_name
        embed.set_footer(text=text, icon_url=inv_avatar)

    def make_embed(self) -> discord.Embed:
        title = RANK.TITLE.format(guild_name=self.guild.name, kind_label=self._kind_label())
        if not self.entries:
            e = discord.Embed(title=title, description=RANK.EMPTY, color=discord.Color.gold())
            self._set_combined_footer(e)
            return e

        start = self.page * self.PAGE_SIZE
        page_entries = self.entries[start:start + self.PAGE_SIZE]
        unit = self._unit()
        lines = []
        for rank, uid, count in page_entries:
            member = self.guild.get_member(uid)
            name   = member.display_name if member else RANK.LEFT_SERVER_NAME.format(uid=uid)
            mark   = RANK.MEDALS.get(rank, RANK.RANK_MARK_DEFAULT.format(n=rank))
            lines.append(RANK.LINE.format(rank_mark=mark, name=name, count=count, unit=unit))
        e = discord.Embed(
            title=title, description="\n".join(lines), color=discord.Color.gold(),
        )
        self._set_combined_footer(e)
        return e

    def _option_description(self, kind: str) -> str:
        """드롭다운 옵션 보조 설명 — 1위 유저 + 총 인원."""
        entries = self._all_entries.get(kind, [])
        if not entries:
            return RANK.OPTION_DESC_EMPTY
        _rank, uid, count = entries[0]
        member = self.guild.get_member(uid)
        name   = member.display_name if member else RANK.LEFT_SERVER_NAME.format(uid=uid)
        unit   = "장" if kind == WishDelta.KIND_WISH else "개"
        text   = RANK.OPTION_DESC_TOP.format(name=name, count=count, unit=unit, n=len(entries))
        # SelectOption.description 은 100자 제한
        return text[:100]

    def _rebuild_components(self) -> None:
        self.clear_items()
        # 종류 선택 드롭다운 (각 옵션에 1위/총원 표시)
        sel = Select(
            placeholder=RANK.SELECT_PLACEHOLDER,
            min_values=1, max_values=1,
            options=[
                discord.SelectOption(
                    label=RANK.KIND_WISH_OPTION,  value=WishDelta.KIND_WISH,
                    description=self._option_description(WishDelta.KIND_WISH),
                    default=self.kind == WishDelta.KIND_WISH,
                ),
                discord.SelectOption(
                    label=RANK.KIND_PIECE_OPTION, value=WishDelta.KIND_PIECE,
                    description=self._option_description(WishDelta.KIND_PIECE),
                    default=self.kind == WishDelta.KIND_PIECE,
                ),
            ],
        )
        sel.callback = self._on_select
        self.add_item(sel)
        # 페이지가 2개 이상일 때만 이전/다음 버튼 노출
        if self.total_pages > 1:
            prev_btn = Button(
                label=RANK.BTN_PREV, style=discord.ButtonStyle.secondary,
                disabled=self.page <= 0,
            )
            prev_btn.callback = self._on_prev
            self.add_item(prev_btn)
            next_btn = Button(
                label=RANK.BTN_NEXT, style=discord.ButtonStyle.secondary,
                disabled=self.page + 1 >= self.total_pages,
            )
            next_btn.callback = self._on_next
            self.add_item(next_btn)

    # --- 콜백 (누구나 조작 가능) ---
    async def _refresh(self, inter: discord.Interaction) -> None:
        await self.load()
        self._rebuild_components()
        await inter.response.edit_message(embed=self.make_embed(), view=self)

    async def _on_select(self, inter: discord.Interaction):
        chosen = inter.data["values"][0]
        if chosen in (WishDelta.KIND_WISH, WishDelta.KIND_PIECE):
            self.kind = chosen
            self.page = 0
        await self._refresh(inter)

    async def _on_prev(self, inter: discord.Interaction):
        if self.page > 0:
            self.page -= 1
        await self._refresh(inter)

    async def _on_next(self, inter: discord.Interaction):
        if self.page + 1 < self.total_pages:
            self.page += 1
        await self._refresh(inter)

    # --- 시작 ---
    async def start(self, interaction: discord.Interaction) -> None:
        await self.load()
        self._rebuild_components()
        await interaction.response.send_message(embed=self.make_embed(), view=self)


@wish_group.command(name=CMD.WISH_RANK_NAME, description=CMD.WISH_RANK_DESC)
@easter_egg
async def wish_ranking(interaction: discord.Interaction):
    if interaction.guild is None:
        return await reply_error(interaction, ERR.SERVER_ONLY)
    await WishRankingView(interaction.guild, interaction.user.id).start(interaction)


@wish_group.command(name=CMD.WISH_CHECK_NAME, description=CMD.WISH_CHECK_DESC)
@easter_egg
@app_commands.describe(유저=CMD.WISH_CHECK_P_USER)
async def wish_check(interaction: discord.Interaction, 유저: discord.Member | None = None):
    target = 유저 or interaction.user
    data = await wish_load_readonly()
    ud   = wish_get_user(data, interaction.guild.id, target.id)
    e = discord.Embed(title=WISH.CHECK_TITLE.format(name=target.display_name), color=discord.Color.gold())
    e.add_field(name=WISH.CHECK_FIELD_WISH,  value=UNIT.COUNT.format(n=ud['wishes']), inline=True)
    e.add_field(name=WISH.CHECK_FIELD_PIECE, value=UNIT.COUNT.format(n=ud['pieces']), inline=True)
    await interaction.response.send_message(embed=e)


@wish_group.command(name=CMD.WISH_MAKE_NAME, description=CMD.WISH_MAKE_DESC.format(pieces=PIECES_PER_WISH))
@easter_egg
async def wish_make(interaction: discord.Interaction):
    result = await WishWallet.make_wish(interaction.guild.id, interaction.user.id)
    if not result.success:
        return await reply_error(
            interaction,
            WISH.MAKE_FAIL_DESC.format(have=result.have, need=PIECES_PER_WISH),
            title=WISH.MAKE_FAIL_TITLE,
        )
    await reply_success(
        interaction,
        WISH.MAKE_SUCCESS_DESC.format(
            piece_change=result.piece_delta.fmt_change_labeled(),
            wish_change =result.wish_delta.fmt_change_labeled(),
        ),
        title=WISH.MAKE_SUCCESS_TITLE,
    )


@wish_group.command(name=CMD.WISH_WASTE_NAME, description=CMD.WISH_WASTE_DESC)
@easter_egg
async def wish_waste(interaction: discord.Interaction):
    """소원권 1장을 소비만 하고 전달 없이 날려버린다. (봇이 축하해 줌)"""
    use_delta = await WishWallet.use_wish(interaction.guild.id, interaction.user.id)
    if use_delta is None:
        return await reply_error(interaction, WISH.WASTE_NONE_DESC, title=WISH.WASTE_NONE_TITLE)
    # 임베드가 아니라 단순 텍스트로 출력
    await interaction.response.send_message(
        WISH.WASTE_SUCCESS_DESC.format(change=use_delta.fmt_change_labeled())
    )


@wish_group.command(name=CMD.WISH_USE_NAME, description=CMD.WISH_USE_DESC)
@easter_egg
@app_commands.describe(텍스트=CMD.WISH_USE_P_TEXT, 이미지=CMD.WISH_USE_P_IMAGE)
async def wish_use(
    interaction: discord.Interaction,
    텍스트: str,
    이미지: discord.Attachment | None = None,
):
    # 1) settings에서 전달 채널 조회
    ch_id = await get_wish_deliver_channel_id(interaction.guild.id)
    if ch_id is None:
        return await reply_error(interaction, WISH.USE_CH_NOT_SET, title=WISH.USE_CH_INVALID_TITLE)

    deliver_ch = interaction.guild.get_channel(ch_id)
    if deliver_ch is None:
        return await reply_error(interaction, WISH.USE_CH_NOT_FOUND, title=WISH.USE_CH_INVALID_TITLE)
    if not isinstance(deliver_ch, discord.TextChannel):
        return await reply_error(interaction, WISH.USE_CH_NOT_TEXT, title=WISH.USE_CH_INVALID_TITLE)
    # 봇이 해당 채널에 메시지/임베드 보낼 권한 있는지 확인
    bot_perms = deliver_ch.permissions_for(interaction.guild.me)
    if not (bot_perms.send_messages and bot_perms.embed_links):
        return await reply_error(
            interaction,
            WISH.USE_CH_NO_PERM.format(channel=deliver_ch.mention),
            title=WISH.USE_CH_INVALID_TITLE,
        )

    # 2) 소원권 차감
    use_delta = await WishWallet.use_wish(interaction.guild.id, interaction.user.id)
    if use_delta is None:
        return await reply_error(interaction, WISH.USE_NONE_DESC, title=WISH.USE_NONE_TITLE)

    await reply_success(
        interaction,
        WISH.USE_SUCCESS_DESC.format(change=use_delta.fmt_change_labeled()),
        title=WISH.USE_SUCCESS_TITLE,
    )

    # 3) 수락/거절 버튼 포함 임베드 전송
    #    슬래시 첨부 URL(이미지.url)은 서명되어 ~24시간 후 만료된다. 그대로 set_image 하면
    #    시간이 지나 이미지가 사라지므로, 봇 메시지의 첨부로 '재업로드'해 attachment:// 로
    #    참조한다. 그러면 이미지가 이 메시지와 함께 영구 보존된다.
    e = discord.Embed(title=WISH.USE_DELIVER_TITLE, description=텍스트, color=discord.Color.gold())
    image_file = None
    if 이미지 is not None:
        ct = (이미지.content_type or "").lower()
        is_image = ct.startswith("image/") or ct == ""
        if is_image and bot_perms.attach_files and 이미지.size <= interaction.guild.filesize_limit:
            try:
                image_file = await 이미지.to_file()
                ext = os.path.splitext(이미지.filename or "")[1].lower() or ".png"
                image_file.filename = f"wish_image{ext}"
                e.set_image(url=f"attachment://{image_file.filename}")
            except Exception:
                image_file = None
        if image_file is None and is_image:
            # 재업로드 불가(용량 초과/다운로드 실패) → 차선책으로 원본 URL (단, 만료될 수 있음)
            e.set_image(url=이미지.url)

    view = WishApprovalView()
    send_kwargs = {"embed": e, "view": view}
    if image_file is not None:
        send_kwargs["file"] = image_file
    try:
        approval_msg = await deliver_ch.send(**send_kwargs)
    except discord.HTTPException:
        # 전송 실패 시 소원권 환불
        refund_delta = await WishWallet.refund_wish(
            interaction.guild.id, interaction.user.id, 1,
        )
        await reply_error(
            interaction,
            WISH.USE_REFUND_DESC.format(change=refund_delta.fmt_change_labeled()),
            title=WISH.USE_REFUND_TITLE,
        )
        return

    # 4) 대기 목록 저장
    async with pending_transaction() as pdata:
        pending_store(pdata, interaction.guild.id, approval_msg.id, {
            "user_id": str(interaction.user.id),
            "text": 텍스트,
            "image_url": 이미지.url if 이미지 else None,
            "channel_id": deliver_ch.id,
        })


@wish_group.command(name=CMD.WISH_SET_CHANNEL_NAME, description=CMD.WISH_SET_CHANNEL_DESC)
@easter_egg
@app_commands.checks.has_permissions(administrator=True)
@app_commands.describe(채널=CMD.WISH_SET_CHANNEL_P)
async def wish_set_channel(interaction: discord.Interaction, 채널: discord.TextChannel):
    # 봇이 그 채널에 메시지 보낼 권한 있는지 미리 검증
    bot_perms = 채널.permissions_for(interaction.guild.me)
    if not (bot_perms.send_messages and bot_perms.embed_links):
        return await reply_error(
            interaction,
            WISH.SET_CHANNEL_FAIL_PERM.format(channel=채널.mention),
            title=WISH.SET_CHANNEL_FAIL_PERM_TITLE,
        )

    async with settings_transaction() as sdata:
        gsettings = settings_get_guild(sdata, interaction.guild.id)
        gsettings["wish_deliver_channel"] = 채널.id

    await reply_success(
        interaction,
        WISH.SET_CHANNEL_DESC.format(channel=채널.mention),
        title=WISH.SET_CHANNEL_TITLE,
    )


async def _bulk_wish_op(
    interaction: discord.Interaction,
    members: list[discord.Member],
    amount: int,
    op,                  # WishWallet.give_wish / take_wish / give_piece / take_piece
    *,
    title: str,
    header_tmpl: str,
    line_tmpl: str,
    color: discord.Color,
) -> None:
    """4개 지급/회수 명령어가 공유하는 본체."""
    if not members:
        return await reply_error(interaction, WISH.BULK_NO_USERS, title=WISH.BULK_NO_USERS_TITLE)
    # 여러 명에 대한 파일 트랜잭션이 3초를 넘길 수 있으므로 먼저 defer (이후 followup 으로 응답).
    await interaction.response.defer(thinking=True)
    amount = max(1, amount)
    deltas: list[tuple[discord.Member, WishDelta]] = []
    for m in members:
        d = await op(interaction.guild.id, m.id, amount)
        deltas.append((m, d))
    desc = _format_bulk_delta(header_tmpl, line_tmpl, deltas, amount=amount)
    await interaction.followup.send(embed=discord.Embed(
        title=title, description=desc, color=color,
    ))


@wish_group.command(name=CMD.WISH_GIVE_NAME, description=CMD.WISH_GIVE_DESC)
@easter_egg
@app_commands.checks.has_permissions(administrator=True)
@app_commands.describe(유저들=CMD.WISH_BULK_P_USERS, 수량=CMD.WISH_BULK_P_AMOUNT)
async def wish_give(
    interaction: discord.Interaction,
    유저들: MembersInput,
    수량: int = 1,
):
    await _bulk_wish_op(
        interaction, 유저들, 수량, WishWallet.give_wish,
        title=WISH.GIVE_TITLE,
        header_tmpl=WISH.GIVE_HEADER, line_tmpl=WISH.GIVE_LINE,
        color=discord.Color.green(),
    )


@wish_group.command(name=CMD.WISH_TAKE_NAME, description=CMD.WISH_TAKE_DESC)
@easter_egg
@app_commands.checks.has_permissions(administrator=True)
@app_commands.describe(유저들=CMD.WISH_BULK_P_USERS, 수량=CMD.WISH_BULK_P_AMOUNT)
async def wish_take(
    interaction: discord.Interaction,
    유저들: MembersInput,
    수량: int = 1,
):
    await _bulk_wish_op(
        interaction, 유저들, 수량, WishWallet.take_wish,
        title=WISH.TAKE_TITLE,
        header_tmpl=WISH.TAKE_HEADER, line_tmpl=WISH.TAKE_LINE,
        color=discord.Color.orange(),
    )


@wish_group.command(name=CMD.PIECE_GIVE_NAME, description=CMD.PIECE_GIVE_DESC)
@easter_egg
@app_commands.checks.has_permissions(administrator=True)
@app_commands.describe(유저들=CMD.WISH_BULK_P_USERS, 수량=CMD.WISH_BULK_P_AMOUNT)
async def piece_give(
    interaction: discord.Interaction,
    유저들: MembersInput,
    수량: int = 1,
):
    await _bulk_wish_op(
        interaction, 유저들, 수량, WishWallet.give_piece,
        title=WISH.PIECE_GIVE_TITLE,
        header_tmpl=WISH.PIECE_GIVE_HEADER, line_tmpl=WISH.PIECE_GIVE_LINE,
        color=discord.Color.green(),
    )


@wish_group.command(name=CMD.PIECE_TAKE_NAME, description=CMD.PIECE_TAKE_DESC)
@easter_egg
@app_commands.checks.has_permissions(administrator=True)
@app_commands.describe(유저들=CMD.WISH_BULK_P_USERS, 수량=CMD.WISH_BULK_P_AMOUNT)
async def piece_take(
    interaction: discord.Interaction,
    유저들: MembersInput,
    수량: int = 1,
):
    await _bulk_wish_op(
        interaction, 유저들, 수량, WishWallet.take_piece,
        title=WISH.PIECE_TAKE_TITLE,
        header_tmpl=WISH.PIECE_TAKE_HEADER, line_tmpl=WISH.PIECE_TAKE_LINE,
        color=discord.Color.orange(),
    )


# ══════════════════════════════════════════════════════════════════════════════
# ⑯-B 봇설명 (모든 슬래시 명령어 목록)
# ══════════════════════════════════════════════════════════════════════════════

@bot.tree.command(name=CMD.BOTINFO_NAME, description=CMD.BOTINFO_DESC)
# @slash_channel_check()
@easter_egg
async def cmd_botinfo(interaction: discord.Interaction):
    e = discord.Embed(
        title=HELP.SLASH_TITLE,
        description=HELP.SLASH_DESC,
        color=discord.Color.blurple(),
    )

    # 게임 (퀴즈 포함)
    game_rows = [
        HELP.SLASH_ROW.format(name=CMD.ROULETTE_NAME,   desc=CMD.ROULETTE_DESC),
        HELP.SLASH_ROW.format(name=CMD.BASEBALL_NAME,   desc=CMD.BASEBALL_DESC),
        HELP.SLASH_ROW.format(name=CMD.VOTE_NAME,       desc=CMD.VOTE_DESC),
        HELP.SLASH_ROW.format(name=CMD.TANGSUYUK_NAME,  desc=CMD.TANGSUYUK_DESC),
        HELP.SLASH_ROW.format(name=CMD.FIRST_NAME,      desc=CMD.FIRST_DESC),
        HELP.SLASH_ROW.format(name=CMD.QUIZ_NAME,       desc=CMD.QUIZ_DESC),
        HELP.SLASH_ROW.format(name=CMD.CHOSUNG_NAME,    desc=CMD.CHOSUNG_DESC),
    ]
    e.add_field(name=HELP.CAT_GAME, value="\n".join(game_rows), inline=False)

    # 관리
    mod_rows = [
        HELP.SLASH_ROW.format(name=CMD.NICK_SET_NAME,     desc=CMD.NICK_SET_DESC),
        HELP.SLASH_ROW.format(name=CMD.NICK_RESET_NAME,   desc=CMD.NICK_RESET_DESC),
        HELP.SLASH_ROW.format(name=CMD.SLOWMODE_NAME,     desc=CMD.SLOWMODE_DESC),
        HELP.SLASH_ROW.format(name=CMD.CHAT_TOGGLE_NAME,  desc=CMD.CHAT_TOGGLE_DESC),
        HELP.SLASH_ROW.format(name=CMD.TIMEOUT_NAME,      desc=CMD.TIMEOUT_DESC),
        HELP.SLASH_ROW.format(name=CMD.TASALBEO_NAME,     desc=CMD.TASALBEO_DESC),
    ]
    e.add_field(name=HELP.CAT_MOD, value="\n".join(mod_rows), inline=False)

    # 소원권 (서브커맨드 형태)
    wish_rows = [
        HELP.SLASH_ROW.format(
            name=f"{CMD.WISH_GROUP_NAME} {CMD.WISH_CHECK_NAME}",
            desc=CMD.WISH_CHECK_DESC,
        ),
        HELP.SLASH_ROW.format(
            name=f"{CMD.WISH_GROUP_NAME} {CMD.WISH_RANK_NAME}",
            desc=CMD.WISH_RANK_DESC,
        ),
        HELP.SLASH_ROW.format(
            name=f"{CMD.WISH_GROUP_NAME} {CMD.WISH_MAKE_NAME}",
            desc=CMD.WISH_MAKE_DESC.format(pieces=PIECES_PER_WISH),
        ),
        HELP.SLASH_ROW.format(
            name=f"{CMD.WISH_GROUP_NAME} {CMD.WISH_USE_NAME}",
            desc=CMD.WISH_USE_DESC,
        ),
        HELP.SLASH_ROW.format(
            name=f"{CMD.WISH_GROUP_NAME} {CMD.WISH_WASTE_NAME}",
            desc=CMD.WISH_WASTE_DESC,
        ),
        HELP.SLASH_ROW.format(
            name=f"{CMD.WISH_GROUP_NAME} {CMD.WISH_SET_CHANNEL_NAME}",
            desc=CMD.WISH_SET_CHANNEL_DESC,
        ),
        HELP.SLASH_ROW.format(
            name=f"{CMD.WISH_GROUP_NAME} {CMD.WISH_GIVE_NAME}",
            desc=CMD.WISH_GIVE_DESC,
        ),
        HELP.SLASH_ROW.format(
            name=f"{CMD.WISH_GROUP_NAME} {CMD.WISH_TAKE_NAME}",
            desc=CMD.WISH_TAKE_DESC,
        ),
        HELP.SLASH_ROW.format(
            name=f"{CMD.WISH_GROUP_NAME} {CMD.PIECE_GIVE_NAME}",
            desc=CMD.PIECE_GIVE_DESC,
        ),
        HELP.SLASH_ROW.format(
            name=f"{CMD.WISH_GROUP_NAME} {CMD.PIECE_TAKE_NAME}",
            desc=CMD.PIECE_TAKE_DESC,
        ),
    ]
    e.add_field(name=HELP.CAT_WISH, value="\n".join(wish_rows), inline=False)

    # 정보
    info_rows = [
        HELP.SLASH_ROW.format(name=CMD.PROFILE_NAME, desc=CMD.PROFILE_DESC),
        HELP.SLASH_ROW.format(name=CMD.BOTINFO_NAME, desc=CMD.BOTINFO_DESC),
    ]
    e.add_field(name=HELP.CAT_INFO, value="\n".join(info_rows), inline=False)

    await interaction.response.send_message(embed=e, ephemeral=True)


# ══════════════════════════════════════════════════════════════════════════════
# ⑰ 디버그 명령어
# ══════════════════════════════════════════════════════════════════════════════

@bot.command(name="ping")
async def debug_ping(ctx: commands.Context):
    if not is_debug_allowed(ctx): return
    ms = round(bot.latency * 1000)
    color = discord.Color.green() if ms < 100 else (discord.Color.orange() if ms < 300 else discord.Color.red())
    await ctx.send(embed=discord.Embed(
        title=DEBUG.PING_TITLE,
        description=DEBUG.PING_DESC.format(ms=ms),
        color=color,
    ))


@bot.command(name="status")
async def debug_status(ctx: commands.Context):
    if not is_debug_allowed(ctx): return
    e = discord.Embed(title=DEBUG.STATUS_TITLE, color=discord.Color.blurple())
    e.add_field(name=DEBUG.STATUS_F_UPTIME,    value=fmt_uptime(time.time() - _bot_start_time),                                        inline=True)
    e.add_field(name=DEBUG.STATUS_F_GUILDS,    value=DEBUG.STATUS_V_GUILDS.format(count=len(bot.guilds)),                              inline=True)
    e.add_field(name=DEBUG.STATUS_F_MEMBERS,   value=DEBUG.STATUS_V_MEMBERS.format(count=sum(g.member_count or 0 for g in bot.guilds)),inline=True)
    e.add_field(name=DEBUG.STATUS_F_BASEBALL,  value=DEBUG.STATUS_V_GAMES.format(count=len(baseball_games)),                           inline=True)
    e.add_field(name=DEBUG.STATUS_F_QUIZ,      value=DEBUG.STATUS_V_GAMES.format(count=len(active_quizzes)),                           inline=True)
    e.add_field(name=DEBUG.STATUS_F_VOTE,      value=DEBUG.STATUS_V_GAMES.format(count=len(active_votes)),                             inline=True)
    e.add_field(name=DEBUG.STATUS_F_TANGSUYUK, value=DEBUG.STATUS_V_GAMES.format(count=len(active_tangsuyuk)),                         inline=True)
    e.add_field(name=DEBUG.STATUS_F_LATENCY,   value=DEBUG.STATUS_V_LATENCY.format(ms=round(bot.latency * 1000)),                      inline=True)
    e.add_field(name=DEBUG.STATUS_F_PYTHON,    value=platform.python_version(),                                                        inline=True)
    e.add_field(name=DEBUG.STATUS_F_DISCORDPY, value=discord.__version__,                                                              inline=True)
    await ctx.send(embed=e)


@bot.command(name="games")
async def debug_games(ctx: commands.Context):
    if not is_debug_allowed(ctx): return
    lines = []
    if baseball_games:
        lines.append(DEBUG.GAMES_BASEBALL_HDR)
        for cid, g in baseball_games.items():
            players_str = DEBUG.GAMES_BASEBALL_VS.join(f"<@{p}>" for p in g["players"])
            lines.append(DEBUG.GAMES_BASEBALL_LINE.format(
                guild_id=cid, players=players_str, turn=g["turn_count"], started=g["started"]
            ))
    else:
        lines.append(DEBUG.GAMES_NO_BASEBALL)
    if active_quizzes:
        lines.append(DEBUG.GAMES_QUIZ_HDR)
        for cid, q in active_quizzes.items():
            lines.append(DEBUG.GAMES_QUIZ_LINE.format(channel_id=cid, title=q.title, time_left=q.time_left))
    else:
        lines.append(DEBUG.GAMES_NO_QUIZ)
    if active_votes:
        lines.append(DEBUG.GAMES_VOTE_HDR)
        for cid, v in active_votes.items():
            lines.append(DEBUG.GAMES_VOTE_LINE.format(channel_id=cid, time_left=v.time_left))
    else:
        lines.append(DEBUG.GAMES_NO_VOTE)
    if active_tangsuyuk:
        lines.append(DEBUG.GAMES_TANGSUYUK_HDR)
        for cid, g in active_tangsuyuk.items():
            lines.append(DEBUG.GAMES_TANGSUYUK_LINE.format(channel_id=cid, count=g["count"]))
    else:
        lines.append(DEBUG.GAMES_NO_TANGSUYUK)
    await reply_info(ctx, "\n".join(lines), title=DEBUG.GAMES_TITLE)


@bot.command(name="kill")
async def debug_kill(ctx: commands.Context, channel_id: int = None):
    """현재 채널(또는 지정 채널)에서 진행 중인 게임을 강제 종료합니다."""
    if not is_debug_allowed(ctx): return
    channel_id = channel_id or ctx.channel.id
    killed = games.kill(channel_id)

    if not killed:
        return await reply_error(
            ctx,
            DEBUG.KILL_NONE.format(channel_id=channel_id),
            title=DEBUG.KILL_NONE_TITLE,
        )

    await reply_success(
        ctx,
        DEBUG.KILL_OK.format(channel_id=channel_id, game_name=", ".join(killed)),
        title=DEBUG.KILL_OK_TITLE,
    )


@bot.command(name="wishdata")
async def debug_wishdata(ctx: commands.Context, member: discord.Member = None):
    if not is_debug_allowed(ctx): return
    member = member or ctx.author
    data = await wish_load_readonly()
    ud   = wish_get_user(data, ctx.guild.id, member.id)
    e = discord.Embed(title=DEBUG.WISHDATA_TITLE.format(name=member.display_name), color=discord.Color.gold())
    e.add_field(name=DEBUG.WISHDATA_F_WISH,  value=str(ud["wishes"]), inline=True)
    e.add_field(name=DEBUG.WISHDATA_F_PIECE, value=str(ud["pieces"]), inline=True)
    e.add_field(name=DEBUG.WISHDATA_F_UID,   value=str(member.id),    inline=False)
    e.add_field(name=DEBUG.WISHDATA_F_GID,   value=str(ctx.guild.id), inline=False)
    await ctx.send(embed=e)


@bot.command(name="wishall")
async def debug_wishall(ctx: commands.Context):
    if not is_debug_allowed(ctx): return
    data       = await wish_load_readonly()
    guild_data = data.get(str(ctx.guild.id), {}).get("users", {})
    if not guild_data:
        return await reply_info(ctx, DEBUG.WISHALL_NO_DATA, title=DEBUG.WISHALL_NO_DATA_TITLE)
    lines = []
    total_w = total_p = 0
    for uid, ud in sorted(guild_data.items(), key=lambda x: x[1]["wishes"], reverse=True):
        member = ctx.guild.get_member(int(uid))
        name   = member.display_name if member else DEBUG.WISHALL_LEFT_SERVER.format(uid=uid)
        total_w += ud["wishes"]
        total_p += ud["pieces"]
        lines.append(DEBUG.WISHALL_LINE.format(name=name, w=ud["wishes"], p=ud["pieces"]))
    lines.append(DEBUG.WISHALL_FOOTER.format(total_w=total_w, total_p=total_p))
    chunk = "\n".join(lines)
    if len(chunk) > 3900:
        chunk = chunk[:3900] + DEBUG.WISHALL_TRUNCATED
    await ctx.send(embed=discord.Embed(
        title=DEBUG.WISHALL_TITLE.format(guild_name=ctx.guild.name), description=chunk, color=discord.Color.gold()
    ))


@bot.command(name="wishset")
async def debug_wishset(ctx: commands.Context, member: discord.Member, wishes: int, pieces: int):
    if not is_debug_allowed(ctx): return
    result = await WishWallet.set_balance(
        ctx.guild.id, member.id, wishes=wishes, pieces=pieces,
    )
    await ctx.send(embed=discord.Embed(
        title=DEBUG.WISHSET_TITLE,
        description=DEBUG.WISHSET_DESC.format(
            mention=member.mention,
            old_w=result.wish_delta.before,  new_w=result.wish_delta.after,
            old_p=result.piece_delta.before, new_p=result.piece_delta.after,
        ),
        color=discord.Color.green(),
    ))


@bot.command(name="sync")
async def debug_sync(ctx: commands.Context, scope: str = "all"):
    """
    슬래시 커맨드를 Discord에 동기화.
      !y sync         → 봇이 들어가 있는 **모든 서버**에 즉시 반영 (기본)
      !y sync here    → 현재 서버에만 즉시 반영
      !y sync global  → 글로벌 등록 (모든 서버 반영, 최대 1시간 지연)
      !y sync clear   → 현재 서버의 길드 전용 복사본 제거 (글로벌만 남김)
      !y sync nuke    → 글로벌+현재 길드의 모든 명령어 제거 (중복 해결, 재시작 필요)
    """
    if not is_debug_allowed(ctx): return
    msg = await ctx.send(embed=emb(
        DEBUG.SYNC_PROGRESS, title=DEBUG.SYNC_PROGRESS_TITLE,
        color=discord.Color.orange(),
    ))

    try:
        if scope == "here":
            # 글로벌 트리를 현재 길드로 복사 후 sync → 즉시 반영
            bot.tree.copy_global_to(guild=ctx.guild)
            synced = await bot.tree.sync(guild=ctx.guild)
            desc = f"**{len(synced)}개** 명령어를 이 서버(`{ctx.guild.name}`)에 즉시 동기화했습니다."

        elif scope == "clear":
            # 현재 서버의 길드 전용 복사본 제거
            bot.tree.clear_commands(guild=ctx.guild)
            await bot.tree.sync(guild=ctx.guild)
            desc = (
                f"이 서버(`{ctx.guild.name}`)의 길드 전용 명령어를 모두 제거했습니다.\n"
                "이제 글로벌 명령어만 보입니다."
            )

        elif scope == "nuke":
            # 중복/유령 명령어 정리:
            # 1) 현재 길드 전용 복사본 제거
            bot.tree.clear_commands(guild=ctx.guild)
            await bot.tree.sync(guild=ctx.guild)
            # 2) 글로벌 트리를 완전히 비우고 Discord에 반영 (기존 글로벌 전부 삭제)
            bot.tree.clear_commands(guild=None)
            await bot.tree.sync()
            # 3) 코드에 정의된 현재 트리를 글로벌로 재등록
            #    (bot.tree.commands가 이미 메모리에 있으므로, clear 이후 다시 add 필요)
            #    → Python 측 트리는 clear 시 지워지므로 봇 재시작 없이 복구하려면
            #       명령 등록 시점의 데코레이터를 다시 실행해야 하는데,
            #       가장 안전한 방법은 "nuke 후 봇을 재시작하고 !y sync"를 치는 것.
            desc = (
                "💣 **전체 초기화 완료**\n"
                "- 이 서버의 길드 복사본: 삭제됨\n"
                "- 글로벌 명령어: 전부 삭제됨\n\n"
                "⚠️ **이제 봇을 재시작한 후 `!y sync`를 다시 실행하세요.**\n"
                "재시작하지 않으면 명령어가 아예 사라진 상태로 유지됩니다."
            )

        elif scope == "global":
            # 글로벌만 등록 (최대 1시간 지연)
            synced = await bot.tree.sync()
            desc = DEBUG.SYNC_DONE.format(count=len(synced))

        else:
            # 기본: 봇이 들어간 모든 길드에 즉시 반영
            ok_count   = 0
            fail_count = 0
            total_cmds = 0
            for g in list(bot.guilds):
                try:
                    bot.tree.copy_global_to(guild=g)
                    synced = await bot.tree.sync(guild=g)
                    total_cmds += len(synced)
                    ok_count   += 1
                except Exception as ex:
                    fail_count += 1
                    log.warning(f"[sync all] guild={g.id}({g.name}) 실패: {ex}")
            desc = (
                f"**{ok_count}개 서버**에 즉시 동기화 완료 "
                f"(실패 {fail_count}개, 명령어 {total_cmds}개 등록)."
            )

        await msg.edit(embed=emb(desc, title=DEBUG.SYNC_DONE_TITLE, success=True))
    except Exception as ex:
        await msg.edit(embed=emb(
            f"동기화 실패: `{ex}`", title=ERR.TITLE, success=False,
        ))


@bot.command(name="reload")
async def debug_reload(ctx: commands.Context):
    if not is_debug_allowed(ctx): return
    data        = await wish_load_readonly()
    guild_count = len(data)
    user_count  = sum(len(v.get("users", {})) for v in data.values())
    await reply_success(
        ctx,
        DEBUG.RELOAD_DONE.format(guilds=guild_count, users=user_count),
        title=DEBUG.RELOAD_DONE_TITLE,
    )


@bot.command(name="echo")
async def debug_echo(ctx: commands.Context, channel: discord.TextChannel, *, message: str):
    if not is_debug_allowed(ctx): return
    try:
        await channel.send(message)
        await ctx.message.add_reaction("✅")
    except discord.Forbidden:
        await reply_error(ctx, DEBUG.ECHO_FAIL.format(channel=channel.mention))


@bot.command(name="simulate")
async def debug_simulate(ctx: commands.Context, member: discord.Member, *, action: str):
    if not is_debug_allowed(ctx): return
    data = await wish_load_readonly()
    ud   = wish_get_user(data, ctx.guild.id, member.id)
    act  = action.strip().lower()
    if act == "wish_check":
        e = discord.Embed(title=DEBUG.SIM_CHECK.format(name=member.display_name), color=discord.Color.gold())
        e.add_field(name=DEBUG.SIM_CHECK_F_WISH,  value=UNIT.COUNT.format(n=ud['wishes']), inline=True)
        e.add_field(name=DEBUG.SIM_CHECK_F_PIECE, value=UNIT.COUNT.format(n=ud['pieces']), inline=True)
        await ctx.send(embed=e)
    elif act == "wish_make":
        if ud["pieces"] < PIECES_PER_WISH:
            await reply_error(
                ctx,
                DEBUG.SIM_MAKE_FAIL.format(name=member.display_name, have=ud["pieces"], need=PIECES_PER_WISH),
                title=DEBUG.SIM_FAIL_TITLE,
            )
        else:
            await reply_success(
                ctx,
                DEBUG.SIM_MAKE_OK.format(name=member.display_name, pieces=ud["pieces"]),
                title=DEBUG.SIM_PASS_TITLE,
            )
    elif act.startswith("wish_use"):
        content = action[8:].strip() or DEBUG.SIM_USE_EMPTY
        if ud["wishes"] <= 0:
            await reply_error(ctx, DEBUG.SIM_USE_FAIL.format(name=member.display_name), title=DEBUG.SIM_FAIL_TITLE)
        else:
            await reply_success(
                ctx,
                DEBUG.SIM_USE_OK.format(name=member.display_name, content=content),
                title=DEBUG.SIM_PASS_TITLE,
            )
    else:
        await reply_error(
            ctx,
            DEBUG.SIM_UNKNOWN.format(action=action),
            title=DEBUG.SIM_ERR_TITLE,
        )


@bot.command(name="error")
async def debug_error(ctx: commands.Context):
    if not is_debug_allowed(ctx): return
    if not _error_log:
        return await reply_success(ctx, DEBUG.ERROR_NONE, title=DEBUG.ERROR_LOG_TITLE)
    lines = [
        DEBUG.ERROR_LINE.format(time=e["time"], cmd=e["cmd"], user=e["user"], err=e["err"])
        for e in _error_log[-5:]
    ]
    await ctx.send(embed=discord.Embed(
        title=DEBUG.ERROR_TITLE.format(total=len(_error_log)),
        description="\n\n".join(lines),
        color=discord.Color.red(),
    ))


@bot.command(name="clearlog")
async def debug_clearlog(ctx: commands.Context):
    if not is_debug_allowed(ctx): return
    count = len(_error_log)
    _error_log.clear()
    await reply_success(ctx, DEBUG.CLEARLOG_DONE.format(count=count), title=DEBUG.CLEARLOG_DONE_TITLE)


@bot.command(name="backup")
async def debug_backup(ctx: commands.Context):
    """wishes.json 수동 백업."""
    if not is_debug_allowed(ctx): return
    try:
        path = backup_wish_file()
        if path is None:
            return await reply_error(ctx, "백업할 파일이 없습니다.")
        await reply_success(
            ctx,
            DEBUG.BACKUP_DONE.format(path=path),
            title=DEBUG.BACKUP_DONE_TITLE,
        )
    except Exception as ex:
        await reply_error(ctx, DEBUG.BACKUP_FAIL.format(error=ex))


@bot.command(name="help")
async def debug_help(ctx: commands.Context):
    """디버그 명령어 목록과 설명을 표시합니다."""
    if not is_debug_allowed(ctx): return

    e = discord.Embed(
        title=HELP.DEBUG_TITLE,
        description=HELP.DEBUG_DESC,
        color=discord.Color.blurple(),
    )
    # 카테고리별로 필드 추가
    for cat_attr, cmd_names in DEBUG_CATEGORIES:
        lines = []
        for name in cmd_names:
            if name in DEBUG_COMMANDS:
                usage, desc = DEBUG_COMMANDS[name]
                lines.append(f"`!y {usage}`\n↳ {desc}")
        if lines:
            e.add_field(
                name=getattr(HELP, cat_attr),
                value="\n\n".join(lines),
                inline=False,
            )
    await ctx.send(embed=e)


# ══════════════════════════════════════════════════════════════════════════════
# ⑱ 봇 이벤트
# ══════════════════════════════════════════════════════════════════════════════

@bot.event
async def on_ready():
    # on_ready 는 재연결(RESUME)마다 호출되므로, 슬래시 동기화는 최초 1회만 수행한다.
    # (매번 전체 길드 sync 하면 rate limit·시작 지연이 생김)
    if not getattr(bot, "_synced_once", False):
        ok = fail = 0
        for g in list(bot.guilds):
            try:
                bot.tree.copy_global_to(guild=g)
                await bot.tree.sync(guild=g)
                ok += 1
            except Exception as ex:
                fail += 1
                log.warning(f"[on_ready sync] guild={g.id}: {ex}")
        bot._synced_once = True
        log.info(f"[on_ready sync] {ok}개 서버 동기화 완료 (실패 {fail}개)")

    # Persistent View 등록 — 재시작 후에도 버튼이 살아있도록
    # (한 번만 등록해야 하므로 플래그로 체크)
    if not getattr(bot, "_persistent_views_added", False):
        bot.add_view(WishApprovalView())
        bot._persistent_views_added = True

    # 타살버: 재시작 시 만료된 별명 복구 / 진행 중인 건 만료 예약 재등록 (최초 1회만)
    if not getattr(bot, "_sarcasm_restored", False):
        bot._sarcasm_restored = True
        with contextlib.suppress(Exception):
            await _sarcasm_restore_on_start()

    log.info(SYSTEM.ON_READY.format(user=bot.user, guilds=len(bot.guilds)))
    # 시작 시 자동 백업
    try:
        backup_wish_file()
    except Exception as ex:
        log.warning(SYSTEM.BACKUP_FAIL.format(error=ex))


@bot.event
async def on_guild_join(guild: discord.Guild):
    # 새로 들어간 서버에도 즉시 슬래시 커맨드 등록
    try:
        bot.tree.copy_global_to(guild=guild)
        await bot.tree.sync(guild=guild)
        log.info(f"[on_guild_join] {guild.id}({guild.name}) 동기화 완료")
    except Exception as ex:
        log.warning(f"[on_guild_join] {guild.id}({guild.name}) 동기화 실패: {ex}")


@bot.listen("on_interaction")
async def _log_interaction(interaction: discord.Interaction):
    """진단용: config.LOG_INTERACTIONS=True 일 때 수신한 모든 상호작용을 기록.
    어떤 버튼/명령에서 '상호작용 실패'가 나는지 추적할 때 사용 (평소엔 off)."""
    if not LOG_INTERACTIONS:
        return
    data = interaction.data or {}
    cmd = interaction.command.name if interaction.command else None
    log.info(
        "[interaction] type=%s user=%s cmd=%s custom_id=%s channel=%s",
        getattr(interaction.type, "name", interaction.type),
        interaction.user, cmd, data.get("custom_id"), interaction.channel_id,
    )


@bot.event
async def on_command_error(ctx: commands.Context, error: Exception):
    log_error(
        cmd=ctx.command.name if ctx.command else "?",
        user=str(ctx.author),
        err=str(error),
    )
    log.warning(f"[prefix cmd] {ctx.command} by {ctx.author}: {error}")


@bot.tree.error
async def on_app_command_error(interaction: discord.Interaction, error: app_commands.AppCommandError):
    if isinstance(error, app_commands.CheckFailure):
        return
    log_error(
        cmd=interaction.command.name if interaction.command else "?",
        user=str(interaction.user),
        err=str(error),
    )
    log.exception(f"[slash cmd] {interaction.command}: {error}")
    # 사용자에게 간단한 에러 메시지
    with contextlib.suppress(Exception):
        await reply_error(interaction, f"명령어 처리 중 오류가 발생했습니다.\n`{error}`")


# ══════════════════════════════════════════════════════════════════════════════
# ⑲ 실행
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    bot.run(TOKEN, log_handler=None)  # 자체 로깅 사용