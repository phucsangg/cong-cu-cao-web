# Lịch sử Chỉnh sửa & Cải tiến Dự án (History of Modifications)

## File Thêm mới (Added Files)
- [.node-version](file:///d:/Work/cong-cu-cao-web-ver-2/.node-version): Cấu hình khóa phiên bản Node.js ở `22.17.0` cho môi trường deploy của Netlify để đáp ứng yêu cầu của thư viện `@sparticuz/chromium`.

## File Chỉnh sửa (Modified Files)
- [netlify/functions/scrape.js](file:///d:/Work/cong-cu-cao-web-ver-2/netlify/functions/scrape.js):
  - Khắc phục lỗi nạp thư viện trình duyệt ảo serverless khi chạy local trên Windows (chỉ chạy trên AWS Lambda).
  - Chuyển đổi lệnh nạp `puppeteer-core` sang import động `await import()` để sửa lỗi `ERR_REQUIRE_ESM` trên Netlify.
  - Tích hợp cơ chế cào dữ liệu bằng khoảng cách DOM (DOM Distance Proximity Matching) để ghép cặp giá tiền với tiêu đề/link sản phẩm gần nhất, tránh bị sai lệch chéo thông tin.
  - Giới hạn độ cao khi duyệt cây DOM bằng bộ lọc `isLayoutContainer` để tránh duyệt lên các container bố cục trang lớn, tránh quá tải CPU và sửa lỗi Timeout 502.
  - Tăng ngưỡng số lượng sản phẩm của Cheerio nhanh từ 3 lên 8 để tối ưu tốc độ cào.
- [netlify.toml](file:///d:/Work/cong-cu-cao-web-ver-2/netlify.toml):
  - Thêm cấu hình `functions = "netlify/functions"` trong khối `[build]` để giải quyết triệt để lỗi 404 API khi deploy.
- [public/index.html](file:///d:/Work/cong-cu-cao-web-ver-2/public/index.html):
  - Nâng cấp giao diện hiển thị, bổ sung mã sản phẩm (SKU) và dòng sản phẩm (Series).
  - Thêm tính năng cào hàng loạt từ danh sách URL trong file `.txt`.
  - Thiết kế lại mục cấu hình nâng cao dạng hộp kính (glassmorphism) đẹp mắt.
  - Thêm thuật toán Fuzzy Matching (độ tương đồng Jaccard 60%) để gom nhóm sản phẩm không có SKU/Series.
  - Thêm tính năng **So sánh giá (Price Comparison)** thời gian thực giữa các website khác nhau, làm nổi bật giá rẻ nhất và đắt nhất.
  - Tối ưu hóa bộ lọc từ khóa rác, loại bỏ các hậu tố màu sắc hoặc thông số kim loại để gom nhóm so sánh chính xác hơn.
  - Ngăn so sánh giá các sản phẩm từ cùng một tên miền (domain).
  - Thêm cơ chế nhận diện combo/bộ sản phẩm và dừng quét khi trang không sinh thêm sản phẩm mới.
- [test-fetch.mjs](file:///d:/Work/cong-cu-cao-web-ver-2/test-fetch.mjs):
  - Cập nhật logic trích xuất SKU/Series độc lập đồng bộ với frontend để phục vụ kiểm thử.

## File Xóa bỏ (Deleted Files)
- Không có.

## Các lệnh chính đã thực thi (Commands Executed)
- Chạy thử nghiệm dev server local (`npx netlify dev`, `curl`).
- Đồng bộ mã nguồn lên hai kho lưu trữ GitHub:
  - Repository cá nhân: `https://github.com/tomyrese/crawldata.git` (Remote: `origin`)
  - Repository gốc: `https://github.com/phucsangg/cong-cu-cao-web-ver-2.git` (Remote: `phucsang`)
- Chạy kiểm thử trích xuất dữ liệu (`node test-fetch.mjs`).

## Lỗi đã phát hiện (Bugs Found)
1. **Trình duyệt ảo local bị lỗi spawn**: `@sparticuz/chromium` bị crash trên hệ điều hành Windows local.
2. **Hành vi treo mạng**: Xảy ra ở Puppeteer khi điều hướng trang khiến quá trình cào bị dừng hoặc quá hạn.
3. **Sập ngữ cảnh trình duyệt (`Execution context was destroyed`)**: Khiến hàm scrape bị sập nếu trang tải chậm hoặc tự điều hướng.
4. **Sai phiên bản Node trên Netlify**: Dẫn đến lỗi không biên dịch được `@sparticuz/chromium` v149.
5. **Lỗi 404 API khi lên Netlify**: Do Netlify bỏ qua không deploy thư mục functions khi thiếu chỉ thị.
6. **Lỗi `ERR_REQUIRE_ESM` của `puppeteer-core`**: Không cho phép `require()` thư viện ES Module trong CommonJS.
7. **Sai lệch thông tin trong trang nhiều sản phẩm**: Do cơ chế cào cũ lấy trùng tiêu đề của sản phẩm đầu tiên cho toàn bộ khối.
8. **Cào thiếu sản phẩm trên trang động**: Cheerio nhanh trả về kết quả ảo quá sớm (các sản phẩm nổi bật tĩnh) khiến bỏ qua Puppeteer.
9. **Lặp trang vô hạn**: Cào mãi một danh mục duy nhất khi hết trang nhưng hệ thống vẫn tiếp tục gửi yêu cầu.
10. **Lỗi 502 Timeout khi tính khoảng cách DOM**: Duyệt lên quá cao khiến trình duyệt ảo bị đơ do quá tải tính toán.
11. **Trích xuất SKU/Series sai lệch**: Nhận diện nhầm các từ khóa tiếng Việt (như "gas 3") hoặc bị tách nhỏ mã sản phẩm dài do RegEx thô sơ.
12. **So sánh giá chéo lẫn lộn**: Nhóm các sản phẩm trên cùng một website để so sánh với nhau hoặc gom nhóm sai do lệch mã màu variants.

## Các bản vá đã áp dụng (Fixes Applied)
1. Giới hạn `@sparticuz/chromium` chỉ chạy trên AWS Lambda, local dùng trình duyệt Chrome/Edge cài sẵn.
2. Thêm try-catch và kiểm tra trạng thái yêu cầu mạng trong sự kiện `page.on('request')`.
3. Bổ sung cơ chế tự động chuyển sang phân tích tĩnh Cheerio qua `page.content()` nếu evaluate lỗi.
4. Cài đặt file `.node-version` khóa phiên bản Node.js `22.17.0`.
5. Bổ sung đường dẫn `functions` vào `netlify.toml`.
6. Sử dụng import động `await import('puppeteer-core')` trong hàm handler.
7. Tích hợp giải thuật so khớp khoảng cách DOM ngắn nhất (DOM Distance Proximity Matching).
8. Nâng ngưỡng kết quả cào nhanh Cheerio lên tối thiểu 8 sản phẩm.
9. Dừng vòng lặp cào trang khi không phát hiện thêm sản phẩm mới (`newCount === 0`).
10. Sử dụng bộ chặn `isLayoutContainer` giới hạn phạm vi tính khoảng cách DOM trong từng thẻ sản phẩm đơn lẻ.
11. Nâng cấp RegEx trích xuất phân biệt chữ hoa-thường, bộ lọc từ cấm tiếng Việt và nhận diện mã Hafele.
12. Lọc bỏ mã màu ở đuôi SKU, bỏ qua so sánh nội bộ cùng domain và tách biệt combo thông qua chữ "tặng", "+", "combo".

## Vấn đề còn lại (Remaining Issues)
- Không có.
