import { store } from './store.js';
import { loadData, processAccountingPendingQueue } from './3_data.js';
import { showMainShell } from './4_ui.js';
import { renderSalesUI } from './8_verkoopscherm.js';
import { activateTodayPlannedEventsLocal } from './5_eventbeheer.js';
import { getUser } from '../0_login.js';
import { resolveBusId, setActiveBus } from './voorraad_utils.js';

const YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

let accountingRetryListenerBound = false;

function normalizeUserRecord(rawUser) {
  if (!rawUser || typeof rawUser !== 'object') return null;
  const id = rawUser.id || rawUser.uuid || rawUser.code || rawUser.email || rawUser.username || rawUser.naam || rawUser.name;
  const name = rawUser.naam || rawUser.name || rawUser.displayName || rawUser.username || (id ? String(id).split('@')[0] : '');
  const role = rawUser.rol || rawUser.role || rawUser.type || null;
  return {
    ...rawUser,
    id: id ? String(id) : null,
    naam: name ? String(name) : null,
    name: name ? String(name) : null,
    role: role ? String(role) : null
  };
}

function normalizeValueForMatch(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function matchUserInCollection(collection, user) {
  if (!collection || !user) return false;
  const userTokens = new Set([
    normalizeValueForMatch(user.id),
    normalizeValueForMatch(user.naam),
    normalizeValueForMatch(user.name),
    normalizeValueForMatch(user.email)
  ].filter(Boolean));
  if (!userTokens.size) return false;

  if (Array.isArray(collection)) {
    return collection.some(item => matchUserInCollection(item, user));
  }

  if (typeof collection === 'string') {
    const norm = normalizeValueForMatch(collection);
    return userTokens.has(norm);
  }

  if (collection && typeof collection === 'object') {
    const tokens = [
      collection.id,
      collection.uuid,
      collection.code,
      collection.email,
      collection.naam,
      collection.name,
      collection.persoon,
      collection.user,
      collection.gebruiker
    ];
    return tokens.some(token => userTokens.has(normalizeValueForMatch(token)));
  }

  return false;
}

function listEventsForUser(events, user) {
  if (!Array.isArray(events) || !user) return [];
  return events.filter(event => {
    if (matchUserInCollection(event?.personen, user)) return true;
    if (matchUserInCollection(event?.personeel, user)) return true;
    if (matchUserInCollection(event?.users, user)) return true;
    if (Array.isArray(event?.sessions)) {
      return event.sessions.some(session => matchUserInCollection(session?.personen || session?.users || session?.persoon, user));
    }
    return false;
  });
}

function preferEventForUser(events, referenceDate = new Date()) {
  if (!Array.isArray(events) || !events.length) return null;
  const today = normalizeYMD(referenceDate);
  if (today) {
    const todaysEvent = events.find(event => {
      const range = getEventDateRange(event);
      return isInRangeYMD(today, range.start, range.end);
    });
    if (todaysEvent) return todaysEvent;
  }
  const sorted = events.slice().sort((a, b) => {
    const aStart = getEventDateRange(a).start || '';
    const bStart = getEventDateRange(b).start || '';
    return new Date(aStart || 0) - new Date(bStart || 0);
  });
  return sorted[0] || null;
}

function resolveBusFromEvent(event) {
  if (!event) return null;
  return event.bus || event.busId || event.ownerBus || event.meta?.bus || null;
}

function toLocalYMD(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeYMD(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return toLocalYMD(value);
  if (typeof value === 'number') {
    const asDate = new Date(value);
    return Number.isNaN(asDate.getTime()) ? '' : toLocalYMD(asDate);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (YMD_REGEX.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? '' : toLocalYMD(parsed);
  }
  if (typeof value === 'object') {
    if ('date' in value) return normalizeYMD(value.date);
    if ('start' in value) return normalizeYMD(value.start);
    if ('day' in value) return normalizeYMD(value.day);
  }
  return '';
}

function isInRangeYMD(target, start, end) {
  if (!target) return false;
  const from = start || target;
  const to = end || target;
  return from <= target && target <= to;
}

function getEventDateRange(event) {
  if (!event) return { start: '', end: '' };
  const start = normalizeYMD(event.beginDatum)
    || normalizeYMD(event.startdatum)
    || normalizeYMD(event.startDate)
    || normalizeYMD(event.start)
    || normalizeYMD(event.planning?.start);
  const end = normalizeYMD(event.eindDatum)
    || normalizeYMD(event.einddatum)
    || normalizeYMD(event.eindDate)
    || normalizeYMD(event.eind)
    || normalizeYMD(event.end)
    || normalizeYMD(event.planning?.end)
    || '';
  return { start, end: end || start };
}

function pickCurrency(event, overrides = {}) {
  const candidates = [
    overrides.currency,
    overrides?.meta?.currency,
    event?.defaultCurrency,
    event?.currency,
    event?.valuta,
    event?.omzet?.currency,
    event?.meta?.currency
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim().toUpperCase();
  }
  return null;
}

function pickExchangeRate(event, overrides = {}) {
  const candidates = [
    overrides.exchangeRate,
    overrides?.meta?.exchangeRate,
    event?.exchangeRateEURperUSD,
    event?.exchangeRate,
    event?.meta?.exchangeRate,
    event?.omzet?.exchangeRate
  ];
  for (const value of candidates) {
    if (value == null || value === '') continue;
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

function isActiveEventState(event) {
  return String(event?.state || '').toLowerCase() === 'active';
}

export function buildActiveEventDaySnapshot(event, options = {}) {
  if (!event) return null;
  const rangeOverride = options.range || {};
  const eventRange = getEventDateRange(event);
  const start = normalizeYMD(rangeOverride.start)
    || normalizeYMD(options.start)
    || eventRange.start;
  const end = normalizeYMD(rangeOverride.end)
    || normalizeYMD(options.end)
    || eventRange.end;

  const today = normalizeYMD(options.targetDate) || normalizeYMD(new Date());
  let date = normalizeYMD(options.date);

  if (!date) {
    if (today && isInRangeYMD(today, start, end)) {
      date = today;
    } else if (start) {
      if (today && today < start) {
        date = start;
      } else if (end && today && today > end) {
        date = end;
      } else {
        date = start;
      }
    } else if (end) {
      date = end;
    } else {
      date = today || toLocalYMD(new Date());
    }
  }

  const resolvedRange = {
    start: start || date,
    end: end || start || date
  };

  const currency = pickCurrency(event, options) || 'USD';
  const exchangeRate = pickExchangeRate(event, options) || null;
  const meta = {
    locatie: event?.locatie ?? '',
    type: event?.type ?? '',
    state: String(event?.state || '')
  };

  const name = event?.naam ?? event?.title ?? event?.name ?? '';
  const eventId = (event?.id ?? event?.uuid ?? event?.slug ?? name) || null;

  return {
    eventId,
    eventName: name,
    date,
    range: resolvedRange,
    currency,
    exchangeRate,
    meta
  };
}

function determineInitialActiveEventDay(db, referenceDate = new Date()) {
  const events = Array.isArray(db?.evenementen) ? db.evenementen : [];
  if (!events.length) return null;

  const sessionEventId = store.state.session?.eventId;
  if (sessionEventId) {
    const target = events.find(ev => String(ev?.id ?? ev?.naam ?? '') === String(sessionEventId));
    if (target) {
      return buildActiveEventDaySnapshot(target, { targetDate: referenceDate });
    }
  }

  const today = normalizeYMD(referenceDate);
  const sorted = events.slice().sort((a, b) => {
    const aStart = getEventDateRange(a).start || '';
    const bStart = getEventDateRange(b).start || '';
    return new Date(aStart || 0) - new Date(bStart || 0);
  });

  const todayMatches = today
    ? sorted.filter(ev => {
        const range = getEventDateRange(ev);
        return isInRangeYMD(today, range.start, range.end);
      })
    : [];

  let candidate = todayMatches.find(isActiveEventState) || todayMatches[0];
  if (!candidate) candidate = sorted.find(isActiveEventState) || sorted[0];
  if (!candidate) return null;

  return buildActiveEventDaySnapshot(candidate, { targetDate: today });
}

export function syncActiveEventDay(referenceDate = new Date()) {
  const snapshot = determineInitialActiveEventDay(store.state.db, referenceDate);
  if (snapshot) {
    store.setActiveEventDay(snapshot);
  } else {
    store.clearActiveEventDay?.();
  }
  return snapshot;
}

function ensureAccountingOnlineRetry() {
  if (accountingRetryListenerBound) return;
  if (typeof window === 'undefined' || !window?.addEventListener) return;
  const handler = () => {
    processAccountingPendingQueue({ silent: true, reason: 'global-online' })
      .catch(err => console.warn('[Accounting] pendingQueue retry mislukt', err));
  };
  window.addEventListener('online', handler);
  accountingRetryListenerBound = true;
}

export async function bootApp() {
  try {
    if (!getUser()) {
      window.location.href = '/login.html';
      return;
    }

    const rawUser = getUser();
    const normalizedUser = normalizeUserRecord(rawUser);

    const db = await loadData();
    store.setDb(db);
    store.emit('db:loaded', db);

    const events = Array.isArray(db?.evenementen) ? db.evenementen : [];
    const userEvents = normalizedUser ? listEventsForUser(events, normalizedUser) : [];
    const preferredEvent = preferEventForUser(userEvents.length ? userEvents : events, new Date());
    const eventId = preferredEvent?.id || preferredEvent?.naam || null;
    const eventBus = resolveBusFromEvent(preferredEvent);

    const sessionState = store.setSession({
      user: normalizedUser,
      eventId,
      busId: eventBus || null,
      meta: {
        bus: eventBus || null,
        eventName: preferredEvent?.naam || preferredEvent?.title || null,
        locatie: preferredEvent?.locatie || preferredEvent?.plaats || null,
        range: preferredEvent ? getEventDateRange(preferredEvent) : null,
        userName: normalizedUser?.naam || normalizedUser?.name || null
      },
      lastSync: new Date().toISOString()
    });

    if (sessionState.busId) {
      setActiveBus(sessionState.busId);
    } else {
      const fallbackBus = resolveBusId();
      if (fallbackBus) {
        store.updateSession({ busId: fallbackBus, meta: { bus: fallbackBus } });
      }
    }

    ensureAccountingOnlineRetry();
    try {
      await processAccountingPendingQueue({ silent: true, reason: 'boot' });
    } catch (err) {
      console.warn('[Accounting] pendingQueue verwerking bij start mislukt', err);
    }

    await activateTodayPlannedEventsLocal?.();
    syncActiveEventDay(new Date());

    await showMainShell();
    store.setUiReady(true);
    store.emit('ui:ready');

    renderSalesUI();
  } catch (err) {
    console.error('[POS] bootApp failed', err);
  }
}

store.on('ui:ready', () => renderSalesUI());
store.on('activeDay:changed', () => renderSalesUI());
store.on('events:updated', () => {
  if (!store.state.db) return;
  syncActiveEventDay(new Date());
});

export default { bootApp, syncActiveEventDay, buildActiveEventDaySnapshot };
