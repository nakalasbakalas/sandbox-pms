from __future__ import annotations

import json
import logging
import secrets
import time
from datetime import datetime
from decimal import Decimal
from typing import Any
from urllib.parse import urlparse

from cryptography.fernet import Fernet
from flask import Flask, abort, current_app, g, has_request_context, redirect, render_template, request
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix


DEFAULT_INSECURE_SECRET_VALUES = {
    "",
    "replace-me",
    "sandbox-hotel-pms-dev-key",
    "sandbox-test-hosted-secret",
}
GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again or contact the hotel."
SENSITIVE_FIELD_FRAGMENTS = {
    "authorization",
    "cookie",
    "csrf",
    "cvv",
    "pan",
    "passcode",
    "password",
    "secret",
    "session",
    "signature",
    "smtp_password",
    "token",
    "webhook",
}


def configure_app_security(app: Flask) -> None:
    _configure_proxy_fix(app)
    _configure_logging(app)
    _validate_runtime_configuration(app)
    _register_request_security_hooks(app)
    _register_error_handlers(app)


def public_error_message(exc: Exception, *, fallback: str = GENERIC_ERROR_MESSAGE) -> str:
    if isinstance(exc, ValueError):
        return str(exc)
    if isinstance(exc, HTTPException) and 400 <= int(exc.code or 500) < 500:
        return str(exc.description or fallback)
    return fallback


def sanitize_log_data(value: Any, *, key_hint: str | None = None) -> Any:
    if _is_sensitive_key(key_hint):
        return "[redacted]"
    if isinstance(value, dict):
        return {str(key): sanitize_log_data(item, key_hint=str(key)) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [sanitize_log_data(item, key_hint=key_hint) for item in value]
    if isinstance(value, bytes):
        return f"[{len(value)} bytes redacted]"
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def current_request_id() -> str | None:
    return getattr(g, "request_id", None) if has_request_context() else None


def request_client_ip() -> str | None:
    if not has_request_context():
        return None
    forwarded_for = (request.headers.get("X-Forwarded-For") or "").split(",", 1)[0].strip()
    if forwarded_for:
        return forwarded_for[:64]
    if request.remote_addr:
        return str(request.remote_addr)[:64]
    return None


def request_user_agent() -> str | None:
    if not has_request_context():
        return None
    value = request.user_agent.string or ""
    return value[:512] or None


def log_security_event(
    logger_name: str,
    *,
    event: str,
    level: int = logging.INFO,
    **fields: Any,
) -> None:
    logger = logging.getLogger(logger_name)
    payload = {"event": event, **sanitize_log_data(fields)}
    logger.log(level, json.dumps(payload, ensure_ascii=False, default=str))


def _configure_proxy_fix(app: Flask) -> None:
    trust_proxy_count = int(app.config.get("TRUST_PROXY_COUNT", 0) or 0)
    if trust_proxy_count > 0:
        app.wsgi_app = ProxyFix(
            app.wsgi_app,
            x_for=trust_proxy_count,
            x_proto=trust_proxy_count,
            x_host=trust_proxy_count,
            x_port=trust_proxy_count,
            x_prefix=trust_proxy_count,
        )


def _configure_logging(app: Flask) -> None:
    level_name = str(app.config.get("LOG_LEVEL", "INFO")).upper()
    level = getattr(logging, level_name, logging.INFO)
    app.logger.setLevel(level)
    for logger_name in ("sandbox_pms.access", "sandbox_pms.error", "sandbox_pms.security"):
        logger = logging.getLogger(logger_name)
        logger.setLevel(level)
        logger.propagate = True


def _validate_runtime_configuration(app: Flask) -> None:
    app_env = str(app.config.get("APP_ENV", "development")).strip().lower()
    if app_env not in {"development", "staging", "production", "test"}:
        raise RuntimeError("APP_ENV must be one of development, staging, production, or test.")

    _validate_url(app.config.get("APP_BASE_URL"), label="APP_BASE_URL", must_be_https=app_env == "production")
    if app.config.get("PAYMENT_BASE_URL"):
        _validate_url(
            app.config.get("PAYMENT_BASE_URL"),
            label="PAYMENT_BASE_URL",
            must_be_https=app_env == "production",
        )

    auth_encryption_key = str(app.config.get("AUTH_ENCRYPTION_KEY") or "").strip()
    if auth_encryption_key:
        try:
            Fernet(auth_encryption_key.encode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError("AUTH_ENCRYPTION_KEY must be a valid Fernet key.") from exc

    payment_provider = str(app.config.get("PAYMENT_PROVIDER") or "disabled").strip().lower()
    if payment_provider == "stripe":
        if not app.config.get("STRIPE_SECRET_KEY"):
            raise RuntimeError("STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe.")
        if not app.config.get("STRIPE_WEBHOOK_SECRET"):
            raise RuntimeError("STRIPE_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=stripe.")

    if app_env != "production":
        return

    if _is_default_secret(app.config.get("SECRET_KEY")):
        raise RuntimeError("SECRET_KEY must be set to a unique production secret.")
    if len(str(app.config.get("SECRET_KEY") or "")) < 32:
        raise RuntimeError("SECRET_KEY must be at least 32 characters in production.")
    if not auth_encryption_key:
        raise RuntimeError("AUTH_ENCRYPTION_KEY is required in production.")
    if not bool(app.config.get("AUTH_COOKIE_SECURE")):
        raise RuntimeError("AUTH_COOKIE_SECURE must be enabled in production.")
    if not bool(app.config.get("SESSION_COOKIE_SECURE")):
        raise RuntimeError("SESSION_COOKIE_SECURE must be enabled in production.")
    if not bool(app.config.get("FORCE_HTTPS")):
        raise RuntimeError("FORCE_HTTPS must be enabled in production.")
    if bool(app.config.get("AUTO_BOOTSTRAP_SCHEMA")):
        raise RuntimeError("AUTO_BOOTSTRAP_SCHEMA must be disabled in production.")
    if bool(app.config.get("AUTO_SEED_REFERENCE_DATA")):
        raise RuntimeError("AUTO_SEED_REFERENCE_DATA must be disabled in production.")
    if bool(app.config.get("AUTH_SHOW_RESET_LINKS")):
        raise RuntimeError("AUTH_SHOW_RESET_LINKS must be disabled in production.")
    if payment_provider == "test_hosted":
        raise RuntimeError("PAYMENT_PROVIDER=test_hosted is not allowed in production.")
    if _is_default_secret(app.config.get("TEST_HOSTED_PAYMENT_SECRET")) and payment_provider == "test_hosted":
        raise RuntimeError("TEST_HOSTED_PAYMENT_SECRET must not use the default value in production.")


def _register_request_security_hooks(app: Flask) -> None:
    @app.before_request
    def security_before_request():
        g.request_started_at = time.perf_counter()
        incoming_request_id = str(request.headers.get("X-Request-Id") or "").strip()
        g.request_id = incoming_request_id[:120] or secrets.token_hex(16)
        _validate_host_header()
        if _should_redirect_to_https():
            return _redirect_to_https()
        return None

    @app.after_request
    def security_after_request(response):
        request_id = getattr(g, "request_id", None)
        if request_id:
            response.headers.setdefault("X-Request-Id", request_id)

        if current_app.config.get("ENABLE_SECURITY_HEADERS", True):
            _apply_security_headers(response)

        if getattr(g, "current_staff_user", None) is not None or getattr(g, "pending_mfa_user", None) is not None:
            response.headers["Cache-Control"] = "no-store, max-age=0"
            response.headers["Pragma"] = "no-cache"

        if current_app.config.get("ENABLE_ACCESS_LOGGING", True):
            duration_ms = None
            if hasattr(g, "request_started_at"):
                duration_ms = round((time.perf_counter() - g.request_started_at) * 1000, 2)
            log_security_event(
                "sandbox_pms.access",
                event="http.access",
                request_id=request_id,
                method=request.method,
                path=request.path,
                endpoint=request.endpoint,
                status_code=response.status_code,
                duration_ms=duration_ms,
                client_ip=request_client_ip(),
                user_agent=request_user_agent(),
                staff_user_id=str(getattr(getattr(g, "current_staff_user", None), "id", "") or ""),
                audience="staff" if request.path.startswith("/staff") else "public",
            )
        return response


def _register_error_handlers(app: Flask) -> None:
    @app.errorhandler(Exception)
    def handle_error(exc: Exception):
        if isinstance(exc, HTTPException):
            if int(exc.code or 500) < 500:
                return _render_error_response(
                    status_code=int(exc.code or 500),
                    title=exc.name,
                    message=public_error_message(exc, fallback=exc.name),
                )
            _log_exception(exc, status_code=int(exc.code or 500))
            return _render_error_response(status_code=500, title="Server error", message=GENERIC_ERROR_MESSAGE)

        _log_exception(exc, status_code=500)
        return _render_error_response(status_code=500, title="Server error", message=GENERIC_ERROR_MESSAGE)


def _render_error_response(*, status_code: int, title: str, message: str):
    if request.accept_mimetypes.accept_json and not request.accept_mimetypes.accept_html:
        return {"error": message, "request_id": current_request_id()}, status_code
    return (
        render_template(
            "error.html",
            error_title=title,
            error_message=message,
            status_code=status_code,
            request_id=current_request_id(),
        ),
        status_code,
    )


def _log_exception(exc: Exception, *, status_code: int) -> None:
    log_security_event(
        "sandbox_pms.error",
        event="http.error",
        level=logging.ERROR,
        request_id=current_request_id(),
        method=request.method if has_request_context() else None,
        path=request.path if has_request_context() else None,
        endpoint=request.endpoint if has_request_context() else None,
        status_code=status_code,
        client_ip=request_client_ip(),
        user_agent=request_user_agent(),
        exception_type=exc.__class__.__name__,
    )
    logging.getLogger("sandbox_pms.error").exception("Unhandled application exception")


def _apply_security_headers(response) -> None:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault(
        "Content-Security-Policy",
        current_app.config.get(
            "CONTENT_SECURITY_POLICY",
            "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; font-src 'self' data: https:; object-src 'none'; "
            "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        ),
    )
    if _hsts_enabled():
        response.headers.setdefault(
            "Strict-Transport-Security",
            f"max-age={int(current_app.config.get('HSTS_MAX_AGE_SECONDS', 31536000))}; includeSubDomains",
        )


def _validate_host_header() -> None:
    configured_hosts = current_app.config.get("TRUSTED_HOSTS") or []
    trusted_hosts = [item for item in configured_hosts if item]
    if not trusted_hosts:
        return
    host = (request.host.split(":", 1)[0] or "").strip().lower()
    if host not in trusted_hosts:
        abort(400, description="Host header is not allowed.")


def _should_redirect_to_https() -> bool:
    if current_app.testing or request.method == "OPTIONS":
        return False
    return bool(current_app.config.get("FORCE_HTTPS")) and not request.is_secure


def _redirect_to_https():
    secure_url = request.url.replace("http://", "https://", 1)
    return redirect(secure_url, code=308)


def _hsts_enabled() -> bool:
    return bool(current_app.config.get("FORCE_HTTPS")) or str(current_app.config.get("APP_ENV", "")).lower() == "production"


def _validate_url(value: str | None, *, label: str, must_be_https: bool) -> None:
    raw = str(value or "").strip()
    if not raw:
        if must_be_https:
            raise RuntimeError(f"{label} is required.")
        return
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError(f"{label} must be a valid absolute URL.")
    if must_be_https and parsed.scheme != "https":
        raise RuntimeError(f"{label} must use https in production.")


def _is_default_secret(value: Any) -> bool:
    return str(value or "").strip() in DEFAULT_INSECURE_SECRET_VALUES


def _is_sensitive_key(key_hint: str | None) -> bool:
    normalized = str(key_hint or "").strip().lower()
    return any(fragment in normalized for fragment in SENSITIVE_FIELD_FRAGMENTS)
