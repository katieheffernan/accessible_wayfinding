/**
 * Best-effort location context.
 *
 * Entirely optional: if the user declines the permission, the lookup times out,
 * or the geocoder is unreachable, the app carries on with the photo alone. The
 * model is told to treat this as weak supporting evidence either way.
 */

import type { GeocodedPlace, LocationContext } from '../types';

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

/**
 * Forward-geocode the typed destination to coordinates, so we can work out which
 * way it lies. Returns null when nothing is found.
 *
 * This is the weakest link in the compass feature: Nominatim is a place-name
 * search, and people describe destinations in ways that aren't place names
 * ("front entrance of the downtown library"). A miss is expected and harmless —
 * the app falls back to reading the photo alone — but a *wrong* hit is not
 * obviously distinguishable from a right one, which is why the resolved name is
 * shown to the user and the distance is sanity-checked server-side.
 */
export async function geocodeDestination(
  query: string,
  near: LocationContext | null,
): Promise<GeocodedPlace | null> {
  const params = new URLSearchParams({ format: 'json', q: query, limit: '1' });

  // Bias the search to a box roughly 25km around the user, so "the downtown
  // library" resolves near them rather than in another country. viewbox is
  // left,top,right,bottom in lon/lat.
  if (near) {
    const degrees = 0.25;
    params.set(
      'viewbox',
      [near.lon - degrees, near.lat + degrees, near.lon + degrees, near.lat - degrees].join(','),
    );
    params.set('bounded', '1');
  }

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'Accept-Language': 'en' },
    });
    if (!response.ok) return null;

    const data: unknown = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const first = data[0] as Record<string, unknown>;
    const lat = Number(first.lat);
    const lon = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
      lat,
      lon,
      label: typeof first.display_name === 'string' ? first.display_name : query,
    };
  } catch {
    return null; // best effort, ignore
  }
}
