from crawldata.cli import app
from typer.testing import CliRunner

runner = CliRunner()


def test_cli_help():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "CrawlData CLI tool for Auto-Pricing and Google Sheets/Haravan" in result.stdout
    assert "sheets" in result.stdout
    assert "pricing" in result.stdout
    assert "haravan" in result.stdout
    assert "telegram" in result.stdout
    assert "cache" in result.stdout
    assert "config" in result.stdout


def test_cli_config_show():
    result = runner.invoke(app, ["config", "show"])
    assert result.exit_code == 0
    assert "=== Cau hinh CrawlData ===" in result.stdout
    assert "Google Sheets Apps Script URL:" in result.stdout


def test_cli_cache_clear():
    result = runner.invoke(app, ["cache", "clear"])
    assert result.exit_code == 0
    assert "Dang xoa toan bo cache luu tru..." in result.stdout
    assert "Xoa cache thanh cong!" in result.stdout
