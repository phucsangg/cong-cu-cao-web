from typing import Any

from pydantic import BaseModel, Field


class PricingRow(BaseModel):
    rowNumber: int
    productId: str | None = ""
    brand: str
    model: str
    listPrice: Any | None = ""
    costPrice: Any | None = ""
    salePrice: Any | None = ""
    marketPrices: list[int] = Field(default_factory=list)
    sheetName: str | None = ""


class PricingResult(BaseModel):
    marketPrices: list[int] = Field(default_factory=list)
    minPrice: int | None = None
    maxPrice: int | None = None
    avgPrice: int | None = None
    medianPrice: int | None = None
    gapValue: int | None = None
    gapPercent: float | None = None
    suggestedPrice: int | None = None
    outlierRemoved: bool = False


class SearchCandidate(BaseModel):
    url: str
    score: int


class JobStatus(BaseModel):
    id: str
    status: str
    totalRows: int
    processedCount: int
    successCount: int
    errorCount: int
    writeCount: int
    logs: list[dict[str, Any]] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)
    lastResult: dict[str, Any] | None = None
