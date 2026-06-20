import re

from crawldata.utils.text import normalize_vietnamese_text

# Regexes for money/pricing checks
DECIMAL_REGEX = re.compile(r"[.,](\d{1,2})\s*(?:[₫đ]|vnd|vnđ|dong|đồng)?$", re.IGNORECASE)
DIGITS_ONLY_RE = re.compile(r"\D")
PRICE_SIGNAL_RE = re.compile(
    r"\b(gia|giá|sale|khuyen mai|khuyến mãi|special price|current price|product:price)\b", re.IGNORECASE
)
PRICE_SUFFIX_D_RE = re.compile(r"[0-9]\s*[dđ₫]\b|[0-9]\s*[dđ₫]$", re.IGNORECASE)
PRICE_SUFFIX_KTR_RE = re.compile(r"[0-9]\s*(k|tr|trieu|triệu)\b|[0-9]\s*(k|tr|trieu|triệu)$", re.IGNORECASE)
PURE_NUMBER_RE1 = re.compile(r"^\s*([+-]\s*)?[0-9]{1,3}(?:[.,\s]?[0-9]{3})*(?:[.,]\d+)?\s*$", re.IGNORECASE)
PURE_NUMBER_RE2 = re.compile(r"^\s*[0-9]+(?:[.,]\d+)?\s*$", re.IGNORECASE)

MODEL_OR_SPEC_RE = re.compile(
    r"\b(w|kw|cm|mm|hz|db|sp|sku|model|brand|nhan|hieu|dien[\s_-]*may|dienmay|dienmayxanh|chefzone|kocher|bep247)\b",
    re.IGNORECASE,
)
MODEL_PATTERN_RE = re.compile(r"[a-z]\d|\d[a-z]", re.IGNORECASE)
NUMBER_GROUPS_RE = re.compile(r"\d+(?:[.,]\d+)+|\d+")
LETTERS_RE = re.compile(r"[a-z]", re.IGNORECASE)


def parse_vietnamese_price(value) -> int | None:
    if value is None:
        return None

    parsed = None
    has_price_signal = False
    is_pure_number = False

    if isinstance(value, (int, float)):
        if value > 0:
            parsed = int(round(value))
    else:
        text = str(value).strip()
        if not text:
            return None

        if len(text) > 60:
            return None

        clean_text = text.lower()

        # Check for price signals
        has_price_signal = any(
            [
                "₫" in clean_text,
                "vnd" in clean_text,
                "vnđ" in clean_text,
                "dong" in clean_text,
                "đồng" in clean_text,
                bool(PRICE_SIGNAL_RE.search(clean_text)),
                bool(PRICE_SUFFIX_D_RE.search(clean_text)),
                bool(PRICE_SUFFIX_KTR_RE.search(clean_text)),
            ]
        )

        is_pure_number = bool(PURE_NUMBER_RE1.match(text)) or bool(PURE_NUMBER_RE2.match(text))

        if not is_pure_number and not has_price_signal:
            return None

        # Clean model specs
        clean_check = (
            text.lower()
            .replace("-", "")
            .replace("_", "")
            .replace("vnd", "")
            .replace("vnđ", "")
            .replace("dong", "")
            .replace("đồng", "")
            .replace("trieu", "")
            .replace("triệu", "")
            .replace("₫", "")
            .replace("đ", "")
            .replace("d", "")
            .replace("tr", "")
            .replace("k", "")
            .strip()
        )

        # Reject if model or spec unit pattern is found
        has_model_or_spec = bool(MODEL_PATTERN_RE.search(clean_check)) or bool(MODEL_OR_SPEC_RE.search(clean_check))
        if has_model_or_spec:
            return None

        has_letters = bool(LETTERS_RE.search(clean_check))
        num_matches = NUMBER_GROUPS_RE.findall(text)
        if has_letters and len(num_matches) > 1:
            return None

        digits_only = DIGITS_ONLY_RE.sub("", text)
        if digits_only.startswith("0") and len(digits_only) > 5:
            return None

        normalized = normalize_vietnamese_text(text).replace(" ", "")
        if "lienhe" in normalized:
            return None

        trieu_match = re.search(r"([0-9]+(?:[.,][0-9]+)?)(?:trieu|tr)\b", normalized) or re.search(
            r"([0-9]+(?:[.,][0-9]+)?)(?:trieu|tr)$", normalized
        )
        if trieu_match:
            try:
                num = float(trieu_match.group(1).replace(",", "."))
                parsed = int(round(num * 1_000_000))
            except ValueError:
                pass
        else:
            k_match = re.search(r"([0-9]+(?:[.,][0-9]+)?)k\b", normalized) or re.search(
                r"([0-9]+(?:[.,][0-9]+)?)k$", normalized
            )
            if k_match:
                try:
                    num = float(k_match.group(1).replace(",", "."))
                    parsed = int(round(num * 1000))
                except ValueError:
                    pass
            else:
                clean_val = DECIMAL_REGEX.sub("", text)
                digits = DIGITS_ONLY_RE.sub("", clean_val)
                if digits:
                    try:
                        parsed = int(digits)
                    except ValueError:
                        pass

    if parsed is not None and parsed > 0:
        if parsed < 100_000:
            if parsed < 1000 or isinstance(value, (int, float)) or has_price_signal:
                parsed *= 1000
        return parsed

    return None
