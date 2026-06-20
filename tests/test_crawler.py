from unittest.mock import AsyncMock, patch

import pytest
from crawldata.crawlers.fetcher import (
    fetch_html,
    get_random_desktop_ua,
    get_random_opera_mini_ua,
)
from crawldata.crawlers.search_engines import (
    decode_bing_redirect,
    is_likely_product_detail_url,
    normalize_search_href,
    search_product_links,
)


def test_user_agents():
    ua_desktop = get_random_desktop_ua()
    assert isinstance(ua_desktop, str)
    assert len(ua_desktop) > 0

    ua_opera = get_random_opera_mini_ua()
    assert isinstance(ua_opera, str)
    assert len(ua_opera) > 0


def test_decode_bing_redirect():
    # Test valid bing redirect url (mocked)
    bing_url = "https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9rb2NoZXIudm4vZGktMzMzcHJv&someother"
    decoded = decode_bing_redirect(bing_url)
    assert decoded == "https://kocher.vn/di-333pro"

    # Invalid redirect
    invalid_url = "https://example.com/not-bing"
    assert decode_bing_redirect(invalid_url) == invalid_url


def test_normalize_search_href():
    # Google redirect format
    assert normalize_search_href("/url?q=https://kocher.vn/di-333pro&other=1") == "https://kocher.vn/di-333pro"

    # Direct url
    assert normalize_search_href("https://kocher.vn/di-333pro") == "https://kocher.vn/di-333pro"


def test_is_likely_product_detail_url():
    # Valid product detail urls
    assert is_likely_product_detail_url("https://kocher.vn/bep-tu-kocher-di-333pro.html", "DI-333Pro", "Kocher") is True
    assert is_likely_product_detail_url("https://dienmayxanh.com/san-pham/di-333pro", "DI-333Pro", "Kocher") is True

    # Blocked terms
    assert is_likely_product_detail_url("https://kocher.vn/danh-muc/bep-tu", "DI-333Pro", "Kocher") is False
    assert is_likely_product_detail_url("https://google.com/search?q=123", "DI-333Pro", "Kocher") is False


@pytest.mark.asyncio
async def test_fetch_html():
    with patch("httpx.AsyncClient.get") as mock_get:
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.text = "<html>content</html>"
        mock_get.return_value = mock_response

        content = await fetch_html("https://example.com")
        assert content == "<html>content</html>"
        mock_get.assert_called_once()


@pytest.mark.asyncio
async def test_search_product_links_cached():
    with patch("crawldata.cache.store.pricing_cache.get_search_result") as mock_get_res:
        mock_get_res.return_value = ["https://kocher.vn/di-333pro"]

        links = await search_product_links("Kocher", "DI-333Pro")
        assert links == ["https://kocher.vn/di-333pro"]
        mock_get_res.assert_called_with("Kocher", "DI-333Pro")
