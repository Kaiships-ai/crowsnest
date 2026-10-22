# Channels and Discover: track a creator

The Kênh and Khám phá tabs of Nguồn: tracked creators on a kanban, the dialog that adds one by handle or by a post URL through the IG sidecar (:8765), and curated creator suggestions.

## Sub-features

- `/channels`: `ChannelsKanban` with fleets (new, rename, remove), a sync selection bar, and a "Discover creators" link to `/channels/discover`. Each channel opens `/channels/<channelId>`.
- `AddChannelDialog` (`src/components/channels/add-channel-dialog.tsx`): tabs "By handle" and "Paste post URL". The Feed filter bar reuses it on the URL tab.
- With no channels, the kanban's empty state adds a second `channels-add-channel-trigger` and "Chọn từ Khám phá" (`channels-empty-discover`). The seed has one channel, so it shows the kanban.
- `/channels/discover` (`src/components/discover/discover-board.tsx`): `discover-niche-filter`, `discover-count`, `creator-seed-card` with `creator-seed-follow` "Theo dõi". Empty: "Chưa có gợi ý creator nào." and `discover-empty-line` "Thêm một kênh bạn biết ở tab Kênh."
- With the sidecar down, an inline Alert reads "The Instagram service isn't running. Start it with `npm run ig:service`." (`src/server/ig/errors.ts`).

## How to get to it (user POV)

Sidebar, Nguồn (lands on `/feed`), then the Kênh tab (`sources-tab-channels`) and the add-channel button (`channels-add-channel-trigger`). Discover is the Khám phá tab (`sources-tab-discover`) or the "Discover creators" link in the kanban.

## Driving it with browse

`drive.sh ig-sync-e2e-01`. It opens the dialog, fills `add-channel-handle-input` with an unknown handle, clicks `add-channel-submit-handle`, and asserts the inline sidecar-down error, never an empty success.

Discover has no journey: `goto /channels/discover` and assert the empty-state text above. Opening the add dialog without submitting is safe with the sidecar up; its tabs read "By handle" and "Paste post URL".

## Gotchas

- The live success path needs a logged-in burner IG account (`services/ig/README.md`); this harness does not cover it.
- With the sidecar listening on :8765, the journey would query real Instagram (and can hit 429s on the burner account). `drive.sh` refuses to run it then; `doctor.sh` notes it. Stopping the operator's sidecar is the operator's call.
- A fresh seed has no `creator_seeds`: `seed-e2e.ts` skips `bootstrapCreatorSeeds`, so Discover always shows its empty state and Follow is unreachable here (`npm run db:bootstrap` loads the curated creators from `data/seeds/` into the operator DB).
- `ig-sync-e2e-01.sh` itself only warns when :8765 answers; the refusal lives in `drive.sh`. Run it through `drive.sh`.
- The sidecar's `/health` answers 401 without the service token, so a status probe cannot tell up from down; check the :8765 listener.
