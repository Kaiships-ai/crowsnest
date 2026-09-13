---
description: Index skill RELEASE crowsnest
---
INDEX skill nhóm RELEASE. Args: $ARGUMENTS

- Nếu $ARGUMENTS rỗng → in bảng dưới, hỏi tao chọn số/tên.
- Nếu $ARGUMENTS có số/tên → chọn skill tương ứng.
- Khi đã chọn: skill KHÔNG có `disable-model-invocation: true` → gọi qua Skill tool. Skill CÓ flag đó → KHÔNG auto-invoke được, báo tao gõ `Trigger:` của nó (xem SKILL.md).
- KHÔNG chạy gì khi chưa chọn.

| # | Skill | Khi nào |
|---|-------|---------|
| 1 | crowsnest-release-maintainer 🥚 | prepare/publish/recover |
| 2 | crowsnest-release-ci 🥚 | full release validation |
| 3 | crowsnest-release-nightly 🥚 | alpha/nightly |
| 4 | crowsnest-changelog-update 🥚 | auto-changelog từ git |
| 5 | crowsnest-verify-release 🥚 | verify live + healthz |
| 6 | crowsnest-release-validation 🥚 | feedback tester |
| 7 | crowsnest-release-announcement 🥚 | announcement |
| 8 | crowsnest-plugin-testing 🥚 | validate plugin |

🥚 = chưa port.
