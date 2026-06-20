import datetime
import re
from typing import Any

from crawldata.adapters.haravan import fetch_haravan_products, update_haravan_variant_price_api
from crawldata.adapters.sheets_apps_script import (
    read_sheet_rows_raw,
    write_haravan_ids_sheet,
    write_haravan_log_sheet,
)
from crawldata.adapters.telegram import send_telegram_message
from crawldata.logger import logger
from crawldata.services.sheet_pricing_service import HARAVAN_BRANDS, list_spreadsheet_sheets
from crawldata.utils.text import normalize_model_text, normalize_vietnamese_text

REMOVE_WORDS = {
    "máy",
    "rửa",
    "chén",
    "bát",
    "vòi",
    "khóa",
    "hút",
    "mùi",
    "bếp",
    "tủ",
    "lò",
    "nồi",
    "chảo",
    "bộ",
    "inox",
    "cao",
    "cấp",
    "âm",
    "đơn",
    "đôi",
    "điện",
    "từ",
    "gas",
}


def is_real_model(value: Any) -> bool:
    if not value:
        return False
    str_val = str(value).strip().upper()
    if len(str_val) < 3:
        return False
    has_letter = bool(re.search(r"[A-Z]", str_val))
    has_number = bool(re.search(r"\d", str_val))
    return has_letter and has_number


def clean_text(text: Any) -> str:
    s = str(text or "")
    s = re.sub(r"\[[^\]]+\]", " ", s)
    s = re.sub(r"\([^)]*\)", " ", s)
    s = s.replace("|", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def extract_model_regex(name: str = "") -> str | None:
    patterns = [
        re.compile(r"\b[A-Z]{2,}\d+[A-Z0-9\-]*\b", re.IGNORECASE),
        re.compile(r"\b\d+[A-Z]{2,}[A-Z0-9\-]*\b", re.IGNORECASE),
        re.compile(r"\b[A-Z]+-\d+[A-Z0-9\-]*\b", re.IGNORECASE),
        re.compile(r"\b[A-Z0-9]+-[A-Z0-9]+\b", re.IGNORECASE),
        re.compile(r"\bH\d{2,}[A-Z0-9\-]*\b", re.IGNORECASE),
    ]
    upper_name = str(name).upper()
    for pattern in patterns:
        matches = pattern.findall(upper_name)
        if matches:
            matches.sort(key=len, reverse=True)
            return matches[0]
    return None


def extract_commercial_name(name: str, brand: str) -> str:
    text = clean_text(name)
    if brand:
        escaped_brand = re.escape(str(brand))
        text = re.sub(escaped_brand, " ", text, flags=re.IGNORECASE)

    words = text.split()
    filtered = []
    for w in words:
        if not w:
            continue
        if w.lower() in REMOVE_WORDS:
            continue
        filtered.append(w)
    return re.sub(r"\s+", " ", " ".join(filtered)).strip()


def detect_brand(product: dict) -> str:
    vendor = str(product.get("vendor", "")).strip()
    if vendor:
        return vendor
    title = str(product.get("title", "")).lower()
    for brand in HARAVAN_BRANDS:
        if brand in title:
            return brand.capitalize()
    return ""


def extract_model(product: dict, variant: dict) -> str:
    sku = str(variant.get("sku", "")).strip()
    if is_real_model(sku):
        return sku

    barcode = str(variant.get("barcode", "")).strip()
    if is_real_model(barcode):
        return barcode

    title = product.get("title", "")
    regex_model = extract_model_regex(title)
    if regex_model:
        return regex_model

    brand = detect_brand(product)
    return extract_commercial_name(title, brand)


async def load_haravan_mapping(apps_script_url: str, sheet_url: str) -> dict[str, str]:
    if not apps_script_url or not sheet_url:
        return {}

    target_sheet = "ID Haravan"
    is_fallback = False
    try:
        sheet_list = await list_spreadsheet_sheets(apps_script_url, sheet_url)
        sheets_arr = sheet_list.get("sheets") or []
        has_target = any(
            re.sub(r"[^a-z0-9]", "", normalize_vietnamese_text(name)) in ["20idharavan", "idharavan"]
            for name in sheets_arr
        )
        if not has_target:
            fallback = next(
                (
                    name
                    for name in sheets_arr
                    if "tonghopsanpham" in re.sub(r"[^a-z0-9]", "", normalize_vietnamese_text(name))
                ),
                sheets_arr[0] if sheets_arr else None,
            )
            if fallback:
                target_sheet = fallback
                is_fallback = True
    except Exception:
        pass

    try:
        data = await read_sheet_rows_raw(
            apps_script_url=apps_script_url,
            sheet_url=sheet_url,
            sheet_name=target_sheet,
            start_row=2,
        )
        headers = data.get("headers") or []
        brand_idx = next((i for i, h in enumerate(headers) if "thuong hieu" in normalize_vietnamese_text(h)), -1)
        model_idx = next((i for i, h in enumerate(headers) if "model" in normalize_vietnamese_text(h)), -1)
        id_idx = next(
            (
                i
                for i, h in enumerate(headers)
                if (
                    any(k in normalize_vietnamese_text(h) for k in ["id haravan", "haravan id", "variant id"])
                    if is_fallback
                    else "id" in normalize_vietnamese_text(h)
                )
            ),
            -1,
        )

        mapping = {}
        if brand_idx != -1 and model_idx != -1 and id_idx != -1:
            for r in data.get("rows") or []:
                vals = r.get("values") or []
                if len(vals) > max(brand_idx, model_idx, id_idx):
                    brand = str(vals[brand_idx]).strip()
                    model = str(vals[model_idx]).strip()
                    var_id = str(vals[id_idx]).strip()
                    if brand and model and var_id:
                        key = f"{normalize_model_text(brand)}_{normalize_model_text(model)}"
                        mapping[key] = var_id
        return mapping
    except Exception as e:
        logger.warning(f"Lỗi khi tải bảng ánh xạ Haravan từ sheet {target_sheet}: {e}")
        return {}


async def sync_haravan_ids(
    apps_script_url: str, sheet_url: str, haravan_shop_url: str, haravan_access_token: str
) -> dict:
    if not apps_script_url or not sheet_url or not haravan_shop_url or not haravan_access_token:
        raise ValueError("Thiếu cấu hình Apps Script URL, Sheet URL, Haravan Shop URL hoặc Access Token.")

    page = 1
    rows = []

    while True:
        products = await fetch_haravan_products(haravan_shop_url, haravan_access_token, page)
        if not products:
            break

        for product in products:
            brand = detect_brand(product)
            product_name = product.get("title") or ""
            for variant in product.get("variants") or []:
                model = extract_model(product, variant)
                rows.append(
                    {
                        "product_name": product_name,
                        "brand": brand,
                        "model": model,
                        "variant_id": str(variant.get("id") or ""),
                    }
                )

        page += 1
        if page > 100:
            break

    write_result = await write_haravan_ids_sheet(apps_script_url, sheet_url, rows)
    return {"ok": True, "fetched": len(rows), "written": write_result.get("written") or 0}


async def update_haravan_variant_price(
    haravan_shop_url: str, haravan_access_token: str, variant_id: str, price: Any
) -> dict:
    return await update_haravan_variant_price_api(haravan_shop_url, haravan_access_token, variant_id, price)


async def send_telegram_notification(telegram_bot_token: str, telegram_chat_id: str, message: str) -> dict:
    return await send_telegram_message(telegram_bot_token, telegram_chat_id, message)


async def write_haravan_log(
    apps_script_url: str, sheet_url: str, brand: str, model: str, price: Any, status: str
) -> dict:
    timestamp = datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    return await write_haravan_log_sheet(
        apps_script_url=apps_script_url,
        sheet_url=sheet_url,
        brand=brand,
        model=model,
        price=price,
        status=status,
        timestamp=timestamp,
    )
