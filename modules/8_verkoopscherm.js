// 📦 8_verkoopscherm.js – datumgestuurde dagomzetregistratie zonder sessies

import { store } from './store.js';
import { showAlert, createModal } from './4_ui.js';
import { saveDagOmzet, updateDagOmzet, deleteDagOmzet, getEventOmzet } from './3_data.js';

const PENDING_STORAGE_KEY = 'olga-pos.pendingDagomzet.v1';

let selectedDate = null;
let editingEntryId = null;
let onlineListenerBound = false;
let flushInFlight = false;
let modalInstance = null;

function escapeHtml(value) {
  return (value ?? '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function resolveEntryDebtor(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.debtor === 'boolean') return entry.debtor;
  const method = (entry.paymentMethod || entry.pm || '').toString().toUpperCase();
  return method === 'DEBTOR' || method === 'DEBITEUR' || method === 'INVOICE' || method === 'FACTUUR';
}

function injectStylesOnce() {
  if (document.getElementById('dagomzetStyles')) return;
  const css = `
    .dagomzet-modal {
      width: min(760px, calc(100vw - 2rem));
      max-height: min(90vh, 780px);
      padding: 0;
      background: transparent;
      display: flex;
    }
    .dagomzet-modal-body {
      background: #fff;
      border-radius: 22px;
      padding: 1.5rem;
      box-shadow: 0 18px 36px rgba(15, 23, 42, 0.18);
      overflow-y: auto;
      max-height: min(90vh, 780px);
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .dagomzet-card {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .dagomzet-header {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .dagomzet-header-bar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
    }
    .dagomzet-header h2 {
      margin: 0;
      font-size: 1.5rem;
      line-height: 1.2;
    }
    .dagomzet-subtitle {
      color: #4b5563;
      font-size: 0.95rem;
    }
    .dagomzet-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      color: #4b5563;
      font-size: 0.9rem;
    }
    .dagomzet-meta span strong {
      color: #111827;
      font-weight: 600;
    }
    .dagomzet-close-btn {
      background: rgba(15, 23, 42, 0.05);
      border: none;
      border-radius: 999px;
      color: #1f2937;
      font-weight: 600;
      padding: 0.45rem 0.9rem;
      cursor: pointer;
    }
    .dagomzet-close-btn:hover {
      background: rgba(15, 23, 42, 0.12);
    }
    .dagomzet-close-btn:focus-visible {
      outline: 2px solid #2A9626;
      outline-offset: 2px;
    }
    .dagomzet-pending-banner {
      background: #fef3c7;
      border: 1px solid #f59e0b;
      color: #92400e;
      padding: 0.75rem 1rem;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 0.65rem;
      font-size: 0.95rem;
    }
    .dagomzet-timeline {
      display: flex;
      gap: 0.5rem;
      overflow-x: auto;
      padding-bottom: 0.25rem;
    }
    .dagomzet-timeline button {
      border: 1px solid #e5e7eb;
      border-radius: 999px;
      padding: 0.45rem 0.9rem;
      background: #f8fafc;
      color: #1f2937;
      font-size: 0.9rem;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      min-width: 136px;
      text-align: left;
      gap: 0.2rem;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .dagomzet-timeline button:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 12px rgba(15, 23, 42, 0.08);
    }
    .dagomzet-timeline button.active {
      background: #2A9626;
      border-color: #237a20;
      color: #fff;
      box-shadow: 0 0 0 2px rgba(42, 150, 38, 0.15);
    }
    .dagomzet-timeline button .label {
      font-weight: 600;
    }
    .dagomzet-timeline button .amounts {
      font-size: 0.78rem;
      opacity: 0.85;
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }
    .dagomzet-timeline button.pending::after {
      content: '⏳';
      margin-left: auto;
      font-size: 0.85rem;
    }
    .dagomzet-summary {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      font-size: 0.95rem;
      color: #111827;
    }
    .dagomzet-summary span {
      background: #f1f5f9;
      border-radius: 999px;
      padding: 0.45rem 0.9rem;
      font-weight: 600;
      display: inline-flex;
      gap: 0.35rem;
      align-items: center;
    }
    .dagomzet-summary span strong {
      font-weight: 700;
    }
    .dagomzet-form {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      align-items: start;
    }
    .dagomzet-form .field {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .dagomzet-form .checkbox-field {
      flex-direction: column;
      align-items: flex-start;
    }
    .dagomzet-form .checkbox-field label {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
    }
    .dagomzet-form .checkbox-field input[type="checkbox"] {
      width: auto;
      height: auto;
    }
    .dagomzet-form label {
      font-weight: 600;
      color: #1f2937;
    }
    .dagomzet-currency-label {
      font-weight: 700;
      margin-left: 0.4rem;
      color: #143814;
    }
    .dagomzet-form small {
      color: #6b7280;
      font-size: 0.8rem;
    }
    .dagomzet-form input,
    .dagomzet-form select,
    .dagomzet-form textarea {
      border: 1px solid #d1d5db;
      border-radius: 10px;
      padding: 0.55rem 0.65rem;
      font-size: 1rem;
      font-family: inherit;
      background: #fff;
    }
    .dagomzet-form textarea {
      resize: vertical;
      min-height: 80px;
    }
    .dagomzet-form .actions {
      grid-column: 1 / -1;
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .dagomzet-form button[type="submit"] {
      background: #2A9626;
      color: #fff;
      border: none;
      border-radius: 999px;
      padding: 0.6rem 1.6rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s ease;
    }
    .dagomzet-form button[type="submit"]:hover:not([disabled]) {
      background: #257f22;
    }
    .dagomzet-form button[type="button"] {
      background: #e5e7eb;
      border: none;
      border-radius: 999px;
      padding: 0.6rem 1.4rem;
      font-weight: 600;
      cursor: pointer;
    }
    .dagomzet-form button[disabled] {
      opacity: 0.6;
      cursor: progress;
    }
    .dagomzet-table table {
      width: 100%;
      border-collapse: collapse;
    }
    .dagomzet-table th,
    .dagomzet-table td {
      padding: 0.55rem 0.4rem;
      border-bottom: 1px solid #f1f5f9;
      text-align: left;
      font-size: 0.95rem;
    }
    .dagomzet-table th.amount {
      text-align: right;
    }
    .dagomzet-table td.amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .dagomzet-table tr.pending td {
      opacity: 0.75;
    }
    .dagomzet-table button.link {
      background: none;
      border: none;
      color: #2563eb;
      cursor: pointer;
      font-weight: 600;
      padding: 0;
    }
    .dagomzet-empty,
    .dagomzet-state {
      background: #f8fafc;
      border-radius: 14px;
      padding: 1.1rem;
      color: #1f2937;
    }
    .dagomzet-state button {
      margin-top: 0.85rem;
      background: #2A9626;
      color: #fff;
      border: none;
      border-radius: 999px;
      padding: 0.55rem 1.3rem;
      font-weight: 600;
      cursor: pointer;
    }
  `;
  const style = document.createElement('style');
  style.id = 'dagomzetStyles';
  style.textContent = css;
  document.head.appendChild(style);
}

function isModalOpen() {
  return Boolean(modalInstance?.mount && modalInstance.mount.isConnected);
}

function ensureModalShell() {
  if (isModalOpen()) {
    return modalInstance;
  }

  const { overlay, box, close } = createModal({
    onClose: () => {
      modalInstance = null;
      const dashboardMount = document.getElementById('salesMount');
      if (dashboardMount) dashboardMount.innerHTML = '';
    }
  });

  box.classList.add('dagomzet-modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.innerHTML = '<div class="dagomzet-modal-body" id="dagomzetModalBody"></div>';
  const mount = box.querySelector('.dagomzet-modal-body');
  modalInstance = { overlay, box, close, mount };
  return modalInstance;
}

function closeDagomzetModal() {
  if (!modalInstance) return;
  const handle = modalInstance;
  modalInstance = null;
  try {
    handle.close();
  } catch (err) {
    console.warn('[POS] dagomzetmodal sluiten mislukt', err);
  }
}

function ensureOnlineListener() {
  if (onlineListenerBound) return;
  onlineListenerBound = true;
  window.addEventListener('online', () => flushPendingQueue().catch(err => console.warn('[POS] flush online failed', err)));
}

function loadPendingJobs() {
  try {
    const raw = localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistPendingJobs(jobs) {
  try {
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(jobs));
  } catch (err) {
    console.warn('[POS] kon pending dagomzet niet bewaren', err);
  }
}

function getPendingJobsForEvent(eventId) {
  return loadPendingJobs().filter(job => job.eventId === eventId);
}

function enqueuePendingJob(job) {
  const jobs = loadPendingJobs();
  jobs.push({ ...job, createdAt: job.createdAt || new Date().toISOString() });
  persistPendingJobs(jobs);
}

async function flushPendingQueue() {
  if (flushInFlight) return;
  if (!navigator.onLine) return;
  const jobs = loadPendingJobs();
  if (!jobs.length) return;
  flushInFlight = true;
  try {
    while (jobs.length) {
      const job = jobs[0];
      try {
        if (job.type === 'create') {
          const payload = { ...job.payload, pending: false };
          await saveDagOmzet(job.eventId, payload, { forceId: job.entryId });
        } else if (job.type === 'update') {
          const payload = { ...job.payload, pending: false };
          await updateDagOmzet(job.eventId, job.entryId, payload, { markPending: false });
        } else if (job.type === 'delete') {
          await deleteDagOmzet(job.eventId, job.entryId);
        }
        jobs.shift();
        persistPendingJobs(jobs);
      } catch (err) {
        console.warn('[POS] flush van dagomzet mislukt', err);
        break;
      }
    }
  } finally {
    flushInFlight = false;
    renderSalesUI();
  }
}

function parseMoney(value) {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100;
}

function parseExchangeRate(value) {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 10000) / 10000;
}

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€' };

function getCurrencySymbol(code) {
  const key = String(code || '').toUpperCase();
  return CURRENCY_SYMBOLS[key] || '';
}

function normalizeCurrencyCode(value, fallback = 'USD') {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'EUR' || normalized === 'USD') return normalized;
  const fallbackCode = String(fallback || '').trim().toUpperCase();
  return fallbackCode === 'EUR' ? 'EUR' : 'USD';
}

function formatExchangeRate(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return '';
  return (Math.round(rate * 10000) / 10000).toFixed(4);
}

function resolveCurrencyContext(activeDay) {
  const primaryCurrency = String(activeDay?.currency || 'USD').toUpperCase();
  const primaryField = primaryCurrency === 'EUR' ? 'eur' : 'usd';
  const secondaryField = primaryField === 'usd' ? 'eur' : 'usd';
  const secondaryCurrency = primaryCurrency === 'EUR' ? 'USD' : 'EUR';
  return { currency: primaryCurrency, secondaryCurrency, primaryField, secondaryField };
}

function formatCurrency(amount, symbol) {
  if (amount == null || Number.isNaN(amount)) return `${symbol}0.00`;
  return `${symbol}${(Math.round(amount * 100) / 100).toFixed(2)}`;
}

function formatDateLabel(ymd) {
  if (!ymd) return 'Onbekend';
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day) return ymd;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return ymd;
  return date.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' });
}

function formatRange(range) {
  if (!range?.start && !range?.end) return 'Geen datum ingesteld';
  if (range.start === range.end) return formatDateLabel(range.start);
  return `${formatDateLabel(range.start)} – ${formatDateLabel(range.end)}`;
}

function getActiveEventContext() {
  const activeDay = store.getActiveEventDay?.();
  if (!activeDay) return { activeDay: null, event: null, eventId: null };
  const events = Array.isArray(store.state.db?.evenementen) ? store.state.db.evenementen : [];
  const targetId = activeDay.eventId != null ? String(activeDay.eventId) : null;
  const targetName = activeDay.eventName ? String(activeDay.eventName) : null;
  const event = events.find(ev => {
    const eventId = ev.id ?? ev.uuid ?? ev.slug ?? ev.naam;
    const normalizedId = eventId != null ? String(eventId) : null;
    const normalizedName = ev.naam ? String(ev.naam) : null;
    return (targetId && normalizedId === targetId) || (targetName && normalizedName === targetName);
  }) || null;
  const eventId = event?.id ?? (targetId ?? event?.naam ?? null);
  return { activeDay, event, eventId };
}

function normalizeDate(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getEventRange(event, activeDay) {
  const start = normalizeDate(activeDay?.range?.start || event?.beginDatum || event?.startdatum || event?.startDate || event?.start);
  const end = normalizeDate(activeDay?.range?.end || event?.eindDatum || event?.einddatum || event?.endDate || event?.end);
  const safeStart = start || normalizeDate(activeDay?.date) || end;
  const safeEnd = end || safeStart;
  return { start: safeStart, end: safeEnd };
}

function ensureDateInRange(value, range) {
  const target = normalizeDate(value || range.start || range.end);
  if (!target) return '';
  if (!range.start || !range.end) return target;
  if (target < range.start) return range.start;
  if (target > range.end) return range.end;
  return target;
}

function buildDateList(range) {
  const list = [];
  if (!range.start) return list;
  const start = new Date(range.start + 'T00:00:00');
  const end = range.end ? new Date(range.end + 'T00:00:00') : start;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return list;
  const cursor = new Date(start);
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    list.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
    if (list.length > 120) break;
  }
  return list;
}

function computeTotalsByDay(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!entry?.date) continue;
    if (!map.has(entry.date)) map.set(entry.date, { usd: 0, eur: 0, pending: 0 });
    const target = map.get(entry.date);
    if (Number.isFinite(entry.usd)) target.usd += entry.usd;
    if (Number.isFinite(entry.eur)) target.eur += entry.eur;
    if (entry.pending) target.pending += 1;
  }
  return map;
}

function renderPendingBanner(count) {
  if (!count) return '';
  return `<div class="dagomzet-pending-banner">⏳ ${count} omzetregistratie${count === 1 ? '' : 's'} wachten op synchronisatie.</div>`;
}

function renderTimeline(days, totals, activeDate, primaryField, secondaryField, primaryCurrency, secondaryCurrency) {
  if (!days.length) return '';
  return `
    <div class="dagomzet-timeline">
      ${days.map(day => {
        const data = totals.get(day) || { usd: 0, eur: 0, pending: 0 };
        const classes = [day === activeDate ? 'active' : '', data.pending ? 'pending' : ''].filter(Boolean).join(' ');
        const primaryValue = formatCurrency(data[primaryField], getCurrencySymbol(primaryCurrency));
        const secondaryValue = formatCurrency(data[secondaryField], getCurrencySymbol(secondaryCurrency));
        return `
          <button type="button" data-date="${day}" class="${classes}">
            <span class="label">${formatDateLabel(day)}</span>
            <span class="amounts">
              <span>${primaryValue} ${primaryCurrency}</span>
              <span>${secondaryValue} ${secondaryCurrency}</span>
            </span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderSummary(totalsForDay, primaryField, secondaryField, primaryCurrency, secondaryCurrency) {
  if (!totalsForDay) return '';
  const primaryValue = formatCurrency(totalsForDay[primaryField], getCurrencySymbol(primaryCurrency));
  const secondaryValue = formatCurrency(totalsForDay[secondaryField], getCurrencySymbol(secondaryCurrency));
  return `
    <div class="dagomzet-summary">
      <span><strong>${primaryValue}</strong> ${primaryCurrency}</span>
      <span><strong>${secondaryValue}</strong> ${secondaryCurrency}</span>
      ${totalsForDay.pending ? `<span>⏳ ${totalsForDay.pending} in wachtrij</span>` : ''}
    </div>
  `;
}

function renderEntries(entries, primaryField, secondaryField, primaryCurrency, secondaryCurrency) {
  if (!entries.length) {
    return '<div class="dagomzet-empty">Nog geen omzet voor deze dag vastgelegd.</div>';
  }
  const rows = entries.map(entry => {
    const cls = entry.pending ? 'pending' : '';
    const primaryValue = formatCurrency(entry?.[primaryField], getCurrencySymbol(primaryCurrency));
    const secondaryValue = formatCurrency(entry?.[secondaryField], getCurrencySymbol(secondaryCurrency));
    const rateLabel = formatExchangeRate(entry?.exchangeRate);
    const debtorLabel = resolveEntryDebtor(entry) ? 'Ja' : 'Nee';
    return `
      <tr class="${cls}">
        <td>${formatDateLabel(entry.date)}</td>
        <td>${escapeHtml(entry.note || '')}</td>
        <td>${debtorLabel}</td>
        <td class="amount">${primaryValue} ${primaryCurrency}</td>
        <td class="amount">${secondaryValue} ${secondaryCurrency}</td>
        <td>${rateLabel ? `1 USD = € ${rateLabel}` : '—'}</td>
        <td>
          <button type="button" class="link" data-action="edit" data-entry="${entry.id}">✏️ Bewerken</button>
          <button type="button" class="link" data-action="delete" data-entry="${entry.id}">🗑️ Verwijderen</button>
        </td>
      </tr>
    `;
  }).join('');
  return `
    <div class="dagomzet-table">
      <table>
        <thead>
          <tr>
            <th>Datum</th>
            <th>Notitie</th>
            <th>Debiteur</th>
            <th class="amount">${primaryCurrency}</th>
            <th class="amount">${secondaryCurrency}</th>
            <th>Koers</th>
            <th>Acties</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderNoActiveState() {
  return `
    <div class="dagomzet-state">
      <p>Geen actieve dag geselecteerd. Kies een evenement in het dashboard om dagomzet te registreren.</p>
      <button type="button" id="openEventsPanel">Ga naar evenementen</button>
    </div>
  `;
}

function renderMissingEventState() {
  return `
    <div class="dagomzet-state">
      <p>Het geselecteerde evenement is niet gevonden in de lokale data.</p>
      <button type="button" id="reloadDataBtn">Data opnieuw laden</button>
    </div>
  `;
}

async function performPersist(action, context, payload, entryId = null) {
  const { eventId } = context;
  if (!eventId) return { queued: false };
  const offline = !navigator.onLine;
  if (!offline) {
    try {
      if (action === 'create') {
        await saveDagOmzet(eventId, payload);
      } else if (action === 'update') {
        await updateDagOmzet(eventId, entryId, payload);
      } else if (action === 'delete') {
        await deleteDagOmzet(eventId, entryId);
      }
      await flushPendingQueue();
      return { queued: false };
    } catch (err) {
      console.warn('[POS] dagomzet bewaren faalde, val terug op offline queue', err);
    }
  }

  if (action === 'create') {
    const entry = await saveDagOmzet(eventId, payload, { skipPersist: true, markPending: true });
    enqueuePendingJob({ type: 'create', eventId, entryId: entry.id, payload: { ...payload, id: entry.id } });
  } else if (action === 'update') {
    await updateDagOmzet(eventId, entryId, { ...payload, pending: true }, { skipPersist: true, markPending: true });
    enqueuePendingJob({ type: 'update', eventId, entryId, payload: { ...payload } });
  } else if (action === 'delete') {
    const removed = await deleteDagOmzet(eventId, entryId, { skipPersist: true });
    enqueuePendingJob({ type: 'delete', eventId, entryId, payload: removed ? { ...removed } : {} });
  }
  showAlert('Offline opgeslagen – synchroniseert zodra je weer online bent.', 'info');
  await flushPendingQueue();
  return { queued: true };
}

async function handleFormSubmit(form, context) {
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn?.setAttribute('disabled', 'true');
  try {
    const data = new FormData(form);
    let date = normalizeDate(data.get('date'));
    if (!date) date = context.activeDay?.date || selectedDate;
    const currencyContext = resolveCurrencyContext(context.activeDay);
    const { currency: primaryCurrency } = currencyContext;
    const inputCurrency = normalizeCurrencyCode(data.get('inputCurrency'), primaryCurrency);
    const amount = parseMoney(data.get('amount'));
    const exchangeRate = parseExchangeRate(data.get('exchangeRate'));
    const note = (data.get('note') || '').toString().trim();
    const debtor = data.has('debtor');

    if (amount == null) {
      showAlert(`Voer een bedrag in (${inputCurrency}).`, 'warning');
      return;
    }
    if (exchangeRate == null) {
      showAlert('Voer een geldige wisselkoers (1 USD = € …) in.', 'warning');
      return;
    }

    let usd = null;
    let eur = null;
    if (inputCurrency === 'USD') {
      usd = amount;
      eur = Math.round(amount * exchangeRate * 100) / 100;
    } else {
      eur = amount;
      usd = Math.round((amount / exchangeRate) * 100) / 100;
    }

    const payload = { date, usd, eur, note, debtor, exchangeRate, inputCurrency };
    if (editingEntryId) {
      await performPersist('update', context, payload, editingEntryId);
      editingEntryId = null;
      showAlert('Dagomzet bijgewerkt.', 'success');
    } else {
      await performPersist('create', context, payload);
      showAlert('Dagomzet opgeslagen.', 'success');
    }
    selectedDate = date;
    form.reset();
    renderSalesUI();
  } catch (err) {
    console.error('[POS] dagomzet formulier mislukt', err);
    showAlert('Opslaan van dagomzet mislukt.', 'error');
  } finally {
    submitBtn?.removeAttribute('disabled');
  }
}

async function handleDelete(entryId, context) {
  if (!entryId) return;
  if (!window.confirm('Weet je zeker dat je deze dagomzet wilt verwijderen?')) return;
  await performPersist('delete', context, {}, entryId);
  if (editingEntryId === entryId) editingEntryId = null;
  showAlert('Dagomzet verwijderd.', 'success');
  renderSalesUI();
}

function applyCurrencyPickerBehavior(form) {
  if (!form) return;
  const select = form.querySelector('#dagCurrency');
  const amountLabel = form.querySelector('[data-role="amount-label"]');
  const conversionNote = form.querySelector('[data-role="conversion-note"]');
  if (!select || !amountLabel) return;

  const update = () => {
    const code = normalizeCurrencyCode(select.value, 'USD');
    amountLabel.textContent = `${getCurrencySymbol(code)} ${code}`;
    if (conversionNote) {
      const other = code === 'EUR' ? 'USD' : 'EUR';
      conversionNote.textContent = `${other} wordt automatisch omgerekend.`;
    }
  };

  select.addEventListener('change', update);
  update();
}

function bindActions(mount, context) {
  mount.querySelector('[data-role="close-modal"]')?.addEventListener('click', () => {
    closeDagomzetModal();
  });

  mount.querySelectorAll('.dagomzet-timeline button[data-date]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedDate = btn.dataset.date;
      editingEntryId = null;
      renderSalesUI();
    });
  });

  const form = mount.querySelector('#dagomzetForm');
  if (form) {
    applyCurrencyPickerBehavior(form);
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      handleFormSubmit(form, context);
    });
    form.querySelector('#cancelEdit')?.addEventListener('click', () => {
      editingEntryId = null;
      form.reset();
      renderSalesUI();
    });
  }

  mount.querySelectorAll('button[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      editingEntryId = btn.dataset.entry;
      renderSalesUI();
    });
  });

  mount.querySelectorAll('button[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.entry, context));
  });

  mount.querySelector('#openEventsPanel')?.addEventListener('click', () => {
    const eventsButton = document.querySelector('#appBottomBar button[data-action="events"]');
    if (eventsButton) {
      eventsButton.click();
    } else {
      showAlert('Open het evenementenpaneel via de navigatie.', 'info');
    }
  });

  mount.querySelector('#reloadDataBtn')?.addEventListener('click', () => {
    window.location.reload();
  });
}

export async function renderSalesUI(forceOpen = false) {
  injectStylesOnce();
  ensureOnlineListener();
  if (navigator.onLine) {
    flushPendingQueue().catch(err => console.warn('[POS] flush bij render faalde', err));
  }

  const dashboardMount = document.getElementById('salesMount');
  if (dashboardMount) dashboardMount.innerHTML = '';

  const context = getActiveEventContext();
  if (!forceOpen && !isModalOpen()) {
    return false;
  }

  if (!context.activeDay) {
    if (forceOpen) {
      showAlert('Geen actieve dag om omzet voor te registreren.', 'warning');
    }
    closeDagomzetModal();
    return false;
  }

  const modal = ensureModalShell();
  if (!modal?.mount) return false;
  const { box, mount } = modal;
  box.setAttribute('aria-labelledby', 'dagomzetModalTitle');

  if (!context.eventId || !context.event) {
    mount.innerHTML = `
      <section class="dagomzet-card">
        <header class="dagomzet-header">
          <div class="dagomzet-header-bar">
            <div>
              <h2 id="dagomzetModalTitle">Dagomzet</h2>
              <div class="dagomzet-subtitle">Geen evenement gevonden</div>
            </div>
            <button type="button" class="dagomzet-close-btn" data-role="close-modal">Sluiten ✕</button>
          </div>
        </header>
        ${renderMissingEventState()}
      </section>
    `;
    bindActions(mount, context);
    return true;
  }

  const range = getEventRange(context.event, context.activeDay);
  selectedDate = ensureDateInRange(selectedDate || context.activeDay.date, range);
  const allEntries = getEventOmzet(context.eventId);
  const totalsByDay = computeTotalsByDay(allEntries);
  const dayList = buildDateList(range);
  const entriesForDay = allEntries.filter(entry => entry.date === selectedDate);
  const editingEntry = entriesForDay.find(entry => entry.id === editingEntryId) || null;
  const pendingJobs = getPendingJobsForEvent(context.eventId);
  const totalsForSelected = totalsByDay.get(selectedDate) || { usd: 0, eur: 0, pending: 0 };
  const { currency: primaryCurrency, secondaryCurrency, primaryField, secondaryField } = resolveCurrencyContext(context.activeDay);

  const defaultRate = editingEntry?.exchangeRate ?? context.activeDay?.exchangeRate ?? null;
  const baseFormCurrency = editingEntry
    ? normalizeCurrencyCode(editingEntry.inputCurrency, primaryCurrency)
    : normalizeCurrencyCode(primaryCurrency, 'USD');
  const amountField = baseFormCurrency === 'EUR' ? 'eur' : 'usd';
  const editingAmount = editingEntry ? editingEntry?.[amountField] : null;

  const formDefaults = editingEntry
    ? {
        date: editingEntry.date,
        amount: editingAmount == null ? '' : editingAmount,
        exchangeRate: formatExchangeRate(editingEntry.exchangeRate) || formatExchangeRate(context.activeDay?.exchangeRate) || '',
        note: editingEntry.note ?? '',
        debtor: resolveEntryDebtor(editingEntry),
        inputCurrency: baseFormCurrency
      }
    : {
        date: selectedDate,
        amount: '',
        exchangeRate: formatExchangeRate(defaultRate) || '',
        note: '',
        debtor: false,
        inputCurrency: baseFormCurrency
      };

  const formCurrency = normalizeCurrencyCode(formDefaults.inputCurrency, primaryCurrency);
  const formCurrencySymbol = getCurrencySymbol(formCurrency);
  const formSecondaryCurrency = formCurrency === 'EUR' ? 'USD' : 'EUR';

  const metaRate = formatExchangeRate(context.activeDay?.exchangeRate);
  const locationLabel = context.event?.locatie ? ` • ${escapeHtml(context.event.locatie)}` : '';
  mount.innerHTML = `
    <section class="dagomzet-card">
      <header class="dagomzet-header">
        <div class="dagomzet-header-bar">
          <div>
            <h2 id="dagomzetModalTitle">Dagomzet voor ${escapeHtml(context.event?.naam || 'onbekend evenement')}</h2>
            <div class="dagomzet-subtitle">${escapeHtml(formatRange(range))}${locationLabel}</div>
          </div>
          <button type="button" class="dagomzet-close-btn" data-role="close-modal">Sluiten ✕</button>
        </div>
        <div class="dagomzet-meta">
          <span>Valuta voorkeur: <strong>${primaryCurrency}</strong></span>
          ${metaRate ? `<span>Koers USD→EUR: <strong>${metaRate}</strong></span>` : ''}
          <span>Datum in focus: <strong>${escapeHtml(formatDateLabel(selectedDate))}</strong></span>
        </div>
      </header>
      ${renderPendingBanner(pendingJobs.length || totalsForSelected.pending)}
      ${renderTimeline(dayList, totalsByDay, selectedDate, primaryField, secondaryField, primaryCurrency, secondaryCurrency)}
      ${renderSummary(totalsForSelected, primaryField, secondaryField, primaryCurrency, secondaryCurrency)}
      <form class="dagomzet-form" id="dagomzetForm">
        <div class="field">
          <label for="dagDatum">Datum</label>
          <input type="date" id="dagDatum" name="date" value="${formDefaults.date || ''}" required />
        </div>
        <div class="field">
          <label for="dagCurrency">Invoer in</label>
          <select id="dagCurrency" name="inputCurrency">
            <option value="EUR" ${formCurrency === 'EUR' ? 'selected' : ''}>€ EUR</option>
            <option value="USD" ${formCurrency === 'USD' ? 'selected' : ''}>$ USD</option>
          </select>
        </div>
        <div class="field">
          <label for="dagAmount">Omzetbedrag <span class="dagomzet-currency-label" data-role="amount-label">${formCurrencySymbol} ${formCurrency}</span></label>
          <input type="number" id="dagAmount" name="amount" step="0.01" min="0" inputmode="decimal" placeholder="0.00" value="${formDefaults.amount === '' ? '' : formDefaults.amount}" required />
          <small data-role="conversion-note">${formSecondaryCurrency} wordt automatisch omgerekend.</small>
        </div>
        <div class="field">
          <label for="dagRate">Wisselkoers USD→EUR</label>
          <input type="number" id="dagRate" name="exchangeRate" step="0.0001" min="0.0001" inputmode="decimal" placeholder="0.0000" value="${formDefaults.exchangeRate}" required />
          <small>Max 4 decimalen, gebruik een punt als scheiding.</small>
        </div>
        <div class="field checkbox-field" style="grid-column: 1 / -1;">
          <label for="dagDebtor">
            <input type="checkbox" id="dagDebtor" name="debtor" ${formDefaults.debtor ? 'checked' : ''} />
            Debiteur (boek als openstaand)
          </label>
          <small>Vink aan wanneer deze omzet als debiteurenpost verwerkt moet worden.</small>
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <label for="dagNote">Notitie</label>
          <textarea id="dagNote" name="note" placeholder="Optioneel">${formDefaults.note || ''}</textarea>
        </div>
        <div class="actions">
          <button type="submit">${editingEntry ? 'Dagomzet bijwerken' : 'Dagomzet toevoegen'}</button>
          ${editingEntry ? '<button type="button" id="cancelEdit">Annuleren</button>' : ''}
        </div>
      </form>
      ${renderEntries(entriesForDay, primaryField, secondaryField, primaryCurrency, secondaryCurrency)}
    </section>
  `;
  bindActions(mount, context);
  return true;
}


store.on('activeDay:changed', (payload = {}) => {
  const current = payload?.current;
  if (current?.date) selectedDate = current.date;
  editingEntryId = null;
  renderSalesUI();
});

store.on('omzet:updated', (payload) => {
  if (!payload?.eventId) {
    renderSalesUI();
    return;
  }
  const ctx = getActiveEventContext();
  if (ctx.eventId === payload.eventId) {
    renderSalesUI();
  }
});

store.on('events:updated', (payload) => {
  if (!payload?.eventId) {
    renderSalesUI();
    return;
  }
  const ctx = getActiveEventContext();
  if (ctx.eventId === payload.eventId) {
    renderSalesUI();
  }
});

store.on('db:loaded', () => {
  selectedDate = null;
  editingEntryId = null;
  renderSalesUI();
});

export const toonVerkoopKnoppen = renderSalesUI;
export function invalidateSoldCache() {}