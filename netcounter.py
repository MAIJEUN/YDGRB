"""
netcounter.py — 봇의 네트워크 송/수신 바이트 계측 (대시보드 연동용)

asyncio 의 소켓 전송 계층(write / 수신 콜백)을 후킹해 이 프로세스가 실제로
주고받은 바이트(=암호화된 와이어 바이트)를 누적하고, 주기적으로 netstats.json 에 기록한다.
대시보드는 이 파일을 읽어 '봇만의' 네트워크 사용량을 그래프로 보여준다.

사용법 — index.py 에서:
    import netcounter
    netcounter.start()     # config.NETCOUNTER_ENABLED 가 True 일 때만 호출 (호출해야 시작)

  (import 만으로는 아무 동작도 하지 않는다 — 시작/비활성화는 호출부에서 config 로 제어)

* 어떤 경우에도 봇 동작을 깨지 않도록 모든 후킹을 try/except 로 감쌌다.
* Windows 기본 ProactorEventLoop 에 맞춰 proactor 전송을 정확히 계측한다.
  (proactor 의 _data_received 는 일반/버퍼드(SSL) 프로토콜을 모두 거치는 단일 지점)
* SelectorEventLoop 도 best-effort 로 지원한다.
"""

from __future__ import annotations

import json
import os
import threading
import time

# ── 누적 카운터 (이벤트 루프 단일 스레드에서만 증가) ────────────────
_sent = 0
_recv = 0
_started_at = time.time()
_installed = False
_writer_started = False


def _add_sent(n: int) -> None:
    global _sent
    _sent += n


def _add_recv(n: int) -> None:
    global _recv
    _recv += n


def snapshot() -> dict:
    return {
        "pid": os.getpid(),
        "ts": time.time(),
        "sent": _sent,
        "recv": _recv,
        "since": _started_at,
    }


# ── proactor (Windows 기본) ───────────────────────────────────────
def _install_proactor() -> None:
    try:
        from asyncio import proactor_events as pe
    except Exception:
        return
    W = getattr(pe, "_ProactorBaseWritePipeTransport", None)
    R = getattr(pe, "_ProactorReadPipeTransport", None)
    if W is None or R is None or getattr(W, "_netcounter", False):
        return

    orig_write = W.write

    def write(self, data):
        try:
            _add_sent(len(data))
        except Exception:
            pass
        return orig_write(self, data)

    orig_dr = R._data_received

    def _data_received(self, data, length):
        try:
            # 실제로 프로토콜에 전달되는 경우에만 카운트 (pause 시 재전달 중복 방지)
            if length and length > 0 and not getattr(self, "_paused", False):
                _add_recv(length)
        except Exception:
            pass
        return orig_dr(self, data, length)

    W.write = write
    R._data_received = _data_received
    W._netcounter = True
    R._netcounter = True


# ── selector (비-Windows / 명시적 selector 루프) ──────────────────
def _install_selector() -> None:
    try:
        from asyncio import selector_events as se
    except Exception:
        return
    T = getattr(se, "_SelectorSocketTransport", None)
    if T is None or getattr(T, "_netcounter", False):
        return

    orig_write = T.write

    def write(self, data):
        try:
            _add_sent(len(data))
        except Exception:
            pass
        return orig_write(self, data)

    T.write = write

    # 수신: 일반 프로토콜 경로
    def _read_ready__data_received(self):
        if self._conn_lost:
            return
        try:
            data = self._sock.recv(self.max_size)
        except (BlockingIOError, InterruptedError):
            return
        except (SystemExit, KeyboardInterrupt):
            raise
        except BaseException as exc:
            self._fatal_error(exc, "Fatal read error on socket transport")
            return
        if not data:
            self._read_ready__on_eof()
            return
        try:
            _add_recv(len(data))
        except Exception:
            pass
        try:
            self._protocol.data_received(data)
        except (SystemExit, KeyboardInterrupt):
            raise
        except BaseException as exc:
            self._fatal_error(exc, "Fatal error: protocol.data_received() call failed.")

    # 참고: SSL 은 selector 에서 버퍼드 프로토콜 경로(_read_ready__get_buffer)를 쓰며
    # 정확 계측이 까다로워 여기서는 다루지 않는다. 실사용(Windows)은 proactor 가
    # 주 경로이고 그쪽은 SSL 포함 정확히 계측되므로 영향이 없다.
    try:
        T._read_ready__data_received = _read_ready__data_received
    except Exception:
        pass
    T._netcounter = True


# ── netstats.json 기록 스레드 ─────────────────────────────────────
def _writer_loop(path: str, interval: float) -> None:
    tmp = path + ".tmp"
    while True:
        time.sleep(interval)
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(snapshot(), f)
            os.replace(tmp, path)
        except OSError:
            pass


def start(path: str = "netstats.json", interval: float = 2.0) -> None:
    """후킹 설치 + 기록 스레드 시작. 여러 번 호출해도 안전."""
    global _installed, _writer_started
    if not _installed:
        try:
            _install_proactor()
        except Exception:
            pass
        try:
            _install_selector()
        except Exception:
            pass
        _installed = True
    if not _writer_started:
        try:
            t = threading.Thread(
                target=_writer_loop, args=(path, interval),
                name="netcounter-writer", daemon=True,
            )
            t.start()
            _writer_started = True
        except Exception:
            pass


# 자동 시작하지 않는다. 호출부(index.py)에서 config.NETCOUNTER_ENABLED 에 따라
# netcounter.start() 를 호출해야 후킹/기록이 시작된다.
