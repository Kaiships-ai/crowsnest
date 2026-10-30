# Research: character-led products

Lens: when a mascot helps, when it annoys, and what a product built around a character looks like.

Quality note: most findings come from design write-ups, reviews and press. Two pages returned 403 (a Medium critique and a UX Collective piece on Duolingo), so I use only their titles and search snippets. I read the Rive, Notion, Deconstructor of Fun, Pratt, It's Nice That, Tolan and Mailchimp pages directly; the other links rest on search excerpts. Retention numbers are one vendor's estimate and I do not use them.

## What I looked at

| Product | Source | Finding |
| --- | --- | --- |
| Duolingo (Lily) | [Rive: Lily video call](https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life) | The character tilts her head or ponders during processing delays, so the wait looks intentional. Eight head and eight body animations combine into more than 64 idle variations. "If she was too static, learners wouldn't know how she reacted." |
| Duolingo (Duo) | [Daily Dot memes](https://www.dailydot.com/irl/duolingo-owl-memes/), [The Sun Malaysia](https://thesun.my/going-viral/netizens-say-duolingo-notifications-feel-like-toxic-ex-texts), [afaqs on the Duo death stunt](https://www.afaqs.com/news/mktg/duolingos-owl-mascott-dies-mysteriously-internet-reacts-8714128), [UX Collective title and snippet only](https://uxdesign.cc/20-days-of-emotional-blackmail-from-duolingo-4f566523e3c5) | Reminders became a meme of guilt and threat. People compare them to toxic texts. It works as marketing for a language app and would be poison in a work tool. |
| Finch | [Deconstructor of Fun](https://www.deconstructoroffun.com/blog/x0hd2ssr80y5n7gv0w967pg7hwd7tl), [Neurospicy review](https://neurospicynomnoms.beehiiv.com/p/digital-pet-bestie-for-self-care-610618d407f7afef), [Finch help: streaks](https://help.finchcare.com/hc/en-us/articles/37780736136205-Understanding-Streaks), [Pratt critique](https://ixd.prattsi.org/2026/02/design-critique-finch-self-care-pet-ios-app/) | The pet keeps living while you are away: it leaves on a timed adventure, with visible In Progress and Completed states. A review says it has no punishment for missed days: the pet does not die or get sad. Pratt's critique flags cluttered Settings and Quests screens. |
| Headspace | [It's Nice That on the rebrand](https://Itsnicethat.com/articles/italic-studio-headspace-graphic-design-project-250424), [Dribbble interview index](https://content-hub.dribbble.com/?p=51) | The smiley stays, but illustrations now show "a range of faces expressing a range of emotions beyond a smile": stress, sadness, contentment. The typeface must "flex from playful to clinical". |
| Clippy | [Notion: Sinofsky on Clippy](https://www.notion.com/blog/clippy-walked-so-notion-ai-could-run), [Gigazine history](https://gigazine.net/gsc_news/en/20220913-office-assistant-clippy), [Fast Company](https://www.fastcompany.com/90853179/clippy-bing-generative-ai) | It popped up when you started working and offered help you had not asked for. Sinofsky calls it "early and wrong". Nass, whose research inspired it, reports a suggested fix that was not built: let users mark suggestions as not helpful. |
| Mico (Microsoft, 2025) | [Betanews](https://betanews.com/2025/10/24/microsoft-reincarnates-clippy-for-the-ai-age-with-copilot-mico/), [TweakTown](https://www.tweaktown.com/news/108439/microsoft-reveals-bouncy-new-ai-companion-for-windows-11-mico-and-almost-everyone-groans/index.html), [AP via The Star](https://www.thestar.com.my/tech/tech-news/2025/10/24/microsoft-hopes-mico-succeeds-where-clippy-failed-as-tech-companies-warily-imbue-ai-with-personality) | Coverage stresses it can be turned off, the sharp contrast with Clippy. Reaction is still mixed, and the first thing press reached for was the Clippy comparison. Any blob mascot on a desktop will be judged against Clippy. |
| Tolan | [Designing Tolan: characters](https://www.tolans.com/relay/designing-tolan-part-1-characters) | Early versions were pet-like. User testing showed people saw it as "closer to a peer than a pet", so they aged it up. Behaviour runs on a state machine of keyframe and procedural animation. |
| Mailchimp | [Voice and tone](https://styleguide.mailchimp.com/voice-and-tone/) | Tone follows the reader's feelings. "Forced humor can be worse than none at all." "If you're unsure, keep a straight face." |
| Lead Studio today | The polish study on its branch, Cook pane and board shots, `src/renderer/src/components/board/cook-pane-state.ts`, `src/renderer/src/components/settings/source-pull-progress.tsx` | Best copy is on long waits and errors. The Orca shell (file column, tabs, terminal) is what makes it look like a cheap Orca. |

## What works and why

- **Character as state, not as speaker.** Lily and Tolan carry meaning through a state machine. A face changes faster and takes less reading than text.
- **A wait that looks intentional.** Lily's head tilt fills a real delay. Lead's long waits are honest in words but still in pixels.
- **Life while you are away.** Finch's pet has a visible In Progress and Completed. Lead's cook runs for many minutes, and today's only sign of it is a card you must go back to.
- **A full emotional range.** Headspace's brand got stronger when the face stopped always smiling.
- **Peer, not pet.** Tolan's testers said so. A tool for a working reel maker should not ask to be fed.

## What to refuse

| Refuse | Because |
| --- | --- |
| Bubbles or popups the user did not ask for | The core complaint about Clippy |
| Guessing what you are doing ("It looks like...") | Same, and Lead has no model of its own to guess with |
| Streaks, levels, pet care, sad faces about absence | Duo's guilt meme. Finch shows the character works without it |
| Jokes, confetti or a smile on an error | Mailchimp: keep a straight face |
| Information only the character shows | Fails accessibility and fails whoever turns it off |
| A mascot you cannot silence | The contrast press drew between Mico and Clippy |
| A mascot that pretends to write or think | False: "Lead Studio never calls a model itself." Claude writes |
| Celebrating often | Emil's rule: frequent actions get less animation, rare ones can get delight |

## Strategy chosen: Bean is the status bar

Bean (working name) is a runner on a film set: it fetches and carries, Claude writes, you say yes. There is no sidebar, no tab strip and no status pill. The 6 steps of the loop are a track along the bottom of the window, and **where Bean stands is where the work is**. Its pose is the state: laptop while cooking, nap while a limit resets, hugging the finished reel on an error. It speaks only when clicked. The same words are always written beside it, so turning Bean off loses nothing.

Bean looks up and raises a card when something needs you, and that is the most it ever does to get attention.

## Alternatives rejected

1. **Companion in a side panel that chats (Clippy done politely).** A character attached to a chat box invites speech. Claude's chat already exists, and a second voice would claim thinking it does not do.
2. **Pet that grows with your reels (Finch for creators).** Strong retention story, wrong relationship. Tolan's testers point to peer over pet. Levels on a work tool make a bad week feel like a failure, and a reel maker already has follower counts doing that.
