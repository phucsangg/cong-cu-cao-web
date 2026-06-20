import json
import re
from typing import Any

import httpx

from crawldata.crawlers.fetcher import fetch_html
from crawldata.utils.text import extract_sheet_names_from_html, normalize_vietnamese_text


def extract_sheet_id(sheet_url: str = "") -> str:
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", str(sheet_url))
    if not match:
        raise ValueError("Không đọc được Sheet ID từ Google Sheet URL.")
    return match.group(1)


async def call_apps_script(
    apps_script_url: str, method: str = "GET", payload: dict | None = None, params: dict | None = None
) -> dict:
    if (
        not apps_script_url
        or "your_google_apps_script" in apps_script_url
        or not apps_script_url.startswith(("http://", "https://"))
    ):
        raise ValueError(
            "Vui lòng cấu hình APPS_SCRIPT_URL hợp lệ trong file .env. "
            "Bạn cần deploy scripts/google-sheet-pricing-apps-script.gs thành Web App và copy URL dán vào .env."
        )

    headers = {"Content-Type": "application/json"}
    timeout = httpx.Timeout(45.0, connect=15.0)

    async with httpx.AsyncClient(timeout=timeout, verify=False, follow_redirects=True) as client:
        if method.upper() == "POST":
            response = await client.post(apps_script_url, json=payload, params=params, headers=headers)
        else:
            response = await client.get(apps_script_url, params=params, headers=headers)

        if response.status_code != 200:
            raise httpx.HTTPStatusError(
                f"Apps Script lỗi HTTP {response.status_code}", request=response.request, response=response
            )

        raw_text = response.text
        try:
            data = json.loads(raw_text)
        except Exception:
            normalized_text = normalize_vietnamese_text(raw_text)
            if any(
                k in normalized_text
                for k in [
                    "khong tim thay trang",
                    "tep ma ban yeu cau khong ton tai",
                    "requested file does not exist",
                ]
            ):
                raise ValueError("Apps Script URL không tồn tại hoặc deployment /exec đã bị thay đổi.")
            raise ValueError("Apps Script không trả về JSON hợp lệ. Kiểm tra lại deployment web app /exec.")

        if data and data.get("ok") is False:
            err_msg = data.get("error", "Apps Script trả về lỗi.")
            action_name = (params or {}).get("action") or (payload or {}).get("action") or ""
            if action_name == "listSheets" and "action get khong hop le" in normalize_vietnamese_text(err_msg):
                raise ValueError(
                    "Apps Script deployment hiện tại chưa hỗ trợ listSheets qua GET. Hãy redeploy bản mới của web app."
                )
            raise ValueError(err_msg)

        return data


async def list_spreadsheet_sheets(apps_script_url: str, sheet_url: str) -> dict:
    sheet_id = extract_sheet_id(sheet_url)
    try:
        return await call_apps_script(
            apps_script_url, method="GET", params={"action": "listSheets", "sheetId": sheet_id}
        )
    except Exception as e:
        norm_msg = normalize_vietnamese_text(str(e))
        can_fallback = any(
            k in norm_msg
            for k in [
                "listsheets qua get",
                "khong ton tai hoac deployment",
                "khong tra ve json hop le",
                "apps script loi http 404",
            ]
        )
        if not can_fallback:
            raise e

        # HTML fallback
        html = await fetch_html(sheet_url)
        sheets = extract_sheet_names_from_html(html)
        if not sheets:
            raise e
        return {"ok": True, "sheets": sheets, "source": "public-html-fallback"}


async def read_sheet_rows_raw(
    apps_script_url: str,
    sheet_url: str,
    sheet_name: str,
    start_row: int = 3,
    end_row: int | None = None,
) -> dict:
    sheet_id = extract_sheet_id(sheet_url)
    data = await call_apps_script(
        apps_script_url,
        method="GET",
        params={
            "action": "readRows",
            "sheetId": sheet_id,
            "sheetName": sheet_name,
            "startRow": start_row,
            "endRow": end_row or "",
        },
    )
    return data


async def write_sheet_updates(
    apps_script_url: str, sheet_url: str, sheet_name: str, updates: list[dict], logs: list[dict] | None = None
) -> dict:
    sheet_id = extract_sheet_id(sheet_url)
    payload = {
        "action": "writePricing",
        "sheetId": sheet_id,
        "sheetName": sheet_name,
        "updates": updates,
        "logs": logs or [],
    }
    return await call_apps_script(apps_script_url, method="POST", payload=payload)


async def write_haravan_ids_sheet(apps_script_url: str, sheet_url: str, rows: list[dict]) -> dict:
    sheet_id = extract_sheet_id(sheet_url)
    payload = {
        "action": "writeHaravanIds",
        "sheetId": sheet_id,
        "rows": rows,
    }
    return await call_apps_script(apps_script_url, method="POST", payload=payload)


async def write_haravan_log_sheet(
    apps_script_url: str, sheet_url: str, brand: str, model: str, price: Any, status: str, timestamp: str
) -> dict:
    sheet_id = extract_sheet_id(sheet_url)
    payload = {
        "action": "writeHaravanLog",
        "sheetId": sheet_id,
        "brand": brand,
        "model": model,
        "price": price,
        "status": status,
        "timestamp": timestamp,
    }
    return await call_apps_script(apps_script_url, method="POST", payload=payload)


async def update_sheet_sale_price_raw(
    apps_script_url: str, sheet_url: str, sheet_name: str, row_number: int, price: Any
) -> dict:
    sheet_id = extract_sheet_id(sheet_url)
    payload = {
        "action": "updateSalePrice",
        "sheetId": sheet_id,
        "sheetName": sheet_name,
        "rowNumber": int(row_number),
        "price": int(price),
    }
    return await call_apps_script(apps_script_url, method="POST", payload=payload)
