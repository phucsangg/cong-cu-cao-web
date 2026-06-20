import math

from crawldata.utils.money import parse_vietnamese_price


def get_percentile(arr: list[float], p: float) -> float:
    if not arr:
        return 0.0
    if len(arr) == 1:
        return arr[0]

    index = p * (len(arr) - 1)
    low = math.floor(index)
    high = math.ceil(index)
    weight = index - low
    return arr[low] * (1 - weight) + arr[high] * weight


def remove_outliers_iqr(sorted_prices: list[int]) -> dict:
    if len(sorted_prices) < 4:
        return {"filtered": list(sorted_prices), "outlierRemoved": False}
    q1 = get_percentile(sorted_prices, 0.25)
    q3 = get_percentile(sorted_prices, 0.75)
    iqr = q3 - q1
    lower_bound = q1 - 1.5 * iqr
    upper_bound = q3 + 1.5 * iqr

    filtered = [p for p in sorted_prices if lower_bound <= p <= upper_bound]
    outlier_removed = len(filtered) < len(sorted_prices)
    return {"filtered": filtered, "outlierRemoved": outlier_removed}


def get_median(arr: list[int]) -> int | None:
    if not arr:
        return None
    mid = len(arr) // 2
    if len(arr) % 2 != 0:
        return arr[mid]
    return int(round((arr[mid - 1] + arr[mid]) / 2))


def compute_suggested_pricing(list_price, cost_price, current_sale_price, prices: list = None) -> dict:
    if prices is None:
        prices = []

    parsed_prices = []
    for price in prices:
        parsed = parse_vietnamese_price(price)
        if parsed is not None and parsed > 0:
            parsed_prices.append(parsed)

    sorted_prices = sorted(parsed_prices)
    market_prices = sorted_prices[:10]

    unique_prices = sorted(list(set(parsed_prices)))

    iqr_res = remove_outliers_iqr(unique_prices)
    iqr_filtered = iqr_res["filtered"]
    iqr_removed = iqr_res["outlierRemoved"]

    min_price = iqr_filtered[0] if iqr_filtered else None
    max_price = iqr_filtered[-1] if iqr_filtered else None
    avg_price = int(round(sum(iqr_filtered) / len(iqr_filtered))) if iqr_filtered else None
    median_price = get_median(iqr_filtered)

    suggested_price = min_price

    sale_price_value = parse_vietnamese_price(current_sale_price)
    list_price_value = parse_vietnamese_price(list_price)
    cost_price_value = parse_vietnamese_price(cost_price)

    comparison_price = (
        suggested_price
        if suggested_price is not None
        else (sale_price_value if sale_price_value is not None else list_price_value)
    )

    gap_value = (
        (comparison_price - cost_price_value)
        if (comparison_price is not None and cost_price_value is not None)
        else None
    )
    gap_percent = (
        (gap_value / comparison_price)
        if (gap_value is not None and comparison_price is not None and comparison_price > 0)
        else None
    )

    return {
        "marketPrices": market_prices,
        "minPrice": min_price,
        "maxPrice": max_price,
        "avgPrice": avg_price,
        "medianPrice": median_price,
        "gapValue": gap_value,
        "gapPercent": gap_percent,
        "suggestedPrice": suggested_price,
        "outlierRemoved": iqr_removed,
    }
