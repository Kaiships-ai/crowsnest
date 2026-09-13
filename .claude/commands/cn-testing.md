---
description: Index skill TEST/QA crowsnest
---
INDEX skill nhóm TEST/QA. Args: $ARGUMENTS

- Nếu $ARGUMENTS rỗng → in bảng dưới, hỏi tao chọn số/tên.
- Nếu $ARGUMENTS có số/tên → chọn skill tương ứng.
- Khi đã chọn: skill KHÔNG có `disable-model-invocation: true` → gọi qua Skill tool. Skill CÓ flag đó → KHÔNG auto-invoke được, báo tao gõ `Trigger:` của nó (xem SKILL.md).
- KHÔNG chạy gì khi chưa chọn.

| # | Skill | Khi nào |
|---|-------|---------|
| 1 | crowsnest-testing | chọn test cân xứng |
| 2 | test-audit | thẩm định test mới |
| 3 | crowsnest-e2e | Playwright + mock-backend |
| 4 | crowsnest-auto-qa | QA campaign nhiều feature |
| 5 | crowsnest-qa-testing | scenario lab |
| 6 | crowsnest-test-performance | Lighthouse/Web-Vitals/bundle |
| 7 | crowsnest-test-heap-leaks (stub) | rò rỉ bộ nhớ |
| 8 | crowsnest-docker-e2e (stub) | e2e trong Docker |
| 9 | proof-video | video proof UI |

(stub) = frontmatter only, port sau.
