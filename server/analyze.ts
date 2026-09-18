/**
 * Server-side photo analysis.
 *
 * This is the only place the Anthropic API key is read, and it never runs in the
 * browser: it is imported by the Vercel function in `api/analyze.ts` in
 * production and by a Vite dev middleware (`server/dev-middleware.ts`) locally.
 * Both entry points call `analyze()` so there is exactly one copy of the prompt
 * and the Claude request.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AnalyzeRequest,
  BearingContext,
  Confidence,
  GuidanceResult,
  LocationContext,
  NextStep,
  SweepFrame,
} from '../src/types.ts';
import { relativeBearing } from '../src/lib/geometry.ts';

const DEFAULT_MODEL = 'claude-opus-5';

/** Models that accept the server-side refusal `fallbacks` parameter. */
const FALLBACK_CAPABLE = /^claude-(opus-5|fable-5)/;

/** Roughly 6 MB of base64 — a generous ceiling for one phone photo. */
const MAX_IMAGE_CHARS = 6 * 1024 * 1024;

/**
 * Compass trust thresholds, in degrees of reported accuracy.
 *
 * A phone compass is routinely wrong by tens of degrees near steel, vehicles or
 * speakers. These bands decide whether the model is allowed to turn the reading
 * into a spoken "turn left" — the failure we care about is a confident wrong
 * turn, which is worse for someone relying on this than an honest "I can't tell".
 */
const GOOD_ACCURACY_DEGREES = 25;
const UNUSABLE_ACCURACY_DEGREES = 60;

/** Past this, a geocoder hit is more likely the wrong place than a far-off one. */
const IMPLAUSIBLE_DISTANCE_M = 2000;

/** Beyond this angle off the nose, the destination is behind the user. */
const BEHIND_DEGREES = 135;

/** A sweep of more than this many photos is a malformed or hostile request. */
const MAX_SWEEP_FRAMES = 8;

/**
 * Steps the model may be trusted to choose for itself on a sweep. The four
 * directional steps are derived from the angle of the photo it picked instead,
 * because a turn is geometry — the same reason the compass hint is computed in
 * code. The rest ('arrived', 'look_for_entrance', 'unclear') aren't directions,
 * so they stay as the model returned them.
 */
const DIRECTIONAL_STEPS: readonly NextStep[] = [
  'walk_forward',
  'turn_left',
  'turn_right',
  'turn_around',
];

const NEXT_STEPS: readonly NextStep[] = [
  'walk_forward',
  'turn_left',
  'turn_right',
  'turn_around',
  'look_for_entrance',
  'arrived',
  'unclear',
];

const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];

/** An error with an HTTP status attached, so both entry points can respond alike. */
export class AnalyzeError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AnalyzeError';
    this.status = status;
  }
}

/**
 * What we tell the user when we got a response but couldn't read structured
 * guidance out of it. Deliberately plain-language and actionable: the person
 * hearing this is standing on a sidewalk waiting to know what to do.
 */
function unreadableResult(sceneDescription: string, matchReasoning: string): GuidanceResult {
  return {
    arrived: false,
    confidence: 'low',
    sceneDescription,
    matchReasoning,
    accessNotes: "I can't tell anything about the way in from this photo.",
    nextStep: 'unclear',
    spokenGuidance: "I'm having trouble understanding what's in that photo. Let's try another one.",
  };
}

/**
 * The location sentence spliced into the prompt. Kept verbatim from the original
 * prototype: it tells the model to treat GPS as weak supporting evidence, because
 * a reverse-geocoded address can easily be the building next door.
 */
function buildLocationContext(location: LocationContext | null | undefined): string {
  if (!location) {
    return 'No location data is available.';
  }

  const label = location.label
    ? ` A reverse-geocoded address guess for that location is: "${location.label}".`
    : '';

  return (
    `The user's approximate GPS location is latitude ${location.lat}, longitude ${location.lon}.` +
    label +
    ` Treat this as rough supporting context only — the photo is the primary evidence.`
  );
}

/**
 * Distance in round numbers, at a precision the figure actually justifies —
 * GPS is good to a few metres at best, so "about 200 metres" is honest where
 * "183 metres" is not. Phrased to read on after `places "X" ...`.
 */
function describeDistance(meters: number): string {
  if (meters < 15) return 'less than 15 metres from the user — essentially on top of it';
  if (meters < 100) return `about ${Math.round(meters / 10) * 10} metres from the user`;
  if (meters < 1000) return `about ${Math.round(meters / 50) * 50} metres from the user`;
  return `about ${(meters / 1000).toFixed(1)} km from the user`;
}

/**
 * Turn a relative angle into words. Third person to match the rest of the
 * prompt — the model is being briefed about the user, not addressed as them.
 */
function describeRelativeDirection(relative: number): string {
  const magnitude = Math.abs(relative);
  const side = relative < 0 ? 'left' : 'right';
  const rounded = Math.round(magnitude / 5) * 5;

  if (magnitude <= 15) return 'straight ahead of them';
  if (magnitude <= 60)
    return `ahead and to their ${side}, about ${rounded} degrees off straight ahead`;
  if (magnitude <= 120) return `roughly square to their ${side}`;
  if (magnitude <= 160) return `behind them, towards their ${side}`;
  return 'directly behind them';
}

/**
 * The compass paragraph: what we know about where the destination lies, and how
 * much of it the model is allowed to act on.
 *
 * The permissions are explicit rather than implied. Given a bearing and no
 * caveat, a model will happily convert it into "turn left" — so each trust band
 * states what it may and may not say, and the weakest band forbids direction
 * claims outright instead of omitting the data and leaving it to infer.
 */
export function buildBearingContext(bearing: BearingContext | null | undefined): string {
  if (!bearing) return '';

  const { distanceMeters, bearingDegrees, headingDegrees, headingAccuracyDegrees } = bearing;
  const distance = describeDistance(distanceMeters);

  const preamble =
    `Separately from the photo, a map lookup places "${bearing.destinationLabel}" ${distance}, ` +
    `on a true compass bearing of ${Math.round(bearingDegrees)} degrees.`;

  if (distanceMeters > IMPLAUSIBLE_DISTANCE_M) {
    return (
      `${preamble} That distance is large enough that the map lookup has probably matched the wrong place, ` +
      `so ignore it entirely for deciding the next step and rely only on the photo.`
    );
  }

  const unusableHeading =
    headingDegrees === null ||
    (headingAccuracyDegrees !== null && headingAccuracyDegrees > UNUSABLE_ACCURACY_DEGREES);

  if (unusableHeading) {
    return (
      `${preamble} However, there is no reliable reading of which way the user is facing, so this bearing ` +
      `cannot be turned into a left or right. Use the distance as a sense of how close they are, but do NOT ` +
      `state a turn direction unless the photo itself shows where to go.`
    );
  }

  const relative = relativeBearing(bearingDegrees, headingDegrees);
  const direction = describeRelativeDirection(relative);
  const behind = Math.abs(relative) > BEHIND_DEGREES;

  const trusted = headingAccuracyDegrees !== null && headingAccuracyDegrees <= GOOD_ACCURACY_DEGREES;

  const guidance = trusted
    ? `This direction is measured, not inferred from the photo, so you may state it as a turn — but the photo ` +
      `still decides what is actually there, including obstacles and which door to use.`
    : `The compass reading is unverified and may be off by tens of degrees, so treat this direction as a hint: ` +
      `you may mention it in general terms ("the entrance should be somewhere to your left"), but do not give a ` +
      `firm turn instruction based on it alone, and prefer whatever the photo shows.`;

  const behindNote = behind
    ? ` The destination being behind them makes "turn_around" a reasonable next step if the photo shows nothing relevant ahead.`
    : '';

  return (
    `${preamble} The user's phone is pointing ${Math.round(headingDegrees)} degrees, which puts the destination ` +
    `${direction}. ${guidance}${behindNote}`
  );
}

/**
 * The prompt, carried over unchanged from the prototype. The reasoning behind its
 * shape, so it survives future edits:
 *
 * - It states who the guidance is for ("a person with low vision") so the model
 *   writes descriptions that work without sight, not captions.
 * - It asks for raw JSON with no code fences, because the reply is parsed, not shown.
 * - `sceneDescription` and `matchReasoning` are separate fields: the user hears
 *   what is there and, separately, why we think it is or isn't the destination.
 *   Keeping them apart makes a wrong match auditable instead of just wrong.
 * - `nextStep` is a closed set, so the UI can map it to an arrow and a fixed label
 *   rather than parsing free text for a direction.
 * - `accessNotes` is a required field rather than something to mention if
 *   relevant, because "can I actually get in here?" is the question this app
 *   exists to answer and a model asked only "is this the place?" will answer
 *   only that. Reaching the right building by a door you can't use is not
 *   arriving. It is placed before `nextStep` on purpose: the JSON is generated
 *   in order, so the model describes the way in before deciding what to do.
 * - `spokenGuidance` is one short sentence because it is spoken aloud; long
 *   speech is worse than no speech when you are walking.
 * - The last paragraph makes "I can't tell" an explicit, low-confidence answer
 *   instead of letting the model guess from a dark or blurry photo.
 */
export function buildPrompt(
  destination: string,
  location: LocationContext | null | undefined,
  bearing: BearingContext | null | undefined,
): string {
  const locationContext = buildLocationContext(location);
  const bearingContext = buildBearingContext(bearing);

  return `You are helping a person with low vision figure out, using a single photo they just took, whether they have reached their destination and what to do next.

Destination they are trying to reach: "${destination}"

${locationContext}
${bearingContext ? `\n${bearingContext}\n` : ''}
Look carefully at the photo and respond with ONLY a raw JSON object (no markdown formatting, no code fences, no extra text before or after) with exactly this shape:
{
  "arrived": true or false,
  "confidence": "high", "medium", or "low",
  "sceneDescription": "1-2 plain, concrete sentences describing what is visible in the photo, written for someone who can't see it well. Mention key landmarks, signage, doors, or obstacles.",
  "matchReasoning": "One sentence on why this does or does not look like the destination described.",
  "accessNotes": "One short sentence on how usable the way in looks: steps and roughly how many, ramp, handrail, door type (automatic, revolving, heavy manual), a raised threshold, poor contrast or lighting at the doorway, and anything blocking the path. Write 'No doorway is visible in this photo.' if there is none.",
  "nextStep": one of "walk_forward", "turn_left", "turn_right", "turn_around", "look_for_entrance", "arrived", "unclear",
  "spokenGuidance": "One short, warm, natural-sounding sentence to say out loud to the person, telling them what to do next or confirming they've arrived. Speak directly to them, e.g. 'You're at the entrance now' or 'Keep walking forward, the doors should be just ahead on your right.'"
}

This person may not be able to use steps, a revolving door, or a heavy manual door, and may not see a low step or the edge of a glass door at all. So always report what you can see about getting in, even when they have already arrived. If the way in that is visible in the photo looks difficult or impossible to use — steps with no ramp, a revolving door, a blocked path — say so directly in spokenGuidance and set nextStep to "look_for_entrance" rather than "arrived", so they can look for another way in. Keep "arrived" truthful about where they are: if they have reached the place but the visible door is not usable, arrived can still be true while nextStep is "look_for_entrance". Never assume an entrance is step-free because you cannot see its threshold — report what is visible and no more.

If the photo is too blurry, dark, or unclear to tell anything useful, set confidence to "low" and say so plainly in sceneDescription and spokenGuidance.`;
}

/** Normalise an angle to (-180, 180]: negative is left, positive is right. */
function signedAngle(degrees: number): number {
  const delta = ((degrees % 360) + 540) % 360 - 180;
  return delta === -180 ? 180 : delta;
}

/** How a frame's angle reads in words, for labelling each photo in the prompt. */
export function describeFrameAngle(offset: number): string {
  const signed = signedAngle(offset);
  const magnitude = Math.abs(signed);
  const side = signed < 0 ? 'left' : 'right';

  if (magnitude <= 15) return 'the direction they were facing when they started';
  if (magnitude > 165) return 'directly behind where they started';
  return `about ${Math.round(magnitude)} degrees to their ${side} of where they started`;
}

/** The turn implied by the frame the destination appeared in. */
function stepFromFrameAngle(offset: number): NextStep {
  const signed = signedAngle(offset);

  if (Math.abs(signed) <= 45) return 'walk_forward';
  if (Math.abs(signed) > BEHIND_DEGREES) return 'turn_around';
  return signed > 0 ? 'turn_right' : 'turn_left';
}

/**
 * The look-around prompt, used when a single photo came back unclear and the
 * user has taken several photos while turning on the spot.
 *
 * The design difference from the single-photo prompt: each photo is labelled
 * with the angle it was taken at, and the model's job is to say *which photo*
 * shows the destination — not to work out the turn. The turn is then derived
 * from that photo's angle in code (stepFromFrameAngle), so the arrow and the
 * spoken sentence can't disagree, and a model that misjudges "left" can still
 * be right about which frame the doors are in. Same division of labour as the
 * compass hint: perception to the model, geometry to code.
 */
export function buildSweepPrompt(
  destination: string,
  location: LocationContext | null | undefined,
  bearing: BearingContext | null | undefined,
  frames: SweepFrame[],
): string {
  const locationContext = buildLocationContext(location);
  const bearingContext = buildBearingContext(bearing);
  const measured = frames.some((frame) => frame.headingDegrees !== null);

  const angleSource = measured
    ? `The angles below are measured from the phone's compass.`
    : `The angles below come from the turn instructions the user was given rather than from a compass, so treat them as approximate.`;

  return `You are helping a person with low vision find their destination. A single photo was not enough to tell where they are, so they have turned on the spot and taken ${frames.length} photos, one after another, covering the view around them.

Destination they are trying to reach: "${destination}"

${locationContext}
${bearingContext ? `\n${bearingContext}\n` : ''}
The photos are given below in the order they were taken, each labelled with the direction it was taken in. ${angleSource}

Work out which single photo, if any, shows the destination or the most promising way towards it. Then respond with ONLY a raw JSON object (no markdown formatting, no code fences, no extra text before or after) with exactly this shape:
{
  "photoIndex": the number of the photo that shows the destination or the best lead towards it, or null if none of them do,
  "arrived": true or false,
  "confidence": "high", "medium", or "low",
  "sceneDescription": "1-2 plain, concrete sentences describing what is visible in the photo you chose, written for someone who can't see it well. If you chose no photo, describe what the surroundings look like overall.",
  "matchReasoning": "One sentence on why that photo does or does not show the destination.",
  "accessNotes": "One short sentence on how usable the way in looks in the photo you chose: steps and roughly how many, ramp, handrail, door type (automatic, revolving, heavy manual), a raised threshold, poor contrast or lighting at the doorway, and anything blocking the path. Write 'No doorway is visible in these photos.' if there is none.",
  "nextStep": one of "walk_forward", "turn_left", "turn_right", "turn_around", "look_for_entrance", "arrived", "unclear",
  "spokenGuidance": "One short, warm, natural-sounding sentence to say out loud, telling them which way to turn to face what you found, or that you still can't tell. Speak directly to them, and describe the turn relative to the direction they started in, e.g. 'The doors are behind you — turn right around and walk forward.'"
}

Choose exactly one photo or null. Do not describe several photos at once: they only need to know which way to turn next. If the destination appears in more than one photo, choose the one where it is clearest or closest.

This person may not be able to use steps, a revolving door, or a heavy manual door, and may not see a low step or the edge of a glass door at all. So always report what you can see about getting in. If the way in you found looks difficult or impossible to use, say so directly in spokenGuidance and set nextStep to "look_for_entrance".

If none of the photos show anything that looks like the destination, set photoIndex to null, nextStep to "unclear", and say plainly in spokenGuidance that you still can't find it — do not guess a direction. Guessing a turn the photos do not support is worse than admitting you cannot tell.`;
}

/** Strip code fences the model was asked not to emit, in case it does anyway. */
function stripFences(raw: string): string {
  return raw
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();
}

/**
 * Parse Claude's reply into a GuidanceResult, coercing anything unexpected into
 * the "unclear" shape rather than letting a malformed field reach the UI.
 */
export function parseGuidance(rawText: string): GuidanceResult {
  const cleaned = stripFences(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return unreadableResult(
      rawText || "I couldn't make sense of what's in the photo.",
      "The response couldn't be understood as structured guidance.",
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return unreadableResult(
      rawText || "I couldn't make sense of what's in the photo.",
      "The response couldn't be understood as structured guidance.",
    );
  }

  const fields = parsed as Record<string, unknown>;
  const nextStep = fields.nextStep;
  const confidence = fields.confidence;
  const photoIndex = fields.photoIndex;

  return {
    arrived: fields.arrived === true,
    confidence: CONFIDENCES.includes(confidence as Confidence) ? (confidence as Confidence) : 'low',
    sceneDescription:
      typeof fields.sceneDescription === 'string' && fields.sceneDescription.trim()
        ? fields.sceneDescription
        : "I couldn't make out enough detail in that photo.",
    matchReasoning: typeof fields.matchReasoning === 'string' ? fields.matchReasoning : '',
    accessNotes: typeof fields.accessNotes === 'string' ? fields.accessNotes : '',
    photoIndex: Number.isInteger(photoIndex) ? (photoIndex as number) : null,
    nextStep: NEXT_STEPS.includes(nextStep as NextStep) ? (nextStep as NextStep) : 'unclear',
    spokenGuidance:
      typeof fields.spokenGuidance === 'string' && fields.spokenGuidance.trim()
        ? fields.spokenGuidance
        : "I'm not sure what's ahead. Let's try another photo.",
  };
}

/** Validate one base64 image payload. */
function readImage(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new AnalyzeError('A photo is required.', 400);
  }
  if (value.length > MAX_IMAGE_CHARS) {
    throw new AnalyzeError('That photo is too large to analyze.', 413);
  }
  return value;
}

/** Validate the frames of a look-around sweep. */
function readFrames(value: unknown): SweepFrame[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AnalyzeError('A sweep needs at least one photo.', 400);
  }
  if (value.length > MAX_SWEEP_FRAMES) {
    throw new AnalyzeError('That is too many photos for one sweep.', 400);
  }

  return value.map((frame, index) => {
    const { imageBase64, headingDegrees, nominalOffsetDegrees } = (frame ?? {}) as Record<
      string,
      unknown
    >;

    return {
      imageBase64: readImage(imageBase64),
      headingDegrees: Number.isFinite(headingDegrees) ? (headingDegrees as number) : null,
      // Fall back to the angle the instructions implied, so a frame with a
      // missing offset still lands in the right place in the sweep.
      nominalOffsetDegrees: Number.isFinite(nominalOffsetDegrees)
        ? (nominalOffsetDegrees as number)
        : index * 90,
    };
  });
}

/** Validate the request body coming off the wire. */
function readRequest(body: unknown): AnalyzeRequest {
  if (typeof body !== 'object' || body === null) {
    throw new AnalyzeError('Request body must be a JSON object.', 400);
  }

  const { kind, destination, imageBase64, frames, location, bearing } = body as Record<
    string,
    unknown
  >;

  if (typeof destination !== 'string' || !destination.trim()) {
    throw new AnalyzeError('A destination is required.', 400);
  }

  let parsedLocation: LocationContext | null = null;
  if (typeof location === 'object' && location !== null) {
    const { lat, lon, label } = location as Record<string, unknown>;
    if (typeof lat === 'number' && typeof lon === 'number') {
      parsedLocation = { lat, lon, label: typeof label === 'string' ? label : null };
    }
  }

  const base = {
    destination: destination.trim(),
    location: parsedLocation,
    bearing: readBearing(bearing),
  };

  if (kind === 'sweep') {
    return { ...base, kind: 'sweep', frames: readFrames(frames) };
  }

  return { ...base, kind: 'photo', imageBase64: readImage(imageBase64) };
}

/** Validate the compass block. Anything malformed becomes null, not a guess. */
function readBearing(bearing: unknown): BearingContext | null {
  if (typeof bearing !== 'object' || bearing === null) return null;

  const { distanceMeters, bearingDegrees, headingDegrees, headingAccuracyDegrees, destinationLabel } =
    bearing as Record<string, unknown>;

  if (!Number.isFinite(distanceMeters) || !Number.isFinite(bearingDegrees)) return null;

  return {
    distanceMeters: distanceMeters as number,
    bearingDegrees: bearingDegrees as number,
    headingDegrees: Number.isFinite(headingDegrees) ? (headingDegrees as number) : null,
    headingAccuracyDegrees: Number.isFinite(headingAccuracyDegrees)
      ? (headingAccuracyDegrees as number)
      : null,
    destinationLabel: typeof destinationLabel === 'string' ? destinationLabel : 'the destination',
  };
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AnalyzeError(
      'ANTHROPIC_API_KEY is not set on the server. Copy .env.example to .env and add your key.',
      500,
    );
  }
  client ??= new Anthropic();
  return client;
}

/**
 * Send one photo to Claude and return structured guidance.
 * Throws AnalyzeError for anything the caller should turn into an HTTP status.
 */
export async function analyze(body: unknown): Promise<GuidanceResult> {
  const request_ = readRequest(body);
  const { destination, location, bearing } = request_;
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const effort = (process.env.ANTHROPIC_EFFORT || 'low') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';

  const imageBlock = (data: string) => ({
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
  });

  // For a sweep, each photo is labelled with the angle it was taken at and the
  // label precedes its image, so the model can tell the frames apart. The
  // instructions come last, after everything they refer to.
  const content =
    request_.kind === 'sweep'
      ? [
          ...request_.frames.flatMap((frame, index) => [
            {
              type: 'text' as const,
              text: `Photo ${index + 1} of ${request_.frames.length} — taken facing ${describeFrameAngle(frame.nominalOffsetDegrees)}:`,
            },
            imageBlock(frame.imageBase64),
          ]),
          {
            type: 'text' as const,
            text: buildSweepPrompt(destination, location, bearing, request_.frames),
          },
        ]
      : [
          imageBlock(request_.imageBase64),
          { type: 'text' as const, text: buildPrompt(destination, location, bearing) },
        ];

  const request = {
    model,
    max_tokens: 8000,
    // Adaptive thinking, held at low effort by default: this is a single
    // look-and-decide call and the person is waiting on their feet, so latency
    // is part of the accessibility story. Raise ANTHROPIC_EFFORT for harder scenes.
    thinking: { type: 'adaptive' as const },
    output_config: { effort },
    messages: [{ role: 'user' as const, content }],
  };

  let response;
  try {
    // Server-side refusal fallbacks: if a safety classifier declines the photo,
    // the API retries the same request on a fallback model within this one call
    // instead of returning nothing. Only some models accept the parameter.
    response = FALLBACK_CAPABLE.test(model)
      ? await getClient().beta.messages.create({
          ...request,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        })
      : await getClient().messages.create(request);
  } catch (error) {
    if (error instanceof AnalyzeError) throw error;

    if (error instanceof Anthropic.AuthenticationError) {
      throw new AnalyzeError('The server rejected the API key. Check ANTHROPIC_API_KEY.', 500);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AnalyzeError('Too many photos at once. Wait a moment and try again.', 429);
    }
    if (error instanceof Anthropic.APIError) {
      throw new AnalyzeError(`The analysis service returned an error (${error.status}).`, 502);
    }
    throw new AnalyzeError('Could not reach the analysis service.', 502);
  }

  // A refusal means the whole chain declined. Tell the user plainly and let them
  // take another photo, rather than surfacing a policy message as an error screen.
  if (response.stop_reason === 'refusal') {
    return unreadableResult(
      "I can't describe that photo.",
      'The analysis service declined to answer for this image.',
    );
  }

  const rawText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const result = parseGuidance(rawText);

  return request_.kind === 'sweep' ? withGeometricStep(result, request_.frames) : result;
}

/**
 * Replace a directional next step with the one implied by the photo the model
 * picked. The model chose the frame; the angle of that frame decides the turn.
 *
 * Non-directional steps are left alone: 'arrived', 'look_for_entrance' and
 * 'unclear' are judgements about what is there, not directions, and overriding
 * them would turn "I still can't find it" into a confident turn.
 */
export function withGeometricStep(result: GuidanceResult, frames: SweepFrame[]): GuidanceResult {
  const index = result.photoIndex;
  if (index === null || index === undefined) return result;

  const frame = frames[index - 1]; // photoIndex is 1-based
  if (!frame) return result;

  if (!DIRECTIONAL_STEPS.includes(result.nextStep)) return result;

  return { ...result, nextStep: stepFromFrameAngle(frame.nominalOffsetDegrees) };
}
