import asyncio
import re

from crawldata.cache.store import pricing_cache
from crawldata.crawlers.fetcher import fetch_html
from crawldata.utils.text import normalize_model_text


async def discover_sitemap_links(domain: str, model: str, brand: str) -> list[str]:
    from crawldata.crawlers.search_engines import is_likely_product_detail_url

    paths = ["/sitemap.xml", "/sitemap_products.xml", "/product-sitemap.xml"]
    found_urls = []
    norm_model = normalize_model_text(model).lower()
    if not norm_model:
        return []

    clean_digits = "".join(c for c in norm_model if c.isdigit())

    def extract_urls_xml(xml_text: str):
        urls_loc = re.findall(r"<(loc|link)>([^<]+)<\/\1>", xml_text, re.IGNORECASE)
        for _, loc_url in urls_loc:
            loc_url = loc_url.strip()
            if loc_url.startswith("http"):
                norm_loc = normalize_model_text(loc_url).lower()
                if norm_model in norm_loc or (len(clean_digits) >= 4 and clean_digits in norm_loc):
                    if is_likely_product_detail_url(loc_url, model, brand):
                        found_urls.append(loc_url)

    async def check_path(path_val: str):
        url = f"https://{domain}{path_val}"
        xml_text = pricing_cache.get_html(url)
        if not xml_text:
            try:
                xml_text = await fetch_html(url, timeout=3.0)
                pricing_cache.set_html(url, xml_text)
            except Exception:
                return

        if not xml_text or len(xml_text) < 100:
            return

        sitemap_indexes = re.findall(r"<sitemap>\s*<loc>([^<]+)<\/loc>", xml_text, re.IGNORECASE)
        if sitemap_indexes:
            product_subs = [
                loc.strip() for loc in sitemap_indexes if any(k in loc.lower() for k in ["product", "san-pham", "post"])
            ][:5]

            async def probe_sub(sub_url):
                sub_text = pricing_cache.get_html(sub_url)
                if not sub_text:
                    try:
                        sub_text = await fetch_html(sub_url, timeout=3.0)
                        pricing_cache.set_html(sub_url, sub_text)
                    except Exception:
                        return
                if sub_text:
                    extract_urls_xml(sub_text)

            await asyncio.gather(*(probe_sub(sub) for sub in product_subs))
        else:
            extract_urls_xml(xml_text)

    await asyncio.gather(*(check_path(path) for path in paths))
    return found_urls
