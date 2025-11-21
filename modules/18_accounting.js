// 18_accounting.js — Accounting hub met tabbladen en quick entry

import { store } from './store.js';
import { formatCurrencyValue } from './4_ui.js';
import { recordLedgerEntry, recordPurchaseInvoice, recordEventInvoiceLedgerEntry, processAccountingPendingQueue } from './3_data.js';
import {
  buildAccountingAggregates,
  renderAccountingKPIs as renderLedgerKpis,
  drawAccountingCharts as drawLedgerCharts
} from './17_inzichten.js';

const DEFAULT_ACCOUNTS = ['Algemeen', 'Kassa', 'Pin', 'Bank', 'Overig'];
const RECURRING_COSTS_KEY = 'ocpos.accounting.recurring.v1';
const PROJECTION_SETTINGS_KEY = 'ocpos.accounting.projection.v1';

const accountingState = {
  activeTab: 'overview',
  filters: {
    event: 'all',
    account: 'all',
    period: '30d'
  },
  entries: [],
  recurringCosts: loadRecurringCosts(),
  projection: loadProjectionSettings()
};

let activeRoot = null;
let accountingListenerBound = false;
let accountingListener = null;
let dbListenerBound = false;
let pendingListenerBound = false;
let ledgerCharts = {};
let statusClearTimer = null;
let onlineRetryBound = false;

function getPendingQueueCount() {
  const queue = store.state?.db?.accounting?.pendingQueue;
  if (Array.isArray(queue)) {
    return queue.length;
  }
  const globalDb = typeof window !== 'undefined'
    ? window.db
    : (typeof globalThis !== 'undefined' ? globalThis.db : undefined);
  return Array.isArray(globalDb?.accounting?.pendingQueue)
    ? globalDb.accounting.pendingQueue.length
    : 0;
}

function loadRecurringCosts() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECURRING_COSTS_KEY);
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) return parsed;
  } catch (err) {
    console.debug?.('[Accounting] Kan vaste kosten niet laden', err);
  }
  return [];
}

function saveRecurringCosts(list) {
  accountingState.recurringCosts = Array.isArray(list) ? list : [];
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(RECURRING_COSTS_KEY, JSON.stringify(accountingState.recurringCosts));
  } catch (err) {
    console.debug?.('[Accounting] Kan vaste kosten niet opslaan', err);
  }
}

function loadProjectionSettings() {
  if (typeof localStorage === 'undefined') {
    return {
      currentBalance: 0,
      includeDebtors: true,
      includeCreditors: true,
      includeExpectedIncome: true,
      includeFixedCosts: true
    };
  }
  try {
    const raw = localStorage.getItem(PROJECTION_SETTINGS_KEY);
    const parsed = JSON.parse(raw || '{}');
    return {
      currentBalance: Number(parsed.currentBalance) || 0,
      includeDebtors: parsed.includeDebtors !== false,
      includeCreditors: parsed.includeCreditors !== false,
      includeExpectedIncome: parsed.includeExpectedIncome !== false,
      includeFixedCosts: parsed.includeFixedCosts !== false
    };
  } catch (err) {
    console.debug?.('[Accounting] Kan projectie instellingen niet laden', err);
    return {
      currentBalance: 0,
      includeDebtors: true,
      includeCreditors: true,
      includeExpectedIncome: true,
      includeFixedCosts: true
    };
  }
}

function persistProjectionSettings() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PROJECTION_SETTINGS_KEY, JSON.stringify(accountingState.projection));
  } catch (err) {
    console.debug?.('[Accounting] Kan projectie instellingen niet opslaan', err);
  }
}

function describePendingQueue() {
  const count = getPendingQueueCount();
  if (!count) return '';
  const label = count === 1 ? 'boeking' : 'boekingen';
  return `${count} ${label}`;
}

function showPendingQueueStatus() {
  const description = describePendingQueue();
  if (description) {
    setStatusMessage(`${description} wachten op synchronisatie.`, 'warning');
  } else {
    setStatusMessage('Alle boekingen zijn gesynchroniseerd.', 'success');
  }
}

async function attemptPendingQueueSync(reason = 'ui') {
  try {
    const result = await processAccountingPendingQueue({ silent: true, reason });
    if (result?.processed > 0) {
      setStatusMessage('Offline boekingen opnieuw gesynchroniseerd.', 'success');
    } else {
      showPendingQueueStatus();
    }
  } catch (err) {
    const message = err?.message || String(err);
    setStatusMessage(`Synchronisatie mislukt: ${message}`, 'error');
  }
}

function ensureOnlineRetryListener() {
  if (onlineRetryBound) return;
  if (typeof window === 'undefined' || !window?.addEventListener) return;
  const handler = () => {
    attemptPendingQueueSync('network-online');
  };
  window.addEventListener('online', handler);
  onlineRetryBound = true;
}

export function renderAccountingPage(target) {
  const mount = typeof target === 'string' ? document.querySelector(target) : target;
  if (!mount) return;

  activeRoot = mount;
  mount.innerHTML = buildBaseMarkup();

  hydrateFilters(mount);
  bindTabNavigation(mount);
  bindFilterControls(mount);
  bindQuickEntryForms(mount);
  ensureAccountingListener();
  ensureDbSync();
  ensurePendingListener();
  ensureOnlineRetryListener();

  refreshAccountingView();
  showPendingQueueStatus();
  attemptPendingQueueSync('ui-mount');
}

function buildBaseMarkup() {
  return `
    <div class="accounting-shell">
      <div class="acc-header">
        <div class="acc-tabs" role="tablist" aria-label="Accounting secties">
          <button type="button" class="acc-tab" data-tab="overview" role="tab" aria-selected="false">Overzicht</button>
          <button type="button" class="acc-tab" data-tab="journal" role="tab" aria-selected="false">Dagboek</button>
          <button type="button" class="acc-tab" data-tab="export" role="tab" aria-selected="false">Export</button>
        </div>
      </div>
      <div class="acc-filters" role="group" aria-label="Accounting filters">
        <label class="acc-filter">
          <span>Event</span>
          <select name="acc-filter-event"></select>
        </label>
        <label class="acc-filter">
          <span>Account</span>
          <select name="acc-filter-account"></select>
        </label>
        <label class="acc-filter">
          <span>Periode</span>
          <select name="acc-filter-period">
            <option value="today">Vandaag</option>
            <option value="7d">Laatste 7 dagen</option>
            <option value="30d">Laatste 30 dagen</option>
            <option value="year">Dit jaar</option>
            <option value="all">Alle transacties</option>
          </select>
        </label>
      </div>
      <div class="acc-context" data-context-label></div>
      <div class="acc-status" data-status role="status" aria-live="polite"></div>
      <section class="acc-quick-entry" aria-label="Snelle invoer">
        <form class="acc-card acc-quick-form" data-type="income">
          <h3>Snelle inkomsten</h3>
          <div class="acc-field">
            <label>Bedrag</label>
            <div class="acc-money-field">
              <input type="number" name="amount" min="0" step="0.01" inputmode="decimal" required placeholder="0,00">
              <select name="currency">
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          <div class="acc-field">
            <label>Categorie</label>
            <select name="categoryId" data-quick-category>
              <option value="">Kies categorie</option>
            </select>
          </div>
          <div class="acc-field">
            <label>Omschrijving</label>
            <input type="text" name="note" maxlength="120" placeholder="Omschrijving (optioneel)">
          </div>
          <button type="submit" class="acc-submit groen">Boeking toevoegen</button>
        </form>
        <form class="acc-card acc-quick-form" data-type="expense">
          <h3>Snelle uitgaven</h3>
          <div class="acc-field">
            <label>Bedrag</label>
            <div class="acc-money-field">
              <input type="number" name="amount" min="0" step="0.01" inputmode="decimal" required placeholder="0,00">
              <select name="currency">
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          <div class="acc-field">
            <label>Categorie</label>
            <select name="categoryId" data-quick-category>
              <option value="">Kies categorie</option>
            </select>
          </div>
          <div class="acc-field">
            <label>Crediteur</label>
            <input type="text" name="party" maxlength="80" placeholder="Leverancier (optioneel)">
          </div>
          <div class="acc-field acc-field-inline">
            <label class="acc-checkbox">
              <input type="checkbox" name="isCreditor">
              <span>Opslaan als openstaande crediteur</span>
            </label>
          </div>
          <div class="acc-field">
            <label>Omschrijving</label>
            <input type="text" name="note" maxlength="120" placeholder="Omschrijving (optioneel)">
          </div>
          <button type="submit" class="acc-submit rood">Uitgave registreren</button>
        </form>
        <form class="acc-card acc-quick-form" data-type="invoice">
          <h3>Inkoopfactuur</h3>
          <div class="acc-field">
            <label>Crediteur</label>
            <input type="text" name="supplier" maxlength="80" required placeholder="Leverancier">
          </div>
          <div class="acc-field">
            <label>Factuurnummer</label>
            <input type="text" name="invoiceNumber" maxlength="40" placeholder="Factuurnummer (optioneel)">
          </div>
          <div class="acc-field">
            <label>Bedrag</label>
            <div class="acc-money-field">
              <input type="number" name="amount" min="0" step="0.01" inputmode="decimal" required placeholder="0,00">
              <select name="currency">
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          <div class="acc-field">
            <label>Categorie</label>
            <select name="categoryId" data-quick-category>
              <option value="">Kies categorie</option>
            </select>
          </div>
          <div class="acc-field">
            <label>Event</label>
            <select name="eventId" data-invoice-event>
              <option value="">Geen specifiek event</option>
            </select>
          </div>
          <div class="acc-field">
            <label>Vervaldatum</label>
            <input type="date" name="dueDate">
          </div>
          <div class="acc-field">
            <label>Status</label>
            <select name="status">
              <option value="OPEN">Openstaand</option>
              <option value="PAID">Betaald</option>
            </select>
          </div>
          <div class="acc-field">
            <label>Omschrijving</label>
            <input type="text" name="note" maxlength="160" placeholder="Omschrijving (optioneel)">
          </div>
          <button type="submit" class="acc-submit blauw">Factuur opslaan</button>
        </form>
      </section>
      <section class="acc-content" data-content></section>
    </div>
  `;
}

function hydrateFilters(root) {
  populateEventOptions(root);
  populateAccountOptions(root);
  populateQuickEntryCategories(root);
  populateInvoiceEventSelects(root);
  const periodSelect = root.querySelector('select[name="acc-filter-period"]');
  if (periodSelect) periodSelect.value = accountingState.filters.period;
}

function populateEventOptions(root) {
  const select = root.querySelector('select[name="acc-filter-event"]');
  if (!select) return;
  const previousValue = accountingState.filters.event;
  const events = Array.isArray(store.state.db?.evenementen) ? store.state.db.evenementen : [];
  const options = ['<option value="all">Alle events</option>'];
  events.forEach((event) => {
    const id = event?.id ?? event?.uuid ?? event?.slug ?? String(event?.naam || '').trim();
    if (!id) return;
    const labelParts = [event?.naam, event?.locatie].filter(Boolean);
    const label = labelParts.length ? labelParts.join(' • ') : event?.naam || 'Event';
    options.push(`<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`);
  });
  select.innerHTML = options.join('');
  select.value = previousValue || 'all';
  if (select.value !== previousValue) {
    select.value = 'all';
  }
  accountingState.filters.event = select.value || 'all';
}

function populateInvoiceEventSelects(root) {
  const selects = root.querySelectorAll('select[data-invoice-event]');
  if (!selects.length) return;
  const events = Array.isArray(store.state.db?.evenementen) ? store.state.db.evenementen : [];
  const options = ['<option value="">Geen specifiek event</option>'];
  const validIds = new Set(['']);
  events.forEach((event) => {
    const id = event?.id ?? event?.uuid ?? event?.slug ?? String(event?.naam || '').trim();
    if (!id) return;
    const labelParts = [event?.naam, event?.locatie].filter(Boolean);
    const label = labelParts.length ? labelParts.join(' • ') : event?.naam || 'Event';
    options.push(`<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`);
    validIds.add(String(id));
  });
  selects.forEach((select) => {
    const previous = select.value;
    select.innerHTML = options.join('');
    if (previous && validIds.has(previous)) {
      select.value = previous;
    } else {
      select.value = '';
    }
  });
}

function populateAccountOptions(root) {
  const select = root.querySelector('select[name="acc-filter-account"]');
  if (!select) return;
  const previousValue = accountingState.filters.account;
  const accounts = getLedgerAccounts();
  const optionValues = new Set(['all']);
  const options = ['<option value="all">Alle rekeningen</option>'];
  if (accounts.length) {
    accounts.forEach((account) => {
      optionValues.add(account.id);
      options.push(`<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`);
    });
  } else {
    DEFAULT_ACCOUNTS.forEach((value) => {
      optionValues.add(value);
      options.push(`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`);
    });
  }
  select.innerHTML = options.join('');
  if (previousValue && optionValues.has(previousValue)) {
    select.value = previousValue;
  } else {
    select.value = 'all';
  }
  accountingState.filters.account = select.value || 'all';
}

function getLedgerAccounts() {
  const accounts = Array.isArray(store.state.db?.accounting?.accounts)
    ? store.state.db.accounting.accounts
    : [];
  const map = new Map();
  accounts.forEach((account) => {
    if (!account) return;
    const id = resolveLedgerId(account.id || account.uuid || account.code || account.slug || account.name);
    const name = (account.name || account.naam || account.label || id || 'Rekening').toString().trim() || id || 'Rekening';
    if (!id && !name) return;
    map.set(id || name, {
      id: id || name,
      name,
      type: (account.type || account.soort || '').toString().trim().toLowerCase() || null,
      currency: (account.currency || account.valuta || account.currencyCode || 'EUR').toString().trim().toUpperCase()
    });
  });
  accountingState.entries.forEach((entry) => {
    const id = resolveLedgerId(entry.accountId || entry.account);
    if (!id) return;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: entry.account || id,
        type: null,
        currency: (entry.currency || 'EUR').toString().toUpperCase()
      });
    }
  });
  return Array.from(map.values());
}

function getLedgerCategories() {
  const categories = Array.isArray(store.state.db?.accounting?.categories)
    ? store.state.db.accounting.categories
    : [];
  const map = new Map();
  categories.forEach((category) => {
    if (!category) return;
    const id = resolveLedgerId(category.id || category.uuid || category.code || category.slug || category.name);
    const name = (category.name || category.naam || category.label || id || 'Categorie').toString().trim() || id || 'Categorie';
    if (!id && !name) return;
    map.set(id || name, {
      id: id || name,
      name,
      type: (category.type || category.soort || '').toString().trim().toLowerCase() || null
    });
  });
  accountingState.entries.forEach((entry) => {
    const id = resolveLedgerId(entry.categoryId || entry.category);
    if (!id) return;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: entry.category || id,
        type: null
      });
    }
  });
  return Array.from(map.values());
}

function getDefaultCategoryId(type = 'income') {
  const categories = getLedgerCategories();
  if (!categories.length) return '';
  const normalizedType = type === 'expense' ? 'expense' : 'income';
  const preferredMatches = normalizedType === 'expense'
    ? ['expense', 'cost', 'kosten', 'uitgave']
    : ['income', 'revenue', 'inkomst', 'omzet'];
  const match = categories.find((category) => preferredMatches.includes(String(category.type || '').toLowerCase()));
  return (match || categories[0]).id;
}

function buildAccountMap() {
  const map = new Map();
  getLedgerAccounts().forEach((account) => {
    map.set(account.id, account);
  });
  accountingState.entries.forEach((entry) => {
    const id = resolveLedgerId(entry.accountId || entry.account);
    if (!id) return;
    if (!map.has(id)) {
      map.set(id, { id, name: entry.account || id });
    }
  });
  if (!map.has('Algemeen')) {
    map.set('Algemeen', { id: 'Algemeen', name: 'Algemeen' });
  }
  return map;
}

function buildCategoryMap() {
  const map = new Map();
  getLedgerCategories().forEach((category) => {
    map.set(category.id, category);
  });
  accountingState.entries.forEach((entry) => {
    const id = resolveLedgerId(entry.categoryId || entry.category);
    if (!id) return;
    if (!map.has(id)) {
      map.set(id, { id, name: entry.category || id });
    }
  });
  return map;
}

function resolveLedgerId(value) {
  if (value == null) return '';
  return String(value).trim();
}

function resolveAccountLabel(accountId, accountMap) {
  if (!accountId) return '';
  const record = accountMap.get(accountId);
  if (record?.name) return record.name;
  return accountId;
}

function resolveCategoryLabel(categoryId, categoryMap) {
  if (!categoryId) return '';
  const record = categoryMap.get(categoryId);
  if (record?.name) return record.name;
  return categoryId;
}

function bindTabNavigation(root) {
  root.querySelectorAll('.acc-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { tab } = btn.dataset;
      if (!tab || tab === accountingState.activeTab) return;
      accountingState.activeTab = tab;
      refreshAccountingView();
    });
  });
}

function bindFilterControls(root) {
  root.querySelectorAll('.acc-filter select').forEach((select) => {
    select.addEventListener('change', () => {
      const name = select.getAttribute('name');
      if (!name) return;
      if (name === 'acc-filter-event') accountingState.filters.event = select.value || 'all';
      if (name === 'acc-filter-account') accountingState.filters.account = select.value || 'all';
      if (name === 'acc-filter-period') accountingState.filters.period = select.value || '30d';
      refreshAccountingView();
    });
  });
}

function bindQuickEntryForms(root) {
  root.querySelectorAll('.acc-quick-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form.dataset.busy === 'true') return;

      const formData = new FormData(form);
      const amount = Number.parseFloat(String(formData.get('amount')).replace(',', '.'));
      if (!Number.isFinite(amount) || amount <= 0) {
        form.querySelector('input[name="amount"]').focus();
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      const currencySelect = form.querySelector('select[name="currency"]');
      const categorySelect = form.querySelector('select[name="categoryId"]');

      const currency = (formData.get('currency') || 'EUR').toString().toUpperCase();
      const note = (formData.get('note') || '').toString().trim();
      const categoryId = (formData.get('categoryId') || '').toString().trim();
      const type = form.dataset.type === 'expense'
        ? 'expense'
        : form.dataset.type === 'invoice'
          ? 'invoice'
          : 'income';

      form.dataset.busy = 'true';
      submitButton?.setAttribute('disabled', 'disabled');

      try {
        if (type === 'invoice') {
          const supplier = (formData.get('supplier') || '').toString().trim();
          if (!supplier) {
            form.querySelector('input[name="supplier"]').focus();
            throw new Error('Crediteur is verplicht.');
          }
          const invoiceNumber = (formData.get('invoiceNumber') || '').toString().trim();
          const eventId = (formData.get('eventId') || '').toString().trim();
          const dueDate = (formData.get('dueDate') || '').toString().trim();
          const statusValue = (formData.get('status') || 'OPEN').toString().toUpperCase();
          await recordPurchaseInvoice({
            amount,
            currency,
            creditor: supplier,
            supplier,
            invoiceNumber,
            eventId: eventId || null,
            dueDate: dueDate || null,
            note,
            status: statusValue,
            categoryId: categoryId || null,
            createdFrom: 'quick-entry-invoice',
            filters: { ...accountingState.filters }
          });
          setStatusMessage('Inkoopfactuur opgeslagen.', 'success');
          form.reset();
          if (currencySelect) currencySelect.value = currency;
          if (categorySelect) {
            const fallback = categoryId || getDefaultCategoryId('expense');
            if (fallback) categorySelect.value = fallback;
          }
        } else {
          const metaOverrides = {};
          let accountIdOverride;
          if (type === 'expense') {
            const party = (formData.get('party') || '').toString().trim();
            const isCreditor = formData.get('isCreditor') === 'on';
            if (party) metaOverrides.creditorName = party;
            if (isCreditor) {
              metaOverrides.creditorStatus = 'OPEN';
              metaOverrides.bookedAsCreditor = true;
              accountIdOverride = 'acct-purchase-creditor-eur';
            }
          }
          const payload = buildQuickEntryPayload({
            amount,
            currency,
            note,
            categoryId,
            type,
            metaOverrides,
            accountIdOverride
          });
          await recordLedgerEntry(payload);
          setStatusMessage('Boeking opgeslagen in het grootboek.', 'success');
          form.reset();
          if (currencySelect) currencySelect.value = currency;
          if (categorySelect) {
            const resolvedCategory = categoryId || getDefaultCategoryId(type);
            if (resolvedCategory) categorySelect.value = resolvedCategory;
          }
        }
      } catch (err) {
        console.error('[Accounting] Quick entry opslaan mislukt:', err);
        const message = err?.message ? String(err.message) : 'Onbekende fout bij opslaan.';
        setStatusMessage(`Opslaan mislukt: ${message}`, 'error');
        window.alert?.(`Boeking opslaan mislukt: ${message}`);
      } finally {
        form.dataset.busy = 'false';
        submitButton?.removeAttribute('disabled');
      }
    });
  });
}

function populateQuickEntryCategories(root) {
  if (!root) return;
  const selects = root.querySelectorAll('select[name="categoryId"][data-quick-category]');
  if (!selects.length) return;
  const categories = getLedgerCategories();
  const hasCategories = categories.length > 0;
  selects.forEach((select) => {
    const previousValue = select.value;
    const formType = select.closest('.acc-quick-form')?.dataset.type === 'expense' ? 'expense' : 'income';
    const options = hasCategories
      ? ['<option value="">Kies categorie</option>', ...categories.map((category) => `\n        <option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`)]
      : ['<option value="">Geen categorieën beschikbaar</option>'];
    select.innerHTML = options.join('');
    if (hasCategories) {
      if (previousValue && categories.some((category) => category.id === previousValue)) {
        select.value = previousValue;
      } else {
        const fallback = getDefaultCategoryId(formType);
        if (fallback) {
          select.value = fallback;
        }
      }
    } else {
      select.value = '';
    }
  });
}

function resolveQuickEntryAccountId() {
  if (accountingState.filters.account && accountingState.filters.account !== 'all') {
    return accountingState.filters.account;
  }
  const accounts = getLedgerAccounts();
  if (accounts.length) return accounts[0].id;
  return DEFAULT_ACCOUNTS[0];
}

function buildQuickEntryPayload({ amount, currency, note, categoryId, type, metaOverrides = {}, accountIdOverride, eventIdOverride }) {
  const normalizedAmount = Math.round(Number(amount) * 100) / 100;
  let eventId = accountingState.filters.event === 'all' ? '' : accountingState.filters.event;
  if (eventIdOverride !== undefined) {
    eventId = eventIdOverride || '';
  }
  const direction = type === 'expense' ? 'CREDIT' : 'DEBIT';
  const resolvedCategory = categoryId || getDefaultCategoryId(type);
  const accountId = accountIdOverride || resolveQuickEntryAccountId();
  const now = new Date();

  const payload = {
    amount: normalizedAmount,
    currency,
    direction,
    accountId,
    date: now.toISOString().slice(0, 10),
    note,
    reference: note ? note.slice(0, 40) : undefined,
    meta: {
      source: 'quick-entry',
      quickEntryType: type,
      filters: { ...accountingState.filters }
    }
  };

  if (resolvedCategory) payload.categoryId = resolvedCategory;
  if (eventId) {
    payload.eventId = eventId;
    payload.meta.eventId = eventId;
  }

  if (metaOverrides && typeof metaOverrides === 'object') {
    Object.entries(metaOverrides).forEach(([key, value]) => {
      if (value == null || value === '') return;
      payload.meta[key] = value;
    });
  }

  return payload;
}

function ensureAccountingListener() {
  if (accountingListenerBound) return;
  accountingListener = (payload = {}) => {
    const nextEntries = Array.isArray(payload.entries)
      ? payload.entries
      : payload.entry
        ? [payload.entry, ...accountingState.entries]
        : accountingState.entries;
    accountingState.entries = normalizeEntries(nextEntries);
    if (activeRoot) {
      populateAccountOptions(activeRoot);
      populateQuickEntryCategories(activeRoot);
      populateInvoiceEventSelects(activeRoot);
    }
    refreshAccountingView();
  };
  store.on('accounting:updated', accountingListener);
  accountingListenerBound = true;
}

function ensureDbSync() {
  if (dbListenerBound) return;
  const rerenderFilters = () => {
    if (!activeRoot) return;
    populateEventOptions(activeRoot);
    populateAccountOptions(activeRoot);
    populateQuickEntryCategories(activeRoot);
    populateInvoiceEventSelects(activeRoot);
    refreshAccountingView();
  };
  store.on('db:loaded', rerenderFilters);
  store.on('events:updated', rerenderFilters);
  dbListenerBound = true;
}

function ensurePendingListener() {
  if (pendingListenerBound) return;
  store.on('accounting:pending', (payload = {}) => {
    const description = describePendingQueue();
    const suffix = description ? ` ${description} wachten op synchronisatie.` : '';
    const message = payload?.error
      ? `Offline: ${payload.error}. Boeking wordt later opnieuw geprobeerd.${suffix}`
      : `Boeking in wachtrij geplaatst voor synchronisatie.${suffix}`;
    setStatusMessage(message, 'warning');
  });
  store.on('accounting:pendingResolved', () => {
    showPendingQueueStatus();
  });
  store.on('accounting:saved', () => {
    showPendingQueueStatus();
  });
  store.on('accounting:saveFailed', (payload = {}) => {
    const errorMessage = payload?.error?.message || payload?.error || 'Onbekende fout';
    setStatusMessage(`Synchronisatie mislukt: ${errorMessage}`, 'error');
  });
  pendingListenerBound = true;
}

function setStatusMessage(message, tone = 'info') {
  if (statusClearTimer) {
    clearTimeout(statusClearTimer);
    statusClearTimer = null;
  }
  if (!activeRoot) return;
  const node = activeRoot.querySelector('[data-status]');
  if (!node) return;
  node.textContent = message || '';
  node.dataset.tone = tone;
  node.classList.remove('is-info', 'is-success', 'is-warning', 'is-error');
  if (message) {
    node.classList.add(`is-${tone}`);
    if (tone === 'info') {
      statusClearTimer = setTimeout(() => {
        if (!activeRoot || !activeRoot.contains(node)) return;
        node.textContent = '';
        node.classList.remove('is-info', 'is-success', 'is-warning', 'is-error');
        delete node.dataset.tone;
      }, 6000);
    }
  } else {
    delete node.dataset.tone;
  }
}

function normalizeEntries(entries) {
  const accountMap = buildAccountMap();
  const categoryMap = buildCategoryMap();
  return entries
    .filter(Boolean)
    .map((entry) => {
      const createdAt = resolveTimestamp(entry);
      const eventId = resolveLedgerId(entry.eventId || entry.event || entry.eventUuid || entry.meta?.eventId);
      const accountId = resolveLedgerId(entry.accountId || entry.account || entry.rekening);
      const categoryId = resolveLedgerId(entry.categoryId || entry.category || entry.categorie);
      const accountLabel = resolveAccountLabel(accountId, accountMap);
      const categoryLabel = resolveCategoryLabel(categoryId, categoryMap);
      const rawDirection = (entry.direction || entry.type || '').toString().toUpperCase();
      const isExpense = entry.type === 'expense' || rawDirection === 'CREDIT' || rawDirection === 'EXPENSE';
      const amountValue = Math.abs(Number(entry.amount) || 0);
      const signedAmount = isExpense ? amountValue * -1 : amountValue;
      const currency = (entry.currency || 'EUR').toString().toUpperCase();
      return {
        ...entry,
        amount: amountValue,
        signedAmount,
        currency,
        type: isExpense ? 'expense' : 'income',
        createdAt,
        date: entry.date || entry.datum || entry.day || entry.ymd || (createdAt ? new Date(createdAt).toISOString() : new Date().toISOString()),
        accountId: accountId || accountLabel || 'Algemeen',
        account: accountLabel || accountId || 'Algemeen',
        categoryId,
        category: categoryLabel,
        eventId
      };
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function resolveTimestamp(entry) {
  const candidates = [entry?.createdAt, entry?.timestamp, entry?.ts];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  const isoCandidates = [entry?.createdAt, entry?.updatedAt, entry?.meta?.createdAt, entry?.meta?.updatedAt];
  for (const candidate of isoCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  const rawDate = entry?.date || entry?.datum || entry?.day || entry?.ymd;
  if (rawDate) {
    const parsed = new Date(rawDate);
    const ts = parsed.getTime();
    if (Number.isFinite(ts)) return ts;
  }
  return Date.now();
}

function refreshAccountingView() {
  if (!activeRoot) return;
  updateTabButtons(activeRoot);
  updateContextLabel(activeRoot);
  renderActiveTab(activeRoot);
}

function updateTabButtons(root) {
  root.querySelectorAll('.acc-tab').forEach((btn) => {
    const isActive = btn.dataset.tab === accountingState.activeTab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.setAttribute('tabindex', isActive ? '0' : '-1');
  });
}

function updateContextLabel(root) {
  const target = root.querySelector('[data-context-label]');
  if (!target) return;
  const eventLabel = describeEvent(accountingState.filters.event);
  const accountLabel = describeAccount(accountingState.filters.account);
  const periodLabel = describePeriod(accountingState.filters.period);
  target.textContent = `${eventLabel} • ${accountLabel} • ${periodLabel}`;
}

function renderActiveTab(root) {
  const container = root.querySelector('[data-content]');
  if (!container) return;
  const entries = getFilteredEntries();
  if (accountingState.activeTab === 'journal') {
    resetLedgerCharts();
    container.innerHTML = renderJournal(entries);
  } else if (accountingState.activeTab === 'export') {
    resetLedgerCharts();
    container.innerHTML = renderExport(entries);
    bindExportButtons(container, entries);
  } else {
    renderOverview(container, entries);
  }
}

function getFilteredEntries() {
  const { event, account, period } = accountingState.filters;
  const end = Date.now();
  const start = resolvePeriodStart(period, end);
  const eventFilter = event !== 'all' ? resolveLedgerId(event) : '';
  const accountFilter = account !== 'all' ? resolveLedgerId(account) : '';
  return accountingState.entries.filter((entry) => {
    const entryEventId = resolveLedgerId(entry.eventId);
    if (eventFilter && entryEventId !== eventFilter) return false;
    const entryAccountId = resolveLedgerId(entry.accountId || entry.account);
    if (accountFilter && entryAccountId !== accountFilter) return false;
    const ts = Number(entry.createdAt) || resolveTimestamp(entry) || 0;
    if (start && ts < start) return false;
    if (period === 'today') {
      const today = new Date();
      const entryDate = new Date(ts);
      if (
        entryDate.getFullYear() !== today.getFullYear() ||
        entryDate.getMonth() !== today.getMonth() ||
        entryDate.getDate() !== today.getDate()
      ) {
        return false;
      }
    }
    return ts <= end;
  });
}

function resolvePeriodStart(period, endTs) {
  const end = new Date(endTs);
  switch (period) {
    case 'today':
      return new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    case '7d':
      return endTs - 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return endTs - 30 * 24 * 60 * 60 * 1000;
    case 'year':
      return new Date(end.getFullYear(), 0, 1).getTime();
    default:
      return null;
  }
}

function renderOverview(container, entries) {
  if (!container) return;
  resetLedgerCharts();
  const ledgerData = computeLedgerAggregatesForFilters();
  const summary = buildCurrencySummary(entries);
  const activityHtml = renderRecentActivity(entries);
  const summaryHtml = summary.length
    ? summary.map(renderSummaryCard).join('')
    : '<article class="acc-card acc-empty">Nog geen boekingen in deze selectie.</article>';
  const debCredHtml = renderDebCredOverview();
  const payablesHtml = renderPayables();
  const recurringHtml = renderRecurringCosts();
  const projection = buildProjectionData(ledgerData);

  container.innerHTML = `
    <section class="acc-dashboard-head">
      <div>
        <h2>Financieel overzicht</h2>
        <p class="muted">Grafieken en KPI's tonen de huidige selectie. Gebruik de knoppen om naar details te springen.</p>
      </div>
      <div class="acc-dashboard-nav">
        <button type="button" class="acc-nav-btn" data-switch-tab="journal">📒 Dagboek</button>
        <button type="button" class="acc-nav-btn" data-switch-tab="export">📤 Export</button>
      </div>
    </section>
    ${renderIncomeSnapshot(ledgerData)}
    <section class="acc-kpi-grid" data-ledger-kpis></section>
    <section class="acc-card acc-projection" aria-label="Cashflow projectie">
      ${renderProjectionControls(projection)}
      <div class="acc-projection-chart">
        <canvas id="chartCashProjection" aria-label="Projectie" role="img"></canvas>
      </div>
    </section>
    <section class="acc-chart-grid">
      <article class="acc-card acc-chart">
        <header>Per maand</header>
        <canvas id="chartLedgerMonthly" aria-label="Inkomsten en uitgaven per maand" role="img"></canvas>
      </article>
      <article class="acc-card acc-chart">
        <header>Per categorie</header>
        <canvas id="chartLedgerCategory" aria-label="Saldo per categorie" role="img"></canvas>
      </article>
      <article class="acc-card acc-chart">
        <header>Per account</header>
        <canvas id="chartLedgerAccount" aria-label="Inkomsten en uitgaven per account" role="img"></canvas>
      </article>
    </section>
    <div class="acc-summary-grid">${summaryHtml}</div>
    ${activityHtml}
    ${debCredHtml}
    <section class="acc-two-col">
      ${payablesHtml}
      ${recurringHtml}
    </section>
  `;

  const kpiMount = container.querySelector('[data-ledger-kpis]');
  if (kpiMount) {
    renderLedgerKpis(ledgerData, kpiMount);
  }
  if (typeof Chart === 'function') {
    ledgerCharts = drawLedgerCharts(ledgerCharts, ledgerData);
    ledgerCharts.projection = drawProjectionChart(ledgerCharts.projection, projection);
  }
  bindDashboardNavButtons(container);
  bindProjectionControls(container);
  bindRecurringCostForm(container);
}

function computeLedgerAggregatesForFilters() {
  const period = accountingState.filters.period;
  const filter = {
    days: resolveLedgerDays(period),
    eventId: accountingState.filters.event === 'all' ? '__ALL__' : accountingState.filters.event
  };
  if (accountingState.filters.account && accountingState.filters.account !== 'all') {
    filter.accountId = accountingState.filters.account;
  }
  const events = Array.isArray(store.state.db?.evenementen) ? store.state.db.evenementen : [];
  const scopeEvents = resolveScopeEvents(events, filter.eventId);
  return buildAccountingAggregates(filter, scopeEvents);
}

function resolveLedgerDays(period) {
  switch (period) {
    case 'today':
      return 1;
    case '7d':
      return 7;
    case '30d':
      return 30;
    case 'year':
      return 365;
    default:
      return '__ALL__';
  }
}

function resolveScopeEvents(events, eventFilter) {
  if (!Array.isArray(events)) return [];
  if (!eventFilter || eventFilter === '__ALL__') return events;
  const normalized = resolveLedgerId(eventFilter);
  return events.filter((event) => {
    const eventId = resolveLedgerId(event?.id || event?.uuid || event?.slug || event?.naam);
    return eventId === normalized;
  });
}

function renderIncomeSnapshot(ledgerData) {
  const totalIncome = Number(ledgerData?.totals?.incomeEUR || 0);
  const totalExpense = Number(ledgerData?.totals?.expenseEUR || 0);
  const latestMonth = Array.isArray(ledgerData?.perMonth) && ledgerData.perMonth.length
    ? ledgerData.perMonth[ledgerData.perMonth.length - 1]
    : null;
  const monthIncome = Number(latestMonth?.income || 0);
  const monthExpense = Number(latestMonth?.expense || 0);
  return `
    <section class="acc-card acc-income">
      <div class="acc-income-head">
        <div>
          <p class="muted">Beeld van inkomsten</p>
          <h3>${formatCurrency(totalIncome, 'EUR')} totaal</h3>
          <p class="muted">${formatCurrency(monthIncome, 'EUR')} deze periode • ${formatCurrency(monthExpense, 'EUR')} uitgegeven</p>
        </div>
        <div class="acc-income-balance ${totalIncome - totalExpense >= 0 ? 'pos' : 'neg'}">${formatCurrency(totalIncome - totalExpense, 'EUR')}</div>
      </div>
      <div class="acc-income-mini">
        <div>
          <span>Maand inkomsten</span>
          <strong>${formatCurrency(monthIncome, 'EUR')}</strong>
        </div>
        <div>
          <span>Maand uitgaven</span>
          <strong>${formatCurrency(monthExpense, 'EUR')}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderProjectionControls(projection) {
  const state = projection || accountingState.projection || {};
  return `
    <div class="acc-projection-controls">
      <label class="acc-filter">
        <span>Huidig saldo (EUR)</span>
        <input type="number" step="0.01" inputmode="decimal" value="${state.currentBalance ?? ''}" data-projection-balance>
      </label>
      <div class="acc-toggle-row">
        <label class="acc-checkbox"><input type="checkbox" data-projection-toggle="includeExpectedIncome" ${state.includeExpectedIncome !== false ? 'checked' : ''}> <span>Verwachte inkomsten</span></label>
        <label class="acc-checkbox"><input type="checkbox" data-projection-toggle="includeDebtors" ${state.includeDebtors !== false ? 'checked' : ''}> <span>Open debiteuren</span></label>
        <label class="acc-checkbox"><input type="checkbox" data-projection-toggle="includeCreditors" ${state.includeCreditors !== false ? 'checked' : ''}> <span>Open crediteuren</span></label>
        <label class="acc-checkbox"><input type="checkbox" data-projection-toggle="includeFixedCosts" ${state.includeFixedCosts !== false ? 'checked' : ''}> <span>Vaste kosten</span></label>
      </div>
    </div>
  `;
}

function buildProjectionData(ledgerData) {
  const state = accountingState.projection || {};
  const monthsAhead = 6;
  const startBalance = Number(state.currentBalance) || 0;
  const debtorTotal = state.includeDebtors === false ? 0 : sumOpenDebtors();
  const creditorTotal = state.includeCreditors === false ? 0 : sumOpenCreditors();
  const fixedCosts = state.includeFixedCosts === false ? new Array(monthsAhead).fill(0) : projectRecurringCosts(monthsAhead);
  const expectedMonthlyIncome = state.includeExpectedIncome === false ? 0 : resolveAverageMonthlyIncome(ledgerData);
  const labels = [];
  const balances = [];
  const inflows = [];
  const outflows = [];
  let running = startBalance;
  for (let i = 0; i < monthsAhead; i += 1) {
    const monthLabel = formatMonthLabel(addMonths(new Date(), i));
    labels.push(monthLabel);
    const inflow = expectedMonthlyIncome + (i === 0 ? debtorTotal : 0);
    const outflow = fixedCosts[i] + (i === 0 ? creditorTotal : 0);
    running += inflow - outflow;
    inflows.push(Math.round(inflow * 100) / 100);
    outflows.push(Math.round(outflow * 100) / 100);
    balances.push(Math.round(running * 100) / 100);
  }
  return { labels, balances, inflows, outflows, startBalance };
}

function resolveAverageMonthlyIncome(ledgerData) {
  const perMonth = Array.isArray(ledgerData?.perMonth) ? ledgerData.perMonth : [];
  if (!perMonth.length) return 0;
  const totalIncome = perMonth.reduce((sum, month) => sum + Number(month?.income || 0), 0);
  return Math.round((totalIncome / perMonth.length) * 100) / 100;
}

function projectRecurringCosts(monthsAhead) {
  const list = Array.isArray(accountingState.recurringCosts) ? accountingState.recurringCosts : [];
  const buckets = new Array(monthsAhead).fill(0);
  list.forEach((cost) => {
    const amount = Number(cost?.amount) || 0;
    if (!Number.isFinite(amount) || amount <= 0) return;
    const startDate = cost?.startDate ? new Date(cost.startDate) : new Date();
    for (let i = 0; i < monthsAhead; i += 1) {
      const targetDate = addMonths(new Date(), i);
      if (!isDueInMonth(startDate, targetDate, cost?.frequency)) continue;
      buckets[i] += amount;
    }
  });
  return buckets.map((value) => Math.round(value * 100) / 100);
}

function isDueInMonth(startDate, targetDate, frequency = 'month') {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return false;
  const freq = (frequency || 'month').toString().toLowerCase();
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), 1).getTime();
  const target = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1).getTime();
  if (target < start) return false;
  const diffMonths = Math.round((target - start) / (1000 * 60 * 60 * 24 * 30.5));
  if (freq === 'quarter') return diffMonths % 3 === 0;
  if (freq === 'year') return diffMonths % 12 === 0;
  return true;
}

function addMonths(date, count) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + count);
  return d;
}

function formatMonthLabel(date) {
  const formatter = new Intl.DateTimeFormat('nl-NL', { month: 'short', year: '2-digit' });
  return formatter.format(date);
}

function drawProjectionChart(existingChart, projection) {
  const canvas = document.getElementById('chartCashProjection');
  if (!canvas || !projection) return existingChart;
  try { existingChart?.destroy?.(); } catch (err) { console.debug?.('[Accounting] Chart cleanup', err); }
  const context = canvas.getContext('2d');
  if (!context) return existingChart;
  return new Chart(context, {
    type: 'line',
    data: {
      labels: projection.labels,
      datasets: [{
        label: 'Geprojecteerd saldo',
        data: projection.balances,
        borderColor: '#2A9626',
        backgroundColor: 'rgba(42,150,38,0.12)',
        tension: 0.25,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: false }
      }
    }
  });
}

function bindProjectionControls(root) {
  if (!root) return;
  const balanceInput = root.querySelector('[data-projection-balance]');
  if (balanceInput) {
    balanceInput.addEventListener('change', () => {
      const value = Number(balanceInput.value);
      accountingState.projection.currentBalance = Number.isFinite(value) ? value : 0;
      persistProjectionSettings();
      refreshAccountingView();
    });
  }
  root.querySelectorAll('input[data-projection-toggle]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const key = checkbox.getAttribute('data-projection-toggle');
      if (!key) return;
      accountingState.projection[key] = checkbox.checked;
      persistProjectionSettings();
      refreshAccountingView();
    });
  });
}

function sumOpenDebtors() {
  const parties = mergePartyLists([], collectLedgerParties().debtors || []);
  return parties.reduce((sum, party) => {
    if ((resolvePartyCurrency(party) || 'EUR') !== 'EUR') return sum;
    return sum + Math.max(0, Number(resolvePartyBalance(party)) || 0);
  }, 0);
}

function sumOpenCreditors() {
  const parties = mergePartyLists([], collectLedgerParties().creditors || []);
  return parties.reduce((sum, party) => {
    if ((resolvePartyCurrency(party) || 'EUR') !== 'EUR') return sum;
    return sum + Math.max(0, Number(resolvePartyBalance(party)) || 0);
  }, 0);
}

function resetLedgerCharts() {
  Object.values(ledgerCharts).forEach((chart) => {
    try {
      chart?.destroy?.();
    } catch (err) {
      console.debug?.('[Accounting] Chart cleanup mislukt', err);
    }
  });
  ledgerCharts = {};
}

function bindDashboardNavButtons(container) {
  if (!container) return;
  container.querySelectorAll('[data-switch-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.getAttribute('data-switch-tab');
      if (!tab || tab === accountingState.activeTab) return;
      accountingState.activeTab = tab;
      refreshAccountingView();
    });
  });
}

function renderDebCredOverview() {
  const data = store.state.db?.debCrediteuren;
  const baseDebtors = Array.isArray(data?.debiteuren) ? data.debiteuren : [];
  const baseCreditors = Array.isArray(data?.crediteuren) ? data.crediteuren : [];
  const ledgerParties = collectLedgerParties();
  const debtors = mergePartyLists(baseDebtors, ledgerParties.debtors);
  const creditors = mergePartyLists(baseCreditors, ledgerParties.creditors);
  if (!debtors.length && !creditors.length) {
    return '<article class="acc-card acc-empty">Geen debiteuren of crediteuren geregistreerd.</article>';
  }
  return `
    <section class="acc-debcred-grid">
      ${renderPartyCard('Debiteuren', debtors, 'income')}
      ${renderPartyCard('Crediteuren', creditors, 'expense')}
    </section>
  `;
}

function renderPartyCard(title, parties, tone) {
  const rows = Array.isArray(parties) && parties.length
    ? parties.map((party) => renderPartyRow(party, tone)).join('')
    : '<tr><td colspan="3" class="acc-empty">Geen gegevens</td></tr>';
  return `
    <article class="acc-card acc-party">
      <header>${escapeHtml(title)}</header>
      <div class="acc-table-wrapper">
        <table class="acc-party-table">
          <thead>
            <tr>
              <th>Naam</th>
              <th>Contact</th>
              <th>Openstaand</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderPartyRow(party, tone) {
  if (!party || typeof party !== 'object') {
    return '<tr><td colspan="3" class="acc-empty">Onbekende partij</td></tr>';
  }
  const name = party.naam || party.name || party.company || party.raw?.naam || 'Onbekend';
  const contactParts = [];
  const contactRaw = resolvePartyContact(party);
  if (contactRaw) contactParts.push(contactRaw);
  if (party.status) contactParts.push(`Status: ${String(party.status).toUpperCase()}`);
  const contact = contactParts.length ? contactParts.join(' • ') : '—';
  const balance = resolvePartyBalance(party);
  const currency = resolvePartyCurrency(party);
  const amountClass = tone === 'income' ? 'income' : 'expense';
  return `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(contact)}</td>
      <td class="${amountClass}">${formatCurrency(Math.abs(balance), currency)}</td>
    </tr>
  `;
}

function renderPayables() {
  const invoices = collectOpenPurchaseInvoices();
  if (!invoices.length) {
    return '<article class="acc-card acc-empty">Geen te betalen facturen.</article>';
  }
  const rows = invoices.map((invoice) => `
    <tr>
      <td>${escapeHtml(invoice.supplier || 'Crediteur')}</td>
      <td>${escapeHtml(invoice.invoiceNumber || '—')}</td>
      <td>${escapeHtml(invoice.date || '—')}</td>
      <td>${escapeHtml(invoice.dueDate || '—')}</td>
      <td>${formatCurrency(invoice.amount, invoice.currency || 'EUR')}</td>
    </tr>
  `).join('');
  return `
    <article class="acc-card acc-payables">
      <header>Te betalen facturen</header>
      <div class="acc-table-wrapper">
        <table class="acc-payables-table">
          <thead>
            <tr>
              <th>Leverancier</th>
              <th>Factuur</th>
              <th>Factuurdatum</th>
              <th>Vervaldatum</th>
              <th>Bedrag</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function collectOpenPurchaseInvoices() {
  const entries = Array.isArray(store.state.db?.accounting?.entries)
    ? store.state.db.accounting.entries
    : [];
  return entries
    .filter((entry) => entry?.meta?.source === 'purchase-invoice' && (entry.meta.status || '').toUpperCase() !== 'PAID')
    .map((entry) => ({
      supplier: entry.meta?.creditorName || entry.note || 'Crediteur',
      invoiceNumber: entry.meta?.invoiceNumber || entry.reference || '',
      amount: Number(entry.amount) || 0,
      currency: entry.currency || 'EUR',
      date: formatDateYMD(entry.date || entry.createdAt),
      dueDate: entry.meta?.dueDate || ''
    }))
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
}

function renderRecurringCosts() {
  const list = Array.isArray(accountingState.recurringCosts) ? accountingState.recurringCosts : [];
  const items = list.length
    ? list.map((item) => `
      <li>
        <div>
          <strong>${escapeHtml(item.label || 'Vaste kost')}</strong>
          <span class="muted">${describeFrequency(item.frequency)} • vanaf ${escapeHtml(item.startDate || '-')}</span>
        </div>
        <div class="acc-recurring-actions">
          <span class="amount">${formatCurrency(item.amount, item.currency || 'EUR')}</span>
          <button type="button" data-remove-cost="${escapeHtml(item.id)}" aria-label="Verwijder vaste kost">✕</button>
        </div>
      </li>
    `).join('')
    : '<li class="muted">Nog geen vaste kosten ingevoerd.</li>';
  const defaultDate = formatDateYMD(addMonths(new Date(), 0)) || '';
  return `
    <article class="acc-card acc-recurring">
      <header>Vaste kosten</header>
      <form data-fixed-cost-form class="acc-recurring-form">
        <label class="acc-field">
          <span>Omschrijving</span>
          <input type="text" name="label" maxlength="80" placeholder="Bijv. Stallingskosten" required>
        </label>
        <div class="acc-recurring-grid">
          <label class="acc-field">
            <span>Bedrag</span>
            <input type="number" name="amount" step="0.01" min="0" required>
          </label>
          <label class="acc-field">
            <span>Valuta</span>
            <select name="currency">
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label class="acc-field">
            <span>Frequentie</span>
            <select name="frequency">
              <option value="month">Maandelijks</option>
              <option value="quarter">Per kwartaal</option>
              <option value="year">Per jaar</option>
            </select>
          </label>
          <label class="acc-field">
            <span>Startdatum</span>
            <input type="date" name="startDate" value="${defaultDate}">
          </label>
        </div>
        <button type="submit" class="acc-submit groen">Vaste kost opslaan</button>
      </form>
      <ul class="acc-recurring-list" data-fixed-cost-list>${items}</ul>
    </article>
  `;
}

function describeFrequency(value) {
  const freq = (value || 'month').toString().toLowerCase();
  if (freq === 'quarter') return 'Per kwartaal';
  if (freq === 'year') return 'Per jaar';
  return 'Maandelijks';
}

function bindRecurringCostForm(root) {
  if (!root) return;
  const form = root.querySelector('[data-fixed-cost-form]');
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const amount = Number.parseFloat(String(formData.get('amount')).replace(',', '.'));
      if (!Number.isFinite(amount) || amount <= 0) return;
      const label = (formData.get('label') || 'Vaste kost').toString().trim();
      const currency = (formData.get('currency') || 'EUR').toString().toUpperCase();
      const frequency = (formData.get('frequency') || 'month').toString();
      const startDate = (formData.get('startDate') || '').toString();
      const entry = {
        id: `fixed-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`,
        label,
        amount: Math.round(amount * 100) / 100,
        currency,
        frequency,
        startDate
      };
      const next = [...(accountingState.recurringCosts || []), entry];
      saveRecurringCosts(next);
      refreshAccountingView();
    });
  }
  root.querySelectorAll('[data-remove-cost]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-remove-cost');
      if (!id) return;
      const filtered = (accountingState.recurringCosts || []).filter((item) => item.id !== id);
      saveRecurringCosts(filtered);
      refreshAccountingView();
    });
  });
}

function collectLedgerParties() {
  const entries = Array.isArray(store.state.db?.accounting?.entries)
    ? store.state.db.accounting.entries
    : [];
  const debtors = new Map();
  const creditors = new Map();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const meta = entry.meta || {};
    const status = (meta.status || '').toString().trim().toUpperCase();
    if (meta.source === 'event-invoice') {
      if (status === 'PAID') return;
      const key = meta.eventId || entry.eventId || entry.id;
      if (!key) return;
      const amount = entry.direction === 'DEBIT' ? Number(entry.amount) : -Number(entry.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const existing = debtors.get(key) || {
        id: key,
        naam: meta.eventName || describeEvent(meta.eventId || entry.eventId) || 'Event',
        openstaand: 0,
        currency: entry.currency || 'EUR',
        status: status || 'OPEN'
      };
      existing.openstaand += amount;
      existing.currency = entry.currency || existing.currency;
      existing.status = status || existing.status;
      debtors.set(key, existing);
    } else if (meta.source === 'purchase-invoice') {
      if (status === 'PAID') return;
      const baseKey = meta.invoiceNumber ? `${meta.invoiceNumber}-${meta.creditorName || ''}` : (meta.creditorName || entry.id);
      const key = baseKey || entry.id;
      const amount = entry.direction === 'CREDIT' ? Number(entry.amount) : -Number(entry.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const existing = creditors.get(key) || {
        id: key,
        naam: meta.creditorName || entry.note || 'Crediteur',
        openstaand: 0,
        currency: entry.currency || 'EUR',
        status: status || 'OPEN',
        contact: meta.contact || ''
      };
      existing.openstaand += amount;
      existing.currency = entry.currency || existing.currency;
      existing.status = status || existing.status;
      creditors.set(key, existing);
    }
  });
  const toArray = (map) => Array.from(map.values()).map((record) => ({
    ...record,
    openstaand: Math.round(Number(record.openstaand || 0) * 100) / 100
  })).filter((record) => Number.isFinite(record.openstaand) && record.openstaand > 0.009);
  return {
    debtors: toArray(debtors),
    creditors: toArray(creditors)
  };
}

function mergePartyLists(primary = [], secondary = []) {
  const map = new Map();
  (Array.isArray(primary) ? primary : []).forEach((party) => {
    const key = party?.id || party?.naam || party?.name;
    if (!key) return;
    map.set(key, { ...party });
  });
  (Array.isArray(secondary) ? secondary : []).forEach((party) => {
    const key = party?.id || party?.naam || party?.name;
    if (!key) return;
    if (map.has(key)) {
      const existing = map.get(key);
      const current = Number(resolvePartyBalance(existing));
      const extra = Number(resolvePartyBalance(party));
      const total = Math.round((current + extra) * 100) / 100;
      existing.openstaand = total;
      existing.currency = party.currency || existing.currency;
      if (party.status) existing.status = party.status;
      if (!resolvePartyContact(existing) && party.contact) existing.contact = party.contact;
    } else {
      map.set(key, { ...party });
    }
  });
  return Array.from(map.values()).filter((item) => Number(resolvePartyBalance(item)) !== 0);
}

function resolvePartyContact(party) {
  const candidates = [
    party?.contact,
    party?.email,
    party?.telefoon,
    party?.phone,
    party?.raw?.contact,
    party?.raw?.email,
    party?.raw?.telefoon,
    party?.raw?.phone
  ];
  for (const candidate of candidates) {
    if (candidate && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return '';
}

function resolvePartyBalance(party) {
  const candidates = [
    party?.openstaand,
    party?.saldo,
    party?.amount,
    party?.bedrag,
    party?.raw?.openstaand,
    party?.raw?.saldo,
    party?.raw?.amount,
    party?.raw?.bedrag
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const normalized = candidate.replace(',', '.').replace(/[^0-9.-]/g, '');
      const num = Number(normalized);
      if (Number.isFinite(num)) return num;
    } else {
      const num = Number(candidate);
      if (Number.isFinite(num)) return num;
    }
  }
  return 0;
}

function resolvePartyCurrency(party) {
  const candidates = [
    party?.currency,
    party?.valuta,
    party?.raw?.currency,
    party?.raw?.valuta,
    party?.raw?.currencyCode
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toUpperCase();
    }
  }
  return 'EUR';
}

function renderSummaryCard(item) {
  const { currency, income, expense, balance } = item;
  return `
    <article class="acc-card acc-metric">
      <header>${currency}</header>
      <dl>
        <div><dt>Inkomsten</dt><dd>${formatCurrency(income, currency)}</dd></div>
        <div><dt>Uitgaven</dt><dd>${formatCurrency(expense, currency)}</dd></div>
        <div><dt>Saldo</dt><dd class="${balance >= 0 ? 'pos' : 'neg'}">${formatCurrency(balance, currency)}</dd></div>
      </dl>
    </article>
  `;
}

function renderRecentActivity(entries) {
  if (!entries.length) {
    return '<div class="acc-card acc-activity"><p class="acc-empty">Geen transacties voor deze filters.</p></div>';
  }
  const top = entries.slice(0, 6);
  return `
    <div class="acc-card acc-activity">
      <h3>Laatste boekingen</h3>
      <ul class="acc-activity-list">
        ${top.map(renderActivityItem).join('')}
      </ul>
    </div>
  `;
}

function renderActivityItem(entry) {
  const date = formatDate(entry.date || entry.createdAt);
  const eventLabel = entry.eventId ? describeEvent(entry.eventId) : 'Algemeen';
  const note = entry.note ? escapeHtml(entry.note) : (entry.type === 'income' ? 'Inkomst' : 'Uitgave');
  const categoryLabel = entry.category ? escapeHtml(entry.category) : 'Geen categorie';
  return `
    <li>
      <div class="acc-activity-main">
        <span class="acc-activity-amount ${entry.type === 'income' ? 'income' : 'expense'}">${formatCurrency(entry.amount, entry.currency)}</span>
        <span class="acc-activity-note">${note}</span>
      </div>
      <div class="acc-activity-meta">
        <span>${escapeHtml(entry.account || 'Algemeen')}</span>
        <span>${categoryLabel}</span>
        <span>${escapeHtml(eventLabel)}</span>
        <time datetime="${escapeHtml(entry.date || '')}">${date}</time>
      </div>
    </li>
  `;
}

function renderJournal(entries) {
  if (!entries.length) {
    return '<div class="acc-card acc-empty">Geen transacties om te tonen.</div>';
  }
  return `
    <div class="acc-card">
      <div class="acc-table-wrapper">
        <table class="acc-journal-table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Account</th>
              <th>Event</th>
              <th>Categorie</th>
              <th>Omschrijving</th>
              <th>Bedrag</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(renderJournalRow).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderJournalRow(entry) {
  const eventLabel = entry.eventId ? describeEvent(entry.eventId) : 'Algemeen';
  const note = entry.note ? escapeHtml(entry.note) : (entry.type === 'income' ? 'Inkomst' : 'Uitgave');
  const amountClass = entry.type === 'income' ? 'income' : 'expense';
  return `
    <tr>
      <td>${formatDate(entry.date || entry.createdAt)}</td>
      <td>${escapeHtml(entry.account || 'Algemeen')}</td>
      <td>${escapeHtml(eventLabel)}</td>
      <td>${escapeHtml(entry.category || 'Geen categorie')}</td>
      <td>${note}</td>
      <td class="${amountClass}">${formatCurrency(entry.amount, entry.currency)}</td>
    </tr>
  `;
}

function renderExport(entries) {
  const count = entries.length;
  return `
    <div class="acc-card acc-export">
      <h3>Exporteren</h3>
      <p>Download een snel overzicht van de huidige selectie (${count} ${count === 1 ? 'transactie' : 'transacties'}).</p>
      <div class="acc-export-actions">
        <button type="button" class="btn-export groen" data-export="csv">📁 CSV</button>
        <button type="button" class="btn-export blauw" data-export="excel">📊 Excel</button>
        <button type="button" class="btn-export amber" data-export="pdf">📄 PDF-rapport</button>
      </div>
      <p class="acc-export-hint">Exports gebruiken de filters bovenaan voor event, account en periode.</p>
    </div>
  `;
}

function bindExportButtons(container, entries) {
  if (!container) return;
  const snapshot = entries.map((entry) => ({ ...entry }));
  container.querySelectorAll('.btn-export[data-export]').forEach((button) => {
    const type = button.getAttribute('data-export');
    button.addEventListener('click', () => {
      if (!snapshot.length) {
        window.alert?.('Geen transacties beschikbaar voor export.');
        return;
      }
      const rows = prepareLedgerRows(snapshot);
      if (!rows.length) {
        window.alert?.('Geen transacties beschikbaar voor export.');
        return;
      }
      if (type === 'csv') {
        exportLedgerToCSV(rows);
      } else if (type === 'excel') {
        exportLedgerToExcel(rows);
      } else if (type === 'pdf') {
        exportLedgerToPDF(rows);
      }
    });
  });
}

function prepareLedgerRows(entries) {
  const categories = Array.isArray(store.state.db?.accounting?.categories) ? store.state.db.accounting.categories : [];
  const accounts = Array.isArray(store.state.db?.accounting?.accounts) ? store.state.db.accounting.accounts : [];
  const categoryMap = new Map(categories.map((cat) => [normalizeLedgerField(cat.id || cat.uuid || cat.code || cat.slug), cat]));
  const accountMap = new Map(accounts.map((acc) => [normalizeLedgerField(acc.id || acc.uuid || acc.code || acc.slug), acc]));

  return entries.map((entry) => {
    const categoryId = normalizeLedgerField(entry.categoryId || entry.category);
    const accountId = normalizeLedgerField(entry.account || entry.accountId);
    const signed = resolveLedgerSignedAmount(entry);
    const eurValue = resolveLedgerAmountEUR(entry, signed);
    const eventId = entry.eventId || entry.event || entry.eventUuid || entry.meta?.eventId || null;
    return {
      date: formatDateYMD(entry.date || entry.datum || entry.day || entry.ymd || entry.createdAt || entry.timestamp),
      type: entry.type === 'expense' || (entry.direction && String(entry.direction).toUpperCase() === 'CREDIT') ? 'Uitgave' : 'Inkomst',
      accountId,
      accountLabel: accountId ? (accountMap.get(accountId)?.name || accountMap.get(accountId)?.naam || accountId) : 'Algemeen',
      categoryId,
      categoryLabel: categoryId ? (categoryMap.get(categoryId)?.name || categoryMap.get(categoryId)?.naam || categoryId) : 'Onbekend',
      eventLabel: eventId ? describeEvent(eventId) : 'Geen event',
      note: (entry.note || entry.description || entry.omschrijving || '').toString().trim(),
      currency: (entry.currency || 'EUR').toString().toUpperCase(),
      signed,
      signedLabel: formatCurrencyValue(signed, (entry.currency || 'EUR').toString().toUpperCase()),
      eurValue,
      eurLabel: formatCurrencyValue(eurValue, 'EUR')
    };
  });
}

function exportLedgerToCSV(rows) {
  const header = ['datum', 'type', 'rekening', 'categorie', 'event', 'omschrijving', 'bedrag', 'valuta', 'bedrag_geformatteerd', 'bedrag_eur', 'bedrag_eur_geformatteerd'];
  const lines = [header.join(',')];
  rows.forEach((row) => {
    lines.push([
      row.date,
      row.type,
      row.accountLabel,
      row.categoryLabel,
      row.eventLabel,
      row.note,
      row.signed.toFixed(2),
      row.currency,
      row.signedLabel.replace(/\u00A0/g, ' '),
      row.eurValue.toFixed(2),
      row.eurLabel.replace(/\u00A0/g, ' ')
    ].map(csvEscape).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `ledger_${Date.now()}.csv`);
}

function exportLedgerToExcel(rows) {
  const header = ['Datum', 'Type', 'Rekening', 'Categorie', 'Event', 'Omschrijving', 'Bedrag', 'Valuta', 'Bedrag (EUR)'];
  const body = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td>${escapeHtml(row.type)}</td>
      <td>${escapeHtml(row.accountLabel)}</td>
      <td>${escapeHtml(row.categoryLabel)}</td>
      <td>${escapeHtml(row.eventLabel)}</td>
      <td>${escapeHtml(row.note)}</td>
      <td>${escapeHtml(row.signedLabel)}</td>
      <td>${escapeHtml(row.currency)}</td>
      <td>${escapeHtml(row.eurLabel)}</td>
    </tr>
  `).join('');

  const html = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <table>
          <thead><tr>${header.map((col) => `<th>${escapeHtml(col)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  downloadBlob(blob, `ledger_${Date.now()}.xls`);
}

function exportLedgerToPDF(rows) {
  const jsPDF = window.jspdf?.jsPDF;
  if (typeof jsPDF !== 'function') {
    console.warn('jsPDF niet beschikbaar voor PDF-export.');
    window.alert?.('PDF-export vereist jsPDF in de browser.');
    return;
  }

  const doc = new jsPDF('p', 'pt', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const lineHeight = 18;
  const colX = [40, 110, 200, 320, 460, 540];

  doc.setFontSize(16);
  doc.text('Boekhoudexport', 40, 40);
  doc.setFontSize(10);
  doc.text(`Gegenereerd: ${new Date().toLocaleString('nl-NL')}`, 40, 58);

  let y = 82;
  drawPdfHeader();

  rows.forEach((row) => {
    const values = [
      row.date,
      row.type,
      truncateForPdf(row.accountLabel, 20),
      truncateForPdf(row.categoryLabel, 20),
      row.signedLabel,
      row.eurLabel
    ];
    values.forEach((text, index) => {
      doc.text(text, colX[index], y);
    });
    y += lineHeight;
    if (y > pageHeight - 40) {
      doc.addPage();
      y = 40;
      drawPdfHeader();
      y += lineHeight;
    }
  });

  doc.save(`ledger_${Date.now()}.pdf`);

  function drawPdfHeader() {
    doc.setFont(undefined, 'bold');
    ['Datum', 'Type', 'Account', 'Categorie', 'Bedrag', 'EUR'].forEach((label, index) => {
      doc.text(label, colX[index], y);
    });
    doc.setFont(undefined, 'normal');
    y += lineHeight;
  }
}

function resolveLedgerSignedAmount(entry) {
  const signedCandidate = Number(entry?.signedAmount ?? entry?.amountSigned ?? entry?.signed_amount);
  if (Number.isFinite(signedCandidate) && signedCandidate !== 0) return signedCandidate;
  const amount = Number(entry?.amount ?? entry?.value ?? entry?.bedrag);
  if (!Number.isFinite(amount) || amount === 0) return 0;
  const direction = (entry?.direction || '').toString().toUpperCase();
  if (direction === 'CREDIT') return -amount;
  if (direction === 'DEBIT') return amount;
  return entry?.type === 'expense' ? -amount : amount;
}

function resolveLedgerAmountEUR(entry, signedAmount) {
  const currency = (entry?.currency || 'EUR').toString().toUpperCase();
  if (currency === 'EUR') return signedAmount;
  const rate = resolveEntryExchangeRate(entry, currency);
  if (!Number.isFinite(rate) || rate <= 0) return signedAmount;
  return signedAmount * rate;
}

function resolveEntryExchangeRate(entry, currency) {
  const candidates = [
    entry?.exchangeRate,
    entry?.rate,
    entry?.meta?.exchangeRate,
    entry?.meta?.eurPerUsd,
    entry?.meta?.usdToEur
  ];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return lookupCurrencyRate(currency);
}

const exportRateCache = new Map();

function lookupCurrencyRate(currency) {
  const code = (currency || '').toString().toUpperCase();
  if (!code || code === 'EUR') return 1;
  if (exportRateCache.has(code)) return exportRateCache.get(code);
  const list = Array.isArray(store.state.db?.wisselkoersen) ? store.state.db.wisselkoersen : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const from = (item.from || item.source || item.currency || item.code || '').toString().toUpperCase();
    const to = (item.to || item.target || item.doel || item.quote || 'EUR').toString().toUpperCase();
    const rate = Number(item.rate ?? item.value ?? item.prijs ?? item.eur ?? item.factor ?? item.amount ?? item.usdToEur);
    if (from === code && (!to || to === 'EUR') && Number.isFinite(rate) && rate > 0) {
      exportRateCache.set(code, rate);
      return rate;
    }
    if (to === code && from === 'EUR' && Number.isFinite(rate) && rate > 0) {
      const converted = 1 / rate;
      exportRateCache.set(code, converted);
      return converted;
    }
  }
  exportRateCache.set(code, 1);
  return 1;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n;]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function formatDateYMD(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeLedgerField(value) {
  if (value == null) return '';
  return String(value).trim();
}

function truncateForPdf(value, maxLength) {
  const str = String(value ?? '');
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 1)}…`;
}

function buildCurrencySummary(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    const currency = entry.currency || 'EUR';
    if (!map.has(currency)) {
      map.set(currency, { currency, income: 0, expense: 0, balance: 0 });
    }
    const record = map.get(currency);
    if (entry.type === 'income') {
      record.income += entry.amount;
    } else {
      record.expense += entry.amount;
    }
    record.balance = record.income - record.expense;
  });
  return Array.from(map.values());
}

function formatCurrency(value, currency = 'EUR') {
  const formatter = new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return formatter.format(Number.isFinite(value) ? value : 0);
}

function formatDate(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return date.toLocaleString('nl-NL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function describeEvent(eventId) {
  if (!eventId || eventId === 'all') return 'Alle events';
  const events = Array.isArray(store.state.db?.evenementen) ? store.state.db.evenementen : [];
  const match = events.find((event) => {
    const id = event?.id ?? event?.uuid ?? event?.slug ?? event?.naam;
    return id === eventId;
  });
  if (!match) return 'Onbekend event';
  const labelParts = [match?.naam, match?.locatie].filter(Boolean);
  return labelParts.length ? labelParts.join(' • ') : match?.naam || 'Event';
}

function describeAccount(accountId) {
  if (!accountId || accountId === 'all') return 'Alle rekeningen';
  const accountMap = buildAccountMap();
  const record = accountMap.get(accountId);
  return record?.name || accountId;
}

function describePeriod(period) {
  switch (period) {
    case 'today':
      return 'Vandaag';
    case '7d':
      return 'Laatste 7 dagen';
    case '30d':
      return 'Laatste 30 dagen';
    case 'year':
      return 'Dit jaar';
    default:
      return 'Alle transacties';
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
