import asyncio
import copy
import json
import random
import re
from typing import Any
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, Tag
from crawldata.cache.store import pricing_cache
from crawldata.crawlers.page_verifier import verify_page_content
from crawldata.logger import logger
from crawldata.pricing.model_matching import is_model_match
from crawldata.pricing.price_parser import parse_vietnamese_price
from crawldata.utils.text import normalize_model_text, normalize_vietnamese_text
from playwright.async_api import async_playwright

JUNK_HEADING_KEYWORDS = [
    "lien quan",
    "cung loai",
    "cung muc gia",
    "cung danh muc",
    "tuong tu",
    "co the ban thich",
    "da xem",
    "tieu bieu",
    "ban chay",
    "moi nhat",
    "tin tuc",
    "bai viet",
    "chuyen muc",
    "tags",
    "binh luan",
    "nhan xet",
    "tin khuyen mai",
]

EXCLUSION_WORDS = [
    "menu",
    "sidebar",
    "footer",
    "header",
    "nav",
    "aside",
    "widget",
    "filter",
    "banner",
    "slider",
    "carousel",
    "breadcrumb",
    "search",
    "cart",
    "checkout",
    "login",
    "register",
    "auth",
    "social",
    "share",
    "comment",
    "review",
    "rating",
    "newsletter",
    "subscribe",
    "pagination",
]

LAYOUT_WORDS = ["grid", "row", "list", "layout", "content", "body", "main", "wrapper"]

TRASH_KEYWORDS = [
    "chính sách",
    "hướng dẫn",
    "tin tức",
    "liên hệ",
    "bài viết",
    "giỏ hàng",
    "tài khoản",
    "showroom",
    "tuyển dụng",
    "địa chỉ",
    "hotline",
    "góp ý",
    "bảo hành",
    "trả góp",
    "thương hiệu",
    "nổi bật",
    "cổ điển",
    "xem thêm",
    "danh mục",
    "giới thiệu",
    "đăng ký",
    "đăng nhập",
    "tin công nghệ",
    "hệ thống",
    "sơ đồ",
    "khuyến mãi",
    "khuyen mai",
    "ưu đãi",
    "uu dai",
    "nhập mã",
    "nhap ma",
    "mã giảm giá",
    "ma giam gia",
    "quà tặng",
    "qua tang",
    "thông số",
    "thong so",
    "kỹ thuật",
    "ky thuat",
    "mô tả",
    "mo ta",
    "chi tiết",
    "chi tiet",
    "đặc điểm",
    "dac diem",
]

CATEGORY_KEYWORDS = [
    "bếp",
    "bep",
    "gas",
    "ga",
    "hút mùi",
    "hut mui",
    "rửa chén",
    "rua chen",
    "rửa bát",
    "rua bat",
    "lò nướng",
    "lo nuong",
    "vi sóng",
    "vi song",
    "chậu",
    "chau",
    "vòi",
    "voi",
    "tủ lạnh",
    "tu lanh",
    "máy giặt",
    "may giat",
    "máy sấy",
    "may say",
    "nồi",
    "noi",
    "chảo",
    "chao",
    "siêu tốc",
    "sieu toc",
    "máy xay",
    "may xay",
    "máy ép",
    "may ep",
    "bàn ủi",
    "ban ui",
    "bàn là",
    "ban la",
    "hút bụi",
    "hut bui",
    "quạt",
    "quat",
    "gia dụng",
    "gia dung",
    "tủ đông",
    "tu dong",
    "lò vi sóng",
    "lo vi song",
    "chén bát",
    "chen bat",
    "chậu rửa",
    "chau rua",
    "vòi rửa",
    "voi rua",
    "âm tủ",
    "am tu",
]


def is_homepage(url: str) -> bool:
    try:
        parsed = urlparse(url)
        path = parsed.path.lower()
        return path in ["/", "", "/index.html", "/index.php", "/index.htm"]
    except Exception:
        return False


def matches_category(text: str, path: str) -> bool:
    clean_text = str(text or "").lower().strip()
    clean_path = str(path or "").lower().strip()
    return any(kw in clean_text or kw.replace(" ", "-") in clean_path for kw in CATEGORY_KEYWORDS)


def extract_category_links_bs4(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    links = set()
    try:
        hostname = urlparse(base_url).hostname
    except Exception:
        return []

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith("javascript:") or href.startswith("#"):
            continue

        try:
            absolute_url = urljoin(base_url, href)
            parsed_url = urlparse(absolute_url)
        except Exception:
            continue

        if parsed_url.hostname != hostname:
            continue

        path = parsed_url.path.lower()
        txt = a.get_text() or ""
        if not matches_category(txt, path):
            continue

        exclusions = [
            "/tin-tuc",
            "/lien-he",
            "/gioi-thieu",
            "/cart",
            "/checkout",
            "/login",
            "/register",
            "/account",
            "/search",
            "/tin-cong-nghe",
            "/chinh-sach",
            "/huong-dan",
            "/tuyen-dung",
            "/show-room",
            "/bao-hanh",
            "/tra-gop",
            "/he-thong-dai-ly",
            "/hinh-thuc-mua-hang",
            "/hinh-thuc-thanh-toan",
            "/dieu-khoan-su-dung",
            "/chinh-sach-bao-mat",
            "/chinh-sach-doi-tra",
            "/chinh-sach-giao-nhan",
            "/chinh-sach-bao-mat-thong-tin",
            "/taikhoan",
        ]
        if path in ["/", "", "/index.html", "/index.php", "/index.htm"]:
            continue
        if any(exc in path for exc in exclusions):
            continue

        links.add(parsed_url.scheme + "://" + parsed_url.netloc + parsed_url.path)

    unique_links = list(links)

    filtered_links = []
    for url in unique_links:
        try:
            p = urlparse(url).path.replace(".html", "").lower()
            has_parent = False
            for other_url in unique_links:
                if other_url == url:
                    continue
                other_p = urlparse(other_url).path.replace(".html", "").lower()
                if len(other_p) >= len(p):
                    continue
                if p.startswith(other_p + "-") or f"/{other_p}-" in p:
                    has_parent = True
                    break
            if not has_parent:
                filtered_links.append(url)
        except Exception:
            filtered_links.append(url)

    return filtered_links[:150]


def check_if_price(text: str) -> bool:
    text = text.strip().lower()
    if not text:
        return False
    numeric_only = "".join(c for c in text if c.isdigit())
    if (
        re.match(r"^0\d{9}$", numeric_only)
        or re.match(r"^1800\d{4}$", numeric_only)
        or re.match(r"^1900\d{4}$", numeric_only)
    ):
        return False
    has_currency = any(c in text for c in ["đ", "₫", "$", "vnd", "vnđ"])
    clean_text = re.sub(r"[\d.,\sđ₫$%\-]", "", text).replace("vnd", "").replace("vnđ", "")
    if len(clean_text) > 0:
        return False
    has_digit = any(c.isdigit() for c in text)
    if not has_digit:
        return False
    if has_currency:
        if re.search(r"[.,]\d$", re.sub(r"[^0-9.,]", "", text)) and "$" not in text:
            return False
        return True
    return bool(re.match(r"^\d{1,3}([.,]\d{3})+$", text))


def is_excluded(id_str: str, class_str: str) -> bool:
    i = id_str.lower()
    c = class_str.lower()
    return any(w in i or w in c for w in EXCLUSION_WORDS)


def is_layout_container(id_str: str, class_str: str, tag_name: str) -> bool:
    t = tag_name.lower()
    if t in ["body", "html", "main", "section", "article", "aside", "header", "footer"]:
        return True
    c = class_str.lower()
    i = id_str.lower()
    if "item" in c or "item" in i or "col-" in c or "col-" in i:
        return False
    return any(w in c or w in i for w in LAYOUT_WORDS)


def get_price_text(soup: BeautifulSoup, el: Tag) -> str:
    clone = copy.copy(el)
    for child in clone.select(".line, .old, .del, del, s"):
        child.decompose()
    for child in clone.find_all(style=True):
        style = child.get("style", "")
        if "line-through" in style:
            child.decompose()
    txt = clone.get_text()
    return txt.strip() if txt else ""


def is_original_price_el(soup: BeautifulSoup, el: Tag) -> bool:
    class_str = " ".join(el.get("class", []))
    tag_name = el.name.lower()
    style = el.get("style", "")
    if any(w in class_str for w in ["line", "old", "del"]) or tag_name in ["del", "s"] or "line-through" in style:
        return True
    return False


def get_dom_distance(node_a: Tag, node_b: Tag) -> int:
    path_a = []
    curr_a = node_a
    while curr_a:
        path_a.append(curr_a)
        curr_a = curr_a.parent

    path_b = []
    curr_b = node_b
    while curr_b:
        path_b.append(curr_b)
        curr_b = curr_b.parent

    for i, a_node in enumerate(path_a):
        if a_node in path_b:
            j = path_b.index(a_node)
            return i + j
    return 999999


def run_cheerio_scrape_bs4(html: str, url: str, page_num: int, log_fn=logger.info) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    results = []

    # 1. Process script-based prices (productSaleSetup)
    script_count = 0
    for script in soup.find_all("script"):
        script_text = script.string
        if script_text and "productSaleSetup" in script_text:
            price_text = ""
            match = re.search(
                r"productSaleSetup\s*\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'([^']*)'",
                script_text,
            )
            if match:
                try:
                    num_price = int(match.group(1))
                    if num_price > 0:
                        price_text = f"{num_price:,} ₫".replace(",", ".")
                except ValueError:
                    pass

            if not price_text:
                continue

            parent = script.parent
            for step in range(5):
                if not parent or isinstance(parent, BeautifulSoup):
                    break
                id_p = parent.get("id", "") or ""
                class_p = " ".join(parent.get("class", [])) or ""
                tag_p = parent.name or ""
                if is_excluded(id_p, class_p) or is_layout_container(id_p, class_p, tag_p):
                    break

                target_titles = parent.find_all(
                    ["h1", "h2", "h3", "h4", "h5", "h6", "a"],
                    class_=lambda c: c and any(w in str(c).lower() for w in ["title", "name"]),
                ) + parent.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "a"])

                candidates = []
                for node in target_titles:
                    txt = node.get_text()
                    txt = re.sub(r"\s+", " ", txt).strip() if txt else ""
                    if txt and 8 <= len(txt) < 150 and not check_if_price(txt):
                        is_rac = any(x in txt.lower() for x in TRASH_KEYWORDS)
                        if not is_rac:
                            dist = get_dom_distance(script, node)
                            candidates.append({"node": node, "text": txt, "dist": dist})

                title_text = ""
                title_href = ""
                if candidates:
                    candidates.sort(key=lambda x: x["dist"])
                    best = candidates[0]
                    title_text = best["text"]
                    nl = best["node"]
                    for d in range(3):
                        if nl and nl.name == "a":
                            title_href = nl.get("href", "")
                            break
                        if nl:
                            nl = nl.parent

                if title_text and not title_href:
                    links = parent.find_all("a")
                    best_link = None
                    min_link_dist = 999999
                    for link in links:
                        href = link.get("href", "")
                        if href and len(href) > 2 and not href.startswith("#") and not href.startswith("javascript:"):
                            dist = get_dom_distance(script, link)
                            if dist < min_link_dist:
                                min_link_dist = dist
                                best_link = href
                    title_href = best_link or ""

                if title_text:
                    results.append(
                        {
                            "ten": title_text,
                            "gia": price_text,
                            "trang": page_num,
                            "link": urljoin(url, title_href) if title_href else "",
                            "anh": "",
                            "isOriginal": False,
                        }
                    )
                    script_count += 1
                    break
                parent = parent.parent

    if script_count > 0:
        log_fn(f"Đã phát hiện và giải mã {script_count} sản phẩm từ script-price (ví dụ: productSaleSetup).")

    # 2. Process text-based prices
    all_elements = soup.find_all()
    price_nodes = []
    for el in all_elements:
        if not isinstance(el, Tag):
            continue
        text = get_price_text(soup, el)
        if not check_if_price(text):
            continue
        children = [c for c in el.children if isinstance(c, Tag)]
        children_with_price = [c for c in children if check_if_price(c.get_text().strip())]
        if not children_with_price:
            price_nodes.append(el)
        else:
            if all(is_original_price_el(soup, c) for c in children_with_price):
                price_nodes.append(el)

    for price_node in price_nodes:
        raw_price = get_price_text(soup, price_node)
        parent = price_node.parent
        class_name = " ".join(price_node.get("class", []))
        tag_name = price_node.name
        style = price_node.get("style", "")
        is_orig = (
            any(w in class_name for w in ["line", "old", "del"]) or tag_name in ["del", "s"] or "line-through" in style
        )

        for step in range(5):
            if not parent or isinstance(parent, BeautifulSoup):
                break
            id_p = parent.get("id", "") or ""
            class_p = " ".join(parent.get("class", [])) or ""
            tag_p = parent.name or ""
            if is_excluded(id_p, class_p) or is_layout_container(id_p, class_p, tag_p):
                break

            target_titles = parent.find_all(
                ["h1", "h2", "h3", "h4", "h5", "h6", "a"],
                class_=lambda c: c and any(w in str(c).lower() for w in ["title", "name"]),
            ) + parent.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "a"])

            candidates = []
            for node in target_titles:
                txt = node.get_text()
                txt = re.sub(r"\s+", " ", txt).strip() if txt else ""
                if txt and 8 <= len(txt) < 150 and txt != raw_price and not check_if_price(txt):
                    is_rac = any(x in txt.lower() for x in TRASH_KEYWORDS)
                    if not is_rac:
                        dist = get_dom_distance(price_node, node)
                        candidates.append({"node": node, "text": txt, "dist": dist})

            title_text = ""
            title_href = ""
            if candidates:
                candidates.sort(key=lambda x: x["dist"])
                best = candidates[0]
                title_text = best["text"]
                nl = best["node"]
                for d in range(3):
                    if nl and nl.name == "a":
                        title_href = nl.get("href", "")
                        break
                    if nl:
                        nl = nl.parent

            if title_text and not title_href:
                links = parent.find_all("a")
                best_link = None
                min_link_dist = 999999
                for link in links:
                    href = link.get("href", "")
                    if href and len(href) > 2 and not href.startswith("#") and not href.startswith("javascript:"):
                        dist = get_dom_distance(price_node, link)
                        if dist < min_link_dist:
                            min_link_dist = dist
                            best_link = href
                title_href = best_link or ""

            if title_text:
                results.append(
                    {
                        "ten": title_text,
                        "gia": raw_price,
                        "trang": page_num,
                        "link": urljoin(url, title_href) if title_href else "",
                        "anh": "",
                        "isOriginal": is_orig,
                    }
                )
                break
            parent = parent.parent

    unique_map = {}
    for sp in results:
        key = sp["link"] or sp["ten"]
        if not key:
            continue
        if key in unique_map:
            ex = unique_map[key]
            if ex["isOriginal"] and not sp["isOriginal"]:
                unique_map[key] = sp
            elif not ex["isOriginal"] and not sp["isOriginal"]:
                vn = parse_vietnamese_price(sp["gia"]) or 0
                ve = parse_vietnamese_price(ex["gia"]) or 0
                if vn > 0 and (ve == 0 or vn < ve):
                    unique_map[key] = sp
        else:
            unique_map[key] = sp

    return list(unique_map.values())


async def scrape_url_async(target_url: str, page_num: int, options: dict = None, log_callback=logger.info) -> dict:
    if options is None:
        options = {}
    is_block_resources = options.get("blockResources") != False
    timeout = options.get("timeout") or 15000

    try:
        log_callback(f"Thử tải trang trực tiếp qua HTTP GET: {target_url}...")
        from crawldata.crawlers.fetcher import fetch_html

        html = await fetch_html(target_url, timeout=timeout / 1000, retries=0)
        log_callback("Tải trang thành công. Đang phân tích cú pháp HTML...")
        products = run_cheerio_scrape_bs4(html, target_url, page_num, log_callback)

        if len(products) >= 8:
            log_callback(f"Thành công! Tìm thấy {len(products)} sản phẩm (qua BS4 cào nhanh).")
            res = {"products": products}
            if is_homepage(target_url):
                res["categoryLinks"] = extract_category_links_bs4(html, target_url)
            return res
        else:
            log_callback(f"Tìm thấy ít sản phẩm ({len(products)}). Chuyển sang trình duyệt ảo Playwright...")
    except Exception as e:
        log_callback(f"Cào nhanh không thành công: {e}. Đang chuyển sang trình duyệt ảo...", "warning")

    async with async_playwright() as p:
        try:
            log_callback("Đang khởi động trình duyệt Playwright...")
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(viewport={"width": 1280, "height": 720})

            if is_block_resources:

                async def route_intercept(route, request):
                    t = request.resource_type
                    u = request.url.lower()
                    if (
                        t == "image"
                        or t in ["media", "font", "stylesheet"]
                        or any(
                            d in u
                            for d in [
                                "google-analytics",
                                "googletagmanager",
                                "doubleclick",
                                "facebook",
                                "hotjar",
                                "pixel",
                                "analytics",
                                "adservice",
                                "clarity",
                                "zalo",
                            ]
                        )
                    ):
                        await route.abort()
                    else:
                        await route.continue_()

                await page.route("**/*", route_intercept)

            await page.set_extra_http_headers({"Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8"})
            log_callback(f"Trình duyệt ảo truy cập URL: {target_url}")

            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=timeout)
            except Exception:
                log_callback("Cảnh báo: Trình duyệt ảo tải trang quá thời gian quy định.", "warning")

            try:
                log_callback("Cuộn trang ảo để tải các phần lazy load...")
                await page.evaluate(
                    """async () => {
                    const steps = 5;
                    const dist = Math.ceil(document.body.scrollHeight / steps);
                    for (let i = 0; i < steps; i++) {
                         window.scrollBy(0, dist);
                         await new Promise(r => setTimeout(r, 100));
                    }
                }"""
                )
                await asyncio.sleep(0.2)
            except Exception as e:
                log_callback(f"Cảnh báo: Không thể cuộn trang ảo: {e}", "warning")

            log_callback("Đang chạy bóc tách dữ liệu heuristic trên trình duyệt ảo...")
            js_code = f"""(currentPageNum, currentUrl) => {{
                const results = [];
                const tuKhoaRac = {json.dumps(TRASH_KEYWORDS)};
                
                function checkIfPrice(text) {{
                    text = text.trim().toLowerCase();
                    if (!text) return false;
                    const numericOnly = text.replace(/\\D/g, '');
                    if (/^0\\d{{9}}$/.test(numericOnly) || /^1800\\d{{4}}$/.test(numericOnly) || /^1900\\d{{4}}$/.test(numericOnly)) return false;
                    const hasCurrency = text.includes('đ') || text.includes('₫') || text.includes('$') || text.includes('vnd') || text.includes('vnđ');
                    const cleanText = text.replace(/[\\d.,\\sđ₫$%\\-]/g, '').replace(/vnd|vnđ/g, '');
                    if (cleanText.length > 0) return false;
                    const hasDigit = /\\d/.test(text);
                    if (!hasDigit) return false;
                    if (hasCurrency) {{
                        if (/[.,]\\d$/.test(text.replace(/[^0-9.,]/g, '')) && !text.includes('$')) return false;
                        return true;
                    }}
                    return /^\\d{{1,3}}([.,]\\d{{3}})+$/.test(text);
                }}

                const isExcluded = (id, className) => {{
                    const exclusions = {json.dumps(EXCLUSION_WORDS)};
                    return exclusions.some(w => id.includes(w) || className.includes(w));
                }};

                const isLayoutContainer = (id, className, tagName) => {{
                    const t = (tagName || '').toLowerCase();
                    if (t === 'body' || t === 'html' || t === 'main' || t === 'section' || t === 'article' || t === 'aside' || t === 'header' || t === 'footer') {{
                        return true;
                    }}
                    const c = (className || '').toLowerCase();
                    const i = (id || '').toLowerCase();
                    if (c.includes('item') || i.includes('item') || c.includes('col-') || i.includes('col-')) {{
                        return false;
                    }}
                    const layoutTerms = {json.dumps(LAYOUT_WORDS)};
                    return layoutTerms.some(w => c.includes(w) || i.includes(w));
                }};

                function getPriceText(el) {{
                    const clone = el.cloneNode(true);
                    const removeOldPrices = (node) => {{
                        if (!node || !node.children) return;
                        Array.from(node.children).forEach(child => {{
                            const cn = child.className ? String(child.className).toLowerCase() : '';
                            const tn = child.tagName ? String(child.tagName).toLowerCase() : '';
                            let lt = false;
                            try {{
                                const cs = window.getComputedStyle(child);
                                lt = cs.textDecorationLine === 'line-through' || cs.textDecoration.includes('line-through');
                            }} catch (e) {{}}
                            if (cn.includes('line') || cn.includes('old') || cn.includes('del') || tn === 'del' || tn === 's' || lt) {{
                                try {{ node.removeChild(child); }} catch (e) {{}}
                            }} else {{
                                removeOldPrices(child);
                            }}
                        }});
                    }};
                    removeOldPrices(clone);
                    return clone.innerText ? clone.innerText.trim() : '';
                }}

                function isOriginalPriceEl(el) {{
                    const cn = el.className ? String(el.className).toLowerCase() : '';
                    const tn = el.tagName ? String(el.tagName).toLowerCase() : '';
                    if (cn.includes('line') || cn.includes('old') || cn.includes('del') || tn === 'del' || tn === 's') return true;
                    try {{
                        const cs = window.getComputedStyle(el);
                        if (cs.textDecorationLine === 'line-through' || cs.textDecoration.includes('line-through')) return true;
                    }} catch (e) {{}}
                    return false;
                }}

                function getDOMDistance(nodeA, nodeB) {{
                    const pathA = [];
                    let currA = nodeA;
                    while (currA) {{
                        pathA.push(currA);
                        currA = currA.parentElement;
                    }}
                    const pathB = [];
                    let currB = nodeB;
                    while (currB) {{
                        pathB.push(currB);
                        currB = currB.parentElement;
                    }}
                    let lca = null;
                    let indexA = -1;
                    let indexB = -1;
                    for (let i = 0; i < pathA.length; i++) {{
                        const idx = pathB.indexOf(pathA[i]);
                        if (idx !== -1) {{
                            lca = pathA[i];
                            indexA = i;
                            indexB = idx;
                            break;
                        }}
                    }}
                    if (lca === null) return Infinity;
                    return indexA + indexB;
                }}

                const allElements = Array.from(document.querySelectorAll('*'));
                const priceNodes = allElements.filter(el => {{
                    const text = getPriceText(el);
                    if (!checkIfPrice(text)) return false;
                    const children = Array.from(el.children);
                    const childrenWithPrice = children.filter(c => checkIfPrice((c.innerText || '').trim()));
                    if (childrenWithPrice.length === 0) return true;
                    return childrenWithPrice.every(c => isOriginalPriceEl(c));
                }});

                priceNodes.forEach(priceNode => {{
                    const rawPrice = getPriceText(priceNode);
                    let parent = priceNode.parentElement;

                    const cn = priceNode.className ? String(priceNode.className).toLowerCase() : '';
                    const tn = priceNode.tagName ? String(priceNode.tagName).toLowerCase() : '';
                    let lt = false;
                    try {{
                        const cs = window.getComputedStyle(priceNode);
                        lt = cs.textDecorationLine === 'line-through' || cs.textDecoration.includes('line-through');
                    }} catch (e) {{}}
                    const isOriginal = cn.includes('line') || cn.includes('old') || cn.includes('del') || tn === 'del' || tn === 's' || lt;

                    for (let step = 0; step < 5; step++) {{
                        if (!parent) break;
                        const idP = parent.id ? String(parent.id).toLowerCase() : '';
                        const cnP = parent.className ? String(parent.className).toLowerCase() : '';
                        const tagP = parent.tagName ? String(parent.tagName).toLowerCase() : '';
                        if (isExcluded(idP, cnP) || isLayoutContainer(idP, cnP, tagP)) break;

                        const targetTitles = Array.from(parent.querySelectorAll('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="name"],.title,.name,a'));
                        let candidates = [];
                        for (const titleNode of targetTitles) {{
                            const txt = titleNode.innerText ? titleNode.innerText.replace(/\\s+/g, ' ').trim() : '';
                            if (txt && txt.length >= 8 && txt.length < 150 && txt !== rawPrice && !checkIfPrice(txt)) {{
                                const isRac = tuKhoaRac.some(x => txt.toLowerCase().includes(x));
                                if (!isRac) {{
                                    const dist = getDOMDistance(priceNode, titleNode);
                                    candidates.push({{ node: titleNode, text: txt, dist }});
                                }}
                            }}
                        }}

                        let titleText = '', titleHref = '';
                        if (candidates.length > 0) {{
                            candidates.sort((a, b) => a.dist - b.dist);
                            const best = candidates[0];
                            titleText = best.text;
                            let nl = best.node;
                            for (let d = 0; d < 3; d++) {{
                                if (nl && nl.tagName.toLowerCase() === 'a') {{
                                    titleHref = nl.getAttribute('href');
                                    break;
                                }}
                                if (nl) nl = nl.parentElement;
                            }}
                        }}

                        if (titleText && !titleHref) {{
                            let links = Array.from(parent.querySelectorAll('a'));
                            let bestLink = null;
                            let minLinkDist = Infinity;
                            for (const link of links) {{
                                const href = link.getAttribute('href');
                                if (href && href.length > 2 && !href.startsWith('#') && !href.startsWith('javascript:')) {{
                                    const dist = getDOMDistance(priceNode, link);
                                    if (dist < minLinkDist) {{
                                        minLinkDist = dist;
                                        bestLink = href;
                                    }}
                                }}
                            }}
                            titleHref = bestLink || '';
                        }}

                        if (titleText) {{
                            const makeAbsolute = (u) => {{
                                if (!u) return '';
                                if (u.startsWith('//')) return 'https:' + u;
                                if (!u.startsWith('http')) {{
                                    try {{ return new URL(u, currentUrl).href; }} catch (e) {{}}
                                }}
                                return u;
                            }};
                            results.push({{
                                ten: titleText,
                                gia: rawPrice,
                                trang: currentPageNum,
                                link: makeAbsolute(titleHref),
                                anh: '',
                                isOriginal
                            }});
                            break;
                        }}
                        parent = parent.parentElement;
                    }}
                }});

                const uniqueMap = new Map();
                results.forEach(sp => {{
                    const key = sp.link || sp.ten;
                    if (!key) return;
                    if (uniqueMap.has(key)) {{
                        const ex = uniqueMap.get(key);
                        if (ex.isOriginal && !sp.isOriginal) {{
                            uniqueMap.set(key, sp);
                        }} else if (!ex.isOriginal && !sp.isOriginal) {{
                            const vn = parseInt(sp.gia.replace(/\\D/g, '')) || 0;
                            const ve = parseInt(ex.gia.replace(/\\D/g, '')) || 0;
                            if (vn > 0 && (ve === 0 || vn < ve)) uniqueMap.set(key, sp);
                        }}
                    }} else {{
                        uniqueMap.set(key, sp);
                    }}
                }});
                return Array.from(uniqueMap.values());
            }}"""

            products_raw = await page.evaluate(js_code, page_num, target_url)
            log_callback(f"Hoàn thành! Trình duyệt ảo tìm thấy {len(products_raw)} sản phẩm.")

            category_links = []
            if is_homepage(target_url):
                html_full = await page.content()
                category_links = extract_category_links_bs4(html_full, target_url)

            await browser.close()
            return {"products": products_raw, "categoryLinks": category_links}
        except Exception as err:
            log_callback(f"Lỗi khi chạy trình duyệt Playwright: {err}", "error")
            return {"products": []}


def is_fake_price(parsed_price: int, model: str) -> bool:
    if not model:
        return False
    model_digits = "".join(c for c in normalize_model_text(model) if c.isdigit())
    if len(model_digits) < 3:
        return False
    if parsed_price % 1000 == 0:
        return False

    price_digits = str(parsed_price)
    if model_digits in price_digits:
        return True
    if price_digits in model_digits and len(price_digits) >= 4:
        return True
    return False


def find_main_product_container(soup: BeautifulSoup) -> Tag:
    selectors = [
        ".product-info-main",
        ".product-detail",
        ".product-summary",
        ".summary",
        "article.product",
        "main",
        "#main",
        "#content",
    ]
    for sel in selectors:
        el = soup.select_one(sel)
        if el:
            return el
    return soup.find("body") or soup


def extract_price_advanced(soup: BeautifulSoup, html: str, model: str, url: str, reference_price: Any) -> int | None:
    is_kocher = "kocher.vn" in urlparse(url).hostname.lower()
    ref_price = parse_vietnamese_price(reference_price)
    min_range = max(100000, ref_price * 0.3) if ref_price else 100000
    max_range = min(2000000000, ref_price * 2.0) if ref_price else 2000000000

    def is_valid(p):
        if p is None:
            return False
        if p < min_range or p > max_range:
            return False
        if is_fake_price(p, model):
            return False
        return True

    for h in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
        text = normalize_model_text(h.get_text())
        is_junk = any(kw in text for kw in JUNK_HEADING_KEYWORDS)
        if is_junk:
            parent = h.parent
            for step in range(3):
                if not parent or isinstance(parent, BeautifulSoup):
                    break
                if parent.name in ["body", "html"] or parent.get("id") == "product-detail":
                    break
                if parent.find("h1"):
                    break
                parent["class"] = [*parent.get("class", []), "junk-container-marked"]
                parent = parent.parent

    def is_junk_node(el: Tag) -> bool:
        curr = el
        while curr and not isinstance(curr, BeautifulSoup):
            classes = curr.get("class", [])
            classes_str = " ".join(classes) if isinstance(classes, list) else str(classes)
            id_str = curr.get("id", "") or ""
            tag = curr.name

            if tag in ["del", "s"] or any(
                w in classes_str.lower()
                for w in ["old-price", "compare-at-price", "original-price", "price-old", "price-compare"]
            ):
                return True

            if "junk-container-marked" in classes_str or any(
                w in classes_str.lower() or w in id_str.lower()
                for w in [
                    "related",
                    "upsell",
                    "cross-sell",
                    "recommend",
                    "suggested",
                    "product-slider",
                    "similar",
                    "may-like",
                    "carousel",
                    "slider",
                    "aside",
                    "sidebar",
                    "widget",
                    "review",
                    "news",
                    "blog",
                    "post",
                    "gift-product",
                    "promo-product",
                    "offer-product",
                ]
            ):
                return True

            curr = curr.parent

        curr = el
        for _ in range(4):
            if not curr or isinstance(curr, BeautifulSoup) or curr.name == "body":
                break
            classes = curr.get("class", [])
            class_str = " ".join(classes) if isinstance(classes, list) else str(classes)
            id_str = curr.get("id", "") or ""
            normalized = normalize_vietnamese_text(f"{class_str} {id_str} {curr.get_text()[:100]}")
            if any(
                kw in normalized
                for kw in ["tiet kiem", "save", "saving", "discount", "giam gia", "tra gop", "installment", "combo"]
            ):
                return True
            curr = curr.parent
        return False

    main_container = find_main_product_container(soup)

    # 1. Learned Selector Check
    domain = ""
    try:
        domain = urlparse(url).hostname.lower()
    except Exception:
        pass

    if domain:
        learned = pricing_cache.get_selector_for_domain(domain)
        if learned:
            for el in main_container.select(learned):
                if is_junk_node(el):
                    continue
                val = el.get("content") or el.get("value") or el.get_text()
                parsed = parse_vietnamese_price(val)
                if is_valid(parsed):
                    return parsed

    # 2. Common CSS Classes Heuristic
    html_selectors = [
        ".price-info__sale",
        "[class*='product-price']",
        "[class*='product_price']",
        "[class*='new_price']",
        "[class*='new-price']",
        "[class*='price_new']",
        "[class*='price-new']",
        "[class*='sale_price']",
        "[class*='sale-price']",
        "[class*='price_sale']",
        "[class*='price-sale']",
        "[class*='special_price']",
        "[class*='special-price']",
        "[class*='current_price']",
        "[class*='current-price']",
        "ins .woocommerce-Price-amount",
        "ins .amount",
        "ins",
        ".price-new",
        ".price-amount",
        ".current-price",
        ".special-price",
        ".sale-price",
        ".woocommerce-Price-amount",
        ".amount",
        ".price",
        ".product-price",
        ".gia-ban",
        ".giaban",
        ".gia-khuyen-mai",
        ".gia-km",
        ".price-current",
        ".pro-price",
        ".product-price-new",
        ".price-box",
        ".gia_ban",
        ".gia_khuyen_mai",
        ".gia_km",
        ".gia",
    ]

    for sel in html_selectors:
        found_price = None
        for el in main_container.select(sel):
            if is_junk_node(el):
                continue
            val = el.get("content") or el.get("value") or el.get_text()
            parsed = parse_vietnamese_price(val)
            if is_valid(parsed):
                found_price = parsed
                break
        if found_price:
            if domain:
                pricing_cache.set_selector_for_domain(domain, sel)
            return found_price

    # 3. JSON-LD Schema
    if not is_kocher:
        json_price = None

        def extract_ld_price(obj):
            nonlocal json_price
            if json_price is not None:
                return
            if not obj or not isinstance(obj, (dict, list)):
                return
            if isinstance(obj, list):
                for item in obj:
                    extract_ld_price(item)
                return
            if obj.get("@type") == "Product" and obj.get("name"):
                if not is_model_match(obj["name"], model):
                    return
            if (
                obj.get("@type") in ["Offer", "AggregateOffer", "Product"]
                or "price" in obj
                or "lowPrice" in obj
                or "highPrice" in obj
            ):
                curr = obj.get("priceCurrency")
                if not curr or "vnd" in str(curr).lower():
                    price_candidates = [obj.get("price"), obj.get("lowPrice"), obj.get("highPrice")]
                    for val in price_candidates:
                        if val is not None:
                            parsed = parse_vietnamese_price(val)
                            if is_valid(parsed):
                                json_price = parsed
                                return
            for v in obj.values():
                if isinstance(v, (dict, list)):
                    extract_ld_price(v)

        for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
            try:
                script_text = script.string
                if script_text:
                    data = json.loads(script_text)
                    extract_ld_price(data)
            except Exception:
                pass

        if json_price is not None:
            return json_price

    # 4. Microdata itemprop="price"
    for el in main_container.select("[itemprop='price']"):
        if is_junk_node(el):
            continue
        val = el.get("content") or el.get("value") or el.get_text()
        parsed = parse_vietnamese_price(val)
        if is_valid(parsed):
            return parsed

    # 5. OpenGraph Tags
    og_selectors = [
        "meta[property='product:price:amount']",
        "meta[property='product:price']",
        "meta[property='og:price:amount']",
        "meta[property='og:price']",
    ]
    for sel in og_selectors:
        el = soup.select_one(sel)
        if el:
            parsed = parse_vietnamese_price(el.get("content"))
            if is_valid(parsed):
                return parsed

    # General meta tag prices
    for el in soup.find_all("meta"):
        name = el.get("name") or el.get("property") or ""
        if "price" in name.lower() or "gia" in name.lower():
            parsed = parse_vietnamese_price(el.get("content"))
            if is_valid(parsed):
                return parsed

    # 6. Leaf Nodes Text Matches
    for el in main_container.find_all(recursive=True):
        children = [c for c in el.children if isinstance(c, Tag)]
        if len(children) > 0:
            continue
        if is_junk_node(el):
            continue
        txt = el.get_text()
        if any(c in txt for c in ["đ", "₫", "vnd", "vnđ", "đồng"]):
            parsed = parse_vietnamese_price(txt)
            if is_valid(parsed):
                return parsed

    return None


async def extract_product_price(url: str, model: str, brand: str, reference_price: Any, retries: int = 2) -> int | None:
    html = pricing_cache.get_html(url)
    if not html:
        await asyncio.sleep(0.15 + random.random() * 0.35)
        try:
            from crawldata.crawlers.fetcher import fetch_html

            html = await fetch_html(url, timeout=8.0, retries=retries)
            pricing_cache.set_html(url, html)
        except Exception as e:
            pricing_cache.set_error(url, f"Fetch failed: {e}")
            return None

    soup = BeautifulSoup(html, "html.parser")
    verify_res = verify_page_content(soup, url, model, brand)
    if not verify_res["valid"]:
        pricing_cache.set_error(url, f"Reject: {verify_res['reason']}")
        return None

    cached_price = pricing_cache.get_price(url)
    if cached_price is not None:
        return cached_price

    price = extract_price_advanced(soup, html, model, url, reference_price)
    if price is not None:
        pricing_cache.set_price(url, price)
    return price
