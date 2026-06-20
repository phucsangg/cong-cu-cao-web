import re
import unicodedata

# Compile regexes once for performance
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

MM_RE = re.compile(r"\b(\d+(?:\.\d+)?)\s*mm\b", re.IGNORECASE)
M_RE = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*m\b", re.IGNORECASE)
CM_RE = re.compile(r"\b(\d+(?:\.\d+)?)\s*cm\b", re.IGNORECASE)
NON_ALPHANUM_RE = re.compile(r"[^a-zA-Z0-9]")

PARENTHESES_RE = re.compile(r"\s*\([^)]*\)\s*$")
CM_SPEC_RE = re.compile(r"[-_\s]*\d+\s*cm\b", re.IGNORECASE)
COLOR_SPEC_RE = re.compile(
    r"[-_\s]+(bạc|đen|trắng|xám|đỏ|gold|silver|black|white|grey|gray|new|inox|kính)\b", re.IGNORECASE
)

MODEL_TOKEN_RE = re.compile(r"^([a-zA-Z]+)?(\d+)(.*)$")
MODEL_SPLIT_RE = re.compile(r"[A-Z0-9]+")
DIGITS_RE = re.compile(r"\d")

PRODUCT_SLUG_RE = re.compile(r"\/(product|products|p|sp|san-pham|ct|chi-tiet|detail|item|shop|store)\/", re.IGNORECASE)
HTML_EXT_RE = re.compile(r"\.html?(?:$|[?#])", re.IGNORECASE)
NON_COMMERCIAL_HOST_RE = re.compile(
    r"(google|bing|duckduckgo|coccoc|wordpress|blogspot|medium|wikipedia|facebook|youtube|pinterest)", re.IGNORECASE
)

WHITELIST_DOMAINS = [
    "dienmayxanh.com",
    "nguyenkim.com",
    "mediamart.vn",
    "hc.com.vn",
    "dienmaycholon.vn",
    "cellphones.com.vn",
    "fptshop.com.vn",
]

CONFLICTING_SUFFIXES = {
    # Standard variations
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
    # Newly analyzed suffixes from user model list
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


def normalize_vietnamese_text(value: str = "") -> str:
    if not value:
        return ""
    # Normalize unicode to NFD and strip diacritics
    nfd_normalized = unicodedata.normalize("NFD", str(value))
    # Remove accent character range
    without_accents = "".join(c for c in nfd_normalized if not unicodedata.combining(c))
    # Normalize special characters like đ/Đ
    res = without_accents.replace("đ", "d").replace("Đ", "d")
    return res.strip().lower()


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

        # Constraint 1: Long text limit
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


def normalize_model_text(value: str = "") -> str:
    str_val = normalize_vietnamese_text(value)
    str_val = str_val.replace("+", " plus ")

    # 1. mm to cm
    def replace_mm(m):
        return f"{float(m.group(1)) / 10:.1f}cm".replace(".0cm", "cm")

    str_val = MM_RE.sub(replace_mm, str_val)

    # 2. m to cm
    def replace_m(m):
        parsed_num = float(m.group(1).replace(",", "."))
        return f"{parsed_num * 100:.1f}cm".replace(".0cm", "cm")

    str_val = M_RE.sub(replace_m, str_val)

    # 3. remove cm unit suffix
    str_val = CM_RE.sub(r"\1", str_val)

    # remove non-alphanumeric and uppercase
    return NON_ALPHANUM_RE.sub("", str_val).upper()


def clean_model_specs(model: str) -> str:
    if not model:
        return ""
    cleaned = str(model).strip()
    while True:
        previous = cleaned
        cleaned = PARENTHESES_RE.sub("", cleaned).strip()
        cleaned = CM_SPEC_RE.sub("", cleaned).strip()
        cleaned = COLOR_SPEC_RE.sub("", cleaned).strip()
        if cleaned == previous:
            break
    return cleaned


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

    # Join up to 3 preceding tokens
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
        # (?<!\d)model_digits(?!\d)
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


def get_category_keyword(sheet_name: str = "") -> str:
    name = normalize_vietnamese_text(sheet_name)
    if "giat s" in name or "say" in name:
        return "máy sấy"
    if "giat" in name:
        return "máy giặt"
    if "bep tu" in name or "bep" in name:
        return "bếp từ"
    if "hut mui" in name or "hut" in name:
        return "máy hút mùi"
    if "lo nuong" in name or "lo" in name:
        return "lò nướng"
    if "rua bat" in name or "rua chen" in name or "rua" in name:
        return "máy rửa bát"
    if "xay" in name or "blender" in name:
        return "máy xay sinh tố"
    if "loc nuoc" in name:
        return "máy lọc nước"
    return ""


def get_normalized_model_variants(model: str) -> list[str]:
    if not model:
        return []
    clean = str(model).strip()
    no_hyphen = clean.replace("-", "").replace("_", "")
    no_space = clean.replace(" ", "")
    fully_clean = NON_ALPHANUM_RE.sub("", clean)

    variants = {
        clean,
        no_hyphen,
        no_space,
        fully_clean,
        clean.lower(),
        clean.upper(),
        no_hyphen.lower(),
        no_hyphen.upper(),
        no_space.lower(),
        no_space.upper(),
        fully_clean.lower(),
        fully_clean.upper(),
    }
    return sorted(list(variants))


def generate_keywords(brand: str = "", model: str = "", sheet_name: str = "") -> list[str]:
    keywords = set()
    clean_brand = str(brand).strip() if brand else ""
    clean_model = str(model).strip() if model else ""

    if not clean_model:
        return []

    brand_model = f"{clean_brand} {clean_model}" if clean_brand else clean_model
    keywords.add(brand_model)
    keywords.add(clean_model)
    keywords.add(f'"{clean_model}"')

    if clean_brand:
        keywords.add(f"{clean_brand} {clean_model} giá")
        keywords.add(f"{clean_brand} {clean_model} khuyến mãi")
        keywords.add(f"{clean_brand} {clean_model} site:.vn")
    else:
        keywords.add(f"{clean_model} giá")
        keywords.add(f"{clean_model} site:.vn")

    category = get_category_keyword(sheet_name)
    if category:
        cap_category = category[0].upper() + category[1:]
        if clean_brand:
            keywords.add(f"{cap_category} {clean_brand} {clean_model}")
        else:
            keywords.add(f"{cap_category} {clean_model}")

    if clean_brand.lower() == "bosch":
        keywords.add(f"Bosch Series 8 {clean_model}")
        keywords.add(f"Bosch Series 6 {clean_model}")

    suffix_match = re.match(r"^(.*?\d+)([A-Z]+)$", clean_model, re.IGNORECASE)
    if suffix_match:
        base_model = suffix_match.group(1)
        brand_base = f"{clean_brand} {base_model}" if clean_brand else base_model
        keywords.add(brand_base)
        keywords.add(base_model)
        keywords.add(f'"{base_model}"')
        if clean_brand:
            keywords.add(f"{clean_brand} {base_model} giá")

    variants = get_normalized_model_variants(clean_model)
    for variant in variants:
        if variant != clean_model:
            brand_var = f"{clean_brand} {variant}" if clean_brand else variant
            keywords.add(brand_var)
            keywords.add(variant)

    return sorted(list(keywords))


def calculate_relevance_score(url: str = "", model: str = "", brand: str = "") -> int:
    if not model:
        return 0

    score = 0
    norm_url = str(url).lower()
    norm_model = normalize_model_text(model).lower()
    norm_brand = normalize_model_text(brand).lower()

    model_matched = is_model_match(url, model, brand)
    if model_matched:
        score += 150

    if norm_model and norm_model in normalize_model_text(url).lower():
        score += 40

    if norm_brand and norm_brand in normalize_model_text(url).lower():
        score += 20

    if "-" in url:
        score += 10

    if PRODUCT_SLUG_RE.search(norm_url):
        score += 10

    if HTML_EXT_RE.search(norm_url):
        score += 10

    try:
        from urllib.parse import urlparse

        host = urlparse(url).hostname.lower()
        if host:
            is_non_commercial = bool(NON_COMMERCIAL_HOST_RE.search(host))
            if not is_non_commercial:
                score += 10

            is_whitelisted = any(d in host for d in WHITELIST_DOMAINS)
            if is_whitelisted and model_matched:
                score += 100
    except Exception:
        pass

    # Negative points
    blocked_keywords = [
        "search",
        "tim-kiem",
        "collection",
        "collections",
        "category",
        "danh-muc",
        "tag",
        "tags",
        "news",
        "tin-tuc",
        "blog",
        "article",
        "gio-hang",
        "cart",
        "checkout",
    ]
    if any(k in norm_url for k in blocked_keywords):
        score -= 50

    if has_conflicting_model_suffix(url, model, brand) or has_conflicting_model_prefix(url, model, brand):
        score -= 100

    return max(0, min(300, score))


def get_percentile(arr: list[float], p: float) -> float:
    if not arr:
        return 0.0
    if len(arr) == 1:
        return arr[0]
    import math

    index = p * (len(arr) - 1)
    low = math.floor(index)
    high = math.ceil(index)
    weight = index - low
    return arr[low] * (1 - weight) + arr[high] * weight


def remove_outliers_iqr(sorted_prices: list[int]) -> dict:
    if len(sorted_prices) < 4:
        return {"filtered": list(sorted_prices), "outlierRemoved": False}
    q1 = get_percentile(sorted_prices, 0.25)
    q3 = get_percentile(sorted_prices, 0.75)
    iqr = q3 - q1
    lower_bound = q1 - 1.5 * iqr
    upper_bound = q3 + 1.5 * iqr

    filtered = [p for p in sorted_prices if lower_bound <= p <= upper_bound]
    outlier_removed = len(filtered) < len(sorted_prices)
    return {"filtered": filtered, "outlierRemoved": outlier_removed}


def get_median(arr: list[int]) -> int | None:
    if not arr:
        return None
    mid = len(arr) // 2
    if len(arr) % 2 != 0:
        return arr[mid]
    return int(round((arr[mid - 1] + arr[mid]) / 2))


def compute_suggested_pricing(list_price, cost_price, current_sale_price, prices: list = None) -> dict:
    if prices is None:
        prices = []

    parsed_prices = []
    for price in prices:
        parsed = parse_vietnamese_price(price)
        if parsed is not None and parsed > 0:
            parsed_prices.append(parsed)

    sorted_prices = sorted(parsed_prices)
    market_prices = sorted_prices[:10]

    unique_prices = sorted(list(set(parsed_prices)))

    iqr_res = remove_outliers_iqr(unique_prices)
    iqr_filtered = iqr_res["filtered"]
    iqr_removed = iqr_res["outlierRemoved"]

    min_price = iqr_filtered[0] if iqr_filtered else None
    max_price = iqr_filtered[-1] if iqr_filtered else None
    avg_price = int(round(sum(iqr_filtered) / len(iqr_filtered))) if iqr_filtered else None
    median_price = get_median(iqr_filtered)

    suggested_price = min_price

    sale_price_value = parse_vietnamese_price(current_sale_price)
    list_price_value = parse_vietnamese_price(list_price)
    cost_price_value = parse_vietnamese_price(cost_price)

    comparison_price = (
        suggested_price
        if suggested_price is not None
        else (sale_price_value if sale_price_value is not None else list_price_value)
    )

    gap_value = (
        (comparison_price - cost_price_value)
        if (comparison_price is not None and cost_price_value is not None)
        else None
    )
    gap_percent = (
        (gap_value / comparison_price)
        if (gap_value is not None and comparison_price is not None and comparison_price > 0)
        else None
    )

    return {
        "marketPrices": market_prices,
        "minPrice": min_price,
        "maxPrice": max_price,
        "avgPrice": avg_price,
        "medianPrice": median_price,
        "gapValue": gap_value,
        "gapPercent": gap_percent,
        "suggestedPrice": suggested_price,
        "outlierRemoved": iqr_removed,
    }


def find_header_index(headers: list[str], candidates: list[str]) -> int:
    for candidate in candidates:
        for index, header in enumerate(headers):
            normalized_header = normalize_vietnamese_text(header)
            normalized_candidate = normalize_vietnamese_text(candidate)

            if normalized_header == normalized_candidate:
                return index
            if normalized_header.startswith(normalized_candidate):
                return index

            if "%" in normalized_candidate and "%" not in normalized_header:
                continue
            if "%" not in normalized_candidate and "%" in normalized_header:
                continue

            clean_header = re.sub(r"[^a-z0-9]", "", normalized_header)
            clean_candidate = re.sub(r"[^a-z0-9]", "", normalized_candidate)
            if not clean_candidate:
                continue

            if clean_header == clean_candidate or clean_candidate in clean_header:
                return index
    return -1


def map_sheet_headers(headers: list[str] = None) -> dict:
    if not headers:
        raise ValueError("Khong tim thay header trong sheet.")

    mapping = {
        "productId": find_header_index(headers, ["Mã SP", "Ma SP", "Mã sản phẩm", "Ma san pham"]),
        "brand": find_header_index(headers, ["Thương hiệu", "Thuong hieu"]),
        "model": find_header_index(headers, ["Model"]),
        "listPrice": find_header_index(
            headers, ["Giá niêm yết (₫)", "Giá niêm yết (đ)", "Giá niêm yết", "Gia niem yet"]
        ),
        "costPrice": find_header_index(headers, ["Giá vốn (₫)", "Giá vốn (đ)", "Giá vốn", "Gia von"]),
        "salePrice": find_header_index(headers, ["Giá bán (₫)", "Giá bán (đ)", "Giá bán", "Gia ban"]),
        "marketColumns": [],
        "minPrice": find_header_index(headers, ["Min"]),
        "gapValue": find_header_index(headers, ["Lợi nhuận", "Loi nhuan", "GAP"]),
        "gapPercent": find_header_index(headers, ["% Lợi nhuận", "% Loi nhuan", "%GAP"]),
        "suggestedPrice": find_header_index(headers, ["Giá đề xuất", "Gia de xuat"]),
    }

    for index in range(1, 11):
        market_col = find_header_index(headers, [f"Thị trường {index}", f"Thi truong {index}"])
        if market_col != -1:
            mapping["marketColumns"].append(market_col)

    required_inputs = ["brand", "model"]
    missing_inputs = [k for k in required_inputs if mapping[k] == -1]
    if missing_inputs:
        raise ValueError(f"Thieu cot bat buoc trong sheet: {', '.join(missing_inputs)}")

    missing_outputs = []
    if not mapping["marketColumns"]:
        missing_outputs.append("Thị trường (Thị trường 1..10)")
    if mapping["minPrice"] == -1:
        missing_outputs.append("Min")
    if mapping["gapValue"] == -1:
        missing_outputs.append("Lợi nhuận (hoặc GAP)")
    if mapping["gapPercent"] == -1:
        missing_outputs.append("% Lợi nhuận (hoặc %GAP)")
    if mapping["suggestedPrice"] == -1:
        missing_outputs.append("Giá đề xuất")

    if missing_outputs:
        raise ValueError(f"Thieu cot output can thiet trong sheet: {', '.join(missing_outputs)}")

    return mapping


def build_sheet_update_row(
    market_prices: list = None,
    min_price: int = None,
    gap_value: int = None,
    gap_percent: float = None,
    suggested_price: int = None,
) -> list:
    if market_prices is None:
        market_prices = []
    market_cells = []
    for index in range(10):
        val = market_prices[index] if index < len(market_prices) else ""
        market_cells.append(val if isinstance(val, (int, float)) else "")

    return [
        *market_cells,
        min_price if min_price is not None else "",
        gap_value if gap_value is not None else "",
        gap_percent if gap_percent is not None else "",
        suggested_price if suggested_price is not None else "",
    ]


def parse_specific_rows(value: str) -> set[int] | None:
    if not value or not str(value).strip():
        return None
    res = set()
    cleaned = str(value).strip()
    parts = [p.strip() for p in cleaned.split(",")]
    for part in parts:
        if not part:
            continue
        if "-" in part:
            range_parts = [r.strip() for r in part.split("-")]
            if len(range_parts) == 2:
                try:
                    start = int(range_parts[0])
                    end = int(range_parts[1])
                    if start <= end:
                        res.update(range(start, end + 1))
                    else:
                        res.update(range(end, start + 1))
                except ValueError:
                    return None
            else:
                return None
        else:
            try:
                res.add(int(part))
            except ValueError:
                return None
    return res if res else None
