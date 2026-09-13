---
description: Index skill DOCS crowsnest
---
INDEX skill nhóm DOCS. Args: $ARGUMENTS

- Nếu $ARGUMENTS rỗng → in bảng dưới, hỏi tao chọn số/tên.
- Nếu $ARGUMENTS có số/tên → chọn skill tương ứng.
- Khi đã chọn: skill KHÔNG có `disable-model-invocation: true` → gọi qua Skill tool. Skill CÓ flag đó → KHÔNG auto-invoke được, báo tao gõ `Trigger:` của nó (xem SKILL.md).
- KHÔNG chạy gì khi chưa chọn.

| # | Skill | Khi nào |
|---|-------|---------|
| 1 | technical-documentation 🥚 | chuẩn viết doc (feeds house-style) |
| 2 | crowsnest-refactor-docs 🥚 | refactor doc cũ, audit nguồn |
| 3 | crowsnest-document-component 🔒 | bộ 5-doc + mkdocs wiring |

🥚 = chưa port · 🔒 = gõ Trigger tay.
