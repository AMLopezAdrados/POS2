// 📦 3_data.js – Centrale datahandling Olga’s Cheese POS (SHELL-compatible)

import { showLoading, hideLoading, showAlert } from './4_ui.js';
import { toonVoorraadModal } from './6_beheerVoorraad.js';
import { upgradeGebruikersData } from './11_gebruikersbeheer.js';
import { store } from './store.js';
import { apiFetch } from './api.js';
import { loadFinanceData, normalizeFinanceData } from './19_cashflow.js';

const LEDGER_CATEGORY_EVENT_INCOME = 'cat-event-income';
const LEDGER_CATEGORY_EVENT_EXPENSE = 'cat-event-expense';
const LEDGER_CATEGORY_PURCHASE_INVOICE = 'cat-purchase-invoice';
const LEDGER_CATEGORY_OVERHEAD_EXPENSE = 'cat-overhead-expense';
const LEDGER_ACCOUNT_EVENT_INCOME_EUR = 'acct-event-income-eur';
const LEDGER_ACCOUNT_EVENT_EXPENSE_EUR = 'acct-event-expense-eur';
const LEDGER_ACCOUNT_EVENT_DEBTOR_EUR = 'acct-event-debtor-eur';
const LEDGER_ACCOUNT_PURCHASE_CREDITOR_EUR = 'acct-purchase-creditor-eur';
const LEDGER_COLOR_INCOME = '#2A9626';
const LEDGER_COLOR_EXPENSE = '#E74C3C';
const LEDGER_COLOR_PURCHASE = '#6C5CE7';
const LEDGER_COLOR_OVERHEAD = '#0984E3';

const DEFAULT_LOCATION_LIST = [
  'Ramstein',
  'Spangdahlem',
  'Stuttgart',
  'Chievres',
  'Wiesbaden',
  'Grafenwoehr',
  'Vilseck',
  'Hohenfels',
  'Aviano',
  'Vicenza',
  'Napels',
  'Rota',
  'Brunssum'
];

const DEFAULT_SETTINGS = {
  locaties: [...DEFAULT_LOCATION_LIST]
};

const ACCOUNTING_PENDING_STORAGE_KEY = 'ocpos.accounting.pendingQueue.v1';

export const db = {
  producten: [],
  voorraad: {},
  evenementen: [],
  wisselkoersen: [],
  gebruikers: [],
  kosten: [],
  reizen: [],
  accounting: {
    entries: [],
    categories: [],
    accounts: [],
    pendingQueue: []
  },
  finance: normalizeFinanceData(loadFinanceData()),
  settings: { ...DEFAULT_SETTINGS },
  debCrediteuren: {
    debiteuren: [],
    crediteuren: [],
    updatedAt: null
  },
  verkoopMutaties: {
    version: 1,
    events: {}
  },
  verkoopMix: {
    version: 2,
    totals: {
      categories: { BG: 0, ROOK: 0, GEIT: 0 },
      products: {},
      total: 0
    },
    ratio: {
      categories: { BG: 0, ROOK: 0, GEIT: 0 },
      products: {}
    },
    events: {},
    updatedAt: null
  }
};

const storedAccountingPendingQueue = readStoredAccountingPendingQueue()
  .map(normalizePendingAccountingAction)
  .filter(Boolean);

if (storedAccountingPendingQueue.length) {
  db.accounting.pendingQueue = storedAccountingPendingQueue;
  persistAccountingPendingQueue(storedAccountingPendingQueue);
}

async function fetchWithRetry(path, retries = 1, delay = 30000) {
  try {
    const response = await apiFetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    console.warn("🔁 Retry attempt due to fetch error:", err);
    if (retries > 0) {
      await new Promise(res => setTimeout(res, delay));
      return fetchWithRetry(path, retries - 1, delay);
    }
    throw err;
  }
}

function normalizeVoorraadShape(data) {
  if (!data || typeof data !== 'object') return {};
  const vals = Object.values(data);
  const isFlat = vals.length > 0 && vals.every(v => typeof v === 'number');
  if (isFlat) {
    const busKey =
      (typeof store?.state?.session?.meta?.bus === 'string' && store.state.session.meta.bus) ||
      Object.keys(db.voorraad || {})[0] ||
      'RENE';
    return { [busKey]: data };
  }
  return data;
}

async function fetchOptionalJson(path) {
  try {
    const response = await apiFetch(path);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (parseErr) {
      console.warn(`[POS] JSON parse fout voor optioneel bestand ${path}:`, parseErr);
      return null;
    }
  } catch (err) {
    console.warn(`[POS] Optioneel bestand niet beschikbaar (${path}):`, err);
    return null;
  }
}

function toPositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeSupplierName(raw) {
  if (raw == null) return '';
  const value = String(raw).trim();
  return value;
}

function normalizeProductCatalog(products) {
  if (!Array.isArray(products)) return [];
  return products.map(item => {
    const supplier = normalizeSupplierName(
      item.leverancier ?? item.supplier ?? item.Supplier ?? item.vendor
    );
    const normalized = { ...item, leverancier: supplier };
    if (normalized.supplier !== supplier) {
      normalized.supplier = supplier;
    }
    return normalized;
  });
}

function normalizeCheeseSource(source) {
  if (!source || typeof source !== 'object') return null;
  const clone = {};
  if (source.start && typeof source.start === 'object') {
    clone.start = {
      BG: toPositiveNumber(source.start.BG ?? source.start.bg),
      ROOK: toPositiveNumber(source.start.ROOK ?? source.start.rook),
      GEIT: toPositiveNumber(source.start.GEIT ?? source.start.geit),
      timestamp: source.start.timestamp || null
    };
  }
  if (source.supplements && typeof source.supplements === 'object') {
    clone.supplements = {
      BG: toPositiveNumber(source.supplements.BG ?? source.supplements.bg),
      ROOK: toPositiveNumber(source.supplements.ROOK ?? source.supplements.rook),
      GEIT: toPositiveNumber(source.supplements.GEIT ?? source.supplements.geit)
    };
  }
  if (source.end && typeof source.end === 'object') {
    clone.end = {
      BG: toPositiveNumber(source.end.BG ?? source.end.bg),
      ROOK: toPositiveNumber(source.end.ROOK ?? source.end.rook),
      GEIT: toPositiveNumber(source.end.GEIT ?? source.end.geit),
      timestamp: source.end.timestamp || null
    };
  }
  return clone;
}

const MUTATION_TYPES = ['quick', 'snijkaas', 'transfer', 'correctie'];

function normalizeMutationType(value, fallback = 'quick') {
  const normalized = String(value || fallback || 'quick').toLowerCase();
  if (MUTATION_TYPES.includes(normalized)) return normalized;
  return fallback;
}

function toSafeInteger(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.trunc(num);
}

function cloneMutationMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(meta));
  } catch (err) {
    console.warn('[POS] cloneMutationMeta failed', err);
    return null;
  }
}

function normalizeMutationEntry(raw, defaults = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const now = new Date().toISOString();
  const productId = (raw.productId || raw.product || raw.name || defaults.productId || '').toString().trim();
  if (!productId) return null;

  const quantity = toSafeInteger(raw.quantity ?? raw.qty ?? raw.amount ?? defaults.quantity ?? 0);
  if (!quantity) return null;

  const entry = {
    id: (raw.id || raw.uuid || `${productId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`).toString(),
    productId,
    quantity,
    busId: (raw.busId || raw.bus || defaults.busId || '').toString().trim() || null,
    type: normalizeMutationType(raw.type || defaults.type),
    userId: (raw.userId || raw.user || raw.gebruiker || defaults.userId || '').toString().trim() || null,
    note: (raw.note || raw.opmerking || '').toString().trim() || '',
    createdAt: raw.createdAt || raw.timestamp || defaults.createdAt || now,
    updatedAt: raw.updatedAt || defaults.updatedAt || now
  };

  const meta = cloneMutationMeta(raw.meta) || cloneMutationMeta(defaults.meta);
  if (meta) entry.meta = meta;

  return entry;
}

function cloneMutationEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    id: entry.id,
    productId: entry.productId,
    quantity: entry.quantity,
    busId: entry.busId || null,
    type: entry.type,
    userId: entry.userId || null,
    note: entry.note || '',
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    meta: cloneMutationMeta(entry.meta)
  };
}

function clonePaperChecklist(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.entries(raw).forEach(([key, value]) => {
    if (!key) return;
    const checkedAt = value?.checkedAt || value?.timestamp || value?.checked_at || value?.ts;
    const userId = value?.userId || value?.user || value?.gebruiker || value?.by || null;
    out[key] = {
      checkedAt: checkedAt ? new Date(checkedAt).toISOString() : null,
      userId: userId ? String(userId) : null
    };
  });
  return out;
}

function normalizePaperChecklist(raw) {
  const normalized = {};
  if (!raw || typeof raw !== 'object') return normalized;
  Object.entries(raw).forEach(([key, value]) => {
    if (!key) return;
    if (value === false || value == null) return;
    if (typeof value === 'object') {
      const checkedAt = value.checkedAt || value.timestamp || value.checked_at || value.ts || new Date().toISOString();
      const userId = value.userId || value.user || value.by || value.gebruiker || null;
      normalized[key] = {
        checkedAt: new Date(checkedAt).toISOString(),
        userId: userId ? String(userId) : null
      };
    } else {
      normalized[key] = {
        checkedAt: new Date().toISOString(),
        userId: null
      };
    }
  });
  return normalized;
}

function normalizeEventMutations(raw) {
  const base = { version: 1, entries: [], updatedAt: null, paperChecklist: {} };
  if (!raw) return base;

  if (Array.isArray(raw.entries)) {
    const list = raw.entries
      .map(item => normalizeMutationEntry(item))
      .filter(Boolean);
    return {
      version: Number(raw.version) || 1,
      entries: list,
      updatedAt: raw.updatedAt || null,
      paperChecklist: normalizePaperChecklist(raw.paperChecklist)
    };
  }

  if (Array.isArray(raw)) {
    return {
      version: 1,
      entries: raw.map(item => normalizeMutationEntry(item)).filter(Boolean),
      updatedAt: null,
      paperChecklist: {}
    };
  }

  return base;
}

function updateDbMutationCache(eventId, normalized) {
  if (!eventId) return;
  if (!db.verkoopMutaties) db.verkoopMutaties = { version: 1, events: {} };
  db.verkoopMutaties.events[eventId] = {
    version: Number(normalized?.version) || 1,
    entries: Array.isArray(normalized?.entries)
      ? normalized.entries.map(entry => cloneMutationEntry(entry))
      : [],
    updatedAt: normalized?.updatedAt || null,
    paperChecklist: clonePaperChecklist(normalized?.paperChecklist)
  };
}

function ensureEventMutations(event) {
  if (!event) return { version: 1, entries: [], updatedAt: null, paperChecklist: {} };
  if (!event.verkoopMutaties || typeof event.verkoopMutaties !== 'object') {
    event.verkoopMutaties = { version: 1, entries: [], updatedAt: null, paperChecklist: {} };
  }
  if (!Array.isArray(event.verkoopMutaties.entries)) {
    event.verkoopMutaties = normalizeEventMutations(event.verkoopMutaties);
  } else if (!event.verkoopMutaties.paperChecklist || typeof event.verkoopMutaties.paperChecklist !== 'object') {
    event.verkoopMutaties.paperChecklist = {};
  }
  updateDbMutationCache(event.id || event.naam || event.uuid || null, event.verkoopMutaties);
  return event.verkoopMutaties;
}

function normalizeLedgerParty(entry, fallbackType) {
  if (!entry || typeof entry !== 'object') return null;
  const id = (entry.id || entry.uuid || entry.code || '').toString().trim();
  const resolvedId = id || `${fallbackType}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: resolvedId,
    naam: (entry.naam || entry.name || entry.company || '').toString().trim() || 'Onbekend',
    contact: (entry.contact || entry.email || entry.telefoon || entry.phone || '').toString().trim(),
    iban: (entry.iban || entry.bank || '').toString().trim(),
    nota: (entry.nota || entry.note || entry.opmerking || '').toString().trim(),
    type: fallbackType,
    raw: { ...entry }
  };
}

function normalizeDebCredData(raw) {
  const base = { debiteuren: [], crediteuren: [], updatedAt: null };
  if (!raw || typeof raw !== 'object') return base;
  const debiteuren = Array.isArray(raw.debiteuren)
    ? raw.debiteuren.map(item => normalizeLedgerParty(item, 'debiteur')).filter(Boolean)
    : [];
  const crediteuren = Array.isArray(raw.crediteuren)
    ? raw.crediteuren.map(item => normalizeLedgerParty(item, 'crediteur')).filter(Boolean)
    : [];
  return {
    debiteuren,
    crediteuren,
    updatedAt: raw.updatedAt || raw.timestamp || raw.bijgewerktOp || null
  };
}

function normalizeSettingsData(raw) {
  const base = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const locatiesInput = Array.isArray(raw.locaties) ? raw.locaties : [];
  const seen = new Set();
  const locaties = [];

  for (const entry of locatiesInput) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    locaties.push(trimmed);
  }

  if (!locaties.length) {
    base.locaties.forEach(loc => {
      if (!seen.has(loc.toLowerCase())) {
        seen.add(loc.toLowerCase());
        locaties.push(loc);
      }
    });
  }

  locaties.sort((a, b) => a.localeCompare(b, 'nl', { sensitivity: 'base' }));

  return {
    ...base,
    ...raw,
    locaties
  };
}

export function getKnownLocations() {
  const source = Array.isArray(db?.settings?.locaties) ? db.settings.locaties : DEFAULT_LOCATION_LIST;
  return [...new Set(source.map(loc => (typeof loc === 'string' ? loc.trim() : '')).filter(Boolean))];
}

export function getSettings() {
  return { ...db.settings, locaties: getKnownLocations() };
}

function generateLedgerId(prefix = 'acc') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLedgerDate(value, fallbackDate = new Date()) {
  const parsed = parseDateLoose(value) || parseDateLoose(fallbackDate) || new Date();
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeLedgerCurrency(value, fallback = 'EUR') {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().toUpperCase();
  }
  return fallback;
}

function normalizeLedgerAmount(value, fallback = 0) {
  const normalized = normalizeMoneyValue(value);
  if (normalized == null) return Math.round(fallback * 100) / 100;
  return normalized;
}

function normalizeAccountingCategory(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = (raw.id || raw.uuid || raw.code || raw.slug || '').toString().trim();
  const naam = (raw.naam || raw.name || raw.label || '').toString().trim();
  if (!id && !naam) return null;
  return {
    id: id || generateLedgerId('cat'),
    name: naam || id || 'Categorie',
    color: (raw.color || raw.kleur || '').toString().trim() || null,
    type: (raw.type || raw.soort || '').toString().trim() || null
  };
}

function normalizeAccountingAccount(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = (raw.id || raw.uuid || raw.code || raw.slug || '').toString().trim();
  const naam = (raw.naam || raw.name || raw.label || '').toString().trim();
  if (!id && !naam) return null;
  return {
    id: id || generateLedgerId('acct'),
    name: naam || id || 'Rekening',
    iban: (raw.iban || raw.bank || raw.account || '').toString().trim() || null,
    type: (raw.type || raw.soort || '').toString().trim() || null,
    currency: normalizeLedgerCurrency(raw.currency || raw.valuta || raw.currencyCode, 'EUR')
  };
}

function normalizePendingAccountingAction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const action = (raw.action || raw.type || '').toString().toLowerCase();
  if (!['create', 'update', 'delete'].includes(action)) return null;
  const entryId = (raw.entryId || raw.entry_id || raw.targetId || raw.target || raw.id || '').toString().trim();
  const payloadSource = raw.payload && typeof raw.payload === 'object'
    ? raw.payload
    : raw.entry && typeof raw.entry === 'object'
      ? raw.entry
      : null;
  const payload = payloadSource ? JSON.parse(JSON.stringify(payloadSource)) : null;
  return {
    id: (raw.id || generateLedgerId('pend')).toString(),
    action,
    entryId: entryId || (payload?.id || ''),
    payload,
    attempts: Number.isFinite(Number(raw.attempts)) ? Number(raw.attempts) : 0,
    timestamp: raw.timestamp || new Date().toISOString(),
    lastError: raw.lastError || raw.error || null
  };
}

function getAccountingPendingStorage() {
  try {
    if (typeof window !== 'undefined' && window?.localStorage) {
      return window.localStorage;
    }
  } catch (err) {
    console.warn('[Accounting] lokale opslag niet beschikbaar (window)', err);
  }
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {}
  return null;
}

function readStoredAccountingPendingQueue() {
  try {
    const storage = getAccountingPendingStorage();
    if (!storage) return [];
    const raw = storage.getItem(ACCOUNTING_PENDING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[Accounting] kon pendingQueue uit opslag niet lezen', err);
    return [];
  }
}

function persistAccountingPendingQueue(queue = db.accounting?.pendingQueue || []) {
  try {
    const storage = getAccountingPendingStorage();
    if (!storage) return;
    if (!Array.isArray(queue) || queue.length === 0) {
      storage.removeItem(ACCOUNTING_PENDING_STORAGE_KEY);
    } else {
      storage.setItem(ACCOUNTING_PENDING_STORAGE_KEY, JSON.stringify(queue));
    }
  } catch (err) {
    console.warn('[Accounting] kon pendingQueue niet opslaan', err);
  }
}

function mergeStoredAccountingPendingQueue(target) {
  if (!target || typeof target !== 'object') return;
  if (!Array.isArray(target.pendingQueue)) target.pendingQueue = [];
  const existingKeyMap = new Map();
  target.pendingQueue.forEach(item => {
    if (!item) return;
    const key = item.entryId ? `${item.action}:${item.entryId}` : item.id;
    existingKeyMap.set(key, item);
  });

  const stored = readStoredAccountingPendingQueue()
    .map(normalizePendingAccountingAction)
    .filter(Boolean);

  let changed = false;
  stored.forEach(item => {
    const key = item.entryId ? `${item.action}:${item.entryId}` : item.id;
    if (!existingKeyMap.has(key)) {
      target.pendingQueue.push(item);
      existingKeyMap.set(key, item);
      changed = true;
    } else {
      const current = existingKeyMap.get(key);
      if (!current) {
        existingKeyMap.set(key, item);
        changed = true;
        return;
      }
      const attempts = Math.max(Number(current.attempts) || 0, Number(item.attempts) || 0);
      const timestamp = new Date(item.timestamp || current.timestamp || Date.now());
      if ((current.attempts || 0) !== attempts) {
        current.attempts = attempts;
        changed = true;
      }
      if (Number.isFinite(timestamp.getTime())) {
        const existingTs = Number(new Date(current.timestamp || 0).getTime()) || 0;
        if (timestamp.getTime() > existingTs) {
          current.timestamp = timestamp.toISOString();
          changed = true;
        }
      }
      if (item.lastError && item.lastError !== current.lastError) {
        current.lastError = item.lastError;
        changed = true;
      }
      if (item.payload && !current.payload) {
        current.payload = item.payload;
        changed = true;
      }
    }
  });

  if (changed) {
    target.pendingQueue.sort((a, b) => {
      const aTime = new Date(a?.timestamp || 0).getTime();
      const bTime = new Date(b?.timestamp || 0).getTime();
      return aTime - bTime;
    });
  }

  const pendingIds = new Set(
    target.pendingQueue
      .map(item => String(item.entryId || '')).filter(Boolean)
  );
  if (Array.isArray(target.entries) && pendingIds.size > 0) {
    target.entries = target.entries.map(entry => {
      if (!entry) return entry;
      if (!pendingIds.has(String(entry.id))) return entry;
      return { ...entry, pending: true };
    });
  }
}

function sanitizeLedgerIdPart(value, fallback = 'x') {
  const str = (value != null ? String(value) : '').trim();
  if (!str) return fallback;
  return str.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function buildLedgerId(prefix, eventId, recordId) {
  const parts = [
    sanitizeLedgerIdPart(prefix || 'entry', 'entry'),
    sanitizeLedgerIdPart(eventId || 'event'),
    sanitizeLedgerIdPart(recordId || Date.now().toString(36))
  ];
  return parts.join('-').replace(/-+/g, '-');
}

function ensureLedgerCategory(target, id, name, type, color) {
  const container = target || db.accounting;
  if (!container) return id;
  if (!Array.isArray(container.categories)) container.categories = [];
  const existing = container.categories.find(cat => cat.id === id);
  if (existing) {
    let changed = false;
    if (name && existing.name !== name) {
      existing.name = name;
      changed = true;
    }
    if (type && existing.type !== type) {
      existing.type = type;
      changed = true;
    }
    if (color && existing.color !== color) {
      existing.color = color;
      changed = true;
    }
    if (!target && changed) ensureAccountingReference();
    return id;
  }
  container.categories.push({ id, name, type, color });
  if (!target) ensureAccountingReference();
  return id;
}

function ensureLedgerAccount(target, id, name, type, currency) {
  const container = target || db.accounting;
  if (!container) return id;
  if (!Array.isArray(container.accounts)) container.accounts = [];
  const existing = container.accounts.find(acc => acc.id === id);
  if (existing) {
    let changed = false;
    if (name && existing.name !== name) {
      existing.name = name;
      changed = true;
    }
    if (type && existing.type !== type) {
      existing.type = type;
      changed = true;
    }
    if (currency && existing.currency !== currency) {
      existing.currency = currency;
      changed = true;
    }
    if (!target && changed) ensureAccountingReference();
    return id;
  }
  container.accounts.push({ id, name, type, currency });
  if (!target) ensureAccountingReference();
  return id;
}

function ensureLedgerDefaults(target = null) {
  ensureLedgerCategory(target, LEDGER_CATEGORY_EVENT_INCOME, 'Event omzet', 'INCOME', LEDGER_COLOR_INCOME);
  ensureLedgerCategory(target, LEDGER_CATEGORY_EVENT_EXPENSE, 'Event kosten', 'EXPENSE', LEDGER_COLOR_EXPENSE);
  ensureLedgerCategory(target, LEDGER_CATEGORY_PURCHASE_INVOICE, 'Inkoopfacturen', 'EXPENSE', LEDGER_COLOR_PURCHASE);
  ensureLedgerCategory(target, LEDGER_CATEGORY_OVERHEAD_EXPENSE, 'Overheadkosten', 'EXPENSE', LEDGER_COLOR_OVERHEAD);
  ensureLedgerAccount(target, LEDGER_ACCOUNT_EVENT_INCOME_EUR, 'Dagomzet EUR', 'CASH', 'EUR');
  ensureLedgerAccount(target, LEDGER_ACCOUNT_EVENT_EXPENSE_EUR, 'Eventkosten EUR', 'EXPENSE', 'EUR');
  ensureLedgerAccount(target, LEDGER_ACCOUNT_EVENT_DEBTOR_EUR, 'Debiteuren EUR', 'RECEIVABLE', 'EUR');
  ensureLedgerAccount(target, LEDGER_ACCOUNT_PURCHASE_CREDITOR_EUR, 'Crediteuren EUR', 'PAYABLE', 'EUR');
}

function resolveIncomeAccount(paymentMethod, currency, target = null) {
  ensureLedgerDefaults(target);
  const method = (paymentMethod || '').toString().trim().toUpperCase();
  const resolvedCurrency = (currency || 'EUR').toString().trim().toUpperCase() || 'EUR';
  if (method === 'DEBTOR') {
    const id = resolvedCurrency === 'EUR'
      ? LEDGER_ACCOUNT_EVENT_DEBTOR_EUR
      : `${LEDGER_ACCOUNT_EVENT_DEBTOR_EUR}-${resolvedCurrency.toLowerCase()}`;
    const name = `Debiteuren ${resolvedCurrency}`;
    return ensureLedgerAccount(target, id, name, 'RECEIVABLE', resolvedCurrency);
  }
  if (resolvedCurrency === 'EUR') {
    return LEDGER_ACCOUNT_EVENT_INCOME_EUR;
  }
  const id = `acct-event-income-${resolvedCurrency.toLowerCase()}`;
  const name = `Dagomzet ${resolvedCurrency}`;
  return ensureLedgerAccount(target, id, name, 'CASH', resolvedCurrency);
}

function resolveExpenseAccount(currency, target = null) {
  ensureLedgerDefaults(target);
  const resolvedCurrency = (currency || 'EUR').toString().trim().toUpperCase() || 'EUR';
  if (resolvedCurrency === 'EUR') {
    return LEDGER_ACCOUNT_EVENT_EXPENSE_EUR;
  }
  const id = `acct-event-expense-${resolvedCurrency.toLowerCase()}`;
  const name = `Eventkosten ${resolvedCurrency}`;
  return ensureLedgerAccount(target, id, name, 'EXPENSE', resolvedCurrency);
}

function resolveCreditorAccount(currency, target = null) {
  ensureLedgerDefaults(target);
  const resolvedCurrency = (currency || 'EUR').toString().trim().toUpperCase() || 'EUR';
  if (resolvedCurrency === 'EUR') {
    return LEDGER_ACCOUNT_PURCHASE_CREDITOR_EUR;
  }
  const id = `acct-purchase-creditor-${resolvedCurrency.toLowerCase()}`;
  const name = `Crediteuren ${resolvedCurrency}`;
  return ensureLedgerAccount(target, id, name, 'PAYABLE', resolvedCurrency);
}

function getEventDisplayName(event) {
  if (!event || typeof event !== 'object') return 'Evenement';
  return event.naam || event.name || event.title || event.locatie || 'Evenement';
}

function buildDagOmzetLedgerPayload(event, entry, target = null) {
  if (!entry || typeof entry !== 'object') return null;
  const eventId = event?.id || entry.eventId || entry.event || event?.naam || 'event';
  const ledgerId = buildLedgerId('omzet', eventId, entry.id);
  const paymentMethod = (entry.paymentMethod || (entry.debtor ? 'DEBTOR' : 'DIRECT') || 'DIRECT').toString().toUpperCase();
  const eurAmount = normalizeMoneyValue(entry.eur);
  const usdAmount = normalizeMoneyValue(entry.usd);
  const currency = Number.isFinite(eurAmount) && Math.abs(eurAmount) > 0 ? 'EUR'
    : Number.isFinite(usdAmount) && Math.abs(usdAmount) > 0 ? 'USD'
      : 'EUR';
  const amount = currency === 'EUR' ? (eurAmount ?? 0) : (usdAmount ?? 0);
  const accountId = resolveIncomeAccount(paymentMethod, currency, target);
  const categoryId = ensureLedgerCategory(target, LEDGER_CATEGORY_EVENT_INCOME, 'Event omzet', 'INCOME', LEDGER_COLOR_INCOME);
  const eventName = getEventDisplayName(event);
  const rawNote = (entry.note || entry.omschrijving || '').toString().trim();
  const note = rawNote || `Dagomzet ${eventName}`;
  const date = normalizeLedgerDate(entry.date || entry.datum || entry.createdAt || new Date());
  const reference = [eventName, entry.date || ''].filter(Boolean).join(' · ');
  const meta = {
    type: 'INCOME',
    source: 'dagomzet',
    eventId: event?.id || null,
    eventName,
    paymentMethod,
    omzetEntryId: entry.id,
    eur: Number.isFinite(eurAmount) ? eurAmount : null,
    usd: Number.isFinite(usdAmount) ? usdAmount : null
  };
  if (entry.pending) meta.pendingSource = true;
  return {
    id: ledgerId,
    date,
    accountId,
    categoryId,
    amount: Math.round(Math.abs(amount || 0) * 100) / 100,
    direction: 'DEBIT',
    currency,
    note,
    reference,
    meta,
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || new Date().toISOString(),
    pending: Boolean(entry.pending)
  };
}

function normalizeExtraCostForLedger(event, kost) {
  if (!kost || typeof kost !== 'object') return null;
  const id = (kost.id || kost.uuid || kost.code || kost.timestamp || kost.createdAt || '').toString().trim();
  const amount = normalizeMoneyValue(kost.bedrag ?? kost.amount ?? kost.value);
  const currency = (kost.currency || kost.valuta || 'EUR').toString().trim().toUpperCase() || 'EUR';
  const soort = (kost.soort || kost.type || kost.categorie || 'Overige').toString();
  const comment = (kost.comment || kost.opmerking || kost.notitie || '').toString();
  const timestamp = kost.timestamp || kost.createdAt || new Date().toISOString();
  const date = normalizeLedgerDate(kost.date || kost.datum || timestamp || event?.startdatum || new Date());
  return {
    id: id || `${Date.now().toString(36)}${Math.random().toString(16).slice(2)}`,
    amount,
    currency,
    soort,
    comment,
    timestamp,
    date,
    pending: Boolean(kost.pending)
  };
}

function buildExtraCostLedgerPayload(event, kost, target = null) {
  const normalized = normalizeExtraCostForLedger(event, kost);
  if (!normalized) return null;
  const eventId = event?.id || event?.naam || 'event';
  const ledgerId = buildLedgerId('kost', eventId, normalized.id);
  const accountId = resolveExpenseAccount(normalized.currency, target);
  const categoryId = ensureLedgerCategory(target, LEDGER_CATEGORY_EVENT_EXPENSE, 'Event kosten', 'EXPENSE', LEDGER_COLOR_EXPENSE);
  const eventName = getEventDisplayName(event);
  const noteParts = [normalized.soort];
  if (normalized.comment) noteParts.push(normalized.comment);
  const note = noteParts.filter(Boolean).join(' — ') || 'Eventkost';
  const reference = [eventName, 'Extra kost'].filter(Boolean).join(' · ');
  const meta = {
    type: 'EXPENSE',
    source: 'extraCost',
    eventId: event?.id || null,
    eventName,
    kostId: normalized.id,
    soort: normalized.soort,
    comment: normalized.comment
  };
  if (kost?.meta && typeof kost.meta === 'object') {
    meta.extra = { ...kost.meta };
  }
  if (normalized.pending) meta.pendingSource = true;
  return {
    id: ledgerId,
    date: normalized.date,
    accountId,
    categoryId,
    amount: Math.round(Math.abs(normalized.amount || 0) * 100) / 100,
    direction: 'CREDIT',
    currency: normalized.currency,
    note,
    reference,
    meta,
    createdAt: normalized.timestamp,
    updatedAt: normalized.timestamp,
    pending: normalized.pending
  };
}

function normalizePurchaseInvoiceForLedger(invoice) {
  if (!invoice || typeof invoice !== 'object') return null;
  const amount = normalizeMoneyValue(invoice.amount ?? invoice.bedrag ?? invoice.total);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currency = (invoice.currency || invoice.valuta || 'EUR').toString().trim().toUpperCase() || 'EUR';
  const supplier = (invoice.creditor || invoice.supplier || invoice.leverancier || '').toString().trim();
  const invoiceNumber = (invoice.invoiceNumber || invoice.factuurNummer || invoice.number || '').toString().trim();
  const note = (invoice.note || invoice.omschrijving || invoice.beschrijving || '').toString().trim();
  const date = normalizeLedgerDate(invoice.date || invoice.factuurDatum || invoice.createdAt || new Date());
  const dueDate = invoice.dueDate || invoice.vervalDatum || invoice.betaalDatum || null;
  const status = (invoice.status || '').toString().trim().toUpperCase();
  const resolvedStatus = ['BETAALD', 'PAID', 'OPEN', 'OPENSTAAND', 'PENDING'].includes(status)
    ? (status.startsWith('BETAALD') || status === 'PAID' ? 'PAID' : 'OPEN')
    : 'OPEN';
  return {
    amount,
    currency,
    supplier,
    invoiceNumber,
    note,
    date,
    dueDate: dueDate ? normalizeLedgerDate(dueDate) : null,
    status: resolvedStatus,
    eventId: invoice.eventId || invoice.event || null,
    categoryId: invoice.categoryId || invoice.category || null,
    meta: invoice.meta && typeof invoice.meta === 'object' ? { ...invoice.meta } : null
  };
}

function buildPurchaseInvoiceLedgerPayload(invoice, target = null) {
  const normalized = normalizePurchaseInvoiceForLedger(invoice);
  if (!normalized) return null;
  const refs = normalized.eventId ? findEventReferences(normalized.eventId) : null;
  const event = refs?.local || refs?.storeEvent || null;
  const eventId = refs?.resolvedId || normalized.eventId || 'algemeen';
  const eventName = getEventDisplayName(event);
  const ledgerId = buildLedgerId('inkoop', eventId, normalized.invoiceNumber || Date.now().toString(36));
  const accountId = resolveCreditorAccount(normalized.currency, target);
  const categoryId = normalized.categoryId
    ? String(normalized.categoryId)
    : event
      ? ensureLedgerCategory(target, LEDGER_CATEGORY_EVENT_EXPENSE, 'Event kosten', 'EXPENSE', LEDGER_COLOR_EXPENSE)
      : ensureLedgerCategory(target, LEDGER_CATEGORY_PURCHASE_INVOICE, 'Inkoopfacturen', 'EXPENSE', LEDGER_COLOR_PURCHASE);
  const referenceParts = [];
  if (normalized.invoiceNumber) referenceParts.push(normalized.invoiceNumber);
  if (normalized.dueDate) referenceParts.push(`Vervalt ${normalized.dueDate}`);
  const reference = referenceParts.join(' · ');
  const note = normalized.note
    || (normalized.supplier ? `Factuur ${normalized.supplier}` : `Inkoopfactuur ${eventName}`);
  const meta = {
    type: 'EXPENSE',
    source: 'purchase-invoice',
    creditorName: normalized.supplier || null,
    invoiceNumber: normalized.invoiceNumber || null,
    dueDate: normalized.dueDate || null,
    status: normalized.status,
    eventId: event ? eventId : null,
    eventName: event ? eventName : null,
    createdFrom: invoice.createdFrom || 'ui-purchase-invoice',
    quickEntryType: invoice.quickEntryType || null,
    filters: invoice.filters || null
  };
  if (normalized.meta) Object.assign(meta, normalized.meta);
  return {
    id: ledgerId,
    date: normalized.date,
    accountId,
    categoryId,
    amount: Math.round(Math.abs(normalized.amount || 0) * 100) / 100,
    direction: 'CREDIT',
    currency: normalized.currency,
    note,
    reference,
    meta,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pending: Boolean(invoice.pending)
  };
}

function buildEventInvoiceLedgerPayload(event, invoice, target = null) {
  if (!event || typeof event !== 'object') return null;
  const amount = normalizeMoneyValue(invoice.amount ?? invoice.bedrag ?? invoice.eur);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currency = (invoice.currency || 'EUR').toString().trim().toUpperCase() || 'EUR';
  const status = (invoice.status || '').toString().trim().toUpperCase();
  const resolvedStatus = ['PAID', 'BETAALD'].includes(status) ? 'PAID' : 'OPEN';
  const invoiceNumber = (invoice.invoiceNumber || invoice.factuurNummer || '').toString().trim();
  const eventId = event.id || invoice.eventId || 'event';
  const eventName = getEventDisplayName(event);
  const ledgerId = buildLedgerId('event-invoice', eventId, 'final');
  const accountId = resolveIncomeAccount('DEBTOR', currency, target);
  const categoryId = ensureLedgerCategory(target, LEDGER_CATEGORY_EVENT_INCOME, 'Event omzet', 'INCOME', LEDGER_COLOR_INCOME);
  const reference = [invoiceNumber, eventName].filter(Boolean).join(' · ');
  const note = (invoice.note || `Factuur ${eventName}`).toString();
  const expectedEUR = Number.isFinite(invoice.expectedEUR) ? Math.round(invoice.expectedEUR * 100) / 100 : null;
  const meta = {
    type: 'INCOME',
    source: 'event-invoice',
    status: resolvedStatus,
    invoiceNumber: invoiceNumber || null,
    eventId: event.id || null,
    eventName,
    checkedAt: invoice.checkedAt || new Date().toISOString(),
    expectedAmountEUR: expectedEUR,
    finalAmount: amount,
    finalCurrency: currency,
    note: invoice.note || null
  };
  if (invoice.meta && typeof invoice.meta === 'object') Object.assign(meta, invoice.meta);
  return {
    id: ledgerId,
    date: normalizeLedgerDate(invoice.date || invoice.factuurDatum || new Date()),
    accountId,
    categoryId,
    amount: Math.round(Math.abs(amount) * 100) / 100,
    direction: 'DEBIT',
    currency,
    note,
    reference,
    meta,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pending: Boolean(invoice.pending)
  };
}

function migrateEventsToLedgerEntries(entryMap, target) {
  if (!entryMap || entryMap.size > 0) return;
  if (!Array.isArray(db?.evenementen) || db.evenementen.length === 0) return;
  const container = target || db.accounting;
  ensureLedgerDefaults(container);
  db.evenementen.forEach(event => {
    const omzetList = Array.isArray(event?.omzet) ? event.omzet : [];
    const normalizedOmzet = omzetList.map(item => normalizeOmzetEntry(item)).filter(Boolean);
    normalizedOmzet.forEach(entry => {
      const payload = buildDagOmzetLedgerPayload(event, entry, container);
      if (!payload) return;
      payload.meta = { ...(payload.meta || {}), migrated: true };
      if (!entryMap.has(payload.id)) {
        const normalizedEntry = normalizeAccountingEntry(payload);
        if (normalizedEntry) entryMap.set(normalizedEntry.id, normalizedEntry);
      }
    });

    const extraList = Array.isArray(event?.extraKosten) ? event.extraKosten : [];
    extraList.forEach(rawCost => {
      const payload = buildExtraCostLedgerPayload(event, rawCost, container);
      if (!payload) return;
      payload.meta = { ...(payload.meta || {}), migrated: true };
      if (!entryMap.has(payload.id)) {
        const normalizedEntry = normalizeAccountingEntry(payload);
        if (normalizedEntry) entryMap.set(normalizedEntry.id, normalizedEntry);
      }
    });
  });
}

function normalizeAccountingEntry(raw, existing = null) {
  if (!raw || typeof raw !== 'object') return null;
  const nowIso = new Date().toISOString();
  const base = existing ? { ...existing } : {};
  const idSource = raw.id || raw.uuid || raw.code || base.id;
  const id = idSource ? idSource.toString().trim() : generateLedgerId('entry');
  const createdAt = base.createdAt || raw.createdAt || raw.created_at || nowIso;
  const amountValue = normalizeLedgerAmount(raw.amount ?? raw.value ?? raw.bedrag, base.amount || 0);
  const signedAmount = raw.direction && String(raw.direction).toUpperCase() === 'CREDIT'
    ? amountValue * -1
    : amountValue;
  const finalAmount = Number.isFinite(Number(raw.signedAmount))
    ? Number(raw.signedAmount)
    : Number.isFinite(raw.bedragSigned)
      ? Number(raw.bedragSigned)
      : signedAmount;

  const normalized = {
    id,
    date: normalizeLedgerDate(raw.date || raw.datum || base.date || nowIso),
    accountId: (raw.accountId || raw.account || raw.rekening || base.accountId || '').toString().trim(),
    categoryId: (raw.categoryId || raw.category || raw.categorie || base.categoryId || '').toString().trim(),
    amount: Math.round(Math.abs(finalAmount) * 100) / 100,
    direction: (raw.direction || raw.type || base.direction || (finalAmount < 0 ? 'CREDIT' : 'DEBIT')).toString().toUpperCase(),
    currency: normalizeLedgerCurrency(raw.currency || raw.valuta || base.currency || 'EUR'),
    note: (raw.note || raw.omschrijving || raw.beschrijving || raw.description || base.note || '').toString().trim(),
    reference: (raw.reference || raw.referentie || base.reference || '').toString().trim(),
    meta: raw.meta && typeof raw.meta === 'object'
      ? { ...(base.meta || {}), ...raw.meta }
      : base.meta || null,
    createdAt,
    updatedAt: raw.updatedAt || raw.updated_at || nowIso,
    pending: Boolean(raw.pending ?? base.pending)
  };

  if (normalized.direction !== 'DEBIT' && normalized.direction !== 'CREDIT') {
    normalized.direction = finalAmount < 0 ? 'CREDIT' : 'DEBIT';
  }

  if (!normalized.accountId && existing?.accountId) normalized.accountId = existing.accountId;
  if (!normalized.categoryId && existing?.categoryId) normalized.categoryId = existing.categoryId;

  return normalized;
}

function normalizeAccountingData(raw) {
  const base = {
    entries: [],
    categories: [],
    accounts: [],
    pendingQueue: []
  };

  if (!raw || typeof raw !== 'object') return base;

  const entryMap = new Map();
  if (Array.isArray(raw.entries)) {
    raw.entries.forEach(item => {
      const normalized = normalizeAccountingEntry(item);
      if (!normalized) return;
      if (entryMap.has(normalized.id)) return;
      entryMap.set(normalized.id, normalized);
    });
  }

  const categories = Array.isArray(raw.categories)
    ? raw.categories.map(normalizeAccountingCategory).filter(Boolean)
    : [];
  const accounts = Array.isArray(raw.accounts)
    ? raw.accounts.map(normalizeAccountingAccount).filter(Boolean)
    : [];
  const pendingQueue = Array.isArray(raw.pendingQueue)
    ? raw.pendingQueue.map(normalizePendingAccountingAction).filter(Boolean)
    : [];

  base.categories = categories;
  base.accounts = accounts;
  base.pendingQueue = pendingQueue;

  ensureLedgerDefaults(base);
  migrateEventsToLedgerEntries(entryMap, base);

  base.entries = Array.from(entryMap.values()).sort((a, b) => {
    return (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  mergeStoredAccountingPendingQueue(base);

  return base;
}

function normalizeCategoryTotals(raw) {
  const base = { BG: 0, ROOK: 0, GEIT: 0 };
  if (!raw || typeof raw !== 'object') return base;
  const source = raw.categories && typeof raw.categories === 'object' ? raw.categories : raw;
  return {
    BG: toPositiveNumber(source.BG ?? source.bg),
    ROOK: toPositiveNumber(source.ROOK ?? source.rook),
    GEIT: toPositiveNumber(source.GEIT ?? source.geit)
  };
}

function normalizeProductTotals(raw) {
  const result = {};
  if (!raw || typeof raw !== 'object') return result;
  Object.entries(raw).forEach(([name, value]) => {
    const qty = toPositiveNumber(value);
    if (qty > 0) {
      result[name] = qty;
    }
  });
  return result;
}

function sumProductTotals(map) {
  return Object.values(map || {}).reduce((sum, value) => sum + toPositiveNumber(value), 0);
}

function normalizeCheeseMixData(raw) {
  const base = {
    version: 2,
    totals: {
      categories: { BG: 0, ROOK: 0, GEIT: 0 },
      products: {},
      total: 0
    },
    ratio: {
      categories: { BG: 0, ROOK: 0, GEIT: 0 },
      products: {}
    },
    events: {},
    updatedAt: null
  };

  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const version = Number(raw.version);
  base.version = Number.isFinite(version) ? version : raw?.totals?.products ? 2 : 1;

  if (raw.events && typeof raw.events === 'object') {
    Object.entries(raw.events).forEach(([eventId, entry]) => {
      if (!eventId) return;
      const categories = normalizeCategoryTotals(entry?.categories ?? entry);
      const products = normalizeProductTotals(entry?.products);
      let total = toPositiveNumber(entry?.total);
      if (!total) {
        const sumCategories = categories.BG + categories.ROOK + categories.GEIT;
        const sumProducts = sumProductTotals(products);
        total = sumCategories || sumProducts;
      }
      base.events[eventId] = {
        categories,
        products,
        total,
        updatedAt: entry?.updatedAt || null,
        source: normalizeCheeseSource(entry?.source)
      };
    });
  }

  const aggregatedCategories = { BG: 0, ROOK: 0, GEIT: 0 };
  const aggregatedProducts = {};
  let aggregatedTotal = 0;

  if (Object.keys(base.events).length) {
    Object.values(base.events).forEach((entry) => {
      aggregatedCategories.BG += toPositiveNumber(entry.categories?.BG);
      aggregatedCategories.ROOK += toPositiveNumber(entry.categories?.ROOK);
      aggregatedCategories.GEIT += toPositiveNumber(entry.categories?.GEIT);
      Object.entries(entry.products || {}).forEach(([name, value]) => {
        const qty = toPositiveNumber(value);
        if (!qty) return;
        aggregatedProducts[name] = (aggregatedProducts[name] || 0) + qty;
      });
      aggregatedTotal += toPositiveNumber(entry.total);
    });
  } else if (raw.totals && typeof raw.totals === 'object') {
    const categories = normalizeCategoryTotals(raw.totals.categories || raw.totals);
    aggregatedCategories.BG = categories.BG;
    aggregatedCategories.ROOK = categories.ROOK;
    aggregatedCategories.GEIT = categories.GEIT;
    Object.assign(aggregatedProducts, normalizeProductTotals(raw.totals.products));
    aggregatedTotal = toPositiveNumber(raw.totals.total);
  }

  if (!aggregatedTotal) {
    const sumCat = aggregatedCategories.BG + aggregatedCategories.ROOK + aggregatedCategories.GEIT;
    const sumProd = sumProductTotals(aggregatedProducts);
    aggregatedTotal = sumCat || sumProd;
  }

  base.totals = {
    categories: aggregatedCategories,
    products: aggregatedProducts,
    total: aggregatedTotal
  };

  const totalCat = aggregatedCategories.BG + aggregatedCategories.ROOK + aggregatedCategories.GEIT;
  base.ratio.categories = totalCat > 0
    ? {
        BG: aggregatedCategories.BG / totalCat,
        ROOK: aggregatedCategories.ROOK / totalCat,
        GEIT: aggregatedCategories.GEIT / totalCat
      }
    : { BG: 0, ROOK: 0, GEIT: 0 };

  const productTotal = sumProductTotals(aggregatedProducts);
  base.ratio.products = productTotal > 0
    ? Object.fromEntries(Object.entries(aggregatedProducts).map(([name, value]) => [name, toPositiveNumber(value) / productTotal]))
    : {};

  base.updatedAt = raw.updatedAt || null;

  return base;
}

function normalizeMoneyValue(value) {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100;
}

function normalizeExchangeRate(value) {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 10000) / 10000;
}

function normalizeCurrencyCode(value, fallback = 'USD') {
  const raw = value == null ? '' : String(value).trim().toUpperCase();
  if (raw === 'EUR' || raw === 'USD') return raw;
  const fallbackCode = fallback == null ? '' : String(fallback).trim().toUpperCase();
  return fallbackCode === 'EUR' ? 'EUR' : 'USD';
}

function normalizeOmzetDate(value) {
  if (!value && value !== 0) return '';
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '';
    return normalizeOmzetDate(d);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (!Number.isFinite(parsed.getTime())) return '';
    return normalizeOmzetDate(parsed);
  }
  if (value && typeof value === 'object') {
    if (value.date) return normalizeOmzetDate(value.date);
    if (value.dagDatum) return normalizeOmzetDate(value.dagDatum);
    if (value.datum) return normalizeOmzetDate(value.datum);
  }
  return '';
}

function deriveDebtorFromPayment(value) {
  if (value == null) return false;
  const clean = value.toString().trim().toUpperCase();
  if (!clean) return false;
  if (['DEBTOR', 'DEBITEUR', 'INVOICE', 'FACTUUR', 'FACTUUR/DEBITEUR'].includes(clean)) return true;
  return false;
}

function normalizeDebtorFlag(value, fallbackPayment = null) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const clean = value.trim().toLowerCase();
    if (!clean) return deriveDebtorFromPayment(fallbackPayment);
    if (['1', 'true', 'ja', 'j', 'yes', 'y', 'debiteur', 'debtor', 'factuur', 'invoice'].includes(clean)) return true;
    if (['0', 'false', 'nee', 'n', 'no', 'direct', 'contant', 'cash', 'sumup', 'pin', 'bank', 'credit'].includes(clean)) return false;
    return deriveDebtorFromPayment(clean);
  }
  if (value && typeof value === 'object') {
    if ('debtor' in value) return normalizeDebtorFlag(value.debtor, fallbackPayment);
    if ('isDebtor' in value) return normalizeDebtorFlag(value.isDebtor, fallbackPayment);
    if ('debiteur' in value) return normalizeDebtorFlag(value.debiteur, fallbackPayment);
  }
  if (value == null) return deriveDebtorFromPayment(fallbackPayment);
  return Boolean(value);
}

function normalizeOmzetEntry(raw, defaults = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = (raw.id || raw.entryId || raw.uuid || '').toString().trim();
  const nowIso = new Date().toISOString();
  const paymentSource = raw.paymentMethod ?? raw.payment ?? raw.pm ?? defaults.paymentMethod ?? null;
  const debtorFlag = normalizeDebtorFlag(
    raw.debtor ?? raw.debiteur ?? raw.isDebtor ?? raw.invoice ?? raw.isInvoice ?? raw.debtorFlag,
    paymentSource
  );
  const fallbackCurrency = defaults.currency ?? raw.currency ?? raw.currencyCode ?? 'USD';
  const inputCurrency = normalizeCurrencyCode(
    raw.inputCurrency ?? raw.currency ?? raw.currencyCode ?? raw.currencyPreference ?? raw.valuta,
    fallbackCurrency
  );
  const normalized = {
    id: id || `omzet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    date: normalizeOmzetDate(raw.date || raw.dagDatum || raw.dag || raw.datum || raw.day || defaults.date || new Date()),
    usd: normalizeMoneyValue(raw.usd ?? raw.prijs_usd ?? raw.totalUSD ?? raw.amountUSD ?? raw.omzetUSD),
    eur: normalizeMoneyValue(raw.eur ?? raw.prijs_eur ?? raw.totalEUR ?? raw.amountEUR ?? raw.omzetEUR),
    note: (raw.note ?? raw.omschrijving ?? raw.memo ?? raw.beschrijving ?? '').toString().trim(),
    debtor: debtorFlag,
    paymentMethod: debtorFlag ? 'DEBTOR' : 'DIRECT',
    exchangeRate: normalizeExchangeRate(raw.exchangeRate ?? raw.exchangeRateEURperUSD ?? raw.rate ?? raw.koers ?? raw.fxRate),
    createdAt: raw.createdAt || raw.timestamp || raw.created_at || raw.begintijd || nowIso,
    updatedAt: raw.updatedAt || raw.updated_at || raw.bijgewerktOp || raw.timestamp || nowIso,
    pending: Boolean(raw.pending),
    inputCurrency
  };

  if (!normalized.createdAt) normalized.createdAt = nowIso;
  if (!normalized.updatedAt) normalized.updatedAt = normalized.createdAt;
  if (!normalized.date) normalized.date = normalizeOmzetDate(new Date());

  return normalized;
}

function normalizeEventOmzetList(rawList) {
  if (!Array.isArray(rawList)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of rawList) {
    const normalized = normalizeOmzetEntry(entry);
    if (!normalized || !normalized.date) continue;
    if (seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    result.push(normalized);
  }
  result.sort((a, b) => {
    const aDate = new Date(`${a.date}T00:00:00Z`);
    const bDate = new Date(`${b.date}T00:00:00Z`);
    const aValid = !Number.isNaN(aDate.getTime());
    const bValid = !Number.isNaN(bDate.getTime());
    if (aValid && bValid && aDate.getTime() !== bDate.getTime()) {
      return aDate.getTime() - bDate.getTime();
    }
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
  return result;
}

// --------- Centrale loadData ---------
export async function loadData(retries = 3, delayMs = 5000) {
  const timestamp = Date.now();
  const nocache = '?t=' + timestamp;
  try {
    // 1) Basisdata ophalen
    const [
      productenData,
      voorraadData,
      evenementenData,
      koersenData,
      gebruikersData,
      reizenData,
      verkoopMixData,
      debCredData,
      accountingData,
      settingsData
    ] = await Promise.all([
      fetchWithRetry('/products.json' + nocache),
      fetchWithRetry('/get_voorraad.php?t=' + timestamp),
      fetchWithRetry('/evenementen.json' + nocache),
      fetchWithRetry('/wisselkoersen.json' + nocache),
      fetchWithRetry('/gebruikers.json' + nocache),
      fetchWithRetry('/reizen.json' + nocache),
      fetchOptionalJson('/verkoopmix.json' + nocache),
      fetchOptionalJson('/debiteuren.json' + nocache),
      fetchOptionalJson('/api/accounting.json' + nocache),
      fetchOptionalJson('/settings.json' + nocache)
    ]);

    db.producten     = normalizeProductCatalog(productenData);
    db.voorraad      = normalizeVoorraadShape(voorraadData);
    db.evenementen   = Array.isArray(evenementenData) ? evenementenData : [];
    db.wisselkoersen = Array.isArray(koersenData) ? koersenData : [];
    db.gebruikers    = Array.isArray(gebruikersData) ? gebruikersData : [];
    db.reizen        = Array.isArray(reizenData?.reizen) ? reizenData.reizen : (Array.isArray(reizenData) ? reizenData : []);
    db.verkoopMix    = normalizeCheeseMixData(verkoopMixData);
    db.debCrediteuren = normalizeDebCredData(debCredData);
    db.accounting    = normalizeAccountingData(accountingData);
    persistAccountingPendingQueue(db.accounting.pendingQueue);
    db.settings      = normalizeSettingsData(settingsData);
    db.finance       = normalizeFinanceData(loadFinanceData());
    if (store?.state?.db) {
      store.state.db.producten = db.producten;
      store.state.db.accounting = db.accounting;
      store.state.db.settings = db.settings;
      store.state.db.finance = db.finance;
    }
    store.emit?.('accounting:loaded', db.accounting);

    // 1b) Event normalisatie (defensief)
    db.evenementen.forEach(evt => {
      if (!Array.isArray(evt.sessions)) evt.sessions = [];    // sessions nooit undefined
      evt.omzet = normalizeEventOmzetList(Array.isArray(evt.omzet) ? evt.omzet : []);
      if (evt.persoon && !evt.personen) {                    // oude -> nieuwe structuur
        evt.personen = [evt.persoon];
        delete evt.persoon;
      }
      evt.verkoopMutaties = normalizeEventMutations(evt.verkoopMutaties);
      updateDbMutationCache(evt.id || evt.naam || evt.uuid || null, evt.verkoopMutaties);
    });

    // 1c) Optionele migratie van gebruikersdata (best effort)
    try { upgradeGebruikersData?.(db.gebruikers); } catch {}

    // 2) Legacy sessiegegevens worden niet langer opgehaald; zorg dat de key bestaat
    db.evenementen.forEach(event => {
      if (!Array.isArray(event.sessions)) event.sessions = [];
    });
    await activateOngoingEventsLocal();

    console.log("✅ Alle data geladen:", db);
    return db;
  } catch (err) {
    console.error("❌ Fout bij laden:", err);
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return loadData(retries - 1, delayMs);
    }
  }
}

function parseDateLoose(v) {
  try {
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
      return new Date(s);
    }
    if (v instanceof Date) return v;
  } catch {}
  return null;
}

export async function activateOngoingEventsLocal() {
  const lijst = Array.isArray(db?.evenementen) ? db.evenementen : [];
  const nu = new Date();
  const planStates = ['planned', 'gepland'];

  for (const ev of lijst) {
    const start = parseDateLoose(ev?.startdatum || ev?.startDate || ev?.start);
    const eind  = parseDateLoose(ev?.einddatum || ev?.eindDatum || ev?.endDatum || ev?.eindDate || ev?.endDate);
    const staat = String(ev?.state || '').toLowerCase();
    if (!start || !eind) continue;
    if (start <= nu && nu <= eind && planStates.includes(staat)) {
      try {
        ev.state = 'active';
        ev.activatedAt = ev.activatedAt || new Date().toISOString();
        await saveEvent(ev.id, { silent: true, skipReload: true });
        console.log('✅ Auto-actief gezet:', ev.naam);
      } catch (err) {
        console.warn('⚠️ Kon auto-activeren niet opslaan:', ev?.naam || ev?.id, err);
      }
    }
  }
}

// --------- Standaard save functies ---------
export async function saveVoorraad(busId = null) {
  try {
    showLoading?.();
    let body;
    if (busId) {
      body = JSON.stringify({ bus: busId, voorraad: db.voorraad?.[busId] || {} });
    } else {
      body = JSON.stringify(db.voorraad);
    }
    const response = await apiFetch('/save_voorraad.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    hideLoading?.();
    if (!response.ok) throw new Error(await response.text());
    console.log("✅ Voorraad opgeslagen.");
  } catch (err) {
    hideLoading?.();
    console.error("❌ Voorraad opslaan mislukt:", err);
  }
}

export async function saveEvent(eventId, { silent = false, skipReload = false } = {}) {
  try {
    const event = db.evenementen.find(e => e.id === eventId);
    if (!event) throw new Error(`Event niet gevonden: ${eventId}`);

    const { sessions, ...eventZonderSessions } = event;
    const cleanEvent = JSON.parse(JSON.stringify(eventZonderSessions, (key, value) => {
      if (key === '_parentEvent') return undefined;
      return value;
    }));

    if (!silent) showLoading?.();
    const res = await apiFetch('/save_evenement.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanEvent)
    });
    if (!silent && typeof hideLoading === 'function') hideLoading();
    if (!res.ok) throw new Error(await res.text());

    if (!skipReload) await autoReloadEventData?.(eventId);
    console.log(`✅ Event opgeslagen: ${event.naam}`);
    return true;
  } catch (err) {
    if (!silent && typeof hideLoading === 'function') hideLoading();
    console.error('❌ Fout bij saveEvent():', err);
    try { showAlert?.('⚠️ Opslaan van evenement mislukt.', 'error'); } catch {}
    return false;
  }
}

export async function deleteEvent(eventId, { silent = false } = {}) {
  const idx = Array.isArray(db.evenementen)
    ? db.evenementen.findIndex(e => String(e.id) === String(eventId))
    : -1;

  if (idx === -1) {
    console.warn('⚠️ deleteEvent(): event niet gevonden', eventId);
    return false;
  }

  try {
    if (!silent) showLoading?.();
    const res = await apiFetch('/delete_evenement.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: eventId })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }

    const [removed] = db.evenementen.splice(idx, 1);

    if (Array.isArray(store.state.db?.evenementen)) {
      const storeIdx = store.state.db.evenementen.findIndex(e => String(e.id) === String(eventId));
      if (storeIdx !== -1) {
        store.state.db.evenementen.splice(storeIdx, 1);
      }
    }

    store.emit?.('events:updated', { eventId, action: 'delete', event: removed });
    return true;
  } catch (err) {
    console.error('❌ Fout bij deleteEvent():', err);
    if (!silent) {
      try { showAlert?.('⚠️ Verwijderen van evenement mislukt.', 'error'); } catch {}
    }
    return false;
  } finally {
    if (!silent) hideLoading?.();
  }
}

export async function saveProducten() {
  try {
    showLoading?.();
    const response = await apiFetch('/save_producten.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(db.producten)
    });
    hideLoading?.();
    if (!response.ok) throw new Error(await response.text());
    console.log("✅ Producten opgeslagen.");
  } catch (err) {
    hideLoading?.();
    console.error("❌ Fout bij saveProducten():", err);
  }
}

export async function saveGebruiker(gebruikersArray) {
  try {
    showLoading?.();
    const response = await apiFetch('/save_users.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gebruikersArray)
    });
    hideLoading?.();
    if (!response.ok) throw new Error(await response.text());
    console.log("✅ Gebruikers opgeslagen.");
  } catch (err) {
    hideLoading?.();
    console.error("❌ Fout bij saveGebruiker():", err);
  }
}

export async function saveSettings(nextSettings = null, { silent = false } = {}) {
  const previous = { ...db.settings };
  const candidate = nextSettings
    ? { ...db.settings, ...nextSettings }
    : db.settings;
  const normalized = normalizeSettingsData(candidate);
  db.settings = normalized;
  if (store?.state?.db) {
    store.state.db.settings = db.settings;
  }

  try {
    if (!silent) showLoading?.('Instellingen opslaan…');
    const response = await apiFetch('/save_settings.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized)
    });
    if (!response.ok) throw new Error(await response.text());
    if (!silent) hideLoading?.();
    store.emit?.('settings:updated', db.settings);
    console.log('✅ Instellingen opgeslagen.');
    return true;
  } catch (err) {
    if (!silent) hideLoading?.();
    db.settings = normalizeSettingsData(previous);
    if (store?.state?.db) {
      store.state.db.settings = db.settings;
    }
    console.error('❌ Fout bij saveSettings():', err);
    if (!silent) {
      try { showAlert?.('Instellingen opslaan mislukt.', 'error'); } catch {}
    }
    return false;
  }
}

// --------- Voorraad/producten/evenementen herladen ---------
export async function reloadVoorraad(busId = null) {
  try {
    const qs = busId ? `?bus=${encodeURIComponent(busId)}&t=${Date.now()}` : `?t=${Date.now()}`;
    const response = await apiFetch(`/get_voorraad.php${qs}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (busId) {
      db.voorraad = db.voorraad || {};
      db.voorraad[busId] = data;
      if (store.state.db?.voorraad) store.state.db.voorraad[busId] = data;
    } else {
      const normalized = normalizeVoorraadShape(data);
      db.voorraad = normalized;
      if (store.state.db) store.state.db.voorraad = normalized;
    }
    console.log("🔄 Voorraad herladen.");
    refreshAlleVoorraadWeergaves();
    store.emit?.('voorraad:reloaded');
    return busId ? db.voorraad[busId] : db.voorraad;
  } catch (err) {
    console.error("❌ Voorraad herladen mislukt:", err);
  }
}

export async function reloadProducten() {
  try {
    const response = await apiFetch('/products.json?t=' + Date.now());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    db.producten = await response.json();
    console.log("🔄 Producten herladen.");
    // Shell laten hertekenen (knoppen/productgrid kan zich aanpassen)
    window.refreshAppShell?.();
  } catch (err) {
    console.error("❌ Producten herladen mislukt:", err);
  }
}

export async function reloadEvenementen() {
  try {
    const response = await apiFetch('/evenementen.json?t=' + Date.now());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    db.evenementen = await response.json();

    // Normaliseer
    db.evenementen.forEach(evt => {
      evt.omzet = normalizeEventOmzetList(Array.isArray(evt.omzet) ? evt.omzet : []);
      if (!Array.isArray(evt.sessions)) evt.sessions = [];
    });

    console.log("🔄 Evenementen herladen.");

  } catch (err) {
    console.error("❌ Evenementen herladen mislukt:", err);
  }
}

// --------- Helper functies ---------
export function refreshAlleVoorraadWeergaves() {
  // Laat de shell hertekenen i.p.v. oude UI aan te roepen
  window.refreshAppShell?.();
}

export function showClickBlocker() {
  if (document.getElementById("click-blocker")) return;
  const blocker = document.createElement("div");
  blocker.id = "click-blocker";
  blocker.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(255,255,255,0.7);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5em;
    font-weight: bold;
    z-index: 9999;
  `;
  blocker.innerHTML = "⏳ Verwerken...";
  document.body.appendChild(blocker);
}

export function hideClickBlocker() {
  document.getElementById("click-blocker")?.remove();
}

// --------- Event-data (en verkoop) auto-herladen ---------
export async function autoReloadEventData(eventId) {
  try {
    // kleine debounce zodat backend klaar is
    await new Promise(res => setTimeout(res, 1200));

    const response = await apiFetch('/evenementen.json?t=' + Date.now());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim()) {
      console.warn('⚠️ Lege response van evenementen.json');
      return;
    }
    let evenementen = [];
    try {
      evenementen = JSON.parse(text);
    } catch (parseErr) {
      console.error('❌ JSON parse fout bij evenementen.json:', parseErr);
      return;
    }

    const bijgewerkt = Array.isArray(evenementen)
      ? evenementen.find(e => e.id === eventId)
      : null;
    if (!bijgewerkt) return;

    bijgewerkt.sessions = Array.isArray(bijgewerkt.sessions) ? bijgewerkt.sessions : [];
    bijgewerkt.omzet = normalizeEventOmzetList(Array.isArray(bijgewerkt.omzet) ? bijgewerkt.omzet : []);
    bijgewerkt.verkoopMutaties = normalizeEventMutations(bijgewerkt.verkoopMutaties);

    // In-memory db updaten
    const idx = db.evenementen.findIndex(e => e.id === eventId);
    if (idx !== -1) {
      db.evenementen[idx] = { ...db.evenementen[idx], ...bijgewerkt };
      if (Array.isArray(store.state.db?.evenementen) && store.state.db.evenementen[idx]) {
        store.state.db.evenementen[idx] = db.evenementen[idx];
      }
    }

    updateDbMutationCache(eventId, bijgewerkt.verkoopMutaties);

    store.emit?.('events:updated', { eventId, reason: 'autoReload' });

    console.log("✅ Event bijgewerkt na auto-reload.");
  } catch (err) {
    console.error("❌ Fout bij autoReloadEventData():", err);
  }
}

// --------- Dagomzet helpers ---------

function findEventReferences(eventId) {
  const match = (ev) => {
    if (!ev) return false;
    const candidates = [ev.id, ev.naam, ev.slug, ev.uuid];
    return candidates.filter(Boolean).some((candidate) => String(candidate) === String(eventId));
  };
  const localIndex = Array.isArray(db.evenementen) ? db.evenementen.findIndex(match) : -1;
  const storeList = Array.isArray(store.state.db?.evenementen) ? store.state.db.evenementen : [];
  const storeIndex = storeList.findIndex(match);
  const local = localIndex >= 0 ? db.evenementen[localIndex] : null;
  const storeEvent = storeIndex >= 0 ? storeList[storeIndex] : null;
  const resolvedId = local?.id || storeEvent?.id || eventId;
  return { local, storeEvent, localIndex, storeIndex, resolvedId };
}

// --------- Verkoopmutaties API ---------

export function getEventVerkoopMutaties(eventId) {
  const refs = findEventReferences(eventId);
  const event = refs.local || refs.storeEvent;
  if (!event) return { version: 1, entries: [], updatedAt: null, paperChecklist: {} };
  const container = ensureEventMutations(event);
  return {
    version: Number(container.version) || 1,
    entries: container.entries.map(entry => cloneMutationEntry(entry)),
    updatedAt: container.updatedAt || null,
    paperChecklist: clonePaperChecklist(container.paperChecklist)
  };
}

export function listVerkoopMutaties(eventId, { busId = null } = {}) {
  const container = getEventVerkoopMutaties(eventId);
  if (!busId) return container.entries.slice();
  const normalizedBus = normalizeKey(busId);
  return container.entries.filter(entry => normalizeKey(entry.busId || '') === normalizedBus);
}

function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function applyMutationToEvent(event, mutation) {
  const container = ensureEventMutations(event);
  const idx = container.entries.findIndex(entry => entry.id === mutation.id);
  if (idx >= 0) {
    container.entries[idx] = mutation;
  } else {
    container.entries.push(mutation);
  }
  container.updatedAt = mutation.updatedAt || new Date().toISOString();
  return container;
}

export async function addVerkoopMutatie(eventId, payload = {}, options = {}) {
  const { skipPersist = false, silent = false } = options;
  const refs = findEventReferences(eventId);
  const event = refs.local || refs.storeEvent;
  if (!event) throw new Error('Event niet gevonden');
  const session = store.state.session || {};
  const normalized = normalizeMutationEntry(payload, {
    busId: payload.busId || session.busId || session.meta?.bus,
    userId: payload.userId || session.user?.id || session.user?.naam,
    type: payload.type || 'quick'
  });
  if (!normalized) return null;

  const container = applyMutationToEvent(event, normalized);
  updateDbMutationCache(refs.resolvedId, container);

  if (refs.storeEvent) {
    ensureEventMutations(refs.storeEvent);
    const targetContainer = refs.storeEvent.verkoopMutaties;
    const clone = cloneMutationEntry(normalized);
    const idx = targetContainer.entries.findIndex(entry => entry.id === clone.id);
    if (idx >= 0) {
      targetContainer.entries[idx] = clone;
    } else {
      targetContainer.entries.push(clone);
    }
    targetContainer.updatedAt = container.updatedAt;
    if (container.paperChecklist && typeof container.paperChecklist === 'object') {
      targetContainer.paperChecklist = clonePaperChecklist(container.paperChecklist);
    }
  }

  if (!skipPersist) {
    await saveEvent(refs.resolvedId, { silent, skipReload: false });
  }

  store.emit?.('events:updated', {
    eventId: refs.resolvedId,
    reason: 'verkoopMutatie',
    entry: cloneMutationEntry(normalized),
    paperChecklist: clonePaperChecklist(container.paperChecklist)
  });

  return cloneMutationEntry(normalized);
}

export async function setPaperChecklistEntry(eventId, productId, checked, options = {}) {
  if (!eventId || !productId) return null;
  const { skipPersist = false, silent = false } = options;
  const refs = findEventReferences(eventId);
  const event = refs.local || refs.storeEvent;
  if (!event) throw new Error('Event niet gevonden');

  const container = ensureEventMutations(event);
  if (!container.paperChecklist || typeof container.paperChecklist !== 'object') {
    container.paperChecklist = {};
  }

  const key = String(productId);
  if (!key) return clonePaperChecklist(container.paperChecklist);

  if (checked) {
    const session = store.state.session || {};
    const userId = options.userId || session?.user?.id || session?.user?.naam || session?.user?.email || null;
    container.paperChecklist[key] = {
      checkedAt: new Date().toISOString(),
      userId: userId ? String(userId) : null
    };
  } else {
    delete container.paperChecklist[key];
  }

  updateDbMutationCache(refs.resolvedId, container);

  if (refs.storeEvent && refs.storeEvent !== event) {
    ensureEventMutations(refs.storeEvent);
    refs.storeEvent.verkoopMutaties.paperChecklist = clonePaperChecklist(container.paperChecklist);
  }

  if (!skipPersist) {
    await saveEvent(refs.resolvedId, { silent, skipReload: false });
  }

  const payload = clonePaperChecklist(container.paperChecklist);
  store.emit?.('events:updated', {
    eventId: refs.resolvedId,
    reason: 'paperChecklist',
    paperChecklist: payload
  });

  return payload;
}

function cloneOmzetEntry(entry) {
  return entry ? JSON.parse(JSON.stringify(entry)) : null;
}

function syncEventOmzet(eventRefs, mutateFn) {
  const hasEvent = Boolean(eventRefs.local || eventRefs.storeEvent);
  if (!hasEvent) throw new Error('Event niet gevonden');
  const sourceList = Array.isArray(eventRefs.local?.omzet)
    ? eventRefs.local.omzet
    : Array.isArray(eventRefs.storeEvent?.omzet)
      ? eventRefs.storeEvent.omzet
      : [];
  const workingList = sourceList.map((entry) => ({ ...entry }));
  const result = mutateFn(workingList);
  const normalized = normalizeEventOmzetList(workingList).map((entry) => ({ ...entry }));
  if (eventRefs.local) eventRefs.local.omzet = normalized.map((entry) => ({ ...entry }));
  if (eventRefs.storeEvent) eventRefs.storeEvent.omzet = normalized.map((entry) => ({ ...entry }));
  return { result, normalized };
}

export function getEventOmzet(eventId) {
  const refs = findEventReferences(eventId);
  const list = refs.local?.omzet || refs.storeEvent?.omzet || [];
  return list.map((entry) => ({ ...entry }));
}

async function syncDagOmzetLedger(refs, entry, action, options = {}) {
  if (!entry || !entry.id) return;
  const { skipPersist = false } = options;
  const event = refs?.local || refs?.storeEvent || null;
  let payload = null;
  try {
    payload = buildDagOmzetLedgerPayload(event, entry);
    if (!payload) return;
    const ledgerOptions = { skipPersist };
    if (action === 'delete') {
      await deleteLedgerEntry(payload.id, ledgerOptions);
    } else if (action === 'update') {
      const { id, ...changes } = payload;
      try {
        await updateLedgerEntry(id, changes, ledgerOptions);
      } catch (err) {
        if (String(err?.message || '').toLowerCase().includes('niet gevonden')) {
          await recordLedgerEntry(payload, ledgerOptions);
        } else {
          throw err;
        }
      }
    } else {
      try {
        await recordLedgerEntry(payload, ledgerOptions);
      } catch (err) {
        if (String(err?.message || '').toLowerCase().includes('bestaat al')) {
          const { id, ...changes } = payload;
          await updateLedgerEntry(id, changes, ledgerOptions);
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    console.warn('[Accounting] syncDagOmzetLedger mislukt:', err);
  } finally {
    store.emit?.('accounting:updated', {
      action: action === 'delete' ? 'delete' : action === 'update' ? 'update' : 'create',
      reason: 'dagomzet',
      eventId: refs?.resolvedId || event?.id || null,
      entryId: payload?.id || (entry ? buildLedgerId('omzet', refs?.resolvedId || event?.id || 'event', entry.id) : null)
    });
  }
}

export async function saveDagOmzet(eventId, payload = {}, options = {}) {
  const { skipPersist = false, markPending = false, forceId } = options;
  const refs = findEventReferences(eventId);
  let action = 'create';
  const { result, normalized } = syncEventOmzet(refs, (list) => {
    const normalizedPayload = normalizeOmzetEntry({ ...payload }, { date: payload.date });
    if (forceId) normalizedPayload.id = forceId;
    const nowIso = new Date().toISOString();
    const idx = list.findIndex((entry) => entry.id === normalizedPayload.id);
    if (idx >= 0) {
      action = 'update';
      const existing = list[idx];
      const merged = {
        ...existing,
        ...normalizedPayload,
        createdAt: existing.createdAt || normalizedPayload.createdAt || nowIso,
        updatedAt: nowIso,
        pending: markPending ? true : Boolean(normalizedPayload.pending ?? existing.pending)
      };
      if (!normalizedPayload.date) merged.date = existing.date;
      list[idx] = merged;
      return merged;
    }
    const createdAt = normalizedPayload.createdAt || nowIso;
    const newEntry = {
      ...normalizedPayload,
      createdAt,
      updatedAt: nowIso,
      pending: markPending ? true : Boolean(normalizedPayload.pending)
    };
    list.push(newEntry);
    return newEntry;
  });

  if (!skipPersist) {
    await saveEvent(refs.resolvedId, { silent: true, skipReload: true });
  }

  const entryId = result?.id;
  const normalizedEntry = entryId ? normalized.find(item => item.id === entryId) : null;
  const entry = cloneOmzetEntry(normalizedEntry || result);
  store.emit?.('omzet:updated', { eventId: refs.resolvedId, action, entry });
  store.emit?.('events:updated', { eventId: refs.resolvedId, reason: 'dagomzet' });
  await syncDagOmzetLedger(refs, entry, action, { skipPersist });
  return entry;
}

export async function updateDagOmzet(eventId, entryId, changes = {}, options = {}) {
  const { skipPersist = false, markPending = false } = options;
  const refs = findEventReferences(eventId);
  let updatedEntry = null;
  const { normalized } = syncEventOmzet(refs, (list) => {
    const idx = list.findIndex((entry) => entry.id === entryId);
    if (idx === -1) return null;
    const existing = list[idx];
    const nowIso = new Date().toISOString();
    const next = {
      ...existing,
      updatedAt: nowIso
    };
    if ('date' in changes) next.date = normalizeOmzetDate(changes.date);
    if ('usd' in changes) next.usd = normalizeMoneyValue(changes.usd);
    if ('eur' in changes) next.eur = normalizeMoneyValue(changes.eur);
    if ('note' in changes) next.note = (changes.note ?? '').toString().trim();
    if ('debtor' in changes) {
      const debtor = normalizeDebtorFlag(changes.debtor, changes.paymentMethod ?? existing.paymentMethod);
      next.debtor = debtor;
      next.paymentMethod = debtor ? 'DEBTOR' : 'DIRECT';
    } else if ('paymentMethod' in changes) {
      const debtor = normalizeDebtorFlag(null, changes.paymentMethod);
      next.debtor = debtor;
      next.paymentMethod = debtor ? 'DEBTOR' : 'DIRECT';
    }
    if ('exchangeRate' in changes) next.exchangeRate = normalizeExchangeRate(changes.exchangeRate);
    if ('inputCurrency' in changes) {
      next.inputCurrency = normalizeCurrencyCode(
        changes.inputCurrency,
        next.inputCurrency ?? existing.inputCurrency ?? existing.currency ?? 'USD'
      );
    }
    if ('pending' in changes) next.pending = Boolean(changes.pending);
    if (markPending) next.pending = true;
    list[idx] = next;
    updatedEntry = next;
    return next;
  });

  if (!updatedEntry) return null;

  if (!skipPersist) {
    await saveEvent(refs.resolvedId, { silent: true, skipReload: true });
  }

  const normalizedEntry = normalized.find(item => item.id === entryId) || updatedEntry;
  const entry = cloneOmzetEntry(normalizedEntry);
  store.emit?.('omzet:updated', { eventId: refs.resolvedId, action: 'update', entry });
  store.emit?.('events:updated', { eventId: refs.resolvedId, reason: 'dagomzet' });
  await syncDagOmzetLedger(refs, entry, 'update', { skipPersist });
  return entry;
}

export async function deleteDagOmzet(eventId, entryId, options = {}) {
  const { skipPersist = false } = options;
  const refs = findEventReferences(eventId);
  let removedEntry = null;
  syncEventOmzet(refs, (list) => {
    const idx = list.findIndex((entry) => entry.id === entryId);
    if (idx === -1) return null;
    const [removed] = list.splice(idx, 1);
    removedEntry = removed;
    return removed;
  });

  if (!removedEntry) return null;

  if (!skipPersist) {
    await saveEvent(refs.resolvedId, { silent: true, skipReload: true });
  }

  const entry = cloneOmzetEntry(removedEntry);
  store.emit?.('omzet:updated', { eventId: refs.resolvedId, action: 'delete', entry, entryId });
  store.emit?.('events:updated', { eventId: refs.resolvedId, reason: 'dagomzet' });
  await syncDagOmzetLedger(refs, entry, 'delete', { skipPersist });
  return entry;
}

// --------- Accounting helpers ---------

function ensureAccountingReference() {
  if (store?.state?.db) {
    store.state.db.accounting = db.accounting;
  }
}

function resortAccountingEntries() {
  db.accounting.entries.sort((a, b) => {
    return (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

function findAccountingEntryIndex(entryId) {
  if (!entryId && entryId !== 0) return -1;
  return db.accounting.entries.findIndex(entry => String(entry.id) === String(entryId));
}

function cloneAccountingEntry(entry) {
  return entry ? JSON.parse(JSON.stringify(entry)) : null;
}

function enqueuePendingAccountingAction(action, entry, meta = {}) {
  if (!action) return;
  const normalizedAction = String(action).toLowerCase();
  if (!['create', 'update', 'delete'].includes(normalizedAction)) return;
  const entryId = (meta.entryId || entry?.id || '').toString().trim();
  if (!entryId) return;
  const payload = meta.hasOwnProperty('payload') ? meta.payload : cloneAccountingEntry(entry);
  const nowIso = new Date().toISOString();
  const existingIdx = db.accounting.pendingQueue.findIndex(item => item.entryId === entryId && item.action === normalizedAction);
  if (existingIdx >= 0) {
    const existing = db.accounting.pendingQueue[existingIdx];
    db.accounting.pendingQueue[existingIdx] = {
      ...existing,
      payload: payload !== undefined ? payload : existing.payload,
      attempts: (existing.attempts || 0) + 1,
      lastError: meta.lastError || existing.lastError || null,
      timestamp: nowIso
    };
    persistAccountingPendingQueue();
  } else {
    db.accounting.pendingQueue.push({
      id: meta.id || generateLedgerId('pend'),
      action: normalizedAction,
      entryId,
      payload,
      attempts: meta.attempts != null ? meta.attempts : 1,
      lastError: meta.lastError || null,
      timestamp: nowIso
    });
    persistAccountingPendingQueue();
  }
  ensureAccountingReference();
  if (store?.state?.db?.accounting) {
    store.state.db.accounting.pendingQueue = db.accounting.pendingQueue;
  }
}

function markAccountingEntryPending(entryId, flag = true) {
  const idx = findAccountingEntryIndex(entryId);
  if (idx === -1) return;
  const updated = { ...db.accounting.entries[idx], pending: Boolean(flag) };
  db.accounting.entries[idx] = updated;
  ensureAccountingReference();
}

export async function saveAccountingData(options = {}) {
  const { silent = false, reason = 'manual' } = options;
  ensureAccountingReference();
  const payload = {
    entries: db.accounting.entries.map(entry => ({ ...entry })),
    categories: db.accounting.categories.map(cat => ({ ...cat })),
    accounts: db.accounting.accounts.map(acc => ({ ...acc })),
    pendingQueue: db.accounting.pendingQueue.map(item => ({ ...item }))
  };

  if (!silent) {
    showLoading?.();
  }

  try {
    const response = await apiFetch('/save_accounting.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Onbekende fout bij saveAccountingData');
    }

    const clearedIds = new Set(db.accounting.pendingQueue.map(item => item.entryId).filter(Boolean));
    db.accounting.pendingQueue = [];
    db.accounting.entries = db.accounting.entries.map(entry => ({ ...entry, pending: false }));
    resortAccountingEntries();
    ensureAccountingReference();
    persistAccountingPendingQueue();
    if (store?.state?.db?.accounting) {
      store.state.db.accounting.pendingQueue = db.accounting.pendingQueue;
      store.state.db.accounting.entries = db.accounting.entries;
    }
    store.emit?.('accounting:saved', {
      reason,
      savedAt: result.savedAt || new Date().toISOString(),
      clearedIds: Array.from(clearedIds)
    });
    if (clearedIds.size > 0) {
      store.emit?.('accounting:pendingResolved', { entryIds: Array.from(clearedIds) });
    }
    return true;
  } catch (err) {
    db.accounting.pendingQueue = db.accounting.pendingQueue.map(item => ({
      ...item,
      attempts: (item.attempts || 0) + 1,
      lastError: err?.message || String(err)
    }));
    persistAccountingPendingQueue();
    ensureAccountingReference();
    if (store?.state?.db?.accounting) {
      store.state.db.accounting.pendingQueue = db.accounting.pendingQueue;
    }
    store.emit?.('accounting:saveFailed', { reason, error: err });
    throw err;
  } finally {
    if (!silent) {
      hideLoading?.();
    }
  }
}

export async function processAccountingPendingQueue(options = {}) {
  const { silent = true, reason = 'auto-retry', force = false } = options;
  ensureAccountingReference();
  const queue = Array.isArray(db.accounting.pendingQueue) ? db.accounting.pendingQueue : [];
  if (!queue.length) {
    persistAccountingPendingQueue(queue);
    return { processed: 0, resolved: [], skipped: 'empty' };
  }

  const isOffline = () => {
    if (force) return false;
    if (typeof navigator === 'undefined' || navigator == null) return false;
    if (!Object.prototype.hasOwnProperty.call(navigator, 'onLine')) return false;
    return navigator.onLine === false;
  };

  if (isOffline()) {
    return { processed: 0, resolved: [], skipped: 'offline' };
  }

  const pendingCount = queue.length;
  const pendingIds = queue.map(item => item.entryId).filter(Boolean);

  try {
    await saveAccountingData({ silent, reason });
    persistAccountingPendingQueue(db.accounting.pendingQueue);
    return { processed: pendingCount, resolved: pendingIds };
  } catch (err) {
    persistAccountingPendingQueue(db.accounting.pendingQueue);
    throw err;
  }
}

export async function recordLedgerEntry(payload = {}, options = {}) {
  const { skipPersist = false } = options;
  ensureAccountingReference();
  const normalized = normalizeAccountingEntry(payload);
  if (!normalized) throw new Error('Ongeldige boekingsregel');

  if (findAccountingEntryIndex(normalized.id) !== -1) {
    throw new Error('Boekingsregel bestaat al');
  }

  db.accounting.entries.push(normalized);
  resortAccountingEntries();
  ensureAccountingReference();

  const entryClone = cloneAccountingEntry(normalized);
  store.emit?.('accounting:updated', { action: 'create', entry: entryClone });

  if (skipPersist) {
    return entryClone;
  }

  try {
    await saveAccountingData({ silent: true, reason: 'create' });
    return entryClone;
  } catch (err) {
    markAccountingEntryPending(normalized.id, true);
    enqueuePendingAccountingAction('create', normalized, { lastError: err?.message });
    store.emit?.('accounting:pending', { action: 'create', entryId: normalized.id, error: err?.message });
    throw err;
  }
}

export async function updateLedgerEntry(entryId, changes = {}, options = {}) {
  const { skipPersist = false } = options;
  ensureAccountingReference();
  const idx = findAccountingEntryIndex(entryId);
  if (idx === -1) throw new Error('Boekingsregel niet gevonden');

  const existing = db.accounting.entries[idx];
  const merged = { ...existing, ...changes, id: entryId };
  const normalized = normalizeAccountingEntry(merged, existing);
  normalized.createdAt = existing.createdAt;
  normalized.pending = existing.pending;
  db.accounting.entries[idx] = normalized;
  resortAccountingEntries();
  ensureAccountingReference();

  const entryClone = cloneAccountingEntry(normalized);
  store.emit?.('accounting:updated', { action: 'update', entry: entryClone });

  if (skipPersist) {
    return entryClone;
  }

  try {
    await saveAccountingData({ silent: true, reason: 'update' });
    return entryClone;
  } catch (err) {
    markAccountingEntryPending(entryId, true);
    enqueuePendingAccountingAction('update', normalized, { lastError: err?.message });
    store.emit?.('accounting:pending', { action: 'update', entryId, error: err?.message });
    throw err;
  }
}

export async function deleteLedgerEntry(entryId, options = {}) {
  const { skipPersist = false } = options;
  ensureAccountingReference();
  const idx = findAccountingEntryIndex(entryId);
  if (idx === -1) return false;

  const [removed] = db.accounting.entries.splice(idx, 1);
  resortAccountingEntries();
  ensureAccountingReference();

  store.emit?.('accounting:updated', { action: 'delete', entryId, entry: cloneAccountingEntry(removed) });

  if (skipPersist) {
    return true;
  }

  try {
    await saveAccountingData({ silent: true, reason: 'delete' });
    return true;
  } catch (err) {
    enqueuePendingAccountingAction('delete', removed, { lastError: err?.message, payload: { id: removed?.id } });
    store.emit?.('accounting:pending', { action: 'delete', entryId, error: err?.message });
    throw err;
  }
}

export async function recordExtraCostLedgerEntry(eventId, kostEntry, options = {}) {
  const { skipPersist = false } = options;
  const refs = findEventReferences(eventId);
  const event = refs.local || refs.storeEvent || null;
  if (!kostEntry) return null;
  let payload = null;
  let action = 'create';
  try {
    payload = buildExtraCostLedgerPayload(event, kostEntry);
    if (!payload) return null;
    const ledgerOptions = { skipPersist };
    try {
      await recordLedgerEntry(payload, ledgerOptions);
    } catch (err) {
      if (String(err?.message || '').toLowerCase().includes('bestaat al')) {
        const { id, ...changes } = payload;
        await updateLedgerEntry(id, changes, ledgerOptions);
        action = 'update';
      } else {
        throw err;
      }
    }
    return payload;
  } catch (err) {
    console.warn('[Accounting] recordExtraCostLedgerEntry mislukt:', err);
    return null;
  } finally {
    store.emit?.('accounting:updated', {
      action,
      reason: 'extraCost',
      eventId: refs?.resolvedId || event?.id || null,
      entryId: payload?.id || (kostEntry?.id ? buildLedgerId('kost', refs?.resolvedId || event?.id || 'event', kostEntry.id) : null)
    });
  }
}

export async function recordPurchaseInvoice(invoice = {}, options = {}) {
  const { skipPersist = false } = options;
  const payload = buildPurchaseInvoiceLedgerPayload(invoice);
  if (!payload) throw new Error('Ongeldige inkoopfactuur');
  const ledgerOptions = { skipPersist };
  let action = 'create';
  try {
    try {
      await recordLedgerEntry(payload, ledgerOptions);
    } catch (err) {
      if (String(err?.message || '').toLowerCase().includes('bestaat al')) {
        const { id, ...changes } = payload;
        await updateLedgerEntry(id, changes, ledgerOptions);
        action = 'update';
      } else {
        throw err;
      }
    }
    return payload;
  } finally {
    store.emit?.('accounting:updated', {
      action,
      reason: 'purchase-invoice',
      entryId: payload?.id || null,
      eventId: payload?.meta?.eventId || null
    });
  }
}

export async function recordEventInvoiceLedgerEntry(eventId, invoice = {}, options = {}) {
  const { skipPersist = false } = options;
  const refs = findEventReferences(eventId);
  const event = refs.local || refs.storeEvent;
  if (!event) throw new Error('Event niet gevonden voor factuur');
  const payload = buildEventInvoiceLedgerPayload(event, { ...invoice, eventId: refs.resolvedId });
  if (!payload) throw new Error('Ongeldige factuurgegevens');
  const ledgerOptions = { skipPersist };
  let action = 'create';
  try {
    try {
      await recordLedgerEntry(payload, ledgerOptions);
    } catch (err) {
      if (String(err?.message || '').toLowerCase().includes('bestaat al')) {
        const { id, ...changes } = payload;
        await updateLedgerEntry(id, changes, ledgerOptions);
        action = 'update';
      } else {
        throw err;
      }
    }
    return payload;
  } finally {
    store.emit?.('accounting:updated', {
      action,
      reason: 'event-invoice',
      entryId: payload?.id || null,
      eventId: refs?.resolvedId || null
    });
  }
}

export async function deleteExtraCostLedgerEntry(eventId, kostId, options = {}) {
  const { skipPersist = false } = options;
  const refs = findEventReferences(eventId);
  const event = refs.local || refs.storeEvent || null;
  const ledgerId = buildLedgerId('kost', refs?.resolvedId || event?.id || 'event', kostId);
  let success = false;
  try {
    success = await deleteLedgerEntry(ledgerId, { skipPersist });
    return success;
  } catch (err) {
    console.warn('[Accounting] deleteExtraCostLedgerEntry mislukt:', err);
    return false;
  } finally {
    store.emit?.('accounting:updated', {
      action: 'delete',
      reason: 'extraCost',
      eventId: refs?.resolvedId || event?.id || null,
      entryId: ledgerId,
      success
    });
  }
}

// --------- Reizen opslaan ---------
export async function saveReizen() {
  try {
    showLoading?.();
    console.log("🧪 Wat zit er in db.reizen:", db.reizen);
    const response = await apiFetch('/save_reizen.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reizen: db.reizen })
    });
    hideLoading?.();
    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Serverfout bij opslaan reizen:", errorText);
      showAlert?.("❌ Opslaan van reizen mislukt.", "error");
      return false;
    }
    const result = await response.json();
    if (result.success) {
      console.log("✅ Reizen succesvol opgeslagen.");
      showAlert?.("✅ Reizen opgeslagen!", "success");
      store.emit?.('reizen:updated', {
        reason: 'save',
        count: Array.isArray(db.reizen) ? db.reizen.length : 0
      });
      return true;
    } else {
      console.error("⚠️ Opslaan mislukt:", result.error);
      showAlert?.("⚠️ Opslaan mislukt: " + result.error, "warning");
      return false;
    }
  } catch (err) {
    hideLoading?.();
    console.error("❌ Netwerkfout bij saveReizen():", err);
    showAlert?.("❌ Fout bij opslaan van reizen.", "error");
    return false;
  }
}

// Globaal + named export (voor zekerheid in alle importstijlen)
window.db = db;
export default db;
