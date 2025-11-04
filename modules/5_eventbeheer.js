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
  root.innerHTML = `
    <div class="ev-headerbar">
      <h3>Evenementen</h3>
      <button class="btn primary" id="evNewBtn">+ Nieuw evenement</button>
    </div>
    ${buildTableHTML(list)}
  `;
  root.querySelector('#evNewBtn')?.addEventListener('click', openCreateEventModal);
  bindRowClicks(root.querySelector('tbody'));
  wireSearch(root, list);
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
    <input id="evSearch" class="ev-search" type="search" placeholder="Zoek op naam of locatie…" aria-label="Zoeken" />
    <div class="ev-table-wrap">
      ${buildTableHTML(list)}
    </div>
  `;
  box.querySelector('.modal-close')?.addEventListener('click', close);
  box.querySelector('#evNewBtn')?.addEventListener('click', () => {
    close();
    openCreateEventModal();
  });

  const tbody = box.querySelector('tbody');
  bindRowClicks(tbody);

  // live filter
  const input = box.querySelector('#evSearch');
  input?.addEventListener('input', () => {
    const q = (input.value || '').trim().toLowerCase();
    const filtered = list.filter(e => {
      const hay = `${e.naam || ''} ${e.locatie || ''} ${e.type || ''}`.toLowerCase();
      return hay.includes(q);
    });
    box.querySelector('.ev-table-wrap').innerHTML = buildTableHTML(filtered);
    bindRowClicks(box.querySelector('tbody'));
  });
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

function buildTableHTML(list) {
  if (!list.length) {
    return `
      <div class="ev-toolbar">
        <input class="ev-search" type="search" placeholder="Zoek op naam of locatie…" aria-label="Zoeken" />
      </div>
      <table class="ev-tbl"><tbody><tr><td class="muted">Geen evenementen gevonden</td></tr></tbody></table>`;
  }
    const rows = list.map(e => {
        const periode = formatRange(e);
        const closed = isClosed(e);
        const badge = closed
            ? '<span class="badge closed">AFGESLOTEN</span>'
            : (String(e.state || '').toLowerCase() === 'active'
                ? '<span class="badge open">ACTIVE</span>'
                : '<span class="badge planned">PLANNED</span>');
        const startChip = renderStartChip(e);
        const supplementChip = renderSupplementChip(e);
        const omzetChip = renderOmzetChip(e);
        return `
          <tr class="ev-row ${closed ? 'is-closed' : ''}" data-id="${escapeHtml(e.id)}" data-name="${escapeHtml(e.naam)}">
            <td class="ev-name">${escapeHtml(e.naam)}</td>
            <td>${escapeHtml(e.locatie || '')}</td>
            <td>${escapeHtml(e.type || '')}</td>
            <td>${escapeHtml(periode)}</td>
            <td class="ev-chip">${startChip}</td>
            <td class="ev-chip">${supplementChip}</td>
            <td class="ev-chip">${omzetChip}</td>
            <td>${badge}</td>
            <td>
              ${'<button class="btn tiny ghost ev-details">Details →</button>'}
              ${closed ? '<button class="btn tiny ghost ev-addcost">+ kosten</button>' : ''}
            </td>
      </tr>
    `;
  }).join('');
  return `
    <div class="ev-toolbar">
      <input class="ev-search" type="search" placeholder="Zoek op naam of locatie…" aria-label="Zoeken" />
    </div>
    <table class="ev-tbl">
      <thead>
        <tr><th>Naam</th><th>Locatie</th><th>Type</th><th>Periode</th><th>Starttelling</th><th>Aanvullingen</th><th>Dagomzet</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function bindRowClicks(tbody) {
  if (!tbody) return;
  tbody.querySelectorAll('.ev-row').forEach(row => {
    const eventRef = row.dataset.id || row.dataset.name;
    const closed = row.classList.contains('is-closed');

    row.addEventListener('click', async (e) => {
      if (e.target && (e.target.closest('.ev-details') || e.target.closest('.ev-addcost'))) return;
      await openDetailsSafe(eventRef);
    });

    row.querySelector('.ev-details')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await openDetailsSafe(eventRef);
    });

    if (closed) {
      row.querySelector('.ev-addcost')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openAddCostMiniModal(eventRef);
      });
    }
  });
}

async function openDetailsSafe(eventRef) {
  try {
    await openEventDetail(eventRef);
  } catch (err) {
    console.error('[Eventbeheer] openEventDetail error:', err);
    showAlert('Kon eventdetails niet openen. Controleer de details-module.', 'error');
  }
}

function wireSearch(root, list) {
  const search = root.querySelector('.ev-search');
  const wrap = root.querySelector('.ev-table-wrap') || root;
  search?.addEventListener('input', () => {
    const q = (search.value || '').trim().toLowerCase();
    const filtered = list.filter(e => {
      const hay = `${e.naam || ''} ${e.locatie || ''} ${e.type || ''}`.toLowerCase();
      return hay.includes(q);
    });
    wrap.innerHTML = buildTableHTML(filtered);
    bindRowClicks(wrap.querySelector('tbody'));
  });
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
  .ev-headerbar{display:flex; align-items:center; justify-content:space-between; gap:.6rem; margin:.2rem 0 .4rem}
  .ev-search{width:100%; margin:.4rem 0 .6rem; padding:.45rem .6rem; border:1px solid #ddd; border-radius:8px;}
  .ev-table-wrap{max-height:65vh; overflow:auto}
  .ev-tbl{width:100%; border-collapse:collapse; background:#fff; border-radius:10px; overflow:hidden}
  .ev-tbl th,.ev-tbl td{border-bottom:1px solid #eee; padding:.45rem .5rem; text-align:left}
  .ev-row{cursor:pointer}
  .ev-row:hover{background:#fafafa}
  .ev-row.is-closed{opacity:.7; cursor:default}
  .ev-name{font-weight:800}
  .ev-chip{text-align:center}
  .btn{padding:.4rem .7rem; border:1px solid #ddd; border-radius:8px; background:#fff; cursor:pointer}
  .btn.primary{background:#2A9626; color:#fff; border-color:#2A9626}
  .btn.tiny{padding:.15rem .45rem; font-size:.85rem; border-radius:999px}
  .badge{display:inline-flex; align-items:center; padding:.05rem .45rem; border-radius:999px; font-size:.75rem; color:#fff}
  .badge.open{background:#2A9626}
  .badge.closed{background:#777}
  .badge.planned{background:#1976D2}
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
