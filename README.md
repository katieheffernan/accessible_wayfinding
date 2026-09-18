# Here Yet

A prototype wayfinding helper for people with low vision. You say where you're
headed in plain language, take a photo of whatever is in front of you, and the
app tells you — out loud, and in large high-contrast text — whether you've
arrived and what to do next.

> **This is a prototype and a demo, not a navigation product.**
>
> There is no routing engine and no map data behind it. Claude looks at one
> photograph and reasons about what it sees; it does not know the street layout,
> where the crossings are, or what is around the corner. It can be confidently
> wrong. Treat it as a second opinion about what's in front of you, alongside a
> cane, a guide dog, or whatever you already use — never as a substitute for
> them, and never for anything safety-critical like deciding when to cross a
> road.

## How it works

1. **Destination** — you describe the place in your own words ("front entrance
   of the downtown library"), typed or spoken. No autocomplete, no picking from
   a list. See [Speaking the destination](#speaking-the-destination).
2. **Photo** — the app opens the rear camera and stays there. Everything after
   this happens on the viewfinder: see [The camera-first
   loop](#the-camera-first-loop).
3. **Context** — if you allow location access, it grabs your coordinates and
   reverse-geocodes them through OpenStreetMap Nominatim (free, no key) to give
   the model a rough idea of where you are. It also looks up your destination's
   coordinates and, with the phone's compass, works out which way it lies — see
   [The compass hint](#the-compass-hint). Declining any of this is fine; the app
   falls back to reading the photo alone.
4. **Analysis** — the photo, your destination, and any location context go to
   your own `/api/analyze` endpoint, which calls Claude and returns structured
   guidance.
5. **Guidance** — the result appears as an overlay on the still-live camera:
   a step named in words, a large arrow, and the spoken sentence in text. It is
   also spoken aloud and announced to screen readers, and your phone vibrates,
   with a distinct pattern on arrival.
6. **Repeat** — you keep walking and press the shutter again. It never leaves
   the camera. "Say it again" repeats the last guidance; "Change" resets the
   destination.
7. **If one photo wasn't enough** — and only then — the app offers to walk you
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

## The compass hint

Claude reads the photo. It does not compute directions — that happens in
[`src/lib/geometry.ts`](src/lib/geometry.ts), in code you can check, because a
model asked to guess "left or right" from a photo with no landmarks in it will
guess, and a confident wrong turn is the worst thing this app can do to someone.

When you hit Continue, the app forward-geocodes your typed destination, reads
the compass, and computes the true bearing and great-circle distance from your
GPS fix to that point. The numbers go to the server raw; the server decides how
much to trust them and phrases the prompt accordingly
([`server/analyze.ts`](server/analyze.ts), `buildBearingContext`):

| Compass accuracy | What the model is told |
| --- | --- |
| ≤ 25° (reported) | The direction is measured — you may state it as a turn, but the photo still decides what's actually there |
| Unknown, or 25–60° | Treat as a hint; mention the general direction, but don't give a firm turn instruction on it alone |
| > 60°, or no compass | You cannot turn this into left or right — do **not** state a turn direction unless the photo shows it |
| Destination > 2 km away | The lookup probably matched the wrong place; ignore it and rely on the photo |

Android reports no accuracy figure at all, so it lands in the "unknown" band and
gets hedged language. iOS reports one, and gates the sensor behind a permission
prompt that only works from a tap — which is why the request fires on the
Continue button.

The camera screen shows what the lookup resolved ("Map: Cecil H. Green Library,
about 180 m away, to your left") so you can catch a wrong match before you start
walking, and it updates as you turn. That line is deliberately **not** an
`aria-live` region — it changes constantly, and announcing every change would
talk over everything else. It's plain text in the reading order instead, so a
screen reader picks it up on demand. The resolved name is announced once, when
the lookup lands.

Forward-geocoding is the weak link: Nominatim is a place-name search, and "front
entrance of the downtown library" is not a place name. Misses are common and
harmless. A *wrong* hit is the case to watch, which is why the name is shown to
you and implausible distances are discarded.

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
  lib/
    api.ts              # POST /api/analyze
    camera.ts           # getUserMedia + still capture
    location.ts         # geolocation + Nominatim geocoding, both directions
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
- It can describe the accessibility of the entrance it can see, but it doesn't
  know where a building's accessible entrance is. If you're at the wrong door it
  can tell you that; it can't tell you which way to go.
- No routing. The compass hint gives you a direction and a distance as the crow
  flies; it knows nothing about streets, crossings, walls or detours, and won't
  tell you *how* to get there.
- The compass is only as good as the phone's magnetometer, which can be off by
  tens of degrees near steel, vehicles or speakers. The trust bands above are
  there to keep a bad reading from becoming a confident instruction, but they
  work from the accuracy the browser reports — and Android reports none.
- Geocoding a plain-language destination often misses, and can occasionally hit
  the wrong place. Check the resolved name on the camera screen.
- Latency is real — a vision call takes several seconds, during which you're
  standing still.
- Vibration feedback doesn't work in iOS Safari, which doesn't implement the
  Vibration API. Speech and text still do.
- Nothing is stored: no history, no photo retention, no accounts. Reloading the
  page starts over.
- No license is set yet — add one before sharing the repo publicly.
