import httpx


async def send_telegram_message(telegram_bot_token: str, telegram_chat_id: str, message: str) -> dict:
    token = str(telegram_bot_token).strip()
    chat_id = str(telegram_chat_id).strip()
    if not token or not chat_id:
        return {"ok": False, "error": "Thiếu Telegram Bot Token hoặc Chat ID."}

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": message, "parse_mode": "HTML"}

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(url, json=payload)
        if response.status_code != 200:
            raise ValueError(f"Telegram API returned HTTP {response.status_code}: {response.text}")
        return response.json()
