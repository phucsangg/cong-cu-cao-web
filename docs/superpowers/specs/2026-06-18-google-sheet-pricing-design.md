# Google Sheet Pricing Design

## Muc tieu

Cap nhat website hien tai thanh mot he thong dinh gia tu dong doc/ghi truc tiep vao Google Sheet thong qua Google Apps Script, thu nghiem truoc voi tab `01.Bep tu` trong spreadsheet:

- Spreadsheet: `1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo`
- Sheet name: `01.Bep tu`

He thong se:

1. Doc tung dong san pham tu Google Sheet.
2. Lay `Thuong hieu + Model`.
3. Tim kiem Google theo cum tu nay.
4. Chon toi da 20 link phu hop va chi giu `trang chi tiet san pham`.
5. Truy cap tung link de lay gia.
6. Chon 10 gia thap nhat.
7. Loai bo outlier neu gia thap nhat thap hon gia thu 2 qua 10%.
8. Tinh `Gia de xuat`.
9. Ghi ket qua tro lai vao chinh dong do tren Google Sheet.

## Pham vi

### Trong pham vi

- Lam moi backend va UI website de ho tro job `Google Sheet Pricing`.
- Them lop ket noi Google Apps Script de doc/ghi Google Sheet.
- Xu ly dinh gia cho tab `01.Bep tu`.
- Cap nhat ket qua vao cac cot thi truong va cot tong hop:
  - `Thi truong 1` ... `Thi truong 10`
  - `Min`
  - `GAP`
  - `%GAP`
  - `Gia de xuat`

### Ngoai pham vi

- Chua toi uu cho tat ca sheet con khac trong workbook o dot dau.
- Chua them co che dang nhap Google OAuth.
- Chua tinh bien loi nhuan toi thieu.
- Chua ghi link nguon vao sheet, chi ghi gia.

## Kien truc tong the

### Lua chon kien truc

Su dung phuong an `A`:

- `Node backend` xu ly toan bo phan nang:
  - tim Google
  - mo link
  - trich gia
  - sap xep, loc outlier
  - tinh cac chi so
- `Google Apps Script` chi lam bridge doc/ghi Sheet.

### Thanh phan

#### 1. Frontend dashboard

Them khu dieu khien job moi trong website:

- nhap `Google Sheet URL`
- nhap/chon `Sheet name`
- tuy chon pham vi dong can chay
- bat dau / dung job
- theo doi tien do theo tung dong
- hien log crawl va thong ke tong hop

#### 2. Backend pricing pipeline

Backend tao mot pricing job trong bo nho va xu ly theo batch:

- goi Apps Script de doc du lieu tu sheet
- lap qua tung dong hop le
- crawl va tinh gia
- goi Apps Script de ghi ket qua tro lai
- cap nhat trang thai de frontend polling

#### 3. Google Apps Script bridge

Apps Script xuat ban thanh web app, cung cap hai endpoint:

- `GET`: doc du lieu tu sheet
- `POST`: ghi ket qua theo batch

Apps Script khong crawl web va khong tinh gia.

## Cau truc du lieu sheet

### Cot input bat buoc

Doc theo ten header, khong hard-code index:

- `Ma SP`
- `Thuong hieu`
- `Model`
- `Gia von`
- `Gia ban`

### Cot output can cap nhat

Can tim header theo ten de ho tro sheet co the doi vi tri cot:

- `Thi truong 1`
- `Thi truong 2`
- `Thi truong 3`
- `Thi truong 4`
- `Thi truong 5`
- `Thi truong 6`
- `Thi truong 7`
- `Thi truong 8`
- `Thi truong 9`
- `Thi truong 10`
- `Min`
- `GAP`
- `%GAP`
- `Gia de xuat`

Neu thieu mot hay nhieu cot output, backend se bao loi cau hinh thay vi ghi sai cot.

## Luong xu ly moi dong

### 1. Chon dong hop le

Mot dong duoc xu ly khi:

- co `Thuong hieu`
- co `Model`

Dong thieu mot trong hai truong se bi bo qua va danh dau trong log.

### 2. Tao truy van tim kiem

Query mac dinh:

- `"<thuong hieu> <model>"`

Co the mo rong ve sau voi tu khoa bo tro nhu `gia`, `mua`, `chinh hang`, nhung dot dau giu query gon de tranh nhieu ket qua sai.

### 3. Lay ket qua Google

Pipeline tim kiem:

1. lay danh sach ket qua tu cong cu tim kiem
2. chuan hoa URL
3. loai bo duplicate domain/url
4. loc chi tiet san pham
5. lay toi da 20 link tot nhat

### 4. Loc link chi tiet san pham

Chi giu cac link co xac suat cao la trang chi tiet san pham. Heuristic:

- URL co slug san pham, khong phai trang chu/danh muc/search/tag
- title hoac noi dung co chua model dung hoac gan dung
- trang co duy nhat mot san pham chinh va mot gia chinh

Loai bo:

- trang danh muc
- trang tim kiem
- bai viet tin tuc/review
- marketplace list page
- trang khong co gia hoac khong tim thay model

### 5. Trich gia

Voi moi link:

- dung engine scrape hien co lam nen tang
- nap HTML / Puppeteer khi can
- tim gia ban hien tai
- chuan hoa ve so nguyen VND
- bo qua gia khong hop le, gia lien he, gia 0, gia ngoai mien hop ly

Moi ket qua hop le tra ve:

- `price`
- `sourceUrl`
- `domain`
- `matchedModel`

### 6. Chon top 10 gia

Sau khi gom tat ca gia hop le:

- sap xep tang dan
- lay 10 gia thap nhat

Gia tri ghi vao `Thi truong 1..10` la 10 gia thap nhat sau khi sap xep, chi ghi gia, khong ghi domain.

### 7. Loc outlier

Neu top 10 co it nhat 2 gia:

- neu `gia1 < gia2 * 0.9` thi loai `gia1`

Luc do danh sach hop le de tinh toan tiep theo se bo gia dau tien.

Neu khong vi pham dieu kien tren thi giu nguyen.

### 8. Tinh gia de xuat

Neu sau khi loc outlier con it nhat 3 gia:

- lay 3 gia thap nhat con lai
- tinh trung binh cong
- `giaDeXuat = avgTop3 * 0.995`
- lam tron ve so nguyen VND

Neu con duoi 3 gia:

- van ghi du lieu `Thi truong 1..10` neu co
- bo trong `Gia de xuat`
- ghi log la khong du gia hop le

### 9. Tinh cac cot tong hop

- `Min` = gia thap nhat hop le sau khi loc outlier
- `GAP` = `Gia ban hien tai - Min`
- `%GAP` = `GAP / Min`
- `Gia de xuat` = gia tinh tu trung binh top 3 x 0.995

Quy tac:

- `Gia ban` doc tu sheet va chuan hoa thanh so truoc khi tinh
- `%GAP` ghi duoi dang so thap phan de Google Sheets co the format `%`
- neu khong co `Min` thi de trong `GAP` va `%GAP`

## Apps Script API

### GET / read sheet

Request params:

- `sheetId`
- `sheetName`
- `startRow` (optional)
- `endRow` (optional)

Response:

- danh sach header
- danh sach row gom:
  - `rowNumber`
  - `productId`
  - `brand`
  - `model`
  - `costPrice`
  - `salePrice`

### POST / write results

Payload theo batch:

- `sheetId`
- `sheetName`
- `updates`: mang cac row update

Moi update gom:

- `rowNumber`
- `marketPrices`: mang toi da 10 gia
- `minPrice`
- `gapValue`
- `gapPercent`
- `suggestedPrice`
- `status`

Apps Script se map theo header va ghi dung cot.

## Backend API

### Endpoint de frontend goi

- `POST /api/sheet-pricing/start`
- `GET /api/sheet-pricing/status/:jobId`
- `POST /api/sheet-pricing/stop/:jobId`

### Hanh vi

`start`:

- validate input
- tao job id
- spawn pricing pipeline async

`status`:

- tra ve tong so dong
- so dong da xu ly
- so dong thanh cong / that bai / bo qua
- log moi nhat
- preview ket qua dong gan nhat

`stop`:

- dat co dung job an toan
- hoan tat batch dang chay neu can

## Hieu nang va song song

### Muc tieu

Toi uu hieu nang nhung khong lam Google hoac website dich block nhanh.

### Chien luoc

- xu ly theo batch row
- moi row crawl toi da 20 link
- gioi han concurrency o hai tang:
  - so row xu ly song song
  - so link xu ly song song trong cung mot row

De xuat mac dinh:

- `rowsConcurrency = 2`
- `linksConcurrency = 4`

Ly do:

- du nhanh hon chay tuan tu
- van giam nguy co bi chan
- phu hop voi Puppeteer/Cheerio trong app hien tai

### Cache va retry

- cache ket qua search trong pham vi 1 job
- retry toi da 2 lan cho request tam thoi loi
- timeout moi link
- bo qua domain loi lien tuc de tiet kiem thoi gian

## UI/UX dashboard

Them mot che do van hanh moi thay vi chi scrape URL thong thuong:

- khu nhap `Google Sheet URL`
- khu nhap `Sheet name`
- tuy chon `Start row` / `End row`
- nut `Bat dau pricing`
- nut `Dung`
- bang tien do:
  - row hien tai
  - brand/model hien tai
  - so link da quet
  - so gia hop le
  - min tam thoi
  - gia de xuat tam thoi

Can giu UI hien co neu no khong xung dot, nhung mode moi phai tach ro voi mode scrape cu de tranh roi.

## Xu ly loi

### Loi cau hinh

- thieu `Sheet URL`
- thieu `Sheet name`
- Apps Script URL chua cau hinh
- sheet khong ton tai
- thieu header bat buoc

### Loi runtime tung dong

- khong tim thay ket qua Google
- khong du 20 link
- khong co gia hop le
- loi truy cap website
- timeout

Nguyen tac:

- loi mot dong khong duoc lam dung ca job
- moi dong can co `status` va `error message`
- ket qua hop le cua cac dong khac van duoc ghi

## Kiem thu

### Unit tests

Can co test cho cac ham thuan:

- map header sheet
- chuan hoa gia
- loc top 10
- detect outlier `>10%`
- tinh `Min`
- tinh `GAP`
- tinh `%GAP`
- tinh `Gia de xuat`

### Integration tests

- mock Apps Script read/write
- mock search results
- mock product detail pages
- kiem tra pipeline mot dong tu input den output

### Manual verification

Chay thu voi tab `01.Bep tu` tren pham vi nho:

- 3 dong dau
- 10 dong dau

Kiem tra:

- cot `Thi truong 1..10`
- cot `Min`
- cot `GAP`
- cot `%GAP`
- cot `Gia de xuat`
- log job tren UI

## Rollout

### Giai doan 1

- ho tro `01.Bep tu`
- chay thu tren it dong
- doi chieu ket qua bang tay

### Giai doan 2

- mo rong cho cac tab con khac trong workbook
- toi uu heuristic link chi tiet san pham theo tung nganh hang neu can

## Tieu chi hoan thanh

Tinh nang duoc xem la dat khi:

1. Website co the nhan `Sheet URL` va `Sheet name`.
2. Website doc duoc du lieu tu `01.Bep tu` qua Apps Script.
3. Moi dong hop le duoc xu ly theo flow `brand + model -> Google -> 20 link -> lay gia`.
4. Sheet duoc cap nhat dung cac cot:
   - `Thi truong 1..10`
   - `Min`
   - `GAP`
   - `%GAP`
   - `Gia de xuat`
5. Rule loai outlier va tinh gia de xuat dung voi thong nhat:
   - lay 10 gia thap nhat
   - loai gia dau neu thap hon gia thu 2 qua 10%
   - lay trung binh 3 gia thap nhat con lai
   - nhan `0.995`
6. Job khong bi fail toan bo khi mot dong loi.
7. UI hien tien do ro rang va cho phep dung job.
