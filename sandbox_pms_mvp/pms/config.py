from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse


BASE_DIR = Path(__file__).resolve().parent.parent
RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL", "").strip()


def _normalize_database_uri(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return raw
    if raw.startswith("postgresql://"):
        return f"postgresql+psycopg://{raw.removeprefix('postgresql://')}"
    if raw.startswith("postgres://"):
        return f"postgresql+psycopg://{raw.removeprefix('postgres://')}"
    return raw


def _normalized_host_candidate(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = (parsed.hostname or "").strip().lower()
    return host or None


def _build_trusted_hosts(*values: str | None, existing: list[str] | tuple[str, ...] | None = None) -> list[str]:
    hosts: list[str] = []
    for item in existing or []:
        host = _normalized_host_candidate(item)
        if host and host not in hosts:
            hosts.append(host)
    for item in values:
        host = _normalized_host_candidate(item)
        if host and host not in hosts:
            hosts.append(host)
    return hosts


class Config:
    APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
    SECRET_KEY = os.getenv("SECRET_KEY", "sandbox-hotel-pms-dev-key")
    SQLALCHEMY_DATABASE_URI = _normalize_database_uri(
        os.getenv(
            "DATABASE_URL",
            f"sqlite:///{BASE_DIR / 'sandbox_pms.db'}",
        )
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}
    HOTEL_NAME = "Sandbox Hotel"
    DEFAULT_CURRENCY = "THB"
    SERVER_NAME = os.getenv("SERVER_NAME")
    PREFERRED_URL_SCHEME = os.getenv("PREFERRED_URL_SCHEME", "https")
    APPLICATION_ROOT = os.getenv("APPLICATION_ROOT", "/")
    FORCE_HTTPS = os.getenv("FORCE_HTTPS", "1" if APP_ENV == "production" else "0") == "1"
    TRUST_PROXY_COUNT = int(os.getenv("TRUST_PROXY_COUNT", "0"))
    _trusted_hosts_raw = _build_trusted_hosts(
        os.getenv("APP_BASE_URL"),
        os.getenv("BOOKING_ENGINE_URL"),
        os.getenv("STAFF_APP_URL"),
        os.getenv("MARKETING_SITE_URL"),
        RENDER_EXTERNAL_URL,
        existing=os.getenv("TRUSTED_HOSTS", "").split(","),
    )
    TRUSTED_HOSTS = _trusted_hosts_raw or None
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
    ENABLE_ACCESS_LOGGING = os.getenv("ENABLE_ACCESS_LOGGING", "1") == "1"
    ENABLE_SECURITY_HEADERS = os.getenv("ENABLE_SECURITY_HEADERS", "1") == "1"
    STATIC_ASSET_MAX_AGE_SECONDS = int(os.getenv("STATIC_ASSET_MAX_AGE_SECONDS", "3600"))
    HEALTHCHECK_SLA_MS = int(os.getenv("HEALTHCHECK_SLA_MS", "1000"))
    HSTS_MAX_AGE_SECONDS = int(os.getenv("HSTS_MAX_AGE_SECONDS", "31536000"))
    CONTENT_SECURITY_POLICY = os.getenv(
        "CONTENT_SECURITY_POLICY",
        "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; font-src 'self' data: https:; object-src 'none'; "
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    )
    # 12 MB default — must be larger than MAX_UPLOAD_SIZE_BYTES in pre_checkin_service
    # (service validates ≤ 10 MB; this allows a small extra margin for form overhead)
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", "12582912"))
    UPLOAD_DIR = os.getenv("UPLOAD_DIR", "")
    STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").strip().lower()
    S3_BUCKET = os.getenv("S3_BUCKET", "").strip()
    S3_REGION = os.getenv("S3_REGION", "us-east-1").strip()
    S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", "").strip()
    AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "").strip()
    AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "").strip()
    MAX_FORM_MEMORY_SIZE = int(os.getenv("MAX_FORM_MEMORY_SIZE", "262144"))
    MAX_FORM_PARTS = int(os.getenv("MAX_FORM_PARTS", "200"))
    PAYMENT_BASE_URL = os.getenv("PAYMENT_BASE_URL", "")
    PAYMENT_PROVIDER = os.getenv("PAYMENT_PROVIDER", "disabled")
    PAYMENT_LINK_TTL_MINUTES = int(os.getenv("PAYMENT_LINK_TTL_MINUTES", "60"))
    PAYMENT_LINK_RESEND_COOLDOWN_SECONDS = int(os.getenv("PAYMENT_LINK_RESEND_COOLDOWN_SECONDS", "60"))
    PAYMENT_WEBHOOK_TOLERANCE_SECONDS = int(os.getenv("PAYMENT_WEBHOOK_TOLERANCE_SECONDS", "300"))
    STRIPE_API_BASE = os.getenv("STRIPE_API_BASE", "https://api.stripe.com")
    STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
    STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    TEST_HOSTED_PAYMENT_SECRET = os.getenv("TEST_HOSTED_PAYMENT_SECRET", "sandbox-test-hosted-secret")
    APP_BASE_URL = os.getenv("APP_BASE_URL", RENDER_EXTERNAL_URL or "https://book.sandboxhotel.com")
    ICAL_SYNC_HTTP_TIMEOUT_SECONDS = int(os.getenv("ICAL_SYNC_HTTP_TIMEOUT_SECONDS", "15"))
    ICAL_SYNC_USER_AGENT = os.getenv("ICAL_SYNC_USER_AGENT", "SandboxHotelPMS/1.0")
    MARKETING_SITE_URL = os.getenv("MARKETING_SITE_URL", "")
    BOOKING_ENGINE_URL = os.getenv("BOOKING_ENGINE_URL", APP_BASE_URL)
    STAFF_APP_URL = os.getenv("STAFF_APP_URL", BOOKING_ENGINE_URL)
    ENFORCE_CANONICAL_HOSTS = os.getenv("ENFORCE_CANONICAL_HOSTS", "1" if APP_ENV in {"staging", "production"} else "0") == "1"
    AUTO_BOOTSTRAP_SCHEMA = os.getenv("AUTO_BOOTSTRAP_SCHEMA", "0") == "1"
    AUTO_SEED_REFERENCE_DATA = os.getenv("AUTO_SEED_REFERENCE_DATA", "0") == "1"
    INVENTORY_BOOTSTRAP_DAYS = int(os.getenv("INVENTORY_BOOTSTRAP_DAYS", "730"))
    RESERVATION_CODE_PREFIX = os.getenv("RESERVATION_CODE_PREFIX", "SBX")
    AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "sbx_staff_session")
    AUTH_COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "1") == "1"
    AUTH_COOKIE_HTTPONLY = True
    AUTH_COOKIE_SAMESITE = os.getenv("AUTH_COOKIE_SAMESITE", "Lax")
    AUTH_ENCRYPTION_KEY = os.getenv("AUTH_ENCRYPTION_KEY", "")
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
    SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "sbx_browser_state")
    SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", os.getenv("AUTH_COOKIE_SECURE", "1")) == "1"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = os.getenv("SESSION_COOKIE_SAMESITE", os.getenv("AUTH_COOKIE_SAMESITE", "Lax"))
    SESSION_REFRESH_EACH_REQUEST = False
    SESSION_IDLE_MINUTES = int(os.getenv("SESSION_IDLE_MINUTES", "15"))
    SESSION_ABSOLUTE_HOURS = int(os.getenv("SESSION_ABSOLUTE_HOURS", "8"))
    PASSWORD_RESET_TTL_MINUTES = int(os.getenv("PASSWORD_RESET_TTL_MINUTES", "45"))
    PASSWORD_RESET_REQUEST_LIMIT = int(os.getenv("PASSWORD_RESET_REQUEST_LIMIT", "3"))
    PASSWORD_RESET_REQUEST_WINDOW_MINUTES = int(os.getenv("PASSWORD_RESET_REQUEST_WINDOW_MINUTES", "60"))
    LOGIN_LOCK_THRESHOLD = int(os.getenv("LOGIN_LOCK_THRESHOLD", "5"))
    LOGIN_LOCK_WINDOW_MINUTES = int(os.getenv("LOGIN_LOCK_WINDOW_MINUTES", "15"))
    LOGIN_LOCK_DURATION_MINUTES = int(os.getenv("LOGIN_LOCK_DURATION_MINUTES", "15"))
    MFA_VERIFY_WINDOW = int(os.getenv("MFA_VERIFY_WINDOW", "1"))
    MFA_ISSUER = os.getenv("MFA_ISSUER", "Sandbox Hotel PMS")
    AUTH_SHOW_RESET_LINKS = os.getenv("AUTH_SHOW_RESET_LINKS", "0") == "1"
    ARGON2_TIME_COST = int(os.getenv("ARGON2_TIME_COST", "3"))
    ARGON2_MEMORY_COST = int(os.getenv("ARGON2_MEMORY_COST", "65536"))
    ARGON2_PARALLELISM = int(os.getenv("ARGON2_PARALLELISM", "2"))
    ARGON2_HASH_LEN = int(os.getenv("ARGON2_HASH_LEN", "32"))
    PUBLIC_BOOKING_HOLD_MINUTES = int(os.getenv("PUBLIC_BOOKING_HOLD_MINUTES", "7"))
    PUBLIC_BOOKING_RATE_LIMIT_WINDOW_MINUTES = int(os.getenv("PUBLIC_BOOKING_RATE_LIMIT_WINDOW_MINUTES", "15"))
    PUBLIC_BOOKING_RATE_LIMIT_COUNT = int(os.getenv("PUBLIC_BOOKING_RATE_LIMIT_COUNT", "10"))
    PUBLIC_LOOKUP_RATE_LIMIT_COUNT = int(os.getenv("PUBLIC_LOOKUP_RATE_LIMIT_COUNT", "8"))
    PENDING_AUTOMATION_RETENTION_DAYS = int(os.getenv("PENDING_AUTOMATION_RETENTION_DAYS", "30"))
    AUDIT_LOG_RETENTION_DAYS = int(os.getenv("AUDIT_LOG_RETENTION_DAYS", "0"))
    SMTP_HOST = os.getenv("SMTP_HOST", "")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
    SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "1") == "1"
    MAIL_FROM = os.getenv("MAIL_FROM", "")
    STAFF_ALERT_EMAILS = [item.strip() for item in os.getenv("STAFF_ALERT_EMAILS", "").split(",") if item.strip()]
    SMS_PROVIDER = os.getenv("SMS_PROVIDER", "log").strip().lower()
    SMS_OUTBOUND_WEBHOOK_URL = os.getenv("SMS_OUTBOUND_WEBHOOK_URL", "").strip()
    TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "").strip()
    WHATSAPP_OUTBOUND_WEBHOOK_URL = os.getenv("WHATSAPP_OUTBOUND_WEBHOOK_URL", "").strip()
    LINE_OUTBOUND_WEBHOOK_URL = os.getenv("LINE_OUTBOUND_WEBHOOK_URL", "").strip()
    LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
    LINE_API_BASE = os.getenv("LINE_API_BASE", "https://api.line.me").strip()
    LINE_STAFF_ALERT_WEBHOOK_URL = os.getenv("LINE_STAFF_ALERT_WEBHOOK_URL", "")
    WHATSAPP_STAFF_ALERT_WEBHOOK_URL = os.getenv("WHATSAPP_STAFF_ALERT_WEBHOOK_URL", "")
    CHANNEL_PUSH_WEBHOOK_URL = os.getenv("CHANNEL_PUSH_WEBHOOK_URL", "").strip()
    CHANNEL_WEBHOOK_SECRET = os.getenv("CHANNEL_WEBHOOK_SECRET", "").strip()
    POS_ADAPTER = os.getenv("POS_ADAPTER", "null").strip().lower()
    POS_WEBHOOK_URL = os.getenv("POS_WEBHOOK_URL", "").strip()
    SENTRY_DSN = os.getenv("SENTRY_DSN", "").strip()
    SENTRY_ENVIRONMENT = os.getenv("SENTRY_ENVIRONMENT", APP_ENV).strip() or APP_ENV
    SENTRY_RELEASE = os.getenv("SENTRY_RELEASE", "").strip()
    SENTRY_TRACES_SAMPLE_RATE = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0"))
    REDIS_URL = os.getenv("REDIS_URL", "")
    ID_SCANNER_PROVIDER = os.getenv("ID_SCANNER_PROVIDER", "manual")
    BACKUP_RETENTION_DAYS = int(os.getenv("BACKUP_RETENTION_DAYS", "14"))
    BACKUP_ENCRYPTION_REQUIRED = os.getenv("BACKUP_ENCRYPTION_REQUIRED", "1" if APP_ENV == "production" else "0") == "1"
    RESTORE_VERIFY_COMMAND = os.getenv("RESTORE_VERIFY_COMMAND", "")


def normalize_runtime_config(config: dict, *, override_keys: set[str] | None = None) -> None:
    override_keys = set(override_keys or set())

    app_base_url = str(config.get("APP_BASE_URL") or "").strip() or RENDER_EXTERNAL_URL or "https://book.sandboxhotel.com"
    booking_engine_url = str(config.get("BOOKING_ENGINE_URL") or "").strip()
    staff_app_url = str(config.get("STAFF_APP_URL") or "").strip()

    if "BOOKING_ENGINE_URL" in override_keys and "APP_BASE_URL" not in override_keys:
        app_base_url = booking_engine_url or app_base_url
        config["APP_BASE_URL"] = app_base_url
    elif "APP_BASE_URL" in override_keys and "BOOKING_ENGINE_URL" not in override_keys:
        booking_engine_url = app_base_url
        config["BOOKING_ENGINE_URL"] = booking_engine_url
    elif not booking_engine_url:
        booking_engine_url = app_base_url
        config["BOOKING_ENGINE_URL"] = booking_engine_url

    if not staff_app_url or (
        "STAFF_APP_URL" not in override_keys and {"APP_BASE_URL", "BOOKING_ENGINE_URL"}.intersection(override_keys)
    ):
        config["STAFF_APP_URL"] = booking_engine_url

    should_infer_trusted_hosts = bool(config.get("TRUSTED_HOSTS")) or bool(RENDER_EXTERNAL_URL) or str(
        config.get("APP_ENV", "")
    ).lower() in {"production", "staging"}
    if should_infer_trusted_hosts:
        config["TRUSTED_HOSTS"] = (
            _build_trusted_hosts(
                config.get("APP_BASE_URL"),
                config.get("BOOKING_ENGINE_URL"),
                config.get("STAFF_APP_URL"),
                config.get("MARKETING_SITE_URL"),
                RENDER_EXTERNAL_URL,
                existing=config.get("TRUSTED_HOSTS") or [],
            )
            or None
        )

    if "SQLALCHEMY_DATABASE_URI" in config:
        config["SQLALCHEMY_DATABASE_URI"] = _normalize_database_uri(config.get("SQLALCHEMY_DATABASE_URI"))
