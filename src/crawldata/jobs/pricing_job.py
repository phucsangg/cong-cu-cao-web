import asyncio
import datetime
import time
from typing import Any

from crawldata.jobs.manager import job_manager
from crawldata.logger import logger
from crawldata.pricing import parse_vietnamese_price
from crawldata.services.sheet_pricing_service import (
    is_valid_brand,
    is_valid_model,
    load_model_mapping,
    process_pricing_row,
    read_sheet_rows,
    write_sheet_updates,
)
from crawldata.utils.rows import (
    clean_numeric_code,
    normalize_selected_sheet_names,
    parse_specific_rows,
)


async def _run_pricing_job_async(job_id: str, apps_script_url: str, sheet_url: str, sheet_name: Any):
    job = await job_manager.get_job(job_id)
    if not job:
        logger.error(f"Job {job_id} not found in manager.")
        return

    def log(message, level="info"):
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        job["logs"].append({"timestamp": timestamp, "message": message, "level": level})
        logger.info(f"[{job_id}] [{level.upper()}] {message}")

    try:
        sheet_names = normalize_selected_sheet_names(sheet_name)
        if not sheet_names:
            job["status"] = "error"
            log("Lỗi: Tên sheet không hợp lệ.", "error")
            return

        log(f"Bắt đầu đọc dữ liệu từ các sheet: {', '.join(sheet_names)}...")
        log("Đang tải bảng ánh xạ model từ sheet 18.Mã sản phẩm...")
        model_mapping = await load_model_mapping(apps_script_url, sheet_url)
        if model_mapping:
            log(f"Đã tải thành công {len(model_mapping)} ánh xạ model từ 18.Mã sản phẩm.", "success")
        else:
            log("Không tìm thấy ánh xạ model nào hoặc lỗi tải 18.Mã sản phẩm.", "warning")

        # Load sheet rows
        row_set = (
            parse_specific_rows(job["specific_rows"]) if job["specificRowsEnabled"] and job["specific_rows"] else None
        )
        is_scan_to_end = job["specificRowsEnabled"] and job["scanToEndEnabled"]

        fetch_promises = []
        for name in sheet_names:
            fetch_promises.append(
                read_sheet_rows(
                    apps_script_url=apps_script_url,
                    sheet_url=sheet_url,
                    sheet_name=name,
                    start_row=job["startRow"],
                    end_row=job["endRow"],
                    specific_rows_enabled=job["specificRowsEnabled"],
                    scan_to_end_enabled=job["scanToEndEnabled"],
                    specific_rows=job["specific_rows"],
                )
            )

        fetch_results = await asyncio.gather(*fetch_promises)
        merged_rows = []
        for idx, res in enumerate(fetch_results):
            name = sheet_names[idx]
            for r in res.get("rows") or []:
                r_copy = dict(r)
                r_copy["sheetName"] = name
                merged_rows.append(r_copy)

        filtered_merged = merged_rows
        if row_set and not is_scan_to_end:
            filtered_merged = [r for r in merged_rows if r["rowNumber"] in row_set]

        # Apply model mapping
        merged_mapped = []
        for row in filtered_merged:
            cleaned_code = clean_numeric_code(row["model"])
            model_val = str(row["model"] or "").strip()
            mapped = False
            if cleaned_code.isdigit() and cleaned_code in model_mapping:
                model_val = model_mapping[cleaned_code]
                mapped = True
            row_copy = dict(row)
            row_copy["model"] = model_val
            row_copy["originalModel"] = row["model"] or ""
            row_copy["mappedModel"] = mapped
            merged_mapped.append(row_copy)

        job_rows = []
        for row in merged_mapped:
            if row["mappedModel"]:
                log(
                    f"Dòng {row['rowNumber']} [{row['sheetName']}]: Ánh xạ model số {row['originalModel']} thành {row['model']}."
                )
            job_rows.append(
                {
                    "rowNumber": row["rowNumber"],
                    "sheetName": row["sheetName"],
                    "productId": row.get("productId", ""),
                    "brand": row["brand"],
                    "model": row["model"],
                    "originalModel": row["originalModel"],
                    "listPrice": row["listPrice"] or "",
                    "costPrice": row["costPrice"] or "",
                    "salePrice": row["salePrice"] or "",
                    "salePriceValue": parse_vietnamese_price(row["salePrice"]),
                    "status": "pending"
                    if (is_valid_brand(row["brand"]) and is_valid_model(row["model"]))
                    else "skipped",
                    "marketPrices": row["marketPrices"] or [],
                    "matchedDetails": [],
                    "minPrice": None,
                    "gapValue": None,
                    "gapPercent": None,
                    "suggestedPrice": None,
                    "writtenToSheet": False,
                    "errorMessage": "",
                }
            )
        job["rows"] = job_rows
        runnable_rows = [r for r in merged_mapped if is_valid_brand(r["brand"]) and is_valid_model(r["model"])]
        job["totalRows"] = len(job_rows)

        skipped_count = sum(1 for r in job_rows if r["status"] == "skipped")
        job["processedCount"] += skipped_count
        if skipped_count > 0:
            log(f"Bỏ qua {skipped_count} dòng do thiếu Thương hiệu hoặc Model, hoặc Model chỉ toàn số.")

        log(f"Đã đọc {len(job_rows)} dòng từ Google Sheet. Có {len(runnable_rows)} dòng hợp lệ để xử lý.")
        if not runnable_rows:
            job["status"] = "completed"
            log("Không có dòng nào đủ điều kiện xử lý.")
            return

        cursor = 0
        pending_updates = []
        write_lock = asyncio.Lock()

        async def flush_updates(force=False):
            nonlocal pending_updates
            if not pending_updates:
                return
            if not force and len(pending_updates) < job["batchSize"]:
                return

            async with write_lock:
                while pending_updates:
                    batch = list(pending_updates)
                    pending_updates.clear()
                    if not batch:
                        break

                    try:
                        updates_by_sheet = {}
                        for u in batch:
                            sheet_n = u["sheetName"]
                            if sheet_n not in updates_by_sheet:
                                updates_by_sheet[sheet_n] = []
                            updates_by_sheet[sheet_n].append(u)

                        async def write_sheet_batch(name, sheet_updates):
                            sheet_logs = []
                            for u in sheet_updates:
                                for detail in u.get("matchedDetails") or []:
                                    timestamp_str = datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")
                                    sheet_logs.append(
                                        {
                                            "timestamp": timestamp_str,
                                            "brand": u.get("brand") or "",
                                            "model": u.get("model") or "",
                                            "price": detail["price"],
                                            "url": detail["url"],
                                        }
                                    )
                            try:
                                await write_sheet_updates(
                                    apps_script_url=apps_script_url,
                                    sheet_url=sheet_url,
                                    sheet_name=name,
                                    updates=sheet_updates,
                                    logs=sheet_logs,
                                )
                                for u in sheet_updates:
                                    target = next(
                                        (
                                            r
                                            for r in job["rows"]
                                            if r["sheetName"] == u["sheetName"] and r["rowNumber"] == u["rowNumber"]
                                        ),
                                        None,
                                    )
                                    if target:
                                        target["writtenToSheet"] = True
                                    job["writeCount"] += 1
                                    log(
                                        f"Đã ghi thành công kết quả dòng {u['rowNumber']} [{u['sheetName']}] về Google Sheet.",
                                        "success",
                                    )
                            except Exception as e:
                                # Put failed back to pending
                                pending_updates.extend(sheet_updates)
                                log(
                                    f"Ghi kết quả dòng {', '.join(str(u['rowNumber']) for u in sheet_updates)} [{name}] thất bại: {e}",
                                    "error",
                                )
                                raise e

                        await asyncio.gather(*(write_sheet_batch(name, ups) for name, ups in updates_by_sheet.items()))
                    except Exception:
                        break

        async def worker():
            nonlocal cursor
            while not job["stopRequested"]:
                async with job_manager.lock:
                    idx = cursor
                    cursor += 1
                if idx >= len(runnable_rows):
                    break

                row = runnable_rows[idx]
                active_item = next(
                    (
                        r
                        for r in job["rows"]
                        if r["sheetName"] == row["sheetName"] and r["rowNumber"] == row["rowNumber"]
                    ),
                    None,
                )
                if active_item:
                    active_item["status"] = "processing"

                try:
                    log(f"Đang xử lý dòng {row['rowNumber']} [{row['sheetName']}]: {row['brand']} {row['model']}...")
                    res = await process_pricing_row(
                        row={
                            "rowNumber": row["rowNumber"],
                            "brand": row["brand"],
                            "model": row["model"],
                            "listPrice": row["listPrice"],
                            "costPrice": row["costPrice"],
                            "salePrice": row["salePrice"],
                            "marketPrices": row["marketPrices"],
                            "sheetName": row["sheetName"],
                        },
                        links_concurrency=job["linksConcurrency"],
                    )

                    if job["stopRequested"]:
                        if active_item and active_item["status"] == "processing":
                            active_item["status"] = "skipped"
                            active_item["errorMessage"] = "Đã dừng theo yêu cầu người dùng."
                        break

                    if active_item:
                        active_item.update(
                            {
                                "status": res["status"],
                                "marketPrices": res["marketPrices"],
                                "minPrice": res["minPrice"],
                                "gapValue": res["gapValue"],
                                "gapPercent": res["gapPercent"],
                                "suggestedPrice": res["suggestedPrice"],
                                "matchedUrls": res["matchedUrls"],
                                "matchedDetails": res["matchedDetails"],
                                "pricingLogs": res.get("pricingLogs", []),
                            }
                        )

                    job["lastResult"] = res
                    job["processedCount"] += 1
                    if res["status"] == "success":
                        job["successCount"] += 1
                        min_price_str = f"{res['minPrice']:,} đ".replace(",", ".") if res["minPrice"] else "-"
                        sugg_price_str = (
                            f"{res['suggestedPrice']:,} đ".replace(",", ".") if res["suggestedPrice"] else "-"
                        )
                        log(
                            f"Dòng {row['rowNumber']} [{row['sheetName']}] ({row['brand']} {row['model']}) thành công: Tìm thấy {res['totalLinksCount']} cửa hàng, quét được {len(res['marketPrices'])} giá. Min={min_price_str}, Đề xuất={sugg_price_str}",
                            "success",
                        )
                    else:
                        job["errorCount"] += 1
                        min_price_str = f"{res['minPrice']:,} đ".replace(",", ".") if res["minPrice"] else "-"
                        log(
                            f"Dòng {row['rowNumber']} [{row['sheetName']}] ({row['brand']} {row['model']}) thành công (thiếu giá hoặc ít hơn 3 giá): Tìm thấy {res['totalLinksCount']} cửa hàng, quét được {len(res['marketPrices'])} giá. Min={min_price_str}",
                            "warning",
                        )

                    pending_updates.append(
                        {
                            "rowNumber": res["rowNumber"],
                            "sheetName": row["sheetName"],
                            "brand": row["brand"],
                            "model": row["model"],
                            "marketPrices": res["marketPrices"],
                            "hasNewPrices": res["hasNewPrices"],
                            "minPrice": res["minPrice"],
                            "gapValue": res["gapValue"],
                            "gapPercent": res["gapPercent"],
                            "suggestedPrice": res["suggestedPrice"],
                            "status": res["status"],
                            "matchedDetails": res["matchedDetails"],
                        }
                    )
                    await flush_updates(False)
                except Exception as err:
                    job["processedCount"] += 1
                    job["errorCount"] += 1
                    if active_item:
                        active_item["status"] = "error"
                        active_item["errorMessage"] = str(err)
                    log(
                        f"Lỗi xử lý dòng {row['rowNumber']} [{row['sheetName']}] ({row['brand']} {row['model']}): {err}",
                        "error",
                    )

        workers = [worker() for _ in range(min(job["rowsConcurrency"], len(runnable_rows)))]
        await asyncio.gather(*workers)
        await flush_updates(True)

        if job["stopRequested"]:
            job["status"] = "stopped"
            log("Job đã dừng theo yêu cầu người dùng.")
        else:
            job["status"] = "completed"
            log(
                f"Đã hoàn thành job pricing. Thành công: {job['successCount']}, Lỗi/Thiếu giá: {job['errorCount']}.",
                "success",
            )
    except Exception as e:
        job["status"] = "error"
        log(f"Lỗi cấu hình hoặc runtime của Job: {e}", "error")


def start_background_pricing_job(config: dict) -> str:
    job_id = f"job_{int(time.time() * 1000)}"
    # Register job state parameters asynchronously
    loop = asyncio.get_event_loop()
    if loop.is_running():
        # Setup job in job manager sync/async wrapper
        asyncio.create_task(_start_job_async_helper(job_id, config))
    else:
        asyncio.run(_start_job_async_helper(job_id, config))
    return job_id


async def _start_job_async_helper(job_id: str, config: dict):
    await job_manager.register_job(job_id, config)
    asyncio.create_task(
        _run_pricing_job_async(
            job_id=job_id,
            apps_script_url=config.get("appsScriptUrl"),
            sheet_url=config.get("sheetUrl"),
            sheet_name=config.get("sheetName"),
        )
    )
