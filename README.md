# Here Yet

A prototype wayfinding helper for people with low vision. You say where you're
headed in plain language; GPS walks you to the building, and a photo of what's
in front of you tells you — out loud, and in large high-contrast text — whether
you're at the right place and whether you can get in.

Two sources, doing different jobs:

- **GPS**, continuously and hands-free, answers *which way and how far*, and
  tells you when you've reached the building.
- **The camera**, one photo at a time, answers *is this the right place, and is
  this a door I can actually use* — the question a map cannot answer.

On the Stanford campus there is a third: the university's published
[accessible-entrance list](https://maps.stanford.edu/ada/), which says where the
step-free way in actually is for 174 buildings. See
[Stanford's accessible entrances](#stanfords-accessible-entrances).

> **This is a prototype and a demo, not a navigation product.**
>
> There is no routing engine. GPS gives a straight-line direction and distance
> to a building's centre; it knows nothing about streets, crossings, walls or
> detours, and it cannot tell you *how* to get there. Claude looks at one
> photograph and reasons about what it sees; it does not know the street layout
> or what is around the corner. Both can be confidently wrong. Treat it as a
> second opinion about what's in front of you, alongside a cane, a guide dog, or
> whatever you already use — never as a substitute for them, and never for
> anything safety-critical like deciding when to cross a road.

## How it works

1. **Destination** — you describe the place in your own words ("front entrance
   of the downtown library"), typed or spoken. Stanford buildings are suggested
   as you type, and the app tells you straight away which one it matched, so a
   wrong match is caught before you start walking. See [Speaking the
   destination](#speaking-the-destination) and [Stanford's accessible
   entrances](#stanfords-accessible-entrances).
2. **Walking** — GPS guides you to the building, speaking as you go: straight
   ahead, turn left, turn around, and a distinct vibration when you arrive.
   Hands-free, no photo needed. See [GPS guidance](#gps-guidance).
3. **Photo** — the app opens the rear camera and stays there. Everything after
   this happens on the viewfinder: see [The camera-first
   loop](#the-camera-first-loop).
4. **Context** — if you allow location access, it grabs your coordinates and
   reverse-geocodes them through OpenStreetMap Nominatim (free, no key) to give
   the model a rough idea of where you are. Declining any of this is fine; the
   app falls back to reading the photo alone.
5. **Analysis** — the photo, your destination, the live GPS reading, and
   Stanford's surveyed entrance description for the matched building go to your
   own `/api/analyze` endpoint, which calls Claude and returns structured
   guidance. The survey tells the model what to look for; the photo still
   decides what is actually there.
6. **Guidance** — the result appears as an overlay on the still-live camera:
   a step named in words, a large arrow, and the spoken sentence in text. It is
   also spoken aloud and announced to screen readers, and your phone vibrates,
   with a distinct pattern on arrival.
7. **Repeat** — you keep walking and press the shutter again. It never leaves
   the camera. "Say it again" repeats the last guidance; "Change" resets the
   destination.
8. **If one photo wasn't enough** — and only then — the app offers to walk you
   through a look-around sweep. See [When one photo isn't
   enough](#when-one-photo-isnt-enough).

### What Claude returns

The prompt (in [`server/analyze.ts`](server/analyze.ts)) asks for a raw JSON
object and nothing else:

| Field | Meaning |
| --- | --- |
| `arrived` | `true` / `false` — are you there? |
| `confidence` | `high` / `medium` / `low` |
| `sceneDescription` | 1–2 concrete sentences describing the photo, written for someone who can't see it well |
| `matchReasoning` | One sentence on why this does or doesn't look like the destination |
| `accessNotes` | One sentence on how usable the way in looks — steps, ramp, handrail, door type, threshold, contrast and lighting, obstructions |
| `nextStep` | One of `walk_forward`, `turn_left`, `turn_right`, `turn_around`, `look_for_entrance`, `arrived`, `unclear` |
| `spokenGuidance` | One short, warm sentence to say out loud |

`sceneDescription` and `matchReasoning` are deliberately separate fields: you
hear what is there, and separately why the app thinks it is or isn't your
destination — which makes a wrong match auditable instead of just wrong.
`accessNotes` is required rather than "mention it if relevant", because "can I
actually get in here?" is the question this app exists to answer, and a model
asked only "is this the place?" answers only that. It sits before `nextStep` in
the schema on purpose: the JSON is generated in order, so the model describes the
way in before deciding what to do about it. When the visible entrance looks
unusable — steps with no ramp, a revolving door, a blocked path — the prompt asks
for `look_for_entrance` rather than `arrived`, and for the problem to be said out
loud in `spokenGuidance`. See [Reaching a door you can't
use](#reaching-a-door-you-cant-use).

`nextStep` is a closed set so the interface can map it to a fixed arrow and
label rather than parsing free text for a direction. If the photo is too dark or
blurry to tell anything, the model is told to say so at `low` confidence instead
of guessing. Anything unparseable falls back to a plain "I'm having trouble
understanding that photo. Let's try another one."

## Speaking the destination

Typing a place name is the one part of this app that needs a keyboard — the
hardest thing to use if you can't see it well — so dictation isn't a
convenience here, it's the primary path for some people. Mobile keyboards have
their own dictation button, but it's a small unlabelled icon; this is a 64px
control with a text label saying what it does.

It uses the Web Speech API's `SpeechRecognition`
([src/lib/dictation.ts](src/lib/dictation.ts)), and the button only appears
where the browser can honour it, so nobody is handed a control that silently
does nothing.

Details that matter more than they look:

- **Interim results fill the field as you speak**, so a partially-sighted user
  gets the same forming-text feedback a sighted one would from a dictation
  indicator.
- **Feedback while the mic is open is haptic, not spoken.** The app talking
  through the speaker with the microphone open feeds its own voice back into
  the recognizer.
- **Every failure gets its own sentence**, because the right next move differs:
  a blocked mic needs settings, silence needs another try, no network needs
  neither — and each one ends by pointing back at the keyboard, so you are
  never left without a way forward.
- **The status line never lies about the microphone.** If you stop without
  saying anything it says so, rather than leaving "Listening…" on screen — for
  someone relying on that line, it's the only indication either way.
- **On a good result, focus moves to Continue**, so the common case is one more
  press. The text stays editable if it misheard.
- **A spoken destination is matched against Stanford's building list just like
  a typed one**, and the match is announced — so "Green Library" said aloud
  gets the same confirmation, and the same chance to catch a mishearing, as
  "Green Library" typed.

There are no suggested-destination buttons. They were guesses about where
someone might be going, and a wrong guess occupying a large tap target is worse
than no guess.

## The camera-first loop

Apart from the destination form, the app is **one screen**: the viewfinder, with
a different overlay depending on what's happening. The camera is started once
and never torn down — it keeps running through analysing and through the result.

That buys three things:

- **The next photo is always one press away.** You walk, you press, you get an
  answer, you walk. No screen to leave and come back to.
- **Nothing to re-orient to.** For someone who navigates by memory of where
  controls sit, a layout that stays put is worth more than one that's optimally
  arranged for each state.
- **Focus is never destroyed.** Only the overlay is re-rendered; the shutter is
  the same element throughout, so a keyboard or switch-access user is never
  thrown back to the top of a rebuilt page. For the same reason the shutter is
  marked `aria-disabled` while an analysis is running rather than `disabled` —
  a disabled element gets blurred by the browser, which would drop focus on
  every photo.

The shutter is the single primary control and its label says what it will do
now: *Take photo*, *Working…*, *Take another*, *Photo 2* mid-sweep, *Try again*
after an error. Two contextual buttons flank it — *Say it again*, and *Look
around* when a photo came back unclear.

**Text is never drawn onto the live image.** Everything readable sits on an
opaque panel, because contrast against a moving photograph can't be guaranteed,
and this is an app for people who need that guarantee.

## When one photo isn't enough

A phone camera sees about 60–70° horizontally, so the commonest useless answer is
"I can't tell" — the destination simply wasn't in frame. The fix is angular
coverage, and it is offered as an **escalation, never the default**: one photo
first, and a sweep only when that photo produced nothing.

**The trigger is narrow on purpose.** `isUnclear` in
[src/lib/guidance.ts](src/lib/guidance.ts) — `nextStep` of `unclear`, or `low`
confidence — and only when the current result came from a single photo, so it
never asks twice. An unusable door (`isAccessBlocked`) deliberately does *not*
offer a sweep: more photos can't find an entrance the map doesn't know about, and
asking someone to turn on the spot costs time and isn't free of risk on a
pavement. Widen the predicate if that turns out to be wrong.

**Four discrete photos, a quarter turn apart, not a panorama or a video.** The
reasons are in [src/screens/sweep.ts](src/screens/sweep.ts):

- A panorama needs you to track a visual guide line evenly — the exact task this
  app's users can't do. Discrete shots can be confirmed one at a time by speech
  and a buzz.
- Scaling one wide image to the API's dimension limits spends a similar pixel
  budget over five times the view, so sign text stops being legible precisely
  when you need to read it. Separate stills keep full resolution.
- The Messages API takes images, not video, so a 360 video would be reduced to
  frames anyway — blurrier ones, from equirectangular source that distorts
  straight lines.
- Four quarter turns bring you back facing the way you started. Ending a sweep
  facing backwards is disorienting when you can't see landmarks to re-orient
  against.

**The model picks the photo; the code computes the turn.** Each frame is labelled
in the prompt with the angle it was taken at, and the model returns a
`photoIndex` — which photo shows the destination — rather than a direction.
`withGeometricStep` then derives `nextStep` from that frame's angle. A model that
misjudges "left" can still be right about which frame the doors are in, and the
arrow can't contradict the geometry. Non-directional outcomes (`arrived`,
`look_for_entrance`, `unclear`) are left exactly as returned, so "I still can't
find it" never becomes a confident turn.

Frame angles are measured from the compass where there is one, and otherwise
taken from the turn instructions themselves — the prompt says which, so an
approximate angle is never presented as a measured one.

**Cost**: four images instead of one, so roughly 4× the input tokens — on the
order of +1.5¢ per sweep on Opus, a fraction of a cent on Haiku — plus 15–30
seconds of standing and turning, which is the bigger cost of the two.

## Reaching a door you can't use

`arrived` stays truthful about *where* you are, so it can be true while
`nextStep` is `look_for_entrance`: you found the library, but the door in front
of you has four steps and no ramp. Every output channel is made to agree on that
distinction, because they'd otherwise contradict each other — the celebratory
buzz would be telling you to stop walking while the sentence told you to keep
looking:

| | Plain arrival | Arrived, unusable door |
| --- | --- | --- |
| Heading | "You've arrived" | "You're here — check the way in" |
| Arrow + label | ✓ You've arrived | ◎ Look for the entrance nearby |
| Announcement | "Arrived. …" | "Here, but check the way in. …" |
| Vibration | Arrival pattern | Ordinary update buzz |

The card keeps its arrived styling in both cases — reaching the building is real
and worth confirming. The predicate is one function,
[`isAccessBlocked`](src/lib/guidance.ts), shared by the screen and the haptics so
the two can't drift apart.

**What this does not do** is tell you where the accessible entrance *is*. Claude
only sees the photo, so it can tell you the door in front of you has steps; it
cannot know there's a ramp on the north face. Closing that gap means entrance
data — OpenStreetMap tags entrance nodes with `wheelchair`, `ramp`,
`door=automatic` and `step_count`, queryable free through Overpass — which is not
built yet.

## GPS guidance

Claude reads the photo. It does not compute directions — that happens in
[`src/lib/geometry.ts`](src/lib/geometry.ts), in code you can check, because a
model asked to guess "left or right" from a photo with no landmarks in it will
guess, and a confident wrong turn is the worst thing this app can do to someone.

When you hit Continue, the app resolves your destination to a point and starts a
continuous position watch ([`src/lib/navigation.ts`](src/lib/navigation.ts)).
From then on it speaks, hands-free, as you walk:

- **"Keep walking straight ahead. About 150 metres to go."**
- **"Turn left, then keep walking."** / **"Turn around — it's behind you."**
- **"You've reached Green Library. Take a photo to find the accessible
  entrance."** — with the distinct arrival vibration, so it reaches you with the
  phone at your side.

Arrival is GPS's call; whether you can get *in* is the camera's. The app never
says you have arrived at an entrance, because the coordinates are a building's
centre, not its door.

### Which way are you facing?

This is the hard part, and the app has two sources for it.

**Course over ground** is preferred whenever you're actually walking (above
0.7 m/s). It comes from where the phone has physically been over successive
fixes, so no amount of nearby steel can bend it. It is meaningless standing
still, which is why the compass remains the fallback.

**The compass** is used otherwise, with the trust bands below.

### Not talking too much

Someone crossing a campus on speech cannot use a sentence every second, and
silence reads the same as the app having crashed. So:

| Event | When it speaks |
| --- | --- |
| Arrival | Immediately, always — it jumps the rate limit |
| Direction changed | After 4 s at the earliest — long enough that turning on the spot gives one instruction, short enough that you don't walk 10 m the wrong way |
| Distance milestone (500/200/100/50/30 m) | After 9 s at the earliest |
| Nothing changed, still walking | Every 30 s, so silence never means "broken" |

Arrival uses hysteresis — you become arrived within 30 m and stop being arrived
only past 50 m — so a fix wandering around the threshold doesn't announce
repeatedly.

### How much the model is told to trust it

The numbers go to the server raw; the server decides how much to trust them and
phrases the prompt accordingly ([`server/analyze.ts`](server/analyze.ts),
`buildNavigationContext` and `buildBearingContext`). The live GPS paragraph
replaces the one-shot map bearing when both exist, so the user never hears two
slightly different directions for the same geometry:

| Compass accuracy | What the model is told |
| --- | --- |
| ≤ 25° (reported) | The direction is measured — you may state it as a turn, but the photo still decides what's actually there |
| Unknown, or 25–60° | Treat as a hint; mention the general direction, but don't give a firm turn instruction on it alone |
| > 60°, or no compass | You cannot turn this into left or right — do **not** state a turn direction unless the photo shows it |
| Destination > 2 km away | The lookup probably matched the wrong place; ignore it and rely on the photo |
| GPS accuracy > 40 m | No arrival claim and no turn — common under trees and between tall buildings |

Android reports no accuracy figure at all, so it lands in the "unknown" band and
gets hedged language. iOS reports one, and gates the sensor behind a permission
prompt that only works from a tap — which is why the request fires on the
Continue button.

The camera screen shows the same thing it is saying ("Green Library - East:
straight ahead, about 200 metres") so you can catch a wrong match before you
start walking, and it updates as you move. That line is deliberately **not** an
`aria-live` region — it changes constantly, and announcing every change would
talk over everything else. It's plain text in the reading order instead, so a
screen reader picks it up on demand. The resolved name is announced once, when
the lookup lands.

Forward-geocoding is the weak link *off* campus: Nominatim is a place-name
search, and "front entrance of the downtown library" is not a place name. Misses
are common and harmless. A *wrong* hit is the case to watch, which is why the
name is shown to you and implausible distances are discarded. On campus the
geocoder is skipped entirely in favour of Stanford's own building coordinates.

## Stanford's accessible entrances

Stanford publishes an [accessible-entrance list](https://maps.stanford.edu/ada/):
for each campus building, a surveyed prose description of where the step-free
way in is and what it's like. That is precisely the thing a photo cannot tell
you — a camera can see that the door in front of you has steps, but not that
the ramp is round the north side near the cafe.

178 buildings are in the sheet; 174 have entrance descriptions.

### Getting coordinates

The sheet has addresses but no coordinates, and GPS guidance needs a point.
[`scripts/build-buildings.ts`](scripts/build-buildings.ts) derives them from two
sources and records which one each building came from, so a bad pin is
traceable rather than silently trusted:

| Source | Buildings | How |
| --- | --- | --- |
| `stanford-campus-map` | 127 | Stanford's own campus map pins amenities to a facility ID; averaging a building's pins gives a point inside it, joined on the exact ID the sheet uses |
| `nominatim-address` | 37 | OpenStreetMap geocoding, by street address |
| `nominatim-name` | 5 | OpenStreetMap geocoding, by building name |
| `none` | 9 | Neither could place it — the entrance description still shows, but there's no GPS guidance |

Pins that sprawl more than 150 m are rejected rather than averaged into a
confident point in the middle of nothing, and geocoder hits more than 4 km from
campus are discarded as the right street name in the wrong city.

Run it by hand when Stanford publishes a new sheet; the output is committed, so
the app needs no network for this and works offline:

```bash
node scripts/build-buildings.ts "~/Downloads/Stanford Accessible Entrances.xlsx"
```

### Matching what you typed

[`src/lib/buildings.ts`](src/lib/buildings.ts) matches your destination against
the list, and is deliberately reluctant. A wrong match here is worse than no
match: it would walk you to the wrong building and then read you the wrong
entrance description with complete confidence.

So a match has to either **name** the building (reproduce its name or address)
or **beat the runner-up clearly**. "The library" scores well against Lathrop
Library — and just as well against Green Library, and the law library — so it
matches nothing, and the app says so rather than picking by rounding. The
matched name is always shown on the destination screen before you start
walking, and spoken when you reach the viewfinder.

### Surveyed is not the same as seen

The entrance description is given to Claude as *what to look for*, with an
explicit instruction not to repeat it as though it had been observed: a
surveyed ramp can be under scaffolding, and a power door can be broken.

The same separation holds in the UI. The result panel shows **"What the photo
shows about getting in"** and **"Accessible entrance, per Stanford"** as two
headings, never merged — because once they are merged, an authoritative
statement about a ramp is indistinguishable from a model's guess about one, and
you have no way to tell them apart afterwards.

The description is offered twice, at the two moments it is useful, and at
neither of them is it dumped into the live region unasked:

- **Before you arrive**, collapsed behind a disclosure on the camera screen.
  Knowing the accessible way in is on the north side is what decides which way
  you approach a building, and that is useless once you're already at the
  wrong door.
- **On GPS arrival**, spoken in full, appended to "You've reached X" — the
  moment you are actually looking for the door.

Reaching the viewfinder only gets a short line saying details exist. These
descriptions run to a paragraph, and a paragraph read aloud the moment someone
starts walking is how you get speech switched off altogether.

## Accessibility decisions

These are the point of the project, not polish — please don't "clean them up":

- **Atkinson Hyperlegible**, designed by the Braille Institute, with letterforms
  drawn so similar characters stay distinguishable at low acuity. Not
  interchangeable with a generic sans-serif.
- **White background, one medium blue accent, near-black text — every pair
  contrast-checked.** All text is at least 4.5:1 and nearly all of it 7:1 (AAA);
  UI borders clear the 3:1 that component boundaries require. The measured
  ratios are written next to each token in `styles.css` so a later edit can't
  quietly dim one.
- **Status is never carried by colour alone.** Arrival, caution and error each
  pair their colour with a word and a symbol, so the interface reads with any
  colour-vision deficiency — and in direct sunlight, where hue washes out but
  shape and text survive.
- **Every result is delivered four ways** — speech, large text, an arrow with a
  written label, and vibration — so no single channel is load-bearing.
- **Large tap targets**: full-width buttons 60px tall, a 96px shutter, 76px
  side buttons, 48px minimum for everything else.
- **Thick, high-contrast focus outlines** on every control; the browser default
  is too thin to find at low acuity. And because the camera shell persists,
  focus mostly doesn't need moving at all — see [the camera-first
  loop](#the-camera-first-loop).
- **An `aria-live` region** announces every state change, and lives outside the
  re-rendered app so an announcement is never destroyed mid-sentence.
- **No animation** except the loading spinner, and `prefers-reduced-motion`
  turns even that off.
- **Plain-language copy** that speaks directly to you: "You're at the entrance
  now", not "Destination reached".
- **No text over video, ever.** Opaque panels only.

## Running it locally

Requires Node 20 or newer.

```bash
npm install
cp .env.example .env    # then put your Anthropic API key in .env
npm run dev
```

Open http://localhost:5173. Grant camera permission when asked; location is
optional.

### Where the API key goes

Put it in `.env` as `ANTHROPIC_API_KEY`. Get one from the
[Anthropic Console](https://console.anthropic.com/settings/keys).

`.env` is gitignored — don't commit it. The key is only ever read server-side,
by `server/analyze.ts`, which runs inside the `/api/analyze` endpoint. The
browser posts the photo to that endpoint and gets structured guidance back; it
never sees the key and never talks to `api.anthropic.com` directly. (The
original single-file prototype called the Anthropic API straight from the page,
which would have exposed the key to anyone who opened devtools.)

Two optional knobs, both documented in `.env.example`:

- `ANTHROPIC_MODEL` — defaults to `claude-opus-5`. Set it to `claude-sonnet-5`
  or `claude-haiku-4-5` for faster, cheaper replies.
- `ANTHROPIC_EFFORT` — how hard the model thinks before answering. Defaults to
  `low`, because someone standing on a sidewalk is waiting on this; raise it to
  `medium` or `high` if you want more careful reasoning about harder scenes.

### Testing on a phone

The camera and geolocation APIs need a secure context. `localhost` counts as
secure, but your laptop's LAN address does not — so opening
`http://192.168.x.x:5173` on your phone will load the page and then fail to
start the camera. Either deploy a preview (below) and use that URL, or put an
HTTPS tunnel in front of the dev server (`cloudflared tunnel --url
http://localhost:5173`, `npx localtunnel --port 5173`, or similar).

## Deploying

Set up for Vercel: `api/analyze.ts` is a serverless function and the Vite build
output is the static site. Nothing else is required.

```bash
npx vercel            # first deploy, links the project
npx vercel --prod
```

Add `ANTHROPIC_API_KEY` to the project's environment variables in the Vercel
dashboard (Settings → Environment Variables) — the deployed function reads it
from there, not from your local `.env`. The function sets `maxDuration = 60`,
since a vision call can take longer than the default limit.

Locally, `npm run dev` serves `/api/analyze` through a small Vite middleware
(`server/dev-middleware.ts`) that calls the same `analyze()` function the
deployed function calls, so there's no second copy of the prompt to drift, and
you don't need the Vercel CLI to develop.

Hosting elsewhere means replacing `api/analyze.ts` with that platform's handler
shape — the ~35 lines in it are just HTTP plumbing around `analyze()`.

## Project structure

```
index.html              # shell: font loading, #app, the aria-live region
src/
  main.ts               # state machine + side effects (camera, speech, requests)
  state.ts              # the whole app state, one object
  actions.ts            # the hooks screens can call
  types.ts              # types shared with the server, incl. the Claude JSON contract
  styles.css            # light theme + camera-first layout, ratios documented
  data/
    buildings.json      # generated: Stanford's accessible entrances + coordinates
  lib/
    api.ts              # POST /api/analyze
    camera.ts           # getUserMedia + still capture
    location.ts         # geolocation + Nominatim geocoding, both directions
    navigation.ts       # live GPS watch: turns, arrival, and when to speak
    buildings.ts        # Stanford's entrance list + matching a typed destination
    dictation.ts        # speech-to-text for the destination field
    geometry.ts         # distance, bearing, relative bearing (pure functions)
    heading.ts          # compass access, with the iOS permission dance
    speech.ts           # SpeechSynthesis + vibration
    announce.ts         # aria-live announcements
    dom.ts              # escaping and small helpers
  screens/
    shell.ts            # the persistent camera shell: bar, viewfinder, shutter
    overlays.ts         # overlay content for each state of the shell
    destination.ts      # the one screen that isn't the camera
    camera.ts           # the camera-failure overlay
    sweep.ts            # the look-around sweep's turn instructions
    header.ts           # header for the destination screen
scripts/
  build-buildings.ts    # run by hand: the .xlsx -> src/data/buildings.json pipeline
server/
  analyze.ts            # the prompt, the Claude call, response parsing (server-only)
  dev-middleware.ts     # serves /api/analyze during `npm run dev`
api/
  analyze.ts            # Vercel serverless function wrapping analyze()
prototype/
  here-yet.html         # the original single-file prototype, kept for reference
```

`npm run typecheck` type-checks everything; `npm run build` does that and then
builds to `dist/`.

## Known limitations

- One photo at a time by default, with a four-photo sweep as an escalation. No
  continuous video, and no sense of how the scene changes as you move.
- A sweep resolves direction to the nearest quarter turn. It will tell you the
  doors are behind you; it won't say "forty degrees left".
- Off campus, it can describe the accessibility of the entrance it can see but
  doesn't know where a building's accessible entrance is. For the 174 Stanford
  buildings in the entrance list it does know, in prose — but that description
  is text, not coordinates. It can tell you the ramp is on the north side; it
  can't walk you to the ramp.
- **GPS arrival means the building, not the door.** The coordinates are a
  building's centre — in some cases averaged from amenity pins — so "you've
  reached it" can still leave you tens of metres and one wrong facade away from
  a usable entrance. This is why arrival hands straight over to the camera.
- 9 of the 178 buildings could not be placed at all. Their entrance
  descriptions still show; there is no GPS guidance to them.
- No routing. GPS gives a direction and a distance as the crow flies; it knows
  nothing about streets, crossings, walls or detours, and won't tell you *how*
  to get there. It will happily point you straight through a building.
- GPS is unreliable exactly where campuses are hardest: between tall buildings
  and under tree cover. Fixes worse than 40 m produce no direction and no
  arrival claim, which is honest but unhelpful at the moment you most want
  help.
- Course over ground only exists while you're walking. Standing still, the app
  falls back to the compass and its weaker guarantees.
- The compass is only as good as the phone's magnetometer, which can be off by
  tens of degrees near steel, vehicles or speakers. The trust bands above are
  there to keep a bad reading from becoming a confident instruction, but they
  work from the accuracy the browser reports — and Android reports none.
- Geocoding a plain-language destination often misses, and can occasionally hit
  the wrong place. Check the resolved name on the camera screen.
- The entrance data is a snapshot of what Stanford published on the date in
  [`src/data/buildings.json`](src/data/buildings.json). Buildings change,
  entrances close for works, and nothing here re-checks that. Re-run the build
  script against a fresh sheet.
- Building matching is deliberately conservative, so it refuses vague
  destinations ("the library") rather than guessing between candidates. You get
  no entrance information in that case — type the building's name.
- Latency is real — a vision call takes several seconds, during which you're
  standing still.
- Vibration feedback doesn't work in iOS Safari, which doesn't implement the
  Vibration API. Speech and text still do.
- Nothing is stored: no history, no photo retention, no accounts. Reloading the
  page starts over.
- No license is set yet — add one before sharing the repo publicly.
