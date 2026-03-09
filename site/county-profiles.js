// county-profiles.js — Runner profiles for the KY County Challenge
// Profiles are stored in localStorage and shareable via URL (?profile=BASE64)

(function () {
  'use strict';

  const PROFILES_KEY = 'ky_county_profiles_v1';
  const LEGACY_KEY   = 'ky_county_challenge_v1';
  const TOTAL        = 120;

  // ── Storage ───────────────────────────────────────────────────────────────────
  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(PROFILES_KEY) || 'null')
        || { myId: null, profiles: {} };
    } catch (e) { return { myId: null, profiles: {} }; }
  }

  function saveStore() {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(store));
  }

  function genId() {
    return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  let store = loadStore();

  // ── Profile helpers ───────────────────────────────────────────────────────────
  function getMyProfile() {
    return store.myId ? (store.profiles[store.myId] || null) : null;
  }

  function allProfiles() {
    return Object.entries(store.profiles)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => b.counties.length - a.counties.length);
  }

  function createProfile(name) {
    const id = genId();
    // Migrate legacy single-user data if present
    let counties = [];
    try { counties = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]'); } catch (e) {}
    store.profiles[id] = { name: name.trim(), counties };
    store.myId = id;
    saveStore();
    return id;
  }

  function updateMyCounties(countiesSet) {
    if (!store.myId) return;
    store.profiles[store.myId].counties = [...countiesSet];
    saveStore();
  }

  // ── URL sharing ───────────────────────────────────────────────────────────────
  function encodeProfile(name, counties) {
    return btoa(unescape(encodeURIComponent(JSON.stringify({ n: name, c: [...counties] }))));
  }

  function decodeProfile(str) {
    try {
      const d = JSON.parse(decodeURIComponent(escape(atob(str))));
      if (!d.n || !Array.isArray(d.c)) return null;
      return { name: d.n, counties: d.c };
    } catch (e) { return null; }
  }

  function getShareUrl(id) {
    const p = store.profiles[id];
    if (!p) return null;
    return `${location.origin}${location.pathname}?profile=${encodeProfile(p.name, p.counties)}`;
  }

  // ── Compare state ─────────────────────────────────────────────────────────────
  let compareId = null;

  function setCompare(id) {
    const p = store.profiles[id];
    if (!p) return;
    compareId = id;
    if (window.countyMapAPI) {
      window.countyMapAPI.setCompare(p.name, new Set(p.counties));
    }
    render();
  }

  function clearCompare() {
    compareId = null;
    if (window.countyMapAPI) window.countyMapAPI.clearCompare();
    render();
  }

  // ── URL param: ?profile=BASE64 ────────────────────────────────────────────────
  function checkUrlProfile() {
    const encoded = new URLSearchParams(location.search).get('profile');
    if (!encoded) return;
    const decoded = decodeProfile(encoded);
    if (!decoded) return;

    // Upsert as a saved profile (marked _shared so it's identified)
    let sharedId = Object.entries(store.profiles)
      .find(([, p]) => p._shared && p.name === decoded.name)?.[0];
    if (!sharedId) {
      sharedId = genId();
      store.profiles[sharedId] = { name: decoded.name, counties: decoded.c, _shared: true };
    } else {
      store.profiles[sharedId].counties = decoded.c;
    }
    saveStore();

    showSharedBanner(decoded.name, decoded.c.length, sharedId);

    compareId = sharedId;
    if (window.countyMapAPI) {
      window.countyMapAPI.setCompare(decoded.name, new Set(decoded.c));
    }
  }

  function showSharedBanner(name, count, sharedId) {
    const section = document.getElementById('county-section');
    if (!section || document.getElementById('prof-share-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'prof-share-banner';
    banner.className = 'prof-share-banner';
    banner.innerHTML = `
      <span>Viewing <strong>${esc(name)}</strong>'s progress — ${count}/120 counties</span>
      <div class="psb-actions">
        <button class="btn btn-sm btn-secondary" id="psb-save">Save to leaderboard</button>
        <button class="btn btn-sm psb-close-btn" id="psb-close">✕</button>
      </div>`;
    section.insertBefore(banner, section.firstChild);

    document.getElementById('psb-save').addEventListener('click', e => {
      e.target.textContent = 'Saved!';
      e.target.disabled = true;
    });
    document.getElementById('psb-close').addEventListener('click', () => {
      banner.remove();
      clearCompare();
    });
  }

  // ── Escape helper ─────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function copyToClipboard(btn, text) {
    navigator.clipboard.writeText(text)
      .then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 2000);
      })
      .catch(() => prompt('Copy this link:', text));
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function render() {
    const wrap = document.getElementById('county-profile-wrap');
    if (!wrap) return;

    const me      = getMyProfile();
    const all     = allProfiles();

    if (!me) {
      wrap.innerHTML = `
        <div class="prof-create">
          <p class="prof-create-blurb">
            Create a profile to track your county progress and compare with other runners.
            Share your link with friends so they can see your map.
          </p>
          <div class="prof-create-row">
            <input type="text" id="prof-name-input" class="prof-name-input"
              placeholder="Your name" maxlength="40" autocomplete="name">
            <button class="btn btn-primary" id="prof-create-btn">Create Profile</button>
          </div>
        </div>`;

      document.getElementById('prof-create-btn').addEventListener('click', () => {
        const nameInput = document.getElementById('prof-name-input');
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        createProfile(name);
        render();
        if (window.countyMapAPI) window.countyMapAPI.refresh();
      });
      document.getElementById('prof-name-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('prof-create-btn').click();
      });
      return;
    }

    const myCount = me.counties.length;
    const myPct   = Math.round((myCount / TOTAL) * 100);

    const compareActive = compareId && compareId !== store.myId;
    const comparePerson = compareActive ? store.profiles[compareId] : null;

    const leaderboardRows = all.map((p, i) => {
      const isMe      = p.id === store.myId;
      const isCompare = p.id === compareId;
      const barW      = Math.round((p.counties.length / TOTAL) * 100);
      const actionBtn = isMe
        ? `<button class="btn btn-sm prof-share-btn" data-pid="${esc(p.id)}">Share link</button>`
        : `<button class="btn btn-sm prof-view-btn ${isCompare ? 'prof-view-btn--active' : ''}" data-pid="${esc(p.id)}">${isCompare ? 'Viewing' : 'View map'}</button>`;

      return `
        <div class="prof-lb-row ${isMe ? 'prof-lb-me' : ''} ${isCompare ? 'prof-lb-compare' : ''}">
          <span class="prof-lb-rank">${i + 1}</span>
          <div class="prof-lb-info">
            <span class="prof-lb-name">${esc(p.name)}${isMe ? '<span class="prof-lb-you"> you</span>' : ''}</span>
            <div class="prof-lb-barwrap">
              <div class="prof-lb-bar ${isCompare ? 'prof-lb-bar--compare' : ''}">
                <div class="prof-lb-fill" style="width:${barW}%"></div>
              </div>
              <span class="prof-lb-count">${p.counties.length}/120</span>
            </div>
          </div>
          <div class="prof-lb-action">${actionBtn}</div>
        </div>`;
    }).join('');

    wrap.innerHTML = `
      <div class="prof-header">
        <div class="prof-mine">
          <span class="prof-mine-name">${esc(me.name)}</span>
          <div class="prof-mine-barrow">
            <div class="prof-mine-bar"><div class="prof-mine-fill" style="width:${myPct}%"></div></div>
            <span class="prof-mine-count">${myCount} / ${TOTAL}</span>
          </div>
        </div>
        ${compareActive && comparePerson ? `
          <div class="prof-compare-badge">
            Comparing with <strong>${esc(comparePerson.name)}</strong>
            <button class="btn btn-sm" id="prof-clear-compare">Clear</button>
          </div>` : ''}
      </div>

      <details class="prof-lb-details" ${compareActive || all.length > 1 ? 'open' : ''}>
        <summary class="prof-lb-summary">
          ${all.length > 1
            ? `Leaderboard — ${all.length} runners`
            : 'Share your progress'}
        </summary>
        <div class="prof-leaderboard">${leaderboardRows}</div>
        ${all.filter(p => p._shared).length === 0 ? `
          <p class="prof-lb-hint">
            Share your link with other runners. When they open it, they'll appear here for comparison.
          </p>` : ''}
      </details>`;

    document.getElementById('prof-clear-compare')?.addEventListener('click', clearCompare);

    wrap.querySelectorAll('.prof-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('prof-view-btn--active')) {
          clearCompare();
        } else {
          setCompare(btn.dataset.pid);
        }
      });
    });

    wrap.querySelectorAll('.prof-share-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = getShareUrl(btn.dataset.pid);
        if (!url) return;
        if (navigator.share) {
          navigator.share({ title: 'My KY County Challenge progress', url })
            .catch(() => copyToClipboard(btn, url));
        } else {
          copyToClipboard(btn, url);
        }
      });
    });
  }

  // ── Hook: county-map.js calls this when a county is toggled ──────────────────
  window.onCountyToggle = function (countiesSet) {
    if (store.myId) {
      updateMyCounties(countiesSet);
      render();
    }
  };

  // ── Init (called by county-map.js after map renders) ─────────────────────────
  window.initCountyProfiles = function () {
    // Insert profile container before #county-stats
    if (!document.getElementById('county-profile-wrap')) {
      const statsEl = document.getElementById('county-stats');
      if (!statsEl) return;
      const wrap = document.createElement('div');
      wrap.id = 'county-profile-wrap';
      statsEl.parentNode.insertBefore(wrap, statsEl);
    }
    render();
    checkUrlProfile();
  };
})();
