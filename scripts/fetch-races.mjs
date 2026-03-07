#!/usr/bin/env node
/**
 * fetch-races.mjs
 *
 * Fetches upcoming races from:
 *   - UltraSignup (near Winchester, KY)
 *   - Front Runners Lexington KY races page
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

// ── Front Runners Lexington ────────────────────────────────────────────────────
const FRONTRUNNERS_URL = 'https://frontrunnerslex.com/kyraces/';

async function fetchFrontRunners() {
  console.log(`Fetching Front Runners Lex: ${FRONTRUNNERS_URL}`);
  const res = await fetch(FRONTRUNNERS_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from Front Runners Lex`);
  const html = await res.text();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const races = [];

  // Strategy 1: HTML table rows — expect columns: Date | Race Name | Location/City | Distance
  const tableBodyRe = /<tbody[^>]*>([\s\S]*?)<\/tbody>/gi;
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();
  const hrefRe = /href="([^"]+)"/i;

  let tableMatch;
  while ((tableMatch = tableBodyRe.exec(html)) !== null) {
    const tbody = tableMatch[1];
    let rowMatch;
    while ((rowMatch = rowRe.exec(tbody)) !== null) {
      const row = rowMatch[1];
      const cells = [];
      let cellMatch;
      const cellReCopy = new RegExp(cellRe.source, 'gi');
      while ((cellMatch = cellReCopy.exec(row)) !== null) {
        cells.push(stripTags(cellMatch[1]));
      }
      if (cells.length < 2) continue;

      // Try to find a date in the cells (M/D/YYYY, YYYY-MM-DD, Month D YYYY, etc.)
      const dateRe = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4})/i;
      let dateStr = null;
      let dateIdx = -1;
      for (let i = 0; i < cells.length; i++) {
        const m = cells[i].match(dateRe);
        if (m) { dateStr = m[1]; dateIdx = i; break; }
      }
      if (!dateStr) continue;

      const parsed = new Date(dateStr);
      if (isNaN(parsed.getTime()) || parsed < today) continue;

      // Name: first non-date cell with meaningful text, or cell after date
      let name = '';
      for (let i = 0; i < cells.length; i++) {
        if (i === dateIdx) continue;
        if (cells[i].length > 3 && !cells[i].match(/^\d+[\/-]\d+/)) { name = cells[i]; break; }
      }
      if (!name) continue;

      // Location: look for a cell containing ", KY" or a US state abbreviation
      let location = '';
      for (let i = 0; i < cells.length; i++) {
        if (i === dateIdx) continue;
        if (/,\s*[A-Z]{2}/.test(cells[i]) && cells[i] !== name) { location = cells[i]; break; }
      }

      // Try to grab a link from the row for registration URL
      const linkMatch = rowMatch[1].match(hrefRe);
      const sourceUrl = linkMatch ? linkMatch[1] : FRONTRUNNERS_URL;

      races.push({
        name,
        date: toISODate(parsed),
        location: location || 'Kentucky',
        source: 'FrontRunnersLex',
        sourceUrl,
      });
    }
  }

  // Strategy 2: If no table rows found, look for list items or paragraphs with dates + race names
  if (races.length === 0) {
    const contentRe = /<(?:li|p)[^>]*>([\s\S]*?)<\/(?:li|p)>/gi;
    let m;
    const dateRe = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4})/i;
    while ((m = contentRe.exec(html)) !== null) {
      const text = stripTags(m[1]);
      const dm = text.match(dateRe);
      if (!dm) continue;
      const parsed = new Date(dm[1]);
      if (isNaN(parsed.getTime()) || parsed < today) continue;
      const name = text.replace(dm[0], '').replace(/^[\s\-–|:,]+|[\s\-–|:,]+$/g, '').trim();
      if (name.length < 3) continue;
      const linkMatch = m[1].match(hrefRe);
      races.push({
        name,
        date: toISODate(parsed),
        location: 'Kentucky',
        source: 'FrontRunnersLex',
        sourceUrl: linkMatch ? linkMatch[1] : FRONTRUNNERS_URL,
      });
    }
  }

  console.log(`Parsed ${races.length} upcoming races from Front Runners Lex`);
  return races;
}

async function main() {
  const manualData = JSON.parse(readFileSync(MANUAL_FILE, 'utf8'));
  const manualRaces = manualData.races ?? [];

  let ultraRaces = [];
  try {
    ultraRaces = await fetchUltraSignup();
    console.log(`Parsed ${ultraRaces.length} upcoming races`);
  } catch (e) {
    console.warn('UltraSignup fetch failed:', e.message);
  }

  let frRaces = [];
  try {
    frRaces = await fetchFrontRunners();
  } catch (e) {
    console.warn('Front Runners Lex fetch failed:', e.message);
  }

  // Merge: manual entries take precedence; skip exact name+date duplicates
  const seen = new Set();
  const merged = [];

  for (const r of manualRaces) {
    const k = normKey(r.name, r.date);
    if (!seen.has(k)) { seen.add(k); merged.push(r); }
  }
  for (const r of [...ultraRaces, ...frRaces]) {
    const k = normKey(r.name, r.date);
    if (!seen.has(k)) { seen.add(k); merged.push(r); }
  }

  merged.sort((a, b) => a.date.localeCompare(b.date));

  const ultraSource = { key: 'UltraSignup', name: 'UltraSignup', url: 'https://ultrasignup.com/events/search.aspx' };
  const frSource = { key: 'FrontRunnersLex', name: 'Front Runners Lexington', url: FRONTRUNNERS_URL };
  const sources = manualData.sources
    .filter(s => s.key !== 'UltraSignup' && s.key !== 'FrontRunnersLex')
    .concat(ultraSource, frSource);

  const output = {
    lastUpdated: new Date().toISOString().slice(0, 10),
    sources,
    races: merged,
  };

  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(
    `\nWrote races.json — ${merged.length} total races` +
    ` (${manualRaces.length} manual + ${ultraRaces.length} UltraSignup +` +
    ` ${frRaces.length} FrontRunners, deduped)`
  );
}

main().catch(e => { console.error(e); process.exit(1); });
