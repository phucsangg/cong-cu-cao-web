from typing import Any


class SheetsGoogleApiAdapter:
    """
    Skeleton/stub adapter for native Google Sheets API v4.
    Requires google-api-python-client & google-auth credentials.
    """

    def __init__(self, credentials_path: str | None = None):
        self.credentials_path = credentials_path

    async def list_spreadsheet_sheets(self, sheet_url: str) -> list[str]:
        raise NotImplementedError("Native Google Sheets API v4 is not implemented. Please use Apps Script adapter.")

    async def read_sheet_rows_raw(
        self,
        sheet_url: str,
        sheet_name: str,
        start_row: int = 3,
        end_row: int | None = None,
    ) -> dict:
        raise NotImplementedError("Native Google Sheets API v4 is not implemented. Please use Apps Script adapter.")

    async def write_sheet_updates(
        self, sheet_url: str, sheet_name: str, updates: list[dict], logs: list[dict] | None = None
    ) -> dict:
        raise NotImplementedError("Native Google Sheets API v4 is not implemented. Please use Apps Script adapter.")

    async def write_haravan_ids_sheet(self, sheet_url: str, rows: list[dict]) -> dict:
        raise NotImplementedError("Native Google Sheets API v4 is not implemented. Please use Apps Script adapter.")

    async def write_haravan_log_sheet(
        self, sheet_url: str, brand: str, model: str, price: Any, status: str, timestamp: str
    ) -> dict:
        raise NotImplementedError("Native Google Sheets API v4 is not implemented. Please use Apps Script adapter.")

    async def update_sheet_sale_price_raw(self, sheet_url: str, sheet_name: str, row_number: int, price: Any) -> dict:
        raise NotImplementedError("Native Google Sheets API v4 is not implemented. Please use Apps Script adapter.")
