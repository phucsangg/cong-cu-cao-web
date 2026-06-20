from crawldata.utils.helpers import (
    build_sheet_update_row,
    calculate_relevance_score,
    clean_model_specs,
    compute_suggested_pricing,
    generate_keywords,
    map_sheet_headers,
    normalize_model_text,
    parse_specific_rows,
    parse_vietnamese_price,
)


def test_parse_vietnamese_price():
    assert parse_vietnamese_price("9,120,000₫") == 9120000
    assert parse_vietnamese_price(" 11.340.000 đ ") == 11340000
    assert parse_vietnamese_price("Liên hệ") is None
    assert parse_vietnamese_price("850") == 850000
    assert parse_vietnamese_price(850) == 850000
    assert parse_vietnamese_price("689") == 689000
    assert parse_vietnamese_price("1.458.000") == 1458000
    assert parse_vietnamese_price("14.74 triệu") == 14740000
    assert parse_vietnamese_price("14,74 tr") == 14740000
    assert parse_vietnamese_price("14740k") == 14740000
    assert parse_vietnamese_price("14.7k") == 14700000
    assert parse_vietnamese_price("11800000.00") == 11800000
    assert parse_vietnamese_price("11.800.000,00 VNĐ") == 11800000
    assert parse_vietnamese_price("11800000.00đ") == 11800000
    assert parse_vietnamese_price("11800000.5") == 11800000


def test_normalize_model_text():
    assert normalize_model_text("DI-333 Pro") == "DI333PRO"
    assert normalize_model_text(" x-nano 6 plus ") == "XNANO6PLUS"


def test_compute_suggested_pricing_basic():
    result = compute_suggested_pricing(
        list_price=12000000,
        cost_price=9000000,
        current_sale_price=11040000,
        prices=[
            9000000,
            9200000,
            9300000,
            9400000,
            9500000,
            9600000,
            9700000,
            9800000,
            9900000,
            10000000,
            12000000,
        ],
    )

    assert result["marketPrices"] == [
        9000000,
        9200000,
        9300000,
        9400000,
        9500000,
        9600000,
        9700000,
        9800000,
        9900000,
        10000000,
    ]
    assert result["minPrice"] == 9000000
    assert result["gapValue"] == 9000000 - 9000000  # minPrice - costPrice
    assert result["gapPercent"] == 0.0
    assert result["suggestedPrice"] == 9000000


def test_compute_suggested_pricing_fallback():
    result = compute_suggested_pricing(
        list_price=12000000,
        cost_price=9000000,
        current_sale_price="",
        prices=[],
    )

    assert result["minPrice"] is None
    assert result["gapValue"] == 12000000 - 9000000
    assert result["gapPercent"] == (12000000 - 9000000) / 12000000
    assert result["suggestedPrice"] is None


def test_map_sheet_headers():
    headers = [
        "Mã SP",
        "Thương hiệu",
        "Model",
        "Giá niêm yết",
        "Giá vốn",
        "Giá bán",
        "Thị trường 1",
        "Thị trường 2",
        "Min",
        "Lợi nhuận",
        "% Lợi nhuận",
        "Giá đề xuất",
    ]

    mapping = map_sheet_headers(headers)

    assert mapping["brand"] == 1
    assert mapping["model"] == 2
    assert mapping["listPrice"] == 3
    assert mapping["costPrice"] == 4
    assert mapping["salePrice"] == 5
    assert mapping["marketColumns"] == [6, 7]
    assert mapping["minPrice"] == 8
    assert mapping["gapValue"] == 9
    assert mapping["gapPercent"] == 10
    assert mapping["suggestedPrice"] == 11


def test_build_sheet_update_row():
    row = build_sheet_update_row(
        market_prices=[9120000, 9340000],
        min_price=9120000,
        gap_value=500000,
        gap_percent=0.0548245614,
        suggested_price=None,
    )

    assert len(row) == 14
    assert row[:4] == [9120000, 9340000, "", ""]
    assert row[10] == 9120000
    assert row[11] == 500000
    assert row[12] == 0.0548245614
    assert row[13] == ""


def test_map_sheet_headers_parentheses():
    headers = [
        "Mã SP",
        "Thương hiệu",
        "Model",
        "Ngành hàng",
        "Giá niêm yết (₫)",
        "Giá vốn (₫)",
        "Giá bán (₫)",
        "Giá khuyến mãi (₫)",
        "Thị trường 1",
        "Thị trường 2",
        "Min",
        "Lợi nhuận",
        "% Lợi nhuận",
        "Giá đề xuất",
    ]

    mapping = map_sheet_headers(headers)

    assert mapping["brand"] == 1
    assert mapping["model"] == 2
    assert mapping["listPrice"] == 4
    assert mapping["costPrice"] == 5
    assert mapping["salePrice"] == 6
    assert mapping["marketColumns"] == [8, 9]
    assert mapping["minPrice"] == 10
    assert mapping["gapValue"] == 11
    assert mapping["gapPercent"] == 12
    assert mapping["suggestedPrice"] == 13


def test_compute_suggested_pricing_outliers():
    result = compute_suggested_pricing(
        list_price=12000000,
        cost_price=9000000,
        current_sale_price=11040000,
        prices=[
            8000000,  # Outlier
            9200000,
            9300000,
            9400000,
        ],
    )

    assert result["outlierRemoved"] is True
    assert result["minPrice"] == 9200000
    assert result["suggestedPrice"] == 9200000
    assert result["marketPrices"] == [8000000, 9200000, 9300000, 9400000]


def test_normalize_model_text_dimensions():
    assert normalize_model_text("LUVIA350 BLACK (90 cm)") == "LUVIA350BLACK90"
    assert normalize_model_text("LUVIA-350 BLACK 900mm") == "LUVIA350BLACK90"
    assert normalize_model_text("LUVIA-350 BLACK 0.9m") == "LUVIA350BLACK90"
    assert normalize_model_text("KF-IH870Z+") == "KFIH870ZPLUS"
    assert normalize_model_text("KF-IH870Z Plus") == "KFIH870ZPLUS"


def test_generate_keywords():
    keywords = generate_keywords("Bosch", "WQB245B40", "08.Giặt sấy")
    kw_set = set(keywords)

    assert "Bosch WQB245B40" in kw_set
    assert "WQB245B40" in kw_set
    assert '"WQB245B40"' in kw_set
    assert "Bosch WQB245B40 giá" in kw_set
    assert "Bosch WQB245B40 site:.vn" in kw_set
    assert "Máy sấy Bosch WQB245B40" in kw_set
    assert "Bosch Series 8 WQB245B40" in kw_set

    suffix_keywords = generate_keywords("Samsung", "QA65QN90A", "Tivi")
    suffix_set = set(suffix_keywords)
    assert "Samsung QA65QN90" in suffix_set
    assert "QA65QN90" in suffix_set
    assert '"QA65QN90"' in suffix_set
    assert "Samsung QA65QN90 giá" in suffix_set


def test_calculate_relevance_score():
    score1 = calculate_relevance_score("https://shop.vn/bep-tu-kocher-di-332pro.html", "DI-332Pro", "Kocher")
    # +150 (exact model match), +40 (exact model), +20 (brand), +10 (hyphen), +10 (html), +10 (commercial) = 240
    assert score1 == 240

    score2 = calculate_relevance_score("https://shop.vn/collections/bep-tu?q=kocher", "DI-332Pro", "Kocher")
    # collections is commercial but matched model will be False (not details page)
    assert score2 < 50

    score3 = calculate_relevance_score("https://shop.vn/kocher-di-332pro-plus.html", "DI-332Pro", "Kocher")
    # Suffix conflict PRO vs PRO PLUS -> 0 (negative match)
    assert score3 == 0


def test_clean_model_specs():
    assert clean_model_specs("K-226I Bạc-70cm") == "K-226I"
    assert clean_model_specs("K-226I Bạc-90cm") == "K-226I"
    assert clean_model_specs("K-226V Đen-70cm") == "K-226V"
    assert clean_model_specs("K-8070I bạc-70cm") == "K-8070I"
    assert clean_model_specs("K-8872V đen-90cm") == "K-8872V"
    assert clean_model_specs("K-225C Pro 70cm") == "K-225C Pro"
    assert clean_model_specs("K-225C Pro") == "K-225C Pro"
    assert clean_model_specs("KF-HID7348II") == "KF-HID7348II"
    assert clean_model_specs("KF-LUX AT90H-WH (Trắng)") == "KF-LUX AT90H-WH"
    assert clean_model_specs("KF-LUX-AT70H-BK (Đen)") == "KF-LUX-AT70H-BK"
    assert clean_model_specs("KF-991B New Black") == "KF-991B"
    assert clean_model_specs("KF-GB027 (Kính đen)") == "KF-GB027"


def test_parse_specific_rows():
    set1 = parse_specific_rows("3, 5, 20-22")
    assert 3 in set1
    assert 5 in set1
    assert 20 in set1
    assert 21 in set1
    assert 22 in set1
    assert len(set1) == 5

    set2 = parse_specific_rows(" 10 ")
    assert 10 in set2
    assert len(set2) == 1

    set3 = parse_specific_rows("")
    assert set3 is None

    set4 = parse_specific_rows("abc, xyz-123")
    assert set4 is None
