#!/usr/bin/env node
/**
 * update-data.mjs
 *
 * Refreshes data/clubs.json from data/raw-doc.txt (the run club Google Doc export).
 * To pull a fresh copy of the doc automatically, set the env var GOOGLE_DOC_URL
 * to your Google Doc's plain-text export URL:
 *   https://docs.google.com/document/d/YOUR_DOC_ID/export?format=txt
 *
 * Usage:
 *   node scripts/update-data.mjs              # uses existing data/raw-doc.txt
 *   GOOGLE_DOC_URL=https://... node scripts/update-data.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const RAW_FILE = join(ROOT, 'data', 'raw-doc.txt');
const OUT_FILE = join(ROOT, 'data', 'clubs.json');
const GOOGLE_DOC_URL = process.env.GOOGLE_DOC_URL;

// ── fetch raw doc if URL provided ─────────────────────────────────────────────
async function fetchDoc(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching doc`);
  return res.text();
}

// ── parse raw document text ───────────────────────────────────────────────────
function parseDoc(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const schedule = {};
  const groups = [];
  const dailyMeetups = [];

  let section = null; // 'schedule' | 'groups' | 'daily'
  let currentDay = null;
  let pendingEvent = null;

  const dayNames = ['Monday','Mondays','Tuesday','Tuesdays','Wednesday','Wednesdays',
                    'Thursday','Thursdays','Friday','Fridays','Saturday','Saturdays','Sunday','Sundays'];
  const dayMap = { Mondays:'Monday', Tuesdays:'Tuesday', Wednesdays:'Wednesday',
                   Thursdays:'Thursday', Fridays:'Friday', Saturdays:'Saturday', Sundays:'Sunday' };
  const normalize = d => dayMap[d] || d;

  const eventRe = /^(\d{1,2}(?::\d{2})?(?:\s*(?:am|pm|AM|PM))?(?:\s*[-–—]\s*\d{1,2}(?::\d{2})?(?:\s*(?:am|pm|AM|PM))?)?)\s*[-–—]+\s*(.+)/i;
  const urlRe = /^https?:\/\//;
  const groupRe = /^(.+?)\s*[-–—]+\s*$/;

  function pushEvent() {
    if (pendingEvent && currentDay) {
      if (!schedule[currentDay]) schedule[currentDay] = [];
      schedule[currentDay].push(pendingEvent);
      pendingEvent = null;
    }
  }

  for (const line of lines) {
    // detect section headers
    if (/local weekly running schedule/i.test(line)) { section = 'schedule'; currentDay = null; continue; }
    if (/local running groups/i.test(line)) { pushEvent(); section = 'groups'; currentDay = null; continue; }
    if (/daily meetups/i.test(line)) { pushEvent(); section = 'daily'; continue; }
    if (/many of us local runners/i.test(line)) continue;
    if (/want to be added/i.test(line)) continue;

    if (section === 'schedule') {
      // day header
      const dayMatch = dayNames.find(d => line === d);
      if (dayMatch) { pushEvent(); currentDay = normalize(dayMatch); continue; }

      // event line
      const evMatch = line.match(eventRe);
      if (evMatch && currentDay) {
        pushEvent();
        pendingEvent = { time: evMatch[1].trim(), name: evMatch[2].replace(/\s*\(.*?\)$/, '').trim() };
        const notes = evMatch[2].match(/\((.+?)\)$/);
        if (notes) pendingEvent.notes = notes[1];
        continue;
      }

      // location line
      if (pendingEvent && /^Location:/i.test(line)) {
        pendingEvent.location = line.replace(/^Location:\s*/i, '').trim();
        continue;
      }

      // URL line
      if (pendingEvent && urlRe.test(line)) {
        if (!pendingEvent.mapUrl) pendingEvent.mapUrl = line;
        else pendingEvent.websiteUrl = line;
        continue;
      }
    }

    if (section === 'groups') {
      // URL-only line (possibly pipe-separated: "https://fb.com/... | example.com")
      if (urlRe.test(line)) {
        if (groups.length > 0) {
          const g = groups[groups.length - 1];
          const parts = line.split(/\s*[|&]\s*/).map(s => s.trim()).filter(Boolean);
          for (const part of parts) {
            const url = urlRe.test(part) ? part : `https://${part}`;
            if (!g.url) g.url = url;
            else if (!g.url2) g.url2 = url;
          }
        }
        continue;
      }
      // group name line: "Name - org -" or "Name -" or "Name - org - https://..."
      const gm = line.match(/^(.+?)\s*[-–—]+\s*(.*)$/);
      if (gm) {
        const name = gm[1].trim();
        // Split rest on " - " to separate org text from any inline URLs
        const restParts = gm[2].split(/\s*[-–—]+\s*/);
        // Org is the first part if it doesn't start with http
        const orgPart = !urlRe.test(restParts[0]) ? restParts.shift().trim() : '';
        const entry = { name };
        // Clean trailing dash artifacts from org
        const cleanOrg = orgPart.replace(/\s*[-–—]+\s*$/, '').trim();
        if (cleanOrg) entry.org = cleanOrg;
        // Remaining parts may contain URLs or "url & url2" patterns
        for (const part of restParts) {
          const subParts = part.split(/\s*[|&]\s*/).map(s => s.trim()).filter(Boolean);
          for (const sub of subParts) {
            const url = urlRe.test(sub) ? sub : (sub.includes('.') ? `https://${sub}` : null);
            if (!url) continue;
            if (!entry.url) entry.url = url;
            else if (!entry.url2) entry.url2 = url;
          }
        }
        groups.push(entry);
      }
    }

    if (section === 'daily') {
      // Skip headers
      if (/^(John|MoCo|Ben |Tommy)/i.test(line)) {
        const parts = line.split(/\s+at\s+|\s+meet\s+|\s+runs\s+/i);
        dailyMeetups.push({
          who: parts[0]?.trim() || line,
          when: 'See details',
          where: parts[1]?.trim() || 'Lexington area'
        });
      }
    }
  }

  pushEvent(); // flush last event

  const weeklyEventCount = Object.values(schedule).reduce((s, arr) => s + arr.length, 0);

  return {
    lastUpdated: new Date().toISOString().slice(0, 10),
    totals: {
      weeklyEvents: weeklyEventCount,
      groups: groups.length,
      dailyMeetups: dailyMeetups.length
    },
    weeklySchedule: schedule,
    groups,
    dailyMeetups
  };
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  let rawText;

  if (GOOGLE_DOC_URL) {
    console.log('Fetching Google Doc…');
    try {
      rawText = await fetchDoc(GOOGLE_DOC_URL);
      writeFileSync(RAW_FILE, rawText, 'utf8');
      console.log('Saved raw-doc.txt');
    } catch (e) {
      console.warn('Fetch failed, falling back to raw-doc.txt:', e.message);
    }
  }

  if (!rawText) {
    if (!existsSync(RAW_FILE)) {
      console.error('No raw-doc.txt and no GOOGLE_DOC_URL set. Nothing to parse.');
      process.exit(1);
    }
    rawText = readFileSync(RAW_FILE, 'utf8');
    console.log('Parsing existing raw-doc.txt…');
  }

  const data = parseDoc(rawText);
  writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\nWrote clubs.json — ${data.totals.weeklyEvents} weekly events, ${data.totals.groups} groups, ${data.totals.dailyMeetups} daily meetups`);
}

main().catch(e => { console.error(e); process.exit(1); });
