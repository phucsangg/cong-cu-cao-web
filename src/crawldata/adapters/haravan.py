import re
from typing import Any

import httpx


async def fetch_haravan_products(haravan_shop_url: str, haravan_access_token: str, page: int = 1) -> list[dict]:
    shop_url = str(haravan_shop_url).strip().rstrip("/")
    if not shop_url.startswith("http"):
        shop_url = f"https://{shop_url}"
    token = str(haravan_access_token).strip()

    url = f"{shop_url}/admin/products.json?limit=250&page={page}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            url, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        )
        if response.status_code != 200:
            raise ValueError(f"Haravan API returned HTTP {response.status_code}: {response.text}")
        data = response.json()
        return data.get("products") or []


async def update_haravan_variant_price_api(
    haravan_shop_url: str, haravan_access_token: str, variant_id: str, price: Any
) -> dict:
    shop_url = str(haravan_shop_url).strip().rstrip("/")
    if not shop_url.startswith("http"):
        shop_url = f"https://{shop_url}"
    token = str(haravan_access_token).strip()
    clean_price = re.sub(r"\D", "", str(price))

    url = f"{shop_url}/admin/variants/{variant_id}.json"
    payload = {"variant": {"id": int(variant_id), "price": clean_price}}

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.put(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        if response.status_code != 200:
            raise ValueError(f"Haravan API returned HTTP {response.status_code}: {response.text}")
        return response.json()
