/**
 * Speech-to-text for the destination field, via the Web Speech API.
 *
 * Typing a place name is the one part of this app that needs a keyboard, which
 * is the hardest thing to use if you can't see it well — so dictation isn't a
 * convenience here, it's the primary path for some people. The mobile keyboards
 * have their own dictation button, but it's a small unlabelled icon; this one is
 * a 60px control with a text label that says what it does.
 *
 * Feedback while listening is deliberately silent and haptic rather than spoken:
 * speaking through the speaker while the microphone is open feeds the app's own
 * voice back into the recognizer.
 */

/** Minimal shape of the recognition API, which isn't in the standard DOM types. */
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  0: RecognitionAlternative;
  isFinal: boolean;
}
interface RecognitionResultList {
  length: number;
  [index: number]: RecognitionResult;
}
interface RecognitionEvent {
  resultIndex: number;
  results: RecognitionResultList;
}
interface RecognitionErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechCapableWindow {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
}

export interface DictationHandlers {
  /** Partial text, updated as the user speaks. */
  onInterim(text: string): void;
  /** The finished transcript. */
  onFinal(text: string): void;
  /** Plain-language message to show and announce. */
  onError(message: string): void;
  /** Called once when listening stops, for any reason. */
  onEnd(): void;
}

function constructor(): RecognitionConstructor | null {
  const w = window as unknown as SpeechCapableWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Is dictation available in this browser at all? */
export function isDictationSupported(): boolean {
  return constructor() !== null;
}

/**
 * Each failure mode gets its own sentence, because the right thing to do next
 * differs: a blocked microphone needs settings, silence needs another try, and
 * a missing connection needs neither. Every one of them ends by pointing back
 * at the keyboard, so the user is never left without a way forward.
 */
function describeError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow it in your browser settings, or type the destination instead.';
    case 'no-speech':
      return "I didn't hear anything. Try speaking again, or type the destination.";
    case 'audio-capture':
      return "I couldn't reach a microphone. You can type the destination instead.";
    case 'network':
      return 'Speech recognition needs a connection. You can type the destination instead.';
    case 'aborted':
      return ''; // the user stopped it on purpose; nothing to report
    default:
      return "Speech recognition didn't work. You can type the destination instead.";
  }
}

let active: SpeechRecognitionLike | null = null;

/** Are we listening right now? */
export function isListening(): boolean {
  return active !== null;
}

/** Start listening. Must be called from a user gesture for the mic prompt. */
export function startDictation(handlers: DictationHandlers): boolean {
  const Recognition = constructor();
  if (!Recognition || active) return false;

  const recognition = new Recognition();
  recognition.lang = navigator.language || 'en-US';
  // One utterance, then stop: the user is saying a place name, not dictating
  // prose, and an open microphone that never closes is its own problem.
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result) continue;
      const text = result[0].transcript;
      if (result.isFinal) {
        handlers.onFinal(text.trim());
        return;
      }
      interim += text;
    }
    if (interim) handlers.onInterim(interim.trim());
  };

  recognition.onerror = (event) => {
    const message = describeError(event.error);
    if (message) handlers.onError(message);
  };

  recognition.onend = () => {
    active = null;
    handlers.onEnd();
  };

  try {
    recognition.start();
  } catch {
    // start() throws if it's already running; treat it as a failed start.
    active = null;
    return false;
  }

  active = recognition;
  return true;
}

/** Stop listening and keep whatever was recognised. */
export function stopDictation(): void {
  active?.stop();
}
