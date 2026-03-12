from pms.normalization import clean_optional, clean_optional_text, normalize_email, normalize_phone


def test_clean_optional_trims_and_truncates():
    assert clean_optional("  hello  ", limit=4) == "hell"
    assert clean_optional("   ") is None


def test_clean_optional_text_enforces_length():
    assert clean_optional_text(" note ", limit=10) == "note"
    try:
        clean_optional_text("x" * 11, limit=10)
    except ValueError as exc:
        assert str(exc) == "Free-text input is too long."
    else:
        raise AssertionError("Expected clean_optional_text to reject oversized text.")


def test_normalize_email_and_phone_share_expected_behavior():
    assert normalize_email("  Guest@Example.COM ") == "guest@example.com"
    assert normalize_phone(" +66 80-123-4567 ") == "+66801234567"
    assert normalize_phone(" +66 80-123-4567 ", limit=5) == "+6680"
