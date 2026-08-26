# Crowsnest — Mindset thiết kế: "Show, don't tell"

> Bổ sung cho `crowsnest-design-system.md`. Doc kia quy định **được dùng cái gì** (màu, token, từ vựng). Doc này quy định **cách sắp xếp** — thứ đang làm màn hình khó nhìn.
> Mục 4 dưới đây **thay thế** mục Typography của doc kia.

---

## 0. Cảnh báo trước: đừng bắt chước bề mặt

Tinh thần Apple **không phải** là bo góc, blur, font SF, hay nền trắng. Bắt chước những thứ đó chỉ tạo ra một bản sao rẻ tiền.

Tinh thần thật nằm ở **một câu**: giao diện lùi lại một bước để dữ liệu bước lên phía trước.

Nhìn app Fitness, Health, hay Screen Time: không có bảng kẻ ô, không có badge, không có box viền, không có nhãn giải thích. Chỉ có **số to, chữ nhỏ, và khoảng trống**. Người dùng hiểu ngay mà không phải đọc câu nào. Đó là điều Crowsnest đang thiếu.

---

## 1. Sáu quy luật

### 1.1. Giao diện lùi, dữ liệu tiến
Chrome (viền, nền panel, badge, button, box) là **hạ tầng**, không phải nội dung. Nó phải mờ đi. Nếu bạn nheo mắt nhìn màn hình và thứ nổi lên là các đường kẻ và ô vuông thay vì các con số — thiết kế đã sai.

**Bài test nheo mắt:** blur màn hình 8px. Thứ còn đọc được phải là dữ liệu quan trọng nhất. Hiện tại blur màn Channels thì thứ nổi lên là 7 nút SYNC và các đường kẻ ngang. Đó là bug.

### 1.2. Phân cấp bằng cỡ chữ và khoảng trắng, không bằng hộp và viền
Đây là thay đổi lớn nhất cần làm.

Cách hiện tại: mọi thứ cùng cỡ 13px, phân biệt nhau bằng box, viền, nền, badge → mắt không biết nhìn đâu trước.

Cách đúng: **bỏ hết box, cho chênh lệch cỡ chữ gánh việc.** Một con số 40px cạnh một nhãn 11px tự nó đã tạo phân cấp mạnh hơn mọi đường viền.

> Nguyên tắc: mỗi khi định vẽ một đường kẻ hoặc một cái box để phân tách — hãy thử tăng khoảng trắng gấp đôi trước. 8/10 lần khoảng trắng thắng.

### 1.3. Mỗi màn có đúng một nhân vật chính
Trước khi thiết kế, viết ra một câu: *"Màn này tồn tại để user thấy ___"*.

- Feed → *thấy post nào bất thường nhất*
- Video → *thấy post này vượt median bao nhiêu lần và vì sao*
- Channels → *thấy channel nào đang hỏng sync*

Thứ đó được phép to. **Mọi thứ khác phải chủ động nhỏ đi.** Không có "cái này cũng quan trọng". Nếu ba thứ cùng quan trọng thì không thứ nào quan trọng.

### 1.4. Khoảng trắng là cấu trúc, không phải chỗ thừa
Nhóm thông tin bằng khoảng cách, không bằng đường kẻ:
- Giữa các item **cùng nhóm**: 8–12px
- Giữa các **nhóm** trong một khối: 24–32px
- Giữa các **khối/section**: 64–80px

Chênh lệch phải rõ ràng. Nếu khoảng cách trong nhóm là 12 và giữa nhóm là 16 thì mắt không đọc được — phải là 12 và 32.

### 1.5. Ít trục canh lề
Cả màn hình chỉ nên có **2–3 trục canh trái**. Mọi thứ bám vào đó. Bảng hiện tại có 5 trục (icon, tên, follower, post, sync) → tạo cảm giác lộn xộn dù mỗi cột đều thẳng.

Cách sửa: gom thành 2 cột thông tin thay vì 5, phần còn lại xếp chồng bên dưới với cỡ chữ nhỏ hơn.

### 1.6. Chi tiết xuất hiện khi được hỏi
Mặc định hiện thứ tối thiểu để ra quyết định. Chi tiết (timestamp chính xác, mã lỗi, N=8, cách tính) chỉ hiện khi hover hoặc khi vào trang chi tiết.

---

## 2. Bảng dịch: pattern hiện tại → pattern đúng

| Đang làm | Đổi thành |
|---|---|
| Bảng có kẻ ngang từng dòng | List không kẻ, phân tách bằng 20px padding dọc. Kẻ chỉ dùng dưới header |
| Badge có nền cho mọi metric | Chữ trần. Badge nền chỉ dành cho score |
| 4 cột ngang cùng cỡ chữ | 1 cột chính (tên, 15px) + metadata xếp dưới (11px, `--text-tertiary`) |
| Nút SYNC ở mọi row | Ẩn, hiện khi hover. Row lỗi thì hiện sẵn |
| Chữ "Healthy · 1h ago" ở mọi row khoẻ | Không hiện gì cả. Chỉ row có vấn đề mới có chữ |
| Ba metric ngang hàng trên card | Score to (20px), hai cái còn lại 11px xếp dưới |
| Chú thích "amber = posts that beat…" | Vẽ đường median lên chart, bỏ chú thích |
| "8 posts · med 224,403" bên phải chart | Median là đường kẻ trên chart. Số chỉ hiện khi hover |
| Panel viền amber quanh empty state | Bỏ viền, bỏ nền. Chỉ chữ + nút, canh giữa vùng trống |
| Section header uppercase + kẻ ngang | Uppercase 11px `--text-tertiary`, bỏ kẻ, tăng khoảng trên thành 32px |

---

## 3. Sửa cụ thể ba màn

### Channels — bỏ bảng, chuyển thành list
```
Hiện tại (5 cột, kẻ ngang, 7 nút):
┌──────────────────────────────────────────────────────┐
│ ▪ @kallaway      442,447   8 · 224,403  Partial 2h  [SYNC] │
├──────────────────────────────────────────────────────┤
│ ▪ @futurestack  1,284,600  15 · 611,000 Healthy 1h  [SYNC] │
└──────────────────────────────────────────────────────┘

Đổi thành:
   @kallaway                                    442,447
   Mid band · 8 posts · median 224,403        ● chưa sync đủ

   @futurestack                               1,284,600
   Macro band · 15 posts · median 611,000

   @promptsmith                                  88,700
   Micro band · 11 posts · median 41,500
```
Tên 15px trắng. Dòng metadata 11px `--text-tertiary`. Follower 15px mono căn phải. Row khoẻ **không có chữ trạng thái nào**. Nút Sync hiện khi hover. Khoảng cách giữa các row: 20px, không kẻ.

### Feed — card bớt một tầng
```
Hiện tại: [hook trên ảnh] + [title cắt] + [3 badge] + [1 badge] + [progress bar]

Đổi thành:
   ┌─────────────┐
   │             │
   │    ảnh      │
   │             │
   │        1:24 │
   └─────────────┘
   10.1×
   2.3M views · 4.1% eng
   @kallaway · 4d
```
Score 20px amber, đứng riêng một dòng — đó là lý do card này tồn tại. Bỏ chữ đè trên ảnh **hoặc** bỏ title, không giữ cả hai. Bỏ progress bar. Bỏ ô vuông góc phải nếu nó không làm gì.

### Video — số liệu lên trên, dồn về một cột
Hiện tại: video + gauge + stats nhồi cột trái hẹp, cột phải trống 60%.

Đổi thành: video bên trái giữ nguyên tỷ lệ dọc. Cột phải, từ trên xuống:
```
10.1×
vượt median của chính channel này

├────────────────●──────────────┤
0.2×          1.0× = 224,403         12×

2,272,877 views      1:24      4 ngày trước

[tabs: Transcript · Hook & Structure · Why it worked]
```
Số `10.1×` cỡ 40px. Nhãn dưới nó 13px `--text-secondary`. Ba metric hàng dưới 15px mono, cách nhau 32px, không có nhãn viết hoa phía trên — đơn vị đi liền số.

---

## 4. Type scale mới (thay thế doc 1)

Cần **chênh lệch lớn hơn** để phân cấp không cần đến box.

| Bậc | Cỡ | Dùng cho |
|---|---|---|
| Hero | 40px | Con số nhân vật chính của màn (score) |
| Title | 28px | Tiêu đề màn |
| Value | 20px | Số liệu chính trong list/card |
| Body | 15px | Tên, nội dung đọc |
| Meta | 13px | Nhãn phụ, mô tả ngắn |
| Caption | 11px | Metadata, timestamp, đơn vị, header cột |

**Luật tỷ lệ:** một giá trị và nhãn của nó phải chênh nhau **ít nhất 2 bậc**. `10.1×` ở 40px thì nhãn ở 13px. Chênh 1 bậc là không đủ, mắt vẫn phải đọc cả hai.

**Luật thứ tự:** giá trị đứng trước, nhãn đứng sau (bên dưới hoặc bên phải), luôn nhỏ hơn và mờ hơn. Không bao giờ đặt nhãn viết hoa to phía trên một con số nhỏ — đó là làm ngược.

---

## 5. Catalogue "show, don't tell"

Mỗi khi định viết một câu, hỏi: **có cách nào cho user nhìn thấy thay vì đọc không?**

| Đang kể (tell) | Chuyển thành cho thấy (show) |
|---|---|
| "amber = posts that beat that channel's own median" | Vẽ đường median ngang qua chart. Cột vượt lên trên đường = amber |
| "med 224,403" ghi bên cạnh | Đường median trên gauge, có mốc số nhỏ ngay tại vị trí đó |
| "Healthy · 1h ago" ở 6 row | Không hiện gì. Chỉ row bất thường mới có chữ |
| "6 of 6 channels synced" | 6 chấm nhỏ. Chấm nào lỗi thì đổi màu. Chữ chỉ xuất hiện khi có lỗi |
| "Unknown is @hormozi: tracked, never synced…" | Ẩn chip. Row @hormozi hiện dấu `—` ở cột band |
| "how a 5-follower account finds copyable formats" | Bỏ. Sản phẩm tự chứng minh bằng việc @kaiships.ai 5 follower vẫn xếp cùng bảng với @hormozi 4.1M |
| "Nothing has read this video. Transcribe it and…" | Tab Transcript trống + một nút `Transcribe`. Trống đã là thông điệp |
| "1 · transcribe locally  2 · structure  3 · frames" | Bỏ. Ba bước này là chuyện nội bộ hệ thống |
| "The row is kept because its transcript… still matter" | `Đã gỡ khỏi Instagram · 4d trước`. Việc dữ liệu còn đó thì user tự thấy |

**Luật đếm:** một màn hình được phép có tối đa **một** câu văn hoàn chỉnh (có chủ ngữ + động từ), và nó phải nằm trong error state hoặc empty state. Mọi chữ còn lại là nhãn hoặc giá trị.

---

## 6. Block paste vào Claude Design

```
Thiết kế lại theo tinh thần "show, don't tell". Ràng buộc layout:

PHÂN CẤP bằng cỡ chữ và khoảng trắng, KHÔNG bằng box/viền/badge.
Bỏ mọi đường kẻ ngang giữa các row. Bỏ mọi box viền quanh nội dung.
Chỉ giữ 1 đường kẻ dưới header bảng.

TYPE SCALE: 40 / 28 / 20 / 15 / 13 / 11.
Một giá trị và nhãn của nó phải chênh ít nhất 2 bậc.
Giá trị đứng trước, nhãn nhỏ hơn và mờ hơn đứng sau. Không bao giờ
đặt nhãn viết hoa phía trên một con số nhỏ hơn nó.

KHOẢNG TRẮNG: trong nhóm 8-12px, giữa nhóm 24-32px, giữa section 64-80px.
Chênh lệch phải rõ, không được 12 với 16.

MỖI MÀN CÓ ĐÚNG MỘT NHÂN VẬT CHÍNH được phép to. Mọi thứ khác chủ động
nhỏ đi. Tối đa 2-3 trục canh trái cho cả màn.

THAY VÌ 4-5 CỘT NGANG: 1 cột chính 15px + metadata xếp bên dưới 11px màu mờ.

TRẠNG THÁI BÌNH THƯỜNG KHÔNG HIỆN CHỮ. "Healthy" thì không hiện gì cả.
Chỉ cái bất thường mới có chữ và màu.

MỖI KHI ĐỊNH VIẾT MỘT CÂU: tìm cách cho user NHÌN THẤY thay vì ĐỌC.
Median → vẽ đường trên chart. Tiến độ → chấm. Trạng thái tốt → im lặng.
Tối đa 1 câu văn hoàn chỉnh mỗi màn, chỉ trong error/empty state.

BÀI TEST: blur màn hình 8px. Thứ còn nổi lên phải là dữ liệu quan trọng
nhất, không phải đường kẻ, nút bấm hay box.
```

---

## 7. Checklist

1. [ ] Nheo mắt/blur 8px → thứ nổi lên là dữ liệu, không phải chrome
2. [ ] Viết được một câu "màn này để user thấy ___", và thứ đó là thứ to nhất
3. [ ] Đếm số đường kẻ ngang → chỉ còn dưới header
4. [ ] Đếm số box có viền → gần 0
5. [ ] Mọi cặp giá trị–nhãn chênh nhau ≥2 bậc type
6. [ ] Đếm trục canh trái → ≤3
7. [ ] Khoảng cách trong nhóm vs giữa nhóm chênh ≥2 lần
8. [ ] Đếm câu văn hoàn chỉnh trên màn → ≤1
9. [ ] Row/item ở trạng thái bình thường không có chữ trạng thái nào
10. [ ] Mỗi thông tin dạng "so sánh" đều được vẽ, không được kể
