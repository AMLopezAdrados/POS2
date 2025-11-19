// modules/5_eventbeheer.js — Eventbeheer (modal + lijst) met aanmaak & sluit-guard

import { store } from './store.js';
import { showAlert, createModal } from './4_ui.js';
import { openEventDetail } from './9_eventdetails.js';
import { saveEvent } from './3_data.js';

// ---------- Public API ----------

/** Lokaal events die vandaag vallen op 'active' zetten (niet persistent) */
export async function activateTodayPlannedEventsLocal() {
  const db = store.state.db || window.db;
  if (!db || !Array.isArray(db.evenementen)) return;

  const today = toLocalYMD(new Date());
  let changed = 0;

  for (const ev of db.evenementen) {
    const cur = String(ev.state || '').toLowerCase();
    const startYmd = getEventStartYMD(ev);
    const endYmd = getEventEndYMD(ev);
    const shouldActive = isInRangeYMD(today, startYmd, endYmd);
    if (shouldActive && cur !== 'active' && !isClosed(ev)) {
      ev.state = 'active';
      changed++;
    }
  }
  if (changed) {
    try { store.setDb?.(db); } catch {}
    store.emit?.('events:updated', { changed });
  }
}

/** Render als “pagina” in een container */
export function initEventBeheer(containerSelector = '#eventbeheer') {
  const root = typeof containerSelector === 'string'
    ? document.querySelector(containerSelector)
    : containerSelector;
  if (!root) return;
  ensureStyles();
  const list = getEvents();
  root.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'ev-headerbar';
  const title = document.createElement('h3');
  title.textContent = 'Evenementen';
  const newBtn = document.createElement('button');
  newBtn.className = 'btn primary';
  newBtn.id = 'evNewBtn';
  newBtn.textContent = '+ Nieuw evenement';
  newBtn.addEventListener('click', openCreateEventModal);
  header.append(title, newBtn);
  root.appendChild(header);

  const explorerHost = document.createElement('div');
  explorerHost.className = 'ev-explorer';
  root.appendChild(explorerHost);
  setupEventExplorer(explorerHost, list);
}

/** 👉 Compat: modal met evenementenlijst + knop ‘Nieuw’ */
export function toonEvenementenMenu() {
  const list = getEvents();
  ensureStyles();

  const { box, close } = createModal({ onClose: () => {} });
  box.classList.add('ev-modal');
  box.innerHTML = `
    <button class="modal-close" aria-label="Sluiten">✕</button>
    <div class="ev-headerbar">
      <h3>Evenementen</h3>
      <button class="btn primary" id="evNewBtn">+ Nieuw evenement</button>
    </div>
    <div class="ev-modal-body"></div>
  `;
  box.querySelector('.modal-close')?.addEventListener('click', close);
  box.querySelector('#evNewBtn')?.addEventListener('click', () => {
    close();
    openCreateEventModal();
  });
  const body = box.querySelector('.ev-modal-body');
  const explorerHost = document.createElement('div');
  explorerHost.className = 'ev-explorer';
  body.appendChild(explorerHost);
  setupEventExplorer(explorerHost, list, { autofocus: true });
}

/** ✔️ Toegestane kosten mutatie voor gesloten event */
export async function addCostToClosedEvent(eventId, kostregel) {
  const db = store.state.db || window.db;
  const ev = (db?.evenementen || []).find(e => e.id === eventId);
  if (!ev) return showAlert('Event niet gevonden.', 'error');

  if (!isClosed(ev)) return showAlert('Event is niet gesloten; gebruik het gewone kosten-scherm.', 'info');

  ev.kosten = Array.isArray(ev.kosten) ? ev.kosten : [];
  ev.kosten.push({ ...kostregel, ts: new Date().toISOString() });
  await saveEvent(ev.id).catch(err => {
    console.error(err);
    showAlert('Opslaan van kosten mislukt.', 'error');
  });
  showAlert('Kosten toegevoegd aan gesloten event.', 'success');
}

// ---------- Aanmaak ----------

// --- vervangt openCreateEventModal + helpers ---

export function openCreateEventModal() {
  ensureStyles();
  import('./15_eventSchedule.js')
    .then(m => m.openEventScheduleModal())
    .catch(() => showAlert('Kan nieuw evenement formulier niet openen.', 'error'));
}




// ---------- Intern ----------

function getEvents() {
  const db = store.state.db || window.db || { evenementen: [] };
  return Array.isArray(db.evenementen) ? db.evenementen.slice() : [];
}

const EVENT_SEGMENTS = [
  { key: 'active', label: 'Actief' },
  { key: 'planned', label: 'Gepland' },
  { key: 'closed', label: 'Afgesloten' },
  { key: 'all', label: 'Alles' }
];

function setupEventExplorer(host, events, options = {}) {
  if (!host) return;
  host.innerHTML = '';

  const state = {
    filter: options.defaultFilter || 'active',
    query: ''
  };

  const controls = document.createElement('div');
  controls.className = 'ev-controls';

  const segments = document.createElement('div');
  segments.className = 'ev-segments';
  EVENT_SEGMENTS.forEach((segment) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ev-segment${segment.key === state.filter ? ' is-active' : ''}`;
    btn.dataset.filter = segment.key;
    btn.textContent = segment.label;
    segments.appendChild(btn);
  });
  controls.appendChild(segments);

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'ev-search';
  search.placeholder = options.placeholder || 'Zoek op naam, locatie of bus…';
  search.setAttribute('aria-label', 'Zoek evenementen');
  controls.appendChild(search);

  host.appendChild(controls);

  const grid = document.createElement('div');
  grid.className = 'ev-card-grid';
  host.appendChild(grid);

  const updateSegments = () => {
    segments.querySelectorAll('.ev-segment').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.filter === state.filter);
    });
  };

  const getFiltered = () => {
    const list = Array.isArray(events) ? events : [];
    return list.filter((event) => matchesSegmentFilter(event, state.filter) && matchesEventQuery(event, state.query));
  };

  const updateList = () => {
    renderEventCardList(grid, getFiltered());
  };

  segments.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.ev-segment');
    if (!btn) return;
    state.filter = btn.dataset.filter || 'all';
    updateSegments();
    updateList();
  });

  search.addEventListener('input', () => {
    state.query = (search.value || '').trim().toLowerCase();
    updateList();
  });

  updateSegments();
  updateList();

  if (options.autofocus) {
    setTimeout(() => search.focus(), 120);
  }
}

function matchesSegmentFilter(event, filter = 'active') {
  if (filter === 'all') return true;
  const status = resolveEventStatus(event);
  return status.key === filter;
}

function matchesEventQuery(event, query) {
  if (!query) return true;
  const haystack = `${event?.naam || ''} ${event?.locatie || ''} ${event?.type || ''} ${event?.bus || ''} ${event?.busId || ''}`
    .toLowerCase();
  return haystack.includes(query);
}

function renderEventCardList(container, list) {
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(list) || !list.length) {
    const empty = document.createElement('div');
    empty.className = 'ev-empty';
    empty.textContent = 'Geen evenementen gevonden';
    container.appendChild(empty);
    return;
  }
  const sorted = list.slice().sort((a, b) => {
    const aStart = getEventStartYMD(a) || '';
    const bStart = getEventStartYMD(b) || '';
    return aStart.localeCompare(bStart);
  });
  sorted.forEach((event) => {
    container.appendChild(buildEventCard(event));
  });
}

function buildEventCard(event) {
  const card = document.createElement('article');
  const status = resolveEventStatus(event);
  const periode = formatRange(event) || 'Nog niet gepland';
  const busLabel = event?.bus || event?.busId || event?.ownerBus || 'n.v.t.';
  const eventRef = event?.id || event?.naam;
  card.className = `ev-card ev-card--${status.key}`;
  card.dataset.id = event?.id || '';
  card.dataset.name = event?.naam || '';
  card.innerHTML = `
    <header>
      <div>
        <p class="ev-card__eyebrow">${status.label}</p>
        <h4>${escapeHtml(event?.naam || 'Onbekend evenement')}</h4>
        <p class="ev-card__meta">${escapeHtml(event?.locatie || event?.type || '')}</p>
      </div>
      <span class="ev-card__badge ev-card__badge--${status.key}">${status.badge}</span>
    </header>
    <div class="ev-card__body">
      <div class="ev-card__row"><span>Periode</span><strong>${escapeHtml(periode)}</strong></div>
      <div class="ev-card__row"><span>Bus</span><strong>${escapeHtml(String(busLabel))}</strong></div>
    </div>
    <div class="ev-card__chips">
      <div><span>Starttelling</span>${renderStartChip(event)}</div>
      <div><span>Aanvullingen</span>${renderSupplementChip(event)}</div>
      <div><span>Dagomzet</span>${renderOmzetChip(event)}</div>
    </div>
    <footer>
      <button type="button" class="btn tiny ghost" data-action="details">Details →</button>
      ${isClosed(event) ? '<button type="button" class="btn tiny ghost" data-action="addcost">+ kosten</button>' : ''}
    </footer>
  `;

  card.addEventListener('click', async () => {
    if (!eventRef) return;
    await openDetailsSafe(eventRef);
  });
  const detailsBtn = card.querySelector('[data-action="details"]');
  detailsBtn?.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!eventRef) return;
    await openDetailsSafe(eventRef);
  });
  if (isClosed(event)) {
    const costBtn = card.querySelector('[data-action="addcost"]');
    costBtn?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (eventRef) openAddCostMiniModal(eventRef);
    });
  }
  return card;
}

function resolveEventStatus(event) {
  if (isClosed(event)) {
    return { key: 'closed', label: 'Afgesloten', badge: 'AFGESLOTEN' };
  }
  const state = String(event?.state || '').toLowerCase();
  if (state === 'active') {
    return { key: 'active', label: 'Actief', badge: 'ACTIEF' };
  }
  return { key: 'planned', label: 'Gepland', badge: 'GEPLAND' };
}

async function openDetailsSafe(eventRef) {
  try {
    await openEventDetail(eventRef);
  } catch (err) {
    console.error('[Eventbeheer] openEventDetail error:', err);
    showAlert('Kon eventdetails niet openen. Controleer de details-module.', 'error');
  }
}

function formatRange(e) {
  const start = getEventStartYMD(e);
  const end = getEventEndYMD(e);
  if (start && end) {
    if (start === end) return toNLDate(start);
    return `${toNLDate(start)} – ${toNLDate(end)}`;
  }
  const single = start || end;
  return single ? toNLDate(single) : '';
}

function getEventStartYMD(ev) {
  if (!ev || typeof ev !== 'object') return '';
  const candidates = [
    ev.beginDatum,
    ev.startDatum,
    ev.startdatum,
    ev.startDate,
    ev.start,
    ev.datum,
    ev.date,
    ev?.planning?.start,
    ev?.planning?.begin
  ];
  for (const value of candidates) {
    const ymd = toYMD(value);
    if (ymd) return ymd;
  }
  return '';
}

function getEventEndYMD(ev) {
  if (!ev || typeof ev !== 'object') return '';
  const candidates = [
    ev.eindDatum,
    ev.endDatum,
    ev.enddatum,
    ev.eindDate,
    ev.endDate,
    ev.eind,
    ev?.planning?.end,
    ev?.planning?.finish
  ];
  for (const value of candidates) {
    const ymd = toYMD(value);
    if (ymd) return ymd;
  }
  return '';
}

function toCheeseTotals(raw) {
  if (!raw || typeof raw !== 'object') return { BG: 0, ROOK: 0, GEIT: 0 };
  const source = raw.categories && typeof raw.categories === 'object' ? raw.categories : raw;
  return {
    BG: toSafeNumber(source?.BG ?? source?.bg),
    ROOK: toSafeNumber(source?.ROOK ?? source?.rook),
    GEIT: toSafeNumber(source?.GEIT ?? source?.geit)
  };
}

function toSafeNumber(val) {
  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
}

function renderStartChip(ev) {
  const totals = toCheeseTotals(ev?.kaasTelling?.start);
  const hasStart = Object.values(totals).some(v => Number.isFinite(v) && v > 0);
  return hasStart
    ? '<span class="chip ok">✔︎</span>'
    : '<span class="chip warn">Ontbreekt</span>';
}

function renderSupplementChip(ev) {
  const list = Array.isArray(ev?.kaasTelling?.supplements) ? ev.kaasTelling.supplements : [];
  if (!list.length) return '<span class="chip muted">—</span>';
  return `<span class="chip info">${list.length}x</span>`;
}

function renderOmzetChip(ev) {
  const count = Array.isArray(ev?.omzet) ? ev.omzet.length : 0;
  if (count === 0) return '<span class="chip warn">Ontbreekt</span>';
  return `<span class="chip ok">${count}</span>`;
}

// ---------- Closed/guard helpers ----------

function isClosed(ev) {
  const state = String(ev?.state || '').toLowerCase();
  return ev?.afgerond === true || state === 'closed' || state === 'afgesloten';
}

function openAddCostMiniModal(eventId) {
  const { box, close } = createModal({});
  box.innerHTML = `
    <button class="modal-close" aria-label="Sluiten">✕</button>
    <h3>Kosten toevoegen</h3>
    <div class="ev-form">
      <label>Omschrijving* <input id="kOms" required></label>
      <div class="grid2">
        <label>Bedrag (€)* <input id="kAmt" type="number" step="0.01" min="0" required></label>
        <label>Betaalmethode <input id="kHow" placeholder="cash/pin/…"></label>
      </div>
      <label>Notitie <input id="kNote"></label>
    </div>
    <div class="ev-actions">
      <button class="btn" id="kCancel">Annuleren</button>
      <button class="btn primary" id="kSave">Opslaan</button>
    </div>
  `;
  box.querySelector('.modal-close')?.addEventListener('click', close);
  box.querySelector('#kCancel')?.addEventListener('click', close);
  box.querySelector('#kSave')?.addEventListener('click', async () => {
    const oms = box.querySelector('#kOms')?.value.trim();
    const amt = Number(box.querySelector('#kAmt')?.value);
    const how = box.querySelector('#kHow')?.value.trim();
    const note = box.querySelector('#kNote')?.value.trim();
    if (!oms || !(amt >= 0)) return showAlert('Vul omschrijving en bedrag in.', 'warning');
    await addCostToClosedEvent(eventId, { omschrijving: oms, bedrag: amt, methode: how, notitie: note });
    close();
  });
}

// ---------- Utils & styles ----------

function toNLDate(s) { try { return new Date(s).toLocaleDateString('nl-NL'); } catch { return ''; } }
function toYMD(s) { if (!s) return ''; const d = new Date(s); if (isNaN(d)) return ''; return toLocalYMD(d); }
function toLocalYMD(d) {
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function isInRangeYMD(t, a, b) { if (!t) return false; a = a || t; b = b || t; return a <= t && t <= b; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function slug(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  const css = `
  .ev-modal .modal-box{width:min(92vw,900px)}
  .ev-modal-body{max-height:65vh; overflow-y:auto; padding:0 .25rem .5rem}
  .ev-headerbar{display:flex; align-items:center; justify-content:space-between; gap:.6rem; margin:.2rem 0 .4rem}
  .ev-explorer{display:flex; flex-direction:column; gap:.75rem}
  .ev-controls{display:flex; flex-direction:column; gap:.6rem}
  .ev-segments{display:flex; flex-wrap:wrap; gap:.35rem}
  .ev-segment{border:none; border-radius:999px; padding:.35rem .85rem; font-weight:800; font-size:.82rem; background:#f3f4f6; color:#4b5563; cursor:pointer}
  .ev-segment.is-active{background:#2A9626; color:#fff; box-shadow:0 5px 12px rgba(42,150,38,.25)}
  .ev-search{width:100%; padding:.5rem .7rem; border:1px solid #d1d5db; border-radius:10px; font-size:.9rem}
  .ev-card-grid{display:flex; flex-direction:column; gap:.9rem}
  .ev-card{background:#fff; border-radius:1rem; padding:1rem; box-shadow:0 10px 20px rgba(15,23,42,.08); display:flex; flex-direction:column; gap:.75rem}
  .ev-card header{display:flex; justify-content:space-between; gap:.8rem}
  .ev-card__eyebrow{text-transform:uppercase; font-size:.72rem; color:#6b7280; margin:0 0 .15rem}
  .ev-card__meta{margin:.15rem 0 0; color:#4b5563; font-size:.9rem}
  .ev-card__badge{align-self:flex-start; padding:.25rem .65rem; border-radius:999px; font-weight:800; font-size:.72rem; letter-spacing:.05em}
  .ev-card__badge--active{background:rgba(42,150,38,.12); color:#1f5a21}
  .ev-card__badge--planned{background:rgba(255,197,0,.18); color:#7c5f00}
  .ev-card__badge--closed{background:rgba(231,76,60,.15); color:#b02a1c}
  .ev-card__body{display:flex; flex-direction:column; gap:.35rem}
  .ev-card__row{display:flex; justify-content:space-between; font-size:.9rem; font-weight:600; color:#1f2937}
  .ev-card__row span{color:#6b7280; font-weight:600}
  .ev-card__chips{display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:.45rem; font-size:.8rem}
  .ev-card__chips div{background:#f9fafb; border-radius:.75rem; padding:.4rem .6rem; display:flex; flex-direction:column; gap:.15rem}
  .ev-card__chips span{color:#6b7280; font-size:.72rem; font-weight:700}
  .ev-card footer{display:flex; flex-wrap:wrap; gap:.5rem}
  .ev-card button{cursor:pointer}
  .ev-empty{padding:1rem; background:#f9fafb; border-radius:12px; text-align:center; font-weight:700; color:#6b7280}
  .btn{padding:.4rem .7rem; border:1px solid #ddd; border-radius:8px; background:#fff; cursor:pointer}
  .btn.primary{background:#2A9626; color:#fff; border-color:#2A9626}
  .btn.tiny{padding:.15rem .45rem; font-size:.85rem; border-radius:999px}
  .chip{display:inline-flex; align-items:center; justify-content:center; padding:.1rem .5rem; border-radius:999px; font-size:.72rem; font-weight:700; min-width:48px}
  .chip.ok{background:#e6f6e6; color:#1F6D1C}
  .chip.warn{background:#fdecea; color:#C62828}
  .chip.info{background:#e8f0ff; color:#1a3c8a}
  .chip.muted{background:#f3f3f3; color:#666}
  .muted{color:#777}
  .ev-form{display:flex; flex-direction:column; gap:.5rem; margin:.4rem 0}
  .ev-form label{display:flex; flex-direction:column; gap:.25rem; font-weight:700}
  .ev-form input, .ev-form select, .ev-form textarea{padding:.45rem .55rem; border:1px solid #ddd; border-radius:8px}
  .grid2{display:grid; grid-template-columns:1fr 1fr; gap:.5rem}
  .ev-actions{display:flex; justify-content:flex-end; gap:.5rem; margin-top:.6rem}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  stylesInjected = true;
}
