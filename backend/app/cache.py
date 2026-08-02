from __future__ import annotations

from threading import RLock
from time import monotonic
from typing import Any

_cache: dict[str, tuple[float, Any]] = {}
_lock = RLock()


def get_cache(key: str) -> Any | None:
    now = monotonic()
    with _lock:
        item = _cache.get(key)
        if not item:
            return None
        expires_at, value = item
        if expires_at <= now:
            _cache.pop(key, None)
            return None
        return value


def set_cache(key: str, value: Any, ttl: int = 30) -> Any:
    with _lock:
        _cache[key] = (monotonic() + ttl, value)
    return value


def clear_cache(prefix: str | None = None) -> None:
    with _lock:
        if prefix is None:
            _cache.clear()
            return
        for key in list(_cache):
            if key.startswith(prefix):
                _cache.pop(key, None)
