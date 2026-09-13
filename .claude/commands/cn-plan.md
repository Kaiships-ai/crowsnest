---
description: Index skill WORKFLOW/PLAN crowsnest
---
INDEX skill nhóm PLAN. Args: $ARGUMENTS

- Nếu $ARGUMENTS rỗng → in bảng dưới, hỏi tao chọn số/tên.
- Nếu $ARGUMENTS có số/tên → chọn skill tương ứng.
- Khi đã chọn: skill KHÔNG có `disable-model-invocation: true` → gọi qua Skill tool. Skill CÓ flag đó → KHÔNG auto-invoke được, báo tao gõ `Trigger:` của nó (xem SKILL.md).
- KHÔNG chạy gì khi chưa chọn.

| # | Skill | Khi nào |
|---|-------|---------|
| 1 | brainstorming | trước mọi việc sáng tạo |
| 2 | writing-plans | plan đa bước trước code |
| 3 | subagent-driven-development | exec plan (default 1 build+1 review) |
| 4 | systematic-debugging | debug có hệ thống |
| 5 | verification-before-completion | gate "xong thật chưa" |
| 6 | using-git-worktrees | cô lập feature |
| 7 | finishing-a-development-branch | integrate khi xong |
| 8 | writing-skills | viết/sửa skill |

(inline từ plugins/ship; tên trần → kiểm tra không đụng skill global)
