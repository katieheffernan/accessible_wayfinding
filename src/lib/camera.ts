/** Rear-camera access and still capture. */

let stream: MediaStream | null = null;

export class CameraError extends Error {}

/** Attach the rear camera to a <video> element. Throws CameraError with copy to show. */
export async function startCamera(video: HTMLVideoElement): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      "This browser can't access the camera here. Try opening this page in a full browser tab.",
    );
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    video.srcObject = stream;
  } catch {
    throw new CameraError('Camera access was blocked. Please allow camera permission and try again.');
  }
}

/** Is the camera currently streaming? */
export function isCameraRunning(): boolean {
  return stream !== null;
}

/** Release the camera. Called when leaving the camera shell. */
export function stopCamera(): void {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
  stream = null;
}

/**
 * Longest edge of the photo we send, in pixels.
 *
 * Claude downsamples images past roughly this size anyway, so a full-resolution
 * phone frame buys no extra detail — it just costs upload time on a mobile
 * connection, tokens, latency, and the risk of tripping the API's per-image
 * size limit. A 4032x3024 frame of a detailed scene can encode to several
 * megabytes; at 1568 the same scene is a fraction of that.
 */
const MAX_EDGE_PX = 1568;

/**
 * Grab the current frame as a JPEG data URL, scaled down for sending, or null
 * if the camera hasn't produced a frame yet (videoWidth is 0 until the first
 * frame arrives) or the encode failed.
 */
export function captureFrame(video: HTMLVideoElement): string | null {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);

  const context = canvas.getContext('2d');
  if (!context) return null;

  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  // A canvas that ran out of memory yields a stub rather than throwing, and an
  // empty payload would fail confusingly at the server instead of here.
  if (!dataUrl.startsWith('data:image/jpeg') || dataUrl.length < 512) return null;
  return dataUrl;
}
