"""Café POS routes blueprint — POS, orders, prep, menu, reports, shifts."""
from __future__ import annotations

from datetime import date
from uuid import UUID

import sqlalchemy as sa
from flask import Blueprint, flash, jsonify, redirect, render_template, request, url_for

from ..extensions import db
from ..helpers import (
    can,
    current_user,
    parse_optional_date,
    parse_optional_int,
    parse_optional_uuid,
    require_any_permission,
    require_permission,
    require_user,
)
from ..models import (
    CafeCategory,
    CafeItem,
    CafeModifier,
    CafeModifierGroup,
    CafeOrder,
    CafeOrderItem,
    CafeShift,
)
from ..services.cafe_service import (
    CategoryPayload,
    CreateOrderPayload,
    ItemPayload,
    ModifierGroupPayload,
    ModifierPayload,
    OrderItemPayload,
    PaymentPayload,
    add_item_to_order,
    apply_discount,
    cancel_order,
    close_shift,
    complete_order,
    create_category,
    create_item,
    create_modifier_group,
    create_order,
    daily_report,
    get_current_shift,
    get_item_modifier_groups,
    get_order,
    get_prep_items,
    list_all_items,
    list_categories,
    list_items,
    list_modifier_groups,
    list_orders,
    list_shifts,
    open_shift,
    record_payment,
    refund_order,
    remove_item_from_order,
    seed_cafe_defaults,
    send_order_to_prep,
    toggle_item_availability,
    update_category,
    update_item,
    update_prep_status,
)

cafe_bp = Blueprint("cafe", __name__)


# ---------------------------------------------------------------------------
# POS screen
# ---------------------------------------------------------------------------

@cafe_bp.route("/cafe")
@cafe_bp.route("/cafe/pos")
def cafe_pos():
    user = require_permission("cafe.access")
    categories = list_categories()
    # Get first category items by default, or all if none selected
    selected_cat_id = request.args.get("category")
    if selected_cat_id:
        try:
            items = list_items(category_id=UUID(selected_cat_id))
        except (ValueError, AttributeError):
            items = list_items()
    elif categories:
        items = list_items(category_id=categories[0].id)
    else:
        items = list_items()

    modifier_groups = list_modifier_groups()
    current_shift = get_current_shift()
    return render_template(
        "cafe_pos.html",
        categories=categories,
        items=items,
        modifier_groups=modifier_groups,
        selected_category_id=selected_cat_id,
        current_shift=current_shift,
    )


@cafe_bp.route("/cafe/api/items")
def cafe_api_items():
    """JSON endpoint for fetching items by category (for AJAX)."""
    require_permission("cafe.access")
    cat_id = request.args.get("category_id")
    if cat_id:
        try:
            items = list_items(category_id=UUID(cat_id))
        except (ValueError, AttributeError):
            items = list_items()
    else:
        items = list_items()

    return jsonify([
        {
            "id": str(item.id),
            "name": item.name,
            "price": item.price,
            "category_id": str(item.category_id),
            "prep_station": item.prep_station,
            "is_available": item.is_available,
        }
        for item in items
    ])


@cafe_bp.route("/cafe/api/item/<uuid:item_id>/modifiers")
def cafe_api_item_modifiers(item_id):
    """JSON endpoint for fetching modifier groups for an item."""
    require_permission("cafe.access")
    groups = get_item_modifier_groups(item_id)
    result = []
    for grp in groups:
        result.append({
            "id": str(grp.id),
            "name": grp.name,
            "is_required": grp.is_required,
            "max_selections": grp.max_selections,
            "modifiers": [
                {
                    "id": str(m.id),
                    "name": m.name,
                    "price_delta": m.price_delta,
                    "is_active": m.is_active,
                }
                for m in grp.modifiers if m.is_active
            ],
        })
    return jsonify(result)


# ---------------------------------------------------------------------------
# Order creation and management
# ---------------------------------------------------------------------------

@cafe_bp.route("/cafe/order/create", methods=["POST"])
def cafe_order_create():
    user = require_permission("cafe.pos.use")
    order_type = request.form.get("order_type", "dine_in")
    customer_name = request.form.get("customer_name", "")
    table_label = request.form.get("table_label", "")
    notes = request.form.get("notes", "")

    # Parse items from form
    item_ids = request.form.getlist("item_id")
    item_quantities = request.form.getlist("item_quantity")
    item_notes_list = request.form.getlist("item_notes")
    item_modifiers = request.form.getlist("item_modifiers")  # comma-separated modifier IDs per item

    order_items = []
    for i, item_id in enumerate(item_ids):
        qty = int(item_quantities[i]) if i < len(item_quantities) else 1
        inotes = item_notes_list[i] if i < len(item_notes_list) else ""
        mod_ids = []
        if i < len(item_modifiers) and item_modifiers[i]:
            mod_ids = [UUID(mid.strip()) for mid in item_modifiers[i].split(",") if mid.strip()]
        order_items.append(OrderItemPayload(
            item_id=UUID(item_id),
            quantity=qty,
            notes=inotes,
            modifier_ids=mod_ids,
        ))

    payload = CreateOrderPayload(
        order_type=order_type,
        customer_name=customer_name,
        table_label=table_label,
        items=order_items,
        notes=notes,
    )

    order = create_order(payload, actor_id=user.id)
    db.session.commit()
    return redirect(url_for("cafe.cafe_order_detail", order_id=order.id))


@cafe_bp.route("/cafe/order/<uuid:order_id>")
def cafe_order_detail(order_id):
    user = require_permission("cafe.orders.view")
    order = get_order(order_id)
    if not order:
        flash("Order not found.", "error")
        return redirect(url_for("cafe.cafe_orders"))
    return render_template("cafe_order_detail.html", order=order)


@cafe_bp.route("/cafe/order/<uuid:order_id>/send", methods=["POST"])
def cafe_order_send(order_id):
    user = require_permission("cafe.pos.use")
    try:
        send_order_to_prep(order_id, actor_id=user.id)
        db.session.commit()
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("cafe.cafe_order_detail", order_id=order_id))


@cafe_bp.route("/cafe/order/<uuid:order_id>/cancel", methods=["POST"])
def cafe_order_cancel(order_id):
    user = require_any_permission("cafe.orders.edit", "cafe.refund.approve")
    reason = request.form.get("reason", "")
    try:
        cancel_order(order_id, reason=reason, actor_id=user.id)
        db.session.commit()
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("cafe.cafe_order_detail", order_id=order_id))


@cafe_bp.route("/cafe/order/<uuid:order_id>/discount", methods=["POST"])
def cafe_order_discount(order_id):
    user = require_permission("cafe.discount.approve")
    try:
        amount = int(request.form.get("discount_amount", "0"))
        note = request.form.get("discount_note", "")
        apply_discount(order_id, discount_amount=amount, note=note, actor_id=user.id)
        db.session.commit()
    except (ValueError, TypeError) as exc:
        flash(str(exc), "error")
    return redirect(url_for("cafe.cafe_order_detail", order_id=order_id))


@cafe_bp.route("/cafe/order/<uuid:order_id>/complete", methods=["POST"])
def cafe_order_complete(order_id):
    user = require_permission("cafe.pos.use")
    try:
        complete_order(order_id, actor_id=user.id)
        db.session.commit()
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("cafe.cafe_order_detail", order_id=order_id))


@cafe_bp.route("/cafe/order/<uuid:order_id>/refund", methods=["POST"])
def cafe_order_refund(order_id):
    user = require_permission("cafe.refund.approve")
    reason = request.form.get("reason", "")
    try:
        refund_order(order_id, reason=reason, actor_id=user.id)
        db.session.commit()
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("cafe.cafe_order_detail", order_id=order_id))


# ---------------------------------------------------------------------------
# Payment
# ---------------------------------------------------------------------------

@cafe_bp.route("/cafe/order/<uuid:order_id>/pay", methods=["GET", "POST"])
def cafe_order_pay(order_id):
    user = require_permission("cafe.payments.take")
    order = get_order(order_id)
    if not order:
        flash("Order not found.", "error")
        return redirect(url_for("cafe.cafe_orders"))

    if request.method == "POST":
        method = request.form.get("payment_method", "cash")
        amount = int(request.form.get("amount", str(order.grand_total)))
        received = int(request.form.get("amount_received", str(amount)))
        reference = request.form.get("reference", "")

        payload = PaymentPayload(
            method=method,
            amount=amount,
            amount_received=received,
            reference=reference,
        )
        try:
            record_payment(order_id, payload, actor_id=user.id)
            db.session.commit()
            return redirect(url_for("cafe.cafe_order_receipt", order_id=order_id))
        except ValueError as exc:
            flash(str(exc), "error")

    return render_template("cafe_payment.html", order=order)


@cafe_bp.route("/cafe/order/<uuid:order_id>/receipt")
def cafe_order_receipt(order_id):
    user = require_permission("cafe.orders.view")
    order = get_order(order_id)
    if not order:
        flash("Order not found.", "error")
        return redirect(url_for("cafe.cafe_orders"))
    return render_template("cafe_receipt.html", order=order)


# ---------------------------------------------------------------------------
# Orders list
# ---------------------------------------------------------------------------

@cafe_bp.route("/cafe/orders")
def cafe_orders():
    user = require_permission("cafe.orders.view")
    status = request.args.get("status")
    order_type = request.args.get("order_type")
    payment_method = request.args.get("payment_method")
    from_date = parse_optional_date(request.args.get("from_date"))
    to_date = parse_optional_date(request.args.get("to_date"))

    if not from_date:
        from_date = date.today()
    if not to_date:
        to_date = date.today()

    orders = list_orders(
        status=status,
        order_type=order_type,
        payment_method=payment_method,
        from_date=from_date,
        to_date=to_date,
    )
    return render_template(
        "cafe_orders.html",
        orders=orders,
        filter_status=status,
        filter_order_type=order_type,
        filter_payment_method=payment_method,
        filter_from_date=from_date,
        filter_to_date=to_date,
    )


# ---------------------------------------------------------------------------
# Prep / kitchen board
# ---------------------------------------------------------------------------

@cafe_bp.route("/cafe/prep")
def cafe_prep():
    user = require_permission("cafe.access")
    station = request.args.get("station")
    prep_items = get_prep_items(station=station)
    return render_template("cafe_prep.html", prep_items=prep_items, selected_station=station)


@cafe_bp.route("/cafe/prep/<uuid:order_item_id>/status", methods=["POST"])
def cafe_prep_update(order_item_id):
    user = require_permission("cafe.pos.use")
    new_status = request.form.get("prep_status", "in_progress")
    try:
        update_prep_status(order_item_id, new_status, actor_id=user.id)
        db.session.commit()
    except ValueError as exc:
        flash(str(exc), "error")

    # Return to prep board
    station = request.form.get("station", "")
    if station:
        return redirect(url_for("cafe.cafe_prep", station=station))
    return redirect(url_for("cafe.cafe_prep"))


# ---------------------------------------------------------------------------
# Menu management
# ---------------------------------------------------------------------------

@cafe_bp.route("/cafe/menu")
def cafe_menu():
    user = require_permission("cafe.menu.manage")
    categories = list_categories(active_only=False)
    items = list_all_items()
    modifier_groups = list_modifier_groups()
    return render_template(
        "cafe_menu.html",
        categories=categories,
        items=items,
        modifier_groups=modifier_groups,
    )


@cafe_bp.route("/cafe/menu/category/new", methods=["GET", "POST"])
def cafe_menu_category_new():
    user = require_permission("cafe.menu.manage")
    if request.method == "POST":
        payload = CategoryPayload(
            name=request.form.get("name", "").strip(),
            description=request.form.get("description", "").strip(),
            sort_order=int(request.form.get("sort_order", "0")),
            is_active=request.form.get("is_active") == "on",
        )
        create_category(payload, actor_id=user.id)
        db.session.commit()
        flash("Category created.", "success")
        return redirect(url_for("cafe.cafe_menu"))
    return render_template("cafe_menu_category_form.html", category=None)


@cafe_bp.route("/cafe/menu/category/<uuid:cat_id>/edit", methods=["GET", "POST"])
def cafe_menu_category_edit(cat_id):
    user = require_permission("cafe.menu.manage")
    category = db.session.get(CafeCategory, cat_id)
    if not category:
        flash("Category not found.", "error")
        return redirect(url_for("cafe.cafe_menu"))
    if request.method == "POST":
        payload = CategoryPayload(
            name=request.form.get("name", "").strip(),
            description=request.form.get("description", "").strip(),
            sort_order=int(request.form.get("sort_order", "0")),
            is_active=request.form.get("is_active") == "on",
        )
        update_category(cat_id, payload, actor_id=user.id)
        db.session.commit()
        flash("Category updated.", "success")
        return redirect(url_for("cafe.cafe_menu"))
    return render_template("cafe_menu_category_form.html", category=category)


@cafe_bp.route("/cafe/menu/item/new", methods=["GET", "POST"])
def cafe_menu_item_new():
    user = require_permission("cafe.menu.manage")
    categories = list_categories(active_only=False)
    modifier_groups = list_modifier_groups()
    if request.method == "POST":
        mod_group_ids = request.form.getlist("modifier_group_ids")
        payload = ItemPayload(
            name=request.form.get("name", "").strip(),
            category_id=UUID(request.form.get("category_id")),
            price=int(request.form.get("price", "0")),
            description=request.form.get("description", "").strip(),
            sort_order=int(request.form.get("sort_order", "0")),
            is_available=request.form.get("is_available") == "on",
            prep_station=request.form.get("prep_station", "counter"),
            stock_quantity=parse_optional_int(request.form.get("stock_quantity")),
            low_stock_threshold=parse_optional_int(request.form.get("low_stock_threshold")),
            modifier_group_ids=[UUID(gid) for gid in mod_group_ids if gid],
        )
        create_item(payload, actor_id=user.id)
        db.session.commit()
        flash("Item created.", "success")
        return redirect(url_for("cafe.cafe_menu"))
    return render_template("cafe_menu_item_form.html", item=None, categories=categories, modifier_groups=modifier_groups)


@cafe_bp.route("/cafe/menu/item/<uuid:item_id>/edit", methods=["GET", "POST"])
def cafe_menu_item_edit(item_id):
    user = require_permission("cafe.menu.manage")
    item = db.session.get(CafeItem, item_id)
    if not item:
        flash("Item not found.", "error")
        return redirect(url_for("cafe.cafe_menu"))
    categories = list_categories(active_only=False)
    modifier_groups = list_modifier_groups()
    if request.method == "POST":
        mod_group_ids = request.form.getlist("modifier_group_ids")
        payload = ItemPayload(
            name=request.form.get("name", "").strip(),
            category_id=UUID(request.form.get("category_id")),
            price=int(request.form.get("price", "0")),
            description=request.form.get("description", "").strip(),
            sort_order=int(request.form.get("sort_order", "0")),
            is_available=request.form.get("is_available") == "on",
            prep_station=request.form.get("prep_station", "counter"),
            stock_quantity=parse_optional_int(request.form.get("stock_quantity")),
            low_stock_threshold=parse_optional_int(request.form.get("low_stock_threshold")),
            modifier_group_ids=[UUID(gid) for gid in mod_group_ids if gid],
        )
        update_item(item_id, payload, actor_id=user.id)
        db.session.commit()
        flash("Item updated.", "success")
        return redirect(url_for("cafe.cafe_menu"))
    return render_template("cafe_menu_item_form.html", item=item, categories=categories, modifier_groups=modifier_groups)


@cafe_bp.route("/cafe/menu/item/<uuid:item_id>/toggle", methods=["POST"])
def cafe_menu_item_toggle(item_id):
    user = require_permission("cafe.menu.manage")
    try:
        toggle_item_availability(item_id, actor_id=user.id)
        db.session.commit()
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("cafe.cafe_menu"))


# ---------------------------------------------------------------------------
# Stock / availability
# ---------------------------------------------------------------------------

@cafe_bp.route("/cafe/stock")
def cafe_stock():
    user = require_permission("cafe.stock.manage")
    items = list_all_items()
    return render_template("cafe_stock.html", items=items)


@cafe_bp.route("/cafe/stock/<uuid:item_id>/update", methods=["POST"])
def cafe_stock_update(item_id):
    user = require_permission("cafe.stock.manage")
    item = db.session.get(CafeItem, item_id)
    if not item:
        flash("Item not found.", "error")
        return redirect(url_for("cafe.cafe_stock"))

    qty = request.form.get("stock_quantity", "").strip()
    item.stock_quantity = int(qty) if qty else None
    threshold = request.form.get("low_stock_threshold", "").strip()
    item.low_stock_threshold = int(threshold) if threshold else None
    item.updated_by_user_id = user.id
    db.session.commit()
    flash(f"Stock updated for {item.name}.", "success")
    return redirect(url_for("cafe.cafe_stock"))


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@cafe_bp.route("/cafe/reports")
def cafe_reports():
    user = require_permission("cafe.reports.view")
    report_date = parse_optional_date(request.args.get("date"))
    report = daily_report(report_date)
    return render_template("cafe_reports.html", report=report)


# ---------------------------------------------------------------------------
# Shifts
# ---------------------------------------------------------------------------

@cafe_bp.route("/cafe/shifts")
def cafe_shifts():
    user = require_permission("cafe.access")
    shifts = list_shifts()
    current = get_current_shift()
    return render_template("cafe_shifts.html", shifts=shifts, current_shift=current)


@cafe_bp.route("/cafe/shift/open", methods=["POST"])
def cafe_shift_open():
    user = require_permission("cafe.pos.use")
    opening_cash = int(request.form.get("opening_cash", "0"))
    try:
        open_shift(opening_cash=opening_cash, actor_id=user.id)
        db.session.commit()
        flash("Shift opened.", "success")
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("cafe.cafe_shifts"))


@cafe_bp.route("/cafe/shift/<uuid:shift_id>/close", methods=["POST"])
def cafe_shift_close(shift_id):
    user = require_any_permission("cafe.settings.manage", "cafe.reports.view")
    actual_cash = int(request.form.get("actual_cash", "0"))
    notes = request.form.get("notes", "")
    try:
        close_shift(shift_id, actual_cash=actual_cash, notes=notes, actor_id=user.id)
        db.session.commit()
        flash("Shift closed.", "success")
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("cafe.cafe_shifts"))


# ---------------------------------------------------------------------------
# Setup / seed
# ---------------------------------------------------------------------------

@cafe_bp.route("/cafe/setup", methods=["POST"])
def cafe_setup():
    user = require_permission("cafe.settings.manage")
    seed_cafe_defaults()
    db.session.commit()
    flash("Default café menu seeded.", "success")
    return redirect(url_for("cafe.cafe_menu"))
