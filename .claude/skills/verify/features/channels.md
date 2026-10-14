# Channels: track a handle

Add a creator by handle; crowsnest asks the IG sidecar (:8765) to fetch it.

## Sub-features

- Add-channel dialog on `/channels`.
- Inline error Alert when the sidecar is down (`add-channel-dialog.tsx`).

## How to get to it (user POV)

Sidebar, Sources, Channels, then the add-channel control.

## Driving it with browse

`drive.sh ig-sync-e2e-01`. It submits an unknown handle with the sidecar down and asserts the inline error, never an empty success.

## Gotchas

- The live success path needs a logged-in burner IG account (`services/ig/README.md`); this harness does not cover it.
- If `doctor.sh` notes the sidecar is up on :8765, stop it before this journey.
