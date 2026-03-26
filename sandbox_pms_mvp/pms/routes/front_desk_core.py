"""Shared front desk blueprint instance.

This module exists solely to hold the ``front_desk_bp`` Blueprint so that
all front-desk sub-modules can import it without circular dependencies.
"""

from __future__ import annotations

from flask import Blueprint

front_desk_bp = Blueprint("front_desk", __name__)
