# Hệ thống Tự động Cập nhật Giá và Đồng bộ Google Sheets / Haravan (Python CLI Version)

Dự án này đã được chuyển đổi hoàn toàn sang một **Python-only CLI tool** chạy bằng giao diện dòng lệnh (CLI). Toàn bộ phần giao diện website Dashboard cũ và FastAPI web server đã được loại bỏ để tập trung vào hiệu năng, tính độc lập, dễ bảo trì và khả năng tích hợp linh hoạt.

---

## ✨ Tính Năng Nổi Bật

- 🚀 **Python CLI-First:** Chạy hoàn toàn thông qua các dòng lệnh đơn giản và trực quan. Dễ dàng lập lịch cron hoặc tích hợp vào hệ thống CI/CD, airflow, worker queue.
- 🧠 **Thuật toán tự động nhận diện giá (Smart Heuristics):**
  - Tự động tìm kiếm liên kết sản phẩm qua nhiều công cụ tìm kiếm (Google, Bing, DuckDuckGo, CocCoc) theo cơ chế tìm kiếm lũy tiến.
  - Phân tích DOM bằng BeautifulSoup4 (kênh cào nhanh) và Playwright (kênh trình duyệt ảo cho các trang SPA tải dữ liệu động).
  - Tự động bỏ qua các phần tử giá cũ/giá gạch ngang hoặc văn bản gây nhiễu.
  - Lọc bỏ các sản phẩm trùng lặp và loại bỏ các giá trị dị biệt (outliers) dựa trên thuật toán IQR.
- ⚡ **Tối ưu hóa hiệu năng cào**:
  - **Chặn tài nguyên dư thừa:** Tự động chặn tải hình ảnh, font chữ, và các script theo dõi (Google Analytics, Facebook Pixel, Ads...) khi sử dụng Playwright giúp trang tải nhanh gấp 3 lần.
  - **Concurrency & Locking:** Kiểm soát giới hạn concurrency khi chạy tiến trình cào và tuần tự hóa các truy vấn tìm kiếm để tránh bị phát hiện/chặn IP.
- 📁 **Kiến trúc Modular & Clean Code:** Chia tách rõ ràng các tầng nghiệp vụ: `models/`, `pricing/`, `crawlers/`, `adapters/`, `cache/`, `jobs/`, `services/`, `utils/`.

---

## 🛠️ Yêu Cầu Hệ Thống

Để chạy dự án này, máy tính của bạn cần được cài đặt sẵn:
- **Python >= 3.12**
- Trình duyệt Chromium cho Playwright.

---

## 🚀 Hướng Dẫn Cài Đặt

### 1. Cài đặt Môi Trường & Dependencies
Nhân bản dự án từ GitHub:
```bash
git clone https://github.com/phucsangg/cong-cu-cao-web.git
cd cong-cu-cao-web
```

Cài đặt package ở chế độ editable với dependencies phát triển (dev):
```bash
pip install -e ".[dev]"
```

Cài đặt trình duyệt Chromium cho Playwright:
```bash
playwright install chromium
```

### 2. Cấu Hình Biến Môi Trường (`.env`)
Tạo tệp `.env` từ file ví dụ:
```bash
cp .env.example .env
```
Thiết lập các tham số cấu hình:
- `APPS_SCRIPT_URL`: Đường dẫn URL Web App deployment /exec của Google Apps Script.
- `SHEET_URL`: URL của Google Sheet cần đồng bộ giá.
- `SHEET_NAME`: Tên trang tính mặc định (ví dụ: `20.Haravan`).
- `TELEGRAM_BOT_TOKEN`: Token Telegram Bot gửi thông báo.
- `TELEGRAM_CHAT_ID`: Chat ID Telegram nhận thông báo.
- `HARAVAN_SHOP_URL`: URL API quản trị Haravan (ví dụ: `https://your-shop.myharavan.com`).
- `HARAVAN_ACCESS_TOKEN`: Access token API Haravan.

---

## ⚙️ Hướng Dẫn Sử Dụng CLI

Dự án cung cấp CLI mạnh mẽ thông qua thư viện `typer`:

### Hiển thị Trợ Giúp
```bash
python -m crawldata.cli --help
```

### 1. Cấu hình
Hiển thị cấu hình hiện tại đang được load:
```bash
python -m crawldata.cli config show
```

### 2. Quản lý Sheets
Liệt kê danh sách các sheets trong Google Spreadsheet:
```bash
python -m crawldata.cli sheets list
```

### 3. Chạy Crawl & Tính toán Giá
Chạy tiến trình quét toàn bộ sheet:
```bash
python -m crawldata.cli pricing run --sheet "20.Haravan"
```
Quét các dòng cụ thể (ví dụ dòng 3, dòng 5, và từ dòng 20 đến 30):
```bash
python -m crawldata.cli pricing run --sheet "20.Haravan" --specific-rows "3,5,20-30"
```
Quét thử cho một dòng sản phẩm tùy ý không qua sheet:
```bash
python -m crawldata.cli pricing row --brand "Bosch" --model "WQB245B40" --cost-price "21000000"
```

### 4. Đồng bộ Haravan
Đồng bộ danh sách sản phẩm và variant IDs từ Haravan về sheet:
```bash
python -m crawldata.cli haravan sync-ids
```
Cập nhật trực tiếp giá của một Variant lên Haravan và ghi log về Google Sheets:
```bash
python -m crawldata.cli haravan update-price <variant_id> <price> --write-log --brand "Bosch" --model "WQB245B40"
```

### 5. Gửi thông báo Telegram
```bash
python -m crawldata.cli telegram send "Thông báo hoàn thành cập nhật giá sản phẩm!"
```

### 6. Quản lý Cache
Xóa toàn bộ cache lưu trữ cục bộ:
```bash
python -m crawldata.cli cache clear
```

---

## 🧪 Chạy Kiểm Thử (Tests) & Linting

Chúng tôi sử dụng `pytest` để kiểm thử và `ruff` để chuẩn hóa code:

### Chạy Unit & Integration Tests
```bash
python -m pytest
```

### Kiểm Tra & Sửa Lỗi Format Code
Kiểm tra tĩnh lỗi cú pháp, import chưa dùng:
```bash
ruff check .
```
Tự động sửa các lỗi format và tối ưu import:
```bash
ruff check . --fix
ruff format .
```

---

## 📂 Cấu Trúc Thư Mục Dự Án mới

```text
crawldata/
├── src/
│   └── crawldata/
│       ├── __init__.py
│       ├── cli.py                # Typer CLI subcommands
│       ├── config.py             # Settings validation (Pydantic)
│       ├── logger.py             # Logging setup
│       ├── models/               # Pydantic data models
│       ├── pricing/              # Pricing heuristic engines
│       ├── crawlers/             # BeautifulSoup & Playwright scrapers
│       ├── adapters/             # External REST endpoints adapters
│       ├── cache/                # File cache wrapper
│       ├── jobs/                 # Multi-workers job tracker
│       ├── services/             # Coordinate workflow logic
│       └── utils/                # String/Vietnamese normalization helpers
├── tests/                        # Pytest suite
├── .env.example
├── README.md
├── pyproject.toml
└── Dockerfile
```
