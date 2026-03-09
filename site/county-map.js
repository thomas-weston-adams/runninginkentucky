// county-map.js — Kentucky County Challenge Map
// Requires: D3 (d3.geoAlbers, d3.geoPath) and topojson-client loaded before this file

(function () {
  'use strict';

  const TOPO_URL    = 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json';
  const KY_FIPS     = 21;          // state FIPS prefix
  const TOTAL       = 120;         // Kentucky has exactly 120 counties
  const STORAGE_KEY = 'ky_county_challenge_v1';

  // ── Admin email for contribution submissions ───────────────────────────────────
  // Change this to the address where you want to receive county map submissions.
  const ADMIN_EMAIL = 'thomaswestonadams@gmail.com';

  // ── City → Kentucky county name lookup ───────────────────────────────────────
  // Keys: lowercase city name as it appears before ", KY" in race location strings
  // Values: county name exactly as it appears in the us-atlas TopoJSON (no "County")
  const CITY_TO_COUNTY = {
    'albany':           'Clinton',
    'alexandria':       'Campbell',
    'ashland':          'Boyd',
    'auburn':           'Logan',
    'augusta':          'Bracken',
    'bardstown':        'Nelson',
    'barbourville':     'Knox',
    'beattyville':      'Lee',
    'belfry':           'Pike',
    'benton':           'Marshall',
    'berea':            'Madison',
    'bloomfield':       'Nelson',
    'booneville':       'Owsley',
    'bowling green':    'Warren',
    'brandenburg':      'Meade',
    'brooksville':      'Bracken',
    'burkesville':      'Cumberland',
    'burnside':         'Pulaski',
    'cadiz':            'Trigg',
    'calhoun':          'McLean',
    'campbellsville':   'Taylor',
    'carlisle':         'Nicholas',
    'carrollton':       'Carroll',
    'cattletsburg':     'Boyd',
    'cave city':        'Barren',
    'clay city':        'Powell',
    'clinton':          'Hickman',
    'columbia':         'Adair',
    'corbin':           'Whitley',
    'covington':        'Kenton',
    'cynthiana':        'Harrison',
    'danville':         'Boyle',
    'dixon':            'Webster',
    'dry ridge':        'Grant',
    'eddyville':        'Lyon',
    'edmonton':         'Metcalfe',
    'elizabethtown':    'Hardin',
    'elkton':           'Todd',
    'eminence':         'Henry',
    'falmouth':         'Pendleton',
    'flemingsburg':     'Fleming',
    'florence':         'Boone',
    'fort mitchell':    'Kenton',
    'fort thomas':      'Campbell',
    'fort wright':      'Kenton',
    'frankfort':        'Franklin',
    'frenchburg':       'Menifee',
    'georgetown':       'Scott',
    'glasgow':          'Barren',
    'grayson':          'Carter',
    'greensburg':       'Green',
    'greenup':          'Greenup',
    'greenville':       'Muhlenberg',
    'hardinsburg':      'Breckinridge',
    'harlan':           'Harlan',
    'harrodsburg':      'Mercer',
    'hartford':         'Ohio',
    'hawesville':       'Hancock',
    'hazard':           'Perry',
    'henderson':        'Henderson',
    'hindman':          'Knott',
    'hodgenville':      'Larue',
    'hopkinsville':     'Christian',
    'horse cave':       'Hart',
    'hyden':            'Leslie',
    'inez':             'Martin',
    'irvine':           'Estill',
    'irvington':        'Breckinridge',
    'jackson':          'Breathitt',
    'jamestown':        'Russell',
    'jenkins':          'Letcher',
    'la grange':        'Oldham',
    'lagrange':         'Oldham',
    'lancaster':        'Garrard',
    'lawrenceburg':     'Anderson',
    'lebanon':          'Marion',
    'leitchfield':      'Grayson',
    'lewisport':        'Hancock',
    'lexington':        'Fayette',
    'liberty':          'Casey',
    'london':           'Laurel',
    'louisville':       'Jefferson',
    'louisa':           'Lawrence',
    'lynch':            'Harlan',
    'madisonville':     'Hopkins',
    'manchester':       'Clay',
    'marion':           'Crittenden',
    'mayfield':         'Graves',
    'maysville':        'Mason',
    'mc kee':           'Jackson',
    'mckee':            'Jackson',
    'midway':           'Woodford',
    'monticello':       'Wayne',
    'morehead':         'Rowan',
    'morganfield':      'Union',
    'morgantown':       'Butler',
    'mount olivet':     'Robertson',
    'mount sterling':   'Montgomery',
    'mt sterling':      'Montgomery',
    'mt. sterling':     'Montgomery',
    'munfordville':     'Hart',
    'murray':           'Calloway',
    'new castle':       'Henry',
    'newport':          'Campbell',
    'nicholasville':    'Jessamine',
    'olive hill':       'Carter',
    'owenton':          'Owen',
    'owensboro':        'Daviess',
    'owingsville':      'Bath',
    'paintsville':      'Johnson',
    'paris':            'Bourbon',
    'park hills':       'Kenton',
    'perryville':       'Boyle',
    'pikeville':        'Pike',
    'pineville':        'Bell',
    'prestonsburg':     'Floyd',
    'princeton':        'Caldwell',
    'prospect':         'Oldham',
    'radcliff':         'Hardin',
    'richmond':         'Madison',
    'russell':          'Greenup',
    'russell springs':  'Russell',
    'salyersville':     'Magoffin',
    'sandy hook':       'Elliott',
    'scottsville':      'Allen',
    'shelbyville':      'Shelby',
    'shepherdsville':   'Bullitt',
    'somerset':         'Pulaski',
    'south williamson': 'Pike',
    'springfield':      'Washington',
    'stanford':         'Lincoln',
    'stanton':          'Powell',
    'taylorsville':     'Spencer',
    'tompkinsville':    'Monroe',
    'vanceburg':        'Lewis',
    'versailles':       'Woodford',
    'vine grove':       'Hardin',
    'warsaw':           'Gallatin',
    'west liberty':     'Morgan',
    'whitesburg':       'Letcher',
    'whitley city':     'McCreary',
    'wickliffe':        'Ballard',
    'williamsburg':     'Whitley',
    'williamstown':     'Grant',
    'wilmore':          'Jessamine',
    'winchester':       'Clark',
  };

  // ── State ─────────────────────────────────────────────────────────────────────
  let allRaces        = [];
  let countyRaceMap   = {};   // countyName → [race, ...]
  let completed       = loadCompleted();
  let pinned          = null; // currently clicked/pinned county name
  let compareCounties = null; // Set<string> — counties completed by compared user
  let compareName     = null;

  function loadCompleted() {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); }
    catch (e) { return new Set(); }
  }
  function saveCompleted() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed]));
    if (window.onCountyToggle) window.onCountyToggle(completed);
  }

  // ── City → county resolution ──────────────────────────────────────────────────
  function locationToCounty(loc) {
    if (!loc) return null;
    const m = loc.match(/^(.+?),\s*(?:KY|Kentucky)\b/i);
    if (!m) return null;
    const city = m[1].trim().toLowerCase()
      .replace(/^mt\.\s+/, 'mt ')
      .replace(/^st\.\s+/, 'st ');
    return CITY_TO_COUNTY[city] || null;
  }

  function buildCountyRaceMap(races) {
    const map = {};
    races.forEach(r => {
      const county = locationToCounty(r.location);
      if (county) (map[county] = map[county] || []).push(r);
    });
    // De-duplicate parkrun entries per county — keep one per name per month
    Object.keys(map).forEach(c => {
      const seen = new Set();
      map[c] = map[c].filter(r => {
        const key = r.name + '|' + r.date.slice(0, 7);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
    return map;
  }

  // ── Entry point (called from main.js) ─────────────────────────────────────────
  async function initCountyMap(races) {
    allRaces      = races;
    countyRaceMap = buildCountyRaceMap(races);

    const wrap = document.getElementById('county-map-wrap');
    if (!wrap) return;

    // Check dependencies loaded
    if (typeof d3 === 'undefined' || typeof topojson === 'undefined') {
      wrap.innerHTML = '<p style="padding:20px;color:#c00">Map libraries failed to load. Try refreshing the page.</p>';
      return;
    }

    // Show loading state
    const loadingEl = document.createElement('p');
    loadingEl.id = 'county-map-loading';
    loadingEl.style.cssText = 'padding:40px;text-align:center;color:#5C6B73;font-style:italic';
    loadingEl.textContent = 'Loading Kentucky county map…';
    wrap.appendChild(loadingEl);

    let topoData;
    try {
      topoData = await fetch(TOPO_URL).then(r => r.json());
    } catch (e) {
      wrap.innerHTML = '<p style="padding:20px;color:#c00">Could not load map data. Check your connection and try refreshing.</p>';
      return;
    }

    try {
      const kyFeatures = topojson.feature(topoData, topoData.objects.counties).features
        .filter(f => Math.floor(+f.id / 1000) === KY_FIPS);

      const loading = document.getElementById('county-map-loading');
      if (loading) loading.remove();

      renderMap(kyFeatures, topoData);
      renderStats();
      renderCountyGrid();
      if (window.initCountyProfiles) window.initCountyProfiles();
    } catch (e) {
      wrap.innerHTML = `<p style="padding:20px;color:#c00">Map render error: ${e.message}. Try refreshing.</p>`;
      console.error('County map error:', e);
    }
  }

  // ── SVG map ───────────────────────────────────────────────────────────────────
  function renderMap(features, topoData) {
    const wrap = document.getElementById('county-map-wrap');
    const W    = wrap.clientWidth  || 800;
    const H    = Math.round(W * 0.50); // Kentucky's natural ~2:1 aspect

    const projection = d3.geoAlbers()
      .parallels([36.5, 39.1])
      .rotate([86.5, 0])
      .center([0, 37.8])
      .fitSize([W - 2, H - 2], { type: 'FeatureCollection', features });

    const pathGen = d3.geoPath().projection(projection);

    const svg = document.getElementById('county-map');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.width  = '100%';
    svg.style.height = 'auto';
    svg.innerHTML    = '';

    // County fill paths
    features.forEach(feature => {
      const name  = feature.properties.name;
      const races = countyRaceMap[name] || [];
      const done  = completed.has(name);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathGen(feature));
      path.dataset.county = name;
      const cmp = compareCounties && compareCounties.has(name);
      path.setAttribute('class', 'c-path' +
        (races.length > 0 ? ' c-has-races'    : '') +
        (done            ? ' c-done'          : '') +
        (cmp             ? ' c-compare-done'  : ''));

      path.addEventListener('mouseenter', e => onHover(e, name));
      path.addEventListener('mousemove',  moveTooltip);
      path.addEventListener('mouseleave', hideTooltip);
      path.addEventListener('click',      () => onSelect(name));

      svg.appendChild(path);
    });

    // County border mesh (drawn on top so clicks still hit fill paths)
    const mesh = topojson.mesh(topoData, topoData.objects.counties,
      (a, b) => Math.floor(+a.id / 1000) === KY_FIPS &&
                Math.floor(+b.id / 1000) === KY_FIPS);
    const borders = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    borders.setAttribute('d', pathGen(mesh));
    borders.setAttribute('class', 'c-borders');
    borders.style.pointerEvents = 'none';
    svg.appendChild(borders);
  }

  // ── Floating tooltip ──────────────────────────────────────────────────────────
  const tooltip = (() => {
    const el = document.createElement('div');
    el.className    = 'county-tooltip';
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  })();

  function onHover(e, name) {
    const races = countyRaceMap[name] || [];
    const done  = completed.has(name);
    const pinNote = name === pinned ? ' · selected' : '';

    let html = `<div class="ct-name">${name} County${done ? ' <span class="ct-check">✓</span>' : ''}${pinNote}</div>`;

    if (races.length === 0) {
      html += `<div class="ct-none">No races listed yet</div>`;
    } else {
      const upcoming = races
        .filter(r => new Date(r.date + 'T12:00:00') >= new Date())
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      html += `<div class="ct-count">${upcoming.length} upcoming race${upcoming.length !== 1 ? 's' : ''}</div>`;
      upcoming.slice(0, 3).forEach(r => {
        const d   = new Date(r.date + 'T12:00:00');
        const lbl = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        html += `<div class="ct-race-row">${lbl} · ${r.name}</div>`;
      });
      if (upcoming.length > 3) html += `<div class="ct-more">+${upcoming.length - 3} more</div>`;
    }
    if (compareCounties) {
      const cmpDone = compareCounties.has(name);
      html += `<div class="ct-compare">${cmpDone
        ? `<span class="ct-cmp-yes">✓ ${compareName || 'Compared runner'} ran here</span>`
        : `<span class="ct-cmp-no">— ${compareName || 'Compared runner'} hasn't run here</span>`}</div>`;
    }
    html += `<div class="ct-hint">Click to ${races.length ? 'see all & track' : 'track'}</div>`;

    tooltip.innerHTML    = html;
    tooltip.style.display = 'block';
    moveTooltip(e);
  }

  function moveTooltip(e) {
    const pad = 16;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    if (x + tw > window.innerWidth  - 8) x = e.clientX - tw - pad;
    if (y + th > window.innerHeight - 8) y = e.clientY - th - pad;
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
  }

  function hideTooltip() { tooltip.style.display = 'none'; }

  // ── County panel ──────────────────────────────────────────────────────────────
  function onSelect(name) {
    pinned = name;
    hideTooltip();

    // Highlight map path
    document.querySelectorAll('.c-path.c-selected')
      .forEach(el => el.classList.remove('c-selected'));
    const pathEl = document.querySelector(`.c-path[data-county="${CSS.escape(name)}"]`);
    if (pathEl) pathEl.classList.add('c-selected');

    const panel = document.getElementById('county-panel');
    if (!panel) return;

    const races   = countyRaceMap[name] || [];
    const done    = completed.has(name);
    const today   = new Date(); today.setHours(0, 0, 0, 0);
    const upcoming = races
      .filter(r => new Date(r.date + 'T12:00:00') >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const past     = races
      .filter(r => new Date(r.date + 'T12:00:00') < today)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const renderRaceCard = r => {
      const d   = new Date(r.date + 'T12:00:00');
      const lbl = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.location)}`;
      return `
        <div class="cp-race">
          <div class="cp-race-date">${lbl}</div>
          <div class="cp-race-name">${esc(r.name)}</div>
          <div class="cp-race-loc">📍 ${esc(r.location)}</div>
          ${r.notes ? `<div class="cp-race-notes">${esc(r.notes)}</div>` : ''}
          <div class="cp-race-links">
            <a href="${mapUrl}" class="btn btn-map btn-sm" target="_blank" rel="noopener">Map</a>
            ${r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" class="btn btn-link btn-sm" target="_blank" rel="noopener">Details →</a>` : ''}
          </div>
        </div>`;
    };

    const raceHtml = upcoming.length === 0 && past.length === 0
      ? `<p class="cp-empty">No races currently listed for ${name} County.
         As more events are added, they'll appear here. Check local Facebook running groups
         and running clubs in nearby counties for events that may be close by.</p>`
      : (upcoming.length > 0 ? upcoming.map(renderRaceCard).join('') : '') +
        (past.length > 0 ? `<h4 class="cp-past-label">Past races</h4>` + past.map(renderRaceCard).join('') : '');

    panel.innerHTML = `
      <div class="cp-header">
        <h3 class="cp-title">${name} County</h3>
        <button class="cp-close" id="cp-close-btn" aria-label="Close panel">✕</button>
      </div>
      <div class="cp-body">
        <label class="cp-done-row">
          <input type="checkbox" class="cp-checkbox" id="cp-done-check" ${done ? 'checked' : ''}>
          <span class="cp-done-label">I've run a race in ${name} County</span>
          ${done ? '<span class="cp-done-badge">✓ completed</span>' : ''}
        </label>
        <h4 class="cp-races-heading">
          ${upcoming.length > 0 ? `${upcoming.length} upcoming race${upcoming.length !== 1 ? 's' : ''}` : 'Races'}
        </h4>
        <div class="cp-races">${raceHtml}</div>
      </div>`;

    panel.hidden = false;

    document.getElementById('cp-close-btn').addEventListener('click', () => {
      panel.hidden = true;
      pinned = null;
      document.querySelectorAll('.c-path.c-selected')
        .forEach(el => el.classList.remove('c-selected'));
    });

    document.getElementById('cp-done-check').addEventListener('change', e => {
      if (e.target.checked) completed.add(name);
      else completed.delete(name);
      saveCompleted();
      // update map path class
      const p = document.querySelector(`.c-path[data-county="${CSS.escape(name)}"]`);
      if (p) p.classList.toggle('c-done', e.target.checked);
      // update county grid button
      const btn = document.querySelector(`.cg-btn[data-county="${CSS.escape(name)}"]`);
      if (btn) btn.classList.toggle('cg-done', e.target.checked);
      renderStats();
    });

    // Smooth scroll to panel on mobile
    if (window.matchMedia('(max-width: 700px)').matches) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ── Stats bar ─────────────────────────────────────────────────────────────────
  function renderStats() {
    const el = document.getElementById('county-stats');
    if (!el) return;

    const withRaces = Object.keys(countyRaceMap).length;
    const done      = completed.size;
    const pct       = Math.round((done / TOTAL) * 100);

    const cmpBar = compareCounties ? (() => {
      const cPct = Math.round((compareCounties.size / TOTAL) * 100);
      return `
      <div class="cs-compare-row">
        <span class="cs-compare-lbl">${compareName || 'Compared runner'}:</span>
        <div class="cs-bar"><div class="cs-fill cs-fill--compare" style="width:${cPct}%"></div></div>
        <span class="cs-pct cs-pct--compare">${compareCounties.size}/120</span>
      </div>`;
    })() : '';

    el.innerHTML = `
      <div class="cs-grid">
        <div class="cs-item">
          <div class="cs-val">${withRaces}</div>
          <div class="cs-lbl">counties with<br>races listed</div>
        </div>
        <div class="cs-item">
          <div class="cs-val">${TOTAL - withRaces}</div>
          <div class="cs-lbl">counties still<br>need coverage</div>
        </div>
        <div class="cs-item cs-highlight">
          <div class="cs-val">${done}<span class="cs-denom"> / ${TOTAL}</span></div>
          <div class="cs-lbl">your counties<br>completed</div>
        </div>
      </div>
      <div class="cs-bar-wrap">
        <div class="cs-bar"><div class="cs-fill" style="width:${pct}%"></div></div>
        <div class="cs-pct">${pct}%</div>
      </div>
      ${cmpBar}`;
  }

  // ── County grid (all 120) ─────────────────────────────────────────────────────
  function renderCountyGrid() {
    const el = document.getElementById('county-grid');
    if (!el) return;

    const names = [...document.querySelectorAll('.c-path')]
      .map(p => p.dataset.county)
      .sort();

    el.innerHTML = names.map(name => {
      const count = (countyRaceMap[name] || []).length;
      const done  = completed.has(name);
      return `<button class="cg-btn${count > 0 ? ' cg-has' : ''}${done ? ' cg-done' : ''}"
                data-county="${esc(name)}"
                title="${name} County — ${count} race${count !== 1 ? 's' : ''}">
        <span class="cg-name">${name}</span>
        ${count > 0 ? `<span class="cg-count">${count}</span>` : ''}
        ${done      ? `<span class="cg-check">✓</span>` : ''}
      </button>`;
    }).join('');

    el.querySelectorAll('.cg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        onSelect(btn.dataset.county);
        document.getElementById('county-panel')
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    // Wire up contribute form once county names are available
    initContributeForm(names);
  }

  // ── Contribution form ─────────────────────────────────────────────────────────
  function initContributeForm(countyNames) {
    const select = document.getElementById('cc-county');
    const form   = document.getElementById('county-contribute-form');
    if (!select || !form) return;

    // Populate county dropdown from the 120 counties on the map
    countyNames.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name + ' County';
      select.appendChild(opt);
    });

    // If a county is already selected on the map, pre-fill it
    if (pinned) select.value = pinned;

    // Sync map selection → dropdown
    document.getElementById('county-section')?.addEventListener('county-selected', e => {
      select.value = e.detail || '';
    });

    form.addEventListener('submit', e => {
      e.preventDefault();

      const county  = select.value;
      const type    = document.getElementById('cc-type').value;
      const detail  = document.getElementById('cc-detail').value.trim();
      const date    = document.getElementById('cc-date').value;
      const link    = document.getElementById('cc-link').value.trim();
      const notes   = document.getElementById('cc-notes').value.trim();

      if (!detail) {
        document.getElementById('cc-detail').focus();
        return;
      }

      const typeLabels = {
        race:       'Race event',
        city:       'Missing city/town mapping',
        correction: 'Data correction',
        other:      'Other',
      };

      const subject = `[KY County Map] ${typeLabels[type] || type}${county ? ' — ' + county + ' County' : ''}`;
      const body = [
        `Submission type: ${typeLabels[type] || type}`,
        county  ? `County: ${county} County` : '',
        `Details: ${detail}`,
        date    ? `Date: ${date}` : '',
        link    ? `Link: ${link}` : '',
        notes   ? `Notes: ${notes}` : '',
        '',
        '— Submitted via runninginkentucky.com county map',
      ].filter(Boolean).join('\n');

      window.open(
        `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
        '_blank'
      );
    });
  }

  // ── Compare mode ──────────────────────────────────────────────────────────────
  function setCompare(name, countiesSet) {
    compareName     = name;
    compareCounties = countiesSet;
    document.querySelectorAll('.c-path').forEach(path => {
      path.classList.toggle('c-compare-done', compareCounties.has(path.dataset.county));
    });
    renderStats();
  }

  function clearCompare() {
    compareName     = null;
    compareCounties = null;
    document.querySelectorAll('.c-path.c-compare-done')
      .forEach(p => p.classList.remove('c-compare-done'));
    renderStats();
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.initCountyMap  = initCountyMap;
  window.countyMapAPI   = { setCompare, clearCompare, refresh: renderStats };
})();
