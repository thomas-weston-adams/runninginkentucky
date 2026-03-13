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
      // Skip cancelled events
      if (ev.Cancelled) return null;

      const date = parseUSDate(ev.EventDate);
      if (!date || date < today) return null;

      const sourceUrl = ev.EventId
        ? `https://ultrasignup.com/register.aspx?eid=${ev.EventId}`
        : 'https://ultrasignup.com/events/search.aspx';

      const name = ev.EventName || 'Unknown Event';
      const location = [ev.City, ev.State].filter(Boolean).join(', ') || 'Kentucky';

      // Distances is a single string like "50K, 25K" from the jqGrid field
      const notes = ev.Distances || undefined;

      return { name, date: toISODate(date), location, source: 'UltraSignup', sourceUrl, ...(notes ? { notes } : {}) };
    })
    .filter(Boolean);
}

// ── FindARace ─────────────────────────────────────────────────────────────────
const FINDARACE_URL = 'https://findarace.com/us/running/trail-runs/kentucky/lexington-fayette';

async function fetchFindARace() {
  console.log(`Fetching FindARace: ${FINDARACE_URL}`);
  const res = await fetch(FINDARACE_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from FindARace`);
  const html = await res.text();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const races = [];

  const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&#?\w+;/g, '').replace(/\s+/g, ' ').trim();

  // FindARace uses JSON-LD structured data — try that first
  const jsonLdRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      const items = Array.isArray(obj) ? obj : obj['@graph'] ? obj['@graph'] : [obj];
      for (const item of items) {
        if (item['@type'] !== 'SportsEvent' && item['@type'] !== 'Event') continue;
        const rawDate = item.startDate || item.startDate;
        if (!rawDate) continue;
        const date = new Date(rawDate);
        if (isNaN(date.getTime()) || date < today) continue;
        const name = item.name || item.alternateName;
        if (!name) continue;
        const loc = item.location?.address?.addressLocality || item.location?.name || 'Kentucky';
        const state = item.location?.address?.addressRegion || '';
        const location = state ? `${loc}, ${state}` : loc;
        races.push({
          name,
          date: toISODate(date),
          location,
          source: 'FindARace',
          sourceUrl: item.url || FINDARACE_URL,
        });
      }
    } catch { /* malformed JSON-LD, skip */ }
  }

  // Fallback: scrape race cards by looking for date + name patterns
  if (races.length === 0) {
    const cardRe = /<(?:article|div|li)[^>]*class="[^"]*race[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div|li)>/gi;
    const dateRe = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4})/i;
    const hrefRe = /href="(https?:\/\/[^"]+)"/i;
    while ((m = cardRe.exec(html)) !== null) {
      const text = stripTags(m[1]);
      const dm = text.match(dateRe);
      if (!dm) continue;
      const date = new Date(dm[1]);
      if (isNaN(date.getTime()) || date < today) continue;
      const name = text.replace(dm[0], '').replace(/^[\s\-–|:,]+|[\s\-–|:,]+$/g, '').trim();
      if (name.length < 3) continue;
      const link = m[1].match(hrefRe);
      races.push({
        name,
        date: toISODate(date),
        location: 'Kentucky',
        source: 'FindARace',
        sourceUrl: link ? link[1] : FINDARACE_URL,
      });
    }
  }

  console.log(`Parsed ${races.length} upcoming races from FindARace`);
  return races;
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

// ── John's Run Walk Shop ───────────────────────────────────────────────────────
const JOHNS_URL = 'https://www.johnsrunwalkshop.com/races';

async function fetchJohns() {
  console.log(`Fetching John's Run Walk Shop: ${JOHNS_URL}`);
  const res = await fetch(JOHNS_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from John's`);
  const html = await res.text();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const races = [];

  const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&#?\w+;/g, '').replace(/\s+/g, ' ').trim();
  const hrefRe = /href="([^"]+)"/i;

  // Strategy 1: JSON-LD
  const jsonLdRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      const items = Array.isArray(obj) ? obj : obj['@graph'] ? obj['@graph'] : [obj];
      for (const item of items) {
        if (!['SportsEvent', 'Event'].includes(item['@type'])) continue;
        const rawDate = item.startDate;
        if (!rawDate) continue;
        const date = new Date(rawDate);
        if (isNaN(date.getTime()) || date < today) continue;
        const name = item.name;
        if (!name) continue;
        const loc = item.location?.address?.addressLocality || item.location?.name || '';
        const state = item.location?.address?.addressRegion || '';
        const location = [loc, state].filter(Boolean).join(', ') || 'Kentucky';
        races.push({ name, date: toISODate(date), location, source: 'Johns', sourceUrl: item.url || JOHNS_URL });
      }
    } catch { /* skip */ }
  }

  // Strategy 2: table rows
  if (races.length === 0) {
    const tableBodyRe = /<tbody[^>]*>([\s\S]*?)<\/tbody>/gi;
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const dateRe = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4})/i;
    let tableMatch;
    while ((tableMatch = tableBodyRe.exec(html)) !== null) {
      let rowMatch;
      while ((rowMatch = rowRe.exec(tableMatch[1])) !== null) {
        const cells = [];
        let cellMatch;
        const cr = new RegExp(cellRe.source, 'gi');
        while ((cellMatch = cr.exec(rowMatch[1])) !== null) cells.push(stripTags(cellMatch[1]));
        if (cells.length < 2) continue;
        let dateStr = null, dateIdx = -1;
        for (let i = 0; i < cells.length; i++) {
          const dm = cells[i].match(dateRe);
          if (dm) { dateStr = dm[1]; dateIdx = i; break; }
        }
        if (!dateStr) continue;
        const parsed = new Date(dateStr);
        if (isNaN(parsed.getTime()) || parsed < today) continue;
        let name = '';
        for (let i = 0; i < cells.length; i++) {
          if (i === dateIdx) continue;
          if (cells[i].length > 3 && !/^\d/.test(cells[i])) { name = cells[i]; break; }
        }
        if (!name) continue;
        let location = '';
        for (let i = 0; i < cells.length; i++) {
          if (i === dateIdx) continue;
          if (/,\s*[A-Z]{2}/.test(cells[i]) && cells[i] !== name) { location = cells[i]; break; }
        }
        const linkMatch = rowMatch[1].match(hrefRe);
        races.push({
          name, date: toISODate(parsed), location: location || 'Kentucky',
          source: 'Johns',
          sourceUrl: linkMatch ? new URL(linkMatch[1], JOHNS_URL).href : JOHNS_URL,
        });
      }
    }
  }

  // Strategy 3: list/card elements
  if (races.length === 0) {
    const dateRe = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4})/i;
    const cardRe = /<(?:li|article|div)[^>]*class="[^"]*(?:race|event|card)[^"]*"[^>]*>([\s\S]*?)<\/(?:li|article|div)>/gi;
    while ((m = cardRe.exec(html)) !== null) {
      const text = stripTags(m[1]);
      const dm = text.match(dateRe);
      if (!dm) continue;
      const parsed = new Date(dm[1]);
      if (isNaN(parsed.getTime()) || parsed < today) continue;
      const name = text.replace(dm[0], '').replace(/^[\s\-–|:,]+|[\s\-–|:,]+$/g, '').trim();
      if (name.length < 3) continue;
      const linkMatch = m[1].match(hrefRe);
      races.push({
        name, date: toISODate(parsed), location: 'Kentucky',
        source: 'Johns',
        sourceUrl: linkMatch ? new URL(linkMatch[1], JOHNS_URL).href : JOHNS_URL,
      });
    }
  }

  console.log(`Parsed ${races.length} upcoming races from John's Run Walk Shop`);
  return races;
}

// ── RunSignUp ─────────────────────────────────────────────────────────────────
// Public REST API — no key required for basic race search
const RUNSIGNUP_API = 'https://runsignup.com/REST/races';

async function fetchRunSignUp() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = today.toISOString().slice(0, 10);

  // Search within 100 miles of Lexington, KY (40502)
  const url =
    `${RUNSIGNUP_API}?format=json&zipcode=40502&radius=100` +
    `&start_date=${startDate}&results_per_page=250&sort=date ASC`;

  console.log(`Fetching RunSignUp: ${url}`);

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} from RunSignUp`);

  const data = await res.json();
  const races = data.races ?? [];

  console.log(`Received ${races.length} races from RunSignUp`);

  return races
    .map(entry => {
      const r = entry.race;
      if (!r) return null;

      // next_date is ISO string "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD"
      const rawDate = r.next_date || r.last_date;
      if (!rawDate) return null;
      const date = new Date(rawDate);
      if (isNaN(date.getTime()) || date < today) return null;

      const name = r.name;
      if (!name) return null;

      const city  = r.address?.city  || r.city  || '';
      const state = r.address?.state || r.state || '';
      const location = [city, state].filter(Boolean).join(', ') || 'Kentucky';

      const sourceUrl = r.url
        ? `https://runsignup.com/Race/${r.url}`
        : `https://runsignup.com/Race/${r.race_id}`;

      return { name, date: toISODate(date), location, source: 'RunSignUp', sourceUrl };
    })
    .filter(Boolean);
}

// ── RaceRise ───────────────────────────────────────────────────────────────────
const RACERISE_URL = 'https://www.racerise.com/upcoming-races';

async function fetchRaceRise() {
  console.log(`Fetching RaceRise: ${RACERISE_URL}`);
  const res = await fetch(RACERISE_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from RaceRise`);
  const html = await res.text();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const races = [];

  const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&#?\w+;/g, '').replace(/\s+/g, ' ').trim();
  const hrefRe = /href="([^"]+)"/i;

  // Strategy 1: JSON-LD structured data
  const jsonLdRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      const items = Array.isArray(obj) ? obj : obj['@graph'] ? obj['@graph'] : [obj];
      for (const item of items) {
        if (!['SportsEvent', 'Event', 'SportsOrganization'].includes(item['@type'])) continue;
        const rawDate = item.startDate;
        if (!rawDate) continue;
        const date = new Date(rawDate);
        if (isNaN(date.getTime()) || date < today) continue;
        const name = item.name;
        if (!name) continue;
        const loc = item.location?.address?.addressLocality || item.location?.name || '';
        const state = item.location?.address?.addressRegion || '';
        const location = [loc, state].filter(Boolean).join(', ') || 'Kentucky';
        races.push({
          name, date: toISODate(date), location,
          source: 'RaceRise',
          sourceUrl: item.url || RACERISE_URL,
        });
      }
    } catch { /* skip malformed */ }
  }

  // Strategy 2: HTML table rows (date | name | location | distance)
  if (races.length === 0) {
    const tableBodyRe = /<tbody[^>]*>([\s\S]*?)<\/tbody>/gi;
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const dateRe = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4})/i;
    let tableMatch;
    while ((tableMatch = tableBodyRe.exec(html)) !== null) {
      const tbody = tableMatch[1];
      let rowMatch;
      while ((rowMatch = rowRe.exec(tbody)) !== null) {
        const cells = [];
        let cellMatch;
        const cr = new RegExp(cellRe.source, 'gi');
        while ((cellMatch = cr.exec(rowMatch[1])) !== null) {
          cells.push(stripTags(cellMatch[1]));
        }
        if (cells.length < 2) continue;
        let dateStr = null, dateIdx = -1;
        for (let i = 0; i < cells.length; i++) {
          const dm = cells[i].match(dateRe);
          if (dm) { dateStr = dm[1]; dateIdx = i; break; }
        }
        if (!dateStr) continue;
        const parsed = new Date(dateStr);
        if (isNaN(parsed.getTime()) || parsed < today) continue;
        let name = '';
        for (let i = 0; i < cells.length; i++) {
          if (i === dateIdx) continue;
          if (cells[i].length > 3 && !/^\d/.test(cells[i])) { name = cells[i]; break; }
        }
        if (!name) continue;
        let location = '';
        for (let i = 0; i < cells.length; i++) {
          if (i === dateIdx) continue;
          if (/,\s*[A-Z]{2}/.test(cells[i]) && cells[i] !== name) { location = cells[i]; break; }
        }
        const linkMatch = rowMatch[1].match(hrefRe);
        races.push({
          name, date: toISODate(parsed),
          location: location || 'Kentucky',
          source: 'RaceRise',
          sourceUrl: linkMatch ? new URL(linkMatch[1], RACERISE_URL).href : RACERISE_URL,
        });
      }
    }
  }

  // Strategy 3: list items or cards with dates and race names
  if (races.length === 0) {
    const dateRe = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4})/i;
    const cardRe = /<(?:li|article|div)[^>]*class="[^"]*(?:race|event|card)[^"]*"[^>]*>([\s\S]*?)<\/(?:li|article|div)>/gi;
    while ((m = cardRe.exec(html)) !== null) {
      const text = stripTags(m[1]);
      const dm = text.match(dateRe);
      if (!dm) continue;
      const parsed = new Date(dm[1]);
      if (isNaN(parsed.getTime()) || parsed < today) continue;
      const name = text.replace(dm[0], '').replace(/^[\s\-–|:,]+|[\s\-–|:,]+$/g, '').trim();
      if (name.length < 3) continue;
      const linkMatch = m[1].match(hrefRe);
      races.push({
        name, date: toISODate(parsed), location: 'Kentucky',
        source: 'RaceRise',
        sourceUrl: linkMatch ? new URL(linkMatch[1], RACERISE_URL).href : RACERISE_URL,
      });
    }
  }

  console.log(`Parsed ${races.length} upcoming races from RaceRise`);
  return races;
}


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

  let farRaces = [];
  try {
    farRaces = await fetchFindARace();
  } catch (e) {
    console.warn('FindARace fetch failed:', e.message);
  }

  let johnsRaces = [];
  try {
    johnsRaces = await fetchJohns();
  } catch (e) {
    console.warn("John's fetch failed:", e.message);
  }

  let rrRaces = [];
  try {
    rrRaces = await fetchRaceRise();
  } catch (e) {
    console.warn('RaceRise fetch failed:', e.message);
  }

  let rsRaces = [];
  try {
    rsRaces = await fetchRunSignUp();
  } catch (e) {
    console.warn('RunSignUp fetch failed:', e.message);
  }

  // Merge strategy:
  // 1. Non-UltraSignup manual entries take top priority
  // 2. Fetched UltraSignup entries come next (they have real event IDs / registration links)
  // 3. Manual UltraSignup entries are used as fallbacks when fetch fails
  // 4. Other fetched sources (FrontRunners, RaceRise, FindARace) fill in the rest
  const manualNonUS = manualRaces.filter(r => r.source !== 'UltraSignup');
  const manualUS    = manualRaces.filter(r => r.source === 'UltraSignup');

  const seen = new Set();
  const merged = [];

  for (const r of manualNonUS) {
    const k = normKey(r.name, r.date);
    if (!seen.has(k)) { seen.add(k); merged.push(r); }
  }
  for (const r of ultraRaces) {
    const k = normKey(r.name, r.date);
    if (!seen.has(k)) { seen.add(k); merged.push(r); }
  }
  for (const r of manualUS) {
    const k = normKey(r.name, r.date);
    if (!seen.has(k)) { seen.add(k); merged.push(r); }
  }
  for (const r of [...frRaces, ...rrRaces, ...farRaces, ...rsRaces]) {
    const k = normKey(r.name, r.date);
    if (!seen.has(k)) { seen.add(k); merged.push(r); }
  }

  merged.sort((a, b) => a.date.localeCompare(b.date));

  const ultraSource = { key: 'UltraSignup',     name: 'UltraSignup',              url: 'https://ultrasignup.com/events/search.aspx' };
  const frSource    = { key: 'FrontRunnersLex',  name: 'Front Runners Lexington',  url: FRONTRUNNERS_URL };
  const rrSource    = { key: 'RaceRise',          name: 'RaceRise',                 url: RACERISE_URL };
  const farSource   = { key: 'FindARace',         name: 'FindARace',                url: FINDARACE_URL };
  const rsSource    = { key: 'RunSignUp',         name: 'RunSignUp',                url: 'https://runsignup.com' };
  const sources = manualData.sources
    .filter(s => !['UltraSignup', 'FrontRunnersLex', 'RaceRise', 'FindARace', 'RunSignUp'].includes(s.key))
    .concat(ultraSource, frSource, rrSource, farSource, rsSource);

  const output = {
    lastUpdated: new Date().toISOString().slice(0, 10),
    sources,
    races: merged,
  };

  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(
    `\nWrote races.json — ${merged.length} total races` +
    ` (${manualRaces.length} manual + ${ultraRaces.length} UltraSignup +` +
    ` ${frRaces.length} FrontRunners + ${rrRaces.length} RaceRise + ${farRaces.length} FindARace + ${rsRaces.length} RunSignUp, deduped)`
  );
}

main().catch(e => { console.error(e); process.exit(1); });
