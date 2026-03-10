from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

import sqlalchemy as sa

from .extensions import db
from .models import AppSetting, RateRule, RoomType


@dataclass
class QuoteResult:
    room_total: Decimal
    tax_total: Decimal
    grand_total: Decimal
    nightly_rates: list[tuple[date, Decimal]]


def daterange(start_date: date, end_date: date):
    cursor = start_date
    while cursor < end_date:
        yield cursor
        cursor += timedelta(days=1)


def get_setting_value(key: str, default):
    setting = AppSetting.query.filter_by(key=key, deleted_at=None).first()
    if not setting:
        return default
    return setting.value_json.get("value", default)


def quote_reservation(
    *,
    room_type: RoomType,
    check_in_date: date,
    check_out_date: date,
    adults: int,
    children: int,
) -> QuoteResult:
    stay_length = (check_out_date - check_in_date).days
    nightly_rates: list[tuple[date, Decimal]] = []
    gross_room_total = Decimal("0.00")
    for business_date in daterange(check_in_date, check_out_date):
        nightly_rate = nightly_room_rate(room_type, business_date, stay_length)
        nightly_rates.append((business_date, nightly_rate))
        gross_room_total += nightly_rate
    extra_guest_fee = Decimal(str(get_setting_value("hotel.extra_guest_fee", "200.00")))
    child_fee = Decimal(str(get_setting_value("hotel.child_fee_6_11", "100.00")))
    extra_guest_count = max(adults - room_type.standard_occupancy, 0)
    gross_room_total += extra_guest_fee * extra_guest_count * stay_length
    gross_room_total += child_fee * children * stay_length
    vat_rate = Decimal(str(get_setting_value("hotel.vat_rate", "0.07")))
    if vat_rate > 0:
        net_total = (gross_room_total / (Decimal("1.00") + vat_rate)).quantize(Decimal("0.01"))
        tax_total = (gross_room_total - net_total).quantize(Decimal("0.01"))
    else:
        net_total = gross_room_total
        tax_total = Decimal("0.00")
    return QuoteResult(
        room_total=net_total.quantize(Decimal("0.01")),
        tax_total=tax_total,
        grand_total=gross_room_total.quantize(Decimal("0.01")),
        nightly_rates=nightly_rates,
    )


def nightly_room_rate(room_type: RoomType, business_date: date, stay_length: int) -> Decimal:
    matching_rules = (
        db.session.execute(
            sa.select(RateRule)
            .where(
                RateRule.deleted_at.is_(None),
                RateRule.is_active.is_(True),
                sa.or_(RateRule.room_type_id.is_(None), RateRule.room_type_id == room_type.id),
                sa.or_(RateRule.start_date.is_(None), RateRule.start_date <= business_date),
                sa.or_(RateRule.end_date.is_(None), RateRule.end_date >= business_date),
            )
            .order_by(RateRule.priority.asc(), RateRule.created_at.asc())
        )
        .scalars()
        .all()
    )
    applied = Decimal("0.00")
    discounts: list[RateRule] = []
    for rule in matching_rules:
        if rule.days_of_week:
            valid_days = {int(item) for item in rule.days_of_week.split(",")}
            if business_date.weekday() not in valid_days:
                continue
        if rule.min_nights and stay_length < rule.min_nights:
            continue
        if rule.max_nights and stay_length > rule.max_nights:
            continue
        if rule.rule_type == "long_stay_discount":
            discounts.append(rule)
            continue
        applied = apply_adjustment(Decimal(str(applied or 0)), Decimal(str(rule.adjustment_value)), rule.adjustment_type)
        if rule.adjustment_type == "fixed":
            applied = Decimal(str(rule.adjustment_value))
    if applied == Decimal("0.00"):
        applied = Decimal("750.00")
    for discount in discounts:
        applied = apply_adjustment(applied, Decimal(str(discount.adjustment_value)), discount.adjustment_type)
    return applied.quantize(Decimal("0.01"))


def apply_adjustment(base: Decimal, adjustment_value: Decimal, adjustment_type: str) -> Decimal:
    if adjustment_type == "fixed":
        return adjustment_value
    if adjustment_type == "amount_delta":
        return base + adjustment_value
    if adjustment_type == "percent_delta":
        return (base * (Decimal("1.00") + (adjustment_value / Decimal("100.00")))).quantize(Decimal("0.01"))
    return base
