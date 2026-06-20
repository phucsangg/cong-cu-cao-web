from crawldata.cache.store import CacheStore


def test_cache_store_operations():
    store = CacheStore()
    store.clear()

    # Get non-existing
    assert store.get("html", "https://notfound.com", 1) is None

    # Set and get html cache
    store.set_html("https://test.com/item1", "<html>test</html>")
    assert store.get_html("https://test.com/item1") == "<html>test</html>"

    # Set and get price cache
    store.set_price("https://test.com/item1", 1200000)
    assert store.get_price("https://test.com/item1") == 1200000

    # Selector cache
    store.set_selector_for_domain("test.com", ".main-price")
    assert store.get_selector_for_domain("test.com") == ".main-price"

    # Search result cache
    store.set_search_result("Brand1", "Model1", ["https://site.vn/1", "https://site.vn/2"])
    res = store.get_search_result("Brand1", "Model1")
    assert res == ["https://site.vn/1", "https://site.vn/2"]
