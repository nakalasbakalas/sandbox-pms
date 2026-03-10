from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent


class Config:
    APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
    SECRET_KEY = os.getenv("SECRET_KEY", "sandbox-hotel-pms-dev-key")
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        f"sqlite:///{BASE_DIR / 'sandbox_pms.db'}",
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
    _trusted_hosts_raw = [item.strip().lower() for item in os.getenv("TRUSTED_HOSTS", "").split(",") if item.strip()]
    TRUSTED_HOSTS = _trusted_hosts_raw or None
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
    ENABLE_ACCESS_LOGGING = os.getenv("ENABLE_ACCESS_LOGGING", "1") == "1"
    ENABLE_SECURITY_HEADERS = os.getenv("ENABLE_SECURITY_HEADERS", "1") == "1"
    HSTS_MAX_AGE_SECONDS = int(os.getenv("HSTS_MAX_AGE_SECONDS", "31536000"))
    CONTENT_SECURITY_POLICY = os.getenv(
        "CONTENT_SECURITY_POLICY",
        "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; font-src 'self' data: https:; object-src 'none'; "
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    )
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", "1048576"))
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
    APP_BASE_URL = os.getenv("APP_BASE_URL", "https://sandbox-hotel.local")
    AUTO_BOOTSTRAP_SCHEMA = os.getenv("AUTO_BOOTSTRAP_SCHEMA", "0") == "1"
    AUTO_SEED_REFERENCE_DATA = os.getenv("AUTO_SEED_REFERENCE_DATA", "0") == "1"
    INVENTORY_BOOTSTRAP_DAYS = int(os.getenv("INVENTORY_BOOTSTRAP_DAYS", "730"))
    RESERVATION_CODE_PREFIX = os.getenv("RESERVATION_CODE_PREFIX", "SBX")
    AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "sbx_staff_session")
    AUTH_COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "1") == "1"
    AUTH_COOKIE_HTTPONLY = True
    AUTH_COOKIE_SAMESITE = os.getenv("AUTH_COOKIE_SAMESITE", "Lax")
    AUTH_ENCRYPTION_KEY = os.getenv("AUTH_ENCRYPTION_KEY", "")
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
    SMTP_HOST = os.getenv("SMTP_HOST", "")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
    SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "1") == "1"
    MAIL_FROM = os.getenv("MAIL_FROM", "reservations@sandbox-hotel.local")
    STAFF_ALERT_EMAILS = [item.strip() for item in os.getenv("STAFF_ALERT_EMAILS", "").split(",") if item.strip()]
    LINE_STAFF_ALERT_WEBHOOK_URL = os.getenv("LINE_STAFF_ALERT_WEBHOOK_URL", "")
    WHATSAPP_STAFF_ALERT_WEBHOOK_URL = os.getenv("WHATSAPP_STAFF_ALERT_WEBHOOK_URL", "")
    BACKUP_RETENTION_DAYS = int(os.getenv("BACKUP_RETENTION_DAYS", "14"))
    BACKUP_ENCRYPTION_REQUIRED = os.getenv("BACKUP_ENCRYPTION_REQUIRED", "1" if APP_ENV == "production" else "0") == "1"
    RESTORE_VERIFY_COMMAND = os.getenv("RESTORE_VERIFY_COMMAND", "")
