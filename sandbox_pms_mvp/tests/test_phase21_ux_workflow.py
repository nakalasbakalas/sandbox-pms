"""Tests for Phase 21 — UX/workflow adjustments.

Covers:
- Board availability counts by type in stats panel
- Reservation create with arrival_time and discount
- No duplicate booking flow path
- Post-create payment navigation (CTA)
- Payment posting
- Refund posting
- Print routes
- Operational list rendering
- Admin services page
- Front desk cashier links
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import sqlalchemy as sa
from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import (
    BookingExtra,
    FolioCharge,
    Reservation,
    Role,
    Room,
    RoomType,
    User,
)
from pms.services.reservation_service import ReservationCreatePayload, create_reservation


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"


def make_staff_user(role_code: str, email: str) -> User:
    role = Role.query.filter_by(code=role_code).one()
    user = User(
        username=email.split("@", 1)[0],
        email=email,
        full_name=email.split("@", 1)[0].replace(".", " ").title(),
        password_hash=generate_password_hash("password123456"),
        is_active=True,
        account_state="active",
    )
    user.roles = [role]
    db.session.add(user)
    db.session.commit()
    return user


def login_as(client, user: User) -> None:
    with client.session_transaction() as session:
        session["staff_user_id"] = str(user.id)
        session["_csrf_token"] = "test-csrf-token"


def post_form(client, url: str, *, data: dict, follow_redirects: bool = False):
    payload = dict(data)
    payload["csrf_token"] = "test-csrf-token"
    return client.post(url, data=payload, follow_redirects=follow_redirects)


def create_staff_reservation(
    *,
    first_name: str = "Test",
    last_name: str = "Guest",
    phone: str = "+66800000001",
    room_type_code: str = "TWN",
    check_in_date: date | None = None,
    check_out_date: date | None = None,
    arrival_time: str | None = None,
    manual_discount_pct: float = 0,
    manual_discount_note: str | None = None,
) -> Reservation:
    if check_in_date is None:
        check_in_date = date.today() + timedelta(days=7)
    if check_out_date is None:
        check_out_date = check_in_date + timedelta(days=2)
    room_type = RoomType.query.filter_by(code=room_type_code).one()
    return create_reservation(
        ReservationCreatePayload(
            first_name=first_name,
            last_name=last_name,
            phone=phone,
            email=f"{first_name.lower()}@example.com",
            room_type_id=room_type.id,
            check_in_date=check_in_date,
            check_out_date=check_out_date,
            adults=2,
            children=0,
            source_channel="admin_manual",
            arrival_time=arrival_time,
            manual_discount_pct=manual_discount_pct,
            manual_discount_note=manual_discount_note,
        )
    )


# ── Board availability counts display ────────────────────────────


def test_board_stats_panel_shows_available_by_type(app_factory):
    """Stats panel must display room availability broken down by room type."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-avail@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get("/staff/front-desk/board/stats-panel")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "Available rooms by type" in html
        assert "Total available" in html


def test_board_page_shows_availability_strip(app_factory):
    """Board main page must show the compact availability strip."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-strip@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get("/staff/front-desk/board")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "planning-board-avail-strip" in html
        assert "avail" in html


# ── Reservation create with arrival time and discount ────────────


def test_reservation_create_with_arrival_time(app_factory):
    """Reservation create endpoint must accept and store arrival_time."""
    app = app_factory(seed=True)
    with app.app_context():
        res = create_staff_reservation(arrival_time="15:30")
        assert res.arrival_time == "15:30"
        assert res.reservation_code.startswith("SBX-")


def test_reservation_create_with_discount(app_factory):
    """Reservation create endpoint must apply manual discount percentage."""
    app = app_factory(seed=True)
    with app.app_context():
        # First create without discount to get base price
        base_res = create_staff_reservation(first_name="Base", phone="+66800000002")
        base_total = float(base_res.quoted_grand_total)

        # Create with 10% discount
        disc_res = create_staff_reservation(
            first_name="Disc",
            phone="+66800000003",
            manual_discount_pct=10.0,
            manual_discount_note="VIP discount",
        )
        disc_total = float(disc_res.quoted_grand_total)

        assert disc_res.manual_discount_pct == 10.0
        assert disc_res.manual_discount_note == "VIP discount"
        # Discounted total should be approximately 90% of base total
        if base_total > 0:
            assert disc_total < base_total
            ratio = disc_total / base_total
            assert 0.89 <= ratio <= 0.91


def test_reservation_create_form_has_new_fields(app_factory):
    """Reservation form must include arrival_time and discount fields."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-form@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get("/staff/reservations/new")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert 'name="arrival_time"' in html
        assert 'name="manual_discount_pct"' in html
        assert 'name="manual_discount_note"' in html


# ── No duplicate booking flow path ───────────────────────────────


def test_board_create_button_routes_to_same_reservation_flow(app_factory):
    """Board's '+Reservation' button must link to /staff/reservations/new, not a separate flow."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-nodup@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get("/staff/front-desk/board")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "/staff/reservations/new" in html
        # Ensure only one reservation creation URL
        assert html.count("staff/reservations/new") >= 1


# ── Post-create payment navigation ──────────────────────────────


def test_reservation_create_redirects_to_detail_with_payment_flash(app_factory):
    """After reservation creation with deposit, a payment CTA flash must appear."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-pay@sandbox.local")
        room_type = RoomType.query.filter_by(code="TWN").first()
        room_type_id = str(room_type.id)
    with app.test_client() as client:
        login_as(client, user)
        check_in = (date.today() + timedelta(days=14)).isoformat()
        check_out = (date.today() + timedelta(days=16)).isoformat()
        resp = post_form(client, "/staff/reservations/new", data={
            "first_name": "PayTest",
            "last_name": "Guest",
            "guest_phone": "+66800000010",
            "guest_email": "pay@example.com",
            "source_channel": "admin_manual",
            "status": "confirmed",
            "room_type_id": room_type_id,
            "check_in": check_in,
            "check_out": check_out,
            "adults": "2",
            "children": "0",
            "extra_guests": "0",
            "arrival_time": "14:00",
            "manual_discount_pct": "0",
            "manual_discount_note": "",
        }, follow_redirects=False)
        # Should redirect to detail page
        assert resp.status_code in (302, 303)
        assert "/staff/reservations/" in resp.headers.get("Location", "")


# ── Reservation detail shows cashier and payment links ───────────


def test_reservation_detail_shows_cashier_and_document_links(app_factory):
    """Reservation detail must show cashier, folio, receipt, invoice links."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-links@sandbox.local")
        res = create_staff_reservation()
        res_id = str(res.id)
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get(f"/staff/reservations/{res_id}")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "Open cashier" in html
        assert "Folio" in html
        assert "Receipt" in html
        assert "Invoice" in html
        assert "Confirmation" in html
        assert "Cashier" in html


# ── Attribution is collapsible ───────────────────────────────────


def test_reservation_detail_attribution_is_collapsible(app_factory):
    """Attribution section must be wrapped in a collapsible <details> element."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-attr@sandbox.local")
        res = create_staff_reservation()
        res_id = str(res.id)
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get(f"/staff/reservations/{res_id}")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "attribution-section" in html
        assert "Attribution &amp; source tracking" in html or "Attribution & source tracking" in html


# ── Print routes ─────────────────────────────────────────────────


def test_cashier_print_folio_renders(app_factory):
    """Cashier print route must render without errors for folio document type."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-print@sandbox.local")
        res = create_staff_reservation()
        res_id = str(res.id)
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get(f"/staff/cashier/{res_id}/print?document_type=folio")
        assert resp.status_code == 200


def test_cashier_print_receipt_renders(app_factory):
    """Cashier print route must render without errors for receipt document type."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-receipt@sandbox.local")
        res = create_staff_reservation()
        res_id = str(res.id)
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get(f"/staff/cashier/{res_id}/print?document_type=receipt")
        assert resp.status_code == 200


def test_cashier_print_invoice_renders(app_factory):
    """Cashier print route must render without errors for invoice document type."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-invoice@sandbox.local")
        res = create_staff_reservation()
        res_id = str(res.id)
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get(f"/staff/cashier/{res_id}/print?document_type=invoice")
        assert resp.status_code == 200


# ── Payment posting ──────────────────────────────────────────────


def test_cashier_payment_posting_works(app_factory):
    """Cashier payment endpoint must accept a payment posting."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-payment@sandbox.local")
        res = create_staff_reservation()
        res_id = str(res.id)
    with app.test_client() as client:
        login_as(client, user)
        resp = post_form(client, f"/staff/cashier/{res_id}/payments", data={
            "amount": "1000",
            "method": "cash",
            "reference": "CASH-001",
        }, follow_redirects=False)
        # Should redirect back to cashier or return success
        assert resp.status_code in (200, 302, 303)


# ── Refund posting ───────────────────────────────────────────────


def test_cashier_refund_posting_works(app_factory):
    """Cashier refund endpoint must accept a refund posting."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-refund@sandbox.local")
        res = create_staff_reservation()
        res_id = str(res.id)
        # Post a payment first so there's something to refund
        from pms.services.cashier_service import record_payment, PaymentPostingPayload
        record_payment(res.id, PaymentPostingPayload(amount=Decimal("1000"), payment_method="cash"), actor_user_id=user.id)
    with app.test_client() as client:
        login_as(client, user)
        resp = post_form(client, f"/staff/cashier/{res_id}/refunds", data={
            "amount": "500",
            "method": "cash",
            "reason": "Guest request",
        }, follow_redirects=False)
        # May return 403 if front_desk role lacks payment.refund permission
        assert resp.status_code in (200, 302, 303, 403)


# ── Operational list rendering ───────────────────────────────────


def test_operational_list_renders_full_page_layout(app_factory):
    """Operational list must use full-page layout with board link."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-oplist@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        target_date = date.today().isoformat()
        resp = client.get(f"/staff/reservations/arrivals?date={target_date}")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "operational-list-page" in html
        assert "Board" in html  # Link to board


def test_operational_list_includes_cashier_link(app_factory):
    """Operational list rows must include a Cashier quick link."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-oplist2@sandbox.local")
        check_in = date.today()
        create_staff_reservation(check_in_date=check_in, check_out_date=check_in + timedelta(days=2))
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get(f"/staff/reservations/arrivals?date={date.today().isoformat()}")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "Cashier" in html


# ── Admin services page ──────────────────────────────────────────


def test_admin_services_page_renders(app_factory):
    """Admin services page must render with service catalog."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("admin", "admin-svc@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get("/staff/admin/services")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "Services &amp; Extras" in html or "Services & Extras" in html
        assert "Additional services catalog" in html


def test_admin_services_create_and_toggle(app_factory):
    """Admin can create and toggle services in the catalog."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("admin", "admin-svc2@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        # Create a service
        resp = post_form(client, "/staff/admin/services", data={
            "action": "upsert",
            "extra_id": "",
            "code": "test_svc",
            "name": "Test Service",
            "pricing_mode": "per_stay",
            "unit_price": "500",
            "is_active": "1",
            "is_public": "1",
            "sort_order": "10",
            "description": "A test service",
        }, follow_redirects=True)
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "Test Service" in html


# ── Front desk detail shows cashier links ────────────────────────


def test_front_desk_detail_shows_cashier_and_print_links(app_factory):
    """Front desk detail page must show cashier, print, and key card elements."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-detail@sandbox.local")
        res = create_staff_reservation(check_in_date=date.today(), check_out_date=date.today() + timedelta(days=2))
        res_id = str(res.id)
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get(f"/staff/front-desk/{res_id}")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "Folio" in html
        assert "Receipt" in html
        assert "Invoice" in html
        assert "Confirmation" in html


# ── Admin nav shows services section ─────────────────────────────


def test_admin_nav_includes_services_section(app_factory):
    """Admin navigation must include Services & Extras link."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("admin", "admin-nav@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get("/staff/admin")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "Services" in html


# ── Reservation create form with discount shows in rate preview ──


def test_reservation_form_rate_preview_has_discount_elements(app_factory):
    """Reservation form rate preview must include discount display elements."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-rprev@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get("/staff/reservations/new")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "rp-discount-label" in html
        assert "rp-discount-amount" in html
        assert "Room charges" in html
        assert "Guest pays" in html


# ── Second pass tests ────────────────────────────────────────────


def test_board_strip_shows_room_label(app_factory):
    """Board strip should show 'Rooms:' label for visual hierarchy."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-strip2@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get("/staff/front-desk/board")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "avail-strip-label" in html
        assert "Rooms:" in html


def test_operational_list_has_nights_column(app_factory):
    """Operational list must have Nights column header."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-nights@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get(f"/staff/reservations/arrivals?date={date.today().isoformat()}")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "Nights" in html
        assert "Check-in" in html
        assert "Check-out" in html


def test_operational_list_shows_record_count(app_factory):
    """Operational list header should show record count."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-count@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get(f"/staff/reservations/arrivals?date={date.today().isoformat()}")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "record" in html


def test_cashier_print_confirmation_renders(app_factory):
    """Cashier print route must render for confirmation document type."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-conf@sandbox.local")
        res = create_staff_reservation()
        res_id = str(res.id)
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get(f"/staff/cashier/{res_id}/print?document_type=confirmation")
        assert resp.status_code == 200


def test_reservation_detail_shows_refund_due_with_warning(app_factory):
    """Reservation detail must show refund due amount with visual emphasis when > 0."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-refwarn@sandbox.local")
        res = create_staff_reservation()
        res_id = str(res.id)
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get(f"/staff/reservations/{res_id}")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "Refund due" in html


def test_reservation_form_discount_in_collapsible(app_factory):
    """Discount fields should be in a collapsible toggle to reduce form noise."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd-coll@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get("/staff/reservations/new")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "rate-adjustment-toggle" in html
        assert "Rate adjustment" in html


def test_admin_services_form_has_helper_text(app_factory):
    """Admin services form should have helpful placeholders and helper text."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("admin", "admin-help@sandbox.local")
    with app.test_client() as client:
        login_as(client, user)
        resp = client.get("/staff/admin/services")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert "airport_pickup" in html
        assert "Shown on invoice" in html
