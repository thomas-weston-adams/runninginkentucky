'use strict';

const CLUBS_URL = './clubs.json';
const RACES_URL = './races.json';
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TODAY = new Date();

// ── helpers ──────────────────────────────────────────────────────────────────
function todayDayName() {
  return DAYS[TODAY.getDay() === 0 ? 6 : TODAY.getDay() - 1];
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(str) {
  const d = parseDate(str);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── render weekly calendar ────────────────────────────────────────────────────
function renderCalendar(schedule) {
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

        const card = document.createElement('div');
        card.className = 'event-card';
        card.dataset.search = [ev.name, ev.location, ev.address, ev.notes].filter(Boolean).join(' ').toLowerCase();
        card.innerHTML = `
          <div class="event-time">${esc(ev.time)}</div>
          <div class="event-name">${esc(ev.name)}</div>
          <div class="event-location">${esc(ev.location)}${ev.address ? ` · ${esc(ev.address)}` : ''}</div>
          ${ev.notes ? `<div class="event-notes">${esc(ev.notes)}</div>` : ''}
          ${links.length ? `<div class="event-links">${links.join('')}</div>` : ''}
        `;
        eventsDiv.appendChild(card);
      });

      col.appendChild(eventsDiv);
    }

    grid.appendChild(col);
  });
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
  const cards = meetups.map(m => `
    <div class="daily-card">
      <div class="daily-who">${esc(m.who)}</div>
      <div class="daily-when">🕐 ${esc(m.when)}</div>
      <div class="daily-where">📍 ${esc(m.where)}</div>
    </div>
  `).join('');

  list.innerHTML = cards + `
    <div class="daily-footer" style="grid-column:1/-1">
      Want to be listed here? <a href="https://github.com/thomas-weston-adams/runninginkentucky/issues/new?title=Add+Daily+Meetup&labels=new-club" target="_blank" rel="noopener">Open a quick request</a> and we'll add you!
    </div>
  `;
}

// ── render races ──────────────────────────────────────────────────────────────
function renderRaces(races, filter = 'all') {
  const list = document.getElementById('races-list');
  const today = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());

  let filtered = races.filter(r => parseDate(r.date) >= today);

  if (filter === 'lexington') {
    filtered = filtered.filter(r => r.location.toLowerCase().includes('lexington'));
  } else if (filter === 'johns') {
    filtered = filtered.filter(r => r.source === 'Johns');
  } else if (filter === 'ultrasignup') {
    filtered = filtered.filter(r => r.source === 'UltraSignup');
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="no-results">No upcoming races found for this filter.</div>';
    return;
  }

  filtered.sort((a, b) => parseDate(a.date) - parseDate(b.date));

  list.innerHTML = filtered.map(r => {
    const d = parseDate(r.date);
    const month = MONTHS[d.getMonth()];
    const day = d.getDate();

    return `
      <div class="race-card" data-source="${esc(r.source)}" data-location="${esc(r.location)}">
        <div class="race-date-block">
          <div class="race-date-month">${month}</div>
          <div class="race-date-day">${day}</div>
        </div>
        <div class="race-info">
          <div class="race-name">${esc(r.name)}</div>
          <div class="race-meta">
            <span class="race-location">📍 ${esc(r.location)}</span>
            <span class="race-badge ${esc(r.source)}">${r.source === 'Johns' ? "John's" : r.source === 'UltraSignup' ? 'UltraSignup' : 'RaceRise'}</span>
          </div>
          ${r.notes ? `<div class="race-notes">${esc(r.notes)}</div>` : ''}
        </div>
        <div class="race-actions">
          <a href="${esc(r.sourceUrl)}" class="btn btn-map" target="_blank" rel="noopener">Details →</a>
        </div>
      </div>
    `;
  }).join('');
}

// ── search ────────────────────────────────────────────────────────────────────
function setupSearch() {
  const input = document.getElementById('search-input');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();

    // events
    document.querySelectorAll('.event-card').forEach(card => {
      const match = !q || card.dataset.search.includes(q);
      card.classList.toggle('hidden', !match);
    });

    // groups
    document.querySelectorAll('.group-card').forEach(card => {
      const match = !q || card.dataset.search.includes(q);
      card.classList.toggle('hidden', !match);
    });

    // races — re-render is heavier, just filter DOM
    document.querySelectorAll('.race-card').forEach(card => {
      const text = (card.dataset.source + ' ' + card.dataset.location + ' ' + card.querySelector('.race-name').textContent).toLowerCase();
      const match = !q || text.includes(q);
      card.classList.toggle('hidden', !match);
    });
  });
}

// ── race filters ──────────────────────────────────────────────────────────────
function setupRaceFilters(races) {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderRaces(races, btn.dataset.filter);
    });
  });
}

// ── init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const [clubsRes, racesRes] = await Promise.all([
      fetch(CLUBS_URL),
      fetch(RACES_URL)
    ]);
    const clubs = await clubsRes.json();
    const racesData = await racesRes.json();

    renderCalendar(clubs.weeklySchedule);
    renderGroups(clubs.groups);
    renderDaily(clubs.dailyMeetups);
    renderRaces(racesData.races);
    setupSearch();
    setupRaceFilters(racesData.races);

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
