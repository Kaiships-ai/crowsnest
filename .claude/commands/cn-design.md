---
description: Index skill DESIGN/taste crowsnest
---
INDEX skill nhóm DESIGN. Args: $ARGUMENTS

- Nếu $ARGUMENTS rỗng → in bảng dưới, hỏi tao chọn số/tên.
- Nếu $ARGUMENTS có số/tên → chọn skill tương ứng.
- Khi đã chọn: skill KHÔNG có `disable-model-invocation: true` → gọi qua Skill tool. Skill CÓ flag đó → KHÔNG auto-invoke được, báo tao gõ `Trigger:` của nó (xem SKILL.md).
- KHÔNG chạy gì khi chưa chọn.

| # | Skill | Khi nào |
|---|-------|---------|
| 1 | hallmark | anti-AI-slop design |
| 2 | apple-design | UI/motion kiểu Apple |
| 3 | emil-design-eng | polish, chi tiết vô hình |
| 4 | prototype | biến thể UI sau picker |
| 5 | pick-ui-library | chọn lib frontend |
| 6 | improve-animations | audit motion + plan |
| 7 | find-animation-opportunities | tìm chỗ nên animate |
| 8 | review-animations | review motion |
| 9 | animation-vocabulary | tra tên hiệu ứng |

(inline từ plugins/taste sau migration; tên trần → kiểm tra không bị skill global cùng tên đè)
