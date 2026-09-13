---
name: crowsnest-docker-e2e
description: Author and run a containerized end-to-end lane for the crowsnest Next app plus 9router proxy. Trigger:/crowsnest-docker-e2e
---

# crowsnest docker e2e

Stand up a containerized e2e lane that boots the crowsnest stack (Next server on 3000, 9router proxy, drizzle database) and runs the e2e suite (`scripts/e2e/run.sh`) against it, reproducibly.

TODO: port from openclaw-docker-e2e-authoring. Map to `npm run e2e` and the crowsnest stack; drop OpenClaw gateway/provider specifics. Flesh out later.
