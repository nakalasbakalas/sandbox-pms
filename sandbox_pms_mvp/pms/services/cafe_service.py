"""Café POS service — order management, payment, prep, shifts, and reports."""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from flask import current_app

from ..extensions import db
from ..models import (
    CafeAuditLog,
    CafeCategory,
    CafeItem,
    CafeModifier,
    CafeModifierGroup,
    CafeOrder,
    CafeOrderItem,
    CafeOrderItemModifier,
    CafePayment,
    CafeShift,
    User,
    utc_now,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Audit helper
# ---------------------------------------------------------------------------

def _cafe_audit(
    *,
    actor_user_id: uuid.UUID | None,
    action: str,
    entity_type: str,
    entity_id: str,
    details: dict | None = None,
) -> None:
    db.session.add(
        CafeAuditLog(
            actor_user_id=actor_user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details,
        )
    )


# ---------------------------------------------------------------------------
# Order number generation
# ---------------------------------------------------------------------------

def _next_order_number() -> str:
    """Generate a simple sequential café order number for today."""
    today = date.today()
    prefix = today.strftime("C%y%m%d")
    count = db.session.execute(
        sa.select(sa.func.count()).select_from(CafeOrder).where(
            CafeOrder.order_number.like(f"{prefix}%")
        )
    ).scalar_one()
    return f"{prefix}-{count + 1:03d}"


# ---------------------------------------------------------------------------
# Menu helpers
# ---------------------------------------------------------------------------

def list_categories(*, active_only: bool = True) -> list[CafeCategory]:
    stmt = sa.select(CafeCategory).order_by(CafeCategory.sort_order.asc(), CafeCategory.name.asc())
    if active_only:
        stmt = stmt.where(CafeCategory.is_active.is_(True))
    return list(db.session.execute(stmt).scalars().all())


def list_items(*, category_id: uuid.UUID | None = None, available_only: bool = True) -> list[CafeItem]:
    stmt = sa.select(CafeItem).order_by(CafeItem.sort_order.asc(), CafeItem.name.asc())
    if category_id:
        stmt = stmt.where(CafeItem.category_id == category_id)
    if available_only:
        stmt = stmt.where(CafeItem.is_available.is_(True))
    return list(db.session.execute(stmt).scalars().all())


def list_all_items() -> list[CafeItem]:
    return list(
        db.session.execute(
            sa.select(CafeItem).order_by(CafeItem.sort_order.asc(), CafeItem.name.asc())
        ).scalars().all()
    )


def list_modifier_groups() -> list[CafeModifierGroup]:
    return list(
        db.session.execute(
            sa.select(CafeModifierGroup).order_by(CafeModifierGroup.sort_order.asc())
        ).scalars().all()
    )


def get_item_modifier_groups(item_id: uuid.UUID) -> list[CafeModifierGroup]:
    item = db.session.get(CafeItem, item_id)
    if not item:
        return []
    return list(item.modifier_groups)


# ---------------------------------------------------------------------------
# Category CRUD
# ---------------------------------------------------------------------------

@dataclass
class CategoryPayload:
    name: str
    description: str = ""
    sort_order: int = 0
    is_active: bool = True


def create_category(payload: CategoryPayload, *, actor_id: uuid.UUID | None = None) -> CafeCategory:
    cat = CafeCategory(
        name=payload.name,
        description=payload.description or None,
        sort_order=payload.sort_order,
        is_active=payload.is_active,
        created_by_user_id=actor_id,
        updated_by_user_id=actor_id,
    )
    db.session.add(cat)
    db.session.flush()
    _cafe_audit(actor_user_id=actor_id, action="create", entity_type="cafe_category", entity_id=str(cat.id))
    return cat


def update_category(category_id: uuid.UUID, payload: CategoryPayload, *, actor_id: uuid.UUID | None = None) -> CafeCategory:
    cat = db.session.get(CafeCategory, category_id)
    if not cat:
        raise ValueError("Category not found")
    cat.name = payload.name
    cat.description = payload.description or None
    cat.sort_order = payload.sort_order
    cat.is_active = payload.is_active
    cat.updated_by_user_id = actor_id
    db.session.flush()
    _cafe_audit(actor_user_id=actor_id, action="update", entity_type="cafe_category", entity_id=str(cat.id))
    return cat


# ---------------------------------------------------------------------------
# Item CRUD
# ---------------------------------------------------------------------------

@dataclass
class ItemPayload:
    name: str
    category_id: uuid.UUID
    price: int = 0
    description: str = ""
    sort_order: int = 0
    is_available: bool = True
    prep_station: str = "counter"
    stock_quantity: int | None = None
    low_stock_threshold: int | None = None
    modifier_group_ids: list[uuid.UUID] = field(default_factory=list)


def create_item(payload: ItemPayload, *, actor_id: uuid.UUID | None = None) -> CafeItem:
    item = CafeItem(
        name=payload.name,
        category_id=payload.category_id,
        price=payload.price,
        description=payload.description or None,
        sort_order=payload.sort_order,
        is_available=payload.is_available,
        prep_station=payload.prep_station,
        stock_quantity=payload.stock_quantity,
        low_stock_threshold=payload.low_stock_threshold,
        created_by_user_id=actor_id,
        updated_by_user_id=actor_id,
    )
    db.session.add(item)
    db.session.flush()
    if payload.modifier_group_ids:
        groups = db.session.execute(
            sa.select(CafeModifierGroup).where(CafeModifierGroup.id.in_(payload.modifier_group_ids))
        ).scalars().all()
        item.modifier_groups = list(groups)
        db.session.flush()
    _cafe_audit(actor_user_id=actor_id, action="create", entity_type="cafe_item", entity_id=str(item.id))
    return item


def update_item(item_id: uuid.UUID, payload: ItemPayload, *, actor_id: uuid.UUID | None = None) -> CafeItem:
    item = db.session.get(CafeItem, item_id)
    if not item:
        raise ValueError("Item not found")
    item.name = payload.name
    item.category_id = payload.category_id
    item.price = payload.price
    item.description = payload.description or None
    item.sort_order = payload.sort_order
    item.is_available = payload.is_available
    item.prep_station = payload.prep_station
    item.stock_quantity = payload.stock_quantity
    item.low_stock_threshold = payload.low_stock_threshold
    item.updated_by_user_id = actor_id
    if payload.modifier_group_ids is not None:
        groups = db.session.execute(
            sa.select(CafeModifierGroup).where(CafeModifierGroup.id.in_(payload.modifier_group_ids))
        ).scalars().all()
        item.modifier_groups = list(groups)
    db.session.flush()
    _cafe_audit(actor_user_id=actor_id, action="update", entity_type="cafe_item", entity_id=str(item.id))
    return item


def toggle_item_availability(item_id: uuid.UUID, *, actor_id: uuid.UUID | None = None) -> CafeItem:
    item = db.session.get(CafeItem, item_id)
    if not item:
        raise ValueError("Item not found")
    item.is_available = not item.is_available
    item.updated_by_user_id = actor_id
    db.session.flush()
    _cafe_audit(
        actor_user_id=actor_id,
        action="toggle_availability",
        entity_type="cafe_item",
        entity_id=str(item.id),
        details={"is_available": item.is_available},
    )
    return item


# ---------------------------------------------------------------------------
# Modifier group CRUD
# ---------------------------------------------------------------------------

@dataclass
class ModifierGroupPayload:
    name: str
    sort_order: int = 0
    is_required: bool = False
    max_selections: int = 1


@dataclass
class ModifierPayload:
    name: str
    price_delta: int = 0
    sort_order: int = 0
    is_active: bool = True


def create_modifier_group(
    payload: ModifierGroupPayload,
    modifiers: list[ModifierPayload] | None = None,
    *,
    actor_id: uuid.UUID | None = None,
) -> CafeModifierGroup:
    group = CafeModifierGroup(
        name=payload.name,
        sort_order=payload.sort_order,
        is_required=payload.is_required,
        max_selections=payload.max_selections,
        created_by_user_id=actor_id,
        updated_by_user_id=actor_id,
    )
    db.session.add(group)
    db.session.flush()
    for mp in (modifiers or []):
        mod = CafeModifier(
            group_id=group.id,
            name=mp.name,
            price_delta=mp.price_delta,
            sort_order=mp.sort_order,
            is_active=mp.is_active,
            created_by_user_id=actor_id,
            updated_by_user_id=actor_id,
        )
        db.session.add(mod)
    db.session.flush()
    return group


# ---------------------------------------------------------------------------
# Order management
# ---------------------------------------------------------------------------

@dataclass
class OrderItemPayload:
    item_id: uuid.UUID
    quantity: int = 1
    notes: str = ""
    modifier_ids: list[uuid.UUID] = field(default_factory=list)


@dataclass
class CreateOrderPayload:
    order_type: str = "dine_in"
    customer_name: str = ""
    table_label: str = ""
    items: list[OrderItemPayload] = field(default_factory=list)
    notes: str = ""


def create_order(
    payload: CreateOrderPayload,
    *,
    actor_id: uuid.UUID | None = None,
) -> CafeOrder:
    order = CafeOrder(
        order_number=_next_order_number(),
        status="open",
        order_type=payload.order_type,
        customer_name=payload.customer_name or None,
        table_label=payload.table_label or None,
        notes=payload.notes or None,
        created_by_user_id=actor_id,
        updated_by_user_id=actor_id,
    )
    # Attach to open shift if one exists
    open_shift = db.session.execute(
        sa.select(CafeShift).where(CafeShift.status == "open").order_by(CafeShift.opened_at.desc()).limit(1)
    ).scalar_one_or_none()
    if open_shift:
        order.shift_id = open_shift.id

    db.session.add(order)
    db.session.flush()

    subtotal = 0
    for oip in payload.items:
        item = db.session.get(CafeItem, oip.item_id)
        if not item:
            continue
        # Calculate modifier deltas
        modifier_objs = []
        modifier_total = 0
        if oip.modifier_ids:
            mods = db.session.execute(
                sa.select(CafeModifier).where(CafeModifier.id.in_(oip.modifier_ids))
            ).scalars().all()
            for mod in mods:
                modifier_total += mod.price_delta
                modifier_objs.append(mod)

        unit_price = item.price + modifier_total
        line_total = unit_price * oip.quantity

        order_item = CafeOrderItem(
            order_id=order.id,
            item_id=item.id,
            name=item.name,
            unit_price=unit_price,
            quantity=oip.quantity,
            line_total=line_total,
            notes=oip.notes or None,
            prep_station=item.prep_station,
            prep_status="pending",
            created_by_user_id=actor_id,
            updated_by_user_id=actor_id,
        )
        db.session.add(order_item)
        db.session.flush()

        for mod in modifier_objs:
            db.session.add(CafeOrderItemModifier(
                order_item_id=order_item.id,
                modifier_id=mod.id,
                name=mod.name,
                price_delta=mod.price_delta,
            ))

        subtotal += line_total

    order.subtotal = subtotal
    order.grand_total = subtotal - order.discount_total
    db.session.flush()

    _cafe_audit(actor_user_id=actor_id, action="create", entity_type="cafe_order", entity_id=str(order.id))
    return order


def add_item_to_order(
    order_id: uuid.UUID,
    payload: OrderItemPayload,
    *,
    actor_id: uuid.UUID | None = None,
) -> CafeOrder:
    order = db.session.get(CafeOrder, order_id)
    if not order or order.status not in ("draft", "open"):
        raise ValueError("Order not found or not editable")

    item = db.session.get(CafeItem, payload.item_id)
    if not item:
        raise ValueError("Item not found")

    modifier_objs = []
    modifier_total = 0
    if payload.modifier_ids:
        mods = db.session.execute(
            sa.select(CafeModifier).where(CafeModifier.id.in_(payload.modifier_ids))
        ).scalars().all()
        for mod in mods:
            modifier_total += mod.price_delta
            modifier_objs.append(mod)

    unit_price = item.price + modifier_total
    line_total = unit_price * payload.quantity

    order_item = CafeOrderItem(
        order_id=order.id,
        item_id=item.id,
        name=item.name,
        unit_price=unit_price,
        quantity=payload.quantity,
        line_total=line_total,
        notes=payload.notes or None,
        prep_station=item.prep_station,
        prep_status="pending",
        created_by_user_id=actor_id,
        updated_by_user_id=actor_id,
    )
    db.session.add(order_item)
    db.session.flush()

    for mod in modifier_objs:
        db.session.add(CafeOrderItemModifier(
            order_item_id=order_item.id,
            modifier_id=mod.id,
            name=mod.name,
            price_delta=mod.price_delta,
        ))

    _recalculate_order_totals(order)
    db.session.flush()
    return order


def remove_item_from_order(
    order_id: uuid.UUID,
    order_item_id: uuid.UUID,
    *,
    actor_id: uuid.UUID | None = None,
) -> CafeOrder:
    order = db.session.get(CafeOrder, order_id)
    if not order or order.status not in ("draft", "open"):
        raise ValueError("Order not found or not editable")

    oi = db.session.get(CafeOrderItem, order_item_id)
    if not oi or oi.order_id != order.id:
        raise ValueError("Order item not found")

    db.session.delete(oi)
    db.session.flush()
    _recalculate_order_totals(order)
    db.session.flush()
    return order


def _recalculate_order_totals(order: CafeOrder) -> None:
    items = db.session.execute(
        sa.select(CafeOrderItem).where(CafeOrderItem.order_id == order.id)
    ).scalars().all()
    order.subtotal = sum(oi.line_total for oi in items)
    order.grand_total = order.subtotal - order.discount_total


def send_order_to_prep(order_id: uuid.UUID, *, actor_id: uuid.UUID | None = None) -> CafeOrder:
    order = db.session.get(CafeOrder, order_id)
    if not order or order.status not in ("draft", "open"):
        raise ValueError("Order not found or not sendable")
    order.status = "sent"
    order.updated_by_user_id = actor_id
    db.session.flush()
    _cafe_audit(actor_user_id=actor_id, action="send_to_prep", entity_type="cafe_order", entity_id=str(order.id))
    return order


def cancel_order(
    order_id: uuid.UUID,
    *,
    reason: str = "",
    actor_id: uuid.UUID | None = None,
) -> CafeOrder:
    order = db.session.get(CafeOrder, order_id)
    if not order or order.status in ("cancelled", "completed", "refunded"):
        raise ValueError("Order not found or cannot be cancelled")
    order.status = "cancelled"
    order.cancelled_at = utc_now()
    order.cancelled_by_user_id = actor_id
    order.cancel_reason = reason or None
    order.updated_by_user_id = actor_id
    db.session.flush()
    _cafe_audit(
        actor_user_id=actor_id, action="cancel", entity_type="cafe_order",
        entity_id=str(order.id), details={"reason": reason},
    )
    return order


def apply_discount(
    order_id: uuid.UUID,
    *,
    discount_amount: int,
    note: str = "",
    actor_id: uuid.UUID | None = None,
) -> CafeOrder:
    order = db.session.get(CafeOrder, order_id)
    if not order or order.status in ("cancelled", "completed", "refunded", "paid"):
        raise ValueError("Order not found or not editable")
    order.discount_total = discount_amount
    order.discount_note = note or None
    order.grand_total = order.subtotal - discount_amount
    if order.grand_total < 0:
        order.grand_total = 0
    order.updated_by_user_id = actor_id
    db.session.flush()
    _cafe_audit(
        actor_user_id=actor_id, action="apply_discount", entity_type="cafe_order",
        entity_id=str(order.id), details={"discount_amount": discount_amount, "note": note},
    )
    return order


# ---------------------------------------------------------------------------
# Payment
# ---------------------------------------------------------------------------

@dataclass
class PaymentPayload:
    method: str
    amount: int
    amount_received: int = 0
    reference: str = ""


def record_payment(
    order_id: uuid.UUID,
    payload: PaymentPayload,
    *,
    actor_id: uuid.UUID | None = None,
) -> CafeOrder:
    order = db.session.get(CafeOrder, order_id)
    if not order or order.status in ("cancelled", "completed", "refunded"):
        raise ValueError("Order not found or not payable")

    change = 0
    if payload.method == "cash":
        received = payload.amount_received or payload.amount
        change = max(0, received - payload.amount)
    else:
        received = payload.amount

    payment = CafePayment(
        order_id=order.id,
        method=payload.method,
        amount=payload.amount,
        amount_received=received,
        change_given=change,
        reference=payload.reference or None,
        created_by_user_id=actor_id,
        updated_by_user_id=actor_id,
    )
    db.session.add(payment)

    total_paid = db.session.execute(
        sa.select(sa.func.coalesce(sa.func.sum(CafePayment.amount), 0)).where(
            CafePayment.order_id == order.id,
            CafePayment.is_refund.is_(False),
        )
    ).scalar_one() + payload.amount

    if total_paid >= order.grand_total:
        order.status = "paid"
        order.payment_status = "paid"
        order.payment_method = payload.method
    else:
        order.payment_status = "partial"

    order.updated_by_user_id = actor_id
    db.session.flush()

    _cafe_audit(
        actor_user_id=actor_id, action="payment", entity_type="cafe_order",
        entity_id=str(order.id), details={"method": payload.method, "amount": payload.amount},
    )
    return order


def complete_order(order_id: uuid.UUID, *, actor_id: uuid.UUID | None = None) -> CafeOrder:
    order = db.session.get(CafeOrder, order_id)
    if not order or order.status not in ("paid", "sent"):
        raise ValueError("Order not found or not completable")
    order.status = "completed"
    order.completed_at = utc_now()
    order.updated_by_user_id = actor_id
    db.session.flush()
    _cafe_audit(actor_user_id=actor_id, action="complete", entity_type="cafe_order", entity_id=str(order.id))
    return order


def refund_order(
    order_id: uuid.UUID,
    *,
    reason: str = "",
    actor_id: uuid.UUID | None = None,
) -> CafeOrder:
    order = db.session.get(CafeOrder, order_id)
    if not order or order.status not in ("paid", "completed"):
        raise ValueError("Order not found or not refundable")

    refund_payment = CafePayment(
        order_id=order.id,
        method=order.payment_method or "cash",
        amount=order.grand_total,
        amount_received=0,
        change_given=0,
        is_refund=True,
        refund_reason=reason or None,
        created_by_user_id=actor_id,
        updated_by_user_id=actor_id,
    )
    db.session.add(refund_payment)
    order.status = "refunded"
    order.payment_status = "refunded"
    order.updated_by_user_id = actor_id
    db.session.flush()

    _cafe_audit(
        actor_user_id=actor_id, action="refund", entity_type="cafe_order",
        entity_id=str(order.id), details={"reason": reason, "amount": order.grand_total},
    )
    return order


# ---------------------------------------------------------------------------
# Prep board
# ---------------------------------------------------------------------------

def update_prep_status(
    order_item_id: uuid.UUID,
    new_status: str,
    *,
    actor_id: uuid.UUID | None = None,
) -> CafeOrderItem:
    oi = db.session.get(CafeOrderItem, order_item_id)
    if not oi:
        raise ValueError("Order item not found")
    oi.prep_status = new_status
    oi.updated_by_user_id = actor_id
    db.session.flush()
    return oi


def get_prep_items(*, station: str | None = None) -> list[dict]:
    """Return order items grouped for the prep board."""
    stmt = (
        sa.select(CafeOrderItem)
        .join(CafeOrder, CafeOrderItem.order_id == CafeOrder.id)
        .where(CafeOrder.status.in_(["sent", "open", "paid"]))
        .where(CafeOrderItem.prep_status.in_(["pending", "in_progress", "ready"]))
        .order_by(CafeOrderItem.created_at.asc())
    )
    if station:
        stmt = stmt.where(CafeOrderItem.prep_station == station)

    items = db.session.execute(stmt).scalars().all()
    result = []
    for oi in items:
        order = db.session.get(CafeOrder, oi.order_id)
        result.append({
            "order_item": oi,
            "order": order,
            "modifiers": list(oi.modifiers),
        })
    return result


# ---------------------------------------------------------------------------
# Order queries
# ---------------------------------------------------------------------------

def get_order(order_id: uuid.UUID) -> CafeOrder | None:
    return db.session.get(CafeOrder, order_id)


def list_orders(
    *,
    status: str | None = None,
    order_type: str | None = None,
    payment_method: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    limit: int = 100,
) -> list[CafeOrder]:
    stmt = sa.select(CafeOrder).order_by(CafeOrder.created_at.desc()).limit(limit)
    if status:
        stmt = stmt.where(CafeOrder.status == status)
    if order_type:
        stmt = stmt.where(CafeOrder.order_type == order_type)
    if payment_method:
        stmt = stmt.where(CafeOrder.payment_method == payment_method)
    if from_date:
        stmt = stmt.where(CafeOrder.created_at >= datetime.combine(from_date, datetime.min.time(), tzinfo=timezone.utc))
    if to_date:
        next_day = to_date + timedelta(days=1)
        stmt = stmt.where(CafeOrder.created_at < datetime.combine(next_day, datetime.min.time(), tzinfo=timezone.utc))
    return list(db.session.execute(stmt).scalars().all())


# ---------------------------------------------------------------------------
# Shifts
# ---------------------------------------------------------------------------

def open_shift(*, opening_cash: int = 0, actor_id: uuid.UUID | None = None) -> CafeShift:
    existing = db.session.execute(
        sa.select(CafeShift).where(CafeShift.status == "open")
    ).scalar_one_or_none()
    if existing:
        raise ValueError("A shift is already open")

    shift = CafeShift(
        status="open",
        opened_at=utc_now(),
        opening_cash=opening_cash,
        created_by_user_id=actor_id,
        updated_by_user_id=actor_id,
    )
    db.session.add(shift)
    db.session.flush()
    _cafe_audit(actor_user_id=actor_id, action="open_shift", entity_type="cafe_shift", entity_id=str(shift.id))
    return shift


def close_shift(
    shift_id: uuid.UUID,
    *,
    actual_cash: int,
    notes: str = "",
    actor_id: uuid.UUID | None = None,
) -> CafeShift:
    shift = db.session.get(CafeShift, shift_id)
    if not shift or shift.status != "open":
        raise ValueError("Shift not found or already closed")

    # Calculate expected cash from shift orders
    cash_total = db.session.execute(
        sa.select(sa.func.coalesce(sa.func.sum(CafePayment.amount), 0)).where(
            CafePayment.order_id.in_(
                sa.select(CafeOrder.id).where(CafeOrder.shift_id == shift.id)
            ),
            CafePayment.method == "cash",
            CafePayment.is_refund.is_(False),
        )
    ).scalar_one()

    shift.expected_cash = shift.opening_cash + cash_total
    shift.actual_cash = actual_cash
    shift.variance = actual_cash - shift.expected_cash
    shift.status = "closed"
    shift.closed_at = utc_now()
    shift.closed_by_user_id = actor_id
    shift.notes = notes or None
    shift.updated_by_user_id = actor_id
    db.session.flush()

    _cafe_audit(
        actor_user_id=actor_id, action="close_shift", entity_type="cafe_shift",
        entity_id=str(shift.id), details={"expected": shift.expected_cash, "actual": actual_cash, "variance": shift.variance},
    )
    return shift


def get_current_shift() -> CafeShift | None:
    return db.session.execute(
        sa.select(CafeShift).where(CafeShift.status == "open").order_by(CafeShift.opened_at.desc()).limit(1)
    ).scalar_one_or_none()


def list_shifts(*, limit: int = 30) -> list[CafeShift]:
    return list(
        db.session.execute(
            sa.select(CafeShift).order_by(CafeShift.opened_at.desc()).limit(limit)
        ).scalars().all()
    )


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

def daily_report(report_date: date | None = None) -> dict[str, Any]:
    """Generate a simple daily café report."""
    if not report_date:
        report_date = date.today()

    day_start = datetime.combine(report_date, datetime.min.time(), tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)

    base_filter = sa.and_(
        CafeOrder.created_at >= day_start,
        CafeOrder.created_at < day_end,
    )
    paid_filter = sa.and_(base_filter, CafeOrder.status.in_(["paid", "completed"]))

    total_orders = db.session.execute(
        sa.select(sa.func.count()).select_from(CafeOrder).where(base_filter)
    ).scalar_one()

    paid_orders = db.session.execute(
        sa.select(sa.func.count()).select_from(CafeOrder).where(paid_filter)
    ).scalar_one()

    total_sales = db.session.execute(
        sa.select(sa.func.coalesce(sa.func.sum(CafeOrder.grand_total), 0)).where(paid_filter)
    ).scalar_one()

    discount_total = db.session.execute(
        sa.select(sa.func.coalesce(sa.func.sum(CafeOrder.discount_total), 0)).where(paid_filter)
    ).scalar_one()

    # Sales by payment method
    by_method_rows = db.session.execute(
        sa.select(
            CafePayment.method,
            sa.func.coalesce(sa.func.sum(CafePayment.amount), 0),
        )
        .join(CafeOrder, CafePayment.order_id == CafeOrder.id)
        .where(
            CafeOrder.created_at >= day_start,
            CafeOrder.created_at < day_end,
            CafePayment.is_refund.is_(False),
        )
        .group_by(CafePayment.method)
    ).all()
    sales_by_method = {row[0]: row[1] for row in by_method_rows}

    # Sales by order type
    by_type_rows = db.session.execute(
        sa.select(
            CafeOrder.order_type,
            sa.func.coalesce(sa.func.sum(CafeOrder.grand_total), 0),
        )
        .where(paid_filter)
        .group_by(CafeOrder.order_type)
    ).all()
    sales_by_type = {row[0]: row[1] for row in by_type_rows}

    # Top selling items
    top_items = db.session.execute(
        sa.select(
            CafeOrderItem.name,
            sa.func.sum(CafeOrderItem.quantity).label("total_qty"),
            sa.func.sum(CafeOrderItem.line_total).label("total_revenue"),
        )
        .join(CafeOrder, CafeOrderItem.order_id == CafeOrder.id)
        .where(paid_filter)
        .group_by(CafeOrderItem.name)
        .order_by(sa.desc("total_qty"))
        .limit(10)
    ).all()

    # Refunds/voids
    refund_count = db.session.execute(
        sa.select(sa.func.count()).select_from(CafeOrder).where(
            base_filter, CafeOrder.status == "refunded"
        )
    ).scalar_one()
    refund_total = db.session.execute(
        sa.select(sa.func.coalesce(sa.func.sum(CafePayment.amount), 0)).where(
            CafePayment.is_refund.is_(True),
            CafePayment.order_id.in_(
                sa.select(CafeOrder.id).where(base_filter)
            ),
        )
    ).scalar_one()

    void_count = db.session.execute(
        sa.select(sa.func.count()).select_from(CafeOrder).where(
            base_filter, CafeOrder.status == "cancelled"
        )
    ).scalar_one()

    return {
        "date": report_date,
        "total_orders": total_orders,
        "paid_orders": paid_orders,
        "total_sales": total_sales,
        "discount_total": discount_total,
        "sales_by_method": sales_by_method,
        "sales_by_type": sales_by_type,
        "top_items": [
            {"name": row[0], "quantity": row[1], "revenue": row[2]}
            for row in top_items
        ],
        "refund_count": refund_count,
        "refund_total": refund_total,
        "void_count": void_count,
    }


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

def seed_cafe_defaults() -> None:
    """Seed default café categories and modifier groups if none exist."""
    if db.session.execute(sa.select(sa.func.count()).select_from(CafeCategory)).scalar_one() > 0:
        return

    categories = [
        ("Hot Coffee", "Hot coffee drinks", 1),
        ("Iced Coffee", "Iced coffee drinks", 2),
        ("Tea", "Hot and iced teas", 3),
        ("Smoothies & Blended", "Smoothies and blended drinks", 4),
        ("Bakery", "Pastries and baked goods", 5),
        ("Snacks", "Light bites and snacks", 6),
    ]
    for name, desc, sort in categories:
        db.session.add(CafeCategory(name=name, description=desc, sort_order=sort))
    db.session.flush()

    # Modifier groups
    temp_group = CafeModifierGroup(name="Temperature", sort_order=1, is_required=False, max_selections=1)
    db.session.add(temp_group)
    db.session.flush()
    for i, (name, delta) in enumerate([("Hot", 0), ("Iced", 10)]):
        db.session.add(CafeModifier(group_id=temp_group.id, name=name, price_delta=delta, sort_order=i))

    size_group = CafeModifierGroup(name="Size", sort_order=2, is_required=False, max_selections=1)
    db.session.add(size_group)
    db.session.flush()
    for i, (name, delta) in enumerate([("Regular", 0), ("Large", 20)]):
        db.session.add(CafeModifier(group_id=size_group.id, name=name, price_delta=delta, sort_order=i))

    sweet_group = CafeModifierGroup(name="Sweetness", sort_order=3, is_required=False, max_selections=1)
    db.session.add(sweet_group)
    db.session.flush()
    for i, name in enumerate(["Normal", "Less Sweet", "No Sugar"]):
        db.session.add(CafeModifier(group_id=sweet_group.id, name=name, price_delta=0, sort_order=i))

    milk_group = CafeModifierGroup(name="Milk Type", sort_order=4, is_required=False, max_selections=1)
    db.session.add(milk_group)
    db.session.flush()
    for i, (name, delta) in enumerate([("Regular Milk", 0), ("Oat Milk", 15), ("Soy Milk", 10), ("Almond Milk", 15)]):
        db.session.add(CafeModifier(group_id=milk_group.id, name=name, price_delta=delta, sort_order=i))

    extras_group = CafeModifierGroup(name="Extras", sort_order=5, is_required=False, max_selections=3)
    db.session.add(extras_group)
    db.session.flush()
    for i, (name, delta) in enumerate([("Extra Shot", 20), ("Whipped Cream", 10), ("Syrup", 10), ("No Ice", 0)]):
        db.session.add(CafeModifier(group_id=extras_group.id, name=name, price_delta=delta, sort_order=i))

    db.session.flush()
