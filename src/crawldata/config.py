from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    apps_script_url: str = ""
    sheet_url: str = ""
    sheet_name: str = ""
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    haravan_shop_url: str = ""
    haravan_access_token: str = ""
    port: int = 3000
    host: str = "127.0.0.1"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


# Standard default instance
settings = Settings()
