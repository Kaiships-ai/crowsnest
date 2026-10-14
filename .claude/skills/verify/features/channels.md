# Channels: track a creator

Tracked creators on a kanban, and the dialog that adds one by handle or by a post URL through the IG sidecar (:8765).

## Sub-features

- `/channels`: `ChannelsKanban` with fleets (new, rename, remove), a sync selection bar, and a "Discover creators" link to `/channels/discover`. Each channel opens `/channels/<channelId>`.
- `AddChannelDialog` (`src/components/channels/add-channel-dialog.tsx`): tabs "By handle" and "Paste post URL". The Feed filter bar reuses it on the URL tab.
- With the sidecar down, an inline Alert reads "The Instagram service isn't running. Start it with `npm run ig:service`." (`src/server/ig/errors.ts`).

## How to get to it (user POV)

Sidebar, Sources, Channels, then the add-channel button in the kanban (`channels-add-channel-trigger`).

## Driving it with browse

`drive.sh ig-sync-e2e-01`. It opens the dialog, fills `add-channel-handle-input` with an unknown handle, clicks `add-channel-submit-handle`, and asserts the inline sidecar-down error, never an empty success.

## Gotchas

- The live success path needs a logged-in burner IG account (`services/ig/README.md`); this harness does not cover it.
- With the sidecar listening on :8765, the journey would query real Instagram (and can hit 429s on the burner account). `drive.sh` refuses to run it then; `doctor.sh` notes it. Stopping the operator's sidecar is the operator's call.
- The sidecar's `/health` answers 401 without the service token, so a status probe cannot tell up from down; check the :8765 listener.
