import re
from urllib.parse import urlparse

from crawldata.pricing.model_matching import (
    has_conflicting_model_prefix,
    has_conflicting_model_suffix,
    is_model_match,
)
from crawldata.utils.text import normalize_model_text

# Core matching patterns
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
