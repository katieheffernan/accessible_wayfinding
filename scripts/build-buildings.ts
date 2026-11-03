/**
 * Build `src/data/buildings.json` from Stanford's published accessible-entrance
 * spreadsheet.
 *
 * Run by hand, not at build time:
 *
 *   node scripts/build-buildings.ts "~/Downloads/Stanford Accessible Entrances.xlsx"
 *
 * The generated file is committed, so the app has no network dependency and no
 * build step beyond Vite. Re-run this only when Stanford publishes a new sheet.
 *
 * Why coordinates have to be derived at all: the spreadsheet carries a street
 * address and a prose description of the accessible entrance, but no latitude
 * or longitude — and GPS guidance needs a point to walk towards. Two sources
 * are used, in this order:
 *
 *  1. Stanford's own campus map, which pins amenities (printers, AEDs, parking)
 *     to a facility ID. Averaging the pins for one ID gives a point inside that
 *     building, from Stanford's own data, keyed by the same ID the spreadsheet
 *     uses. This is the better source where it exists: the join is on an exact
 *     identifier rather than on a fuzzy address match.
 *  2. OpenStreetMap's Nominatim geocoder for the rest, by street address and
 *     then by building name.
 *
 * Every building records which source its coordinates came from, so a bad pin
 * can be traced back rather than silently trusted. Buildings that neither
 * source could place are still emitted, with `null` coordinates: their entrance
 * description is useful even when GPS guidance to them is not possible.
 *
 * Both of these put you at the *building*, not at its accessible entrance. That
 * limitation is deliberate and is reflected in how the app speaks: GPS gets the
 * user to the building, and the entrance description plus the camera take them
 * the last few metres.
 */

import { inflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Nominatim asks for a contact in the User-Agent and no more than 1 request/sec. */
const USER_AGENT = 'here-yet-accessible-wayfinding/0.1 (prototype; contact: katiehef@stanford.edu)';
const GEOCODE_DELAY_MS = 1100;

const CAMPUS_MAP_JS = 'https://campus-map.stanford.edu/js/stan_cm_js.cfm';

/**
 * Pins for one facility ID that sprawl further than this are not one building,
 * so the average of them is not a point inside it. Stanford's campus is made of
 * large sites (stadiums, sports complexes) where this can legitimately happen.
 */
const MAX_PIN_SPREAD_M = 150;

/** Past this, a geocoder hit for a Stanford address is a match somewhere else. */
const MAX_GEOCODE_DISTANCE_M = 4000;

/** Roughly the centre of campus, used only to sanity-check geocoder results. */
const CAMPUS_CENTRE = { lat: 37.4275, lon: -122.1697 };

// ---------------------------------------------------------------------------
// Minimal .xlsx reader
//
// An .xlsx is a zip of XML parts. Reading the two parts we need directly keeps
// the project's dependency list at one package; a spreadsheet library would be
// a large dependency used by a script that runs once.
// ---------------------------------------------------------------------------

/** Read one named entry out of a zip archive. */
function readZipEntry(zip: Buffer, name: string): string {
  // Locate the end-of-central-directory record by scanning back for its
  // signature; the comment field means it is not at a fixed offset.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file: no end-of-central-directory record.');

  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Corrupt zip: bad central directory signature.');
    }

    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const entryName = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    if (entryName === name) {
      // The local header repeats the name and extra fields, at its own lengths.
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = zip.subarray(start, start + compressedSize);
      return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`Entry not found in archive: ${name}`);
}

/** Decode the five XML entities that can appear in spreadsheet text. */
function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Concatenate every <t> run inside one chunk of XML. */
function textRuns(xml: string): string {
  const runs = xml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? [];
  return runs.map((run) => decodeXml(run.replace(/<[^>]+>/g, ''))).join('');
}

/** Read the first worksheet as rows of column-letter -> cell text. */
function readSheet(path: string): Record<string, string>[] {
  const zip = readFileSync(path);

  // Shared strings are stored once and referenced by index from cells with t="s".
  let shared: string[] = [];
  try {
    const xml = readZipEntry(zip, 'xl/sharedStrings.xml');
    shared = (xml.match(/<si>[\s\S]*?<\/si>/g) ?? []).map(textRuns);
  } catch {
    // A sheet with only inline strings has no sharedStrings part.
  }

  const sheet = readZipEntry(zip, 'xl/worksheets/sheet1.xml');
  const rows: Record<string, string>[] = [];

  for (const rowXml of sheet.match(/<row[\s\S]*?<\/row>/g) ?? []) {
    const cells: Record<string, string> = {};

    for (const cellXml of rowXml.match(/<c[\s\S]*?(?:\/>|<\/c>)/g) ?? []) {
      const ref = /r="([A-Z]+)\d+"/.exec(cellXml)?.[1];
      if (!ref) continue;

      const type = /t="([^"]+)"/.exec(cellXml)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1];

      let text = '';
      if (type === 's' && value !== undefined) {
        text = shared[Number(value)] ?? '';
      } else if (type === 'inlineStr') {
        text = textRuns(cellXml);
      } else if (value !== undefined) {
        text = decodeXml(value);
      }

      cells[ref] = text.trim();
    }

    rows.push(cells);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Coordinate sources
// ---------------------------------------------------------------------------

interface Fix {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_000;

function distanceMeters(a: Fix, b: Fix): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Pull facility-ID-to-coordinate pins out of Stanford's campus map script.
 *
 * The script declares markers as `gen_mrk_arr[n][0] = new google.maps.LatLng(...)`
 * with the facility ID at `[7]` of the same index. This is scraping a page that
 * was not meant as an API, so every step is tolerant of coming back empty: if
 * the format changes, this source yields nothing and everything falls through
 * to the geocoder rather than the build failing.
 */
async function fetchCampusMapPins(): Promise<Map<string, Fix>> {
  const pins = new Map<string, Fix[]>();

  let source: string;
  try {
    const response = await fetch(CAMPUS_MAP_JS, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    source = await response.text();
  } catch (error) {
    console.warn(`  campus map unavailable (${(error as Error).message}) — geocoding everything`);
    return new Map();
  }

  const coords = new Map<string, Fix>();
  const coordPattern =
    /gen_mrk_arr\[(\d+)\]\[0\]\s*=\s*new google\.maps\.LatLng\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g;
  for (const match of source.matchAll(coordPattern)) {
    coords.set(match[1]!, { lat: Number(match[2]), lon: Number(match[3]) });
  }

  const facilityPattern = /gen_mrk_arr\[(\d+)\]\[7\]\s*=\s*"([^"]*)"/g;
  for (const match of source.matchAll(facilityPattern)) {
    const fix = coords.get(match[1]!);
    const facilityId = match[2]!;
    if (!fix || !facilityId) continue;
    pins.set(facilityId, [...(pins.get(facilityId) ?? []), fix]);
  }

  const centres = new Map<string, Fix>();
  for (const [facilityId, fixes] of pins) {
    const centre = {
      lat: fixes.reduce((sum, f) => sum + f.lat, 0) / fixes.length,
      lon: fixes.reduce((sum, f) => sum + f.lon, 0) / fixes.length,
    };

    // Reject a set of pins too spread out to share one centre — averaging them
    // would produce a confident point in the middle of nothing.
    const spread = Math.max(...fixes.map((f) => distanceMeters(centre, f)));
    if (spread <= MAX_PIN_SPREAD_M) centres.set(facilityId, centre);
  }

  return centres;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** One Nominatim search, returning null for anything that isn't a clean hit. */
async function geocode(query: string): Promise<{ fix: Fix; label: string } | null> {
  const params = new URLSearchParams({ format: 'json', limit: '1', q: query });

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { lat?: string; lon?: string; display_name?: string }[];
    const first = data[0];
    if (!first) return null;

    const fix = { lat: Number(first.lat), lon: Number(first.lon) };
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return null;

    // A hit far from campus is the right street name in the wrong city, which
    // is worse than no coordinates at all: it would send someone walking.
    if (distanceMeters(CAMPUS_CENTRE, fix) > MAX_GEOCODE_DISTANCE_M) return null;

    return { fix, label: first.display_name ?? query };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

/** One building, as the app consumes it. */
interface Building {
  /** Stanford facility ID, e.g. "02-670". Stable across sheet revisions. */
  id: string;
  name: string;
  address: string;
  /**
   * Stanford's prose description of the accessible way in, verbatim. Empty for
   * the handful of buildings whose ADA page carries no entrance information.
   */
  accessibleEntrance: string;
  /** Centre of the building, or null where neither source could place it. */
  lat: number | null;
  lon: number | null;
  /** Where lat/lon came from, so a bad pin is traceable. */
  source: 'stanford-campus-map' | 'nominatim-address' | 'nominatim-name' | 'none';
  /** Stanford's ADA page for this building. */
  url: string;
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/build-buildings.ts <path to .xlsx>');
    process.exit(1);
  }

  console.log(`Reading ${input}`);
  const rows = readSheet(resolve(input.replace(/^~/, process.env.HOME ?? '~')));

  // Map the header row to column letters rather than assuming A-F, so a
  // reordered or extended sheet still reads correctly.
  const header = rows[0] ?? {};
  const columnOf = (name: string): string | null =>
    Object.entries(header).find(([, value]) => value.toLowerCase() === name)?.[0] ?? null;

  const columns = {
    name: columnOf('name'),
    id: columnOf('id'),
    address: columnOf('address'),
    entrance: columnOf('accessible_entrance'),
    url: columnOf('url'),
  };

  for (const [field, column] of Object.entries(columns)) {
    if (!column) throw new Error(`Spreadsheet is missing a "${field}" column.`);
  }

  console.log('Fetching Stanford campus map pins…');
  const pins = await fetchCampusMapPins();
  console.log(`  ${pins.size} facility IDs pinned by Stanford's own map`);

  const buildings: Building[] = [];
  const needGeocoding: Record<string, string>[] = [];

  for (const row of rows.slice(1)) {
    const id = row[columns.id!] ?? '';
    const name = row[columns.name!] ?? '';
    if (!id && !name) continue;

    const pin = pins.get(id);
    const building: Building = {
      id,
      name,
      address: row[columns.address!] ?? '',
      accessibleEntrance: row[columns.entrance!] ?? '',
      lat: pin?.lat ?? null,
      lon: pin?.lon ?? null,
      source: pin ? 'stanford-campus-map' : 'none',
      url: row[columns.url!] ?? '',
    };

    buildings.push(building);
    if (!pin) needGeocoding.push(row);
  }

  console.log(`\n${buildings.length} buildings; geocoding the ${needGeocoding.length} without a pin…`);

  for (const building of buildings) {
    if (building.source !== 'none') continue;

    // Address first: it is the more specific query. Building names are the
    // fallback, and work surprisingly often because OpenStreetMap carries
    // Stanford's own building names — but only when the query stays short.
    // Qualifying it with "Stanford University" makes Nominatim miss outright,
    // so the fallbacks trim rather than add: first the name as written, then
    // the name with its parenthetical aside removed, since the sheet's
    // "(CHILD CARE CENTER)" style suffixes are not part of the map's name.
    const address = building.address.replace(/,\s*$/, '').trim();
    const bareName = building.name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

    const attempts: { query: string; source: Building['source'] }[] = [
      ...(address ? [{ query: `${address}, CA`, source: 'nominatim-address' as const }] : []),
      { query: `${building.name}, Stanford, CA`, source: 'nominatim-name' as const },
      ...(bareName && bareName !== building.name
        ? [{ query: `${bareName}, Stanford, CA`, source: 'nominatim-name' as const }]
        : []),
    ];

    let hit: Awaited<ReturnType<typeof geocode>> = null;
    let source: Building['source'] = 'none';

    for (const attempt of attempts) {
      hit = await geocode(attempt.query);
      if (hit) {
        source = attempt.source;
        break;
      }
      await sleep(GEOCODE_DELAY_MS);
    }

    if (hit) {
      building.lat = hit.fix.lat;
      building.lon = hit.fix.lon;
      building.source = source;
      console.log(`  ✓ ${building.name} — ${source}`);
    } else {
      console.log(`  ✗ ${building.name} — no coordinates`);
    }

    await sleep(GEOCODE_DELAY_MS);
  }

  const placed = buildings.filter((b) => b.lat !== null);
  const withEntrance = buildings.filter((b) => b.accessibleEntrance);

  const output = {
    // Provenance travels with the data: this is third-party information about
    // accessibility that someone will act on, and where it came from and how
    // old it is are part of being able to trust it.
    source: "Stanford University Land, Buildings & Real Estate — accessible entrances (maps.stanford.edu/ada)",
    coordinateSources: 'Stanford campus map facility pins; OpenStreetMap Nominatim for the remainder',
    generated: new Date().toISOString().slice(0, 10),
    buildings: buildings.sort((a, b) => a.name.localeCompare(b.name)),
  };

  const target = resolve(import.meta.dirname, '../src/data/buildings.json');
  writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`\nWrote ${target}`);
  console.log(`  ${buildings.length} buildings`);
  console.log(`  ${placed.length} with coordinates (${buildings.length - placed.length} without)`);
  console.log(`  ${withEntrance.length} with an accessible-entrance description`);

  for (const [source, count] of Object.entries(
    buildings.reduce<Record<string, number>>((tally, b) => {
      tally[b.source] = (tally[b.source] ?? 0) + 1;
      return tally;
    }, {}),
  )) {
    console.log(`    ${source}: ${count}`);
  }
}

await main();
