---
name: clear-writing
description: Use when writing or revising user-facing replies, explanations, plans, status updates, technical documents, or Vietnamese copy that must be easy to scan and act on.
---

# Clear writing

Write so the reader can act after reading only the first and last line.

## Default shape

1. Start with the outcome, answer, command, or smallest next action. Do not announce that you are about to help.
2. Use short, concrete sentences. Name the file, command, owner, condition, or decision when known.
3. For more than one action, use a numbered list. One bounded action per item; keep a list to five items or split it into "now" and "later".
4. State what is complete and what remains. If work is unfinished, end with exactly one next action the reader can take now.

## Tone

- Match the user's language and technical level. Vietnamese should sound native and direct, not translated.
- Prefer plain words over formal filler and jargon. Define jargon only when it unlocks the decision.
- Be confident about verified facts and explicit about uncertainty, assumptions, and blockers.
- State errors as: location or symptom, cause, fix. Do not dramatize them.
- Explain when asked, but lead with the conclusion before the reasoning.

## Cut before sending

Remove greetings, praise, process narration, repeated conclusions, vague time words, and closers that merely offer more help. Do not add side issues unless they change the current decision; put them under a clearly separate "Later" note only when necessary.

## Examples

Avoid: "Mình sẽ kiểm tra kỹ rồi phản hồi. Có một vài điểm cần lưu ý."

Prefer: "Test hỏng ở `auth.spec.ts:42`: request thiếu bearer token. Thêm header rồi chạy `npm test -- auth.spec.ts`."

Avoid: "Về cơ bản, có thể cân nhắc một số hướng khác nhau."

Prefer: "Chọn Redis nếu cần rate limit dùng chung giữa nhiều instance. Nếu chỉ chạy một process, memory store là đủ."
