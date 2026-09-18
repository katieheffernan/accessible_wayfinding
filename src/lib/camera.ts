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

/** Release the camera. Called on every screen change away from the viewfinder. */
export function stopCamera(): void {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
  stream = null;
}

/**
 * Grab the current frame as a JPEG data URL, or null if the camera hasn't
 * produced a frame yet (videoWidth is 0 until the first frame arrives).
 */
export function captureFrame(video: HTMLVideoElement): string | null {
  if (!video.videoWidth) return null;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const context = canvas.getContext('2d');
  if (!context) return null;

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}
