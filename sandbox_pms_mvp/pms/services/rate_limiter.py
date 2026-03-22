"""Pluggable rate limiter -- Redis when REDIS_URL is configured, in-memory fallback.

Uses a sliding-window counter pattern.  Redis implementation relies on
sorted sets (ZRANGEBYSCORE / ZADD / ZREMRANGEBYSCORE).  The in-memory
fallback keeps a dict of timestamp lists and is suitable for single-process
development/testing only.
"""

from __future__ import annotations

import logging
import time
from typing import Any

_log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_instance: RateLimiter | None = None


def get_rate_limiter() -> RateLimiter:
    """Return (and lazily create) the shared ``RateLimiter`` singleton.

    Reads ``REDIS_URL`` from the Flask app config on first call.
    """
    global _instance  # noqa: PLW0603
    if _instance is not None:
        return _instance

    from flask import current_app

    redis_url = current_app.config.get("REDIS_URL") or ""
    _instance = RateLimiter(redis_url=redis_url or None)
    return _instance


def reset_rate_limiter() -> None:
    """Reset the singleton -- useful in tests."""
    global _instance  # noqa: PLW0603
    _instance = None


# ---------------------------------------------------------------------------
# RateLimiter
# ---------------------------------------------------------------------------


class RateLimiter:
    """Sliding-window rate limiter with Redis or in-memory backend."""

    def __init__(self, redis_url: str | None = None) -> None:
        self._redis: Any | None = None
        if redis_url:
            try:
                import redis as _redis_lib

                self._redis = _redis_lib.from_url(redis_url, decode_responses=True)
                self._redis.ping()
                _log.info("RateLimiter: using Redis backend")
            except Exception:
                _log.warning("RateLimiter: Redis unavailable, falling back to in-memory")
                self._redis = None
        if self._redis is None:
            self._store: dict[str, list[float]] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def check_rate_limit(
        self,
        key: str,
        limit: int,
        window_seconds: int,
    ) -> tuple[bool, int, int]:
        """Check whether *key* has exceeded *limit* events within *window_seconds*.

        Returns ``(is_limited, remaining, retry_after_seconds)``.
        """
        if self._redis is not None:
            return self._check_redis(key, limit, window_seconds)
        return self._check_memory(key, limit, window_seconds)

    def record_event(self, key: str, window_seconds: int) -> None:
        """Record a single event for *key*."""
        if self._redis is not None:
            self._record_redis(key, window_seconds)
        else:
            self._record_memory(key, window_seconds)

    # ------------------------------------------------------------------
    # Redis backend
    # ------------------------------------------------------------------

    def _check_redis(
        self,
        key: str,
        limit: int,
        window_seconds: int,
    ) -> tuple[bool, int, int]:
        now = time.time()
        window_start = now - window_seconds
        pipe = self._redis.pipeline()
        pipe.zremrangebyscore(key, "-inf", window_start)
        pipe.zcard(key)
        pipe.execute()
        count = self._redis.zcard(key)
        is_limited = count >= limit
        remaining = max(0, limit - count)
        retry_after = 0
        if is_limited:
            oldest = self._redis.zrange(key, 0, 0, withscores=True)
            if oldest:
                retry_after = max(0, int(oldest[0][1] + window_seconds - now) + 1)
        return is_limited, remaining, retry_after

    def _record_redis(self, key: str, window_seconds: int) -> None:
        now = time.time()
        window_start = now - window_seconds
        pipe = self._redis.pipeline()
        pipe.zremrangebyscore(key, "-inf", window_start)
        pipe.zadd(key, {f"{now}": now})
        pipe.expire(key, window_seconds + 60)
        pipe.execute()

    # ------------------------------------------------------------------
    # In-memory backend
    # ------------------------------------------------------------------

    def _check_memory(
        self,
        key: str,
        limit: int,
        window_seconds: int,
    ) -> tuple[bool, int, int]:
        now = time.time()
        window_start = now - window_seconds
        timestamps = self._store.get(key, [])
        timestamps = [ts for ts in timestamps if ts > window_start]
        self._store[key] = timestamps
        count = len(timestamps)
        is_limited = count >= limit
        remaining = max(0, limit - count)
        retry_after = 0
        if is_limited and timestamps:
            retry_after = max(0, int(timestamps[0] + window_seconds - now) + 1)
        return is_limited, remaining, retry_after

    def _record_memory(self, key: str, window_seconds: int) -> None:
        now = time.time()
        window_start = now - window_seconds
        timestamps = self._store.get(key, [])
        timestamps = [ts for ts in timestamps if ts > window_start]
        timestamps.append(now)
        self._store[key] = timestamps
