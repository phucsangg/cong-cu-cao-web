import asyncio
import re
import time
from typing import Any
from urllib.parse import urlparse

from crawldata.adapters.sheets_apps_script import (
    list_spreadsheet_sheets as adapter_list_spreadsheet_sheets,
)
from crawldata.adapters.sheets_apps_script import (
    read_sheet_rows_raw,
    update_sheet_sale_price_raw,
)
from crawldata.adapters.sheets_apps_script import (
    write_sheet_updates as adapter_write_sheet_updates,
)
from crawldata.cache.store import pricing_cache
from crawldata.crawlers.product_extractor import extract_product_price
from crawldata.crawlers.search_engines import is_likely_product_detail_url, search_product_links
from crawldata.crawlers.sitemap_discovery import discover_sitemap_links
from crawldata.logger import logger
from crawldata.pricing import (
    calculate_relevance_score,
    compute_suggested_pricing,
    generate_keywords,
    parse_vietnamese_price,
)
from crawldata.utils.helpers import map_sheet_headers
from crawldata.utils.rows import clean_numeric_code, parse_specific_rows
from crawldata.utils.text import clean_model_specs, normalize_vietnamese_text

HARAVAN_BRANDS = {
    "bosch",
    "hafele",
    "tefal",
    "konox",
    "kluger",
    "canzy",
    "eurosun",
    "junger",
    "kocher",
    "grandx",
    "toshiba",
    "supor",
    "garis",
    "kaff",
}


def is_valid_brand(brand: Any) -> bool:
    if not brand:
        return False
    return bool(str(brand).strip())


def is_valid_model(model: Any) -> bool:
    if not model:
        return False
    trimmed = str(model).strip()
    if not trimmed:
        return False
    return not bool(re.match(r"^\d+$", clean_numeric_code(trimmed)))


async def process_pricing_row(row: dict, links_concurrency: int = 4) -> dict:
    clean_model = clean_model_specs(row.get("model"))
    row_brand = row.get("brand", "")

    if not row or not is_valid_brand(row_brand) or not is_valid_model(row.get("model")):
        return {
            "rowNumber": row.get("rowNumber"),
            "status": "skipped",
            "marketPrices": [],
            "matchedUrls": [],
            "matchedDetails": [],
            "minPrice": None,
            "gapValue": None,
            "gapPercent": None,
            "suggestedPrice": None,
        }

    # Intercept mock pricing for 21.Test sheet
    is_test_sheet = row.get("sheetName") and "21.test" in normalize_vietnamese_text(row.get("sheetName"))
    if is_test_sheet:
        mock_details = [{"url": f"https://mock-market-test.vn/cleer-test-p{i+1}", "price": 100000} for i in range(10)]
        pricing = compute_suggested_pricing(
            list_price=row.get("listPrice"),
            cost_price=row.get("costPrice"),
            current_sale_price=row.get("salePrice") or 100000,
            prices=[d["price"] for d in mock_details],
        )
        return {
            "rowNumber": row.get("rowNumber"),
            "productId": row.get("productId", ""),
            "brand": row_brand,
            "model": row.get("model"),
            "matchedUrls": [d["url"] for d in mock_details],
            "matchedDetails": mock_details,
            "totalLinksCount": len(mock_details),
            "marketPrices": pricing["marketPrices"],
            "hasNewPrices": True,
            "minPrice": pricing["minPrice"],
            "gapValue": pricing["gapValue"],
            "gapPercent": pricing["gapPercent"],
            "suggestedPrice": pricing["suggestedPrice"],
            "outlierRemoved": pricing["outlierRemoved"],
            "status": "success",
        }

    start_time = time.time()
    all_filtered_links = []
    is_cache_hit = False
    source_map = {}

    cached_urls = pricing_cache.get_urls_for_model(row_brand, clean_model)
    if cached_urls:
        all_filtered_links = cached_urls
        is_cache_hit = True
        for url in cached_urls:
            source_map[url] = "Cache URL Map"
    else:
        discovered_links = await search_product_links(
            brand=row_brand,
            model=clean_model,
            limit=20,
            sheet_name=row.get("sheetName", ""),
            source_map=source_map,
        )

        likely_links = [link for link in discovered_links if is_likely_product_detail_url(link, clean_model, row_brand)]
        all_sitemap_links = []
        if not likely_links:
            unique_domains = list({urlparse(link).hostname for link in discovered_links if urlparse(link).hostname})[:4]

            async def get_sitemaps(domain):
                try:
                    urls = await discover_sitemap_links(domain, clean_model, row_brand)
                    for url in urls:
                        source_map[url] = "Sitemap"
                    return urls
                except Exception:
                    return []

            sitemap_links_results = await asyncio.gather(*(get_sitemaps(dom) for dom in unique_domains))
            for res in sitemap_links_results:
                all_sitemap_links.extend(res)

        merged_links = list(set(discovered_links + all_sitemap_links))
        all_filtered_links = [
            link for link in merged_links if is_likely_product_detail_url(link, clean_model, row_brand)
        ]

    search_time_ms = int((time.time() - start_time) * 1000)
    crawl_start_time = time.time()

    scored_links = [
        {"url": url, "score": calculate_relevance_score(url, clean_model, row_brand)} for url in all_filtered_links
    ]
    scored_links.sort(key=lambda x: x["score"], reverse=True)
    top_scored = scored_links[:50]
    filtered_links = [item["url"] for item in top_scored]

    matched_details = []
    crawl_cache_hits = 0
    batch_size = 10
    batch_idx = 0

    while batch_idx < len(filtered_links):
        if len(matched_details) >= 5:
            break

        batch = filtered_links[batch_idx : batch_idx + batch_size]
        batch_idx += batch_size

        batch_results = []
        next_batch_idx = 0
        batch_lock = asyncio.Lock()

        async def run_batch_worker():
            nonlocal next_batch_idx, crawl_cache_hits
            while True:
                async with batch_lock:
                    if next_batch_idx >= len(batch):
                        break
                    url = batch[next_batch_idx]
                    next_batch_idx += 1

                try:
                    has_html = pricing_cache.get_html(url) is not None
                    has_price = pricing_cache.get_price(url) is not None
                    if has_html or has_price:
                        crawl_cache_hits += 1

                    price = await extract_product_price(
                        url=url, model=clean_model, brand=row_brand, reference_price=row.get("costPrice"), retries=0
                    )
                    if price and 100000 <= price <= 2000000000:
                        try:
                            host = urlparse(url).hostname.lower()
                            pricing_cache.set_url_for_model_domain(row_brand, clean_model, host, url)
                        except Exception:
                            pass
                        batch_results.append({"url": url, "price": price})
                except Exception:
                    pass

        workers_count = min(links_concurrency, len(batch))
        await asyncio.gather(*(run_batch_worker() for _ in range(workers_count)))
        matched_details.extend(batch_results)

    matched_details.sort(key=lambda x: x["price"])
    has_new_prices = len(matched_details) > 0
    final_prices = [d["price"] for d in matched_details] if has_new_prices else (row.get("marketPrices") or [])

    pricing = compute_suggested_pricing(
        list_price=row.get("listPrice"),
        cost_price=row.get("costPrice"),
        current_sale_price=row.get("salePrice"),
        prices=final_prices,
    )

    crawl_time_ms = int((time.time() - crawl_start_time) * 1000)
    saved_requests = (4 if is_cache_hit else 0) + crawl_cache_hits
    saved_time_ms = (1500 if is_cache_hit else 0) + (crawl_cache_hits * 500)

    keywords_used = ", ".join(generate_keywords(row_brand, clean_model, row.get("sheetName", ""))[:3])
    pricing_logs = []

    for url in filtered_links:
        engine = source_map.get(url, "Search Engine")
        rel_score = calculate_relevance_score(url, clean_model, row_brand)
        match_entry = next((d for d in matched_details if d["url"] == url), None)
        price_found = match_entry["price"] if match_entry else None
        reject_reason = ""
        if not match_entry:
            reject_reason = pricing_cache.get_error(url) or "Model mismatch or price not found"

        pricing_logs.append(
            {
                "keyword": keywords_used,
                "search engine": engine,
                "url": url,
                "relevance score": rel_score,
                "model match score": 100 if rel_score >= 40 else 0,
                "extracted price": price_found,
                "reject reason": reject_reason,
            }
        )

    pricing_logs.append(
        {
            "keyword": "STATISTICS SUMMARY",
            "search engine": "System Stats",
            "url": f"Requests: {len(filtered_links)}, Saved requests: {saved_requests}",
            "relevance score": 0,
            "model match score": 0,
            "extracted price": None,
            "reject reason": f"Search time: {search_time_ms}ms, Crawl time: {crawl_time_ms}ms, Saved time: {saved_time_ms}ms",
        }
    )

    return {
        "rowNumber": row.get("rowNumber"),
        "productId": row.get("productId", ""),
        "brand": row_brand,
        "model": row.get("model"),
        "matchedUrls": [d["url"] for d in matched_details],
        "matchedDetails": matched_details,
        "totalLinksCount": len(filtered_links),
        "marketPrices": pricing["marketPrices"],
        "hasNewPrices": has_new_prices,
        "minPrice": pricing["minPrice"],
        "gapValue": pricing["gapValue"],
        "gapPercent": pricing["gapPercent"],
        "suggestedPrice": pricing["suggestedPrice"],
        "outlierRemoved": pricing["outlierRemoved"],
        "status": "success" if final_prices else "insufficient_prices",
        "pricingLogs": pricing_logs,
        "stats": {
            "searchTimeMs": search_time_ms,
            "crawlTimeMs": crawl_time_ms,
            "savedRequests": saved_requests,
            "savedTimeMs": saved_time_ms,
        },
    }


async def read_sheet_rows(
    apps_script_url: str,
    sheet_url: str,
    sheet_name: str,
    start_row: int = 3,
    end_row: int | None = None,
    specific_rows_enabled: bool = False,
    scan_to_end_enabled: bool = False,
    specific_rows: str = "",
) -> dict:
    is_specific = specific_rows_enabled and specific_rows
    row_set = parse_specific_rows(specific_rows) if is_specific else None
    is_scan_to_end = is_specific and scan_to_end_enabled

    final_start = max(3, int(start_row or 3))
    final_end = int(end_row) if end_row else None

    if row_set:
        final_start = max(3, min(row_set))
        if not is_scan_to_end:
            final_end = max(final_start, max(row_set))

    data = await read_sheet_rows_raw(
        apps_script_url=apps_script_url,
        sheet_url=sheet_url,
        sheet_name=sheet_name,
        start_row=final_start,
        end_row=final_end,
    )

    headers = data.get("headers") or []
    mapping = map_sheet_headers(headers)

    raw_rows = data.get("rows") or []
    if row_set and not is_scan_to_end:
        raw_rows = [r for r in raw_rows if r.get("rowNumber") in row_set]

    rows = []
    for r in raw_rows:
        vals = r.get("values") or []
        market_prices = []
        for col_idx in mapping["marketColumns"]:
            if col_idx < len(vals):
                parsed = parse_vietnamese_price(vals[col_idx])
                if parsed is not None and parsed > 0:
                    market_prices.append(parsed)

        rows.append(
            {
                "rowNumber": r.get("rowNumber"),
                "productId": vals[mapping["productId"]] if mapping["productId"] < len(vals) else "",
                "brand": vals[mapping["brand"]] if mapping["brand"] < len(vals) else "",
                "model": vals[mapping["model"]] if mapping["model"] < len(vals) else "",
                "listPrice": vals[mapping["listPrice"]]
                if mapping["listPrice"] != -1 and mapping["listPrice"] < len(vals)
                else "",
                "costPrice": vals[mapping["costPrice"]]
                if mapping["costPrice"] != -1 and mapping["costPrice"] < len(vals)
                else "",
                "salePrice": vals[mapping["salePrice"]]
                if mapping["salePrice"] != -1 and mapping["salePrice"] < len(vals)
                else "",
                "marketPrices": market_prices,
            }
        )

    sheet_id = data.get("sheetId") or ""
    return {"sheetId": sheet_id, "headers": headers, "mapping": mapping, "rows": rows}


async def write_sheet_updates(
    apps_script_url: str, sheet_url: str, sheet_name: str, updates: list[dict], logs: list[dict] | None = None
) -> dict:
    payload_updates = [
        {
            "rowNumber": u["rowNumber"],
            "marketPrices": u["marketPrices"] if u.get("hasNewPrices") is not False else [],
            "minPrice": u.get("minPrice"),
            "gapValue": u.get("gapValue"),
            "gapPercent": u.get("gapPercent"),
            "suggestedPrice": u.get("suggestedPrice"),
            "status": u.get("status"),
        }
        for u in updates
    ]
    return await adapter_write_sheet_updates(
        apps_script_url=apps_script_url,
        sheet_url=sheet_url,
        sheet_name=sheet_name,
        updates=payload_updates,
        logs=logs,
    )


async def list_spreadsheet_sheets(apps_script_url: str, sheet_url: str) -> dict:
    return await adapter_list_spreadsheet_sheets(apps_script_url, sheet_url)


async def load_model_mapping(apps_script_url: str, sheet_url: str) -> dict[str, str]:
    if not apps_script_url or not sheet_url:
        return {}

    target_sheet = "LOG"
    try:
        sheet_list = await list_spreadsheet_sheets(apps_script_url, sheet_url)
        sheets_arr = sheet_list.get("sheets") or []
        norm_target = re.sub(r"[^a-z0-9]", "", normalize_vietnamese_text(target_sheet))
        matched = next(
            (name for name in sheets_arr if re.sub(r"[^a-z0-9]", "", normalize_vietnamese_text(name)) == norm_target),
            None,
        )
        if matched:
            target_sheet = matched
    except Exception:
        pass

    try:
        data = await read_sheet_rows_raw(
            apps_script_url=apps_script_url,
            sheet_url=sheet_url,
            sheet_name=target_sheet,
            start_row=3,
        )
        code_idx = 13
        model_idx = 14
        mapping = {}
        for r in data.get("rows") or []:
            vals = r.get("values") or []
            if len(vals) > max(code_idx, model_idx):
                code = str(vals[code_idx]).strip()
                model = str(vals[model_idx]).strip()
                if code and model:
                    mapping[clean_numeric_code(code)] = model
        return mapping
    except Exception as e:
        logger.warning(f"Lỗi khi tải bảng ánh xạ FIX MODEL SỐ từ sheet LOG: {e}")
        return {}


async def update_sheet_sale_price(
    apps_script_url: str, sheet_url: str, sheet_name: str, row_number: int, price: Any
) -> dict:
    return await update_sheet_sale_price_raw(
        apps_script_url=apps_script_url,
        sheet_url=sheet_url,
        sheet_name=sheet_name,
        row_number=row_number,
        price=price,
    )
