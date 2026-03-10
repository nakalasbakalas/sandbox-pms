ROOM_OPERATIONAL_STATUSES = [
    "available",
    "out_of_service",
    "out_of_order",
    "maintenance",
]

INVENTORY_AVAILABILITY_STATUSES = [
    "available",
    "held",
    "reserved",
    "occupied",
    "house_use",
    "out_of_service",
    "out_of_order",
]

RESERVATION_STATUSES = [
    "inquiry",
    "tentative",
    "confirmed",
    "checked_in",
    "checked_out",
    "cancelled",
    "no_show",
    "waitlist",
    "house_use",
]

PAYMENT_REQUEST_STATUSES = ["pending", "paid", "expired", "cancelled", "failed"]

BLACKOUT_TYPES = [
    "closed_to_booking",
    "no_arrival",
    "no_departure",
    "property_closed",
]

INVENTORY_OVERRIDE_SCOPE_TYPES = ["room", "room_type"]
INVENTORY_OVERRIDE_ACTIONS = ["close", "open"]

POLICY_DOCUMENT_CODES = [
    "cancellation_policy",
    "no_show_policy",
    "check_in_policy",
    "check_out_policy",
    "child_extra_guest_policy",
    "privacy_notice",
]

NOTIFICATION_TEMPLATE_CHANNELS = ["email", "internal_notification", "line_staff_alert", "whatsapp_staff_alert"]
NOTIFICATION_TEMPLATE_KEYS = [
    "guest_confirmation",
    "deposit_payment_request",
    "payment_success",
    "payment_failed",
    "pre_arrival_reminder",
    "cancellation_confirmation",
    "modification_confirmation",
    "cancellation_request_received",
    "modification_request_received",
    "internal_new_booking_alert",
    "internal_activity_alert",
]

NOTIFICATION_AUDIENCE_TYPES = ["guest", "staff"]

NOTIFICATION_DELIVERY_STATUSES = [
    "pending",
    "queued",
    "sent",
    "delivered",
    "failed",
    "skipped",
    "cancelled",
]

RATE_RULE_TYPES = [
    "base_rate",
    "seasonal_override",
    "holiday_override",
    "weekday_override",
    "weekend_override",
    "long_stay_discount",
]

RATE_ADJUSTMENT_TYPES = ["fixed", "amount_delta", "percent_delta"]

GUEST_NOTE_TYPES = ["general", "vip", "warning", "billing", "operations"]
ROOM_NOTE_TYPES = ["housekeeping", "maintenance", "supervisor", "lost_and_found", "warning"]

NOTE_VISIBILITY_SCOPES = ["front_desk", "manager", "all_staff"]

FOLIO_CHARGE_CODES = [
    "RM",
    "VAT",
    "DEP",
    "DEP_APPL",
    "PMT-CASH",
    "PMT-QR",
    "PMT-CARD",
    "PMT-BANK",
    "EXG",
    "EXB",
    "ECI",
    "LCO",
    "LND",
    "SNK",
    "TEL",
    "ADJ_POS",
    "ADJ_NEG",
    "CORR",
    "REF",
]

FOLIO_CHARGE_TYPES = [
    "room",
    "tax",
    "deposit",
    "deposit_application",
    "payment",
    "manual_charge",
    "manual_discount",
    "fee",
    "refund",
    "correction",
]

CASHIER_DOCUMENT_TYPES = ["folio", "invoice", "receipt"]
CASHIER_DOCUMENT_STATUSES = ["issued", "voided"]

HOUSEKEEPING_STATUS_CODES = [
    "clean",
    "dirty",
    "inspected",
    "pickup",
    "occupied_clean",
    "occupied_dirty",
    "do_not_disturb",
    "sleep",
    "out_of_service",
    "out_of_order",
]

USER_ACCOUNT_STATES = [
    "invited",
    "active",
    "password_reset_required",
    "locked",
    "disabled",
]

MFA_FACTOR_TYPES = ["totp"]

AUTH_FAILURE_REASONS = [
    "invalid_credentials",
    "locked",
    "disabled",
    "inactive",
    "mfa_required",
    "mfa_failed",
    "reset_rate_limited",
]

BOOKING_LANGUAGES = ["th", "en", "zh-Hans"]

BOOKING_SOURCE_CHANNELS = [
    "direct_web",
    "google_business",
    "facebook",
    "line",
    "whatsapp",
    "qr",
    "referral",
    "admin_manual",
]

RESERVATION_HOLD_STATUSES = ["active", "converted", "expired", "released"]
REVIEW_QUEUE_STATUSES = ["new", "reviewed", "needs_follow_up", "issue_flagged", "resolved"]
STAFF_NOTIFICATION_STATUSES = ["new", "read"]
CANCELLATION_REQUEST_STATUSES = ["submitted", "auto_processed", "needs_review", "approved", "declined"]
MODIFICATION_REQUEST_STATUSES = ["submitted", "reviewed", "approved", "declined"]
EMAIL_OUTBOX_STATUSES = ["pending", "sent", "failed"]

PERMISSION_SEEDS = [
    ("reservation.view", "View reservations", "Reservations", "reservation"),
    ("reservation.create", "Create reservations", "Reservations", "reservation"),
    ("reservation.edit", "Edit reservations", "Reservations", "reservation"),
    ("reservation.cancel", "Cancel reservations", "Reservations", "reservation"),
    ("reservation.check_in", "Check in reservations", "Reservations", "reservation"),
    ("reservation.check_out", "Check out reservations", "Reservations", "reservation"),
    ("rate_rule.view", "View rate rules", "Rates", "rate_rule"),
    ("rate_rule.edit", "Edit rate rules", "Rates", "rate_rule"),
    ("folio.view", "View folios", "Folio", "folio"),
    ("folio.charge_add", "Add folio charges", "Folio", "folio"),
    ("folio.adjust", "Adjust folio charges", "Folio", "folio"),
    ("payment.read", "View payments", "Payments", "payment"),
    ("payment.create", "Record payments", "Payments", "payment"),
    ("payment.refund", "Refund payments", "Payments", "payment"),
    ("payment_request.create", "Create payment requests", "Payments", "payment_request"),
    ("housekeeping.view", "View housekeeping", "Housekeeping", "housekeeping"),
    ("housekeeping.status_change", "Change housekeeping status", "Housekeeping", "housekeeping"),
    ("reports.view", "View reports", "Reports", "reports"),
    ("settings.view", "View settings", "Settings", "settings"),
    ("settings.edit", "Edit settings", "Settings", "settings"),
    ("user.view", "View users", "Users", "user"),
    ("user.create", "Create users", "Users", "user"),
    ("user.edit", "Edit users", "Users", "user"),
    ("user.disable", "Disable users", "Users", "user"),
    ("audit.view", "View audit", "Audit", "audit"),
    ("auth.manage_mfa", "Manage MFA", "Authentication", "auth"),
    ("auth.reset_password_admin", "Admin reset password", "Authentication", "auth"),
]

ROLE_SEEDS = [
    ("admin", "Admin", "Full system administrator", True, 1),
    ("manager", "Manager", "Hotel operations manager", True, 2),
    ("front_desk", "Front Desk", "Front desk operations", True, 3),
    ("housekeeping", "Housekeeping", "Housekeeping operations", True, 4),
]

ROLE_PERMISSION_SEEDS = {
    "admin": [code for code, *_ in PERMISSION_SEEDS],
    "manager": [
        "reservation.view",
        "reservation.create",
        "reservation.edit",
        "reservation.cancel",
        "reservation.check_in",
        "reservation.check_out",
        "rate_rule.view",
        "rate_rule.edit",
        "folio.view",
        "folio.charge_add",
        "folio.adjust",
        "payment.read",
        "payment.create",
        "payment.refund",
        "payment_request.create",
        "housekeeping.view",
        "housekeeping.status_change",
        "reports.view",
        "settings.view",
        "settings.edit",
        "user.view",
        "user.create",
        "user.edit",
        "user.disable",
        "audit.view",
        "auth.manage_mfa",
        "auth.reset_password_admin",
    ],
    "front_desk": [
        "reservation.view",
        "reservation.create",
        "reservation.edit",
        "reservation.check_in",
        "reservation.check_out",
        "folio.view",
        "folio.charge_add",
        "payment.read",
        "payment.create",
        "payment_request.create",
        "housekeeping.view",
        "housekeeping.status_change",
    ],
    "housekeeping": [
        "reservation.view",
        "housekeeping.view",
        "housekeeping.status_change",
    ],
}
