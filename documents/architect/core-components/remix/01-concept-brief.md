# remix: concept brief

The six-stage studio that turns one analyzed source video into a script in the buyer's own voice.

## What it is

Remix is the studio at `/feed/{videoId}/remix` that walks one source video through six
stages, prompt, research, hook, style, script, finish, and ends with a script on the plan
ready to cook. It is the largest part of the core loop. There is one remix session per
source video (`remix_sessions`): arriving opens the existing session or creates a fresh one
at the prompt stage, so returning resumes where the buyer left off. The stages share a
client shell (`src/components/remix/remix-studio.tsx`) that owns the stepper, the Back /
Restart / Continue controls, the source context rail, the run log, and the Quick Remix
shortcut that runs every generation stage in one pass. Each stage autosaves its own edits;
every generation attempt, success or failure, writes a `remix_runs` row that the run log
reads back. The full stage-by-stage behavior is [03-feature-description.md](./03-feature-description.md).

Three of the six stages call a model through the [llm layer](../llm/01-concept-brief.md):
hook (opening lines), style (the beat outline), and script (three variants). Prompt,
research, and finish make no model call: prompt is a short form, research assembles locally
from records the sidecar and analysis already wrote, and finish is bookkeeping.

## Why it exists

The product's promise is not "find a good reel" but "turn a good reel into your next
script." Analysis produces an outlier worth copying; remix is the bridge from that outlier
to text the buyer can actually record, grounded in the source's own hook pattern and
structure but rewritten for the buyer's niche and persona. Splitting it into six visible,
resumable stages exists because the pipeline is slow and fails often (a model call per
generation stage): a buyer can stop after any stage, a failed generation leaves the prior
value intact and a logged trace rather than a dead end, and Quick Remix collapses the whole
thing to one click for anyone who does not want to steer each stage.

## Boundaries

Remix owns the session lifecycle, the six stages, research assembly, the three generation
stages, the run log, and the two writes that outlive the session: a `scripts` row and a
`planned_posts` row. The session itself is disposable working state; the finished script
and the plan carry copies of the text, so deleting a session costs only run provenance. It
does not own analysis (the source's `hookType`, structure segments, and `whyItWorked` are
read from `video_analyses`, written by [analyze](../analyze/01-concept-brief.md)), the vault
templates it seeds from, the model transport ([llm](../llm/01-concept-brief.md) decides
direct-API vs. proxy and owns the missing-key vs. proxy-down distinction), or what happens
after finish. Finish creates an undated draft planned post and links into
`/mine/{postId}/studio`; cooking that post into a shot list belongs to
[studio](../studio/01-concept-brief.md), not here. Ideas can seed a session's topic
(`seedSessionFromIdea`), but the inbox itself is the [mine](../mine/01-concept-brief.md)
surface.
