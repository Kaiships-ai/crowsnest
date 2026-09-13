---
description: Master index — mọi group skill crowsnest
---
INDEX skill nhóm TẤT CẢ. Args: $ARGUMENTS

- Nếu $ARGUMENTS rỗng → in bảng dưới, hỏi tao chọn số/tên.
- Nếu $ARGUMENTS có số/tên → chọn skill tương ứng.
- Khi đã chọn: skill KHÔNG có `disable-model-invocation: true` → gọi qua Skill tool. Skill CÓ flag đó → KHÔNG auto-invoke được, báo tao gõ `Trigger:` của nó (xem SKILL.md).
- KHÔNG chạy gì khi chưa chọn.

Đây là index cấp 1. Gõ `/cn-<nhóm>` để mở menu skill trong nhóm.

| Command | Nhóm |
|---|---|
| `/cn-build` | component, up, backlog, fix, document, status |
| `/cn-content` | weekly, remix |
| `/cn-docs` | technical-documentation, refactor-docs, document-component |
| `/cn-testing` | test/QA (9 skill) |
| `/cn-review` | autoreview, pr, repair-sweep, score... |
| `/cn-release` | release cluster (8 skill) |
| `/cn-ops` | update, live-updater, route |
| `/cn-design` | hallmark, apple-design, prototype... |
| `/cn-plan` | brainstorming, writing-plans, subagent-driven-development... |
| `/cn-code` | gitnexus-* + shadcn |
