import json
import os
import tempfile
import time
from typing import Any

from crawldata.logger import logger


class CacheStore:
    def __init__(self):
        tmp_dir = os.environ.get("TEMP") or tempfile.gettempdir()
        self.file_path = os.path.join(tmp_dir, "crawldata-cache.json")
        self.version = "v3"
        self.data: dict[str, Any] = {
            "version": self.version,
            "keywords": {},
            "html": {},
            "prices": {},
            "searchResults": {},
            "urlMap": {},
            "selectors": {},
            "errors": {},
        }
        self.load()

    def load(self):
        try:
            if os.path.exists(self.file_path):
                with open(self.file_path, encoding="utf-8") as f:
                    parsed = json.load(f)
                if parsed.get("version") != self.version:
                    self.clear()
                    return
                self.data = {
                    "version": self.version,
                    "keywords": parsed.get("keywords") or {},
                    "html": parsed.get("html") or {},
                    "prices": parsed.get("prices") or {},
                    "searchResults": parsed.get("searchResults") or {},
                    "urlMap": parsed.get("urlMap") or {},
                    "selectors": parsed.get("selectors") or {},
                    "errors": {},
                }
        except Exception as e:
            logger.warning(f"Failed to load cache: {e}")

    def save(self):
        try:
            # Exclude transient errors
            copy_data = dict(self.data)
            if "errors" in copy_data:
                copy_data["errors"] = {}
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump(copy_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"Failed to save cache: {e}")

    def get(self, cache_type: str, key: str, ttl_hours: float) -> Any | None:
        entry = self.data.get(cache_type, {}).get(key)
        if not entry:
            return None
        age_ms = (time.time() * 1000) - entry.get("timestamp", 0)
        if age_ms > ttl_hours * 60 * 60 * 1000:
            if key in self.data.get(cache_type, {}):
                del self.data[cache_type][key]
                self.save()
            return None
        return entry.get("value")

    def set(self, cache_type: str, key: str, value: Any):
        if cache_type not in self.data:
            self.data[cache_type] = {}
        self.data[cache_type][key] = {
            "value": value,
            "timestamp": int(time.time() * 1000),
        }
        self.save()

    def clear(self):
        self.data = {
            "version": self.version,
            "keywords": {},
            "html": {},
            "prices": {},
            "searchResults": {},
            "urlMap": {},
            "selectors": {},
            "errors": {},
        }
        self.save()

    def set_error(self, url: str, message: str):
        if "errors" not in self.data:
            self.data["errors"] = {}
        self.data["errors"][url] = {
            "value": message,
            "timestamp": int(time.time() * 1000),
        }

    def get_error(self, url: str) -> str | None:
        entry = self.data.get("errors", {}).get(url)
        if not entry:
            return None
        age_ms = (time.time() * 1000) - entry.get("timestamp", 0)
        if age_ms > 10 * 60 * 1000:  # 10 mins TTL
            if url in self.data.get("errors", {}):
                del self.data["errors"][url]
            return None
        return entry.get("value")

    def get_search_result(self, brand: str, model: str) -> list[str] | None:
        key = f"{str(brand).strip().lower()}:{str(model).strip().lower()}"
        entry = self.data.get("searchResults", {}).get(key)
        if not entry:
            return None
        age_ms = (time.time() * 1000) - entry.get("timestamp", 0)
        if age_ms > 7 * 24 * 60 * 60 * 1000:  # 7 days TTL
            if key in self.data.get("searchResults", {}):
                del self.data["searchResults"][key]
                self.save()
            return None
        return entry.get("value")

    def set_search_result(self, brand: str, model: str, urls: list[str]):
        if "searchResults" not in self.data:
            self.data["searchResults"] = {}
        key = f"{str(brand).strip().lower()}:{str(model).strip().lower()}"
        self.data["searchResults"][key] = {
            "value": urls,
            "timestamp": int(time.time() * 1000),
        }
        self.save()

    def get_urls_for_model(self, brand: str, model: str) -> list[str]:
        key = f"{str(brand).strip().lower()}:{str(model).strip().lower()}"
        entry = self.data.get("urlMap", {}).get(key)
        if not entry:
            return []
        return [item.get("url") for item in entry.values() if "url" in item]

    def set_url_for_model_domain(self, brand: str, model: str, domain: str, url: str):
        if "urlMap" not in self.data:
            self.data["urlMap"] = {}
        key = f"{str(brand).strip().lower()}:{str(model).strip().lower()}"
        if key not in self.data["urlMap"]:
            self.data["urlMap"][key] = {}
        self.data["urlMap"][key][domain] = {
            "url": url,
            "timestamp": int(time.time() * 1000),
        }
        self.save()

    def get_selector_for_domain(self, domain: str) -> str | None:
        entry = self.data.get("selectors", {}).get(domain)
        return entry.get("value") if entry else None

    def set_selector_for_domain(self, domain: str, selector: str):
        if "selectors" not in self.data:
            self.data["selectors"] = {}
        self.data["selectors"][domain] = {
            "value": selector,
            "timestamp": int(time.time() * 1000),
        }
        self.save()

    def get_html(self, url: str) -> str | None:
        return self.get("html", url, 12)

    def set_html(self, url: str, html_content: str):
        self.set("html", url, html_content)

    def get_price(self, url: str) -> int | None:
        return self.get("prices", url, 12)

    def set_price(self, url: str, price: int):
        self.set("prices", url, price)


pricing_cache = CacheStore()
