'use strict';

const CLUBS_URL = './clubs.json';
const RACES_URL = './races.json';
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TODAY = new Date();
const state = { filter: 'all', dist: 'all', query: '' };

// ── helpers ───────────────────────────────────────────────────────────────────
function todayDayName() {
  return DAYS[TODAY.getDay() === 0 ? 6 : TODAY.getDay() - 1];
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Safe: escapes each piece individually before wrapping in <mark>
function highlightText(text, query) {
  if (!query || !text) return esc(String(text ?? ''));
  const parts = [];
  let src = String(text);
  const lq = query.toLowerCase();
  while (src.length > 0) {
    const idx = src.toLowerCase().indexOf(lq);
    if (idx === -1) { parts.push(esc(src)); break; }
    if (idx > 0) parts.push(esc(src.slice(0, idx)));
    parts.push(`<mark class="highlight">${esc(src.slice(idx, idx + query.length))}</mark>`);
    src = src.slice(idx + query.length);
  }
  return parts.join('');
}

function daysUntil(dateStr) {
  const today = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  return Math.round((parseDate(dateStr) - today) / 86400000);
}

function countdownLabel(days) {
  if (days === 0) return '<span class="race-countdown countdown-today">Today!</span>';
  if (days === 1) return '<span class="race-countdown countdown-soon">Tomorrow</span>';
  if (days <= 7) return `<span class="race-countdown countdown-soon">In ${days} days</span>`;
  if (days <= 14) return `<span class="race-countdown countdown-near">In ${days} days</span>`;
  return '';
}

// ── weekly schedule overrides (Supabase backend) ──────────────────────────────
const REPORT_EMAIL  = 'thomaswestonadams@gmail.com';
const SUPABASE_URL  = 'https://bqqvlwakrwumppcsaxvj.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxcXZsd2Frcnd1bXBwY3NheHZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MjE2NzUsImV4cCI6MjA4ODk5NzY3NX0.gJwKF8bAH0nIBzKbP117R05cIwpgq8To9jsnVjbJFgo';

function weekOf(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); // Monday
  return d.toISOString().slice(0, 10);
}

async function loadOverrides() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/schedule_overrides?week_of=eq.${weekOf()}&select=*`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map(r => ({
      day: r.day, name: r.name, weekOf: r.week_of, type: r.type,
      ...(r.new_time     && { newTime:     r.new_time }),
      ...(r.new_location && { newLocation: r.new_location }),
      ...(r.notes        && { notes:       r.notes }),
    }));
  } catch { return []; }
}

async function saveOverride(override) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/schedule_overrides`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        day: override.day, name: override.name, week_of: override.weekOf,
        type: override.type,
        new_time:     override.newTime     || null,
        new_location: override.newLocation || null,
        notes:        override.notes       || null,
      }),
    });
  } catch { /* ignore */ }
}

async function checkUrlOverride() {
  const wc = new URLSearchParams(location.search).get('wc');
  if (!wc) return;
  try {
    const override = JSON.parse(atob(wc));
    if (override?.day && override?.name && override?.weekOf) {
      await saveOverride(override);
      const url = new URL(location.href);
      url.searchParams.delete('wc');
      history.replaceState(null, '', url.toString());
    }
  } catch { /* ignore */ }
}

function applyOverrideBadge(card, override, cancelClass) {
  card.querySelectorAll('.override-badge').forEach(b => b.remove());
  const badge = document.createElement('div');
  badge.className = `override-badge override-badge--${override.type}`;
  const typeLabel = {
    cancelled: '✕ CANCELLED THIS WEEK',
    time:      `⏰ Time changed: ${override.newTime || ''}`,
    location:  `📍 Location changed: ${override.newLocation || ''}`,
    other:     '⚠️ Schedule update this week',
  }[override.type] || '⚠️ Schedule update this week';
  badge.textContent = override.notes ? `${typeLabel} — ${override.notes}` : typeLabel;
  card.prepend(badge);
  if (override.type === 'cancelled') card.classList.add(cancelClass);
}

async function applyOverrides(grid) {
  const todayName = todayDayName();
  const banner = document.getElementById('todays-promo');
  const overrides = await loadOverrides();

  overrides.forEach(override => {
      // Weekly calendar
      grid.querySelectorAll('.day-column').forEach(col => {
        if (col.dataset.day !== override.day) return;
        col.querySelectorAll('.event-card').forEach(card => {
          if (card.dataset.eventName !== override.name) return;
          applyOverrideBadge(card, override, 'event-card--cancelled');
        });
      });

      // Today's promo banner
      if (banner && override.day === todayName) {
        banner.querySelectorAll('.promo-card').forEach(card => {
          if (card.dataset.eventName !== override.name) return;
          applyOverrideBadge(card, override, 'promo-card--cancelled');
        });
      }
    });
}

let _overrideTarget = null;
let _overrideModalReady = false;
let _schedule = {};

function closeReportModal() {
  document.getElementById('override-modal').classList.remove('is-open');
}

function openReportModal() {
  _overrideTarget = null;

  // Populate day dropdown from days that have events
  const daySelect = document.getElementById('override-day');
  daySelect.innerHTML = '<option value="">Select a day…</option>';
  DAYS.forEach(day => {
    if ((_schedule[day] || []).length > 0) {
      const opt = document.createElement('option');
      opt.value = day;
      opt.textContent = day;
      daySelect.appendChild(opt);
    }
  });

  // Reset club + details
  document.getElementById('override-club').innerHTML = '<option value="">Select a run…</option>';
  document.getElementById('override-club-row').classList.add('is-hidden');
  document.getElementById('override-details-row').classList.add('is-hidden');
  document.getElementById('override-type').value = 'cancelled';
  document.getElementById('override-newtime-row').classList.add('is-hidden');
  document.getElementById('override-newlocation-row').classList.add('is-hidden');
  document.getElementById('override-newtime').value = '';
  document.getElementById('override-newlocation').value = '';
  document.getElementById('override-notes').value = '';

  document.getElementById('override-modal').classList.add('is-open');
}

function setupOverrideModal(grid) {
  // Fire async ops without blocking — listeners set up synchronously below
  checkUrlOverride().then(() => applyOverrides(grid));

  // Only wire up listeners once
  if (_overrideModalReady) return;
  _overrideModalReady = true;

  const modal = document.getElementById('override-modal');
  if (!modal) return;

  document.getElementById('override-modal-close').addEventListener('click', closeReportModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeReportModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeReportModal(); });

  document.getElementById('open-report-modal').addEventListener('click', openReportModal);

  const daySelect  = document.getElementById('override-day');
  const clubSelect = document.getElementById('override-club');

  daySelect.addEventListener('change', () => {
    const day = daySelect.value;
    clubSelect.innerHTML = '<option value="">Select a run…</option>';
    document.getElementById('override-club-row').classList.toggle('is-hidden', !day);
    document.getElementById('override-details-row').classList.add('is-hidden');
    _overrideTarget = null;
    if (!day) return;
    (_schedule[day] || []).forEach(ev => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ name: ev.name, time: ev.time });
      opt.textContent = `${ev.name} — ${ev.time}`;
      clubSelect.appendChild(opt);
    });
  });

  clubSelect.addEventListener('change', () => {
    if (!clubSelect.value) {
      document.getElementById('override-details-row').classList.add('is-hidden');
      _overrideTarget = null;
      return;
    }
    const { name, time } = JSON.parse(clubSelect.value);
    _overrideTarget = { day: daySelect.value, name, time };
    document.getElementById('override-details-row').classList.remove('is-hidden');
  });

  const typeSelect = document.getElementById('override-type');
  typeSelect.addEventListener('change', () => {
    document.getElementById('override-newtime-row').classList.toggle('is-hidden',     typeSelect.value !== 'time');
    document.getElementById('override-newlocation-row').classList.toggle('is-hidden', typeSelect.value !== 'location');
  });

  document.getElementById('override-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!_overrideTarget) return;
    const target      = _overrideTarget; // capture before async ops
    const type        = typeSelect.value;
    const newTime     = document.getElementById('override-newtime').value.trim();
    const newLocation = document.getElementById('override-newlocation').value.trim();
    const notes       = document.getElementById('override-notes').value.trim();

    const override = {
      day: target.day, name: target.name, weekOf: weekOf(),
      type, reportedAt: new Date().toISOString(),
      ...(newTime && { newTime }), ...(newLocation && { newLocation }), ...(notes && { notes }),
    };

    await saveOverride(override);
    await applyOverrides(document.getElementById('weekly-calendar'));
    closeReportModal();
    _overrideTarget = null;

    // Build mailto so the reporter can optionally notify the admin directly
    const changeDesc = type === 'cancelled' ? 'Cancelled this week'
      : type === 'time'     ? `Time changed to ${newTime}`
      : type === 'location' ? `Location changed to ${newLocation}`
      : 'Other schedule update';
    const body = [
      `A one-time schedule change was reported on Running in Kentucky:`,
      ``,
      `Club: ${target.name}`,
      `Day:  ${target.day}`,
      `Week: ${override.weekOf}`,
      `Change: ${changeDesc}`,
      notes ? `Notes: ${notes}` : '',
      ``,
      `The change is now live on the site for all visitors.`,
    ].filter(l => l !== undefined).join('\n');
    const subject = `[Running in KY] Change reported: ${target.name} — ${target.day}`;
    const mailtoUrl = `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    const a = document.createElement('a');
    a.href = mailtoUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}

// ── calendar helpers ──────────────────────────────────────────────────────────
const calPad = n => String(n).padStart(2, '0');

function raceCalData(r) {
  const d    = parseDate(r.date);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  const fmt  = d2 => `${d2.getFullYear()}${calPad(d2.getMonth()+1)}${calPad(d2.getDate())}`;
  return {
    name: r.name, location: r.location, allDay: true,
    dateStart: fmt(d), dateEnd: fmt(next),
    notes: r.notes || '', url: r.sourceUrl || '',
  };
}

function clubCalData(dayName, ev) {
  const dayIdx   = DAYS.indexOf(dayName);
  const todayIdx = TODAY.getDay() === 0 ? 6 : TODAY.getDay() - 1;
  let daysAhead  = ((dayIdx - todayIdx) + 7) % 7;
  const { h, m } = parseClubTime(ev.time);
  if (daysAhead === 0) {
    const runTime = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), h, m);
    if (runTime <= new Date()) daysAhead = 7;
  }
  const base = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + daysAhead);
  const dt   = (hh, mm) => `${base.getFullYear()}${calPad(base.getMonth()+1)}${calPad(base.getDate())}T${calPad(hh)}${calPad(mm)}00`;
  const notes = [ev.time, ev.location, ev.address, ev.notes,
    ev.mapUrl ? `Map: ${ev.mapUrl}` : '',
    'Check with the club for last-minute changes.']
    .filter(Boolean).join('\n');
  return {
    name: ev.name, location: ev.location || '', allDay: false,
    dateStart: dt(h, m), dateEnd: dt(h + 1, m),
    notes, url: ev.websiteUrl || '',
  };
}

function buildCalUrls({ name, dateStart, dateEnd, location, notes, url, allDay }) {
  const bodyText = [notes, url].filter(Boolean).join('\n');
  const toIso = s => allDay
    ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`
    : `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:00`;

  const gcal = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeURIComponent(name)}&dates=${dateStart}/${dateEnd}`
    + `&location=${encodeURIComponent(location)}&details=${encodeURIComponent(bodyText)}`;

  const outlook = 'https://outlook.live.com/calendar/0/deeplink/compose'
    + `?subject=${encodeURIComponent(name)}`
    + `&startdt=${toIso(dateStart)}&enddt=${toIso(dateEnd)}`
    + `&location=${encodeURIComponent(location)}&body=${encodeURIComponent(bodyText)}`
    + '&path=%2Fcalendar%2Faction%2Fcompose&rru=addevent';

  const uid = `${dateStart}-${name.replace(/\W+/g,'-')}@runninginkentucky`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Running in Kentucky//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${uid}`,
    allDay ? `DTSTART;VALUE=DATE:${dateStart}` : `DTSTART:${dateStart}`,
    allDay ? `DTEND;VALUE=DATE:${dateEnd}`   : `DTEND:${dateEnd}`,
    `SUMMARY:${name}`,
    ...(location ? [`LOCATION:${location}`] : []),
    ...(bodyText ? [`DESCRIPTION:${bodyText.replace(/\n/g,'\\n')}`] : []),
    ...(url ? [`URL:${url}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');

  return { gcal, outlook, ics };
}

let _calPickerEl = null;

function closeCalPicker() {
  if (_calPickerEl) { _calPickerEl.remove(); _calPickerEl = null; }
}

function calTriggerAttrs(data) {
  return `class="btn btn-icon cal-trigger" data-name="${esc(data.name)}" `
    + `data-date-start="${esc(data.dateStart)}" data-date-end="${esc(data.dateEnd)}" `
    + `data-location="${esc(data.location)}" data-notes="${esc(data.notes)}" `
    + `data-url="${esc(data.url)}" data-allday="${data.allDay}" `
    + `title="Add to calendar" aria-label="Add to calendar"`;
}

function setupCalPickers(container) {
  if (!document._calPickerReady) {
    document.addEventListener('click', closeCalPicker);
    document._calPickerReady = true;
  }
  container.querySelectorAll('.cal-trigger').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      closeCalPicker();
      const { gcal, outlook, ics } = buildCalUrls({
        name:      btn.dataset.name      || '',
        dateStart: btn.dataset.dateStart || '',
        dateEnd:   btn.dataset.dateEnd   || '',
        location:  btn.dataset.location  || '',
        notes:     btn.dataset.notes     || '',
        url:       btn.dataset.url       || '',
        allDay:    btn.dataset.allday    === 'true',
      });
      const drop = document.createElement('div');
      drop.className = 'cal-drop';
      drop.innerHTML = `
        <a class="cal-opt" href="${esc(gcal)}"    target="_blank" rel="noopener">Google Calendar</a>
        <button class="cal-opt cal-ics-btn" type="button">Apple Calendar</button>
        <a class="cal-opt" href="${esc(outlook)}" target="_blank" rel="noopener">Outlook</a>`;
      drop.querySelector('.cal-ics-btn').addEventListener('click', () => {
        const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
        const a    = Object.assign(document.createElement('a'), {
          href:     URL.createObjectURL(blob),
          download: (btn.dataset.name||'event').replace(/[^\w\s-]/g,'').replace(/\s+/g,'-').toLowerCase()+'.ics',
        });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        closeCalPicker();
      });
      document.body.appendChild(drop);
      _calPickerEl = drop;
      const rect = btn.getBoundingClientRect();
      const dropW = 195;
      let left = rect.left + window.scrollX;
      if (left + dropW > window.innerWidth - 8) left = window.innerWidth - dropW - 8;
      drop.style.top  = `${rect.bottom + window.scrollY + 4}px`;
      drop.style.left = `${Math.max(8, left)}px`;
    });
  });
}

function parseClubTime(timeStr) {
  // Returns { h, m } in 24-hour. Handles "6:00 pm", "730am", "5:30-7", "7:00am & 8:00am", etc.
  if (!timeStr) return { h: 7, m: 0 };
  const s = timeStr.toLowerCase();
  const startPart = s.split(/\s*[-–]\s*/)[0].split(/\s*&\s*/)[0].trim();
  const isPm = /pm/.test(startPart);
  const isAm = /am/.test(startPart);
  const digits = startPart.replace(/[^0-9:]/g, '');
  let h, m;
  if (digits.includes(':')) {
    [h, m] = digits.split(':').map(Number);
  } else if (digits.length <= 2) {
    h = Number(digits); m = 0;
  } else {
    h = Number(digits.slice(0, -2)); m = Number(digits.slice(-2));
  }
  if (isPm && h < 12) h += 12;
  else if (isAm && h === 12) h = 0;
  else if (!isPm && !isAm && h < 9) h += 12; // e.g. "5:30-7" or "6:00-7" are evening runs
  return { h: h || 7, m: m || 0 };
}

// gcalClubUrl replaced by clubCalData + buildCalUrls + calTriggerAttrs

function parseDistances(notes) {
  if (!notes) return [];
  const t = notes.toLowerCase();
  const out = [];
  if (/\b5k\b/.test(t)) out.push('5K');
  if (/\b10k\b/.test(t)) out.push('10K');
  // Match "Half Marathon", "1/2 Marathon", "13.1", or standalone "Half"
  if (/half.?marathon|1\/2.?\s*marathon|13\.1|\bhalf\b/.test(t)) out.push('Half');
  // Match full marathon: strip half-marathon phrases first so "1/2 Marathon" doesn't count
  const noHalf = t.replace(/(?:half|1\/2).?\s*marathon/g, '');
  if (/\bmarathon\b|26\.2/.test(noHalf) && !/\b(ultra|50k|100k|50m|100m)\b/.test(noHalf)) out.push('Marathon');
  if (/\b(50k|100k|100m|50m|ultra|backyard|endurance)\b/.test(t)) out.push('Ultra');
  return out;
}

// ── today's promo banner ──────────────────────────────────────────────────────
function renderTodaysBanner(schedule) {
  const banner = document.getElementById('todays-promo');
  if (!banner) return;
  const todayName = todayDayName();
  const events = schedule[todayName] || [];

  if (events.length === 0) {
    banner.hidden = true;
    return;
  }

  const cards = events.map(ev => {
    const links = [];
    if (ev.mapUrl) links.push(`<a href="${esc(ev.mapUrl)}" class="btn btn-map" target="_blank" rel="noopener">Map</a>`);
    if (ev.websiteUrl) links.push(`<a href="${esc(ev.websiteUrl)}" class="btn btn-link" target="_blank" rel="noopener">Website</a>`);
    links.push(`<button ${calTriggerAttrs(clubCalData(todayName, ev))}>📅</button>`);
    return `
      <div class="promo-card" data-event-name="${esc(ev.name)}">
        <div class="promo-card-time">${esc(ev.time)}</div>
        <div class="promo-card-name">${esc(ev.name)}</div>
        <div class="promo-card-location">${ev.mapUrl ? `<a href="${esc(ev.mapUrl)}" class="promo-location-link" target="_blank" rel="noopener">${esc(ev.location)}</a>` : esc(ev.location)}</div>
        ${ev.notes ? `<div class="promo-card-notes">${esc(ev.notes)}</div>` : ''}
        ${links.length ? `<div class="promo-card-links">${links.join('')}</div>` : ''}
      </div>`;
  }).join('');

  banner.innerHTML = `
    <div class="promo-inner">
      <div class="promo-header">
        <div class="promo-tag">${esc(todayName)}</div>
        <h3 class="promo-headline">Want to run with a club today?</h3>
        <p class="promo-sub">${events.length} club run${events.length !== 1 ? 's' : ''} happening today</p>
      </div>
      <div class="promo-cards">${cards}</div>
    </div>`;
  banner.hidden = false;
  setupCalPickers(banner);
}

// ── render weekly calendar ────────────────────────────────────────────────────
function renderCalendar(schedule) {
  _schedule = schedule;
  const grid = document.getElementById('weekly-calendar');
  const todayName = todayDayName();
  grid.innerHTML = '';

  DAYS.forEach(day => {
    const events = schedule[day] || [];
    const isToday = day === todayName;

    const col = document.createElement('div');
    col.className = 'day-column';
    col.dataset.day = day;
    col.innerHTML = `<div class="day-header ${isToday ? 'today' : ''}">${day}${isToday ? ' ★' : ''}</div>`;

    if (events.length === 0) {
      col.innerHTML += `<div class="day-empty">No events</div>`;
    } else {
      const eventsDiv = document.createElement('div');
      eventsDiv.className = 'day-events';

      events.forEach(ev => {
        const links = [];
        if (ev.mapUrl) links.push(`<a href="${esc(ev.mapUrl)}" class="btn btn-map" target="_blank" rel="noopener">Map</a>`);
        if (ev.websiteUrl) links.push(`<a href="${esc(ev.websiteUrl)}" class="btn btn-link" target="_blank" rel="noopener">Website</a>`);
        links.push(`<button ${calTriggerAttrs(clubCalData(day, ev))}>📅</button>`);

        const card = document.createElement('div');
        card.className = 'event-card';
        card.dataset.eventName = ev.name;
        card.dataset.search = [ev.name, ev.location, ev.address, ev.notes].filter(Boolean).join(' ').toLowerCase();
        card.innerHTML = `
          <div class="event-time">${esc(ev.time)}</div>
          <div class="event-name">${esc(ev.name)}</div>
          <div class="event-location">${ev.mapUrl ? `<a href="${esc(ev.mapUrl)}" class="location-link" target="_blank" rel="noopener">${esc(ev.location)}${ev.address ? ` · ${esc(ev.address)}` : ''}</a>` : `${esc(ev.location)}${ev.address ? ` · ${esc(ev.address)}` : ''}`}</div>
          ${ev.notes ? `<div class="event-notes">${esc(ev.notes)}</div>` : ''}
          ${links.length ? `<div class="event-links">${links.join('')}</div>` : ''}
        `;
        eventsDiv.appendChild(card);
      });

      col.appendChild(eventsDiv);
    }

    grid.appendChild(col);
  });

  setupCalPickers(grid);
  setupOverrideModal(grid);
}

// ── render groups ─────────────────────────────────────────────────────────────
function renderGroups(groups) {
  const grid = document.getElementById('groups-grid');
  grid.innerHTML = '';

  groups.forEach(g => {
    const links = [];
    if (g.url) links.push(`<a href="${esc(g.url)}" class="btn btn-map" target="_blank" rel="noopener">Facebook</a>`);
    if (g.url2) links.push(`<a href="${esc(g.url2)}" class="btn btn-map" target="_blank" rel="noopener">Group</a>`);
    if (g.websiteUrl) links.push(`<a href="${esc(g.websiteUrl)}" class="btn btn-link" target="_blank" rel="noopener">Website</a>`);

    const card = document.createElement('div');
    card.className = 'group-card';
    card.dataset.search = [g.name, g.org, g.area, g.notes].filter(Boolean).join(' ').toLowerCase();
    card.innerHTML = `
      <div class="group-name">${esc(g.name)}</div>
      ${g.org ? `<div class="group-org">${esc(g.org)}</div>` : ''}
      ${g.area ? `<div class="group-area">📍 ${esc(g.area)}</div>` : ''}
      ${g.notes ? `<div class="group-notes">${esc(g.notes)}</div>` : ''}
      ${links.length ? `<div class="group-links">${links.join('')}</div>` : ''}
    `;
    grid.appendChild(card);
  });
}

// ── render daily meetups ──────────────────────────────────────────────────────
function renderDaily(meetups) {
  const list = document.getElementById('daily-meetups');
  // Separate Tommy's entry so it gets a personal note treatment
  const others = meetups.filter(m => !m.who.toLowerCase().includes('tommy adams'));
  const tommy  = meetups.find(m => m.who.toLowerCase().includes('tommy adams'));

  const cards = others.map(m => `
    <div class="daily-card">
      <div class="daily-who">${esc(m.who)}</div>
      <div class="daily-where">📍 ${esc(m.where)}</div>
    </div>
  `).join('');

  const tommyNote = tommy ? `
    <div class="daily-personal-note" style="grid-column:1/-1">
      <p>I run every single day, and I know that it's almost always better with company.</p>
      <p>Want to go for a run? I would love to run with you.</p>
      <p class="daily-personal-contact">— <a href="https://www.strava.com/athletes/tommyadams" target="_blank" rel="noopener">Tommy Adams</a></p>
    </div>
  ` : '';

  list.innerHTML = cards + tommyNote;
}

// ── weekend callout ───────────────────────────────────────────────────────────
function renderWeekendCallout(races) {
  const el = document.getElementById('weekend-callout');
  if (!el) return;

  const soon = races
    .map(r => ({ ...r, days: daysUntil(r.date) }))
    .filter(r => r.days >= 0 && r.days <= 7)
    .sort((a, b) => a.days - b.days);

  if (soon.length === 0) { el.hidden = true; return; }

  const items = soon.map(r => {
    const d = parseDate(r.date);
    const label = r.days === 0 ? 'Today' : r.days === 1 ? 'Tomorrow' : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    return `<a href="${esc(r.sourceUrl)}" class="weekend-item" target="_blank" rel="noopener">
      <span class="weekend-item-when">${label}</span>
      <span class="weekend-item-name">${esc(r.name)}</span>
      <span class="weekend-item-loc">📍 ${esc(r.location)}</span>
    </a>`;
  }).join('');

  el.hidden = false;
  el.innerHTML = `
    <div class="weekend-header">
      <span>📅</span>
      <strong>Happening this week</strong>
      <span class="weekend-count">${soon.length} race${soon.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="weekend-items">${items}</div>
  `;
}

// ── render races ──────────────────────────────────────────────────────────────
function raceCardHTML(r, q) {
  const d = parseDate(r.date);
  const days = daysUntil(r.date);
  const cal = raceCalData(r);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.location)}`;
  const distances = parseDistances(r.notes);
  const distBadges = distances.map(dist => `<span class="dist-badge">${dist}</span>`).join('');
  return `
    <div class="race-card" data-source="${esc(r.source)}" data-location="${esc(r.location)}" data-name="${esc(r.name)}">
      <div class="race-date-block">
        <div class="race-date-month">${MONTHS[d.getMonth()]}</div>
        <div class="race-date-day">${d.getDate()}</div>
      </div>
      <div class="race-info">
        <div class="race-name">${highlightText(r.name, q)}</div>
        <div class="race-meta">
          <a href="${mapsUrl}" class="race-location" target="_blank" rel="noopener" title="Open in Google Maps">📍 ${highlightText(r.location, q)}</a>
          ${distBadges}
          ${countdownLabel(days)}
        </div>
        ${r.notes ? `<div class="race-notes">${highlightText(r.notes, q)}</div>` : ''}
      </div>
      <div class="race-actions">
        <a href="${esc(r.sourceUrl)}" class="btn btn-map" target="_blank" rel="noopener">Details →</a>
        <button ${calTriggerAttrs(cal)}>📅</button>
        <button class="btn btn-icon btn-share" data-name="${esc(r.name)}" title="Copy link to this race" aria-label="Copy link to this race">🔗</button>
      </div>
    </div>
  `;
}

function setupShareBtns(container) {
  container.querySelectorAll('.btn-share').forEach(btn => {
    btn.addEventListener('click', () => {
      const base = window.location.href.split('?')[0];
      const shareUrl = `${base}?race=${encodeURIComponent(btn.dataset.name)}`;
      const copy = () => navigator.clipboard.writeText(shareUrl).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }).catch(() => prompt('Copy this link:', shareUrl));
      if (navigator.share) {
        navigator.share({ title: btn.dataset.name, url: shareUrl }).catch(copy);
      } else {
        copy();
      }
    });
  });
}

function renderRaces(races) {
  const list = document.getElementById('races-list');
  const today = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  const q = state.query;

  let filtered = races.filter(r => parseDate(r.date) >= today);

  if (state.filter === 'lexington') {
    filtered = filtered.filter(r => r.location.toLowerCase().includes('lexington'));
  } else if (state.filter === 'johns') {
    filtered = filtered.filter(r => r.source === 'Johns');
  } else if (state.filter === 'ultrasignup') {
    filtered = filtered.filter(r => r.source === 'UltraSignup');
  }

  if (state.dist !== 'all') {
    filtered = filtered.filter(r => parseDistances(r.notes).includes(state.dist));
  }

  if (q) {
    filtered = filtered.filter(r =>
      [r.name, r.location, r.source, r.notes].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="no-results">No upcoming races found for this filter.</div>';
    return;
  }

  filtered.sort((a, b) => parseDate(a.date) - parseDate(b.date));

  // Show the next 3 months by default; reveal the rest on demand
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() + 3);
  const visible = filtered.filter(r => parseDate(r.date) <= cutoff);
  const hidden  = filtered.filter(r => parseDate(r.date) >  cutoff);

  list.innerHTML = visible.map(r => raceCardHTML(r, q)).join('');

  if (hidden.length > 0) {
    const cutoffLabel = cutoff.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary races-show-more';
    btn.textContent = `Show ${hidden.length} more race${hidden.length !== 1 ? 's' : ''} after ${cutoffLabel}`;
    btn.addEventListener('click', () => {
      btn.remove();
      list.insertAdjacentHTML('beforeend', hidden.map(r => raceCardHTML(r, q)).join(''));
      setupShareBtns(list);
      setupCalPickers(list);
    });
    list.appendChild(btn);
  }

  setupShareBtns(list);
  setupCalPickers(list);

  // Deep link: scroll to and highlight a specific race
  const target = new URLSearchParams(window.location.search).get('race');
  if (target) {
    const card = list.querySelector(`[data-name="${esc(target)}"]`);
    if (card) {
      card.classList.add('race-card--linked');
      setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
    }
  }
}

// ── ICS export ────────────────────────────────────────────────────────────────
function exportICS(races) {
  const today = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Running in Kentucky//Race Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Running in Kentucky Races',
    'X-WR-TIMEZONE:America/New_York',
  ];

  races
    .filter(r => parseDate(r.date) >= today)
    .sort((a, b) => parseDate(a.date) - parseDate(b.date))
    .forEach(r => {
      const d = parseDate(r.date);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const desc = [r.notes, r.sourceUrl].filter(Boolean).join('\\n');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${r.date}-${r.name.replace(/\W+/g, '-')}@runninginkentucky`,
        `DTSTART;VALUE=DATE:${ymd(d)}`,
        `DTEND;VALUE=DATE:${ymd(next)}`,
        `SUMMARY:${r.name}`,
        `LOCATION:${r.location}`,
        ...(desc ? [`DESCRIPTION:${desc}`] : []),
        `URL:${r.sourceUrl}`,
        'END:VEVENT',
      );
    });

  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'running-in-kentucky-races.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── filter & search ───────────────────────────────────────────────────────────
function applyFilters(races) {
  const q = state.query;

  document.querySelectorAll('.event-card, .group-card').forEach(card => {
    card.classList.toggle('hidden', q.length > 0 && !card.dataset.search.includes(q));
  });

  renderRaces(races);
}

function setupSearch(races) {
  const input = document.getElementById('search-input');

  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      e.preventDefault();
      input.focus();
      input.select();
    }
    if (e.key === 'Escape' && document.activeElement === input) {
      input.value = '';
      state.query = '';
      applyFilters(races);
      input.blur();
    }
  });

  input.addEventListener('input', () => {
    state.query = input.value.trim().toLowerCase();
    applyFilters(races);
  });
}

function setupRaceFilters(races) {
  document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      renderRaces(races);
    });
  });

  document.querySelectorAll('.filter-btn[data-dist]').forEach(btn => {
    btn.addEventListener('click', () => {
      const already = state.dist === btn.dataset.dist;
      document.querySelectorAll('.filter-btn[data-dist]').forEach(b => b.classList.remove('active'));
      state.dist = already ? 'all' : btn.dataset.dist;
      if (!already) btn.classList.add('active');
      renderRaces(races);
    });
  });

  const exportBtn = document.getElementById('export-ics');
  if (exportBtn) exportBtn.addEventListener('click', () => exportICS(races));
}

// ── theme switcher ────────────────────────────────────────────────────────────
const THEMES = [
  { id: '',       icon: '🌿', label: 'Kentucky' },
  { id: 'strava', icon: '🟠', label: 'Strava'   },
  { id: 'garmin', icon: '🔵', label: 'Garmin'   },
];

function setupDarkMode() {
  const btn = document.getElementById('dark-mode-toggle');
  if (!btn) return;

  // If they had saved 'dark' or 'kentucky-dark', fall back to default Kentucky
  const saved = localStorage.getItem('rik-theme') ?? '';
  const validIds = THEMES.map(t => t.id);
  let idx = validIds.includes(saved) ? THEMES.findIndex(t => t.id === saved) : 0;
  if (idx === -1) idx = 0;

  const apply = i => {
    const theme = THEMES[i];
    if (theme.id) {
      document.documentElement.dataset.theme = theme.id;
    } else {
      delete document.documentElement.dataset.theme;
    }
    btn.innerHTML = `${theme.icon} <span class="theme-btn-label">${theme.label}</span>`;
    btn.setAttribute('title', `Theme: ${theme.label} — click to cycle`);
    btn.setAttribute('aria-label', `Current theme: ${theme.label}`);
    localStorage.setItem('rik-theme', theme.id);
  };

  apply(idx);

  btn.addEventListener('click', () => {
    idx = (idx + 1) % THEMES.length;
    apply(idx);
  });

  // Theme hint banner — show once, dismiss permanently
  const hint = document.getElementById('theme-hint');
  const hintClose = document.getElementById('theme-hint-close');
  if (hint) {
    if (localStorage.getItem('rik-hint-dismissed')) {
      hint.classList.add('hidden');
    }
    hintClose?.addEventListener('click', () => {
      hint.classList.add('hidden');
      localStorage.setItem('rik-hint-dismissed', '1');
    });
  }
}

// ── music player ──────────────────────────────────────────────────────────────
const PLAYLIST = [
  { src: 'The Distance.mp3',                          title: 'The Distance',        artist: 'Cake' },
  { src: 'Matt Nathanson - Long Distance Runner.mp3', title: 'Long Distance Runner', artist: 'Matt Nathanson' },
  { src: 'OneRepublic - Run.mp3',                     title: 'Run',                  artist: 'OneRepublic' },
  { src: 'Song for Walking.mp3',                      title: 'Song for Walking',     artist: 'Tophouse' },
  { src: 'WALK THE MOON - One Foot.mp3',              title: 'One Foot',             artist: 'Walk the Moon' },
  { src: "Dont Stop Me Now.mp3",                      title: "Don't Stop Me Now",    artist: 'Queen' },
  { src: 'King Charles - Bam Bam.mp3',                title: 'Bam Bam',              artist: 'King Charles' },
  { src: 'Bleachers - Rollercoaster.mp3',             title: 'Rollercoaster',        artist: 'Bleachers' },
  { src: 'Bob Seger - Against The Wind.mp3',          title: 'Against the Wind',     artist: 'Bob Seger & The Silver Bullet Band' },
  { src: 'The Killers - Run For Cover.mp3',           title: 'Run for Cover',        artist: 'The Killers' },
];

// Fisher-Yates shuffle
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function setupMusicPlayer() {
  const audio    = document.getElementById('site-audio');
  const playBtn  = document.getElementById('music-play-btn');
  const prevBtn  = document.getElementById('music-prev-btn');
  const nextBtn  = document.getElementById('music-next-btn');
  const vol      = document.getElementById('music-volume');
  const titleEl  = document.getElementById('music-title');
  const artistEl = document.getElementById('music-artist');
  if (!audio || !playBtn) return;

  // shuffle on every page load
  const queue = shuffleArray(PLAYLIST);
  let trackIndex = 0;
  let wasPlaying = false;

  function loadTrack(index, autoplay) {
    const t = queue[index];
    audio.src = t.src;
    audio.loop = queue.length === 1;
    if (titleEl)  titleEl.textContent  = t.title;
    if (artistEl) artistEl.textContent = t.artist;
    playBtn.setAttribute('aria-label', `Play ${t.title} by ${t.artist}`);
    if (autoplay) audio.play().then(() => setPlayingState(true)).catch(() => {});
    else setPlayingState(false);
  }

  function setPlayingState(playing) {
    const icon = playBtn.querySelector('.music-play-icon');
    if (playing) {
      playBtn.classList.add('playing');
      playBtn.setAttribute('aria-label', 'Pause');
      if (icon) icon.textContent = '⏸';
    } else {
      playBtn.classList.remove('playing');
      const t = queue[trackIndex];
      playBtn.setAttribute('aria-label', `Play ${t.title} by ${t.artist}`);
      if (icon) icon.textContent = '▶';
    }
  }

  audio.volume = parseFloat(vol.value);
  loadTrack(0, true);

  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.play().then(() => setPlayingState(true)).catch(() => {});
    } else {
      audio.pause();
      setPlayingState(false);
    }
  });

  prevBtn?.addEventListener('click', () => {
    wasPlaying = !audio.paused;
    trackIndex = (trackIndex - 1 + queue.length) % queue.length;
    loadTrack(trackIndex, wasPlaying);
  });

  nextBtn?.addEventListener('click', () => {
    wasPlaying = !audio.paused;
    trackIndex = (trackIndex + 1) % queue.length;
    loadTrack(trackIndex, wasPlaying);
  });

  // auto-advance to next track when one ends
  audio.addEventListener('ended', () => {
    trackIndex = (trackIndex + 1) % queue.length;
    loadTrack(trackIndex, true);
  });

  vol.addEventListener('input', () => { audio.volume = parseFloat(vol.value); });
}

// ── weather alerts ────────────────────────────────────────────────────────────
// NWS public API — no key required. KYC067 = Fayette County (Lexington).
const NWS_ZONE = 'KYC067';

// Alert types that directly affect outdoor running
const RUNNING_ALERTS = new Set([
  'Tornado Warning', 'Tornado Watch',
  'Severe Thunderstorm Warning', 'Severe Thunderstorm Watch',
  'Flash Flood Warning', 'Flash Flood Watch', 'Flood Warning', 'Flood Watch',
  'Winter Storm Warning', 'Winter Storm Watch', 'Winter Storm Advisory',
  'Ice Storm Warning', 'Freezing Rain Advisory', 'Sleet Advisory',
  'Wind Advisory', 'High Wind Warning', 'High Wind Watch',
  'Excessive Heat Warning', 'Heat Advisory', 'Extreme Cold Warning', 'Wind Chill Warning',
  'Dense Fog Advisory', 'Freezing Fog Advisory',
  'Snow Squall Warning', 'Blizzard Warning', 'Blizzard Watch',
  'Special Weather Statement',
]);

function formatAlertExpiry(expiresStr) {
  if (!expiresStr) return '';
  try {
    const d = new Date(expiresStr);
    const now = new Date();
    const diffH = (d - now) / 3600000;
    if (diffH < 0) return '';
    if (diffH < 1) return `expires in ${Math.round(diffH * 60)} min`;
    if (diffH < 24) {
      const h = d.getHours() % 12 || 12;
      const m = String(d.getMinutes()).padStart(2, '0');
      const ampm = d.getHours() < 12 ? 'AM' : 'PM';
      return `until ${h}:${m} ${ampm}`;
    }
    return `until ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  } catch { return ''; }
}

async function fetchWeatherAlerts() {
  const banner = document.getElementById('weather-alert-banner');
  if (!banner) return;
  try {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?zone=${NWS_ZONE}`,
      { headers: { 'User-Agent': 'RunningInKentucky/1.0 (thomaswestonadams@gmail.com)' } }
    );
    if (!res.ok) return;
    const data = await res.json();

    const alerts = (data.features || []).filter(f => {
      const p = f.properties;
      return p.status === 'Actual' && p.messageType !== 'Cancel' &&
        ['Extreme', 'Severe', 'Moderate', 'Minor'].includes(p.severity);
    });

    if (alerts.length === 0) { banner.hidden = true; return; }

    // Sort: running-relevant first, then by severity
    const severityOrder = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };
    alerts.sort((a, b) => {
      const aRun = RUNNING_ALERTS.has(a.properties.event) ? 0 : 1;
      const bRun = RUNNING_ALERTS.has(b.properties.event) ? 0 : 1;
      if (aRun !== bRun) return aRun - bRun;
      return (severityOrder[a.properties.severity] ?? 9) - (severityOrder[b.properties.severity] ?? 9);
    });

    const top = alerts[0].properties;
    const level = top.severity === 'Extreme' ? 'extreme'
      : top.severity === 'Severe'   ? 'severe'
      : top.severity === 'Moderate' ? 'moderate' : 'minor';

    const expiry = formatAlertExpiry(top.expires);
    const expiryHtml = expiry ? ` <span class="weather-alert-expiry">${esc(expiry)}</span>` : '';

    const otherCount = alerts.length - 1;
    const extrasHtml = otherCount > 0
      ? ` <span class="weather-alert-count">+${otherCount} more</span>` : '';

    const isRunningAlert = RUNNING_ALERTS.has(top.event);
    const runningNote = isRunningAlert
      ? `<div class="weather-alert-running-note">Check with your club before heading out.</div>` : '';

    banner.className = `weather-alert-banner weather-alert--${level}`;
    banner.innerHTML = `
      <div class="weather-alert-inner">
        <span class="weather-alert-icon" aria-hidden="true">⚠️</span>
        <div class="weather-alert-body">
          <div class="weather-alert-top">
            <strong class="weather-alert-event">${esc(top.event)}</strong>${expiryHtml}${extrasHtml}
          </div>
          <div class="weather-alert-headline">${esc(top.headline || '')}</div>
          ${runningNote}
        </div>
        <a class="weather-alert-link" href="https://www.weather.gov/lmk/" target="_blank" rel="noopener">NWS →</a>
      </div>`;
    banner.hidden = false;
  } catch { /* silently ignore — non-critical */ }
}


// ── init ──────────────────────────────────────────────────────────────────────
async function init() {
  setupDarkMode();
  setupMusicPlayer();
  fetchWeatherAlerts();
  setInterval(fetchWeatherAlerts, 30 * 60 * 1000); // refresh every 30 min

  try {
    const [clubsRes, racesRes] = await Promise.all([fetch(CLUBS_URL), fetch(RACES_URL)]);
    const clubs = await clubsRes.json();
    const racesData = await racesRes.json();
    const races = racesData.races;

    renderTodaysBanner(clubs.weeklySchedule);
    renderCalendar(clubs.weeklySchedule);
    renderGroups(clubs.groups);
    renderDaily(clubs.dailyMeetups);
    renderWeekendCallout(races);
    renderRaces(races);
    setupSearch(races);
    setupRaceFilters(races);
    if (typeof initCountyMap === 'function') initCountyMap(races);

    const updated = document.getElementById('last-updated');
    if (updated && clubs.lastUpdated) updated.textContent = clubs.lastUpdated;

    const counts = document.getElementById('event-counts');
    if (counts && clubs.totals) {
      counts.textContent = `${clubs.totals.weeklyEvents} weekly events · ${clubs.totals.groups} groups`;
    }
  } catch (err) {
    console.error('Failed to load data:', err);
    document.getElementById('weekly-calendar').innerHTML =
      '<p style="padding:20px;color:#c00">Could not load schedule data. Run npm run build to generate data files.</p>';
  }
}

init();

// ── site miles counter ────────────────────────────────────────────────────────
(async function () {
  const el = document.getElementById('site-miles-count');
  if (!el) return;
  try {
    const res  = await fetch('https://api.counterapi.dev/v1/runninginkentucky/miles/up');
    const data = await res.json();
    const count = data?.count ?? data?.value;
    if (typeof count === 'number') {
      el.textContent = count.toLocaleString('en-US');
    }
  } catch (e) { /* silently ignore — counter is cosmetic */ }
})();
