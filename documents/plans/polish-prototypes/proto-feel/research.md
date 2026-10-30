# Research: feel and restraint

Lens: how calm apps use motion, type, spacing and one-job screens to earn trust.
Where a claim comes from a third party or a search snippet, it says so.

## What I looked at

| Source | What it says | Kind |
| --- | --- | --- |
| Repo study `polish-study.md` and `feel-study.html` (branch `KineBeo/polish-study`) | 8 paired moments, Claude Desktop and Lead Studio. Timings and copy quoted below come from here. | First-hand capture |
| [Linear: behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh) | "Not every element of the interface should carry equal visual weight." The sidebar went "a few notches dimmer". Dividers had "quietly proliferated", so they got softer. | Maker's writing |
| [Linear: how we redesigned the UI](https://linear.app/now/how-we-redesigned-the-linear-ui) | Themes reduced to base color, accent and contrast. They limited "how much chrome" color was used, for a "more neutral and timeless appearance". | Maker's writing |
| [Apple HIG: motion](https://developer.apple.com/design/human-interface-guidelines/motion.md) | "Don't add motion for the sake of adding motion." "Aim for brevity and precision." "In apps, generally avoid adding motion to UI interactions that occur frequently." "Let people cancel motion." "Make motion optional." | Platform guide |
| [MacStories: Things 3 review](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/) | The app "is dominated by white space". Opening a task makes it "pop out into a card-like form while the rest of the list fades into the background". | Press review |
| [iA Writer](https://ia.net/writer) | "Nothing competes with your words." Focus mode dims everything but the current sentence. "No buttons, no popups, no title bar." | Maker's marketing |
| [Flighty, Apple Design Award coverage](https://www.cultofmac.com/833456/flighty-app-now-tracks-flights-on-apple-watch-awesome-apps) and [third-party analysis](https://blakecrosley.com/guides/design/flighty) | 2023 Interaction award. Live status stays visible while you do other things. The analysis calls it dense data through calm design. | Press, blog |
| [NN/g: skeleton screens](https://nngroup.com/articles/skeleton-screens/), read as a search snippet | Under 1 s needs no indicator. Under 10 s may use a skeleton or spinner. Over 10 s needs an explicit estimate. A secondary source reports a Viget study where skeletons did worse than spinners, so the evidence is mixed. | Research, secondhand |
| [Gruber on the Claude Mac app](https://daringfireball.net/2026/07/claudes_criminally_bad_mac_app_is_an_inside_job) and [Breunig](https://dbreunig.com/2026/02/21/why-is-claude-an-electron-app.html) | Real reactions. Gruber: "an Electron clunker". Breunig: slow, buggy, bloated, and Electron still makes sense for now. | User reaction |
| Repo skills `hallmark`, `apple-design`, `emil-design-eng` | Frequency decides whether to animate. Start from the current value. Banned default fonts. Honest copy. | Design rules |
| Spec `proto/`, `proposal/data.js`, `proposal/wireframes.js` | Boards, the 40 done-when wireframes, reel words. Its numbers are Kai's, so none are copied here. | Read only |

No official Anthropic writing on why Claude Desktop feels calm turned up. What I say about Claude comes from the study's captures, not from design notes.

## What works and why

1. **Weight follows the job.** Linear dims what supports the work. iA dims everything but the sentence. In the study, Claude's canvas holds one main thing, while Lead shares the window with a file column, 9 clipped tabs and a developer menu.
2. **Answer where the eye is.** Claude's message becomes a bubble on Enter, and an error sits exactly where the text would have been. The answer comes before the work finishes.
3. **Frequent actions stay still.** Apple and Emil Kowalski agree. Claude's sidebar stays fixed while the canvas changes. So navigation here gets almost no motion, and rare moments get the motion budget.
4. **A status that travels.** Flighty keeps live status visible while you do other things. Lead's Cook card and Plan card try this, but the same fact lives in two places.
5. **One row shape.** In Claude's Settings every row has the same shape, so the eye learns it once. Lead's 3 to 4 button cards make you read each one.
6. **Things' card.** A task opens out of its own row and the rest fades, so you keep your place. No page change.

## What to refuse

- **Copying Claude's look.** It also draws real criticism, and Lead must not read as a skin of it. No cream and serif, no chat as the main screen, no left list.
- **Mascot as decoration.** A cute character on every screen becomes noise fast. It gets a job or it leaves.
- **Percent bars that sit still.** The study caught "0 / 13" frozen for 21 s. Show counts and time against usual.
- **Skeletons everywhere.** The evidence is mixed, and local data is quick. Shapes only on a first visit, and nothing on a return.
- **Spring bounces on navigation, staggered reveals, glass, gradients.** Seen hundreds of times a day, they become slowness.
- **Red error cards.** Claude's stop notice has no modal and no red, and it still reads clearly. Lead's solid red Cook card is louder than its news.
- **Losing what Lead already does better.** Honest long waits, errors that keep finished work, one-button resume, and YOU CAN and IF YOU WAIT all stay.

## Strategy chosen: "One sentence"

Every screen opens with one sentence that says what is true, then the one button that follows from it. Four words on top replace 11 boards. Waiting, errors and limits all share one shape, so the eye learns it once. The two gates stop being places and become a card that opens over your work. The mascot is the only status light: small in the top bar when work runs elsewhere, large only when the screen has nothing better to show.

## Alternatives I rejected

- **Quiet sidebar, 11 boards kept and dimmed (the Linear route).** The cheapest build, and it would look calmer. It keeps the real problem: Today, Funnel and My channel repeat each other, and you still pick a board before you know what to do. Restraint that only lowers contrast is a paint job.
- **Conversation as the app (the Claude route).** One composer, and every board arrives as a reply. It is very calm on first open, but it copies the app Kai wants to stop resembling, hides Plan behind prompts, and makes a reel maker type to see a number they check daily.
