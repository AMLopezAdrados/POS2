class Store {
  constructor() {
    this.state = {
      db: null,
      activeEventDay: null, // { eventId, eventName, date, range, currency, exchangeRate }
      uiReady: false
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
