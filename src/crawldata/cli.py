import asyncio
import json
import time
from functools import wraps
from typing import Optional

import typer

from crawldata.cache.store import pricing_cache
from crawldata.config import settings
from crawldata.jobs.manager import job_manager
from crawldata.jobs.pricing_job import _run_pricing_job_async
from crawldata.services.haravan_service import (
    send_telegram_notification,
    sync_haravan_ids,
    update_haravan_variant_price,
    write_haravan_log,
)
from crawldata.services.sheet_pricing_service import (
    list_spreadsheet_sheets,
    process_pricing_row,
)

app = typer.Typer(help="CrawlData CLI tool for Auto-Pricing and Google Sheets/Haravan Synchronization.")

sheets_app = typer.Typer(help="Google Sheets commands.")
pricing_app = typer.Typer(help="Pricing run and row extraction commands.")
haravan_app = typer.Typer(help="Haravan sync and pricing commands.")
telegram_app = typer.Typer(help="Telegram notification commands.")
cache_app = typer.Typer(help="Local cache store operations.")
config_app = typer.Typer(help="Configuration helpers.")

app.add_typer(sheets_app, name="sheets")
app.add_typer(pricing_app, name="pricing")
app.add_typer(haravan_app, name="haravan")
app.add_typer(telegram_app, name="telegram")
app.add_typer(cache_app, name="cache")
app.add_typer(config_app, name="config")


def async_command(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        return asyncio.run(f(*args, **kwargs))

    return wrapper


def mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return f"{value[:4]}****{value[-4:]}"


# --- CONFIG COMMANDS ---


@config_app.command("show")
def config_show():
    """
    Show current settings loaded from environment or .env file.
    """
    typer.echo("=== Cau hinh CrawlData ===")
    typer.echo(f"Google Sheets Apps Script URL: {settings.apps_script_url or 'Chua cau hinh'}")
    typer.echo(f"Google Spreadsheet URL:       {settings.sheet_url or 'Chua cau hinh'}")
    typer.echo(f"Ten sheet mac dinh:           {settings.sheet_name or 'Chua cau hinh'}")
    typer.echo(f"Telegram Bot Token:           {mask_secret(settings.telegram_bot_token)}")
    typer.echo(f"Telegram Chat ID:             {mask_secret(settings.telegram_chat_id)}")
    typer.echo(f"Haravan Shop URL:             {settings.haravan_shop_url or 'Chua cau hinh'}")
    typer.echo(f"Haravan Access Token:         {mask_secret(settings.haravan_access_token)}")


# --- SHEETS COMMANDS ---


@sheets_app.command("list")
@async_command
async def sheets_list(
    apps_script_url: str = typer.Option(settings.apps_script_url, "--apps-script-url", help="Apps Script Web App URL."),
    sheet_url: str = typer.Option(settings.sheet_url, "--sheet-url", help="Google Spreadsheet URL."),
):
    """
    List names of all sheets in the target Google Spreadsheet.
    """
    if not apps_script_url or not sheet_url:
        typer.echo("Error: Thieu cau hinh Apps Script URL hoac Spreadsheet URL.", err=True)
        raise typer.Exit(code=1)

    typer.echo("Dang lay danh sach cac sheet...")
    try:
        res = await list_spreadsheet_sheets(apps_script_url, sheet_url)
        sheets = res.get("sheets") or []
        if not sheets:
            typer.echo("Khong tim thay sheet nao.")
            return

        typer.echo("\nDanh sach sheets:")
        for idx, name in enumerate(sheets, 1):
            typer.echo(f" {idx}. {name}")
    except Exception as e:
        typer.echo(f"Loi: {e}", err=True)
        raise typer.Exit(code=1)


# --- PRICING COMMANDS ---


@pricing_app.command("run")
@async_command
async def pricing_run(
    sheet: str = typer.Option(settings.sheet_name, "--sheet", "-s", help="Ten sheet can quet (vi du: '20.Haravan')."),
    apps_script_url: str = typer.Option(
        settings.apps_script_url, "--apps-script-url", help="Google Apps Script Web App URL."
    ),
    sheet_url: str = typer.Option(settings.sheet_url, "--sheet-url", help="Google Spreadsheet URL."),
    start_row: int = typer.Option(3, "--start-row", help="Dong bat dau quet."),
    end_row: Optional[int] = typer.Option(None, "--end-row", help="Dong ket thuc quet (mac dinh quet het)."),  # noqa: UP007
    rows_concurrency: int = typer.Option(2, "--rows-concurrency", help="So luong dong xu ly song song."),
    links_concurrency: int = typer.Option(4, "--links-concurrency", help="So luong link crawl song song moi dong."),
    batch_size: int = typer.Option(10, "--batch-size", help="So luong dong gom lai de ghi cap nhat sheet."),
    specific_rows: Optional[str] = typer.Option(  # noqa: UP007
        None, "--specific-rows", help="Danh sach dong cu the can quet (vi du: '3,5,20-30')."
    ),
    scan_to_end: bool = typer.Option(
        False, "--scan-to-end", help="Quet tiep tu dong nho nhat trong specific-rows den dong cuoi cung."
    ),
):
    """
    Start spreadsheet pricing crawl job in foreground with real-time logs.
    """
    if not apps_script_url or not sheet_url or not sheet:
        typer.echo("Error: Thieu cau hinh Apps Script URL, Spreadsheet URL, hoac ten Sheet.", err=True)
        raise typer.Exit(code=1)

    job_id = f"job_cli_{int(time.time() * 1000)}"
    config = {
        "appsScriptUrl": apps_script_url,
        "sheetUrl": sheet_url,
        "sheetName": sheet,
        "startRow": start_row,
        "endRow": end_row,
        "specificRowsEnabled": bool(specific_rows),
        "scanToEndEnabled": scan_to_end,
        "specificRows": specific_rows or "",
        "rowsConcurrency": rows_concurrency,
        "linksConcurrency": links_concurrency,
        "batchSize": batch_size,
    }

    # Register job locally in manager
    await job_manager.register_job(job_id, config)

    typer.echo(f"Khoi chay job {job_id} cho sheet '{sheet}'...")
    try:
        await _run_pricing_job_async(
            job_id=job_id,
            apps_script_url=apps_script_url,
            sheet_url=sheet_url,
            sheet_name=sheet,
        )
        status = await job_manager.get_job_status(job_id)
        if status:
            typer.echo("\n--- Ket qua Job ---")
            typer.echo(f"Trang thai:     {status['status'].upper()}")
            typer.echo(f"Tong dong:      {status['totalRows']}")
            typer.echo(f"Da xu ly:       {status['processedCount']}")
            typer.echo(f"Thanh cong:     {status['successCount']}")
            typer.echo(f"Loi/Thieu gia:  {status['errorCount']}")
            typer.echo(f"Ghi thanh cong: {status['writeCount']}")
    except KeyboardInterrupt:
        typer.echo("\nPhat hien ngat tu nguoi dung. Dang gui tin hieu dung job...")
        await job_manager.stop_job(job_id)
        typer.echo("Da dung job.")
    except Exception as e:
        typer.echo(f"Loi khi thuc thi job: {e}", err=True)
        raise typer.Exit(code=1)


@pricing_app.command("row")
@async_command
async def pricing_row(
    brand: str = typer.Option(..., "--brand", "-b", help="Thuong hieu san pham."),
    model: str = typer.Option(..., "--model", "-m", help="Model san pham."),
    list_price: Optional[str] = typer.Option(None, "--list-price", help="Gia niem yet."),  # noqa: UP007
    cost_price: Optional[str] = typer.Option(None, "--cost-price", help="Gia von."),  # noqa: UP007
    sale_price: Optional[str] = typer.Option(None, "--sale-price", help="Gia ban hien tai."),  # noqa: UP007
    sheet_name: Optional[str] = typer.Option("", "--sheet-name", help="Ten sheet context."),  # noqa: UP007
    links_concurrency: int = typer.Option(4, "--links-concurrency", help="So luong link crawl song song."),
):
    """
    Extract and calculate suggested pricing for a single product brand/model.
    """
    row = {
        "rowNumber": 1,
        "brand": brand,
        "model": model,
        "listPrice": list_price or "",
        "costPrice": cost_price or "",
        "salePrice": sale_price or "",
        "sheetName": sheet_name,
    }

    typer.echo(f"Dang phan tich va quet gia cho: {brand} {model}...")
    try:
        res = await process_pricing_row(row, links_concurrency=links_concurrency)
        typer.echo(json.dumps(res, ensure_ascii=False, indent=2))
    except Exception as e:
        typer.echo(f"Loi: {e}", err=True)
        raise typer.Exit(code=1)


# --- HARAVAN COMMANDS ---


@haravan_app.command("sync-ids")
@async_command
async def haravan_sync_ids(
    apps_script_url: str = typer.Option(
        settings.apps_script_url, "--apps-script-url", help="Google Apps Script Web App URL."
    ),
    sheet_url: str = typer.Option(settings.sheet_url, "--sheet-url", help="Google Spreadsheet URL."),
    haravan_shop_url: str = typer.Option(
        settings.haravan_shop_url, "--haravan-shop-url", help="Haravan Shop Domain/URL."
    ),
    haravan_access_token: str = typer.Option(
        settings.haravan_access_token, "--haravan-access-token", help="Haravan Access Token."
    ),
):
    """
    Synchronize Variant IDs from Haravan API to the target sheet.
    """
    if not apps_script_url or not sheet_url or not haravan_shop_url or not haravan_access_token:
        typer.echo(
            "Error: Thieu cau hinh Apps Script URL, Spreadsheet URL, Haravan Shop URL hoac Access Token.", err=True
        )
        raise typer.Exit(code=1)

    typer.echo("Bat dau dong bo danh muc Haravan Variant IDs...")
    try:
        res = await sync_haravan_ids(
            apps_script_url=apps_script_url,
            sheet_url=sheet_url,
            haravan_shop_url=haravan_shop_url,
            haravan_access_token=haravan_access_token,
        )
        typer.echo(f"Thanh cong! Da lay {res['fetched']} variant, ghi vao sheet: {res['written']}.")
    except Exception as e:
        typer.echo(f"Loi: {e}", err=True)
        raise typer.Exit(code=1)


@haravan_app.command("update-price")
@async_command
async def haravan_update_price(
    variant_id: str = typer.Argument(..., help="Variant ID cua Haravan."),
    price: int = typer.Argument(..., help="Gia ban moi can cap nhat."),
    haravan_shop_url: str = typer.Option(
        settings.haravan_shop_url, "--haravan-shop-url", help="Haravan Shop Domain/URL."
    ),
    haravan_access_token: str = typer.Option(
        settings.haravan_access_token, "--haravan-access-token", help="Haravan Access Token."
    ),
    write_log: bool = typer.Option(False, "--write-log", help="Ghi nhan nhat ky cap nhat ve Google Sheet LOG."),
    apps_script_url: str = typer.Option(
        settings.apps_script_url, "--apps-script-url", help="Google Apps Script URL (neu ghi log)."
    ),
    sheet_url: str = typer.Option(settings.sheet_url, "--sheet-url", help="Spreadsheet URL (neu ghi log)."),
    brand: str = typer.Option("", "--brand", help="Thuong hieu san pham (de ghi log)."),
    model: str = typer.Option("", "--model", help="Model san pham (de ghi log)."),
):
    """
    Directly update the price of a variant ID in Haravan store catalog.
    """
    if not haravan_shop_url or not haravan_access_token:
        typer.echo("Error: Thieu cau hinh Haravan Shop URL hoac Access Token.", err=True)
        raise typer.Exit(code=1)

    typer.echo(f"Dang cap nhat variant ID {variant_id} thanh gia {price:,} đ...")
    try:
        await update_haravan_variant_price(
            haravan_shop_url=haravan_shop_url,
            haravan_access_token=haravan_access_token,
            variant_id=variant_id,
            price=price,
        )
        typer.echo("Cap nhat Haravan thanh cong!")

        if write_log:
            if not apps_script_url or not sheet_url:
                typer.echo("Canh bao: Khong the ghi log do thieu Apps Script URL hoac Spreadsheet URL.")
                return
            typer.echo("Dang ghi nhan log ve Google Sheets...")
            await write_haravan_log(
                apps_script_url=apps_script_url,
                sheet_url=sheet_url,
                brand=brand,
                model=model,
                price=price,
                status="success",
            )
            typer.echo("Da ghi log thanh cong.")
    except Exception as e:
        typer.echo(f"Loi: {e}", err=True)
        if write_log and apps_script_url and sheet_url:
            try:
                await write_haravan_log(
                    apps_script_url=apps_script_url,
                    sheet_url=sheet_url,
                    brand=brand,
                    model=model,
                    price=price,
                    status=f"error: {e!s}",
                )
            except Exception:
                pass
        raise typer.Exit(code=1)


# --- TELEGRAM COMMANDS ---


@telegram_app.command("send")
@async_command
async def telegram_send(
    message: str = typer.Argument(..., help="Noi dung thong diep."),
    telegram_bot_token: str = typer.Option(settings.telegram_bot_token, "--bot-token", help="Telegram Bot Token."),
    telegram_chat_id: str = typer.Option(settings.telegram_chat_id, "--chat-id", help="Telegram Chat ID."),
):
    """
    Send a message via Telegram Bot.
    """
    if not telegram_bot_token or not telegram_chat_id:
        typer.echo("Error: Thieu Telegram Bot Token hoac Chat ID.", err=True)
        raise typer.Exit(code=1)

    typer.echo("Dang gui tin nhan qua Telegram...")
    try:
        await send_telegram_notification(
            telegram_bot_token=telegram_bot_token,
            telegram_chat_id=telegram_chat_id,
            message=message,
        )
        typer.echo("Gui thanh cong!")
    except Exception as e:
        typer.echo(f"Loi gui Telegram: {e}", err=True)
        raise typer.Exit(code=1)


# --- CACHE COMMANDS ---


@cache_app.command("clear")
def cache_clear():
    """
    Clear all local pricing, HTML page and engine search cache entries.
    """
    typer.echo("Dang xoa toan bo cache luu tru...")
    try:
        pricing_cache.clear()
        typer.echo("Xoa cache thanh cong!")
    except Exception as e:
        typer.echo(f"Loi: {e}", err=True)
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
