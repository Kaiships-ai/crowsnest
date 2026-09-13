---
description: Index skill BUILD component crowsnest
---
INDEX skill nhóm BUILD. Args: $ARGUMENTS

- Nếu $ARGUMENTS rỗng → in bảng dưới, hỏi tao chọn số/tên.
- Nếu $ARGUMENTS có số/tên → chọn skill tương ứng.
- Khi đã chọn: skill KHÔNG có `disable-model-invocation: true` → gọi qua Skill tool. Skill CÓ flag đó → KHÔNG auto-invoke được, báo tao gõ `Trigger:` của nó (xem SKILL.md).
- KHÔNG chạy gì khi chưa chọn.

| # | Skill | Khi nào |
|---|-------|---------|
| 1 | crowsnest-component | component mới: concept→shipped |
| 2 | crowsnest-up | boot local stack (9router+dev+MCP) |
| 3 | crowsnest-backlog-board | quản bảng 05-backlog |
| 4 | crowsnest-fix-backlog-item 🔒 | fix 1 bug row (red-test-first) |
| 5 | crowsnest-document-component 🔒 | bộ 5-doc + mkdocs wiring |
| 6 | crowsnest-status | trạng thái lego, backlog mở |

🔒 = disable-model-invocation, gõ Trigger tay.
