"""Coupon Studio blueprint — create, edit, and print branded voucher coupons."""
from __future__ import annotations

from flask import Blueprint, render_template

from ..helpers import require_permission

coupon_studio_bp = Blueprint("coupon_studio", __name__)


@coupon_studio_bp.route("/staff/coupon-studio")
def staff_coupon_studio() -> str:
    require_permission("reports.view")
    return render_template("staff_coupon_studio.html")
