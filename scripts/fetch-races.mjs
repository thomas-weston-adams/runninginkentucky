#!/usr/bin/env node
/**
 * fetch-races.mjs
 *
 * Fetches upcoming races near Winchester, KY (40391) from UltraSignup
 * and merges them with the hand-curated data/races-manual.json.
 * Writes the merged result to data/races.json.
 *
 * Usage:
 *   node scripts/fetch-races.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const MANUAL_FILE = join(ROOT, 'data', 'races-manual.json');
const OUT_FILE = join(ROOT, 'data', 'races.json');

// Winchester, KY center point
const LAT = 37.9927;
const LNG = -84.1799;
const RADIUS_MILES = 75;

// Parse UltraSignup's .NET JSON date: /Date(1234567890000)/
function parseUSDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(/\/Date\((\d+)\)\//);
  if (m) return new Date(parseInt(m[1], 10));
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function normKey(name, date) {
  return `${String(name).toLowerCase().replace(/[^a-z0-9]/g, '')}_${date}`;
}

async function fetchUltraSignup() {
  const url =
    `https://ultrasignup.com/service/events.svc/geteventsforregistration` +
    `?d=${RADIUS_MILES}&lat=${LAT}&lng=${LNG}&virtual=false&future=true`;
  console.log(`Fetching UltraSignup: ${url}`);

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://ultrasignup.com/events/search.aspx',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} from UltraSignup`);

  const data = await res.json();
  if (!Array.isArray(data)) {
    console.warn('Unexpected UltraSignup response:', JSON.stringify(data).slice(0, 300));
    return [];
  }

  console.log(`Received ${data.length} events from UltraSignup`);
  if (data.length > 0) {
    console.log('Fields:', Object.keys(data[0]).join(', '));
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return data
    .map(ev => {
      const date = parseUSDate(ev.EventDate || ev.event_date);
      if (!date || date < today) return null;

      const eventId = ev.event_id ?? ev.EventId ?? ev.Id;
      const sourceUrl = eventId
        ? `https://ultrasignup.com/register.aspx?eid=${eventId}`
        : 'https://ultrasignup.com/events/search.aspx';

      const name = ev.EventName || ev.name || 'Unknown Event';
      const city = ev.City || ev.city || '';
      const state = ev.State || ev.state || '';
      const location = [city, state].filter(Boolean).join(', ') || 'Kentucky';

      const distNum = ev.Distance ?? ev.distance;
      const distUom = ev.DistanceUOM || ev.distance_uom || '';
      const notes = distNum ? `${distNum}${distUom ? ' ' + distUom : ''}` : undefined;

      return { name, date: toISODate(date), location, source: 'UltraSignup', sourceUrl, ...(notes ? { notes } : {}) };
    })
    .filter(Boolean);
}

async function main() {
  const manualData = JSON.parse(readFileSync(MANUAL_FILE, 'utf8'));
  const manualRaces = manualData.races ?? [];

  let ultraRaces = [];
  try {
    ultraRaces = await fetchUltraSignup();
    console.log(`Parsed ${ultraRaces.length} upcoming races`);
  } catch (e) {
    console.warn('UltraSignup fetch failed — using manual races only:', e.message);
  }

  // Merge: manual entries take precedence; skip exact name+date duplicates
  const seen = new Set();
  const merged = [];

  for (const r of manualRaces) {
    const k = normKey(r.name, r.date);
    if (!seen.has(k)) { seen.add(k); merged.push(r); }
  }
  for (const r of ultraRaces) {
    const k = normKey(r.name, r.date);
    if (!seen.has(k)) { seen.add(k); merged.push(r); }
  }

  merged.sort((a, b) => a.date.localeCompare(b.date));

  const ultraSource = { key: 'UltraSignup', name: 'UltraSignup', url: 'https://ultrasignup.com/events/search.aspx' };
  const sources = manualData.sources.filter(s => s.key !== 'UltraSignup').concat(ultraSource);

  const output = {
    lastUpdated: new Date().toISOString().slice(0, 10),
    sources,
    races: merged,
  };

  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(
    `\nWrote races.json — ${merged.length} total races` +
    ` (${manualRaces.length} manual + ${ultraRaces.length} from UltraSignup,` +
    ` ${merged.length - manualRaces.length} net new after dedup)`
  );
}

main().catch(e => { console.error(e); process.exit(1); });
