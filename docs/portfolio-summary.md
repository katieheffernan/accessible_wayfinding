# Here Yet

Personal Project

## The Problem

Getting somewhere unfamiliar with low vision doesn't get easier when the map
says you've arrived — it gets harder. GPS is accurate to a few metres at best,
which is the difference between the front door and the loading bay, and
navigation apps go quiet at exactly the point the questions get specific. Is
this the right building? Is that a door or a window? Are there steps, and is
there a ramp anywhere? Turn-by-turn directions are written for people who can
read the last twenty metres themselves, and that last stretch is where standard
navigation stops being useful.

## My Solution

Here Yet is an app I built that answers "am I there yet?" from a photograph. You
describe where you're going in your own words — typed or spoken — then point
your camera at whatever is in front of you. The photo goes to Anthropic's Claude
API, which returns structured guidance: whether you've arrived, a plain-language
description of the scene, whether the entrance in view looks usable, and one
short sentence to be read aloud. Every result is delivered four ways at once —
speech, large text, a directional arrow, and vibration — so no single channel is
load-bearing. It's built in TypeScript with a serverless backend on Vercel,
which keeps the API key off the device.

## Describing the destination

You say where you're going the way you'd say it to a person: "front entrance of
the downtown library." There's no autocomplete and no list to pick from, because
a list of guesses is only useful if you can scan it. Typing a place name is the
one part of the app that needs a keyboard — the hardest thing to use if you
can't see it well — so dictation is a first-class path rather than a
convenience, with a labelled 64px button instead of the keyboard's small
unlabelled mic icon.

## Reading the scene

Claude returns a fixed JSON structure rather than prose, which lets the
interface render each part differently: the next step becomes an arrow with a
written label, the spoken sentence is read aloud, and the reasoning sits behind
a disclosure. "What I can see" and "why I think this is the place" are separate
fields on purpose — that makes a wrong match auditable rather than just wrong,
and it's what turns an opaque answer into one you can decide whether to trust.

## Getting in

Reaching the right building by a door you can't use isn't arriving. The app
always reports what it can see about getting in — steps and roughly how many, a
ramp, a handrail, whether the door is automatic or heavy, whether the doorway is
poorly lit or low-contrast. When the visible entrance isn't usable it says so
out loud and keeps you looking, and the interface distinguishes "you've arrived"
from "you're here, but check the way in" across every output channel, including
the vibration pattern.

## Looking around

A phone camera sees about 65 degrees, so the commonest unhelpful answer is "I
can't tell" — the destination simply wasn't in frame. When that happens, and
only then, the app offers to guide you through four photos as you turn on the
spot. Each one is labelled with its compass bearing, so the app works out the
turn arithmetically from the photo the model picks rather than asking the model
to guess left from right. Four quarter-turns also leave you facing the way you
started.

## Designing for low vision

The interface uses Atkinson Hyperlegible, designed by the Braille Institute for
exactly this audience. Every colour pair was contrast-checked before being used
rather than after: all text clears WCAG AA, most of it AAA. Status is never
carried by colour alone — each state pairs its colour with a word and a symbol,
which also survives direct sunlight, where hue washes out but shape and text
don't. Text is never drawn over the live camera image, because contrast against
a moving photograph can't be guaranteed.

## What I chose not to build

There's no map and no route line. The app reasons from a photograph, not from
map data, so drawing a route would promise something it can't deliver — and for
a user who can't verify it at a glance, a confident wrong direction is the worst
thing the product can produce. I scoped it deliberately to the last twenty
metres, which is the part maps are worst at, rather than competing with
navigation apps at the part they're already good at.

## What testing changed

Testing on campus caught the failure that mattered most. Standing to the left of
an entrance, the app told me to keep walking straight along the path — plausible,
confident, and wrong. The cause wasn't the model misreading the photo; it was
that nothing in the design required a direction to be justified. Guidance now has
to be grounded in something visible in the frame or in a compass bearing, and
"I can't see it from here" is an acceptable answer that triggers the look-around
flow instead. An honest non-answer routes the user to the tool that helps; a
confident guess walks them further away.
