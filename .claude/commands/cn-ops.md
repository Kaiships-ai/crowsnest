---
description: Index skill OPS crowsnest
---
INDEX skill nhóm OPS. Args: $ARGUMENTS

- Nếu $ARGUMENTS rỗng → in bảng dưới, hỏi tao chọn số/tên.
- Nếu $ARGUMENTS có số/tên → chọn skill tương ứng.
- Khi đã chọn: skill KHÔNG có `disable-model-invocation: true` → gọi qua Skill tool. Skill CÓ flag đó → KHÔNG auto-invoke được, báo tao gõ `Trigger:` của nó (xem SKILL.md).
- KHÔNG chạy gì khi chưa chọn.

| # | Skill | Khi nào |
|---|-------|---------|
| 1 | crowsnest-route 🥚 | router FAST/CAREFUL (DANGER Next.js) |
| 2 | crowsnest-update 🥚 | update + session recovery |
| 3 | crowsnest-live-updater 🥚 | mirror main + tự sửa CI đỏ |

🥚 = chưa port (route từ kai).
