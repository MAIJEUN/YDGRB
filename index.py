import discord
from discord import app_commands
from discord.ext import commands
from discord.ui import View, Button
from datetime import timedelta
from discord.utils import utcnow
import base64
import asyncio
import json
import os
import random
import functools

intents = discord.Intents.default()
intents.messages = True
intents.guilds = True
intents.members = True
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)

active_quizzes: dict[int, "QuizEngine"] = {}
baseball_games: dict[int, dict] = {}

WISH_FILE = "wishes.json"

CHOSUNG_LIST = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"]

WISH_DELIVER_CHANNEL_ID = 1431274203440484452
ALLOWED_CHANNEL_ID = 1250769917112750150

_wish_lock = asyncio.Lock()



# ─────────────────────────────────────────────
# 유틸리티 및 데이터 관리
# ─────────────────────────────────────────────


def e(description: str, *, title: str = "", color: discord.Color = None, success: bool | None = None) -> discord.Embed:
    if color is None:
        if success is True:
            color = discord.Color.green()
        elif success is False:
            color = discord.Color.red()
        else:
            color = discord.Color.blurple()
    return discord.Embed(title=title, description=description, color=color)


def compute_baseball_result(secret: str, guess: str):
    strike, ball = 0, 0
    for i in range(len(guess)):
        if guess[i] == secret[i]:
            strike += 1
        elif guess[i] in secret:
            ball += 1
    out = len(guess) - strike - ball
    return strike, ball, out


def _load_json(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_json(path: str, data: dict):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)


async def load_wishes() -> dict:
    async with _wish_lock:
        return _load_json(WISH_FILE)


async def save_wishes(data: dict):
    async with _wish_lock:
        _save_json(WISH_FILE, data)


def get_user_data(data: dict, guild_id: str, user_id: str) -> dict:
    guild = data.setdefault(guild_id, {})
    users = guild.setdefault("users", {})
    return users.setdefault(user_id, {"wishes": 0, "pieces": 0})


# ─────────────────────────────────────────────
# 채널 체크
# ─────────────────────────────────────────────
def channel_check():
    async def predicate(interaction: discord.Interaction) -> bool:
        if not isinstance(interaction.user, discord.Member):
            await interaction.response.send_message(
                embed=e("서버 채널에서만 사용할 수 있습니다.", title="X 오류", success=False),
                ephemeral=True
            )
            return False
        if (interaction.user.guild_permissions.administrator
                or interaction.channel_id == ALLOWED_CHANNEL_ID):
            return True
        await interaction.response.send_message(
            embed=e("지정된 채널에서만 명령어를 사용할 수 있습니다.", title="X 오류", success=False),
            ephemeral=True
        )
        return False
    return app_commands.check(predicate)


@bot.check
async def prefix_channel_check(ctx: commands.Context):
    if not isinstance(ctx.author, discord.Member):
        return False
    return (ctx.author.guild_permissions.administrator
            or ctx.channel.id == ALLOWED_CHANNEL_ID)


# ─────────────────────────────────────────────
# 룰렛 시스템
# ─────────────────────────────────────────────
def render_slot(players: list[str], center: int, window: int = 2) -> str:
    n = len(players)
    lines = []
    for offset in range(-window, window + 1):
        name = players[(center + offset) % n]
        if offset == 0:
            lines.append(f"> {name} <")
        else:
            lines.append(f"  {name}")
    return "\n".join(lines)

def wish_check_errer_if_fuck_code(func):
    @functools.wraps(func)
    async def wrapper(interaction: discord.Interaction, *args, **kwargs):
        if random.random() < 0.001:  # 룰렛 ㅈ박았을때 심패소생술
            try:
                await interaction.response.send_message(wish_check_errer_if_fuck_code_URL, ephemeral=True)
            except Exception:
                print("당신은 실패했다.")
            return  # 원래 명령어 실행 안 함
        return await func(interaction, *args, **kwargs)
    return wrapper

def build_roulette_embed(
    players: list[str],
    center: int,
    title: str = "랜덤뽑기",
    finished: bool = False,
    winner: str = None,
) -> discord.Embed:
    slot = f"```\n{render_slot(players, center)}\n```"
    if finished and winner:
        desc = slot + f"\n**당첨자: {winner}**"
        color = discord.Color.gold()
    else:
        desc = slot
        color = discord.Color.blurple()
    return discord.Embed(title=f"{title}", description=desc, color=color)


def build_bundle_embed(
    players: list[str],
    frames: list[int],
    title: str,
    finished: bool = False,
    winner: str = None,
) -> discord.Embed:
    sections = []
    for i, center in enumerate(frames):
        is_last = (i == len(frames) - 1)
        if is_last and finished and winner:
            sections.append(f"```\n{render_slot(players, center)}\n```\n🎉 **당첨자: {winner}** 🎉")
        else:
            sections.append(f"```\n{render_slot(players, center)}\n```")

    desc = "\n".join(sections)
    color = discord.Color.gold() if (finished and winner) else discord.Color.blurple()
    return discord.Embed(title=f"{title}", description=desc, color=color)


async def run_roulette(msg: discord.Message, players: list[str], title: str, player_ids: list[int] = None):
    n = len(players)
    winner_idx = random.randint(0, n - 1)

    schedule: list[tuple[int, float]] = [
        (1, 0.55), (1, 0.40), (1, 0.28), (1, 0.18), (1, 0.12),
    (1, 0.18), (1, 0.25), (1, 0.35), (1, 0.46), (1, 0.58),
    (1, 0.72), (1, 0.88), (1, 1.05),
    ]

    total_steps = sum(f for f, _ in schedule)
    current = (winner_idx - total_steps) % n

    for frames_count, sleep_time in schedule:
        frame_indices = []
        for _ in range(frames_count):
            frame_indices.append(current)
            current = (current + 1) % n

        try:
            await msg.edit(embed=build_bundle_embed(players, frame_indices, title))
        except discord.HTTPException:
            pass

        await asyncio.sleep(sleep_time)

    winner_name = players[winner_idx]
    winner_mention = f"<@{player_ids[winner_idx]}>" if player_ids else winner_name
    try:
        await msg.edit(
            embed=build_roulette_embed(players, winner_idx, title, finished=True, winner=winner_name)
        )
    except discord.HTTPException:
        pass

    await msg.channel.send(
        embed=discord.Embed(
            title="당첨",
            description=f"{winner_mention} ← 당첨된 청년",
            color=discord.Color.gold(),
        )
    )


@bot.tree.command(name="룰렛", description="참가자를 모집하고 랜덤으로 한 명을 뽑습니다.")
# @channel_check()
@wish_check_errer_if_fuck_code
@app_commands.describe(사람수="최대 참가 인원 수 (2~50)", 제목="룰렛 제목 (기본: 랜덤뽑기)")
async def roulette(interaction: discord.Interaction, 사람수: int, 제목: str = "랜덤뽑기"):
    if 사람수 < 2:
        return await interaction.response.send_message(
            embed=e("참가 인원은 최소 2명 이상이어야 합니다.", title="X 오류", success=False),
            ephemeral=True
        )
    if 사람수 > 50:
        return await interaction.response.send_message(
            embed=e("참가 인원은 최대 50명까지 가능합니다.", title="X 오류", success=False),
            ephemeral=True
        )

    host_id = interaction.user.id
    players: list[int] = []
    recruit_done = asyncio.Event()
    TIMEOUT = 180

    def make_recruit_embed(done: bool = False) -> discord.Embed:
        if done:
            desc = "모집 완료! 잠시 후 룰렛을 시작합니다."
        else:
            desc = (
                f"참가자를 모집합니다. 아래 버튼을 눌러 참가하세요.\n"
                f"**참가 인원:** {len(players)}/{사람수}"
            )
        embed = discord.Embed(title=f"{제목}", description=desc, color=0x00AE86)
        if players:
            names = " > ".join(
                f"@{interaction.guild.get_member(pid).display_name}"
                if interaction.guild.get_member(pid) else f"<@{pid}>"
                for pid in players
            )
            embed.add_field(name="참가자 목록", value=names, inline=False)
        return embed

    view = View(timeout=TIMEOUT)
    join_btn  = Button(label="참가",      style=discord.ButtonStyle.success)
    start_btn = Button(label="룰렛 시작", style=discord.ButtonStyle.primary, disabled=True)

    async def join_callback(inter: discord.Interaction):
        if inter.user.id in players:
            return await inter.response.send_message(
                embed=e("이미 참가했습니다.", title="X 중복 참가", success=False),
                ephemeral=True
            )
        players.append(inter.user.id)

        # ✅ 정원이 다 찼으면 자동으로 룰렛 시작
        if len(players) >= 사람수:
            join_btn.disabled  = True
            start_btn.disabled = True
            await inter.response.edit_message(embed=make_recruit_embed(done=True), view=view)
            recruit_done.set()
        else:
            start_btn.disabled = (len(players) < 2)
            await inter.response.edit_message(embed=make_recruit_embed(), view=view)

    async def start_callback(inter: discord.Interaction):
        is_host = inter.user.id == host_id
        is_admin = isinstance(inter.user, discord.Member) and inter.user.guild_permissions.administrator
        if not (is_host or is_admin):
            return await inter.response.send_message(
                embed=e("룰렛을 시작한 사람 또는 관리자만 시작할 수 있습니다.", title="X 권한 없음", success=False),
                ephemeral=True
            )
        if len(players) < 2:
            return await inter.response.send_message(
                embed=e("최소 2명 이상 참가해야 시작할 수 있습니다.", title="X 오류", success=False),
                ephemeral=True
            )
        join_btn.disabled  = True
        start_btn.disabled = True
        await inter.response.edit_message(embed=make_recruit_embed(done=True), view=view)
        recruit_done.set()

    join_btn.callback  = join_callback
    start_btn.callback = start_callback
    view.add_item(join_btn)
    view.add_item(start_btn)

    await interaction.response.send_message(embed=make_recruit_embed(), view=view)

    try:
        await asyncio.wait_for(recruit_done.wait(), timeout=TIMEOUT)
    except asyncio.TimeoutError:
        join_btn.disabled  = True
        start_btn.disabled = True
        try:
            await interaction.edit_original_response(
                embed=e("3분 동안 룰렛이 시작되지 않아 취소되었습니다.", title="X 룰렛 취소", success=False),
                view=view
            )
        except Exception:
            pass
        return

    player_names = [
        f"@{interaction.guild.get_member(pid).display_name}"
        for pid in players
        if interaction.guild.get_member(pid)
    ]
    player_ids_valid = [
        pid
        for pid in players
        if interaction.guild.get_member(pid)
    ]

    if len(player_names) < 2:
        await interaction.channel.send(
            embed=e("유효한 참가자가 부족하여 룰렛을 취소합니다.", title="X 취소", success=False)
        )
        return

    roulette_msg = await interaction.channel.send(
        embed=build_roulette_embed(player_names, 0, 제목)
    )
    await run_roulette(roulette_msg, player_names, 제목, player_ids=player_ids_valid)


# ─────────────────────────────────────────────
# 숫자야구 DM 패드
# ─────────────────────────────────────────────
class BaseballDMPad(View):
    def __init__(self, game_guild_id, game_channel_id, user_id, length):
        super().__init__(timeout=None)
        self.game_guild_id = game_guild_id
        self.game_channel_id = game_channel_id
        self.user_id = user_id
        self.length = length
        self.current = ""
        self.update_buttons()

    def create_embed(self):
        display = self.current.ljust(self.length, ".")
        channel_url = f"https://discord.com/channels/{self.game_guild_id}/{self.game_channel_id}"
        embed = discord.Embed(
            title="숫자 설정",
            description=(
                f"상대방이 맞출 숫자를 입력하세요.\n\n"
                f"**입력:** `{display}`\n"
                f"**남은 자리:** {self.length - len(self.current)}"
            ),
            color=0x5865F2,
        )
        if len(self.current) == self.length:
            embed.add_field(name="O 설정 완료", value=f"[채널로 돌아가기]({channel_url})")
        return embed

    def update_buttons(self):
        self.clear_items()
        is_full = len(self.current) >= self.length
        for i in range(1, 10):
            num = str(i)
            btn = Button(
                label=num,
                style=discord.ButtonStyle.secondary,
                disabled=(num in self.current or is_full),
            )
            btn.callback = self.make_number_callback(num)
            self.add_item(btn)
        btn_0 = Button(
            label="0",
            style=discord.ButtonStyle.secondary,
            disabled=("0" in self.current or is_full),
        )
        btn_0.callback = self.make_number_callback("0")
        self.add_item(btn_0)
        btn_back = Button(
            label="되돌리기",
            style=discord.ButtonStyle.danger,
            disabled=(is_full or len(self.current) == 0),
        )
        btn_back.callback = self.back_callback
        self.add_item(btn_back)

    def make_number_callback(self, num: str):
        async def callback(interaction: discord.Interaction):
            self.current += num
            self.update_buttons()
            if len(self.current) == self.length:
                game = baseball_games.get(self.game_guild_id)
                if game:
                    game["secrets"][self.user_id] = self.current
                    await interaction.response.edit_message(embed=self.create_embed(), view=self)
                    if len(game["secrets"]) == 2:
                        await start_baseball_match(game)
            else:
                await interaction.response.edit_message(embed=self.create_embed(), view=self)
        return callback

    async def back_callback(self, interaction: discord.Interaction):
        self.current = self.current[:-1]
        self.update_buttons()
        await interaction.response.edit_message(embed=self.create_embed(), view=self)


# ─────────────────────────────────────────────
# 숫자야구 채널 게임 패드
# ─────────────────────────────────────────────
class BaseballGamePad(View):
    def __init__(self, game: dict):
        super().__init__(timeout=None)
        self.game = game
        self._processing = False

    def create_view(self):
        self.clear_items()
        current_guess = self.game["current_guess"]
        is_full = len(current_guess) >= self.game["length"]
        nums = [str(i) for i in range(1, 10)] + ["0"]
        for num in nums:
            btn = Button(
                label=num,
                style=discord.ButtonStyle.secondary,
                disabled=(num in current_guess or is_full or self._processing),
            )
            btn.callback = self.make_callback(num)
            self.add_item(btn)
        btn_back = Button(
            label="되돌리기",
            style=discord.ButtonStyle.danger,
            disabled=(len(current_guess) == 0 or self._processing),
        )
        btn_back.callback = self.back_callback
        self.add_item(btn_back)
        return self

    def make_callback(self, num: str):
        async def callback(interaction: discord.Interaction):
            if interaction.user.id != self.game["players"][self.game["turn_index"]]:
                return await interaction.response.send_message(
                    embed=e("당신의 턴이 아닙니다", title="X 오류", success=False),
                    ephemeral=True
                )
            if self._processing:
                return
            try:
                self._processing = True
                self.game["current_guess"] += num
                await process_baseball_turn(self.game, interaction)
            finally:
                self._processing = False
        return callback

    async def back_callback(self, interaction: discord.Interaction):
        if interaction.user.id != self.game["players"][self.game["turn_index"]]:
            return await interaction.response.send_message(
                embed=e("당신의 턴이 아닙니다", title="X 오류", success=False),
                ephemeral=True
            )
        if self._processing:
            return
        self._processing = True
        self.game["current_guess"] = self.game["current_guess"][:-1]
        await interaction.response.edit_message(view=self.create_view())
        await update_baseball_table(self.game)
        self._processing = False


# ─────────────────────────────────────────────
# 숫자야구 핵심 로직
# ─────────────────────────────────────────────
async def update_baseball_table(game: dict, time_left: int = 60):
    current_player_id = game["players"][game["turn_index"]]
    current_player = game["channel"].guild.get_member(current_player_id)
    title = f"게임 테이블 - 턴 {game['turn_count']} ({time_left}s 남음)"
    embed = discord.Embed(title=title, color=0xFAA61A)
    lines = []
    for i, h in enumerate(game["history"]):
        if i > 0 and i % 2 == 0:
            lines.append("")
        lines.append(f"{h['tag']} -> {h['guess']} | {h['s']}S {h['b']}B {h['o']}O")
    display_guess = game["current_guess"].ljust(game["length"], ".")
    status_msg = f"\n**{current_player.mention}의 차례입니다.**\n**입력 :** `{display_guess}`"
    embed.description = ("\n".join(lines) if lines else "경기를 시작합니다") + "\n" + status_msg
    if game.get("table_msg"):
        try:
            await game["table_msg"].edit(embed=embed)
        except Exception:
            game["table_msg"] = await game["channel"].send(embed=embed)
    else:
        game["table_msg"] = await game["channel"].send(embed=embed)


async def start_baseball_match(game: dict):
    msg = await game["channel"].send(
        embed=e("두 청년 모두 준비, 곧 시작합니다.", title="숫자야구", color=discord.Color.blurple())
    )
    await asyncio.sleep(2)
    await msg.delete()
    game["started"] = True
    await update_baseball_table(game)
    pad_view = BaseballGamePad(game)
    game["pad_msg"] = await game["channel"].send(view=pad_view.create_view())
    game["turn_event"] = asyncio.Event()
    bot.loop.create_task(baseball_turn_timer(game, game["turn_count"], game["turn_index"]))


async def baseball_turn_timer(game: dict, turn: int, index: int):
    event: asyncio.Event = game.get("turn_event", asyncio.Event())
    current_time = 60
    while current_time > 0:
        if game["guild_id"] not in baseball_games:
            return
        if game["turn_count"] != turn or game["turn_index"] != index:
            return
        try:
            await asyncio.wait_for(asyncio.shield(event.wait()), timeout=1.0)
            return
        except asyncio.TimeoutError:
            pass
        current_time -= 1
        game["time_left"] = current_time
        try:
            await update_baseball_table(game, current_time)
        except Exception:
            pass
    if (game["guild_id"] in baseball_games
            and game["turn_count"] == turn
            and game["turn_index"] == index):
        winner_id = game["players"][(index + 1) % 2]
        await game["channel"].send(
            embed=discord.Embed(
                title="⏱ 시간 초과!",
                description=f"<@{game['players'][index]}> 청년의 패배\n<@{winner_id}> 승리",
                color=discord.Color.red(),
            )
        )
        baseball_games.pop(game["guild_id"], None)


async def process_baseball_turn(game: dict, interaction: discord.Interaction):
    guess = game["current_guess"]
    length = game["length"]
    if len(guess) < length:
        try:
            pad_view = BaseballGamePad(game)
            await interaction.response.edit_message(view=pad_view.create_view())
            await update_baseball_table(game, game.get("time_left", 60))
        except discord.NotFound:
            pass
        return
    try:
        current_view = BaseballGamePad(game)
        disabled_view = current_view.create_view()
        for item in disabled_view.children:
            item.disabled = True
        await interaction.response.edit_message(view=disabled_view)
    except discord.NotFound:
        return
    opponent_id = game["players"][(game["turn_index"] + 1) % 2]
    s, b, o = compute_baseball_result(game["secrets"][opponent_id], guess)
    user = interaction.user
    game["history"].append({"tag": user.display_name, "guess": guess, "s": s, "b": b, "o": o})
    game["current_guess"] = ""
    if "turn_event" in game:
        game["turn_event"].set()
    if s == length:
        await update_baseball_table(game)
        await interaction.edit_original_response(
            embed=discord.Embed(
                title="정답",
                description=f"{user.mention} 승리\n**정답:** `{guess}`",
                color=discord.Color.gold(),
            ),
            view=None
        )
        baseball_games.pop(game["guild_id"], None)
    else:
        game["turn_index"] = (game["turn_index"] + 1) % 2
        if game["turn_index"] == 0:
            game["turn_count"] += 1
        if game["turn_count"] > 100:
            await update_baseball_table(game)
            await interaction.edit_original_response(
                embed=e("최대 턴을 초과하여 무승부입니다.", title="무승부", color=discord.Color.greyple()),
                view=None
            )
            baseball_games.pop(game["guild_id"], None)
            return
        game["turn_event"] = asyncio.Event()
        await update_baseball_table(game, 60)
        next_pad_view = BaseballGamePad(game)
        await interaction.edit_original_response(view=next_pad_view.create_view())
        bot.loop.create_task(baseball_turn_timer(game, game["turn_count"], game["turn_index"]))


# ─────────────────────────────────────────────
# 퀴즈 엔진
# ─────────────────────────────────────────────
class QuizEngine:
    def __init__(self, bot, channel, *, question_text, answer, time_limit, title="퀴즈", display_question=None):
        self.bot = bot
        self.channel = channel
        self.question_text = question_text
        self.answer = answer
        self.time_limit = time_limit
        self.title = title
        self.display_question = display_question or question_text
        self.msg = None
        self.winner = None
        self.time_left = time_limit
        self.stop_event = asyncio.Event()

    async def start(self):
        if self.channel.id in active_quizzes:
            await self.channel.send(embed=e("이 채널에서는 이미 퀴즈가 진행 중입니다.", title="X 오류", success=False))
            return
        active_quizzes[self.channel.id] = self
        self.msg = await self.channel.send(embed=discord.Embed(
            title=self.title,
            description=f"{self.display_question}\n⏱ 제한시간 : {self.time_limit}초",
            color=discord.Color.random(),
        ))
        await asyncio.gather(self.wait_for_answer(), self.countdown())
        await self.finish()

    async def wait_for_answer(self):
        def check(m):
            return m.channel.id == self.channel.id and not m.author.bot and m.content.strip() == self.answer
        try:
            msg = await self.bot.wait_for("message", timeout=self.time_limit, check=check)
            self.winner = msg.author
            self.stop_event.set()
        except asyncio.TimeoutError:
            self.stop_event.set()

    async def countdown(self):
        while self.time_left > 0 and not self.stop_event.is_set():
            try:
                await self.msg.edit(embed=discord.Embed(
                    title=self.title,
                    description=f"{self.display_question}\n⏱ 제한시간 : {self.time_left}초",
                    color=discord.Color.random(),
                ))
            except discord.NotFound:
                self.stop_event.set()
                return
            await asyncio.sleep(1)
            self.time_left -= 1

    async def finish(self):
        if self.winner:
            await self.msg.edit(embed=discord.Embed(
                title="O 정답!",
                description=f"{self.display_question}\n**정답 :** {self.answer}\n**맞춘 청년 :** {self.winner.mention}",
                color=discord.Color.green(),
            ))
            await self.channel.send(embed=e(f"{self.winner.mention} ← 맞춘 청년", title="정답자", color=discord.Color.gold()))
        else:
            await self.msg.edit(embed=discord.Embed(
                title="퀴즈 종료",
                description=f"{self.display_question}\n**정답 :** {self.answer}",
                color=discord.Color.red(),
            ))
        active_quizzes.pop(self.channel.id, None)


# ─────────────────────────────────────────────
# 별명 관리
# ─────────────────────────────────────────────
@bot.tree.command(name="별명뚜따이", description="모든 멤버의 별명을 뚜따이합니다!")
# @channel_check()
@wish_check_errer_if_fuck_code
@app_commands.checks.has_permissions(administrator=True)
async def nickname_all(interaction: discord.Interaction, 새별명: str):
    guild = interaction.guild
    if guild is None:
        return
    total, success, fail = len(guild.members), 0, 0
    embed = discord.Embed(title="뚜따이 중...", description=f"전체 : {total}\n완료 : 0\n실패 : 0", color=discord.Color.orange())
    await interaction.response.send_message(embed=embed)
    msg = await interaction.original_response()
    for member in guild.members:
        try:
            await member.edit(nick=새별명)
            success += 1
        except Exception as ex:
            print(f"{member} 실패 사유: {ex}")
            fail += 1
        embed.description = f"전체 : {total}\n완료 : {success}\n실패 : {fail}"
        await msg.edit(embed=embed)
        await asyncio.sleep(0.3)
    await msg.edit(embed=discord.Embed(
        title="O 뚜따이 완료",
        description=f"모든 멤버의 별명을 **{새별명}**(으)로 뚜따이했습니다.\n\n완료 : {success}\n실패 : {fail}",
        color=discord.Color.green(),
    ))


@bot.tree.command(name="별명바사삭", description="모든 멤버의 별명을 바사삭합니다!")
# @channel_check()
@wish_check_errer_if_fuck_code
@app_commands.checks.has_permissions(administrator=True)
async def nickname_restore(interaction: discord.Interaction):
    guild = interaction.guild
    if guild is None:
        return
    total, success, fail = len(guild.members), 0, 0
    embed = discord.Embed(title="바사삭 중...", description=f"전체 : {total}\n완료 : 0\n실패 : 0", color=discord.Color.orange())
    await interaction.response.send_message(embed=embed)
    msg = await interaction.original_response()
    for member in guild.members:
        try:
            await member.edit(nick=None)
            success += 1
        except Exception as ex:
            print(f"{member} 실패 사유: {ex}")
            fail += 1
        embed.description = f"전체 : {total}\n완료 : {success}\n실패 : {fail}"
        await msg.edit(embed=embed)
        await asyncio.sleep(0.3)
    await msg.edit(embed=discord.Embed(
        title="O 바사삭 완료",
        description=f"모든 멤버의 별명을 바사삭했습니다.\n\n완료 : {success}\n실패 : {fail}",
        color=discord.Color.green(),
    ))


# ─────────────────────────────────────────────
# 선착순 버튼
# ─────────────────────────────────────────────
class FirstClickButton(View):
    def __init__(self):
        super().__init__(timeout=None)
        self.winner = None

    @discord.ui.button(label="버튼", style=discord.ButtonStyle.green)
    async def click_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.winner is None:
            self.winner = interaction.user
            for child in self.children:
                child.disabled = True
            embed = discord.Embed(
                title=interaction.message.embeds[0].title,
                description=f"누구보다 빠르게 버튼 누르는 사람은 누굴까\n\n**당첨자:**\n{interaction.user.mention}",
                color=discord.Color.gold(),
            )
            await interaction.response.edit_message(embed=embed, view=self)
            await interaction.channel.send(embed=e(f"{interaction.user.mention} ← 가장 빠른 청년", title="당첨", color=discord.Color.gold()))
        else:
            await interaction.response.send_message(embed=e("안타까운 청년, 이미 끝났습니다.", title="아쉽냐?ㅋ", success=False), ephemeral=True)


@bot.tree.command(name="선착순한명", description="가장 먼저 버튼을 누르는 청년에게 보상을줄수도있고아닐수도.")
# @channel_check()
@wish_check_errer_if_fuck_code
@app_commands.describe(제목="제목")
async def first_click(interaction: discord.Interaction, 제목: str = "선착 순한 마리"):
    embed = discord.Embed(
        title=제목,
        description="누구보다 빠르게 버튼 누르는 사람은 누굴까\n\n**당첨자**\n아직없",
        color=discord.Color.random(),
    )
    await interaction.response.send_message(embed=embed, view=FirstClickButton())


# ─────────────────────────────────────────────
# 퀴즈 명령어
# ─────────────────────────────────────────────
def get_chosung(word: str) -> str:
    result = ""
    for char in word:
        if "가" <= char <= "힣":
            code = ord(char) - 0xAC00
            result += CHOSUNG_LIST[code // 588]
        else:
            result += char
    return result


@bot.tree.command(name="퀴즈", description="제한 시간 안에 정답을 맞추는 청년에게 보상을줄수도있고아닐수도.")
# @channel_check()
@wish_check_errer_if_fuck_code
async def quiz(interaction: discord.Interaction, 문제: str, 정답: str, 시간: int):
    await interaction.response.send_message(embed=e("퀴즈를 시작합니다!", title="퀴즈 시작", success=True), ephemeral=True)
    engine = QuizEngine(bot, interaction.channel, question_text=f"문제 : {문제}", answer=정답, time_limit=max(5, min(시간, 300)), title="퀴즈")
    await engine.start()


@bot.tree.command(name="초성퀴즈", description="초성 퀴즈를 맞추는 청년에게 보상을줄수도있고아닐수도.")
# @channel_check()
@wish_check_errer_if_fuck_code
async def chosung_quiz(interaction: discord.Interaction, 텍스트: str, 시간초: int):
    초성 = get_chosung(텍스트)
    await interaction.response.send_message(embed=e("초성퀴즈를 시작합니다!", title="초성퀴즈 시작", success=True), ephemeral=True)
    engine = QuizEngine(bot, interaction.channel, question_text=f"초성 : {초성}", display_question=f"초성 : {초성}", answer=텍스트, time_limit=max(5, min(시간초, 300)), title="초성퀴즈")
    await engine.start()


# ─────────────────────────────────────────────
# 채널 / 역할 관리
# ─────────────────────────────────────────────
@bot.tree.command(name="슬로우뿡모드", description="해당 채널의 슬로우모드를 설정할수도있고. 0이면 끌까.")
# @channel_check()
@wish_check_errer_if_fuck_code
@app_commands.describe(시간초="슬로우모드 시간 (초)")
@app_commands.checks.has_permissions(manage_channels=True)
async def slowmode(interaction: discord.Interaction, 시간초: int):
    channel = interaction.channel
    try:
        await channel.edit(slowmode_delay=max(0, 시간초))
        msg = f"{channel.mention} 채널의 슬로우모드를 해제했습니다." if 시간초 == 0 else f"{channel.mention} 채널의 슬로우모드를 **{시간초}초**로 설정했습니다."
        title = "O 슬로우모드 해제" if 시간초 == 0 else "O 슬로우모드 설정"
        await interaction.response.send_message(embed=e(msg, title=title, success=True), ephemeral=True)
    except Exception as ex:
        await interaction.response.send_message(embed=e(f"슬로우모드 설정 실패: {ex}", title="X 오류", success=False), ephemeral=True)


@bot.tree.command(name="채팅뻥", description="해당 역할의 채널 메시지 권한을 토글하고싶어.")
# @channel_check()
@wish_check_errer_if_fuck_code
@app_commands.describe(역할="메시지를 토글할 역할")
@app_commands.checks.has_permissions(manage_roles=True)
async def toggle_chat(interaction: discord.Interaction, 역할: discord.Role):
    channel = interaction.channel
    overwrite = channel.overwrites_for(역할)
    if overwrite.send_messages is False:
        overwrite.send_messages = True
        상태 = "허용"
    else:
        overwrite.send_messages = False
        상태 = "차단"
    try:
        await channel.set_permissions(역할, overwrite=overwrite)
        await interaction.response.send_message(embed=e(f"{역할.mention}의 메시지 권한을 **{상태}**으로 변경했습니다.", title="O 권한 변경", success=True))
    except Exception as ex:
        await interaction.response.send_message(embed=e(f"권한 변경 실패: {ex}", title="X 오류", success=False), ephemeral=True)


@bot.tree.command(name="타임아웃", description="유저를 잠시 착하게 만듭니다.")
# @channel_check()
@wish_check_errer_if_fuck_code
@app_commands.describe(유저="타임아웃할 유저", 시간초="타임아웃 시간 (초)")
@app_commands.checks.has_permissions(moderate_members=True)
async def timeout_cmd(interaction: discord.Interaction, 유저: discord.Member, 시간초: int):
    try:
        until_time = utcnow() + timedelta(seconds=max(1, min(시간초, 2419200)))
        await 유저.timeout(until_time)
        await interaction.response.send_message(embed=e(f"{유저.mention}님을 **{시간초}초** 동안 타임아웃했습니다.", title="타임아웃", color=discord.Color.orange()))
    except Exception as ex:
        await interaction.response.send_message(embed=e(f"타임아웃 실패: {ex}", title="X 오류", success=False), ephemeral=True)


# ─────────────────────────────────────────────
# 소원권
# ─────────────────────────────────────────────
wish_group = app_commands.Group(name="소원권", description="소원권 관련 명령어")
bot.tree.add_command(wish_group)


@wish_group.command(name="확인", description="보유 중인 소원권과 소원권 조각을 확인할수있는기회가?이런놀라운!당장쿠폰코드697을입력하여잠금해재!")
# @channel_check()
@wish_check_errer_if_fuck_code
async def wish_check(interaction: discord.Interaction):
    data = await load_wishes()
    user = interaction.user
    user_data = get_user_data(data, str(interaction.guild.id), str(user.id))
    embed = discord.Embed(title=f"{user.display_name}의 소원권 현황", color=discord.Color.gold())
    embed.add_field(name="소원권", value=f"{user_data['wishes']}개", inline=True)
    embed.add_field(name="소원권 조각", value=f"{user_data['pieces']}개", inline=True)
    embed.set_footer(text=f"@{user.name} ({user.display_name})", icon_url=user.display_avatar.url)
    await interaction.response.send_message(embed=embed)


@wish_group.command(name="만들기", description="소원권 조각 5개로 소원권을 만들꼬야...")
# @channel_check()
@wish_check_errer_if_fuck_code
async def wish_make(interaction: discord.Interaction):
    data = await load_wishes()
    user_data = get_user_data(data, str(interaction.guild.id), str(interaction.user.id))
    if user_data["pieces"] < 5:
        return await interaction.response.send_message(embed=e(f"소원권 조각이 부족합니다.\n현재 보유: **{user_data['pieces']}개** / 필요: **5개**", title="X 조각 부족", success=False), ephemeral=True)
    user_data["pieces"] -= 5
    user_data["wishes"] += 1
    await save_wishes(data)
    await interaction.response.send_message(embed=e("소원권 **1장**을 성공적으로 만들었습니다!", title="O 소원권 제작 완료", success=True))


@wish_group.command(name="사용", description="소원권을 사용한다맨이야.")
# @channel_check()
@wish_check_errer_if_fuck_code
@app_commands.describe(텍스트="소원 내용", 이미지="첨부할 이미지 (선택)")
async def wish_use(interaction: discord.Interaction, 텍스트: str, 이미지: discord.Attachment | None = None):
    data = await load_wishes()
    user = interaction.user
    user_data = get_user_data(data, str(interaction.guild.id), str(user.id))
    if user_data["wishes"] <= 0:
        return await interaction.response.send_message(embed=e("사용할 소원권이 없습니다.", title="X 소원권 없음", success=False), ephemeral=True)
    user_data["wishes"] -= 1
    await save_wishes(data)
    await interaction.response.send_message(embed=e("소원권을 사용했습니다!", title="O 소원권 사용 완료", success=True))
    deliver_channel = interaction.guild.get_channel(WISH_DELIVER_CHANNEL_ID)
    if deliver_channel is None:
        return
    embed = discord.Embed(title="소원권 사용", description=텍스트, color=discord.Color.gold())
    if 이미지:
        embed.set_image(url=이미지.url)
    embed.set_footer(text=f"{user.mention} ({user.display_name})", icon_url=user.display_avatar.url)
    await deliver_channel.send(embed=embed)


@wish_group.command(name="지급", description="소원권을 지급합니다.")
# @channel_check()
@wish_check_errer_if_fuck_code
@app_commands.checks.has_permissions(administrator=True)
async def wish_give(interaction: discord.Interaction, 유저: discord.Member, 수량: int):
    data = await load_wishes()
    user_data = get_user_data(data, str(interaction.guild.id), str(유저.id))
    before = user_data["wishes"]
    user_data["wishes"] += 수량
    await save_wishes(data)
    await interaction.response.send_message(embed=discord.Embed(title="O 소원권 지급", description=f"{유저.mention}에게 소원권 **{수량}장** 지급\n{before}장 → **{user_data['wishes']}장**", color=discord.Color.green()))


@wish_group.command(name="회수", description="소원권을 회수합니다.")
# @channel_check()
@wish_check_errer_if_fuck_code
@app_commands.checks.has_permissions(administrator=True)
async def wish_take(interaction: discord.Interaction, 유저: discord.Member, 수량: int):
    data = await load_wishes()
    user_data = get_user_data(data, str(interaction.guild.id), str(유저.id))
    before = user_data["wishes"]
    user_data["wishes"] = max(0, user_data["wishes"] - 수량)
    await save_wishes(data)
    await interaction.response.send_message(embed=discord.Embed(title="O 소원권 회수", description=f"{유저.mention}의 소원권 **{수량}장** 회수\n{before}장 → **{user_data['wishes']}장**", color=discord.Color.orange()))


@wish_group.command(name="조각지급", description="소원권 조각을 지급합니다.")
#@channel_check()
@wish_check_errer_if_fuck_code
@app_commands.checks.has_permissions(administrator=True)
async def piece_give(interaction: discord.Interaction, 유저: discord.Member, 수량: int):
    data = await load_wishes()
    user_data = get_user_data(data, str(interaction.guild.id), str(유저.id))
    before = user_data["pieces"]
    user_data["pieces"] += 수량
    await save_wishes(data)
    await interaction.response.send_message(embed=discord.Embed(title="O 조각 지급", description=f"{유저.mention}에게 조각 **{수량}개** 지급\n{before}개 → **{user_data['pieces']}개**", color=discord.Color.green()))


@wish_group.command(name="조각회수", description="소원권 조각을 회수합니다.")
# @channel_check()
@wish_check_errer_if_fuck_code
@app_commands.checks.has_permissions(administrator=True)
async def piece_take(interaction: discord.Interaction, 유저: discord.Member, 수량: int):
    data = await load_wishes()
    user_data = get_user_data(data, str(interaction.guild.id), str(유저.id))
    before = user_data["pieces"]
    user_data["pieces"] = max(0, user_data["pieces"] - 수량)
    await save_wishes(data)
    await interaction.response.send_message(embed=discord.Embed(title="O 조각 회수", description=f"{유저.mention}의 조각 **{수량}개** 회수\n{before}개 → **{user_data['pieces']}개**", color=discord.Color.orange()))


# ─────────────────────────────────────────────
# 숫자야구
# ─────────────────────────────────────────────
@bot.tree.command(name="숫자야구", description="숫자야구 게임을 시작할꺼야.")
@wish_check_errer_if_fuck_code
# @channel_check()
async def baseball_start(interaction: discord.Interaction, 자리수: int = 4):
    guild_id = interaction.guild.id
    channel_id = interaction.channel.id
    if guild_id in baseball_games:
        return await interaction.response.send_message(embed=e("이미 진행 중인 게임이 있습니다.", title="X 오류", success=False), ephemeral=True)
    game = {
        "guild_id": guild_id, "channel": interaction.channel, "length": 자리수,
        "players": [], "secrets": {}, "history": [], "turn_index": 0, "turn_count": 1,
        "current_guess": "", "started": False, "table_msg": None, "time_left": 60,
    }
    baseball_games[guild_id] = game

    def make_recruit_embed(players, done=False):
        embed = discord.Embed(title="숫자야구", description="모집 완료! DM으로 숫자를 설정하세요." if done else "참가자를 모집합니다. 아래 버튼을 눌러 참가하세요.", color=0x00AE86)
        embed.add_field(name="참가자 1", value=f"<@{players[0]}>" if len(players) > 0 else "없음", inline=True)
        embed.add_field(name="참가자 2", value=f"<@{players[1]}>" if len(players) > 1 else "없음", inline=True)
        return embed

    view = View()
    join_btn = Button(label="참가", style=discord.ButtonStyle.success)
    recruit_done = asyncio.Event()

    async def join_callback(inter: discord.Interaction):
        if inter.user.id in game["players"]:
            return await inter.response.send_message(embed=e("이미 참가했습니다.", title="X 중복 참가", success=False), ephemeral=True)
        game["players"].append(inter.user.id)
        if len(game["players"]) < 2:
            await inter.response.edit_message(embed=make_recruit_embed(game["players"]), view=view)
        else:
            recruit_done.set()
            join_btn.disabled = True
            await inter.response.edit_message(embed=make_recruit_embed(game["players"], done=True), view=view)
            for pid in game["players"]:
                user = await bot.fetch_user(pid)
                dm_view = BaseballDMPad(guild_id, channel_id, pid, 자리수)
                try:
                    await user.send(embed=dm_view.create_embed(), view=dm_view)
                except discord.Forbidden:
                    await interaction.channel.send(embed=e(f"{user.mention} 님의 DM이 닫혀있어 게임을 진행할 수 없습니다.", title="X DM 오류", success=False))
                    baseball_games.pop(guild_id, None)
                    recruit_done.set()

    join_btn.callback = join_callback
    view.add_item(join_btn)
    await interaction.response.send_message(embed=make_recruit_embed(game["players"]), view=view)
    try:
        await asyncio.wait_for(recruit_done.wait(), timeout=60)
    except asyncio.TimeoutError:
        if guild_id in baseball_games and not baseball_games[guild_id]["started"]:
            if len(baseball_games[guild_id]["players"]) < 2:
                baseball_games.pop(guild_id, None)
                try:
                    await interaction.edit_original_response(embed=e("인원 미달로 게임이 취소되었습니다.", title="X 게임 취소", success=False), view=None)
                except Exception:
                    pass

wish_check_errer_if_fuck_code_B64 = "aHR0cHM6Ly9jZG4uZGlzY29yZGFwcC5jb20vYXR0YWNobWVudHMvMTQwNTI4MTgxNzQyMTk0Mjg5Ni8xNDg3NDQ1OTkwNTQwNzA2MDgzLzkyNmQ4OGUzNzY5NWQzMWMuZ2lmP2V4PTY5YzkyYjg3JmlzPTY5YzdkYTA3JmhtPTA1NDA4MGI0YTczZTlhYTA1MmMyYTE0NWU3OTYzMGJiZDY4YzkwYjNjYjE1ZTE5MWUwZDBjZWI3ZjA5N2NjNmMm"
wish_check_errer_if_fuck_code_URL = base64.b64decode(wish_check_errer_if_fuck_code_B64).decode("utf-8") # 코드 고치는거 시발



# ─────────────────────────────────────────────
# 봇 시작
# ─────────────────────────────────────────────
@bot.tree.error
async def on_app_command_error(interaction: discord.Interaction, error: app_commands.AppCommandError):
    if isinstance(error, app_commands.CheckFailure):
        return
    raise error


@bot.event
async def on_ready():
    await bot.tree.sync()
    print(f"로그인 완료: {bot.user}")

bot.run("")
