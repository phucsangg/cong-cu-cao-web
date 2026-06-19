# Executive Dashboard Redesign

## Mục tiêu

Viết lại giao diện website theo hướng `executive dashboard` với trọng tâm `insights first`:

- người dùng mở trang là thấy ngay trạng thái job, tiến trình, KPI, log và kết quả chính
- phần setup gọn, dễ hiểu, ít cảm giác kỹ thuật hơn
- giữ nguyên luồng pricing hiện có và các hook frontend/backend quan trọng

## Trải nghiệm mong muốn

- giao diện hiện đại, nhẹ mắt, ít khối tối nặng nề
- hierarchy rõ ràng: trạng thái > kết quả > hành động > cấu hình
- thao tác cấu hình dễ tiếp cận hơn cho người dùng không kỹ thuật
- dashboard nhìn giống công cụ vận hành chuyên nghiệp, không giống form cấu hình thuần túy

## Hướng thị giác

- đổi sang light theme cao cấp, dùng nền sáng hơi ấm và card trắng/xanh nhạt
- nhấn màu điều hướng và hành động bằng teal/navy
- tiêu đề và số liệu dùng typography mạnh, log và bảng dùng mono/compact
- bo góc lớn, shadow mềm, khoảng trắng rộng hơn

## Bố cục

### 1. Hero header

- tiêu đề hệ thống
- mô tả ngắn
- badge trạng thái
- khu hành động nhanh với nút chạy/dừng

### 2. KPI strip

- tổng dòng
- đã quét
- thành công
- lỗi / bỏ qua
- lần ghi sheet
- tiến trình hiện tại

### 3. Main workspace

#### Cột trái: Live monitor

- progress lớn
- selected sheet summary
- live terminal log
- context card mô tả job hiện tại

#### Cột phải: Setup rail

- card chọn sheet
- card kết nối nguồn dữ liệu
- card tinh chỉnh nâng cao

## 4. Khu kết quả

- bảng sản phẩm chiếm full width
- giữ modal chi tiết nguồn giá
- tiêu đề rõ hơn, dễ scan hơn

## Quy tắc kỹ thuật

- giữ nguyên các `id` đang được `public/sheet-pricing.js` sử dụng khi khả thi
- chỉ thay đổi JS ở mức cần thiết để khớp layout mới và sửa text hiển thị lỗi/mã hóa
- không đổi contract API backend trừ khi cần sửa fallback hiển thị
- ưu tiên sửa luôn các text bị mojibake ở phần giao diện chính

## Kiểm thử

- `node --check public/sheet-pricing.js`
- `node --check lib/sheet-pricing-service.js`
- `node --test tests/sheet-pricing-service.test.js`
- kiểm tra thủ công:
  - load config
  - tải danh sách sheet
  - bấm bắt đầu/dừng
  - xem log
  - mở modal chi tiết
