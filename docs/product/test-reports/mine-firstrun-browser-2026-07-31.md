# Test Report: /mine and /first-run (2026-07-31)

**Tester:** Claude Code (browser-driven)  
**Date:** 2026-07-31  
**Database state:** 2 channels (@kallaway synced, @hormozi never), 8 videos, first_run_completed unset, niche_profile set

---

## /mine - No own channel marked

### PASS: Channel picker reads clearly
- Two rows visible: @kallaway (442,447 followers) and @hormozi (dash for followers)
- Handles render once each (no double at-sign bug found)
- "This is me" button on each row is interactive and clickable

### PASS: Follower count handling
- Synced channel (@kallaway) shows real count: 442,447
- Never-synced channel (@hormozi) shows dash, not zero

### PASS: "This is me" action works
- Click marks channel as is_own in database (verified)
- Page navigates away after marking

---

## /mine - Own channel marked (@kallaway)

### PASS: No-Graph-connection state displays correctly
- Page shows "Instagram isn't connected here"
- Copy: "No Graph API token is set on this machine"
- Explains what connecting gives (reach, accounts reached, saves/shares, median)
- "Check connection" button present
- Timestamp shown: "last checked 7/31/2026, 3:18:11 AM"
- Three tabs: Month, Posts, Metrics

### PASS: No fabricated figures
- No numbers shown for stats
- Calendar below shows "No own-channel measurement yet..."
- All information surfaces constraints honestly

### PASS: No zeros in place of missing values
- Dashes appear in appropriate places
- No zero values standing in for missing data

### FAIL: Illegal em dashes in prose
- Welcome description contains: "Crowsnest watches a handful of Instagram channels and scores every post against that channel's own median [EMDASH] so you see what over-performed, not just what is popular."
- Step 2 text contains: "Connect the Instagram account the sidecar signs in with [EMDASH] read-only, nothing is posted."
- Per AGENTS.md, em dashes are banned in prose. Ticket: these are not missing-value placeholders. Severity: FAIL.

---

## /first-run - Welcome screen

### PASS: Page loads
- Route /first-run returns 200, welcome screen renders
- First-run gate not redirecting from / when channels exist (correct per brief)

### PASS: "Get started" button present
- Button visible and interactive
- Subtext reads "4 steps . about a minute"

### FAIL: Step count mismatch
- Displayed: 3 numbered steps (01, 02, 03)
- Copy says: "4 steps . about a minute" (appears twice on screen)
- Per v1-scope Decision 1: "the step numbering shifts. 01 FOCUS, 02 INSTAGRAM, 03 CHANNELS, 04 FIRST SYNC, and the welcome copy says four steps."
- Expected: 4 numbered steps (or copy should say 3 steps)
- Found: 3 steps shown; 4 in copy. Fourth step (FIRST SYNC) missing from display.
- Ticket: Acceptance criteria 2 for First run requires "The welcome screen shows four numbered steps and a Get started button. The step count in the copy matches the number of steps that actually run." Severity: FAIL.

### PASS: Step labels are descriptive
- 01: "Pick what you make, so the scoring and the suggestions start from your niche."
- 02: "Connect the Instagram account the sidecar signs in with..."
- 03: "Choose the channels to watch, then run the first sync and see what beat its own median."

### FAIL: Same em dash issue as above
- Step 02 copy contains the illegal em dash (see above)

---

## Acceptance Criteria Coverage

### My channel (section 2, criteria 1)
- PASS: "With no Graph connection, the screen shows a connect state and no figures. It does not show zeros."

### First run (section 2, criteria 2)
- FAIL: "The welcome screen shows four numbered steps and a Get started button. The step count in the copy matches the number of steps that actually run."

### First run (section 2, criteria 1)
- Not applicable: Database has 2 channels (redirect condition not met)

---

## Summary

**FAIL (2 issues):**
1. Illegal em dashes in rendered prose (AGENTS.md section, appears in /mine and /first-run copy) - requires de-dashing
2. Step count mismatch: display shows 3 steps, copy says 4 (First run acceptance criteria 2)

**PASS:** handles render once each, no fabricated values, no zeros for missing values, no-Graph state clear and honest, "This is me" button works and persists.

**Cleanup:** Marked @kallaway as is_own during testing; unmarked in database before exit.
