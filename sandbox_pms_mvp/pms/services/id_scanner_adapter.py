"""ID scanner adapter -- pluggable interface for document/passport scanning.

Ships with ``ManualEntryAdapter`` (no hardware, prompts manual input).
Real scanner integrations implement the ``ScannerAdapter`` protocol.

Configuration:
    ``ID_SCANNER_PROVIDER`` -- ``"manual"`` (default) or a future provider key.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol, runtime_checkable

from flask import current_app

_log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class ScannerAdapter(Protocol):
    """Interface for hardware / API-based document scanners."""

    def capture(self, source: str = "camera") -> dict[str, Any]:
        """Initiate a document capture from the given source.

        Returns a dict with at least ``{"status": ..., "message": ...}``.
        """
        ...  # pragma: no cover

    def parse_mrz(self, raw_text: str) -> dict[str, Any]:
        """Parse MRZ (Machine Readable Zone) lines from raw text.

        Returns a dict with extracted fields or ``{"status": "stub"}``.
        """
        ...  # pragma: no cover

    def extract_fields(self, document_data: dict[str, Any]) -> dict[str, Any]:
        """Extract structured guest identity fields from scanner output.

        Returns a dict with normalised fields or ``{"status": "stub"}``.
        """
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# ManualEntryAdapter (default / no-hardware fallback)
# ---------------------------------------------------------------------------


class ManualEntryAdapter:
    """No hardware -- returns empty, UI prompts manual entry."""

    def capture(self, source: str = "camera") -> dict[str, Any]:
        return {
            "status": "manual_required",
            "message": "No scanner configured. Please enter document details manually.",
        }

    def parse_mrz(self, raw_text: str) -> dict[str, Any]:
        """Basic MRZ line parser for Type 1 / Type 3 travel documents.

        Extracts surname, given names, document number, nationality and
        date of birth when the text contains two or more lines of >= 30
        characters with ``<`` separators (standard ICAO 9303 format).

        Falls back to ``{"status": "stub"}`` when the text does not look
        like valid MRZ data.
        """
        lines = [
            line.strip().replace(" ", "")
            for line in (raw_text or "").splitlines()
            if line.strip()
        ]
        mrz_lines = [line for line in lines if "<" in line and len(line) >= 30]

        if len(mrz_lines) < 2:
            return {"status": "stub", "raw": raw_text}

        first_line = mrz_lines[0]
        second_line = mrz_lines[1]

        # Extract names from the first MRZ line (after the 5-char header).
        surname_raw, _, given_raw = first_line[5:].partition("<<")
        surname = surname_raw.replace("<", " ").strip()
        given_names = given_raw.replace("<", " ").strip()

        # Extract structured fields from the second line.
        document_number = second_line[0:9].replace("<", "").strip()
        nationality = second_line[10:13].replace("<", "").strip()
        date_of_birth_raw = second_line[13:19] if len(second_line) > 18 else ""

        result: dict[str, Any] = {
            "status": "parsed",
            "surname": surname,
            "given_names": given_names,
            "document_number": document_number,
            "nationality": nationality,
            "date_of_birth_raw": date_of_birth_raw,
            "raw": raw_text,
        }
        return result

    def extract_fields(self, document_data: dict[str, Any]) -> dict[str, Any]:
        return {"status": "stub", "fields": {}}


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

_adapter_instance: ScannerAdapter | None = None


def get_scanner_adapter() -> ScannerAdapter:
    """Return the configured scanner adapter (lazily instantiated singleton).

    Reads ``ID_SCANNER_PROVIDER`` from the app config.  Currently only
    ``"manual"`` is supported; all other values fall back to
    ``ManualEntryAdapter``.
    """
    global _adapter_instance  # noqa: PLW0603
    if _adapter_instance is not None:
        return _adapter_instance

    provider = current_app.config.get("ID_SCANNER_PROVIDER", "manual")
    if provider == "manual":
        _adapter_instance = ManualEntryAdapter()
    else:
        _log.warning("Unknown ID_SCANNER_PROVIDER '%s', falling back to ManualEntryAdapter", provider)
        _adapter_instance = ManualEntryAdapter()

    return _adapter_instance


def reset_scanner_adapter() -> None:
    """Reset the adapter singleton -- useful in tests."""
    global _adapter_instance  # noqa: PLW0603
    _adapter_instance = None
