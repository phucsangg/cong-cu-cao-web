import asyncio
import random

import httpx

DESKTOP_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
]

OPERA_MINI_USER_AGENTS = [
    "Opera/9.80 (Android; Opera Mini/36.1.2254/191.293; U; en) Presto/2.12.423 Version/12.16",
    "Opera/9.80 (Android; Opera Mini/19.0.2254/191.293; U; vi) Presto/2.12.423 Version/12.16",
    "Opera/9.80 (iPhone; Opera Mini/8.0.0/191.293; U; en) Presto/2.12.423 Version/12.16",
    "Opera/9.80 (BlackBerry; Opera Mini/8.0.0/191.293; U; en) Presto/2.12.423 Version/12.16",
]

DEFAULT_USER_AGENT = DESKTOP_USER_AGENTS[0]

_http_semaphore = asyncio.Semaphore(10)
_shared_client: httpx.AsyncClient | None = None
_client_lock = asyncio.Lock()


def get_random_desktop_ua() -> str:
    return random.choice(DESKTOP_USER_AGENTS)


def get_random_opera_mini_ua() -> str:
    return random.choice(OPERA_MINI_USER_AGENTS)


async def get_shared_client() -> httpx.AsyncClient:
    global _shared_client
    if _shared_client is None:
        async with _client_lock:
            if _shared_client is None:
                limits = httpx.Limits(max_keepalive_connections=30, max_connections=100)
                _shared_client = httpx.AsyncClient(
                    follow_redirects=True,
                    verify=False,
                    limits=limits,
                    timeout=httpx.Timeout(15.0, connect=5.0),
                )
    return _shared_client


async def close_shared_client():
    global _shared_client
    if _shared_client is not None:
        await _shared_client.aclose()
        _shared_client = None


async def fetch_html(url: str, timeout: float = 15.0, user_agent: str = DEFAULT_USER_AGENT, retries: int = 2) -> str:
    async with _http_semaphore:
        return await _fetch_html_with_retry(url, timeout, user_agent, retries)


async def _fetch_html_with_retry(url: str, timeout: float, user_agent: str, retries_left: int) -> str:
    headers = {
        "user-agent": user_agent,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "max-age=0",
        "upgrade-insecure-requests": "1",
    }
    is_blocking_error = False
    try:
        client = await get_shared_client()
        response = await client.get(url, headers=headers, timeout=timeout)
        if response.status_code != 200:
            if response.status_code in [403, 429]:
                is_blocking_error = True
            raise httpx.HTTPStatusError(f"HTTP {response.status_code}", request=response.request, response=response)
        return response.text
    except Exception as e:
        if retries_left > 0 and not is_blocking_error:
            await asyncio.sleep(0.5)
            return await _fetch_html_with_retry(url, timeout, user_agent, retries_left - 1)
        raise e
