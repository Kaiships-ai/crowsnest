# Crowsnest — Design System & Ràng buộc thiết kế

> Tài liệu này là **luật**, không phải gợi ý. Mọi màn hình mới phải pass được checklist ở mục 10 trước khi coi là xong.
> Bản chất sản phẩm: công cụ đo **outlier tương đối** — một post được đánh giá theo median của chính channel đó, không theo view tuyệt đối. Đó là lý do một account 5 follower vẫn dùng được. Mọi quyết định thiết kế phải phục vụ việc **tìm ra bất thường nhanh nhất**.

---

## 1. Ba nguyên tắc gốc

### 1.1. Không có UI tự thuyết minh
Nếu một element cần một câu văn để giải thích sự tồn tại của nó → **element đó sai, không phải câu đó thiếu**.

| Thay vì | Hãy làm |
|---|---|
| Filter chip `Unknown 0` + câu giải thích tại sao nó bằng 0 | Ẩn chip khi count = 0 |
| Label filter kèm slogan sản phẩm | Bỏ slogan. Slogan thuộc về landing page |
| Banner giải thích triết lý giữ dữ liệu | Nói trạng thái, hết |
| Tooltip dài giải thích một cột | Đổi tên cột cho đúng nghĩa |

**Ngân sách chữ giải thích của toàn bộ app: 0.** Chỉ được phép giải thích ở đúng 2 chỗ: empty state lần đầu, và error state (nói cách sửa).

### 1.2. Một khái niệm — một tên — một chỗ
Mọi thông tin chỉ được xuất hiện **một lần** trên một màn. Nếu đã có banner "Đã gỡ khỏi Instagram" thì không có badge REMOVED, không có dòng `removed from Instagram` bên cạnh tab.

### 1.3. Yên lặng là mặc định
Trạng thái bình thường (Healthy, đã sync, không có gì bất thường) **không được phép có màu, không được phép có icon, không được phép có badge**. Chỉ cái bất thường mới được nổi lên. Một bảng 7 channel khoẻ mạnh phải trông gần như trống.

---

## 2. Token màu

Dùng đúng 11 giá trị này. Không thêm, không pha, không opacity tuỳ hứng.

```
--bg-base       #0B0B0C   nền app
--bg-raised     #141416   panel, card, row nổi
--bg-hover      #1C1C1F   hover state
--line-subtle   #232326   kẻ bảng, chia section
--line-strong   #34343A   viền input, viền button phụ

--text-primary  #F2F2F0   nội dung chính, số liệu
--text-secondary #9A9A96  label, metadata
--text-tertiary #6B6B68   chú thích, đơn vị, timestamp

--amber         #E8A33D   TÍN HIỆU OUTLIER — xem mục 3
--red           #D9503F   lỗi chặn thao tác
--amber-wash    rgba(232,163,61,0.12)  nền badge score
```

**Không có màu xanh lá.** Trạng thái tốt = `--text-secondary`, không tô màu. Sản phẩm này không cần khen user rằng mọi thứ ổn.

**Không gradient. Không shadow.** Phân tầng bằng `--bg-raised` và `--line-subtle`.

---

## 3. Luật amber (quan trọng nhất)

Amber **chỉ có một nghĩa duy nhất: đây là điểm bất thường đáng xem**.

✅ Được dùng amber:
- Score badge (`10.1×`) và thanh gauge của score
- Cột/ô trong biểu đồ đại diện post vượt median
- Đúng **một** primary action mỗi màn hình

❌ Cấm dùng amber:
- Nav item đang active → dùng `--bg-raised` + `--text-primary` + thanh 2px `--line-strong` bên trái
- Toggle/segmented control đang chọn → `--bg-raised` + `--text-primary`
- Logo, checklist, progress bar, badge số ở sidebar
- Bất kỳ button phụ nào

**Ngân sách: tối đa 1 vùng amber lớn + N badge score trên mỗi viewport.** Nếu đếm thấy >1 vùng amber lớn, cắt bớt.

---

## 4. Typography

Ba vai trò, không hơn.

| Vai trò | Dùng cho | Spec |
|---|---|---|
| **Display** | Tiêu đề màn, tiêu đề card, headline | Grotesque bold, `letter-spacing: -0.02em` |
| **Body** | Câu, mô tả, nội dung đọc | Cùng family, weight 400 |
| **Mono** | **Mọi con số, mọi ID, mọi timestamp, mọi trạng thái hệ thống** | tabular-nums bắt buộc |

**Luật cứng:** đã là số thì phải mono + `font-variant-numeric: tabular-nums`. Cột số trong bảng phải căn phải. Không có ngoại lệ — đây là thứ khiến app "trông như tool phân tích" thay vì "trông như landing page".

Type scale (chỉ 6 bậc):
```
32 / 20 / 15 / 13 / 11 / 11-uppercase-tracking-0.08em
```
Bậc 11-uppercase chỉ dùng cho header cột và nhãn nhóm sidebar. Không dùng uppercase ở bất cứ chỗ nào khác.

---

## 5. Không gian & hình khối

- **Spacing:** chỉ dùng `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`. Số khác là sai.
- **Radius:** `2px` cho button, input, badge. `0` cho bảng và card ảnh. Không có radius lớn hơn 4px ở bất cứ đâu.
- **Border:** 1px, `--line-subtle`. Không dùng border để trang trí, chỉ để chia vùng.
- **Chiều cao row bảng:** 56px. Không tự ý đổi.

---

## 6. Từ điển thuật ngữ (bắt buộc dùng đúng)

Mỗi khái niệm có **đúng một** cách gọi trong toàn bộ app:

| Khái niệm | Từ được dùng | Cấm dùng |
|---|---|---|
| Dịch vụ chạy local | **local service** | sidecar, proxy, local model, service |
| Hành động kéo dữ liệu về | **Sync** (động từ, mọi nơi) | Run, Refresh, Fetch, Update |
| Chỉ số vượt median | **score** | multiplier, outlier ratio, ×-value |
| Kênh của user | **My channel** | your channel, own channel |
| Bài đăng | **post** | video, item, content |

Nút và kết quả phải trùng động từ: nút `Sync` → toast `Synced`. Nút `Transcribe` → trạng thái `Transcribed`.

Copy dùng **sentence case**, không dùng Title Case cho nút.

---

## 7. Luật trạng thái (state)

### 7.1. Trạng thái phải nhất quán tuyệt đối
Số liệu trạng thái (`x of y channels synced`) đọc từ **một nguồn duy nhất**. Nếu sidebar nói 6/6 mà màn khác nói 5/6 → lỗi P0.

### 7.2. Service down thì mọi thứ phụ thuộc nó phải disabled
Khi local service không chạy:
- Mọi nút Sync / Transcribe: `disabled`, opacity 0.4, tooltip `Cần local service đang chạy`
- **Không được** để nút sáng amber rồi khi bấm mới báo lỗi
- Banner lỗi chỉ hiện **một lần** ở top, không lặp lại ở từng row

### 7.3. Cấu trúc banner lỗi
Đúng 4 phần, không thêm:
```
[Nhãn]  [Chuyện gì xảy ra + ảnh hưởng gì]     [mã lỗi · thời điểm check]  [Hành động sửa]
```
Ví dụ đạt chuẩn:
`LOCAL SERVICE — Không chạy được. Sync và transcribe tạm dừng; feed và vault vẫn dùng được.  IG_SERVICE_DOWN:8787 · 4s trước  [Copy lệnh khởi động]`

### 7.4. Empty state
Một câu nói **thiếu gì**, một nút nói **làm gì**. Không giải thích cơ chế, không liệt kê các bước như nhãn tab.

---

## 8. Luật component

### Bảng
- Cột số căn phải, mono, tabular.
- Action button (Sync…) **ẩn mặc định, chỉ hiện khi hover row** — trừ row đang lỗi/stale thì hiện luôn. Không được lặp button ở cả 7 row cùng lúc.
- Row bình thường: không màu, không icon. Row bất thường: chấm 6px + nhãn trạng thái.
- Không trộn hai loại đối tượng trong một bảng (channel theo dõi vs channel của mình → tách section).

### Card
- **Đúng một headline mỗi card.** Nếu chữ đè trên ảnh là hook thì bỏ title bên dưới, và ngược lại. Không bao giờ có hai dòng tiêu đề cạnh tranh nhau.
- Mỗi metric phải có nhãn chữ, không được chỉ có icon. `10.1× score` / `2.27M views` / `4.1% engagement`.
- Tối đa 3 metric. Cái thứ 4 trở đi vào trang chi tiết.
- Không có progress bar nếu không nói được nó đo cái gì.

### Badge trong sidebar
Chỉ được chứa **count**. Không nhét score hay quota vào cùng vị trí với count — khác loại thông tin thì khác vị trí.

### Biểu đồ
Chú thích phải khớp dữ liệu. Nếu ghi "amber = vượt median của chính channel" thì theo định nghĩa phải có ~50% ô amber. Lệch nhiều → sai logic hoặc sai nhãn, phải sửa trước khi ship.

### Tab
Tab mặc định là tab **đầu tiên trong luồng làm việc**, không phải tab đẹp nhất. Nếu chưa phân tích thì mặc định mở tab đầu (nguồn dữ liệu thô), không mở tab kết quả rỗng.

---

## 9. Luật layout

- **Cấm cột chết.** Nếu một bên màn trống >50% chiều cao trong khi bên kia phải cuộn → phân bổ lại. Số liệu quan trọng không được rơi xuống dưới fold trong khi nửa màn bên cạnh để đen.
- Nội dung chính tối đa 1440px, canh trái theo sidebar.
- Onboarding checklist phải **dismiss được**, và tự thu thành một dòng sau khi hoàn thành lần đầu.

---

## 10. Checklist bắt buộc trước khi coi màn hình là xong

Đếm, không cảm tính:

1. [ ] Đếm số vùng amber lớn trên viewport → phải ≤ 1 (không tính score badge)
2. [ ] Đọc mọi câu văn trên màn → xoá mọi câu đang giải thích lý do một element tồn tại
3. [ ] Mỗi thông tin xuất hiện đúng 1 lần → không có badge/banner/nhãn nói cùng một chuyện
4. [ ] Mọi con số đều mono + tabular + căn phải nếu ở trong bảng
5. [ ] Mọi số liệu trạng thái khớp với các màn khác
6. [ ] Mọi nút không khả dụng đều đã disabled, không có nút "sáng nhưng bấm ra lỗi"
7. [ ] Mọi metric đều có nhãn chữ
8. [ ] Mỗi card chỉ có 1 headline
9. [ ] Chú thích biểu đồ khớp với dữ liệu hiển thị
10. [ ] Không có filter/chip nào đang hiện với count = 0
11. [ ] Không có vùng trống >50% cạnh vùng đang phải cuộn
12. [ ] Từ ngữ khớp từ điển mục 6

---

## 11. Block để paste vào Claude Design

```
Thiết kế theo design system Crowsnest. Ràng buộc cứng:

MÀU: chỉ dùng #0B0B0C nền, #141416 panel, #1C1C1F hover, #232326 kẻ,
#34343A viền, #F2F2F0 chữ chính, #9A9A96 chữ phụ, #6B6B68 chú thích,
#E8A33D amber, #D9503F đỏ lỗi. Không xanh lá, không gradient, không shadow.

AMBER chỉ mang nghĩa "đây là outlier đáng xem". Tối đa 1 vùng amber lớn
mỗi màn. Nav active và toggle active dùng nền #141416 + chữ trắng, KHÔNG amber.

CHỮ: mọi con số dùng mono + tabular-nums, căn phải trong bảng.
Type scale chỉ 32/20/15/13/11. Uppercase chỉ cho header cột.
Sentence case cho nút.

SPACING chỉ 4/8/12/16/24/32/48/64. Radius tối đa 2px. Row bảng 56px.

TUYỆT ĐỐI KHÔNG:
- Viết câu giải thích tại sao một element tồn tại. Nếu cần giải thích thì
  sửa element, đừng thêm chữ.
- Hiện filter/chip có count = 0.
- Lặp cùng một thông tin ở 2 chỗ trên cùng màn.
- Metric chỉ có icon mà không có nhãn chữ.
- Hai headline trên cùng một card.
- Nút sáng khi thao tác đó đang không khả dụng — phải disabled.
- Để trống >50% một cột trong khi cột kia phải cuộn.

TRẠNG THÁI BÌNH THƯỜNG KHÔNG CÓ MÀU. Chỉ cái bất thường mới nổi lên.
Action button trong bảng ẩn mặc định, chỉ hiện khi hover row.

TỪ VỰNG: local service (không dùng sidecar/proxy), Sync (không dùng Run/
Refresh), score (không dùng multiplier), post (không dùng video/item).
```

---

## 12. Ba lỗi hay tái phát — canh chừng

1. **Giải thích thay vì sửa.** Gặp ngoại lệ dữ liệu → phản xạ đầu tiên phải là "ẩn/gộp/đổi element", không phải "viết một dòng nói rõ".
2. **Amber lan ra.** Mỗi lần thêm một thứ "quan trọng" lại tô amber. Sau 5 lần thì không còn gì quan trọng nữa.
3. **Trạng thái tách rời logic.** Vẽ UI trạng thái lỗi nhưng quên disable control tương ứng.
