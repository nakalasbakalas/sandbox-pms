"""Direct tests for the pricing module — quote_reservation, nightly_room_rate, apply_adjustment."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import sqlalchemy as sa

from pms.extensions import db
from pms.models import RateRule, RoomType, User
from pms.pricing import apply_adjustment, money, nightly_room_rate, quote_reservation
from pms.services.admin_service import RateRulePayload, upsert_rate_rule, upsert_setting


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_user() -> User:
    return db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))


def _isolated_room_type(admin: User, code: str = "PRC") -> RoomType:
    """Create a room type with no matching rate rules."""
    rt = RoomType(
        code=code,
        name=f"Pricing Test {code}",
        standard_occupancy=2,
        max_occupancy=4,
        extra_bed_allowed=False,
        is_active=True,
        created_by_user_id=admin.id,
    )
    db.session.add(rt)
    db.session.commit()
    return rt


def _deactivate_rules_for_date(business_date: date) -> None:
    """Deactivate all rate rules that overlap a given date so we test in isolation."""
    for rule in RateRule.query.filter(
        RateRule.deleted_at.is_(None),
        RateRule.is_active.is_(True),
        sa.or_(RateRule.start_date.is_(None), RateRule.start_date <= business_date),
        sa.or_(RateRule.end_date.is_(None), RateRule.end_date >= business_date),
    ).all():
        rule.is_active = False
    db.session.commit()


def _create_rule(admin: User, room_type: RoomType, *, name: str, business_date: date, **overrides) -> None:
    defaults = dict(
        priority=900,
        is_active=True,
        rule_type="seasonal_override",
        adjustment_type="fixed",
        adjustment_value=Decimal("1000.00"),
        start_date=business_date,
        end_date=business_date,
        days_of_week=None,
        min_nights=None,
        max_nights=None,
        extra_guest_fee_override=None,
        child_fee_override=None,
    )
    defaults.update(overrides)
    defaults["room_type_id"] = room_type.id
    upsert_rate_rule(None, RateRulePayload(name=name, **defaults), actor_user_id=admin.id)


# ---------------------------------------------------------------------------
# apply_adjustment
# ---------------------------------------------------------------------------


def test_apply_adjustment_fixed():
    assert apply_adjustment(Decimal("500"), Decimal("1200"), "fixed") == Decimal("1200")


def test_apply_adjustment_amount_delta():
    assert apply_adjustment(Decimal("1000"), Decimal("150"), "amount_delta") == Decimal("1150")


def test_apply_adjustment_percent_delta_positive():
    result = apply_adjustment(Decimal("1000"), Decimal("20"), "percent_delta")
    assert result == Decimal("1200.00")


def test_apply_adjustment_percent_delta_negative():
    result = apply_adjustment(Decimal("1000"), Decimal("-15"), "percent_delta")
    assert result == Decimal("850.00")


def test_apply_adjustment_unknown_type_returns_base():
    assert apply_adjustment(Decimal("999"), Decimal("50"), "unknown_type") == Decimal("999")


# ---------------------------------------------------------------------------
# money helper
# ---------------------------------------------------------------------------


def test_money_rounds_to_two_decimals():
    assert money("123.456") == Decimal("123.46")
    assert money(0) == Decimal("0.00")
    assert money(None) == Decimal("0.00")


# ---------------------------------------------------------------------------
# nightly_room_rate
# ---------------------------------------------------------------------------


def test_nightly_room_rate_falls_back_to_base_rate(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = _admin_user()
        rt = _isolated_room_type(admin, "NR1")
        bd = date.today() + timedelta(days=20)
        _deactivate_rules_for_date(bd)
        upsert_setting("hotel.base_rate", value="800.00", value_type="money", actor_user_id=admin.id)
        assert nightly_room_rate(rt, bd, 1) == Decimal("800.00")


def test_nightly_room_rate_fixed_override_takes_precedence(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = _admin_user()
        rt = _isolated_room_type(admin, "NR2")
        bd = date.today() + timedelta(days=20)
        _deactivate_rules_for_date(bd)
        _create_rule(admin, rt, name="Fixed 1500", business_date=bd, adjustment_value=Decimal("1500.00"))
        assert nightly_room_rate(rt, bd, 1) == Decimal("1500.00")


def test_nightly_room_rate_day_of_week_filter(app_factory):
    """Rule with days_of_week set should not apply on other days."""
    app = app_factory(seed=True)
    with app.app_context():
        admin = _admin_user()
        rt = _isolated_room_type(admin, "NR3")
        # Pick a known Monday
        bd = date.today() + timedelta(days=20)
        while bd.weekday() != 0:  # Monday
            bd += timedelta(days=1)
        _deactivate_rules_for_date(bd)
        upsert_setting("hotel.base_rate", value="700.00", value_type="money", actor_user_id=admin.id)
        # Rule only applies on Saturday (5) and Sunday (6) — not Monday
        _create_rule(
            admin, rt, name="Weekend Only", business_date=bd,
            adjustment_value=Decimal("2000.00"), days_of_week="5,6",
        )
        # Monday should fall back to base rate since the rule doesn't match
        assert nightly_room_rate(rt, bd, 1) == Decimal("700.00")


def test_nightly_room_rate_min_nights_filter(app_factory):
    """Rule with min_nights=3 should not apply for shorter stays."""
    app = app_factory(seed=True)
    with app.app_context():
        admin = _admin_user()
        rt = _isolated_room_type(admin, "NR4")
        bd = date.today() + timedelta(days=20)
        _deactivate_rules_for_date(bd)
        upsert_setting("hotel.base_rate", value="600.00", value_type="money", actor_user_id=admin.id)
        _create_rule(
            admin, rt, name="Long Stay Only", business_date=bd,
            adjustment_value=Decimal("500.00"), min_nights=3,
        )
        # 1-night stay should not match rule → falls back to base
        assert nightly_room_rate(rt, bd, 1) == Decimal("600.00")
        # 3-night stay should match
        assert nightly_room_rate(rt, bd, 3) == Decimal("500.00")


def test_nightly_room_rate_long_stay_discount_applied_after_fixed(app_factory):
    """Long-stay discount is applied on top of the resolved base/override rate."""
    app = app_factory(seed=True)
    with app.app_context():
        admin = _admin_user()
        rt = _isolated_room_type(admin, "NR5")
        bd = date.today() + timedelta(days=20)
        _deactivate_rules_for_date(bd)
        _create_rule(admin, rt, name="Base 1000", business_date=bd, adjustment_value=Decimal("1000.00"))
        _create_rule(
            admin, rt, name="10% Off Long Stay", business_date=bd,
            priority=901, rule_type="long_stay_discount",
            adjustment_type="percent_delta", adjustment_value=Decimal("-10.00"),
            min_nights=3,
        )
        # Short stay: no discount
        assert nightly_room_rate(rt, bd, 2) == Decimal("1000.00")
        # Long stay: 1000 * 0.90 = 900
        assert nightly_room_rate(rt, bd, 4) == Decimal("900.00")


# ---------------------------------------------------------------------------
# quote_reservation
# ---------------------------------------------------------------------------


def test_quote_reservation_basic_2_night_stay(app_factory):
    """Basic quoting for a 2-night stay with no extras, standard occupancy."""
    app = app_factory(seed=True)
    with app.app_context():
        admin = _admin_user()
        rt = _isolated_room_type(admin, "QR1")
        ci = date.today() + timedelta(days=20)
        co = ci + timedelta(days=2)
        _deactivate_rules_for_date(ci)
        _deactivate_rules_for_date(ci + timedelta(days=1))
        _create_rule(admin, rt, name="Night 1", business_date=ci, adjustment_value=Decimal("1000.00"))
        _create_rule(admin, rt, name="Night 2", business_date=ci + timedelta(days=1), adjustment_value=Decimal("1000.00"), priority=901)

        quote = quote_reservation(
            room_type=rt,
            check_in_date=ci,
            check_out_date=co,
            adults=2,
            children=0,
        )
        # 2 nights × 1000 = 2000 gross (adults == standard_occupancy, no extra fees)
        assert quote.grand_total == Decimal("2000.00")
        assert len(quote.nightly_rates) == 2
        assert quote.nightly_rates[0][1] == Decimal("1000.00")
        assert quote.nightly_rates[1][1] == Decimal("1000.00")
        # Default VAT 7%: net = 2000/1.07, tax = 2000 - net
        assert quote.room_total + quote.tax_total == quote.grand_total


def test_quote_reservation_extra_guest_fee(app_factory):
    """Extra guests beyond standard occupancy incur per-night extra guest fee."""
    app = app_factory(seed=True)
    with app.app_context():
        admin = _admin_user()
        rt = _isolated_room_type(admin, "QR2")  # standard_occupancy=2
        ci = date.today() + timedelta(days=20)
        co = ci + timedelta(days=1)
        _deactivate_rules_for_date(ci)
        _create_rule(admin, rt, name="Rate", business_date=ci, adjustment_value=Decimal("1000.00"))
        upsert_setting("hotel.extra_guest_fee", value="200.00", value_type="money", actor_user_id=admin.id)

        quote = quote_reservation(
            room_type=rt,
            check_in_date=ci,
            check_out_date=co,
            adults=3,  # 1 extra guest
            children=0,
        )
        # 1 night × 1000 + 1 extra guest × 200 × 1 night = 1200 gross
        assert quote.grand_total == Decimal("1200.00")


def test_quote_reservation_child_fee(app_factory):
    """Children incur per-night child fee."""
    app = app_factory(seed=True)
    with app.app_context():
        admin = _admin_user()
        rt = _isolated_room_type(admin, "QR3")
        ci = date.today() + timedelta(days=20)
        co = ci + timedelta(days=2)
        _deactivate_rules_for_date(ci)
        _deactivate_rules_for_date(ci + timedelta(days=1))
        _create_rule(admin, rt, name="N1", business_date=ci, adjustment_value=Decimal("800.00"))
        _create_rule(admin, rt, name="N2", business_date=ci + timedelta(days=1), adjustment_value=Decimal("800.00"), priority=901)
        upsert_setting("hotel.child_fee_6_11", value="100.00", value_type="money", actor_user_id=admin.id)

        quote = quote_reservation(
            room_type=rt,
            check_in_date=ci,
            check_out_date=co,
            adults=2,
            children=1,
        )
        # 2 nights × 800 + 1 child × 100 × 2 nights = 1600 + 200 = 1800 gross
        assert quote.grand_total == Decimal("1800.00")


def test_quote_reservation_zero_vat(app_factory):
    """When VAT is 0, room_total equals grand_total and tax_total is zero."""
    app = app_factory(seed=True)
    with app.app_context():
        admin = _admin_user()
        rt = _isolated_room_type(admin, "QR4")
        ci = date.today() + timedelta(days=20)
        co = ci + timedelta(days=1)
        _deactivate_rules_for_date(ci)
        _create_rule(admin, rt, name="Rate", business_date=ci, adjustment_value=Decimal("500.00"))
        upsert_setting("hotel.vat_rate", value="0", value_type="money", actor_user_id=admin.id)

        quote = quote_reservation(
            room_type=rt,
            check_in_date=ci,
            check_out_date=co,
            adults=2,
            children=0,
        )
        assert quote.grand_total == Decimal("500.00")
        assert quote.room_total == Decimal("500.00")
        assert quote.tax_total == Decimal("0.00")


def test_quote_reservation_vat_breakdown_is_consistent(app_factory):
    """room_total + tax_total must always equal grand_total."""
    app = app_factory(seed=True)
    with app.app_context():
        admin = _admin_user()
        rt = _isolated_room_type(admin, "QR5")
        ci = date.today() + timedelta(days=20)
        co = ci + timedelta(days=3)
        for i in range(3):
            d = ci + timedelta(days=i)
            _deactivate_rules_for_date(d)
            _create_rule(admin, rt, name=f"N{i}", business_date=d, adjustment_value=Decimal("777.00"), priority=900 + i)
        upsert_setting("hotel.vat_rate", value="0.07", value_type="money", actor_user_id=admin.id)

        quote = quote_reservation(
            room_type=rt,
            check_in_date=ci,
            check_out_date=co,
            adults=2,
            children=0,
        )
        assert quote.room_total + quote.tax_total == quote.grand_total
        assert quote.grand_total == Decimal("2331.00")  # 777 × 3
