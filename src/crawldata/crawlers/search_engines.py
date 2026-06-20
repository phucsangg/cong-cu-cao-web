import asyncio
import base64
import random
import re
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

import httpx
from bs4 import BeautifulSoup
from crawldata.cache.store import pricing_cache
from crawldata.crawlers.fetcher import (
    fetch_html,
    get_random_desktop_ua,
    get_random_opera_mini_ua,
)
from crawldata.pricing.keyword_generator import generate_keywords
from crawldata.pricing.model_matching import has_conflicting_model_suffix
from crawldata.utils.text import normalize_model_text

# Global engine block state
engine_blocked_until = {
    "google": 0.0,
    "bing": 0.0,
    "ddg": 0.0,
    "coccoc": 0.0,
}

_google_semaphore = asyncio.Semaphore(1)
_bing_semaphore = asyncio.Semaphore(1)
_ddg_semaphore = asyncio.Semaphore(2)
_coccoc_semaphore = asyncio.Semaphore(2)

_active_searches: dict[str, asyncio.Task] = {}
_active_searches_lock = asyncio.Lock()


def decode_bing_redirect(bing_url: str) -> str:
    try:
        parsed = urlparse(bing_url)
        if "bing.com" in parsed.hostname and parsed.path == "/ck/a":
            qs = parse_qs(parsed.query)
            u = qs.get("u")
            if u:
                base64_part = u[0]
                if base64_part.startswith("a1"):
                    base64_part = base64_part[2:]
                elif base64_part.startswith("a"):
                    base64_part = base64_part[1:]
                padding = (4 - (len(base64_part) % 4)) % 4
                padded = base64_part + "=" * padding
                normalized_b64 = padded.replace("-", "+").replace("_", "/")
                decoded = base64.b64decode(normalized_b64).decode("utf-8")
                if decoded.startswith("http"):
                    return decoded
    except Exception:
        pass
    return bing_url


def normalize_search_href(href: str) -> str | None:
    if not href:
        return None
    if href.startswith("/url?"):
        try:
            parsed = urlparse("https://www.google.com" + href)
            qs = parse_qs(parsed.query)
            q = qs.get("q")
            if q:
                return q[0]
        except Exception:
            return None
    if href.startswith("http://") or href.startswith("https://"):
        if "bing.com/ck/a" in href:
            return decode_bing_redirect(href)
        return href
    return None


def is_likely_product_detail_url(url: str = "", model: str = "", brand: str = "") -> bool:
    normalized = str(url).lower()
    if not normalized.startswith("http"):
        return False

    if any(
        kw in normalized
        for kw in [
            "google.com",
            "google.com.vn",
            "duckduckgo.com",
            "bing.com",
            "coccoc.com",
            "bepngocbao.vn",
            "websosanh.vn",
        ]
    ):
        return False

    blocked_terms = [
        "/search",
        "/collections",
        "/collection",
        "/category",
        "/categories",
        "/danh-muc",
        "/tag/",
        "/tags/",
        "/blogs/",
        "/blog/",
        "/tin-tuc",
        "/news/",
        "?q=",
        "&q=",
        "/gioi-thieu",
        "/about",
        "/lien-he",
        "/contact",
        "/huong-dan",
        "/huong_dan",
        "/thu-vien",
        "/thuvien",
        "/review",
        "/danh-gia",
        "/danh_gia",
        "/kinh-nghiem",
        "/kinh_nghiem",
        "/bai-viet",
        "/bai_viet",
        "/article",
        "/cau-hoi",
        "/cau_hoi",
        "/chinh-sach",
        "/tuyen-dung",
        "/tuyen_dung",
        "/gio-hang",
        "/cart",
        "/checkout",
        "/payment",
        "/agency",
        "/dai-ly",
        "/he-thong-cua-hang",
        "/store-locator",
        "/tin-khuyen-mai",
        "/khuyen-mai",
        "/khuyen_mai",
        "/uu-dai",
        "/dieu-khoan",
        "/terms-of-use",
        "/privacy-policy",
        "/policy/",
        "/chinh-sach-",
    ]
    if any(term in normalized for term in blocked_terms):
        return False

    if model:
        if has_conflicting_model_suffix(url, model, brand):
            return False

        norm_model = normalize_model_text(model)
        norm_url = normalize_model_text(url)
        if norm_model and norm_model in norm_url:
            return True

        model_digits = "".join(c for c in norm_model if c.isdigit())
        if len(model_digits) >= 4 and model_digits in norm_url:
            return True

        if brand:
            norm_brand = normalize_model_text(brand)
            if norm_brand and norm_brand in norm_url:
                if len(model_digits) >= 3:
                    prefix_len = min(4, len(model_digits))
                    if model_digits[:prefix_len] in norm_url:
                        return True
                if any(
                    k in normalized
                    for k in [
                        "/product/",
                        "/products/",
                        "/p/",
                        "/sp/",
                        "/san-pham/",
                        "/detail/",
                        "/item/",
                        "/shop/",
                        "/store/",
                    ]
                ):
                    return True

        tokens = [t for t in re.findall(r"[a-zA-Z]+|\d+", model) if len(t) >= 3]
        has_token_match = any(normalize_model_text(t) in norm_url for t in tokens)
        if has_token_match:
            try:
                parsed_url = urlparse(url)
                path_segments = [s for s in parsed_url.path.split("/") if s]
                if path_segments:
                    last_segment = path_segments[-1]
                    has_hyphens = "-" in last_segment
                    has_product_keyword = any(
                        k in normalized
                        for k in ["/product/", "/products/", "/p/", "/sp/", "/san-pham/", "/detail/", "/item/"]
                    )
                    has_html_ext = ".html" in normalized or ".htm" in normalized
                    if has_product_keyword or has_html_ext or has_hyphens:
                        return True
            except Exception:
                pass
        return False

    try:
        parsed_url = urlparse(url)
        path_segments = [s for s in parsed_url.path.split("/") if s]
        if not path_segments:
            return False
        last_segment = path_segments[-1]
        has_hyphens = "-" in last_segment
        has_product_keyword = any(
            k in normalized for k in ["/product/", "/products/", "/p/", "/sp/", "/san-pham/", "/detail/", "/item/"]
        )
        has_html_ext = ".html" in normalized or ".htm" in normalized
        return has_product_keyword or has_html_ext or has_hyphens
    except Exception:
        return False


async def get_cached_search_links(engine: str, q: str, fetcher_fn: Callable[[str], Any]) -> list[str]:
    cache_key = f"{engine}:{q}"
    cached = pricing_cache.get("keywords", cache_key, 24)
    if cached is not None:
        return cached
    urls = await fetcher_fn(q)
    if urls:
        pricing_cache.set("keywords", cache_key, urls)
    return urls or []


async def search_product_links(
    brand: str, model: str, limit: int = 20, sheet_name: str = "", source_map: dict[str, str] = None
) -> list[str]:
    cached_result = pricing_cache.get_search_result(brand, model)
    if cached_result is not None:
        if source_map is not None:
            for url in cached_result:
                source_map[url] = "Cache"
        return cached_result

    key = f"{brand}:{model}"
    async with _active_searches_lock:
        if key in _active_searches:
            task = _active_searches[key]
        else:
            task = asyncio.create_task(_perform_search_product_links(brand, model, limit, sheet_name))
            _active_searches[key] = task

    try:
        urls = await task
        if source_map is not None:
            for url in urls:
                if url not in source_map:
                    source_map[url] = "Search Engine"
        return urls
    finally:
        async with _active_searches_lock:
            if key in _active_searches and _active_searches[key] == task:
                _active_searches.pop(key, None)


async def _perform_search_product_links(brand: str, model: str, limit: int = 20, sheet_name: str = "") -> list[str]:
    clean_brand = str(brand).strip()
    clean_model = str(model).strip()
    brand_model = f"{clean_brand} {clean_model}" if clean_brand else clean_model

    # Define progressive keywords
    step1_kws = (
        [brand_model, f"{brand_model} giá", f"{brand_model} khuyến mãi", f"{brand_model} site:.vn"]
        if clean_brand
        else [clean_model, f"{clean_model} giá", f"{clean_model} site:.vn"]
    )
    step2_kws = (
        [clean_model, f'"{clean_model}"', f"{clean_model} giá", f"{clean_model} site:.vn"] if clean_brand else []
    )
    all_kws = generate_keywords(brand, model, sheet_name)
    step3_kws = [k for k in all_kws if k not in step1_kws and k not in step2_kws]

    steps = [step1_kws, step2_kws, step3_kws]
    steps = [s for s in steps if s]

    engines = ["google", "bing", "ddg", "coccoc"]
    accumulated_links = []
    seen = set()

    def add_links(new_links):
        for link_url in new_links:
            if link_url and link_url not in seen:
                seen.add(link_url)
                accumulated_links.append(link_url)

    def has_enough_urls() -> bool:
        count = sum(1 for url in accumulated_links if is_likely_product_detail_url(url, model, brand))
        return count >= 5

    async def fetch_google(query_val):
        urls = []
        google_pages = [0, 40]
        for start in google_pages:
            detail_count = sum(1 for u in urls if is_likely_product_detail_url(u, model, brand))
            if start > 0 and detail_count >= 5:
                break
            try:
                google_url = f"https://www.google.com/search?hl=vi&num=40&start={start}&q={quote(query_val)}"
                html_text = await fetch_html(
                    google_url,
                    timeout=4.0,
                    user_agent=get_random_opera_mini_ua(),
                    retries=0,
                )
                if "google.com/recaptcha" in html_text or "detected unusual traffic" in html_text:
                    engine_blocked_until["google"] = (time.time() * 1000) + 10 * 60 * 1000
                    break
                soup = BeautifulSoup(html_text, "html.parser")
                count_page = 0
                for a in soup.find_all("a", href=True):
                    href_val = a["href"]
                    norm_url = normalize_search_href(href_val)
                    if norm_url and norm_url.startswith("http"):
                        urls.append(norm_url)
                        count_page += 1
                if count_page < 5:
                    break
                await asyncio.sleep(0.3)
            except Exception as err:
                err_str = str(err)
                if "429" in err_str or "403" in err_str:
                    engine_blocked_until["google"] = (time.time() * 1000) + 10 * 60 * 1000
                break
        return urls

    async def fetch_bing(query_val):
        urls = []
        bing_pages = [1, 51]
        for first in bing_pages:
            detail_count = sum(1 for u in urls if is_likely_product_detail_url(u, model, brand))
            if first > 1 and detail_count >= 5:
                break
            try:
                bing_url = f"https://www.bing.com/search?q={quote(query_val)}&count=50&first={first}"
                html_text = await fetch_html(
                    bing_url,
                    timeout=4.0,
                    user_agent=get_random_desktop_ua(),
                    retries=0,
                )
                if "detected unusual traffic" in html_text:
                    engine_blocked_until["bing"] = (time.time() * 1000) + 10 * 60 * 1000
                    break
                soup = BeautifulSoup(html_text, "html.parser")
                count_page = 0
                for cite in soup.find_all("cite"):
                    txt = cite.get_text().strip()
                    if txt:
                        href = txt.split(" ")[0].strip()
                        if not href.startswith("http"):
                            href = "https://" + href
                        norm_url = normalize_search_href(href)
                        if norm_url and norm_url.startswith("http"):
                            urls.append(norm_url)
                            count_page += 1
                for h2 in soup.select("#b_results .b_algo h2 a[href]"):
                    href_val = h2["href"]
                    norm_url = normalize_search_href(href_val)
                    if norm_url and norm_url.startswith("http"):
                        urls.append(norm_url)
                        count_page += 1
                if count_page < 5:
                    break
                await asyncio.sleep(0.3)
            except Exception as err:
                err_str = str(err)
                if "429" in err_str or "403" in err_str:
                    engine_blocked_until["bing"] = (time.time() * 1000) + 10 * 60 * 1000
                break
        return urls

    async def fetch_ddg(query_val):
        urls = []
        try:
            ddg_url = f"https://html.duckduckgo.com/html/?q={quote(query_val)}"
            html_text = await fetch_html(ddg_url, timeout=4.0, user_agent=get_random_desktop_ua(), retries=0)
            soup = BeautifulSoup(html_text, "html.parser")
            for el in soup.select(".result__url"):
                href = el.get_text().strip()
                if href:
                    if not href.startswith("http"):
                        href = "https://" + href
                    norm_url = normalize_search_href(href)
                    if norm_url and norm_url.startswith("http"):
                        urls.append(norm_url)

            for el in soup.select(".result__a[href]"):
                href = el["href"]
                if href:
                    if "uddg=" in href:
                        try:
                            parsed_red = urlparse("https://duckduckgo.com" + href)
                            qs = parse_qs(parsed_red.query)
                            real_url = qs.get("uddg")
                            if real_url:
                                urls.append(real_url[0])
                        except Exception:
                            pass
                    elif href.startswith("http") and "duckduckgo.com" not in href:
                        urls.append(href)
        except Exception as err:
            err_str = str(err)
            if "429" in err_str or "403" in err_str:
                engine_blocked_until["ddg"] = (time.time() * 1000) + 10 * 60 * 1000
        return urls

    async def fetch_coccoc(query_val):
        urls = []
        try:
            coccoc_url = f"https://coccoc.com/search?q={quote(query_val)}"
            html_text = await fetch_html(coccoc_url, timeout=4.0, user_agent=get_random_desktop_ua(), retries=0)
            soup = BeautifulSoup(html_text, "html.parser")
            for a in soup.find_all("a", href=True):
                href_val = a["href"]
                norm_url = normalize_search_href(href_val)
                if norm_url and norm_url.startswith("http"):
                    urls.append(norm_url)
        except Exception as err:
            err_str = str(err)
            if "429" in err_str or "403" in err_str:
                engine_blocked_until["coccoc"] = (time.time() * 1000) + 10 * 60 * 1000
        return urls

    async def run_query_on_engine(engine_name: str, query_val: str):
        if time.time() * 1000 < engine_blocked_until[engine_name]:
            return []

        if engine_name == "google":
            async with _google_semaphore:
                await asyncio.sleep(0.3 + random.random() * 0.4)
                return await get_cached_search_links("google", query_val, fetch_google)
        elif engine_name == "bing":
            async with _bing_semaphore:
                await asyncio.sleep(0.3 + random.random() * 0.4)
                return await get_cached_search_links("bing", query_val, fetch_bing)
        elif engine_name == "ddg":
            async with _ddg_semaphore:
                await asyncio.sleep(0.1 + random.random() * 0.2)
                return await get_cached_search_links("ddg", query_val, fetch_ddg)
        elif engine_name == "coccoc":
            async with _coccoc_semaphore:
                await asyncio.sleep(0.1 + random.random() * 0.2)
                return await get_cached_search_links("coccoc", query_val, fetch_coccoc)
        return []

    # Progressive keyword steps queried across engines concurrently
    for step_kws in steps:
        if has_enough_urls():
            break
        for q in step_kws:
            if has_enough_urls():
                break

            tasks = [run_query_on_engine(eng, q) for eng in engines]
            results = await asyncio.gather(*tasks)
            for engine_links in results:
                add_links(engine_links)

    if accumulated_links:
        pricing_cache.set_search_result(brand, model, accumulated_links)
    return accumulated_links
