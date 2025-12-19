import { store } from './store.js';

const FINANCE_STORAGE_KEY = 'ocpos.finance.v1';

const DEFAULT_FINANCE = {
  fixedCosts: [],
  debtors: [],
  creditors: [],
  lastKnownBalance: { amountEUR: null, dateISO: null }
};

function normalizeFrequency(value) {
  const allowed = new Set(['monthly', 'weekly', 'yearly']);
  return allowed.has(value) ? value : 'monthly';
}

function normalizeStatus(value) {
  return value === 'paid' ? 'paid' : 'open';
}

function ensureId(value, prefix) {
  const safe = value ? String(value) : '';
  if (safe) return safe;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeFinanceData(raw = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    fixedCosts: Array.isArray(input.fixedCosts)
      ? input.fixedCosts.map((entry) => ({
        id: ensureId(entry?.id, 'fixed'),
        name: entry?.name || entry?.naam || 'Vaste kost',
        amountEUR: Number(entry?.amountEUR ?? entry?.amount ?? entry?.bedrag ?? 0) || 0,
        frequency: normalizeFrequency(entry?.frequency),
        startDateISO: entry?.startDateISO || entry?.startDate || entry?.datum || null,
        active: entry?.active !== false
      }))
      : [],
    debtors: Array.isArray(input.debtors)
      ? input.debtors.map((entry) => ({
        id: ensureId(entry?.id, 'debtor'),
        name: entry?.name || entry?.naam || 'Debiteur',
        amountEUR: Number(entry?.amountEUR ?? entry?.amount ?? entry?.bedrag ?? 0) || 0,
        dueDateISO: entry?.dueDateISO || entry?.dueDate || entry?.datum || null,
        status: normalizeStatus(entry?.status),
        notes: entry?.notes || entry?.opmerking || ''
      }))
      : [],
    creditors: Array.isArray(input.creditors)
      ? input.creditors.map((entry) => ({
        id: ensureId(entry?.id, 'creditor'),
        name: entry?.name || entry?.naam || 'Crediteur',
        amountEUR: Number(entry?.amountEUR ?? entry?.amount ?? entry?.bedrag ?? 0) || 0,
        dueDateISO: entry?.dueDateISO || entry?.dueDate || entry?.datum || null,
        status: normalizeStatus(entry?.status),
        notes: entry?.notes || entry?.opmerking || ''
      }))
      : [],
    lastKnownBalance: {
      amountEUR: Number(input?.lastKnownBalance?.amountEUR ?? input?.lastKnownBalance?.amount ?? null),
      dateISO: input?.lastKnownBalance?.dateISO || input?.lastKnownBalance?.date || null
    }
  };
}

export function loadFinanceData() {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_FINANCE };
  try {
    const raw = localStorage.getItem(FINANCE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FINANCE };
    return normalizeFinanceData(JSON.parse(raw));
  } catch (err) {
    console.debug?.('[Cashflow] Kan finance data niet laden', err);
    return { ...DEFAULT_FINANCE };
  }
}

export function persistFinanceData(data) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FINANCE_STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.debug?.('[Cashflow] Kan finance data niet opslaan', err);
  }
}

export function getFinanceState() {
  if (store?.state?.db?.finance) return store.state.db.finance;
  const loaded = loadFinanceData();
  if (store?.state?.db) store.state.db.finance = loaded;
  return loaded;
}

export function updateFinanceState(updater) {
  const current = getFinanceState();
  const next = typeof updater === 'function' ? updater(current) : updater;
  const normalized = normalizeFinanceData(next);
  if (store?.state?.db) {
    store.state.db.finance = normalized;
  }
  persistFinanceData(normalized);
  store.emit?.('finance:updated', normalized);
  return normalized;
}

function toMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function toMonthLabel(date) {
  return date.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' });
}

function buildMonths(startMonthISO, months) {
  const startDate = startMonthISO ? new Date(`${startMonthISO}-01`) : new Date();
  const base = Number.isFinite(startDate.getTime())
    ? new Date(startDate.getFullYear(), startDate.getMonth(), 1)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const list = [];
  const count = Number.isFinite(months) ? Math.max(1, Math.min(12, months)) : 6;
  for (let i = 0; i < count; i += 1) {
    const date = new Date(base.getFullYear(), base.getMonth() + i, 1);
    list.push({ monthISO: toMonthKey(date), label: toMonthLabel(date) });
  }
  return list;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeCommissionPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num > 1 ? num / 100 : num;
}

function toSafeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function getEventStartDate(event) {
  const candidates = [
    event?.startDate,
    event?.start,
    event?.datum,
    event?.date,
    event?.startdatum,
    event?.planning?.startDate,
    event?.planning?.date
  ];
  for (const candidate of candidates) {
    const parsed = parseDate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function resolveExchangeRate(event) {
  const candidates = [
    event?.wisselkoers,
    event?.exchangeRate,
    event?.omzet?.exchangeRate
  ];
  for (const candidate of candidates) {
    const rate = Number(candidate);
    if (Number.isFinite(rate) && rate > 0) return rate;
  }
  return 1;
}

function collectOmzetEntries(event) {
  if (Array.isArray(event?.omzet)) return event.omzet;
  if (Array.isArray(event?.omzet?.entries)) return event.omzet.entries;
  return [];
}

function sumEventExtraCosts(event) {
  if (!event) return 0;
  let total = 0;
  const add = (val) => {
    const num = toSafeNumber(val);
    if (num) total += num;
  };

  if (Array.isArray(event.extraKosten)) {
    event.extraKosten.forEach((entry) => add(entry?.bedrag ?? entry?.amount));
  }

  if (Array.isArray(event?.kosten)) {
    event.kosten.forEach((entry) => add(entry?.bedrag ?? entry?.amount));
  } else if (event?.kosten && typeof event.kosten === 'object') {
    const extraList = Array.isArray(event.kosten.extra) ? event.kosten.extra : [];
    extraList.forEach((entry) => add(entry?.bedrag ?? entry?.amount));
    Object.entries(event.kosten).forEach(([key, value]) => {
      if (key === 'extra') return;
      if (Array.isArray(value)) {
        value.forEach((item) => add(item?.bedrag ?? item?.amount ?? item));
      } else {
        add(value);
      }
    });
  }

  ['dieselKosten', 'slapenKosten', 'etenKosten', 'overigKosten'].forEach((key) => add(event?.[key]));

  return total;
}

function sumOmzetByMonth(event, monthSet) {
  const entries = collectOmzetEntries(event);
  const exchangeRate = resolveExchangeRate(event);
  const totals = {};
  entries.forEach((entry) => {
    const dateValue = entry?.date || entry?.datum || entry?.day || entry?.timestamp;
    const parsed = parseDate(dateValue);
    if (!parsed) return;
    const key = toMonthKey(parsed);
    if (monthSet && !monthSet.has(key)) return;
    const eur = Number(entry?.eur ?? entry?.prijs_eur ?? entry?.amountEUR ?? 0) || 0;
    const usd = Number(entry?.usd ?? entry?.prijs_usd ?? entry?.amountUSD ?? 0) || 0;
    const gross = eur || (usd ? usd * exchangeRate : 0);
    if (!gross) return;
    totals[key] = (totals[key] || 0) + gross;
  });
  return totals;
}

function addDelta(deltaMap, key, value) {
  if (!Number.isFinite(value) || !key) return;
  if (!(key in deltaMap)) return;
  deltaMap[key] += value;
}

function applyFixedCostDelta(deltaMap, cost, monthKeys) {
  if (!cost?.active) return;
  const amount = Number(cost.amountEUR) || 0;
  if (!amount) return;
  const startDate = parseDate(cost.startDateISO) || new Date();
  const frequency = normalizeFrequency(cost.frequency);
  monthKeys.forEach((monthISO) => {
    const monthDate = new Date(`${monthISO}-01`);
    if (monthDate < new Date(startDate.getFullYear(), startDate.getMonth(), 1)) return;
    if (frequency === 'yearly' && monthDate.getMonth() !== startDate.getMonth()) return;
    if (frequency === 'weekly' && monthDate < startDate) return;
    addDelta(deltaMap, monthISO, -amount);
  });
}

function buildBalances(months, deltaMap, startBalance) {
  const list = [];
  let running = Number.isFinite(startBalance) ? startBalance : 0;
  months.forEach(({ monthISO }) => {
    running += deltaMap[monthISO] || 0;
    list.push(Math.round(running * 100) / 100);
  });
  return list;
}

export function buildCashflowProjection({ startMonthISO, months = 6, balanceEUR, scenarioEventRevenue = {} } = {}) {
  const finance = getFinanceState();
  const events = Array.isArray(store.state.db?.evenementen) ? store.state.db.evenementen : [];
  const monthList = buildMonths(startMonthISO, months);
  const monthKeys = monthList.map((month) => month.monthISO);
  const monthSet = new Set(monthKeys);
  const baselineDelta = {};
  const scenarioDelta = {};
  monthKeys.forEach((key) => {
    baselineDelta[key] = 0;
    scenarioDelta[key] = 0;
  });

  const breakdown = {
    receivables: [],
    payables: [],
    fixedCosts: finance.fixedCosts.map((item) => ({ ...item })),
    eventContrib: []
  };

  const openDebtors = finance.debtors.filter((entry) => normalizeStatus(entry.status) === 'open');
  const openCreditors = finance.creditors.filter((entry) => normalizeStatus(entry.status) === 'open');

  openDebtors.forEach((entry) => {
    const amount = Number(entry.amountEUR) || 0;
    if (!amount) return;
    const dueDate = parseDate(entry.dueDateISO) || new Date(`${monthKeys[0]}-01`);
    const dueMonth = toMonthKey(dueDate);
    addDelta(baselineDelta, dueMonth, amount);
    addDelta(scenarioDelta, dueMonth, amount);
    breakdown.receivables.push({ ...entry });
  });

  openCreditors.forEach((entry) => {
    const amount = Number(entry.amountEUR) || 0;
    if (!amount) return;
    const dueDate = parseDate(entry.dueDateISO) || new Date(`${monthKeys[0]}-01`);
    const dueMonth = toMonthKey(dueDate);
    addDelta(baselineDelta, dueMonth, -amount);
    addDelta(scenarioDelta, dueMonth, -amount);
    breakdown.payables.push({ ...entry });
  });

  finance.fixedCosts.forEach((cost) => {
    applyFixedCostDelta(baselineDelta, cost, monthKeys);
    applyFixedCostDelta(scenarioDelta, cost, monthKeys);
  });

  const actualEventMonths = new Map();

  events.forEach((event) => {
    const grossByMonth = sumOmzetByMonth(event, monthSet);
    const commissionPct = normalizeCommissionPct(event?.commissiePct ?? event?.commissie);
    const extraCosts = sumEventExtraCosts(event) + toSafeNumber(event?.stageld);
    const sortedMonths = Object.keys(grossByMonth).sort();
    const costMonth = sortedMonths[0];
    Object.entries(grossByMonth).forEach(([monthISO, gross]) => {
      const extraDelta = monthISO === costMonth ? extraCosts : 0;
      const net = gross * (1 - commissionPct - 0.3) - extraDelta;
      addDelta(baselineDelta, monthISO, net);
      addDelta(scenarioDelta, monthISO, net);
      actualEventMonths.set(`${event.id || event.naam}-${monthISO}`, true);
      breakdown.eventContrib.push({
        eventId: event.id || event.naam,
        name: event.naam || event.slug || event.id,
        monthISO,
        netEUR: Math.round(net * 100) / 100,
        source: 'actual'
      });
    });
  });

  events.forEach((event) => {
    const ref = event.id || event.naam || event.slug;
    const gross = Number(scenarioEventRevenue[ref]);
    if (!Number.isFinite(gross) || gross <= 0) return;
    const startDate = getEventStartDate(event);
    if (!startDate) return;
    const monthISO = toMonthKey(startDate);
    if (!monthSet.has(monthISO)) return;
    if (actualEventMonths.has(`${ref}-${monthISO}`)) return;
    const commissionPct = normalizeCommissionPct(event?.commissiePct ?? event?.commissie);
    const net = gross * (1 - commissionPct - 0.3);
    addDelta(scenarioDelta, monthISO, net);
    breakdown.eventContrib.push({
      eventId: ref,
      name: event.naam || event.slug || ref,
      monthISO,
      netEUR: Math.round(net * 100) / 100,
      source: 'scenario'
    });
  });

  const baselineBalance = buildBalances(monthList, baselineDelta, balanceEUR);
  const scenarioBalance = buildBalances(monthList, scenarioDelta, balanceEUR);

  return {
    months: monthList.map((month, idx) => ({
      monthISO: month.monthISO,
      baselineDeltaEUR: Math.round((baselineDelta[month.monthISO] || 0) * 100) / 100,
      scenarioDeltaEUR: Math.round((scenarioDelta[month.monthISO] || 0) * 100) / 100,
      baselineBalanceEUR: baselineBalance[idx] || 0,
      scenarioBalanceEUR: scenarioBalance[idx] || 0
    })),
    totals: {
      openReceivableEUR: openDebtors.reduce((sum, entry) => sum + (Number(entry.amountEUR) || 0), 0),
      openPayableEUR: openCreditors.reduce((sum, entry) => sum + (Number(entry.amountEUR) || 0), 0)
    },
    breakdown
  };
}
