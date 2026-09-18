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
  Confidence,
  GuidanceResult,
  LocationContext,
  NextStep,
} from '../src/types.ts';

const DEFAULT_MODEL = 'claude-opus-5';

/** Models that accept the server-side refusal `fallbacks` parameter. */
const FALLBACK_CAPABLE = /^claude-(opus-5|fable-5)/;

/** Roughly 6 MB of base64 — a generous ceiling for one phone photo. */
const MAX_IMAGE_CHARS = 6 * 1024 * 1024;

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
 * - `spokenGuidance` is one short sentence because it is spoken aloud; long
 *   speech is worse than no speech when you are walking.
 * - The last paragraph makes "I can't tell" an explicit, low-confidence answer
 *   instead of letting the model guess from a dark or blurry photo.
 */
export function buildPrompt(destination: string, location: LocationContext | null | undefined): string {
  const locationContext = buildLocationContext(location);

  return `You are helping a person with low vision figure out, using a single photo they just took, whether they have reached their destination and what to do next.

Destination they are trying to reach: "${destination}"

${locationContext}

Look carefully at the photo and respond with ONLY a raw JSON object (no markdown formatting, no code fences, no extra text before or after) with exactly this shape:
{
  "arrived": true or false,
  "confidence": "high", "medium", or "low",
  "sceneDescription": "1-2 plain, concrete sentences describing what is visible in the photo, written for someone who can't see it well. Mention key landmarks, signage, doors, or obstacles.",
  "matchReasoning": "One sentence on why this does or does not look like the destination described.",
  "nextStep": one of "walk_forward", "turn_left", "turn_right", "turn_around", "look_for_entrance", "arrived", "unclear",
  "spokenGuidance": "One short, warm, natural-sounding sentence to say out loud to the person, telling them what to do next or confirming they've arrived. Speak directly to them, e.g. 'You're at the entrance now' or 'Keep walking forward, the doors should be just ahead on your right.'"
}

If the photo is too blurry, dark, or unclear to tell anything useful, set confidence to "low" and say so plainly in sceneDescription and spokenGuidance.`;
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

  return {
    arrived: fields.arrived === true,
    confidence: CONFIDENCES.includes(confidence as Confidence) ? (confidence as Confidence) : 'low',
    sceneDescription:
      typeof fields.sceneDescription === 'string' && fields.sceneDescription.trim()
        ? fields.sceneDescription
        : "I couldn't make out enough detail in that photo.",
    matchReasoning: typeof fields.matchReasoning === 'string' ? fields.matchReasoning : '',
    nextStep: NEXT_STEPS.includes(nextStep as NextStep) ? (nextStep as NextStep) : 'unclear',
    spokenGuidance:
      typeof fields.spokenGuidance === 'string' && fields.spokenGuidance.trim()
        ? fields.spokenGuidance
        : "I'm not sure what's ahead. Let's try another photo.",
  };
}

/** Validate the request body coming off the wire. */
function readRequest(body: unknown): AnalyzeRequest {
  if (typeof body !== 'object' || body === null) {
    throw new AnalyzeError('Request body must be a JSON object.', 400);
  }

  const { destination, imageBase64, location } = body as Record<string, unknown>;

  if (typeof destination !== 'string' || !destination.trim()) {
    throw new AnalyzeError('A destination is required.', 400);
  }

  if (typeof imageBase64 !== 'string' || !imageBase64) {
    throw new AnalyzeError('A photo is required.', 400);
  }

  if (imageBase64.length > MAX_IMAGE_CHARS) {
    throw new AnalyzeError('That photo is too large to analyze.', 413);
  }

  let parsedLocation: LocationContext | null = null;
  if (typeof location === 'object' && location !== null) {
    const { lat, lon, label } = location as Record<string, unknown>;
    if (typeof lat === 'number' && typeof lon === 'number') {
      parsedLocation = { lat, lon, label: typeof label === 'string' ? label : null };
    }
  }

  return { destination: destination.trim(), imageBase64, location: parsedLocation };
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
  const { destination, imageBase64, location } = readRequest(body);
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const effort = (process.env.ANTHROPIC_EFFORT || 'low') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';

  const request = {
    model,
    max_tokens: 8000,
    // Adaptive thinking, held at low effort by default: this is a single
    // look-and-decide call and the person is waiting on their feet, so latency
    // is part of the accessibility story. Raise ANTHROPIC_EFFORT for harder scenes.
    thinking: { type: 'adaptive' as const },
    output_config: { effort },
    messages: [
      {
        role: 'user' as const,
        content: [
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: 'image/jpeg' as const,
              data: imageBase64,
            },
          },
          { type: 'text' as const, text: buildPrompt(destination, location) },
        ],
      },
    ],
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

  return parseGuidance(rawText);
}
