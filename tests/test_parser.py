from unittest.mock import patch

import pytest
from bs4 import BeautifulSoup
from crawldata.crawlers.page_verifier import verify_page_content
from crawldata.crawlers.product_extractor import (
    check_if_price,
    extract_price_advanced,
    extract_product_price,
    get_dom_distance,
    is_excluded,
    is_fake_price,
    is_homepage,
    is_layout_container,
    matches_category,
    run_cheerio_scrape_bs4,
)


def test_is_homepage():
    assert is_homepage("https://example.com/") is True
    assert is_homepage("https://example.com/index.html") is True
    assert is_homepage("https://example.com/products/item1") is False
    assert is_homepage("invalid_url") is False


def test_matches_category():
    assert matches_category("Bếp điện từ", "/bep-dien-tu") is True
    assert matches_category("Tin tức mới nhất", "/tin-tuc") is False


def test_check_if_price():
    assert check_if_price("12.500.000 đ") is True
    assert check_if_price("1.200.000₫") is True
    assert check_if_price("Liên hệ") is False
    assert check_if_price("0987654321") is False  # phone number
    assert check_if_price("18001234") is False  # hotline
    assert check_if_price("15.5k") is False
    assert check_if_price("12.0") is False


def test_is_excluded():
    assert is_excluded("footer-area", "some-class") is True
    assert is_excluded("main-content", "sidebar") is True
    assert is_excluded("main-content", "product-item") is False


def test_is_layout_container():
    assert is_layout_container("main-layout", "row", "div") is True
    assert is_layout_container("product-item", "col-md-4", "div") is False


def test_get_dom_distance():
    html = """
    <div id="root">
        <div id="parent1">
            <span id="child1"></span>
        </div>
        <div id="parent2">
            <span id="child2"></span>
        </div>
    </div>
    """
    soup = BeautifulSoup(html, "html.parser")
    root = soup.find(id="root")
    child1 = soup.find(id="child1")
    child2 = soup.find(id="child2")

    assert get_dom_distance(child1, child1) == 0
    assert get_dom_distance(child1, root) == 2  # child1 -> parent1 -> root
    assert get_dom_distance(child1, child2) == 4  # child1 -> parent1 -> root -> parent2 -> child2


def test_is_fake_price():
    assert is_fake_price(12345000, "12345") is False
    assert is_fake_price(12340000, "12345") is False  # divisible by 1000 and ends with 000
    assert is_fake_price(12345, "12345") is True  # contains/same
    assert is_fake_price(9999000, "DI-333") is False


def test_verify_page_content():
    html = """
    <html>
        <head><title>Bếp Từ Kocher DI-333Pro Giá Tốt</title></head>
        <body>
            <h1>Bếp từ DI-333Pro nhập khẩu</h1>
            <div class="product-description">Mô tả sản phẩm Kocher DI-333Pro chất lượng cao</div>
        </body>
    </html>
    """
    soup = BeautifulSoup(html, "html.parser")
    assert verify_page_content(soup, "https://kocher.vn/di-333pro.html", "DI-333Pro", "Kocher")["valid"] is True

    # Conflict suffix (DI-333Pro vs DI-333Pro Plus)
    assert verify_page_content(soup, "https://kocher.vn/di-333pro-plus.html", "DI-333Pro", "Kocher")["valid"] is False

    # Model missing
    assert verify_page_content(soup, "https://kocher.vn/bep-tu.html", "DI-888", "Kocher")["valid"] is False


def test_run_cheerio_scrape_bs4():
    html = """
    <div class="product-item">
        <h2 class="title"><a href="/product/bep-tu-kocher-di-333pro">Bếp Từ Kocher DI-333Pro</a></h2>
        <span class="price">12.500.000₫</span>
    </div>
    """
    products = run_cheerio_scrape_bs4(html, "https://kocher.vn", 1)
    assert len(products) == 1
    assert products[0]["ten"] == "Bếp Từ Kocher DI-333Pro"
    assert products[0]["gia"] == "12.500.000₫"
    assert products[0]["link"] == "https://kocher.vn/product/bep-tu-kocher-di-333pro"


def test_extract_price_advanced():
    html = """
    <div class="product-detail">
        <h1>Bếp Từ Kocher DI-333Pro</h1>
        <span class="current-price">12.500.000đ</span>
    </div>
    """
    soup = BeautifulSoup(html, "html.parser")
    price = extract_price_advanced(soup, html, "DI-333Pro", "https://kocher.vn/di-333pro", 15000000)
    assert price == 12500000


@pytest.mark.asyncio
async def test_extract_product_price_cached():
    # Test extract_product_price uses cache when available
    with (
        patch("crawldata.cache.store.pricing_cache.get_html") as mock_get_html,
        patch("crawldata.cache.store.pricing_cache.get_price") as mock_get_price,
    ):
        mock_get_html.return_value = """
        <html>
            <head><title>Bếp Từ Kocher DI-333Pro</title></head>
            <body>
                <div class="product-detail">
                    <h1>Bếp Từ Kocher DI-333Pro</h1>
                    <span class="price">12.500.000đ</span>
                </div>
            </body>
        </html>
        """
        mock_get_price.return_value = 12500000

        price = await extract_product_price("https://kocher.vn/di-333pro", "DI-333Pro", "Kocher", 15000000)
        assert price == 12500000
        mock_get_price.assert_called_once_with("https://kocher.vn/di-333pro")
