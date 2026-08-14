# baoyu skill-selection reference (for /ksa:cooking)

Given a reach spec from `Studio/workspace/reach/`, this tells /ksa:cooking which baoyu skill (or combo) renders it. Read this after the requirements gate (style, layout, aspect ratio) so the answers tune the choice.

All baoyu skills live in `.agents/skills/`. Invoke via the Skill tool. Heavy generation runs in a named sub-agent pane.

## Default mapping by spec type

| Input from /ksa:reach | Primary baoyu skill | When to use it | Combo / fallback |
|---|---|---|---|
| Multi-slide carousel (text per slide) | baoyu-xhs-images | Default for IG carousels - Xiaohongshu-style image cards, one card per slide | If a strong cover is wanted, pair with baoyu-cover-image for slide 1 |
| Deck-style carousel (title + bullets per slide) | baoyu-slide-deck | When slides read like a presentation, not cards | baoyu-xhs-images if a softer social look fits better |
| Single hero / cover image | baoyu-cover-image | One-image post, or the cover card of a carousel | baoyu-image-gen for a fully generated visual |
| Fully generated illustration/visual | baoyu-image-gen | When the image is generative art, not text-on-card | baoyu-article-illustrator for editorial accents |
| Data / process / flow | baoyu-infographic | Spec is a diagram, comparison, or step flow | baoyu-diagram for a pure diagram |
| Editorial accent images | baoyu-article-illustrator | Illustrations to break up a longer piece | - |

## Selection logic (what /ksa:cooking does)

1. Read the spec. Identify its shape (carousel / single / infographic).
2. Apply the requirements-gate answers:
   - **style** -> passed to the baoyu skill as the visual style/vibe.
   - **layout** -> card vs deck vs single; nudges the skill choice above.
   - **aspect ratio** -> passed through (note: IG carousel crops all images to the FIRST image's ratio; keep them uniform).
3. Pick the primary skill from the table; add a combo only if the spec calls for it.
4. Confirm the pick in the AskUserQuestion requirements gate so Kai sees which skill will run before rendering.

## Notes

- Default carousel tool = baoyu-xhs-images (confirmed direction; revisit if output quality says otherwise).
- Keep every slide the same aspect ratio - IG crops to slide 1.
- The template is NOT locked - style comes from the gate answers per post; the durable kaiships template emerges later from engagement data.
