class Store {
  constructor() {
    this.state = {
      db: null,
      activeEventDay: null, // { eventId, eventName, date, range, currency, exchangeRate }
      uiReady: false,
      session: {
        user: null,
        eventId: null,
        busId: null,
        meta: {},
        lastSync: null
      }
    };
    this.listeners = {};
  }
  setDb(db) {
    this.state.db = db;
  }
  setActiveEventDay(day) {
    const previous = this.state.activeEventDay;
    const next = day
      ? {
          ...day,
          range: day?.range ? { ...day.range } : undefined
        }
      : null;
    this.state.activeEventDay = next;
    this.emit('activeDay:changed', { current: next, previous });
  }
  clearActiveEventDay() {
    this.setActiveEventDay(null);
  }
  getActiveEventDay() {
    return this.state.activeEventDay;
  }
  setUiReady(flag) {
    this.state.uiReady = !!flag;
  }
  setSession(nextSession = {}) {
    const previous = this.state.session || null;
    const merged = {
      user: nextSession.user ?? previous?.user ?? null,
      eventId: nextSession.eventId ?? previous?.eventId ?? null,
      busId: nextSession.busId ?? previous?.busId ?? null,
      meta: {
        ...(previous?.meta || {}),
        ...(nextSession.meta || {})
      },
      lastSync: nextSession.lastSync ?? previous?.lastSync ?? null
    };
    this.state.session = merged;
    this.emit('session:changed', { current: merged, previous });
    return merged;
  }
  updateSession(patch = {}) {
    const current = this.state.session || {};
    return this.setSession({ ...current, ...patch });
  }
  clearSession() {
    this.setSession({ user: null, eventId: null, busId: null, meta: {}, lastSync: null });
  }
  on(evt, handler) {
    if (!this.listeners[evt]) this.listeners[evt] = new Set();
    this.listeners[evt].add(handler);
  }
  off(evt, handler) {
    this.listeners[evt]?.delete(handler);
  }
  emit(evt, payload) {
    this.listeners[evt]?.forEach(h => {
      try { h(payload); } catch (e) { console.error('[POS] store handler error', e); }
    });
  }
}

export const store = new Store();
