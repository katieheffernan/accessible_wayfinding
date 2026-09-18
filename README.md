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
   of the downtown library"). No geocoding, no autocomplete, no picking from a
   list.
2. **Photo** — the app opens the rear camera. You point it at what's ahead and
   take a still.
3. **Context** — if you allow location access, it grabs your coordinates and
   reverse-geocodes them through OpenStreetMap Nominatim (free, no key) to give
   the model a rough idea of where you are. It also looks up your destination's
   coordinates and, with the phone's compass, works out which way it lies — see
   [The compass hint](#the-compass-hint). Declining any of this is fine; the app
   falls back to reading the photo alone.
4. **Analysis** — the photo, your destination, and any location context go to
   your own `/api/analyze` endpoint, which calls Claude and returns structured
   guidance.
5. **Guidance** — the result is spoken aloud immediately, shown in large text
   with a directional arrow, and announced to screen readers. Your phone
   vibrates, with a distinct pattern on arrival.
6. **Repeat** — you keep walking and take another photo. "Say it again" repeats
   the last guidance; "Change destination" starts over.

### What Claude returns

The prompt (in [`server/analyze.ts`](server/analyze.ts)) asks for a raw JSON
object and nothing else:

| Field | Meaning |
| --- | --- |
| `arrived` | `true` / `false` — are you there? |
| `confidence` | `high` / `medium` / `low` |
| `sceneDescription` | 1–2 concrete sentences describing the photo, written for someone who can't see it well |
| `matchReasoning` | One sentence on why this does or doesn't look like the destination |
| `nextStep` | One of `walk_forward`, `turn_left`, `turn_right`, `turn_around`, `look_for_entrance`, `arrived`, `unclear` |
| `spokenGuidance` | One short, warm sentence to say out loud |

`sceneDescription` and `matchReasoning` are deliberately separate fields: you
hear what is there, and separately why the app thinks it is or isn't your
destination — which makes a wrong match auditable instead of just wrong.
`nextStep` is a closed set so the interface can map it to a fixed arrow and
label rather than parsing free text for a direction. If the photo is too dark or
blurry to tell anything, the model is told to say so at `low` confidence instead
of guessing. Anything unparseable falls back to a plain "I'm having trouble
understanding that photo. Let's try another one."

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
- **Near-black background, one warm amber accent.** Status is never carried by
  red-versus-green alone, so the interface still reads for people with
  colour-vision deficiency.
- **Every result is delivered four ways** — speech, large text, an arrow with a
  written label, and vibration — so no single channel is load-bearing.
- **Large tap targets**: full-width buttons, 56–64px tall.
- **Thick, high-contrast focus outlines** on every control; the browser default
  is too thin to find at low acuity. Focus moves to the main action (or the
  result itself) after each screen change, so keyboard and switch-access users
  aren't dropped at the top of a replaced page.
- **An `aria-live` region** announces every state change, and lives outside the
  re-rendered app so an announcement is never destroyed mid-sentence.
- **No animation** except the loading spinner, and `prefers-reduced-motion`
  turns even that off.
- **Plain-language copy** that speaks directly to you: "You're at the entrance
  now", not "Destination reached".

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
  styles.css            # the design, carried over from the prototype
  lib/
    api.ts              # POST /api/analyze
    camera.ts           # getUserMedia + still capture
    location.ts         # geolocation + Nominatim geocoding, both directions
    geometry.ts         # distance, bearing, relative bearing (pure functions)
    heading.ts          # compass access, with the iOS permission dance
    speech.ts           # SpeechSynthesis + vibration
    announce.ts         # aria-live announcements
    dom.ts              # escaping and small helpers
  screens/              # one module per screen, plus the shared header
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

- One photo at a time, no continuous video, no sense of how the scene changes as
  you move.
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
