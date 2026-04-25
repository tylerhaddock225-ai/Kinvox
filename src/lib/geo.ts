// Geographic helpers used by both the public lead-magnet capture flow and
// the AI signal ingestion endpoint. Kept dependency-free so it's safe to
// import from server actions, route handlers, and edge functions alike.

export type LatLng = { lat: number; lng: number }

const EARTH_RADIUS_MILES = 3958.7613

/**
 * Great-circle distance between two coordinate pairs, in miles.
 * Pure function — no I/O, deterministic, safe to call in hot paths.
 */
export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_MILES * c
}

/**
 * Stand-in for a real geocoder (Mapbox / Google / etc.). Returns coordinates
 * relative to the org's epicenter so we can integration-test both the
 * "qualified" and "out of bounds" branches without external dependencies.
 *
 *   - address contains "OUT" (case-insensitive) → ~100 miles north of center
 *   - anything else                              → the org's center exactly
 *
 * Replace this when wiring a real provider; callers should not depend on
 * the offset shape, only on the fact that it returns a usable LatLng.
 */
export function geocodeAddress(address: string, orgCenter: LatLng): LatLng {
  if (/\bOUT\b/i.test(address)) {
    // ~1 degree of latitude ≈ 69 miles; +1.5° puts us comfortably outside
    // any radius up to ~100 mi. Longitude is left untouched so the
    // bearing is due-north and easy to reason about in tests.
    return { lat: orgCenter.lat + 1.5, lng: orgCenter.lng }
  }
  return { lat: orgCenter.lat, lng: orgCenter.lng }
}
