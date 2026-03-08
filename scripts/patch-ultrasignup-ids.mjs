#!/usr/bin/env node
/**
 * patch-ultrasignup-ids.mjs
 *
 * Run this ONCE locally (where UltraSignup is reachable) to replace the
 * #q=... search fallback URLs in races-manual.json with real
 * register.aspx?eid=XXXXX registration links.
 *
 * Usage:
 *   node scripts/patch-ultrasignup-ids.mjs
 *
 * Then commit data/races-manual.json and data/races.json.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT  = new URL('..', import.meta.url).pathname;
const FILE  = join(ROOT, 'data', 'races-manual.json');

const LAT = 37.9927, LNG = -84.1799, RADIUS = 75;

function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

async function fetchIds() {
  const url =
    `https://ultrasignup.com/service/events.svc/geteventsforregistration` +
    `?d=${RADIUS}&lat=${LAT}&lng=${LNG}&virtual=false&future=true`;
  console.log('Fetching UltraSignup...');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, */*',
      'Referer': 'https://ultrasignup.com/events/search.aspx',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  console.log(`Received ${data.length} events from UltraSignup`);
  return data;
}

async function main() {
  const data  = JSON.parse(readFileSync(FILE, 'utf8'));
  const races = data.races;

  const events = await fetchIds();

  // Build lookup: normalised name -> registration URL
  const lookup = new Map();
  for (const ev of events) {
    if (!ev.EventId || !ev.EventName) continue;
    const key = norm(ev.EventName);
    if (!lookup.has(key)) {
      lookup.set(key, `https://ultrasignup.com/register.aspx?eid=${ev.EventId}`);
    }
  }

  let patched = 0, missed = [];
  for (const race of races) {
    if (race.source !== 'UltraSignup') continue;
    const key = norm(race.name);
    if (lookup.has(key)) {
      race.sourceUrl = lookup.get(key);
      patched++;
    } else {
      missed.push(race.name);
    }
  }

  data.lastUpdated = new Date().toISOString().slice(0, 10);
  writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');

  const total = races.filter(r => r.source === 'UltraSignup').length;
  console.log(`\nPatched ${patched} / ${total} UltraSignup entries with real registration links.`);
  if (missed.length) {
    console.log(`Could not match (name may differ on UltraSignup):`);
    missed.forEach(n => console.log(`  - ${n}`));
  }
  console.log('\nNow run:  node scripts/fetch-races.mjs');
}

main().catch(e => { console.error(e.message); process.exit(1); });
