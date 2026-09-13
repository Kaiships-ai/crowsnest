---
description: Index skill CODE-GRAPH (gitnexus) + shadcn
---
INDEX skill nhóm CODE. Args: $ARGUMENTS

- Nếu $ARGUMENTS rỗng → in bảng dưới, hỏi tao chọn số/tên.
- Nếu $ARGUMENTS có số/tên → chọn skill tương ứng.
- Khi đã chọn: skill KHÔNG có `disable-model-invocation: true` → gọi qua Skill tool. Skill CÓ flag đó → KHÔNG auto-invoke được, báo tao gõ `Trigger:` của nó (xem SKILL.md).
- KHÔNG chạy gì khi chưa chọn.

| # | Skill | Khi nào |
|---|-------|---------|
| 1 | gitnexus-impact-analysis | BẮT BUỘC trước mọi edit |
| 2 | gitnexus-exploring | hiểu code/kiến trúc |
| 3 | gitnexus-debugging | trace bug |
| 4 | gitnexus-refactoring | rename/extract an toàn |
| 5 | gitnexus-cli | analyze/index repo |
| 6 | gitnexus-guide | gitnexus có tool gì |
| 7 | shadcn | quản shadcn components |
