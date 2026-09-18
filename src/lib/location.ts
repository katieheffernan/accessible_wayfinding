/**
 * Best-effort location context.
 *
 * Entirely optional: if the user declines the permission, the lookup times out,
 * or the geocoder is unreachable, the app carries on with the photo alone. The
 * model is told to treat this as weak supporting evidence either way.
 */

import type { LocationContext } from '../types';

const GEOLOCATION_TIMEOUT_MS = 6000;

/**
 * Reverse-geocode via OpenStreetMap Nominatim — free and keyless, which keeps
 * the prototype runnable with nothing but an Anthropic key. Nominatim asks for
 * low request volumes; one lookup per destination is well within that.
 */
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } },
    );
    if (!response.ok) return null;

    const data: unknown = await response.json();
    if (typeof data === 'object' && data !== null) {
      const displayName = (data as Record<string, unknown>).display_name;
      if (typeof displayName === 'string') return displayName;
    }
    return null;
  } catch {
    return null; // best effort, ignore
  }
}

/**
 * Resolve coordinates plus an address guess, or null if location is unavailable.
 * Never rejects — the caller should not have to handle a failure here.
 */
export function getLocationContext(): Promise<LocationContext | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude: lat, longitude: lon } = position.coords;
        // Resolve coordinates even if the address lookup fails.
        resolve({ lat, lon, label: await reverseGeocode(lat, lon) });
      },
      () => resolve(null), // denied or unavailable, proceed without it
      { timeout: GEOLOCATION_TIMEOUT_MS },
    );
  });
}
