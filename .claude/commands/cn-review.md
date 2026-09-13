---
description: Index skill REVIEW/LAND/CI crowsnest
---
INDEX skill nhóm REVIEW. Args: $ARGUMENTS

- Nếu $ARGUMENTS rỗng → in bảng dưới, hỏi tao chọn số/tên.
- Nếu $ARGUMENTS có số/tên → chọn skill tương ứng.
- Khi đã chọn: skill KHÔNG có `disable-model-invocation: true` → gọi qua Skill tool. Skill CÓ flag đó → KHÔNG auto-invoke được, báo tao gõ `Trigger:` của nó (xem SKILL.md).
- KHÔNG chạy gì khi chưa chọn.

| # | Skill | Khi nào |
|---|-------|---------|
| 1 | autoreview | multi-model review gate |
| 2 | crowsnest-pr | review/triage/land PR |
| 3 | crowsnest-repair-sweep | sửa bug batch |
| 4 | crowsnest-score | maturity scorecard |
| 5 | crowsnest-ci-limits (stub) | quản capacity CI |
| 6 | crowsnest-secret-scanning (stub) | triage secret alert |
| 7 | crowsnest-ghsa (stub) | advisory GHSA |

(stub) = frontmatter only, port sau.
