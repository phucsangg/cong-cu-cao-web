from crawldata.jobs.manager import job_manager
from crawldata.services.haravan_service import (
    load_haravan_mapping,
    send_telegram_notification,
    sync_haravan_ids,
    update_haravan_variant_price,
    write_haravan_log,
)
from crawldata.services.sheet_pricing_service import (
    list_spreadsheet_sheets,
    load_model_mapping,
    process_pricing_row,
    read_sheet_rows,
    update_sheet_sale_price,
    write_sheet_updates,
)


async def get_background_pricing_job_status(job_id: str) -> dict | None:
    return await job_manager.get_job_status(job_id)


async def stop_background_pricing_job(job_id: str) -> bool:
    return await job_manager.stop_job(job_id)


__all__ = [
    "process_pricing_row",
    "read_sheet_rows",
    "write_sheet_updates",
    "list_spreadsheet_sheets",
    "load_model_mapping",
    "update_sheet_sale_price",
    "load_haravan_mapping",
    "sync_haravan_ids",
    "update_haravan_variant_price",
    "send_telegram_notification",
    "write_haravan_log",
    "get_background_pricing_job_status",
    "stop_background_pricing_job",
]
