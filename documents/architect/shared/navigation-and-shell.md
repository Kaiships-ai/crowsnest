# Navigation and the shell

## Summary

Every core loop page renders inside a persistent shell: a sidebar, a topbar with a failure strip, and a command menu, provided by the `(shell)` layout. This document owns how the shell is built, how it redirects a fresh install to first run, and how pages stay current: they render on the server and re read on navigation or an explicit refresh, rather than polling. Other documents link here for the refresh model and the navigation blocker.

## The shell

The shell wraps every page under `(shell)`. From the outside in it is a navigation blocker, a command menu, the client error reporter, and then a two column frame: the sidebar on the left, and a column holding the topbar above the scrolling page content.

The sidebar carries the navigation items and a get started checklist. The items are ordered by the creator's day and the product loop rather than by category: an overview section (the dashboard, the daily landing) leads, then create (the feed, ideas, and the vault, in the order signal turns into a saved idea), then sources, then system and setup at the bottom where infrequent tasks belong. The current page is marked with a neutral accent bar down its left edge; clicking a nav item lights the target immediately and reconciles when the route commits, so the marker never lags the click. The feed item also carries the sidebar's one live signal: a count of outliers new since the creator last opened the feed, shown in the amber the design system reserves for the score and hidden when the count is zero. That count is the same "new outlier" the dashboard counts, and the cutoff it measures against moves only when the creator opens the feed.

The dashboard carries three tabs held in the URL as `?tab=overview|reels|calendar`: Overview (the research dashboard), My reels, and Calendar (the [mine](../core-components/mine/01-concept-brief.md) component). A missing or unknown tab means Overview, and only the active tab's reads run. There is no "My channel" sidebar entry; the old `/mine` route redirects to `/?tab=calendar`, keeping a valid `month`.

The checklist is four real facts read on each navigation, not session flags: finish setup, watch a channel, save a post, draft a script, each marked done from a live count. The topbar carries the failure strip, a banner of recent failures across the app.

> Technical note: the layout is a server component rendered with `force-dynamic`. Without that, a build could freeze the failure strip and the counts at build time. Because it is dynamic, the shell re reads its counts and its strip on every full navigation into it.

## The first run gate

Before the shell renders anything, it checks a gate: a fresh install with setup not completed and no channels tracked is redirected to `/first-run` and never sees the shell. The gate is checked before any other read, so a redirect does not pay for queries it would throw away. First run onboarding itself is out of scope for this document; the gate is described here only because it stands between an install and the core loop.

## How pages stay current

The core loop does not poll. Pages render on the server with a snapshot of the database, and that snapshot refreshes in two ways.

A full navigation re runs the page and the shell. Moving between feed, mine, and channels re reads everything, so counts and strips are current after any navigation.

An explicit refresh re reads the current page without a navigation. After a write, a client component calls a refresh so the server data it depends on reappears with the change: the keep this post button flips to "Kept", the calendar shows a new plan, the failure strip freshens when a run finishes while the shell is already mounted. The refresh is how a server rendered value reflects a client action without a manual reload.

> Technical note: the refresh is `router.refresh()`. Between a write landing and the refresh completing there is a brief window where the client and the database disagree; each feature document notes where that window is visible.

## The navigation blocker

The shell provides a navigation blocker so a page with unsaved work can stop a navigation and ask first. Where a feature registers with it (a dirty form, a stage mid edit), leaving is intercepted rather than silent. Where a feature does not register, navigation is immediate and any uncommitted work is discarded per that feature's leave without acting behavior.

## Deep links

Pages can be opened with an action or a seed in the URL. The remix page opens with a stage or a quick remix seed in its query string; the feed carries its filters in the URL so a saved view is a link. A deep link is how one page starts another in a particular state, and how the browser back and forward buttons move between those states.

## The command menu

The shell includes a keyboard driven command menu for jumping between pages and actions. It is available on every core loop page. Its full contents are part of the shell rather than any one feature.

## Interactions with other systems

**Persistence and autosave.** The shell holds no per action state; it reads counts and strips fresh each time. See [persistence](persistence.md) for what individual pages save.

**History and undo.** Browser back and forward move between URL states (filters, stages). There is no shell level undo.

**Navigation and refresh.** This document owns the refresh model other documents link to.

**Background jobs and the sidecar.** A run finishing while the shell is mounted freshens the failure strip through a refresh, not a poll. See [background jobs](background-jobs.md).

**External services.** The shell itself needs none; its reads are local. Individual pages degrade when a service is down, described in [external services](external-services.md).

**Status and failures.** The failure strip in the topbar is the shell's own status surface. See [status and failures](status-and-failures.md).

**Configuration and settings.** The get started checklist and the gate read setup state; otherwise the shell has no configuration of its own.

## Edge cases

- A fresh install never sees the shell; it is redirected to first run until setup is done.
- The failure strip and counts are current as of the last navigation or refresh, so a change made by a background job appears only after the next navigation or an explicit refresh.
- Because the layout is dynamic, every navigation into the shell re runs its handful of count queries (the failure strip, the dashboard stats, saved posts, the ideas inbox count, and the new-outlier count behind the feed cue); at single user local scale this is cheap and intended.
