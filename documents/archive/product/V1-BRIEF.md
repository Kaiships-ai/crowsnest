# Crowsnest V1, the brief

Written 2026-07-31. Kai's call: this stops being an MVP and becomes a product
he uses daily. The prototype is the spec, at 100 percent, not 80.

## The one job

Find a video that beat its channel's own baseline. Take its hook, its script
and its layout. Rebuild it in Kai's style. Everything either serves that or
gets out of the way.

## What changed

The UI port matched the prototype's look but dropped every element the backend
could not feed. The result is a set of screens that are prettier and emptier.
Two things came out of that and both are now the work:

1. Where the app cannot do what the prototype shows, build the backend. Do not
   drop the feature. Do not fake it either.
2. Where the UI already promises something the backend cannot do, that is a bug
   with priority over any missing feature. Shipped screens currently offer
   TikTok and YT Shorts filters against an Instagram-only backend.

## The rule about numbers, unchanged and absolute

No fabricated data anywhere: not in a component, not in a fixture that ships,
not in a mockup. A value the app does not have renders as a dash. A capability
the app does not have does not appear in the interface at all. If a control is
visible it works, and if it works it is backed by something real.

This is a research tool. A number Kai cannot trust makes the whole product
worthless, so a missing feature always beats a fake one.

## What V1 means here

Usable daily by one person, on one Mac, against real Instagram data. Not a
demo. Concretely:

- Every visible control does something.
- Every failure has a designed surface, because failure is the normal state
  in this product: Instagram rate limits, sessions expire, syncs come back
  partial, the local model proxy goes down.
- Every own-channel figure carries its sample size.
- Nothing crashes on an empty database, and nothing crashes on one row.

## Locked, do not redesign these away

- Dark only, no light mode.
- The score is the hero number on any card that has one.
- Follower band is a first class control in the feed, never behind a menu.
- Amber means one thing: this beat its channel. Allowed on the score, and on
  exactly one primary action per screen.
- Every number is mono and tabular.

## What the prototype is

`Crowsnest UI Mockups/Crowsnest Prototype.dc.html`, sliced per screen under the
session scratchpad. Where the prototype and any written doc disagree, the
prototype wins. Where the prototype asserts a metric the app cannot supply,
accuracy wins and the copy changes, but the feature still gets built.

## Decisions Kai made, 2026-07-31

**Planning is in V1.** The my-channel calendar gets a real manual planner:
planned posts with draft, scheduled and missed states, optionally linked to a
remix session. Nothing publishes and nothing reminds. Kai still posts by hand.

This extends the product past where CONTEXT.md draws the line, that the script
is the end of this tool's job. He made that call knowingly, so the glossary
changes to match: planning is inside the tool, publishing stays outside it.

The planner only earns its screen if a planned post can carry a script out of a
remix session. Without that link it is a notepad inside a research tool, and it
will rot.

**Instagram only in V1.** The TikTok and YT Shorts chips come out of the filter
bar and out of the platform chip component. They currently return nothing with
no explanation, which is a bug, not a missing feature, so removing them is P0.
The platform column stays in the schema so a second platform later is additive
and needs no migration.

## Still open

- Which parts of the prototype's onboarding run (welcome, signin, focus,
  connect, sources, firstsync) belong in V1. The scope owner decides. Auth is
  pointless for a local single user tool, but a product that cannot be set up
  without hand editing `.env` is not a product.
- Reach, saves, shares, profile visits, follows and watch time are Insights,
  owned channel only, through the Graph API. Nothing in the schema holds them.
  This is the single biggest hole and it recurs on every screen. A working
  client already exists in Kai-Official-OS and should be adapted, not rewritten.
  The Graph token vars are optional, never required: a machine without one still
  boots, and the own-channel screens degrade to a designed "not connected"
  surface.
