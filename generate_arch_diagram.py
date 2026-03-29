"""Generate architecture diagram PDF for Sandbox PMS."""

from fpdf import FPDF

DIAGRAM = r"""
SANDBOX HOTEL PMS — ARCHITECTURE
================================================================================

                              +----------------+
                              |    INTERNET    |
                              +-------+--------+
                                      |
             +-----------------------++-----------------------+
             |                        |                       |
   +---------+---------+   +----------+----------+   +-------+--------+
   |  book.sandbox     |   |  staff.sandbox      |   |  OTA Channels  |
   |  hotel.com        |   |  hotel.com          |   |  Booking.com   |
   |  (Guest Booking)  |   |  (Staff PMS)        |   |  Expedia       |
   +--------+----------+   +-----------+---------+   |  Agoda         |
            |                          |             +-------+--------+
            +-----------+-------------+                      |
                        +-------------------------------------+
                                      |
                         +------------+------------+
                         |  Render.com Web Service |
                         |  Gunicorn (2 workers)   |
                         |  Python 3.11            |
                         +------------+------------+
                                      |
+---------------------------------------------------------------------+
|                    FLASK APPLICATION FACTORY                        |
|                    create_app() -- pms/app.py                       |
|                                                                     |
|  MIDDLEWARE / HOOKS                                                 |
|  - URL topology (canonical host enforcement)                        |
|  - Auth hooks: session load, MFA gate, password-reset gate          |
|  - CSRF validation                                                  |
|  - Security: CSP, HTTPS, ProxyFix, request ID, Fernet encryption    |
|  - Multi-property resolution                                        |
|  - Booking attribution capture                                      |
|  - Error monitoring (Sentry)                                        |
|                                                                     |
|  11 BLUEPRINTS                                                      |
|                                                                     |
|  GUEST-FACING              STAFF-FACING          PARTNER            |
|  +-------------+           +--------------+      +-----------+      |
|  | public      |           | front_desk   |      | provider  |      |
|  | /           |           | /staff/board |      | /provider |      |
|  | /book       |           +--------------+      | bookings  |      |
|  | /avail..    |           | staff_reserv |      | calendar  |      |
|  | payments    |           | /staff/reserv|      | payments  |      |
|  | pre-checkin |           +--------------+      +-----------+      |
|  | checkout    |           | housekeeping |                         |
|  | survey      |           | /staff/hkpng |      +--------+         |
|  | maint.      |           +--------------+      | auth   |         |
|  +-------------+           | cashier      |      | /staff |         |
|                            | /staff/cash  |      | /login |         |
|  +-------------+           +--------------+      | /mfa   |         |
|  | coupon_     |           | messaging    |      +--------+         |
|  | studio      |           | /staff/msg   |                         |
|  +-------------+           +--------------+                         |
|                            | reports      |                         |
|                            | /staff/rpts  |                         |
|                            +--------------+                         |
|                            | admin        |                         |
|                            | /staff/admin |                         |
|                            +--------------+                         |
|                                                                     |
|  SERVICE LAYER (~45 modules)                                        |
|                                                                     |
|  BOOKING & AVAILABILITY      OPERATIONS           FINANCE           |
|  +--------------------+      +-----------+        +----------+      |
|  | public_booking_svc |      | front_    |        | cashier  |      |
|  | reservation_svc    |      | desk_svc  |        | _svc     |      |
|  | availability_svc   |      | (board,   |        | payment_ |      |
|  | extras_svc         |      | mutations |        | integr.  |      |
|  | group_booking_svc  |      | queries)  |        | (Stripe) |      |
|  | pricing (engine)   |      | hkpng_svc |        | pos_     |      |
|  +--------------------+      | room_     |        | adapter  |      |
|                              | readiness |        +----------+      |
|  COMMUNICATION               | pre_      |                          |
|  +--------------------+      | checkin   |        IDENTITY          |
|  | messaging_svc      |      +-----------+        +----------+      |
|  | comms_svc          |                           | auth_svc |      |
|  |  (dispatch, queue) |      ADMIN & CONFIG        | rate_    |      |
|  | sms_provider       |      +-----------+        | limiter  |      |
|  |  (Twilio adapter)  |      | admin_svc |        | permiss. |      |
|  +--------------------+      | setup_svc |        +----------+      |
|                              | property_ |                          |
|  GUEST & LOYALTY             | svc       |        INTEGRATIONS      |
|  +--------------------+      +-----------+        +----------+      |
|  | staff_reserv_svc   |                           | channel_ |      |
|  | loyalty_svc        |      REPORTING            | svc(OTA) |      |
|  | survey_svc         |      +-----------+        | ical_svc |      |
|  +--------------------+      |reporting_ |        | storage  |      |
|                              | svc       |        | (S3/loc) |      |
|                              +-----------+        +----------+      |
|                                                                     |
|  CORE MODULES                                                       |
|  models.py (65 models)  |  helpers.py (47 helpers)  |  constants.py|
|  config.py              |  security.py              |  branding.py  |
|  i18n.py (TH/EN/ZH)    |  pricing.py               |  normaliztn.  |
|  activity.py / audit.py |  url_topology.py          |  seeds.py     |
|                                                                     |
|  +-------------+   +-----------------+   +----------------------+  |
|  | extensions  |   | 65 Templates    |   | Static Assets        |  |
|  | SQLAlchemy  |   | (Jinja2, flat)  |   | styles.css           |  |
|  | Migrate     |   |                 |   | front-desk-board.js  |  |
|  +-------------+   +-----------------+   +----------------------+  |
+-----------------------------+---------------------------------------+
                              |
               +--------------+--------------+
               |    PostgreSQL 17 (Render)   |
               |    Alembic migrations (27)  |
               |    65 tables                |
               +--------------+--------------+
                              |
         +--------------------+--------------------+
         |                    |                    |
+--------+---------+  +-------+------+  +----------+---------+
| Render Disk      |  | Sentry       |  | External APIs      |
| /var/data/       |  | (Error       |  | - Stripe           |
|  uploads/docs    |  |  Monitoring) |  | - Twilio SMS       |
+------------------+  +--------------+  | - OTA channels     |
                                        | - iCal feeds       |
                                        +--------------------+

================================================================================
9 CRON JOBS (Render)
================================================================================
Every 5 min  : process-notifications, process-automation-events
Every 15 min : sync-ical-sources, process-waitlist
Hourly       : auto-cancel-no-shows
Daily 8 AM   : fire-pre-checkin-reminders
Daily 9 AM   : send-pre-arrival-reminders
Daily 10 AM  : send-failed-payment-reminders
Daily 3:30 AM: cleanup-audit-logs

================================================================================
RBAC: 5 system roles x 37 permissions
================================================================================
admin        -> full access
manager      -> reservations, front desk, reports, cashier, messaging, housekeeping
front_desk   -> check-in/out, board, walk-in, cashier (limited)
housekeeping -> room status, tasks, inspections
provider     -> own bookings, calendar, payment requests

================================================================================
DATA MODEL  (65 SQLAlchemy models)
================================================================================
Auth & Users   : User, Role, Permission, UserRole, RolePermission,
                 UserSession, UserPreference, PasswordResetToken,
                 AuthAttempt, MfaFactor, MfaRecoveryCode, UserPasswordHistory
Activity/Audit : ActivityLog, AuditLog
Guests         : Guest, GuestLoyalty, GuestNote
Property/Rooms : Property, RoomType, Room, HousekeepingStatus,
                 RoomNote, RoomStatusHistory
Housekeeping   : HousekeepingTask
Reservations   : Reservation, ReservationStatusHistory, ReservationNote,
                 ReservationExtra, ReservationHold, ReservationReviewQueue,
                 StaffNotification, ReservationDocument, ReservationCodeSequence
Booking Ops    : CancellationRequest, ModificationRequest, EmailOutbox
Inventory/Rates: InventoryDay, RateRule, BookingExtra,
                 InventoryOverride, BlackoutPeriod
Folio/Payments : FolioCharge, PaymentRequest, PaymentEvent,
                 CashierDocument, CashierDocumentSequence, CashierActivityLog
Content/Config : PolicyDocument, NotificationTemplate,
                 NotificationDelivery, AppSetting
Channels/Cal   : OtaChannel, CalendarFeed, ExternalCalendarSource,
                 ExternalCalendarBlock, ExternalCalendarSyncRun
Pre-Check-In   : PreCheckIn
Messaging      : ConversationThread, Message, MessageTemplate,
                 DeliveryAttempt, AutomationRule,
                 PendingAutomationEvent, AutoResponseRule
Surveys        : GuestSurvey
"""


class PDF(FPDF):
    def header(self):
        self.set_font("Courier", "B", 8)
        self.set_text_color(80, 80, 80)
        self.cell(0, 6, "Sandbox Hotel PMS — Architecture Diagram", align="C")
        self.ln(4)

    def footer(self):
        self.set_y(-12)
        self.set_font("Courier", "", 7)
        self.set_text_color(140, 140, 140)
        self.cell(0, 6, f"Page {self.page_no()}", align="C")


def generate():
    pdf = PDF(orientation="L", unit="mm", format="A3")
    pdf.set_margins(left=10, top=14, right=10)
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()

    # monospace body
    pdf.set_font("Courier", size=7)
    pdf.set_text_color(20, 20, 20)

    for line in DIAGRAM.split("\n"):
        pdf.cell(0, 3.8, line, ln=True)

    out = "arch_diagram.pdf"
    pdf.output(out)
    print(f"PDF saved: {out}")


if __name__ == "__main__":
    generate()
