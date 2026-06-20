import re

from crawldata.utils.text import normalize_model_text, normalize_vietnamese_text

# PRECOMPILED REGEXES
MODEL_TOKEN_RE = re.compile(r"^([a-zA-Z]+)?(\d+)(.*)$")
MODEL_SPLIT_RE = re.compile(r"[A-Z0-9]+")
DIGITS_RE = re.compile(r"\d")
LETTERS_RE = re.compile(r"[a-z]", re.IGNORECASE)
DIGITS_ONLY_RE = re.compile(r"\D")

# CONSTANTS
CONFLICTING_SUFFIXES = {
    "PLUS",
    "PRO",
    "S",
    "T",
    "SE",
    "MAX",
    "LITE",
    "EVO",
    "GOLD",
    "DELUXE",
    "PREMIUM",
    "DI",
    "DE",
    "EG",
    "EU",
    "GB",
    "GER",
    "PL",
    "PP",
    "PA",
    "PB",
    "PC",
    "C",
    "I",
    "IC",
    "ID",
    "IPLUS",
    "EGO",
    "GX",
    "EGOGX",
    "II",
    "III",
    "IF",
    "NEW",
    "HID",
    "SI",
    "IH",
    "QH",
    "LEBAR",
    "ROTE",
    "IG",
    "SL",
    "B",
    "W",
    "BU",
    "BL",
    "WH",
    "GRAY",
    "GREY",
    "QD",
    "SJ",
    "BK",
    "LAC",
    "SY",
    "G",
    "N",
    "GE",
    "MI",
    "NANO",
    "GRT",
    "GRS",
    "GRH",
    "GR",
    "UNIQUE",
    "QAM",
    "ISLAND",
    "ELITE",
    "VTC",
    "CT",
    "AW",
    "KC",
    "AT",
    "ATC",
    "GL",
    "SS",
    "BB",
    "EBN",
    "DL",
    "AU",
    "GS",
    "YA",
    "WOK",
    "RB",
    "TB",
    "HB",
    "AS",
    "DHE",
    "DIL",
    "DHP",
    "DIU",
    "DSU",
    "SU",
    "SM",
    "TFT",
    "FZ",
    "ITG",
    "IS",
    "LINEAR",
    "IN",
    "RN",
    "IRN",
    "HS",
    "SP",
    "ES",
    "TORNADO",
    "SERIAL",
}

COMMON_WORDS = {
    "BEP",
    "TU",
    "MAY",
    "HUT",
    "MUI",
    "LO",
    "VI",
    "SONG",
    "NUONG",
    "CHAU",
    "RUA",
    "CHEN",
    "BAT",
    "VOI",
    "KHOA",
    "DIEN",
    "KET",
    "SAT",
    "GIAO",
    "HANG",
    "BAO",
    "HANH",
    "NAM",
    "THUONG",
    "HIEU",
    "SAN",
    "PHAM",
    "DOI",
    "CHI",
    "HTTPS",
    "HTTP",
    "WWW",
    "COM",
    "VN",
    "NET",
    "ORG",
    "SELECT",
    "OPTION",
}

GENERIC_SUFFIXES = {
    "GB",
    "SG",
    "EU",
    "BY",
    "GER",
    "PL",
    "VN",
    "B",
    "W",
    "S",
    "G",
    "R",
    "BL",
    "WH",
    "BU",
    "BK",
    "GY",
    "SL",
    "GR",
}


def split_model_token(value: str = ""):
    normalized = normalize_model_text(value)
    match = MODEL_TOKEN_RE.match(normalized)
    if not match:
        return None
    return {
        "prefix": match.group(1) or "",
        "digits": match.group(2) or "",
        "suffix": match.group(3) or "",
    }


def matches_prefix(tokens, index, model_prefix) -> bool:
    if not model_prefix:
        return True
    if index >= len(tokens):
        return False
    token = tokens[index]
    token_parts = split_model_token(token)
    token_prefix = token_parts["prefix"] if token_parts else ""
    if token_prefix == model_prefix:
        return True

    start = max(0, index - 3)
    joined_preceding = "".join(tokens[start:index])
    if joined_preceding.endswith(model_prefix):
        return True

    if token_prefix and model_prefix.endswith(token_prefix):
        needed_preceding = model_prefix[: -len(token_prefix)]
        if joined_preceding.endswith(needed_preceding):
            return True

    return False


def get_full_prefix(tokens, index, model_digits, norm_brand) -> str:
    start = max(0, index - 4)
    preceding = tokens[start:index]
    clean_preceding = []
    for tok in preceding:
        if tok in COMMON_WORDS:
            continue
        if norm_brand and (norm_brand in tok or tok in norm_brand):
            continue
        clean_preceding.append(tok)

    token = tokens[index]
    token_parts = split_model_token(token)
    token_prefix = token_parts["prefix"] if token_parts else ""

    clean_token_prefix = ""
    if token_prefix and token_prefix not in COMMON_WORDS:
        if not norm_brand or (norm_brand not in token_prefix and token_prefix not in norm_brand):
            clean_token_prefix = token_prefix

    return "".join(clean_preceding) + clean_token_prefix


def clean_text_for_tokenizing(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"(\d+)-(\d+)", r"\1\2", str(text))


def has_conflicting_model_prefix(text: str = "", model: str = "", brand: str = "") -> bool:
    cleaned_text = clean_text_for_tokenizing(text)
    model_parts = split_model_token(model)
    if not model_parts or not model_parts["digits"]:
        return False

    norm_brand = normalize_model_text(brand) if brand else ""
    model_tokens = MODEL_SPLIT_RE.findall(normalize_vietnamese_text(model).upper())

    model_full_prefix = ""
    model_digit_idx = -1
    for idx, token in enumerate(model_tokens):
        parts = split_model_token(token)
        if parts and parts["digits"] == model_parts["digits"]:
            model_digit_idx = idx
            break

    if model_digit_idx != -1:
        model_full_prefix = get_full_prefix(model_tokens, model_digit_idx, model_parts["digits"], norm_brand)
    else:
        model_full_prefix = model_parts["prefix"]

    if not model_full_prefix:
        return False

    tokens = MODEL_SPLIT_RE.findall(normalize_vietnamese_text(cleaned_text).upper())
    for i, token in enumerate(tokens):
        token_parts = split_model_token(token)
        if not token_parts or token_parts["digits"] != model_parts["digits"]:
            continue

        text_full_prefix = get_full_prefix(tokens, i, model_parts["digits"], norm_brand)
        if text_full_prefix:
            if not text_full_prefix.endswith(model_full_prefix) and not model_full_prefix.endswith(text_full_prefix):
                return True

    return False


def has_conflicting_model_suffix(text: str = "", model: str = "", brand: str = "") -> bool:
    cleaned_text = clean_text_for_tokenizing(text)
    model_parts = split_model_token(model)
    if not model_parts or not model_parts["digits"]:
        return False
    model_full_suffix = model_parts["suffix"]

    tokens = MODEL_SPLIT_RE.findall(normalize_vietnamese_text(cleaned_text).upper())
    for i, token in enumerate(tokens):
        token_parts = split_model_token(token)
        if not token_parts or token_parts["digits"] != model_parts["digits"]:
            continue
        if not matches_prefix(tokens, i, model_parts["prefix"]):
            continue

        text_full_suffix = token_parts["suffix"]
        for j in range(i + 1, len(tokens)):
            tok = tokens[j]
            upper_model_suffix = model_full_suffix.upper()
            if tok in CONFLICTING_SUFFIXES or tok in upper_model_suffix:
                text_full_suffix += tok
            else:
                break

        s_model = model_full_suffix.lower()
        s_text = text_full_suffix.lower()

        if s_model == s_text:
            continue

        if s_model != "" and s_text != "":
            if s_model.startswith(s_text):
                extra = s_model[len(s_text) :]
                if LETTERS_RE.search(extra):
                    return True
            elif s_text.startswith(s_model):
                extra = s_text[len(s_model) :]
                if LETTERS_RE.search(extra):
                    return True
            else:
                return True
        else:
            non_empty = s_model if s_model != "" else s_text
            stripped = DIGITS_RE.sub("", non_empty).upper()

            is_allowed = False
            if len(stripped) > 0 and stripped in GENERIC_SUFFIXES:
                is_allowed = True
            elif DIGITS_RE.search(non_empty) and non_empty == s_model:
                has_important_word = any(
                    word in non_empty.upper()
                    for word in [
                        "PLUS",
                        "PRO",
                        "SE",
                        "IPLUS",
                        "MAX",
                        "LITE",
                        "EVO",
                        "S",
                        "T",
                        "EG",
                        "EGO",
                        "GX",
                        "DI",
                        "DE",
                    ]
                )
                if not has_important_word:
                    is_brand_match = (
                        brand and normalize_model_text(cleaned_text).find(normalize_model_text(brand)) != -1
                    )
                    if is_brand_match and len(model_parts["digits"]) >= 3:
                        is_allowed = True

            if not is_allowed:
                return True

    return False


def is_model_match(title_or_url: str, model: str, brand: str = "") -> bool:
    if has_conflicting_model_prefix(title_or_url, model, brand):
        return False
    norm_text = normalize_model_text(title_or_url)
    norm_model = normalize_model_text(model)
    if not norm_model:
        return False

    # 1. Exact inclusion match with digit boundary safety
    if norm_model in norm_text:
        start_idx = norm_text.find(norm_model)
        end_idx = start_idx + len(norm_model)
        prev_char = norm_text[start_idx - 1] if start_idx > 0 else ""
        next_char = norm_text[end_idx] if end_idx < len(norm_text) else ""

        is_prev_digit = bool(DIGITS_RE.match(prev_char)) and bool(DIGITS_RE.match(norm_model[0]))
        is_next_digit = bool(DIGITS_RE.match(next_char)) and bool(DIGITS_RE.match(norm_model[-1]))

        if not is_prev_digit and not is_next_digit:
            if not has_conflicting_model_suffix(title_or_url, model, brand):
                return True

    # 2. Extract digits only from model with strict digit regex boundary
    model_digits = DIGITS_ONLY_RE.sub("", norm_model)
    text_digits = DIGITS_ONLY_RE.sub("", norm_text)

    if len(model_digits) >= 3:
        digit_pattern = re.compile(rf"(?<!\d){model_digits}(?!\d)")
        if digit_pattern.search(norm_text):
            if not has_conflicting_model_suffix(title_or_url, model, brand):
                return True

    # 3. Match by individual significant segments
    segments = [normalize_model_text(s) for s in re.split(r"[\s\-_]+", str(model)) if len(normalize_model_text(s)) >= 3]
    if segments:
        longest_segment = max(segments, key=len)
        if longest_segment and longest_segment in norm_text:
            start_idx = norm_text.find(longest_segment)
            end_idx = start_idx + len(longest_segment)
            prev_char = norm_text[start_idx - 1] if start_idx > 0 else ""
            next_char = norm_text[end_idx] if end_idx < len(norm_text) else ""

            is_prev_digit = bool(DIGITS_RE.match(prev_char)) and bool(DIGITS_RE.match(longest_segment[0]))
            is_next_digit = bool(DIGITS_RE.match(next_char)) and bool(DIGITS_RE.match(longest_segment[-1]))

            if not is_prev_digit and not is_next_digit:
                if not has_conflicting_model_suffix(title_or_url, model, brand):
                    return True

    # 4. Brand-aware matching (Lenient check)
    if brand:
        norm_brand = normalize_model_text(brand)
        if norm_brand and norm_brand in norm_text:
            if has_conflicting_model_suffix(title_or_url, model, brand):
                return False
            if len(model_digits) >= 3 and len(text_digits) >= 3:
                if text_digits in model_digits:
                    return True
                prefix_len = min(4, len(model_digits), len(text_digits))
                if prefix_len >= 3:
                    if model_digits[:prefix_len] == text_digits[:prefix_len]:
                        if len(model_digits) >= len(text_digits):
                            return True

    return False
