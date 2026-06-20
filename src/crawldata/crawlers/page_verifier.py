import json
from typing import Any

from bs4 import BeautifulSoup
from crawldata.pricing.model_matching import (
    has_conflicting_model_prefix,
    has_conflicting_model_suffix,
    is_model_match,
)
from crawldata.utils.text import normalize_model_text


def verify_page_content(soup: BeautifulSoup, url: str, model: str, brand: str) -> dict[str, Any]:
    title_el = soup.find("title")
    title = title_el.get_text() if title_el else ""
    h1s = " ".join(h.get_text() for h in soup.find_all("h1"))
    h2s = " ".join(h.get_text() for h in soup.find_all("h2"))

    meta_title_el = soup.find("meta", attrs={"name": "title"})
    meta_title = meta_title_el.get("content", "") if meta_title_el else ""

    og_title_el = soup.find("meta", attrs={"property": "og:title"})
    og_title = og_title_el.get("content", "") if og_title_el else ""

    tw_title_el = soup.find("meta", attrs={"name": "twitter:title"})
    twitter_title = tw_title_el.get("content", "") if tw_title_el else ""

    schema_names = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            script_text = script.string
            if script_text:
                data = json.loads(script_text)

                def extract_names(obj):
                    if not obj or not isinstance(obj, (dict, list)):
                        return
                    if isinstance(obj, list):
                        for item in obj:
                            extract_names(item)
                        return
                    if obj.get("@type") == "Product" and obj.get("name"):
                        schema_names.append(str(obj["name"]))
                    for k, v in obj.items():
                        if isinstance(v, (dict, list)):
                            extract_names(v)

                extract_names(data)
        except Exception:
            pass

    combined_title = f"{title} {h1s} {h2s} {meta_title} {og_title} {twitter_title} {' '.join(schema_names)}"

    norm_model = normalize_model_text(model)
    if not norm_model:
        return {"valid": False, "reason": "Empty model"}

    matched_title = is_model_match(combined_title, model, brand)
    matched_url = is_model_match(url, model, brand)

    if not matched_title and not matched_url:
        norm_brand = normalize_model_text(brand)
        if norm_brand and norm_brand in normalize_model_text(combined_title):
            return {"valid": False, "reason": "Only brand matched, model missing"}
        return {"valid": False, "reason": "Model not found"}

    if has_conflicting_model_suffix(combined_title, model) or has_conflicting_model_suffix(url, model):
        return {"valid": False, "reason": "Conflicting suffix found (extended model)"}

    if has_conflicting_model_prefix(combined_title, model, brand) or has_conflicting_model_prefix(url, model, brand):
        return {"valid": False, "reason": "Conflicting prefix found"}

    return {"valid": True}
