// 📦 4_ui.js — Hoofd-UI module

// Centrale store als enige state bron
import { store } from './store.js';
import { apiFetch } from './api.js';
import { addVerkoopMutatie, getEventOmzet } from './3_data.js';
import { buildCashflowProjection } from './19_cashflow.js';
import { resolveBusId } from './voorraad_utils.js';

// ============ Globale UI Helpers ============

/** Sluit alle geopende modals veilig. */
export function closeAllModals() {
    document.querySelectorAll('.modal-overlay, body > .modal').forEach(m => {
        m.classList.add('closing');
        m.addEventListener('animationend', () => m.remove(), { once: true });
    });
    document.body.classList.remove('modal-open');
}

/** Toont een laad-indicator. */
export function showLoading(msg = 'Laden…') {
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loadingOverlay';
        document.body.append(overlay);
    }
    // Zorg dat de overlay altijd de juiste structuur heeft
    if (!overlay.querySelector('p')) {
        overlay.innerHTML = `<div class="loading-spinner"></div><p></p>`;
    }
    overlay.querySelector('p').textContent = msg;
    overlay.style.display = 'flex';
}

/** Verbergt de laad-indicator. */
export function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
}

/** Toont een tijdelijke notificatie (toast). */
export function showAlert(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.append(toast);
    setTimeout(() => toast.remove(), 2500);
}

/**
 * Maakt een gestandaardiseerde modal met overlay.
 * Geeft `overlay`, `box` en `close()` terug.
 */
export function createModal(opts = {}) {
    const getNextModalZIndex = () => {
        const candidates = document.querySelectorAll('.modal-overlay, .oc-overlay, .modal');
        let highest = 200;
        candidates.forEach(el => {
            const zIndex = Number.parseInt(getComputedStyle(el).zIndex, 10);
            if (Number.isFinite(zIndex)) highest = Math.max(highest, zIndex);
        });
        return highest + 1;
    };
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = String(getNextModalZIndex());
    const box = document.createElement('div');
    box.className = 'modal-box';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');

    function close() {
        overlay.remove();
        document.body.classList.remove('modal-open');
        document.removeEventListener('keydown', escHandler);
        if (typeof opts.onClose === 'function') opts.onClose();
    }

    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    return { overlay, box, close };
}

// ============ Hoofd-UI Rendering ============

/** Bouwt en toont de volledige hoofdinterface van de applicatie. */
export async function showMainShell() {
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
        <header id=\"appTopbar\"></header>
        <main id=\"mainContent\" class=\"app-main\">
            <section id=\"panel-dashboard\" class=\"app-panel app-panel-active\">
                <div class=\"dashboard-layout dashboard-v2\">
                    <section id=\"dashboardLayer1\" class=\"dashboard-layer\"></section>
                    <section id=\"dashboardLayer2\" class=\"dashboard-layer\"></section>
                    <section id=\"dashboardLayer3\" class=\"dashboard-layer\"></section>
                    <section id=\"dashboardMoreSection\" class=\"dashboard-more\">
                        <button type=\"button\" class=\"dashboard-more__toggle\" data-more-toggle>
                            <span class=\"dashboard-more__label\">Meer inzichten</span>
                            <span class=\"dashboard-more__chevron\" aria-hidden=\"true\">▼</span>
                        </button>
                        <div class=\"dashboard-more__content\" hidden>
                            <div id=\"salesMount\"></div>
                            <div id=\"goalProgressMount\"></div>
                            <div id=\"reisPlannerMount\"></div>
                        </div>
                    </section>
                </div>
            </section>
            <section id=\"panel-daginfo\" class=\"app-panel\"></section>
            <section id=\"panel-voorraad\" class=\"app-panel\"></section>
            <section id=\"panel-events\" class=\"app-panel\"></section>
            <section id=\"panel-reis\" class=\"app-panel\"></section>
            <section id=\"panel-inzichten\" class=\"app-panel\"></section>
            <section id=\"panel-accounting\" class=\"app-panel\"></section>
            <section id=\"panel-gebruikers\" class=\"app-panel\"></section>
            <section id=\"panel-settings\" class=\"app-panel\"></section>
        </main>
        <nav id=\"appBottomBar\" class=\"app-bottom-nav\" aria-label=\"Hoofdmenu\"></nav>
    `;
    injectCoreStylesOnce();

    renderTopbar();
    ensureTopbarStateListeners();
    renderBottomNav();
    ensureEventDeckListeners();
    renderEventCards();
    initUpcomingEventsWatcher();
    renderActiveDayPanel();
    renderReisPlannerWidget();

    const moreToggle = document.querySelector('[data-more-toggle]');
    const moreContent = document.querySelector('.dashboard-more__content');
    if (moreToggle && moreContent) {
        moreToggle.addEventListener('click', () => {
            const isHidden = moreContent.hasAttribute('hidden');
            moreContent.toggleAttribute('hidden', !isHidden);
            moreToggle.classList.toggle('dashboard-more__toggle--open', isHidden);
        });
    }

    // sales UI wordt elders getriggerd via store events
    ensureQuickSaleFab();
}

// backwards compat
export const showMainMenu = showMainShell;

let quickSaleFabInitialized = false;
let quickSaleModalContext = null;

// ============ Topbar ============

function renderTopbar() {
    const topbarMount = document.getElementById('appTopbar');
    if (!topbarMount) return;

    const activeDay = store.getActiveEventDay?.();
    const session = store.state.session || {};
    const activeEvent = resolveActiveEventRecord();
    const eventTitle = buildTopbarEventTitle(activeDay, activeEvent);
    const contextMarkup = buildTopbarContextChips(activeDay, activeEvent, session);

    topbarMount.className = 'app-topbar';
    topbarMount.innerHTML = `
        <div class="tb-left">
            ${eventTitle}
        </div>
        <div class="tb-right">
            ${contextMarkup}
            <span id="netBadge" class="net" title="Netwerkstatus"></span>
        </div>
    `;

    const dayButton = topbarMount.querySelector('#topbarActiveDayBtn');
    if (dayButton) {
        dayButton.addEventListener('click', () => navigationActionHandler('daginfo'));
    }

    updateNetworkStatus();
}

function buildTopbarEventTitle(activeDay, activeEvent) {
    if (!activeDay) {
        return `
            <button type="button" class="tb-event tb-event--empty" id="topbarActiveDayBtn">
                <span class="tb-event__icon" aria-hidden="true">📅</span>
                <span class="tb-event__content">
                    <span class="tb-event__title">Geen dag actief</span>
                    <span class="tb-event__meta">Kies een event op het dashboard</span>
                </span>
            </button>
        `;
    }

    const title = escapeHtml(activeEvent?.naam || activeDay.eventName || 'Actief event');
    const location = escapeHtml(activeEvent?.locatie || activeDay.meta?.locatie || 'Onbekende locatie');
    const date = escapeHtml(formatTopbarDate(activeDay.date) || activeDay.date || 'Datum onbekend');

    return `
        <button type="button" class="tb-event" id="topbarActiveDayBtn">
            <span class="tb-event__icon" aria-hidden="true">📅</span>
            <span class="tb-event__content">
                <span class="tb-event__title">${title}</span>
                <span class="tb-event__meta">${location} • ${date}</span>
            </span>
            <span class="tb-event__cta" aria-hidden="true">Daginfo</span>
        </button>
    `;
}

function buildTopbarContextChips(activeDay, activeEvent, session) {
    const chips = [];

    const userName = escapeHtml(session?.user?.naam || session?.user?.name || session?.user?.username || 'Ingelogd');
    const userChip = `
        <span class="tb-chip tb-chip--user">
            <span class="tb-chip__icon" aria-hidden="true">👤</span>
            <span class="tb-chip__content">
                <span class="tb-chip__title">${userName}</span>
                <span class="tb-chip__meta">Aanwezig</span>
            </span>
        </span>
    `;
    chips.push(userChip);

    const busId = session?.busId || session?.meta?.bus;
    if (busId) {
        chips.push(`
            <span class="tb-chip tb-chip--bus">
                <span class="tb-chip__icon" aria-hidden="true">🚌</span>
                <span class="tb-chip__content">
                    <span class="tb-chip__title">Bus ${escapeHtml(String(busId).toUpperCase())}</span>
                    <span class="tb-chip__meta">Actief</span>
                </span>
            </span>
        `);
    }

    if (activeDay && activeEvent) {
        const mutationTotals = aggregateEventMutationTotals(activeEvent);
        const total = mutationTotals.total || 0;
        const badgeLabel = total === 1 ? 'stuk geregistreerd' : 'stuks geregistreerd';
        chips.push(`
            <span class="tb-chip tb-chip--mutaties">
                <span class="tb-chip__icon" aria-hidden="true">⚡</span>
                <span class="tb-chip__content">
                    <span class="tb-chip__title">${total}</span>
                    <span class="tb-chip__meta">${badgeLabel}</span>
                </span>
            </span>
        `);

        const transferTotal = mutationTotals?.transfers?.total || 0;
        if (transferTotal > 0) {
            const transferLabel = transferTotal === 1 ? 'stuk verplaatst' : 'stuks verplaatst';
            chips.push(`
                <span class="tb-chip tb-chip--transfer">
                    <span class="tb-chip__icon" aria-hidden="true">↔︎</span>
                    <span class="tb-chip__content">
                        <span class="tb-chip__title">${transferTotal}</span>
                        <span class="tb-chip__meta">${transferLabel}</span>
                    </span>
                </span>
            `);
        }
    }

    return `<div class="tb-context">${chips.join('')}</div>`;
}

function resolveActiveEventRecord() {
    const activeDay = store.getActiveEventDay?.();
    if (!activeDay) return null;
    const events = Array.isArray(store.state.db?.evenementen) ? store.state.db.evenementen : [];
    return events.find((event) => {
        const candidateId = event.id ?? event.uuid ?? event.slug ?? event.naam;
        return (
            String(candidateId) === String(activeDay.eventId)
            || String(event.naam).toLowerCase() === String(activeDay.eventName || '').toLowerCase()
        );
    }) || null;
}

function formatTopbarDate(ymd) {
    const date = parseLocalYMD(ymd);
    if (!date) return '';
    return date.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' });
}

function parseLocalYMD(value) {
    if (!value || typeof value !== 'string') return null;
    const parts = value.split('-').map(Number);
    if (parts.length !== 3) return null;
    const [year, month, day] = parts;
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isToday(ymd) {
    const date = parseLocalYMD(ymd);
    if (!date) return false;
    const now = new Date();
    return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
    );
}

function formatFullDate(ymd) {
    const date = parseLocalYMD(ymd);
    if (!date) return '-';
    return date.toLocaleDateString('nl-NL', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function formatRangeLabel(range) {
    if (!range) return '-';
    const start = range.start ? formatFullDate(range.start) : '';
    const end = range.end ? formatFullDate(range.end) : '';
    if (start && end && start !== end) return `${start} – ${end}`;
    return start || end || '-';
}

let topbarListenersBound = false;
function ensureTopbarStateListeners() {
    if (topbarListenersBound) return;
    topbarListenersBound = true;
    const rerender = () => renderTopbar();
    store.on('activeDay:changed', rerender);
    store.on('db:loaded', rerender);
    store.on('session:changed', rerender);
    store.on('events:updated', rerender);
}

// Netwerkstatus listener (wordt maar 1x gekoppeld)
let networkListenersAttached = false;
function updateNetworkStatus() {
    const badge = document.getElementById('netBadge');
    if (!badge) return;
    const isOnline = navigator.onLine;
    badge.className = isOnline ? 'net ok' : 'net off';
    badge.title = isOnline ? 'Online' : 'Offline';

    if (!networkListenersAttached) {
        window.addEventListener('online', updateNetworkStatus);
        window.addEventListener('offline', updateNetworkStatus);
        networkListenersAttached = true;
    }
}

// ============ Sidebar (de enige, samengevoegde versie) ============

const PANEL_MAP = {
    dashboard: 'panel-dashboard',
    daginfo: 'panel-daginfo',
    voorraad: 'panel-voorraad',
    events: 'panel-events',
    reis: 'panel-reis',
    inzichten: 'panel-inzichten',
    accounting: 'panel-accounting',
    gebruikers: 'panel-gebruikers',
    settings: 'panel-settings'
};

function setActivePanel(name) {
    const id = PANEL_MAP[name] || PANEL_MAP.dashboard;
    const main = document.getElementById('mainContent');
    Object.values(PANEL_MAP).forEach(panelId => {
        const node = document.getElementById(panelId);
        if (!node) return;
        const isActive = panelId === id;
        node.classList.toggle('app-panel-active', isActive);
        node.toggleAttribute('hidden', !isActive);
        node.setAttribute('aria-hidden', isActive ? 'false' : 'true');
        node.style.display = isActive ? '' : 'none';
        if (isActive) {
            node.scrollTop = 0;
        }
    });
    if (main && typeof main.scrollTo === 'function') {
        main.scrollTo({ top: 0, behavior: 'auto' });
    }
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        window.scrollTo({ top: 0, behavior: 'auto' });
    }
}

function markActiveNav(action) {
    const nav = document.getElementById('appBottomBar');
    if (!nav) return;
    nav.querySelectorAll('button[data-action]').forEach(btn => {
        const isActive = btn.dataset.action === action;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        if (isActive) {
            btn.setAttribute('aria-current', 'page');
        } else {
            btn.removeAttribute('aria-current');
        }
    });
}

// Actie-handler voor navigatie-items (onderste menu)
const navigationActionHandler = async (action) => {
    try {
        const activeDay = store.getActiveEventDay?.();
        const events = store.state.db?.evenementen || [];
        const evt = activeDay
            ? events.find(e => {
                const candidateId = e.id ?? e.uuid ?? e.slug ?? e.naam;
                return candidateId === activeDay.eventId || e.naam === activeDay.eventName;
            })
            : null;
        switch (action) {
            case 'dashboard':
                setActivePanel('dashboard');
                markActiveNav(action);
                window.scrollTo({ top: 0, behavior: 'smooth' });
                break;
            case 'quickSale':
                if (!activeDay) {
                    showAlert('Geen actief evenement geselecteerd.', 'warning');
                    break;
                }
                openQuickSaleModal();
                break;
            case 'dagomzet': {
                setActivePanel('dashboard');
                markActiveNav('dashboard');
                if (!activeDay) {
                    showAlert('Geen actieve dag om omzet voor te registreren.', 'warning');
                    break;
                }
                try {
                    const verkoopModule = await import('./8_verkoopscherm.js');
                    const opened = await verkoopModule?.renderSalesUI?.(true);
                    if (!opened) {
                        showAlert('Dagomzetformulier niet beschikbaar.', 'warning');
                    }
                } catch (err) {
                    console.warn('[POS] dagomzetformulier openen mislukt', err);
                    showAlert('Dagomzetformulier niet beschikbaar.', 'warning');
                }
                break;
            }
            case 'daginfo':
                setActivePanel('daginfo');
                markActiveNav(action);
                renderActiveDayPanel();
                break;
            case 'voorraad':
                setActivePanel('voorraad');
                markActiveNav(action);
                (await import('./6_beheerVoorraad.js')).renderVoorraadInMain('#panel-voorraad');
                break;
            case 'events':
                setActivePanel('events');
                markActiveNav(action);
                (await import('./5_eventbeheer.js')).initEventBeheer('#panel-events');
                break;
            case 'reis':
                setActivePanel('reis');
                markActiveNav(action);
                (await import('./14_reisPlanning.js')).renderReisPlannerPage('#panel-reis');
                break;
            case 'accounting':
                setActivePanel('accounting');
                markActiveNav(action);
                (await import('./18_accounting.js')).renderAccountingPage('#panel-accounting');
                break;
            case 'gebruikers':
                setActivePanel('gebruikers');
                markActiveNav(action);
                (await import('./11_gebruikersbeheer.js')).renderGebruikersBeheer('#panel-gebruikers');
                break;
            case 'inzichten':
                setActivePanel('inzichten');
                markActiveNav(action);
                (await import('./17_inzichten.js')).renderInzichtenPage('#panel-inzichten');
                break;
            case 'settings':
                setActivePanel('settings');
                markActiveNav(action);
                (await import('./19_settings.js')).renderSettingsPage('#panel-settings');
                break;
        }
    } catch (err) {
        console.error(`Sidebar actie '${action}' mislukt:`, err);
        showAlert('Actie kon niet worden uitgevoerd.', 'error');
    }
};

function renderBottomNav() {
    const navMount = document.getElementById('appBottomBar');
    if (!navMount) return;

    navMount.setAttribute('role', 'menubar');
    navMount.setAttribute('aria-label', 'Hoofdmenu');

    const { isAdmin, items } = buildBottomNavItems();

    navMount.innerHTML = items
        .map((item) => {
            const attrs = [`data-action="${item.action}"`];
            if (item.requiresActiveDay) attrs.push('data-requires-active-day="true"');
            if (item.locked) attrs.push('data-locked="true"');
            return `
                <button type="button" role="menuitem" ${attrs.join(' ')} aria-pressed="false">
                    <span class="icon">${item.icon}</span>
                    <span class="label">${item.label}</span>
                    <span class="badge" data-role="badge" data-action="${item.action}"></span>
                </button>
            `;
        })
        .join('');

    if (isAdmin && !items.some((item) => item.action === 'gebruikers')) {
        console.warn('[POS] Bottom nav rendering mist gebruikers-item voor admin');
    }

    navMount.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => navigationActionHandler(btn.dataset.action));
    });

    ensureBottomNavStateListeners();
    updateBottomNavState();
    markActiveNav('dashboard');
}

function buildBottomNavItems() {
    const session = store.state.session || {};
    const userRole = session?.user?.role || session?.user?.rol;
    const isAdmin = String(userRole || '').toLowerCase() === 'admin';
    const activeDay = store.getActiveEventDay?.();
    const activeEvent = resolveActiveEventRecord();
    const mutationTotals = activeDay && activeEvent ? aggregateEventMutationTotals(activeEvent) : { total: 0 };
    const pendingAccounting = Array.isArray(store.state.db?.accounting?.pendingQueue)
        ? store.state.db.accounting.pendingQueue.length
        : 0;
    const busLabel = session?.busId || session?.meta?.bus || '';

    const baseItems = [
        { action: 'dashboard', icon: '🏠', label: 'Dashboard' },
        { action: 'daginfo', icon: '📅', label: 'Daginfo', requiresActiveDay: true },
        { action: 'dagomzet', icon: '💶', label: 'Omzet', requiresActiveDay: true },
        { action: 'quickSale', icon: '⚡', label: 'Snel invoer', requiresActiveDay: true },
        { action: 'voorraad', icon: '📦', label: 'Voorraad' },
        { action: 'events', icon: '🎪', label: 'Events' },
        { action: 'reis', icon: '🧾', label: 'Paklijsten' },
        { action: 'accounting', icon: '📒', label: 'Cashflow' },
        { action: 'inzichten', icon: '📈', label: 'Inzichten' },
        { action: 'settings', icon: '⚙️', label: 'Instellingen' }
    ];

    if (isAdmin) {
        baseItems.splice(6, 0, { action: 'gebruikers', icon: '👥', label: 'Team' });
    }

    const decorated = baseItems.map((item) => {
        const next = { ...item };
        if (item.action === 'daginfo' && activeDay?.date) {
            next.badge = formatTopbarDate(activeDay.date) || activeDay.date;
        }
        if (item.action === 'quickSale' && mutationTotals.total > 0) {
            next.badge = `${mutationTotals.total}`;
        }
        if (item.action === 'voorraad' && busLabel) {
            next.badge = String(busLabel).toUpperCase();
        }
        if (item.action === 'accounting' && pendingAccounting > 0) {
            next.badge = `${pendingAccounting}`;
        }
        return next;
    });

    return { isAdmin, items: decorated };
}

let bottomNavStateBound = false;
function ensureBottomNavStateListeners() {
    if (bottomNavStateBound) return;
    bottomNavStateBound = true;
    const update = () => updateBottomNavState();
    store.on('activeDay:changed', update);
    store.on('session:changed', update);
    store.on('events:updated', update);
    store.on('db:loaded', update);
    store.on?.('accounting:pending', update);
}

function updateBottomNavState() {
    const nav = document.getElementById('appBottomBar');
    if (!nav) return;
    const activeDay = store.getActiveEventDay?.();
    const activeEvent = resolveActiveEventRecord();
    const mutationTotals = activeDay && activeEvent ? aggregateEventMutationTotals(activeEvent) : { total: 0 };
    const hasActiveDay = Boolean(activeDay);
    const busLabel = store.state.session?.busId || store.state.session?.meta?.bus || '';
    const pendingAccounting = Array.isArray(store.state.db?.accounting?.pendingQueue)
        ? store.state.db.accounting.pendingQueue.length
        : 0;

    nav.querySelectorAll('button[data-requires-active-day]').forEach((btn) => {
        btn.toggleAttribute('disabled', !hasActiveDay);
    });

    nav.querySelectorAll('span[data-role="badge"]').forEach((badge) => {
        const action = badge.dataset.action;
        let value = '';
        if (action === 'daginfo' && hasActiveDay && activeDay?.date) {
            value = formatTopbarDate(activeDay.date) || activeDay.date;
        }
        if (action === 'quickSale') {
            value = mutationTotals.total > 0 ? `${mutationTotals.total}` : '';
        }
        if (action === 'voorraad' && busLabel) {
            value = String(busLabel).toUpperCase();
        }
        if (action === 'accounting' && pendingAccounting > 0) {
            value = `${pendingAccounting}`;
        }
        badge.textContent = value;
        badge.classList.toggle('badge--hidden', !value);
    });
}

// ============ Event deck (planned & active) ============

let eventDeckListenersBound = false;
function ensureEventDeckListeners() {
    if (eventDeckListenersBound) return;
    eventDeckListenersBound = true;
    store.on('db:loaded', renderEventCards);
    store.on('events:updated', renderEventCards);
    store.on('activeDay:changed', renderEventCards);
    store.on('db:loaded', renderReisPlannerWidget);
    store.on('events:updated', renderReisPlannerWidget);
    store.on('reizen:updated', renderReisPlannerWidget);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const dashboardState = {
    selectedEventId: null,
    liveBalanceEUR: '',
    scenarioEventRevenue: {},
    scenarioDefaults: {},
    salesMixRange: 'today',
    forecastChart: null,
    forecastTimer: null
};

function renderEventCards() {
    const layer1 = document.getElementById('dashboardLayer1');
    const layer2 = document.getElementById('dashboardLayer2');
    const layer3 = document.getElementById('dashboardLayer3');
    if (!layer1 || !layer2 || !layer3) return;

    const events = Array.isArray(store.state.db?.evenementen)
        ? store.state.db.evenementen
        : [];

    renderGoalProgressCards(events);

    if (!events.length) {
        layer1.innerHTML = renderDashboardEmptyState();
        layer2.innerHTML = '';
        layer3.innerHTML = '';
        resetDashboardForecastChart();
        return;
    }

    const todayEvents = buildTodayEvents(events);
    const plannedEvents = buildPlannedEvents(events);
    const selectedEvent = resolveDashboardSelectedEvent(events, todayEvents);

    layer1.innerHTML = renderDashboardLayer1(todayEvents, selectedEvent);
    layer2.innerHTML = renderDashboardLayer2(plannedEvents);
    layer3.innerHTML = renderDashboardLayer3(selectedEvent);

    bindDashboardLayer1(layer1, todayEvents, selectedEvent);
    bindDashboardLayer2(layer2, plannedEvents);
    bindDashboardLayer3(layer3, selectedEvent);

    resetDashboardForecastChart();
    updateDashboardForecast();
}

function renderDashboardEmptyState() {
    return `
        <section class="dashboard-empty-card">
            <h2>Dashboard</h2>
            <p>Geen evenementen gevonden. Voeg een event toe om te starten.</p>
        </section>
    `;
}

function buildTodayEvents(events) {
    const today = startOfLocalDay(new Date());
    const todayMs = today.getTime();
    const list = [];

    events.forEach((ev) => {
        if (!ev || isEventCompleted(ev)) return;
        const startDate = parseLocalYMD(getEventStartDate(ev));
        const endDate = parseLocalYMD(getEventEndDate(ev));
        const startMs = startDate ? startOfLocalDay(startDate).getTime() : null;
        const endMs = endDate ? startOfLocalDay(endDate).getTime() : null;
        const activeByDate = (
            (startMs != null && endMs != null && startMs <= todayMs && todayMs <= endMs) ||
            (startMs != null && endMs == null && startMs <= todayMs) ||
            (startMs == null && endMs != null && todayMs <= endMs)
        );
        const hasOpenSession = Array.isArray(ev?.sessions || ev?.sessies)
            ? (ev.sessions || ev.sessies).some(session => String(session?.status || session?.state || '').toLowerCase() === 'open')
            : false;

        if (isEventActive(ev) || activeByDate || hasOpenSession) {
            list.push({
                event: ev,
                ref: getEventRef(ev),
                startMs,
                endMs
            });
        }
    });

    list.sort((a, b) => sortByEventDate(a.event, b.event));
    return list;
}

function buildPlannedEvents(events) {
    const today = startOfLocalDay(new Date());
    const todayMs = today.getTime();
    const list = [];
    events.forEach((ev) => {
        if (!ev || isEventCompleted(ev)) return;
        const startDate = parseLocalYMD(getEventStartDate(ev));
        const startMs = startDate ? startOfLocalDay(startDate).getTime() : null;
        const status = String(ev?.state || ev?.status || '').toLowerCase();
        const isPlanned = status === 'planned' || status === 'gepland';
        if ((startMs != null && startMs > todayMs) || isPlanned) {
            list.push(ev);
        }
    });
    list.sort((a, b) => sortByEventDate(a, b));
    return list;
}

function resolveDashboardSelectedEvent(events, todayEvents) {
    const selectedRef = dashboardState.selectedEventId;
    if (selectedRef) {
        const hit = events.find(ev => getEventRef(ev) === selectedRef);
        if (hit) return hit;
    }
    const fallback = todayEvents[0]?.event || events[0] || null;
    dashboardState.selectedEventId = fallback ? getEventRef(fallback) : null;
    return fallback;
}

function getEventRef(event) {
    if (!event) return '';
    return String(event.id || event.naam || event.uuid || event.slug || '').trim();
}

function renderDashboardLayer1(todayEvents, selectedEvent) {
    const todayLabel = formatFullDate(toYMDString(new Date()));
    const eventsStrip = renderTodayEventsStrip(todayEvents, getEventRef(selectedEvent));
    const targetCard = renderTargetMeterCard(selectedEvent);
    const actionCard = renderActionButtonsRow(selectedEvent);

    return `
        <div class="dashboard-layer__header">
            <div>
                <p class="dashboard-layer__eyebrow">Vandaag</p>
                <h2 class="dashboard-layer__title">Actieve events</h2>
            </div>
            <span class="dashboard-layer__meta">${escapeHtml(todayLabel || '')}</span>
        </div>
        ${eventsStrip}
        <div class="dashboard-layer-grid dashboard-layer-grid--two">
            ${targetCard}
            ${actionCard}
        </div>
    `;
}

function renderTodayEventsStrip(todayEvents, selectedRef) {
    if (!todayEvents.length) {
        return `<div class="dashboard-empty-note">Geen actieve events voor vandaag.</div>`;
    }

    const chips = todayEvents.map(({ event, ref }) => {
        const name = formatEventChipTitle(event);
        const meta = formatEventPeriod(event);
        const omzetDone = hasTodayOmzet(event);
        const kostenDone = hasEventCosts(event);
        const omzetBadge = omzetDone ? 'Omzet OK' : 'Omzet ontbreekt';
        const kostenBadge = kostenDone ? 'Kosten OK' : 'Kosten?';
        const badgeClass = omzetDone ? 'ok' : 'warn';
        const isSelected = selectedRef && selectedRef === ref;
        return `
            <button type="button" class="dashboard-event-chip${isSelected ? ' is-selected' : ''}" data-dashboard-event="${escapeHtml(ref)}">
                <span class="dashboard-event-chip__title">${escapeHtml(name)}</span>
                <span class="dashboard-event-chip__meta">${escapeHtml(meta || '')}</span>
                <span class="dashboard-event-chip__badges">
                    <span class="dashboard-chip-badge ${badgeClass}">${escapeHtml(omzetBadge)}</span>
                    <span class="dashboard-chip-badge ${kostenDone ? 'ok' : 'warn'}">${escapeHtml(kostenBadge)}</span>
                </span>
            </button>
        `;
    }).join('');

    return `
        <div class="dashboard-today-strip" role="list">
            ${chips}
        </div>
    `;
}

function formatEventChipTitle(event) {
    const locatie = event?.locatie || event?.naam || 'Onbekend';
    const type = event?.type ? `(${event.type})` : '';
    return `${locatie} ${type}`.trim();
}

function renderTargetMeterCard(event) {
    if (!event) {
        return `
            <article class="dashboard-card dashboard-card--target">
                <h3>Doelstelling</h3>
                <p class="dashboard-card__meta">Selecteer een event om voortgang te zien.</p>
            </article>
        `;
    }

    const realized = getEventRevenueEUR(event);
    const target = getEventTargetEUR(event);
    const progress = target > 0 ? Math.min(100, Math.round((realized / target) * 100)) : 0;
    const remaining = Math.max(0, target - realized);
    const hasTarget = target > 0;

    return `
        <article class="dashboard-card dashboard-card--target" data-dashboard-action="target" role="button" tabindex="0">
            <div class="dashboard-card__head">
                <h3>Doelstelling</h3>
                <span class="dashboard-card__meta">${escapeHtml(event?.naam || '')}</span>
            </div>
            ${hasTarget ? `
                <div class="dashboard-progress">
                    <div class="dashboard-progress__bar">
                        <div class="dashboard-progress__fill" style="width:${progress}%"></div>
                    </div>
                    <div class="dashboard-progress__labels">
                        <span>${escapeHtml(formatCurrencyValue(realized, 'EUR'))}</span>
                        <span>${escapeHtml(formatCurrencyValue(target, 'EUR'))}</span>
                    </div>
                    <div class="dashboard-progress__meta">Nog ${escapeHtml(formatCurrencyValue(remaining, 'EUR'))}</div>
                </div>
            ` : `
                <p class="dashboard-card__meta">Geen doel ingesteld voor dit event.</p>
            `}
        </article>
    `;
}

function renderActionButtonsRow(event) {
    if (!event) {
        return `
            <article class="dashboard-card dashboard-card--actions">
                <h3>Acties</h3>
                <p class="dashboard-card__meta">Kies eerst een actief event.</p>
            </article>
        `;
    }

    const omzetDone = hasTodayOmzet(event);
    const omzetLabel = omzetDone ? 'Dagomzet ✓' : 'Dagomzet invoeren';
    const omzetClass = omzetDone ? 'secondary' : 'primary';

    return `
        <article class="dashboard-card dashboard-card--actions">
            <div class="dashboard-card__head">
                <h3>Dagomzet & Kosten</h3>
                <span class="dashboard-card__meta">${escapeHtml(event?.naam || '')}</span>
            </div>
            <div class="dashboard-action-row">
                <button type="button" class="dashboard-btn ${omzetClass}" data-dashboard-omzet="${escapeHtml(getEventRef(event))}">${escapeHtml(omzetLabel)}</button>
                <button type="button" class="dashboard-btn ghost" data-dashboard-kosten="${escapeHtml(getEventRef(event))}">Kosten</button>
            </div>
        </article>
    `;
}

function renderDashboardLayer2(plannedEvents) {
    const projection = buildCashflowProjection({ months: 1, scenarioEventRevenue: dashboardState.scenarioEventRevenue });
    const balanceValue = dashboardState.liveBalanceEUR;
    const sliderSection = renderPlannedEventsSliders(plannedEvents);

    return `
        <div class="dashboard-layer__header">
            <div>
                <p class="dashboard-layer__eyebrow">Finance</p>
                <h2 class="dashboard-layer__title">Overzicht & vooruitzicht</h2>
            </div>
        </div>
        <div class="dashboard-layer-grid dashboard-layer-grid--two">
            <article class="dashboard-card dashboard-card--clickable" data-dashboard-action="arap" role="button" tabindex="0">
                <div class="dashboard-card__head">
                    <h3>Debiteuren & Crediteuren</h3>
                </div>
                <div class="dashboard-arap">
                    <button type="button" class="dashboard-arap__item" data-dashboard-debiteurs>
                        <span class="dashboard-arap__label">Te ontvangen</span>
                        <strong>${escapeHtml(formatCurrencyValue(projection.totals.openReceivableEUR || 0, 'EUR'))}</strong>
                    </button>
                    <button type="button" class="dashboard-arap__item" data-dashboard-crediteuren>
                        <span class="dashboard-arap__label">Te betalen</span>
                        <strong>${escapeHtml(formatCurrencyValue(projection.totals.openPayableEUR || 0, 'EUR'))}</strong>
                    </button>
                </div>
            </article>
            <article class="dashboard-card">
                <div class="dashboard-card__head">
                    <h3>Huidig saldo</h3>
                    <span class="dashboard-card__meta">Niet opgeslagen</span>
                </div>
                <input type="text" class="dashboard-input" inputmode="decimal" placeholder="Huidig saldo (wordt niet opgeslagen)" value="${escapeHtml(balanceValue)}" data-live-balance>
            </article>
        </div>
        <article class="dashboard-card dashboard-forecast" data-dashboard-action="forecast" role="button" tabindex="0">
            <div class="dashboard-card__head">
                <h3>3-maanden vooruitzicht</h3>
                <span class="dashboard-card__meta">Baseline vs scenario</span>
            </div>
            <div class="dashboard-forecast__chart">
                <canvas id="dashboardForecastChart" height="160"></canvas>
            </div>
            <div class="dashboard-forecast__summary">
                <span data-forecast-end></span>
                <span data-forecast-baseline></span>
                <span class="dashboard-forecast__hint" data-forecast-hint></span>
            </div>
            ${sliderSection}
        </article>
    `;
}

function renderPlannedEventsSliders(plannedEvents) {
    const events = plannedEvents.slice(0, 10);
    const rows = events.map((event) => renderPlannedEventSlider(event)).join('');
    const hasRows = Boolean(rows);
    const emptyNote = hasRows ? '' : '<p class="dashboard-empty-note">Geen geplande events voor scenario’s.</p>';

    return `
        <div class="dashboard-forecast-sliders">
            <button type="button" class="dashboard-toggle" data-forecast-toggle>
                <span>Wat-als (geplande events)</span>
                <span class="dashboard-toggle__chevron" aria-hidden="true">▼</span>
            </button>
            <div class="dashboard-forecast-sliders__panel" hidden>
                ${rows}
                ${emptyNote}
                <div class="dashboard-slider-actions">
                    <button type="button" class="dashboard-btn ghost" data-scenario-reset-all>Reset scenario</button>
                    <button type="button" class="dashboard-btn secondary" data-scenario-neutral>Neutraal</button>
                </div>
            </div>
        </div>
    `;
}

function renderPlannedEventSlider(event) {
    const ref = getEventRef(event);
    const defaults = getScenarioDefaultsForEvent(event);
    const value = Number.isFinite(dashboardState.scenarioEventRevenue[ref])
        ? dashboardState.scenarioEventRevenue[ref]
        : defaults.defaultValue;
    const net = computeScenarioNet(event, value);
    const meta = formatEventPeriod(event);
    return `
        <div class="dashboard-slider" data-scenario-event="${escapeHtml(ref)}">
            <div class="dashboard-slider__head">
                <div>
                    <p class="dashboard-slider__title">${escapeHtml(formatEventChipTitle(event))}</p>
                    <p class="dashboard-slider__meta">${escapeHtml(meta || '')}</p>
                    <p class="dashboard-slider__sub">Commissie: ${escapeHtml(defaults.commissionLabel)} | Netto: <span data-scenario-net="${escapeHtml(ref)}">${escapeHtml(formatCurrencyValue(net, 'EUR'))}</span></p>
                </div>
                <button type="button" class="dashboard-icon-btn" data-scenario-reset="${escapeHtml(ref)}" aria-label="Reset">↺</button>
            </div>
            <input type="range" min="0" max="${defaults.max}" step="${defaults.step}" value="${value}" data-scenario-slider="${escapeHtml(ref)}">
            <div class="dashboard-slider__values">
                <span data-scenario-value="${escapeHtml(ref)}">${escapeHtml(formatCurrencyValue(value, 'EUR'))}</span>
                <span class="muted">Max ${escapeHtml(formatCurrencyValue(defaults.max, 'EUR'))}</span>
            </div>
        </div>
    `;
}

function renderDashboardLayer3(selectedEvent) {
    const inventory = getInventoryRiskSummary();
    const salesMix = getSalesMixSummary(selectedEvent, dashboardState.salesMixRange);

    return `
        <div class="dashboard-layer__header">
            <div>
                <p class="dashboard-layer__eyebrow">Operatie</p>
                <h2 class="dashboard-layer__title">Voorraad & verkoopmix</h2>
            </div>
        </div>
        <div class="dashboard-layer-grid dashboard-layer-grid--two">
            <article class="dashboard-card dashboard-card--clickable" data-dashboard-action="inventory" role="button" tabindex="0">
                <div class="dashboard-card__head">
                    <h3>Voorraad risico’s</h3>
                    <span class="dashboard-card__meta">${escapeHtml(inventory.busLabel)}</span>
                </div>
                ${inventory.items.length ? `
                    <div class="dashboard-risk-summary">
                        <strong>${inventory.count} producten onder minimum</strong>
                        <ul>
                            ${inventory.items.map(item => `<li>${escapeHtml(item.label)} <span>${escapeHtml(item.qty)}</span></li>`).join('')}
                        </ul>
                    </div>
                ` : `<p class="dashboard-card__meta">Geen risico’s gesignaleerd.</p>`}
            </article>
            <article class="dashboard-card dashboard-card--clickable" data-dashboard-action="salesmix" role="button" tabindex="0">
                <div class="dashboard-card__head">
                    <h3>Verkoopmix</h3>
                    <div class="dashboard-segment" role="tablist">
                        <button type="button" class="dashboard-segment__btn${dashboardState.salesMixRange === 'today' ? ' active' : ''}" data-sales-mix-range="today">Vandaag</button>
                        <button type="button" class="dashboard-segment__btn${dashboardState.salesMixRange === 'event' ? ' active' : ''}" data-sales-mix-range="event">Hele event</button>
                    </div>
                </div>
                ${salesMix.items.length ? `
                    <div class="dashboard-mix-list">
                        ${salesMix.items.map(item => `
                            <div class="dashboard-mix-item">
                                <span>${escapeHtml(item.label)}</span>
                                <span>${escapeHtml(item.pctLabel)}</span>
                                <div class="dashboard-mix-bar">
                                    <div class="dashboard-mix-bar__fill" style="width:${item.pct}%"></div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : `<p class="dashboard-card__meta">Nog geen verkoopmix beschikbaar.</p>`}
            </article>
        </div>
    `;
}

function bindDashboardLayer1(layer1, todayEvents, selectedEvent) {
    layer1.querySelectorAll('[data-dashboard-event]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const ref = btn.dataset.dashboardEvent;
            const event = findEventByRef(ref);
            if (event) {
                dashboardState.selectedEventId = ref;
                renderEventCards();
                openEventDetails(ref);
            }
        });
    });

    const targetCard = layer1.querySelector('[data-dashboard-action="target"]');
    if (targetCard) {
        targetCard.addEventListener('click', () => {
            if (!selectedEvent) return;
            openEventInsights(getEventRef(selectedEvent));
        });
    }

    layer1.querySelectorAll('[data-dashboard-omzet]').forEach((btn) => {
        btn.addEventListener('click', () => openDagomzetModal(btn.dataset.dashboardOmzet, toYMDString(new Date())));
    });
    layer1.querySelectorAll('[data-dashboard-kosten]').forEach((btn) => {
        btn.addEventListener('click', () => openKostenModal(btn.dataset.dashboardKosten));
    });
}

function bindDashboardLayer2(layer2, plannedEvents) {
    const balanceInput = layer2.querySelector('[data-live-balance]');
    if (balanceInput) {
        balanceInput.addEventListener('input', () => {
            dashboardState.liveBalanceEUR = balanceInput.value;
            scheduleDashboardForecastUpdate();
        });
    }

    layer2.querySelectorAll('[data-dashboard-debiteurs]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            openDebiteurenScreen();
        });
    });
    layer2.querySelectorAll('[data-dashboard-crediteuren]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            openCrediteurenScreen();
        });
    });

    const toggle = layer2.querySelector('[data-forecast-toggle]');
    const panel = layer2.querySelector('.dashboard-forecast-sliders__panel');
    if (toggle && panel) {
        toggle.addEventListener('click', () => {
            const isHidden = panel.hasAttribute('hidden');
            panel.toggleAttribute('hidden', !isHidden);
            toggle.classList.toggle('is-open', isHidden);
        });
    }

    const plannedMap = new Map(plannedEvents.map(event => [getEventRef(event), event]));
    layer2.querySelectorAll('[data-scenario-slider]').forEach((input) => {
        input.addEventListener('input', () => {
            const ref = input.dataset.scenarioSlider;
            dashboardState.scenarioEventRevenue[ref] = Number(input.value) || 0;
            updateScenarioSliderUI(layer2, plannedMap, ref);
            scheduleDashboardForecastUpdate();
        });
    });

    layer2.querySelectorAll('[data-scenario-reset]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            const ref = btn.dataset.scenarioReset;
            const targetEvent = plannedMap.get(ref);
            if (!targetEvent) return;
            const defaults = getScenarioDefaultsForEvent(targetEvent);
            dashboardState.scenarioEventRevenue[ref] = defaults.defaultValue;
            const input = layer2.querySelector(`[data-scenario-slider="${CSS.escape(ref)}"]`);
            if (input) input.value = defaults.defaultValue;
            updateScenarioSliderUI(layer2, plannedMap, ref);
            scheduleDashboardForecastUpdate();
        });
    });

    const resetAll = layer2.querySelector('[data-scenario-reset-all]');
    if (resetAll) {
        resetAll.addEventListener('click', (event) => {
            event.stopPropagation();
            plannedMap.forEach((ev, ref) => {
                const defaults = getScenarioDefaultsForEvent(ev);
                dashboardState.scenarioEventRevenue[ref] = defaults.defaultValue;
                const input = layer2.querySelector(`[data-scenario-slider="${CSS.escape(ref)}"]`);
                if (input) input.value = defaults.defaultValue;
                updateScenarioSliderUI(layer2, plannedMap, ref);
            });
            scheduleDashboardForecastUpdate();
        });
    }

    const neutral = layer2.querySelector('[data-scenario-neutral]');
    if (neutral) {
        neutral.addEventListener('click', (event) => {
            event.stopPropagation();
            plannedMap.forEach((_, ref) => {
                dashboardState.scenarioEventRevenue[ref] = 0;
                const input = layer2.querySelector(`[data-scenario-slider="${CSS.escape(ref)}"]`);
                if (input) input.value = 0;
                updateScenarioSliderUI(layer2, plannedMap, ref);
            });
            scheduleDashboardForecastUpdate();
        });
    }

    const forecastCard = layer2.querySelector('[data-dashboard-action="forecast"]');
    if (forecastCard) {
        forecastCard.addEventListener('click', (event) => {
            if (shouldIgnoreCardClick(event)) return;
            openPlanningForecastScreen();
        });
    }
}

function bindDashboardLayer3(layer3, selectedEvent) {
    const inventoryCard = layer3.querySelector('[data-dashboard-action="inventory"]');
    if (inventoryCard) {
        inventoryCard.addEventListener('click', (event) => {
            if (shouldIgnoreCardClick(event)) return;
            openVoorraadBeheer();
        });
    }

    const salesMixCard = layer3.querySelector('[data-dashboard-action="salesmix"]');
    if (salesMixCard) {
        salesMixCard.addEventListener('click', (event) => {
            if (shouldIgnoreCardClick(event)) return;
            if (!selectedEvent) return;
            openEventSalesMixDetails(getEventRef(selectedEvent));
        });
    }

    layer3.querySelectorAll('[data-sales-mix-range]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            const range = btn.dataset.salesMixRange;
            if (range === 'today' || range === 'event') {
                dashboardState.salesMixRange = range;
                renderEventCards();
            }
        });
    });
}

function shouldIgnoreCardClick(event) {
    const target = event.target;
    return target.closest('button, input, select, textarea, label');
}

function updateScenarioSliderUI(layer2, plannedMap, ref) {
    const event = plannedMap.get(ref);
    if (!event) return;
    const value = Number(dashboardState.scenarioEventRevenue[ref]) || 0;
    const net = computeScenarioNet(event, value);
    const valueNode = layer2.querySelector(`[data-scenario-value="${CSS.escape(ref)}"]`);
    const netNode = layer2.querySelector(`[data-scenario-net="${CSS.escape(ref)}"]`);
    if (valueNode) valueNode.textContent = formatCurrencyValue(value, 'EUR');
    if (netNode) netNode.textContent = formatCurrencyValue(net, 'EUR');
}

function hasTodayOmzet(event) {
    if (!event) return false;
    const today = toYMDString(new Date());
    const entries = collectEventOmzetEntries(event);
    return entries.some((entry) => {
        const entryDate = normalizeOmzetEntryDate(entry);
        if (entryDate !== today) return false;
        const amount = toSafeNumber(entry?.eur ?? entry?.usd ?? entry?.amount ?? entry?.bedrag);
        return amount > 0 || entry != null;
    });
}

function collectEventOmzetEntries(event) {
    if (!event) return [];
    const eventId = getEventRef(event);
    const list = eventId ? getEventOmzet(eventId) : [];
    if (list.length) return list;
    if (Array.isArray(event?.omzet)) return event.omzet;
    if (Array.isArray(event?.omzet?.entries)) return event.omzet.entries;
    return [];
}

function normalizeOmzetEntryDate(entry) {
    const raw = entry?.datum || entry?.date || entry?.day || entry?.timestamp;
    if (!raw) return '';
    if (raw instanceof Date) return toYMDString(raw);
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        const candidate = trimmed.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
        const parsed = new Date(trimmed);
        if (Number.isFinite(parsed.getTime())) return toYMDString(parsed);
    }
    if (typeof raw === 'number') {
        const parsed = new Date(raw);
        if (Number.isFinite(parsed.getTime())) return toYMDString(parsed);
    }
    return '';
}

function hasEventCosts(event) {
    if (!event) return false;
    const costs = event?.kosten || {};
    const extra = Array.isArray(costs.extra) ? costs.extra : [];
    if (extra.length) return true;
    const values = Object.values(costs).filter(value => !Array.isArray(value));
    return values.some(value => toSafeNumber(value) > 0);
}

function getEventRevenueEUR(event) {
    if (!event) return 0;
    const { exchangeRate } = determineEventCurrency(event);
    const totals = calculateOmzetTotals(event, 'EUR', exchangeRate);
    return totals.revenueEUR || totals.revenueTarget || 0;
}

function getEventTargetEUR(event) {
    if (!event) return 0;
    const planning = event?.planning || {};
    const expected = planning.expectedTurnover || {};
    const targetEUR = pickFirstPositive([
        expected?.eur,
        expected?.EUR,
        expected?.amountEUR,
        planning?.expectedTurnoverEUR,
        planning?.expectedRevenueEUR,
        planning?.expectedRevenue,
        planning?.turnoverEstimate,
        planning?.turnoverEstimateEUR,
        event?.expectedTurnoverEUR,
        event?.expectedRevenueEUR,
        event?.expectedRevenue,
        event?.verwachteOmzetEUR,
        event?.verwachteOmzet
    ]);
    if (targetEUR > 0) return targetEUR;
    const targetUSD = pickFirstPositive([
        expected?.usd,
        expected?.USD,
        expected?.amountUSD,
        planning?.expectedTurnoverUSD,
        planning?.expectedRevenueUSD,
        planning?.turnoverEstimateUSD,
        event?.expectedTurnoverUSD,
        event?.expectedRevenueUSD
    ]);
    if (targetUSD > 0) {
        const { exchangeRate } = determineEventCurrency(event);
        return exchangeRate && exchangeRate > 0 ? targetUSD * exchangeRate : targetUSD;
    }
    return 0;
}

function getDebCredSummary() {
    const data = store.state.db?.debCrediteuren || { debiteuren: [], crediteuren: [] };
    const debiteuren = Array.isArray(data.debiteuren) ? data.debiteuren : [];
    const crediteuren = Array.isArray(data.crediteuren) ? data.crediteuren : [];
    const debtorTotal = debiteuren.reduce((sum, entry) => sum + Math.max(0, resolveDebCredBalance(entry)), 0);
    const creditorTotal = crediteuren.reduce((sum, entry) => sum + Math.max(0, resolveDebCredBalance(entry)), 0);
    return { debtorTotal, creditorTotal, debiteuren, crediteuren };
}

function resolveDebCredBalance(entry) {
    const candidates = [
        entry?.openstaand,
        entry?.saldo,
        entry?.amount,
        entry?.bedrag,
        entry?.raw?.openstaand,
        entry?.raw?.saldo,
        entry?.raw?.amount,
        entry?.raw?.bedrag
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

function resolveDebCredDueMonth(entry, fallbackMonth) {
    const candidates = [
        entry?.dueDate,
        entry?.vervaldatum,
        entry?.datum,
        entry?.date,
        entry?.raw?.dueDate,
        entry?.raw?.vervaldatum,
        entry?.raw?.datum,
        entry?.raw?.date
    ];
    for (const candidate of candidates) {
        const parsed = new Date(candidate);
        if (Number.isFinite(parsed.getTime())) {
            return toMonthKey(parsed);
        }
    }
    return fallbackMonth;
}

function getScenarioDefaultsForEvent(event) {
    const ref = getEventRef(event);
    if (dashboardState.scenarioDefaults[ref]) return dashboardState.scenarioDefaults[ref];
    const targetEUR = getEventTargetEUR(event);
    const defaultValue = roundCurrency(targetEUR > 0 ? targetEUR * 0.8 : 0);
    const max = Math.max(targetEUR || 0, defaultValue * 1.2 || 0, 5000);
    const step = max >= 10000 ? 1000 : 500;
    const commissionPct = normalizeCommissionPct(event?.commissie);
    const commissionLabel = `${Math.round(commissionPct * 100)}%`;
    const config = {
        defaultValue,
        max: Math.round(max),
        step,
        commissionLabel
    };
    dashboardState.scenarioDefaults[ref] = config;
    return config;
}

function normalizeCommissionPct(value) {
    const pct = toSafeNumber(value);
    if (!Number.isFinite(pct)) return 0;
    return pct > 1 ? pct / 100 : pct;
}

function computeScenarioNet(event, gross) {
    const commissionPct = normalizeCommissionPct(event?.commissie);
    const productCostPct = 0.3;
    const net = gross * (1 - commissionPct - productCostPct);
    return roundCurrency(net);
}

function scheduleDashboardForecastUpdate() {
    if (dashboardState.forecastTimer) clearTimeout(dashboardState.forecastTimer);
    dashboardState.forecastTimer = setTimeout(() => {
        updateDashboardForecast();
    }, 150);
}

function resetDashboardForecastChart() {
    if (dashboardState.forecastChart?.destroy) {
        try {
            dashboardState.forecastChart.destroy();
        } catch (err) {
            console.debug('[Dashboard] Forecast chart cleanup mislukt', err);
        }
    }
    dashboardState.forecastChart = null;
}

function updateDashboardForecast() {
    const layer2 = document.getElementById('dashboardLayer2');
    if (!layer2) return;
    const forecast = buildDashboardForecast();
    const endLabel = layer2.querySelector('[data-forecast-end]');
    const baselineLabel = layer2.querySelector('[data-forecast-baseline]');
    const hintLabel = layer2.querySelector('[data-forecast-hint]');
    if (endLabel) {
        endLabel.textContent = forecast
            ? `Scenario eindigt over 3 maanden rond: ${formatCurrencyValue(forecast.endScenario, 'EUR')}`
            : '';
    }
    if (baselineLabel) {
        baselineLabel.textContent = forecast
            ? `Baseline: ${formatCurrencyValue(forecast.endBaseline, 'EUR')}`
            : '';
    }
    if (hintLabel) {
        hintLabel.textContent = forecast?.hasBalanceInput
            ? ''
            : 'Vul saldo in voor betere prognose';
    }

    const canvas = layer2.querySelector('#dashboardForecastChart');
    if (!canvas) return;
    if (typeof Chart !== 'function') {
        if (hintLabel && !hintLabel.textContent) {
            hintLabel.textContent = 'Grafiek niet beschikbaar.';
        }
        return;
    }

    const data = {
        labels: forecast.labels,
        datasets: [
            {
                label: 'Baseline',
                data: forecast.baseline,
                borderColor: '#8aa29b',
                backgroundColor: 'rgba(138,162,155,.12)',
                tension: 0.35,
                fill: true
            },
            {
                label: 'Scenario',
                data: forecast.scenario,
                borderColor: '#2A9626',
                backgroundColor: 'rgba(42,150,38,.18)',
                tension: 0.35,
                fill: true
            }
        ]
    };

    if (!dashboardState.forecastChart) {
        const context = canvas.getContext('2d');
        if (!context) return;
        dashboardState.forecastChart = new Chart(context, {
            type: 'line',
            data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (tooltipItem) => {
                                const value = tooltipItem.parsed?.y ?? 0;
                                return `${tooltipItem.dataset.label}: ${formatCurrencyValue(value, 'EUR')}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: {
                        ticks: {
                            callback: (value) => formatCurrencyValue(value, 'EUR')
                        }
                    }
                }
            }
        });
    } else {
        dashboardState.forecastChart.data.labels = data.labels;
        dashboardState.forecastChart.data.datasets = data.datasets;
        dashboardState.forecastChart.update();
    }
}

function buildDashboardForecast() {
    const startBalance = parseEuroInput(dashboardState.liveBalanceEUR);
    const hasBalanceInput = Boolean(dashboardState.liveBalanceEUR && Number.isFinite(startBalance));
    const projection = buildCashflowProjection({
        months: 4,
        balanceEUR: hasBalanceInput ? startBalance : 0,
        scenarioEventRevenue: dashboardState.scenarioEventRevenue
    });
    if (!projection?.months?.length) return null;

    const baseline = projection.months.map((month) => month.baselineBalanceEUR);
    const scenario = projection.months.map((month) => month.scenarioBalanceEUR);

    return {
        labels: projection.months.map((month) => formatMonthLabel(month.monthISO)),
        baseline,
        scenario,
        endBaseline: baseline[baseline.length - 1] || 0,
        endScenario: scenario[scenario.length - 1] || 0,
        hasBalanceInput
    };
}

function formatMonthLabel(monthISO) {
    const parsed = new Date(`${monthISO}-01`);
    if (!Number.isFinite(parsed.getTime())) return monthISO;
    return parsed.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' });
}

function toMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function parseEuroInput(value) {
    if (value == null) return 0;
    const normalized = String(value).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : 0;
}

function getInventoryRiskSummary() {
    const voorraad = store.state.db?.voorraad || {};
    const busId = resolveBusId();
    const busKey = busId && voorraad && Object.prototype.hasOwnProperty.call(voorraad, busId)
        ? busId
        : Object.keys(voorraad)[0] || '';
    const bucket = busKey ? voorraad[busKey] || {} : {};
    const products = Array.isArray(store.state.db?.producten) ? store.state.db.producten : [];
    const productMap = new Map(products.map(product => [product.naam, product]));
    const defaultThreshold = 5;
    const risks = Object.entries(bucket)
        .map(([name, qty]) => {
            const product = productMap.get(name) || {};
            const threshold = Number(product.minimum ?? product.min ?? product.minVoorraad ?? defaultThreshold);
            return { label: name, qty: Number(qty) || 0, threshold };
        })
        .filter(item => Number.isFinite(item.threshold) && item.qty <= item.threshold);
    risks.sort((a, b) => a.qty - b.qty);
    return {
        busLabel: busKey ? `Bus: ${busKey}` : 'Voorraad',
        count: risks.length,
        items: risks.slice(0, 3).map(item => ({ label: item.label, qty: `${item.qty}` }))
    };
}

function getSalesMixSummary(event, range) {
    if (!event) return { items: [] };
    const snapshot = buildCheeseSalesSnapshot(event);
    if (!snapshot.ready) return { items: [] };
    const entries = [];
    let total = 0;
    const products = snapshot.products && Object.keys(snapshot.products).length
        ? snapshot.products
        : null;
    if (products) {
        Object.entries(products).forEach(([name, qty]) => {
            const value = clampCheeseValue(toSafeNumber(qty));
            if (!value) return;
            total += value;
            entries.push({ label: name, qty: value });
        });
    } else {
        Object.entries(snapshot.categories || {}).forEach(([name, qty]) => {
            const value = clampCheeseValue(toSafeNumber(qty));
            if (!value) return;
            total += value;
            entries.push({ label: name, qty: value });
        });
    }

    if (!total) return { items: [] };
    entries.sort((a, b) => b.qty - a.qty);
    return {
        items: entries.slice(0, 3).map((entry) => {
            const pct = Math.round((entry.qty / total) * 100);
            return {
                label: entry.label,
                pct,
                pctLabel: `${pct}%`
            };
        }),
        range
    };
}

function renderDashboardSummaryEmpty() {
    const activeDay = store.getActiveEventDay?.();
    const activeValue = activeDay?.eventName || 'Geen actieve dag';
    const activeMeta = activeDay
        ? escapeHtml(formatFullDate(activeDay.date) || '')
        : 'Kies een evenement om te starten';
    const activeCta = activeDay
        ? `<button type="button" class="dashboard-summary-card__cta" data-dashboard-nav="daginfo">Bekijk daginfo</button>`
        : `<button type="button" class="dashboard-summary-card__cta" data-dashboard-nav="events">Selecteer evenement</button>`;

    return `
        <section class="dashboard-summary">
            <div class="dashboard-summary-grid dashboard-summary-grid--compact">
                <article class="dashboard-summary-card dashboard-summary-card--accent">
                    <span class="dashboard-summary-card__label">Actieve dag</span>
                    <span class="dashboard-summary-card__value">${escapeHtml(activeValue)}</span>
                    <span class="dashboard-summary-card__meta">${escapeHtml(activeMeta)}</span>
                    ${activeCta}
                </article>
                <article class="dashboard-summary-card">
                    <span class="dashboard-summary-card__label">Belangrijkste actie</span>
                    <span class="dashboard-summary-card__value">Geen open taken</span>
                    <span class="dashboard-summary-card__meta">Pak je eerste stap op zodra een event actief is.</span>
                </article>
                <article class="dashboard-summary-card">
                    <span class="dashboard-summary-card__label">Netto resultaat</span>
                    <span class="dashboard-summary-card__value">€ 0,00</span>
                    <span class="dashboard-summary-card__meta">Registreer dagomzet om voortgang te zien.</span>
                </article>
            </div>
        </section>
    `;
}

function renderDashboardSummary(aggregate, currentCount, upcomingCount, tasks) {
    const activeDay = store.getActiveEventDay?.();
    const activeLabel = activeDay?.eventName || 'Geen actieve dag';
    const activeMeta = activeDay
        ? escapeHtml(formatFullDate(activeDay.date) || '')
        : 'Selecteer een evenement om te starten';
    const activeCta = activeDay
        ? `<button type="button" class="dashboard-summary-card__cta" data-dashboard-nav="daginfo">Open daginfo</button>`
        : `<button type="button" class="dashboard-summary-card__cta" data-dashboard-nav="events">Selecteer evenement</button>`;

    const netResultLabel = formatCurrencyValue(roundCurrency(aggregate.netResultEUR), 'EUR');
    const netClass = aggregate.netResultEUR >= 0
        ? 'dashboard-summary-card__value--positive'
        : 'dashboard-summary-card__value--negative';
    const netForMargin = Number.isFinite(aggregate.adjustedNetResultEUR)
        ? aggregate.adjustedNetResultEUR
        : aggregate.netResultEUR;
    const marginPct = aggregate.totalRevenueEUR
        ? Math.round((netForMargin / aggregate.totalRevenueEUR) * 100)
        : 0;

    const primaryTask = tasks[0];
    const hasTasks = Boolean(primaryTask);
    const primaryActionLabel = hasTasks ? escapeHtml(primaryTask.title) : 'Geen open taken';
    const primaryActionMeta = hasTasks
        ? escapeHtml(primaryTask.description || 'Pak deze stap eerst op')
        : 'Alles loopt op schema';
    let primaryActionCta = '';
    if (hasTasks && primaryTask.action?.label) {
        const attrs = [];
        if (primaryTask.action.type === 'nav') attrs.push(`data-dashboard-nav="${escapeHtml(primaryTask.action.value)}"`);
        if (primaryTask.action.type === 'event') attrs.push(`data-task-event="${escapeHtml(primaryTask.action.ref)}"`);
        const attrString = attrs.length ? ` ${attrs.join(' ')}` : '';
        primaryActionCta = `<button type="button" class="dashboard-summary-card__cta"${attrString}>${escapeHtml(primaryTask.action.label)}</button>`;
    }

    const timelineMeta = currentCount
        ? `${currentCount} actief • ${upcomingCount ? `${upcomingCount} starten binnen 7 dagen` : 'geen nieuwe binnen 7 dagen'}`
        : 'Koppel een evenement om te beginnen';

    return `
        <section class="dashboard-summary">
            <div class="dashboard-summary-grid dashboard-summary-grid--compact">
                <article class="dashboard-summary-card dashboard-summary-card--accent">
                    <span class="dashboard-summary-card__label">Actieve dag</span>
                    <span class="dashboard-summary-card__value">${escapeHtml(activeLabel)}</span>
                    <span class="dashboard-summary-card__meta">${activeMeta}</span>
                    ${activeCta}
                </article>
                <article class="dashboard-summary-card">
                    <span class="dashboard-summary-card__label">Belangrijkste actie</span>
                    <span class="dashboard-summary-card__value">${primaryActionLabel}</span>
                    <span class="dashboard-summary-card__meta">${primaryActionMeta}</span>
                    ${primaryActionCta}
                </article>
                <article class="dashboard-summary-card">
                    <span class="dashboard-summary-card__label">Netto resultaat</span>
                    <span class="dashboard-summary-card__value ${netClass}">${escapeHtml(netResultLabel)}</span>
                    <span class="dashboard-summary-card__meta">${escapeHtml(`Netto marge ${marginPct}% • ${timelineMeta}`)}</span>
                </article>
            </div>
        </section>
    `;
}

function renderDashboardActionEmpty() {
    return `
        <section class="dashboard-action-card">
            <header class="dashboard-card-head">
                <h2>Belangrijkste acties</h2>
            </header>
            <p class="dashboard-empty-note">Geen openstaande taken.</p>
        </section>
    `;
}

function renderDashboardActionCenter(tasks) {
    if (!Array.isArray(tasks) || !tasks.length) {
        return renderDashboardActionEmpty();
    }

    const topTasks = tasks.slice(0, 5);
    const items = topTasks.map(task => {
        const buttonTag = task.action ? 'button' : 'div';
        const attrs = [];
        if (task.action?.type === 'event') attrs.push(`data-task-event="${escapeHtml(task.action.ref)}"`);
        if (task.action?.type === 'nav') attrs.push(`data-task-nav="${escapeHtml(task.action.value)}"`);
        const typeAttr = buttonTag === 'button' ? 'type="button"' : '';
        const allAttrs = [typeAttr, ...attrs].filter(Boolean).join(' ');
        const actionLabel = task.action?.label ? `<span class="dashboard-task__cta">${escapeHtml(task.action.label)}</span>` : '';
        return `
            <li>
                <${buttonTag} ${allAttrs} class="dashboard-task dashboard-task--${escapeHtml(task.severity || 'medium')}">
                    <span class="dashboard-task__icon">${task.icon || '⚙️'}</span>
                    <div class="dashboard-task__content">
                        <span class="dashboard-task__title">${escapeHtml(task.title)}</span>
                        <span class="dashboard-task__meta">${escapeHtml(task.description)}</span>
                    </div>
                    ${actionLabel}
                </${buttonTag}>
            </li>
        `;
    }).join('');

    return `
        <section class="dashboard-action-card">
            <header class="dashboard-card-head">
                <h2>Belangrijkste acties</h2>
                <span class="dashboard-card-head__meta">${tasks.length} open</span>
            </header>
            <ul class="dashboard-task-list">${items}</ul>
        </section>
    `;
}

function bindDashboardActionEvents(actionMount) {
    actionMount.querySelectorAll('[data-task-event]').forEach(btn => {
        btn.addEventListener('click', () => openEventActionModal(btn.dataset.taskEvent));
        btn.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                openEventActionModal(btn.dataset.taskEvent);
            }
        });
    });
    actionMount.querySelectorAll('[data-task-nav]').forEach(btn => {
        btn.addEventListener('click', () => navigationActionHandler(btn.dataset.taskNav));
    });
    actionMount.querySelectorAll('[data-dashboard-nav]').forEach(btn => {
        btn.addEventListener('click', () => navigationActionHandler(btn.dataset.dashboardNav));
    });
}

function bindDashboardSummaryActions(summaryMount) {
    summaryMount.querySelectorAll('[data-dashboard-nav]').forEach(btn => {
        btn.addEventListener('click', () => navigationActionHandler(btn.dataset.dashboardNav));
    });
    summaryMount.querySelectorAll('[data-task-event]').forEach(btn => {
        btn.addEventListener('click', () => openEventActionModal(btn.dataset.taskEvent));
    });
}

function bindDashboardHighlightEvents(highlightsMount) {
    if (!highlightsMount) return;
    highlightsMount.querySelectorAll('[data-dashboard-action="openQuickSale"]').forEach((btn) => {
        btn.addEventListener('click', () => openQuickSaleModal());
    });
}

function renderDashboardEventDeck(mount, current, upcoming) {
    if (!Array.isArray(current) || !current.length) {
        if (!Array.isArray(upcoming) || !upcoming.length) {
            mount.innerHTML = `<div class="event-empty-card">Geen evenementen voor deze periode.</div>`;
            return;
        }
    }

    const sections = [];
    if (current.length) sections.push(renderDashboardEventSection('Huidige evenementen', current, 'current'));
    if (upcoming.length) sections.push(renderDashboardEventSection('Start binnen 7 dagen', upcoming, 'upcoming'));

    mount.innerHTML = `<div class="event-deck">${sections.join('')}</div>`;

    mount.querySelectorAll('.dashboard-event-card').forEach(card => {
        const ref = card.dataset.eventRef;
        card.addEventListener('click', () => openEventActionModal(ref));
        card.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                openEventActionModal(ref);
            }
        });
    });

    mount.querySelectorAll('[data-event-open]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            openEventActionModal(btn.dataset.eventOpen);
        });
    });
}

function openQuickCostForEvent(ref) {
    if (!ref) return;
    import('./9_eventdetails.js')
        .then((mod) => {
            if (typeof mod?.openEventDetail === 'function') {
                return mod.openEventDetail(ref, { initialTab: 'kosten', autoOpenCostModal: true });
            }
            showAlert('Kostenformulier kon niet worden geopend.', 'error');
            return null;
        })
        .catch((err) => {
            console.error('[Dashboard] Kosten openen mislukt', err);
            showAlert('Kostenformulier kon niet worden geopend.', 'error');
        });
}

const TASK_SEVERITY_WEIGHT = { critical: 0, high: 1, medium: 2, info: 3 };

function buildDashboardTasks(current, upcoming) {
    const tasks = [];
    const seen = new Set();
    const pushTask = (task) => {
        if (!task || !task.title) return;
        const key = task.key || `${task.severity || 'medium'}-${task.title}`;
        if (seen.has(key)) return;
        seen.add(key);
        tasks.push(task);
    };

    current.forEach(({ event, metrics, ref }) => {
        const name = event?.naam || 'Onbekend evenement';
        if (!hasEventStartTotals(event)) {
            pushTask({
                key: `start-${ref}`,
                severity: 'high',
                icon: '🧮',
                title: 'Voer starttelling in',
                description: `${name}: voorraad bij start ontbreekt`,
                action: { type: 'event', ref, label: 'Open event' }
            });
        }
        if (metrics?.missingTodayOmzet) {
            pushTask({
                key: `today-omzet-${ref}`,
                severity: 'critical',
                icon: '⚠️',
                title: 'Registreer dagomzet van vandaag',
                description: `${name}: nog geen omzet ingevoerd voor vandaag`,
                action: { type: 'event', ref, label: 'Open event' }
            });
        } else if (metrics?.missingOmzetDays > 0) {
            const missingLabel = metrics.missingOmzetDays === 1
                ? '1 dag ontbreekt'
                : `${metrics.missingOmzetDays} dagen ontbreken`;
            pushTask({
                key: `omzet-${ref}`,
                severity: 'high',
                icon: '💶',
                title: 'Werk dagomzet bij',
                description: `${name}: ${missingLabel}`,
                action: { type: 'event', ref, label: 'Open event' }
            });
        } else if (!metrics?.hasOmzetEntries) {
            pushTask({
                key: `first-omzet-${ref}`,
                severity: 'medium',
                icon: '🧾',
                title: 'Registreer eerste dagomzet',
                description: `${name}: nog geen omzet geregistreerd`,
                action: { type: 'event', ref, label: 'Open event' }
            });
        }

        if (!hasEventPlanning(event)) {
            pushTask({
                key: `planning-${ref}`,
                severity: 'medium',
                icon: '📦',
                title: 'Maak voorraadplanning',
                description: `${name}: stel doelstelling op`,
                action: { type: 'event', ref, label: 'Open event' }
            });
        }
    });

    upcoming.forEach(({ event, daysUntilStart, ref }) => {
        if (daysUntilStart != null && daysUntilStart <= 3) {
            const name = event?.naam || 'Onbekend evenement';
            const timing = daysUntilStart <= 0
                ? 'Start vandaag'
                : daysUntilStart === 1
                    ? 'Start morgen'
                    : `Start over ${daysUntilStart} dagen`;
            pushTask({
                key: `upcoming-${ref}`,
                severity: 'info',
                icon: '🎪',
                title: timing,
                description: `${name}: controleer reis & voorraad`,
                action: { type: 'event', ref, label: 'Open event' }
            });
        }
    });

    tasks.sort((a, b) => {
        const aWeight = TASK_SEVERITY_WEIGHT[a.severity] ?? 99;
        const bWeight = TASK_SEVERITY_WEIGHT[b.severity] ?? 99;
        if (aWeight !== bWeight) return aWeight - bWeight;
        return a.title.localeCompare(b.title);
    });

    return tasks;
}

function renderDashboardHighlights(current, upcoming, aggregate) {
    const cards = [];

    const activeDay = store.getActiveEventDay?.();
    const activeEvent = activeDay ? resolveActiveEventRecord() : null;
    const topProduct = computeDashboardTopProduct(current);
    if (topProduct) {
        cards.push(`
            <article class="dashboard-highlight-card">
                <span class="dashboard-highlight-card__icon">🧀</span>
                <h3>Best verkopende product</h3>
                <p class="dashboard-highlight-card__value">${escapeHtml(topProduct.name)}</p>
                <p class="dashboard-highlight-card__meta">${escapeHtml(formatCheeseAmount(topProduct.quantity))} verkocht</p>
            </article>
        `);
    }

    if (aggregate.count) {
        const netForMargin = Number.isFinite(aggregate.adjustedNetResultEUR)
            ? aggregate.adjustedNetResultEUR
            : aggregate.netResultEUR;
        const marginPct = aggregate.totalRevenueEUR
            ? Math.round((netForMargin / aggregate.totalRevenueEUR) * 100)
            : 0;
        cards.push(`
            <article class="dashboard-highlight-card">
                <span class="dashboard-highlight-card__icon">📈</span>
                <h3>Gemiddelde marge</h3>
                <p class="dashboard-highlight-card__value">${escapeHtml(`${marginPct}%`)}</p>
                <p class="dashboard-highlight-card__meta">Netto resultaat incl. kaaskosten ${escapeHtml(formatCurrencyValue(roundCurrency(netForMargin), 'EUR'))}</p>
            </article>
        `);
    }

    if (upcoming.length) {
        const nextEvent = upcoming[0];
        const event = nextEvent.event;
        const name = event?.naam || 'Volgende evenement';
        const startLabel = formatFullDate(getEventStartDate(event));
        const location = event?.locatie ? ` • ${event.locatie}` : '';
        cards.push(`
            <article class="dashboard-highlight-card">
                <span class="dashboard-highlight-card__icon">🗺️</span>
                <h3>Volgende event</h3>
                <p class="dashboard-highlight-card__value">${escapeHtml(name)}</p>
                <p class="dashboard-highlight-card__meta">${escapeHtml(`${startLabel || ''}${location}`.trim())}</p>
            </article>
        `);
    }

    if (!cards.length) {
        return '';
    }

    return `
        <section class="dashboard-highlights">
            <header class="dashboard-card-head">
                <h2>Highlights</h2>
            </header>
            <div class="dashboard-highlight-grid">${cards.join('')}</div>
        </section>
    `;
}

function computeDashboardTopProduct(entries) {
    const totals = new Map();
    entries.forEach(({ metrics }) => {
        const products = metrics?.cheeseSnapshot?.products || {};
        Object.entries(products).forEach(([name, qty]) => {
            const amount = clampCheeseValue(toSafeNumber(qty));
            if (!amount) return;
            const key = name || 'Onbekend product';
            totals.set(key, (totals.get(key) || 0) + amount);
        });
    });
    let bestName = null;
    let bestQty = 0;
    totals.forEach((qty, name) => {
        if (qty > bestQty) {
            bestQty = qty;
            bestName = name;
        }
    });
    if (!bestName) return null;
    return { name: bestName, quantity: bestQty };
}

async function renderReisPlannerWidget() {
    const mount = document.getElementById('reisPlannerMount');
    if (!mount) return;

    try {
        const module = await import('./14_reisPlanning.js');
        if (typeof module?.renderReisPlannerPage === 'function') {
            module.renderReisPlannerPage(mount);
        }
    } catch (err) {
        console.warn('[POS] Reisplanner widget render mislukt:', err);
        mount.innerHTML = `
            <section class="panel-card">
                <h3>Reisplanner</h3>
                <p class="muted">Planner is tijdelijk niet beschikbaar.</p>
            </section>
        `;
    }
}

function renderDashboardEventSection(title, list, status) {
    if (!Array.isArray(list) || !list.length) return '';
    const body = list.map(item => {
        const ev = item?.event || item;
        const metrics = item?.metrics || null;
        return renderDashboardEventCard(ev, status, metrics);
    }).join('');
    return `
        <section class="event-section">
            <header class="event-section-head">
                <h2>${escapeHtml(title)}</h2>
            </header>
            <div class="event-card-list">${body}</div>
        </section>
    `;
}

function aggregateCurrentEventFinancials(list) {
    const entries = Array.isArray(list) ? list : [];
    const totals = {
        cheeseUnits: 0,
        cheeseRevenueEUR: 0,
        cheeseRevenueUSD: 0,
        cheeseCostEUR: 0,
        cheeseCostIndicativeEUR: 0,
        pendingCheeseCostEUR: 0,
        souvenirRevenueEUR: 0,
        souvenirRevenueUSD: 0,
        totalRevenueEUR: 0,
        totalRevenueUSD: 0,
        netResultEUR: 0,
        debtorTotalsEUR: { DIRECT: 0, DEBTOR: 0 },
        count: 0
    };

    entries.forEach((item) => {
        const event = item?.event || item;
        if (!event) return;
        const metrics = item?.metrics || computeEventFinancials(event);
        const cheeseCostEUR = toSafeNumber(metrics.cheeseCostEUR);
        const cheeseCostIndicativeEUR = toSafeNumber(metrics.cheeseCostIndicativeEUR);
        const effectiveCheeseCostEUR = cheeseCostEUR || cheeseCostIndicativeEUR;
        const pendingCheeseCostEUR = metrics.cheeseMetricsReady ? 0 : Math.max(0, effectiveCheeseCostEUR - cheeseCostEUR);

        totals.cheeseUnits += toSafeNumber(metrics.cheeseUnits);
        totals.cheeseRevenueEUR += toSafeNumber(metrics.cheeseRevenueEUR);
        totals.cheeseRevenueUSD += toSafeNumber(metrics.cheeseRevenueUSD);
        totals.cheeseCostEUR += cheeseCostEUR;
        totals.cheeseCostIndicativeEUR += cheeseCostIndicativeEUR;
        totals.pendingCheeseCostEUR += pendingCheeseCostEUR;
        totals.souvenirRevenueEUR += toSafeNumber(metrics.souvenirRevenueEUR);
        totals.souvenirRevenueUSD += toSafeNumber(metrics.souvenirRevenueUSD);
        totals.totalRevenueEUR += toSafeNumber(metrics.totalRevenueEUR);
        totals.totalRevenueUSD += toSafeNumber(metrics.totalRevenueUSD);
        totals.netResultEUR += toSafeNumber(metrics.netResultEUR);
        totals.debtorTotalsEUR.DIRECT += toSafeNumber(metrics?.debtorTotalsEUR?.DIRECT);
        totals.debtorTotalsEUR.DEBTOR += toSafeNumber(metrics?.debtorTotalsEUR?.DEBTOR);
        totals.count += 1;
    });

    const debtorTotal = totals.debtorTotalsEUR.DIRECT + totals.debtorTotalsEUR.DEBTOR;
    const debtorPercentages = {
        DIRECT: debtorTotal ? (totals.debtorTotalsEUR.DIRECT / debtorTotal) * 100 : 0,
        DEBTOR: debtorTotal ? (totals.debtorTotalsEUR.DEBTOR / debtorTotal) * 100 : 0
    };

    const adjustedNetResultEUR = roundCurrency(totals.netResultEUR - totals.pendingCheeseCostEUR);

    return { ...totals, debtorPercentages, adjustedNetResultEUR };
}

function renderCurrentEventsSummary(aggregate) {
    if (!aggregate || !aggregate.count) return '';
    const countLabel = aggregate.count === 1
        ? '1 huidig event'
        : `${aggregate.count} huidige events`;

    const cheeseUnitsLabel = formatCheeseUnits(aggregate.cheeseUnits);
    const cheeseRevenueLabel = formatCurrencyPair(aggregate.cheeseRevenueEUR, aggregate.cheeseRevenueUSD);
    const souvenirRevenueLabel = formatCurrencyPair(aggregate.souvenirRevenueEUR, aggregate.souvenirRevenueUSD);
    const cheeseCostLabel = formatCurrencyValue(roundCurrency(aggregate.cheeseCostEUR), 'EUR');
    const totalRevenueLabel = formatCurrencyPair(aggregate.totalRevenueEUR, aggregate.totalRevenueUSD);
    const netResultLabel = formatCurrencyValue(roundCurrency(aggregate.netResultEUR), 'EUR');
    const profitClass = aggregate.netResultEUR >= 0
        ? 'dashboard-event-card__metric-value--positive'
        : 'dashboard-event-card__metric-value--negative';
    const debtorPct = Math.round(aggregate.debtorPercentages.DEBTOR || 0);
    const directPct = Math.round(aggregate.debtorPercentages.DIRECT || 0);

    return `
        <section class="event-section event-summary-section">
            <header class="event-section-head event-summary-section__head">
                <h2>Samenvatting huidige evenementen</h2>
                <span class="event-summary-section__count">${escapeHtml(countLabel)}</span>
            </header>
            <div class="event-summary-grid">
                <article class="event-summary-card">
                    <div class="dashboard-event-card__metrics event-summary-card__metrics">
                        <div class="dashboard-event-card__metric">
                            <span class="dashboard-event-card__metric-label">Kaas verkocht</span>
                            <span class="dashboard-event-card__metric-value">${escapeHtml(cheeseUnitsLabel)}</span>
                        </div>
                        <div class="dashboard-event-card__metric">
                            <span class="dashboard-event-card__metric-label">Kaasomzet</span>
                            <span class="dashboard-event-card__metric-value">${escapeHtml(cheeseRevenueLabel)}</span>
                        </div>
                        <div class="dashboard-event-card__metric">
                            <span class="dashboard-event-card__metric-label">Souvenir-omzet</span>
                            <span class="dashboard-event-card__metric-value">${escapeHtml(souvenirRevenueLabel)}</span>
                        </div>
                        <div class="dashboard-event-card__metric">
                            <span class="dashboard-event-card__metric-label">Kostprijs kaas</span>
                            <span class="dashboard-event-card__metric-value">${escapeHtml(cheeseCostLabel)}</span>
                        </div>
                        <div class="dashboard-event-card__metric">
                            <span class="dashboard-event-card__metric-label">Totale omzet</span>
                            <span class="dashboard-event-card__metric-value">${escapeHtml(totalRevenueLabel)}</span>
                        </div>
                        <div class="dashboard-event-card__metric">
                            <span class="dashboard-event-card__metric-label">Netto resultaat</span>
                            <span class="dashboard-event-card__metric-value ${profitClass}">${escapeHtml(netResultLabel)}</span>
                        </div>
                        <div class="dashboard-event-card__metric">
                            <span class="dashboard-event-card__metric-label">Debiteur / Direct</span>
                            <span class="dashboard-event-card__metric-value">${escapeHtml(`${debtorPct}% / ${directPct}%`)}</span>
                        </div>
                    </div>
                </article>
            </div>
        </section>
    `;
}

function renderDashboardEventCard(ev, status, metricsOverride = null) {
    if (!ev) return '';
    const eventRef = String(ev?.id || ev?.naam || '').trim();
    if (!eventRef) return '';

    const badgeClass = status === 'current' ? 'badge-active' : 'badge-planned';
    const badgeLabel = status === 'current' ? 'Huidig' : 'Binnen 7 dagen';
    const metrics = metricsOverride || computeEventFinancials(ev);
    const totalRevenueLabel = formatCurrencyPair(metrics.totalRevenueEUR, metrics.totalRevenueUSD);
    const netResultLabel = formatCurrencyValue(metrics.netResultEUR, 'EUR');
    const profitClass = metrics.netResultEUR >= 0
        ? 'dashboard-event-card__metric-value--positive'
        : 'dashboard-event-card__metric-value--negative';

    const location = ev?.locatie ? `<span>${escapeHtml(ev.locatie)}</span>` : '';
    const period = formatEventPeriod(ev);
    const metaParts = [location, period ? `<span>${escapeHtml(period)}</span>` : ''].filter(Boolean);
    const metaHtml = metaParts.length
        ? `<div class="dashboard-event-card__meta">${metaParts.join(' • ')}</div>`
        : '';

    const notes = [];
    const statusNote = getEventDashboardNote(ev, status, metrics);
    if (statusNote) notes.push(escapeHtml(statusNote));
    if (!metrics.hasOmzetEntries) notes.push('Nog geen dagomzet geregistreerd');
    const noteHtml = notes.length
        ? `<p class="dashboard-event-card__note">${notes.join(' • ')}</p>`
        : '';

    const title = escapeHtml(ev?.naam || 'Onbekend evenement');
    const ariaLabel = `Acties voor ${title}`;

    const actionCta = `<button type="button" class="dashboard-event-card__cta" data-event-open="${escapeHtml(eventRef)}">Open dag</button>`;

    return `
        <article class="event-card dashboard-event-card" data-event-ref="${escapeHtml(eventRef)}" data-status="${escapeHtml(status)}" role="button" tabindex="0" aria-label="${escapeHtml(ariaLabel)}">
            <header class="dashboard-event-card__head">
                <div class="dashboard-event-card__title">
                    <h3>${title}</h3>
                    ${metaHtml}
                </div>
                <span class="event-card-badge ${badgeClass}">${badgeLabel}</span>
            </header>
            <div class="dashboard-event-card__metrics">
                <div class="dashboard-event-card__metric">
                    <span class="dashboard-event-card__metric-label">Totale omzet</span>
                    <span class="dashboard-event-card__metric-value">${escapeHtml(totalRevenueLabel)}</span>
                </div>
                <div class="dashboard-event-card__metric">
                    <span class="dashboard-event-card__metric-label">Netto resultaat</span>
                    <span class="dashboard-event-card__metric-value ${profitClass}">${escapeHtml(netResultLabel)}</span>
                </div>
            </div>
            ${noteHtml}
            <footer class="dashboard-event-card__foot">
                <span>Tap voor acties</span>
                ${actionCta}
            </footer>
        </article>
    `;
}

function getEventDashboardNote(ev, status, metrics = null) {
    const alerts = [];
    if (status === 'current' && !hasEventStartTotals(ev)) {
        alerts.push('Starttelling ontbreekt');
    }
    if (status === 'current' && metrics) {
        if (metrics.missingTodayOmzet) {
            alerts.push('Dagomzet ontbreekt voor vandaag');
        } else if (metrics.missingOmzetDays > 0) {
            alerts.push(`${metrics.missingOmzetDays} dagomzetregistratie(s) ontbreekt`);
        }
    }
    if (!hasEventPlanning(ev)) {
        alerts.push('Geen voorraadplanning');
    }
    if (alerts.length) {
        return alerts.join(' • ');
    }

    const start = getEventStartDate(ev);
    const end = getEventEndDate(ev);
    const today = startOfLocalDay(new Date()).getTime();

    if (status === 'upcoming' && start) {
        const startDate = startOfLocalDay(parseLocalYMD(start));
        if (startDate) {
            const diffDays = Math.max(0, Math.ceil((startDate.getTime() - today) / MS_PER_DAY));
            if (diffDays === 0) return 'Begint vandaag';
            if (diffDays === 1) return 'Begint morgen';
            return `Begint over ${diffDays} dagen`;
        }
    }

    if (status === 'current' && end) {
        const endDate = startOfLocalDay(parseLocalYMD(end));
        if (endDate) {
            const diffDays = Math.max(0, Math.ceil((endDate.getTime() - today) / MS_PER_DAY));
            if (diffDays === 0) return 'Eindigt vandaag';
            if (diffDays === 1) return 'Eindigt morgen';
            return `Eindigt over ${diffDays} dagen`;
        }
    }

    return formatEventPeriod(ev) || '';
}

function hasEventStartTotals(ev) {
    const start = ev?.kaasTelling?.start;
    if (!start) return false;
    const totals = toCheeseTotals(start);
    return Object.values(totals).some(value => Number.isFinite(value) && value > 0);
}

function hasEventPlanning(ev) {
    const planning = ev?.planning;
    if (!planning || typeof planning !== 'object') return false;
    const cheeseTotals = toCheeseTotals(planning.cheeseEstimate);
    const hasCheese = Object.values(cheeseTotals).some(value => Number.isFinite(value) && value > 0);
    const turnoverCandidates = [
        planning?.expectedTurnover?.usd,
        planning?.expectedTurnover?.eur,
        planning?.expectedTurnoverUSD,
        planning?.expectedTurnoverEUR,
        planning?.turnoverEstimate,
        planning?.expectedRevenue
    ];
    const hasTurnover = turnoverCandidates.some(value => toSafeNumber(value) > 0);
    return hasCheese || hasTurnover;
}

function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function formatCurrencyValue(amount, currency = 'EUR') {
    const safeCurrency = typeof currency === 'string' && currency.trim()
        ? currency.trim().toUpperCase()
        : 'EUR';
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    try {
        return new Intl.NumberFormat('nl-NL', {
            style: 'currency',
            currency: safeCurrency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(safeAmount);
    } catch {
        return `${safeCurrency} ${safeAmount.toFixed(2)}`;
    }
}

function formatCurrencyPair(eurValue, usdValue) {
    const parts = [];
    if (Number.isFinite(eurValue) && Math.abs(eurValue) > 0.009) {
        parts.push(formatCurrencyValue(roundCurrency(eurValue), 'EUR'));
    }
    if (Number.isFinite(usdValue) && Math.abs(usdValue) > 0.009) {
        parts.push(formatCurrencyValue(roundCurrency(usdValue), 'USD'));
    }
    if (!parts.length) return formatCurrencyValue(0, 'EUR');
    return parts.join(' / ');
}

function formatCheeseUnits(units) {
    const amount = clampCheeseValue(toSafeNumber(units));
    return `${amount} stuks`;
}

function computeEventFinancials(ev) {
    const cheeseSnapshot = buildCheeseSalesSnapshot(ev);
    const cheeseReady = cheeseSnapshot.ready === true;
    const cheeseStats = cheeseReady
        ? calculateCheeseFinancials(cheeseSnapshot)
        : {
            revenueEUR: 0,
            revenueUSD: 0,
            costEUR: 0,
            typeTotals: { BG: 0, ROOK: 0, GEIT: 0 }
        };
    const omzetStats = calculateOmzetTotals(ev, 'EUR', null);
    const totalRevenueEUR = roundCurrency(omzetStats.revenueEUR);
    const totalRevenueUSD = roundCurrency(omzetStats.revenueUSD);
    const cheeseRevenueEUR = roundCurrency(cheeseStats.revenueEUR);
    const cheeseRevenueUSD = roundCurrency(cheeseStats.revenueUSD);
    const souvenirRevenueEUR = roundCurrency(Math.max(0, totalRevenueEUR - (cheeseReady ? cheeseRevenueEUR : 0)));
    const souvenirRevenueUSD = roundCurrency(Math.max(0, totalRevenueUSD - (cheeseReady ? cheeseRevenueUSD : 0)));

    const commissionPct = Math.max(0, toSafeNumber(ev?.commissie));
    const commissionEUR = roundCurrency((commissionPct / 100) * totalRevenueEUR);
    const expectedInvoiceEUR = roundCurrency(Math.max(0, totalRevenueEUR - commissionEUR));
    const stageldEUR = roundCurrency(toSafeNumber(ev?.stageld));
    const extraCostsEUR = roundCurrency(sumEventExtraCosts(ev));

    const purchaseSummary = sumEventPurchaseInvoices(ev);
    const cheeseCostIndicativeEUR = cheeseReady ? roundCurrency(cheeseStats.costEUR) : 0;
    const cheeseCostEUR = cheeseReady
        ? (purchaseSummary.hasInvoices ? purchaseSummary.totalEUR : cheeseCostIndicativeEUR)
        : 0;
    const totalCostsEUR = roundCurrency(cheeseCostEUR + commissionEUR + stageldEUR + extraCostsEUR);
    const netResultEUR = cheeseReady ? roundCurrency(totalRevenueEUR - totalCostsEUR) : roundCurrency(totalRevenueEUR - (commissionEUR + stageldEUR + extraCostsEUR));

    const coverage = computeOmzetCoverage(ev);
    const invoiceInfo = extractEventInvoiceInfo(ev);
    const finalInvoiceEUR = Number.isFinite(invoiceInfo.finalEUR) ? roundCurrency(invoiceInfo.finalEUR) : null;
    const finalInvoiceUSD = Number.isFinite(invoiceInfo.finalUSD) ? roundCurrency(invoiceInfo.finalUSD) : null;

    if (cheeseReady) {
        syncCheeseSalesFinancials(ev, cheeseSnapshot, cheeseStats, {
            totalRevenueEUR,
            totalRevenueUSD,
            souvenirRevenueEUR,
            souvenirRevenueUSD,
            cheeseCostEUR,
            netResultEUR,
            commissionEUR,
            stageldEUR,
            extraCostsEUR
        });
    }

    const invoiceDifferenceEUR = finalInvoiceEUR == null ? null : roundCurrency(finalInvoiceEUR - expectedInvoiceEUR);

    return {
        currency: 'EUR',
        turnover: totalRevenueEUR,
        costs: totalCostsEUR,
        profit: netResultEUR,
        hasTurnover: totalRevenueEUR > 0 || totalRevenueUSD > 0,
        cheeseUnits: cheeseSnapshot.total,
        cheeseRevenueEUR,
        cheeseRevenueUSD,
        cheeseCostEUR,
        cheeseCostIndicativeEUR,
        cheeseCostSource: cheeseReady
            ? (purchaseSummary.hasInvoices ? 'invoice' : 'indicative')
            : 'pending',
        purchaseInvoiceEUR: purchaseSummary.totalEUR,
        totalRevenueEUR,
        totalRevenueUSD,
        souvenirRevenueEUR,
        souvenirRevenueUSD,
        commissionEUR,
        stageldEUR,
        extraCostsEUR,
        netResultEUR,
        debtorTotalsEUR: coverage.debtorTotalsEUR,
        debtorPercentages: coverage.debtorPercentages,
        omzetEntriesCount: coverage.entryCount,
        expectedOmzetDays: coverage.expectedDays,
        missingOmzetDays: coverage.missingDays,
        missingOmzetDates: coverage.missingDates,
        missingTodayOmzet: coverage.missingToday,
        hasStartTelling: hasEventStartTotals(ev),
        hasOmzetEntries: coverage.entryCount > 0,
        cheeseMetricsReady: cheeseReady,
        invoice: {
            isDebtor: invoiceInfo.isDebtor,
            expectedEUR: expectedInvoiceEUR,
            finalEUR: finalInvoiceEUR,
            finalUSD: finalInvoiceUSD,
            differenceEUR: invoiceDifferenceEUR,
            invoiceNumber: invoiceInfo.invoiceNumber,
            checkedAt: invoiceInfo.checkedAt,
            note: invoiceInfo.note,
            status: invoiceInfo.status
        },
        cheeseSnapshot,
        cheeseTypeTotals: cheeseStats.typeTotals
    };
}

function sumEventPurchaseInvoices(ev) {
    const entries = Array.isArray(store.state?.db?.accounting?.entries)
        ? store.state.db.accounting.entries
        : [];
    const eventId = resolveEventLedgerId(ev);
    if (!eventId || !entries.length) {
        return { totalEUR: 0, hasInvoices: false };
    }
    let total = 0;
    let hasInvoices = false;
    entries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        if (!entry.meta || entry.meta.source !== 'purchase-invoice') return;
        if (!entry.meta.eventId) return;
        if (String(entry.meta.eventId) !== String(eventId)) return;
        const currency = (entry.currency || 'EUR').toString().toUpperCase();
        if (currency !== 'EUR') return;
        const numericAmount = Number(entry.amount);
        if (!Number.isFinite(numericAmount)) return;
        const direction = (entry.direction || 'CREDIT').toString().toUpperCase();
        const signed = direction === 'CREDIT' ? numericAmount : -numericAmount;
        if (!Number.isFinite(signed)) return;
        total += signed;
        hasInvoices = true;
    });
    return { totalEUR: roundCurrency(total), hasInvoices };
}

function resolveEventLedgerId(ev) {
    if (!ev || typeof ev !== 'object') return '';
    const candidates = [ev.id, ev.uuid, ev.slug, ev.naam];
    for (const candidate of candidates) {
        if (candidate == null) continue;
        const value = String(candidate).trim();
        if (value) return value;
    }
    return '';
}

function extractEventInvoiceInfo(ev) {
    const data = ev?.facturatie || ev?.invoice || ev?.factuur || {};
    const finalEUR = toSafeNumber(data?.definitief?.eur ?? data?.finalEUR ?? data?.finalAmountEUR ?? data?.factuurBedragEUR);
    const finalUSD = toSafeNumber(data?.definitief?.usd ?? data?.finalUSD ?? data?.finalAmountUSD ?? data?.factuurBedragUSD);
    const invoiceNumber = (data?.factuurNummer || data?.invoiceNumber || '').toString().trim();
    const checkedAt = (data?.gecontroleerdOp || data?.checkedAt || data?.laatsteControle || '').toString();
    const note = (data?.opmerking || data?.note || '').toString();
    const statusRaw = (data?.status || '').toString().trim().toUpperCase();
    let status = 'DRAFT';
    if (['PAID', 'OPEN', 'PENDING'].includes(statusRaw)) {
        status = statusRaw;
    } else if (finalEUR) {
        status = 'PENDING';
    }
    const isDebtor = normalizeEventDebtorFlag(ev, data);
    return { isDebtor, finalEUR, finalUSD, invoiceNumber, checkedAt, note, status };
}

function normalizeEventDebtorFlag(ev, data) {
    const candidates = [
        data?.debiteur,
        data?.debtor,
        data?.isDebtor,
        ev?.debiteur,
        ev?.debtor,
        ev?.isDebtor
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'boolean') return candidate;
        if (typeof candidate === 'string') {
            const clean = candidate.trim().toLowerCase();
            if (!clean) continue;
            if (['1', 'true', 'ja', 'j', 'yes', 'debiteur', 'debtor', 'invoice', 'factuur'].includes(clean)) return true;
            if (['0', 'false', 'nee', 'n', 'no'].includes(clean)) return false;
        }
    }
    return false;
}

function syncCheeseSalesFinancials(event, snapshot, cheeseStats, totals) {
    if (!event || typeof event !== 'object') return;
    const telling = event.kaasTelling;
    if (!telling || typeof telling !== 'object') return;

    const existingSales = telling.sales && typeof telling.sales === 'object' ? telling.sales : null;
    const hadSales = Boolean(existingSales);
    const sales = hadSales ? existingSales : {};

    const categoriesResult = syncCheeseCategories(sales.categories, snapshot.categories);
    const productsResult = syncCheeseProducts(sales.products, snapshot.products);
    const categories = categoriesResult.data;
    const products = productsResult.data;
    const totalChanged = assignIfDifferent(sales, 'total', clampCheeseValue(toSafeNumber(snapshot.total)));

    let metaChanged = false;
    if (snapshot.source && (!sales.source || typeof sales.source !== 'object' || !cheeseSourceEquals(sales.source, snapshot.source))) {
        sales.source = cloneSalesSource(snapshot.source);
        metaChanged = true;
    }
    if (snapshot.calculatedAt && sales.calculatedAt !== snapshot.calculatedAt) {
        sales.calculatedAt = snapshot.calculatedAt;
        metaChanged = true;
    }

    const revenueChanged = applyCheeseFinancialMetrics(sales, cheeseStats, totals);

    const anyChanged = (!hadSales) || categoriesResult.changed || productsResult.changed || totalChanged || revenueChanged || metaChanged;

    if (anyChanged) {
        sales.metricsUpdatedAt = new Date().toISOString();
    }

    sales.categories = categories;
    sales.products = products;

    telling.sales = sales;
}

function syncCheeseCategories(current, nextSource) {
    const source = nextSource && typeof nextSource === 'object' ? nextSource : { BG: 0, ROOK: 0, GEIT: 0 };
    const target = current && typeof current === 'object' ? current : { BG: 0, ROOK: 0, GEIT: 0 };
    let changed = false;
    ['BG', 'ROOK', 'GEIT'].forEach((key) => {
        const value = clampCheeseValue(toSafeNumber(source[key]));
        if (!Number.isFinite(target[key]) || target[key] !== value) {
            target[key] = value;
            changed = true;
        }
    });
    Object.keys(target).forEach((key) => {
        if (!['BG', 'ROOK', 'GEIT'].includes(key)) {
            delete target[key];
            changed = true;
        }
    });
    return { data: target, changed };
}

function syncCheeseProducts(current, nextSource) {
    const source = nextSource && typeof nextSource === 'object' ? nextSource : {};
    const target = current && typeof current === 'object' ? current : {};
    let changed = false;
    const allowed = new Set(Object.keys(source));
    Object.keys(target).forEach((name) => {
        if (!allowed.has(name)) {
            delete target[name];
            changed = true;
        }
    });
    Object.entries(source).forEach(([name, qty]) => {
        const amount = clampCheeseValue(toSafeNumber(qty));
        if (!amount) {
            if (target[name]) {
                delete target[name];
                changed = true;
            }
            return;
        }
        if (target[name] !== amount) {
            target[name] = amount;
            changed = true;
        }
    });
    return { data: target, changed };
}

function applyCheeseFinancialMetrics(record, cheeseStats, totals) {
    let changed = false;
    changed = assignIfDifferent(record, 'cheeseRevenueEUR', cheeseStats.revenueEUR) || changed;
    changed = assignIfDifferent(record, 'cheeseRevenueUSD', cheeseStats.revenueUSD) || changed;
    changed = assignIfDifferent(record, 'cheeseCostEUR', totals.cheeseCostEUR) || changed;
    changed = assignIfDifferent(record, 'souvenirRevenueEUR', totals.souvenirRevenueEUR) || changed;
    changed = assignIfDifferent(record, 'souvenirRevenueUSD', totals.souvenirRevenueUSD) || changed;
    changed = assignIfDifferent(record, 'totalRevenueEUR', totals.totalRevenueEUR) || changed;
    changed = assignIfDifferent(record, 'totalRevenueUSD', totals.totalRevenueUSD) || changed;

    if (!record.metrics || typeof record.metrics !== 'object') {
        record.metrics = {};
    }
    const metrics = record.metrics;
    changed = assignIfDifferent(metrics, 'netResultEUR', totals.netResultEUR) || changed;
    changed = assignIfDifferent(metrics, 'commissionEUR', totals.commissionEUR) || changed;
    changed = assignIfDifferent(metrics, 'stageldEUR', totals.stageldEUR) || changed;
    changed = assignIfDifferent(metrics, 'extraCostsEUR', totals.extraCostsEUR) || changed;

    return changed;
}

function cheeseSourceEquals(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    const parts = ['start', 'supplements', 'end'];
    for (const key of parts) {
        const partA = a[key];
        const partB = b[key];
        if (!partA && !partB) continue;
        if (!partA || !partB) return false;
        const totalsA = toCheeseTotals(partA);
        const totalsB = toCheeseTotals(partB);
        if (totalsA.BG !== totalsB.BG || totalsA.ROOK !== totalsB.ROOK || totalsA.GEIT !== totalsB.GEIT) {
            return false;
        }
        if ((partA.timestamp || null) !== (partB.timestamp || null)) {
            return false;
        }
    }
    return true;
}

function assignIfDifferent(target, key, value) {
    if (!target || typeof target !== 'object') return false;
    if (value == null) {
        if (key in target) {
            delete target[key];
            return true;
        }
        return false;
    }
    if (!Object.is(target[key], value)) {
        target[key] = value;
        return true;
    }
    return false;
}

function buildCheeseSalesSnapshot(event) {
    const telling = event?.kaasTelling || {};
    const storedSales = telling.sales && typeof telling.sales === 'object' ? telling.sales : null;
    const supplements = normalizeSupplements(telling.supplements);
    const supplementTotals = sumCheeseEntries(supplements);
    const hasSupplements = Object.values(supplementTotals).some(value => Number.isFinite(value) && value > 0);
    const storedComplete = isCheeseSalesRecordComplete(storedSales);
    const hasStart = hasCheeseMeasurement(telling.start) || hasCheeseMeasurement(storedSales?.source?.start);
    const hasEnd = hasCheeseMeasurement(telling.end) || hasCheeseMeasurement(storedSales?.source?.end);
    const ready = storedComplete || (hasEnd && (hasStart || hasSupplements));

    if (!ready) {
        return {
            total: 0,
            categories: { BG: 0, ROOK: 0, GEIT: 0 },
            products: {},
            ready: false,
            source: storedSales?.source ? cloneSalesSource(storedSales.source) : null,
            calculatedAt: storedSales?.calculatedAt || null
        };
    }

    const computed = computeEventSalesSnapshot(event, telling.end || {}, storedSales?.products || {});
    const normalizedTotal = clampCheeseValue(toSafeNumber(computed.total));

    if (!storedComplete) {
        return {
            ...computed,
            total: normalizedTotal,
            ready: true
        };
    }

    const storedCategories = toCheeseTotals(storedSales.categories || storedSales);
    const storedProducts = sanitizeProductSalesMap(storedSales.products);
    let storedTotal = clampCheeseValue(toSafeNumber(storedSales.total));
    if (!storedTotal) {
        const sumCategories = storedCategories.BG + storedCategories.ROOK + storedCategories.GEIT;
        const sumProducts = Object.values(storedProducts).reduce((sum, value) => sum + value, 0);
        storedTotal = clampCheeseValue(sumProducts || sumCategories);
    }

    const sourcesMatch = cheeseSourceEquals(storedSales.source, computed.source);
    if (!sourcesMatch) {
        return {
            ...computed,
            total: normalizedTotal,
            ready: true
        };
    }

    return {
        total: storedTotal || normalizedTotal,
        categories: storedCategories,
        products: Object.keys(storedProducts).length ? storedProducts : computed.products,
        ready: true,
        source: storedSales.source ? cloneSalesSource(storedSales.source) : computed.source || null,
        calculatedAt: storedSales.calculatedAt || computed.calculatedAt || null
    };
}

function hasCheeseMeasurement(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const totals = toCheeseTotals(entry);
    if (Object.values(totals).some(value => Number.isFinite(value) && value > 0)) {
        return true;
    }
    return Boolean(entry.timestamp);
}

function isCheeseSalesRecordComplete(record) {
    if (!record || typeof record !== 'object') return false;
    const source = record.source;
    if (!source || typeof source !== 'object') return false;
    return hasCheeseMeasurement(source.start) && hasCheeseMeasurement(source.end);
}

function calculateCheeseFinancials(snapshot) {
    const catalog = getCheeseProductCatalog();
    const averages = getCheeseTypeAverages(catalog);
    const typeTotals = { BG: 0, ROOK: 0, GEIT: 0 };
    let revenueEUR = 0;
    let revenueUSD = 0;
    let costEUR = 0;

    Object.entries(snapshot.products || {}).forEach(([rawName, qty]) => {
        const amount = clampCheeseValue(toSafeNumber(qty));
        if (!amount) return;
        const product = resolveCheeseProduct(catalog, rawName) || resolveCheeseProduct(catalog, String(rawName));
        const type = normalizeCheeseType(product?.type) || inferCheeseTypeFromName(rawName);
        if (!type) return;
        const priceEUR = toSafeNumber(product?.eur ?? product?.prijs_eur ?? averages[type].eur);
        const priceUSD = toSafeNumber(product?.usd ?? product?.prijs_usd ?? averages[type].usd);
        const purchaseEUR = toSafeNumber(product?.inkoop ?? averages[type].inkoop);
        revenueEUR += priceEUR * amount;
        revenueUSD += priceUSD * amount;
        costEUR += purchaseEUR * amount;
        typeTotals[type] += amount;
    });

    const fallbackTotals = snapshot.categories || { BG: 0, ROOK: 0, GEIT: 0 };
    ['BG', 'ROOK', 'GEIT'].forEach((type) => {
        const missing = clampCheeseValue(fallbackTotals[type] - typeTotals[type]);
        if (missing > 0) {
            revenueEUR += averages[type].eur * missing;
            revenueUSD += averages[type].usd * missing;
            costEUR += averages[type].inkoop * missing;
            typeTotals[type] += missing;
        }
    });

    return {
        revenueEUR: roundCurrency(revenueEUR),
        revenueUSD: roundCurrency(revenueUSD),
        costEUR: roundCurrency(costEUR),
        typeTotals
    };
}

function getCheeseTypeAverages(catalog) {
    const buckets = {
        BG: { eur: 0, usd: 0, inkoop: 0, count: 0 },
        ROOK: { eur: 0, usd: 0, inkoop: 0, count: 0 },
        GEIT: { eur: 0, usd: 0, inkoop: 0, count: 0 }
    };
    catalog.forEach((product) => {
        const type = normalizeCheeseType(product?.type);
        if (!type || !buckets[type]) return;
        buckets[type].eur += toSafeNumber(product?.eur ?? product?.prijs_eur);
        buckets[type].usd += toSafeNumber(product?.usd ?? product?.prijs_usd);
        buckets[type].inkoop += toSafeNumber(product?.inkoop);
        buckets[type].count += 1;
    });
    return Object.fromEntries(Object.entries(buckets).map(([type, data]) => {
        const count = data.count || 1;
        return [type, {
            eur: data.eur / count,
            usd: data.usd / count,
            inkoop: data.inkoop / count
        }];
    }));
}

function normalizeCheeseType(type) {
    if (!type) return null;
    const value = String(type).toUpperCase();
    if (value === 'BG' || value === 'ROOK' || value === 'GEIT') return value;
    return null;
}

function inferCheeseTypeFromName(name) {
    if (!name) return null;
    const upper = String(name).toUpperCase();
    if (upper.startsWith('BG')) return 'BG';
    if (upper.startsWith('ROOK')) return 'ROOK';
    if (upper.startsWith('GEIT')) return 'GEIT';
    return null;
}

function computeOmzetCoverage(ev) {
    const entries = collectOmzetEntries(ev);
    const dates = new Set();
    const debtorTotalsEUR = { DIRECT: 0, DEBTOR: 0 };

    entries.forEach((entry) => {
        const ymd = normalizeOmzetEntryDate(entry);
        if (ymd) dates.add(ymd);
        const isDebtor = resolveEntryDebtorFlag(entry);
        const key = isDebtor ? 'DEBTOR' : 'DIRECT';
        const eur = toSafeNumber(entry?.eur ?? entry?.prijs_eur);
        if (eur) {
            debtorTotalsEUR[key] += eur;
        } else {
            const usd = toSafeNumber(entry?.usd ?? entry?.prijs_usd);
            const rate = toSafeNumber(entry?.exchangeRate || ev?.exchangeRate || ev?.omzet?.exchangeRate);
            if (usd && rate) {
                debtorTotalsEUR[key] += usd * rate;
            }
        }
    });

    const today = startOfLocalDay(new Date());
    const todayYMD = toYMDString(today);

    let rangeStart = parseLocalYMD(getEventStartDate(ev));
    let rangeEnd = parseLocalYMD(getEventEndDate(ev));
    rangeStart = rangeStart ? startOfLocalDay(rangeStart) : null;
    rangeEnd = rangeEnd ? startOfLocalDay(rangeEnd) : null;
    if (rangeStart && rangeEnd && rangeEnd < rangeStart) {
        const tmp = rangeStart;
        rangeStart = rangeEnd;
        rangeEnd = tmp;
    }

    if (!rangeStart && dates.size) {
        const first = Array.from(dates).sort()[0];
        const parsed = parseLocalYMD(first);
        if (parsed) rangeStart = startOfLocalDay(parsed);
    }
    if (!rangeStart) rangeStart = startOfLocalDay(today);

    if (!rangeEnd) {
        if (isEventActive(ev)) {
            rangeEnd = startOfLocalDay(today);
        } else if (dates.size) {
            const last = Array.from(dates).sort().pop();
            const parsed = parseLocalYMD(last);
            if (parsed) rangeEnd = startOfLocalDay(parsed);
        }
        if (!rangeEnd) rangeEnd = startOfLocalDay(today);
    }
    if (rangeEnd < rangeStart) rangeEnd = rangeStart;

    let expectedDays = 0;
    const missingDates = [];
    if (rangeStart && rangeEnd) {
        let cursor = new Date(rangeStart);
        const limit = new Date(rangeEnd);
        while (cursor <= limit) {
            const ymd = toYMDString(cursor);
            expectedDays += 1;
            if (!dates.has(ymd)) missingDates.push(ymd);
            cursor = addDays(cursor, 1);
        }
    }

    const totalDebtor = debtorTotalsEUR.DEBTOR + debtorTotalsEUR.DIRECT;
    const debtorPercentages = {
        DEBTOR: totalDebtor ? (debtorTotalsEUR.DEBTOR / totalDebtor) * 100 : 0,
        DIRECT: totalDebtor ? (debtorTotalsEUR.DIRECT / totalDebtor) * 100 : 0
    };

    const startYMD = toYMDString(rangeStart);
    const endYMD = toYMDString(rangeEnd);
    const missingToday = todayYMD >= startYMD && todayYMD <= endYMD ? missingDates.includes(todayYMD) : false;

    return {
        entryCount: entries.length,
        expectedDays,
        missingDays: missingDates.length,
        missingDates,
        missingToday,
        debtorTotalsEUR,
        debtorPercentages
    };
}

function resolveEntryDebtorFlag(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (typeof entry.debtor === 'boolean') return entry.debtor;
    if (typeof entry.isDebtor === 'boolean') return entry.isDebtor;
    if (typeof entry.debiteur === 'boolean') return entry.debiteur;
    const rawString = entry.debtor ?? entry.isDebtor ?? entry.debiteur;
    if (typeof rawString === 'string') {
        const clean = rawString.trim().toLowerCase();
        if (['1', 'true', 'ja', 'j', 'yes', 'debiteur', 'debtor', 'invoice', 'factuur'].includes(clean)) return true;
        if (['0', 'false', 'nee', 'n', 'no'].includes(clean)) return false;
    }
    const method = String(entry.paymentMethod || entry.pm || '').toUpperCase();
    return method === 'DEBTOR' || method === 'DEBITEUR' || method === 'INVOICE' || method === 'FACTUUR';
}

function determineEventCurrency(ev) {
    const currencyCandidates = [
        ev?.omzet?.currency,
        ev?.currency,
        ev?.defaultCurrency,
        ev?.valuta,
        ev?.meta?.currency
    ];
    let currency = 'EUR';
    for (const value of currencyCandidates) {
        if (typeof value === 'string' && value.trim()) {
            currency = value.trim().toUpperCase();
            break;
        }
    }

    const rateCandidates = [
        ev?.omzet?.exchangeRate,
        ev?.exchangeRateEURperUSD,
        ev?.exchangeRate,
        ev?.meta?.exchangeRate
    ];
    let exchangeRate = null;
    for (const value of rateCandidates) {
        const num = Number(value);
        if (Number.isFinite(num) && num > 0) {
            exchangeRate = num;
            break;
        }
    }

    if (currency !== 'USD' && currency !== 'EUR') {
        currency = 'EUR';
    }

    return { currency, exchangeRate };
}

function collectOmzetEntries(ev) {
    if (Array.isArray(ev?.omzet)) return ev.omzet;
    if (Array.isArray(ev?.omzet?.entries)) return ev.omzet.entries;
    return [];
}

function calculateOmzetTotals(ev, targetCurrency, exchangeRate) {
    const entries = collectOmzetEntries(ev);
    let revenueTarget = 0;
    let revenueEUR = 0;
    let revenueUSD = 0;

    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const eur = entry.eur != null ? toSafeNumber(entry.eur) : toSafeNumber(entry.prijs_eur);
        const usd = entry.usd != null ? toSafeNumber(entry.usd) : toSafeNumber(entry.prijs_usd);
        if (eur) revenueEUR += eur;
        if (usd) revenueUSD += usd;
        revenueTarget += convertMoney(eur, usd, targetCurrency, exchangeRate);
    }

    const aggregateEUR = toSafeNumber(
        ev?.omzet?.eur ?? ev?.omzet?.totalEUR ?? ev?.omzet?.amountEUR ?? ev?.omzetEUR ?? ev?.omzet_eur
    );
    const aggregateUSD = toSafeNumber(
        ev?.omzet?.usd ?? ev?.omzet?.totalUSD ?? ev?.omzet?.amountUSD ?? ev?.omzetUSD ?? ev?.omzet_usd
    );

    if (aggregateEUR) {
        revenueEUR = Math.max(revenueEUR, aggregateEUR);
        revenueTarget = Math.max(revenueTarget, convertMoney(aggregateEUR, null, targetCurrency, exchangeRate));
    }
    if (aggregateUSD) {
        revenueUSD = Math.max(revenueUSD, aggregateUSD);
        revenueTarget = Math.max(revenueTarget, convertMoney(null, aggregateUSD, targetCurrency, exchangeRate));
    }

    const hasTurnover = revenueTarget > 0 || revenueEUR > 0 || revenueUSD > 0;
    return {
        revenueTarget: roundCurrency(revenueTarget),
        revenueEUR: roundCurrency(revenueEUR),
        revenueUSD: roundCurrency(revenueUSD),
        hasTurnover
    };
}

function convertMoney(eurValue, usdValue, targetCurrency, rate) {
    const safeRate = Number.isFinite(rate) && rate > 0 ? rate : null;
    if (targetCurrency === 'USD') {
        if (usdValue != null && Number.isFinite(usdValue)) return usdValue;
        if (eurValue != null && Number.isFinite(eurValue) && safeRate) return eurValue / safeRate;
        return eurValue != null ? eurValue : 0;
    }
    // default EUR
    if (eurValue != null && Number.isFinite(eurValue)) return eurValue;
    if (usdValue != null && Number.isFinite(usdValue) && safeRate) return usdValue * safeRate;
    return usdValue != null ? usdValue : 0;
}

function roundCurrency(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * 100) / 100;
}

function sumEventExtraCosts(ev) {
    if (!ev) return 0;
    let total = 0;
    const add = (val) => {
        const num = toSafeNumber(val);
        if (num) total += num;
    };

    if (Array.isArray(ev.extraKosten)) {
        ev.extraKosten.forEach(entry => add(entry?.bedrag ?? entry?.amount));
    }

    if (Array.isArray(ev?.kosten)) {
        ev.kosten.forEach(entry => add(entry?.bedrag ?? entry?.amount));
    } else if (ev?.kosten && typeof ev.kosten === 'object') {
        const extraList = Array.isArray(ev.kosten.extra) ? ev.kosten.extra : [];
        extraList.forEach(entry => add(entry?.bedrag ?? entry?.amount));
        Object.entries(ev.kosten).forEach(([key, value]) => {
            if (key === 'extra') return;
            if (Array.isArray(value)) {
                value.forEach(item => add(item?.bedrag ?? item?.amount ?? item));
            } else {
                add(value);
            }
        });
    }

    ['dieselKosten', 'slapenKosten', 'etenKosten', 'overigKosten'].forEach(key => add(ev?.[key]));

    return total;
}

function buildDashboardActiveDaySnapshot(event, dateOverride = null) {
    if (!event) return null;
    const start = getEventStartDate(event);
    const end = getEventEndDate(event) || start;
    const today = toYMDString(new Date());
    let date = dateOverride || today;
    if (start && today < start) {
        date = start;
    } else if (end && today > end) {
        date = end;
    } else if (start) {
        date = start;
    }

    const range = {
        start: start || date,
        end: end || start || date
    };

    const { currency, exchangeRate } = determineEventCurrency(event);

    return {
        eventId: event?.id ?? event?.uuid ?? event?.slug ?? event?.naam ?? null,
        eventName: event?.naam ?? '',
        date,
        range,
        currency,
        exchangeRate,
        meta: {
            locatie: event?.locatie ?? '',
            type: event?.type ?? '',
            state: String(event?.state || '')
        }
    };
}

function setActiveDayFromEvent(event, dateOverride = null) {
    const snapshot = buildDashboardActiveDaySnapshot(event, dateOverride);
    if (!snapshot) return;
    try {
        store.setActiveEventDay?.(snapshot);
    } catch (err) {
        console.warn('[POS] Active day bijwerken mislukt', err);
    }
}

function openEventDetails(eventId) {
    if (!eventId) return;
    import('./9_eventdetails.js')
        .then((mod) => mod?.openEventDetail?.(eventId))
        .catch((err) => {
            console.error('[Dashboard] Eventdetails openen mislukt', err);
            showAlert('Eventdetails konden niet worden geopend.', 'error');
        });
}

function openEventInsights(eventId) {
    const event = findEventByRef(eventId);
    if (event) setActiveDayFromEvent(event);
    navigationActionHandler('inzichten');
}

export function openDagomzetModal(eventId, dateISO) {
    const event = findEventByRef(eventId);
    if (event) setActiveDayFromEvent(event, dateISO);
    navigationActionHandler('dagomzet');
}

export function openKostenModal(eventId) {
    if (!eventId) return;
    import('./9_eventdetails.js')
        .then((mod) => mod?.openEventDetail?.(eventId, { initialTab: 'kosten', autoOpenCostModal: true }))
        .catch((err) => {
            console.error('[Dashboard] Kosten openen mislukt', err);
            showAlert('Kostenformulier kon niet worden geopend.', 'error');
        });
}

function openDebiteurenScreen() {
    navigationActionHandler('accounting');
}

function openCrediteurenScreen() {
    navigationActionHandler('accounting');
}

function openPlanningForecastScreen() {
    navigationActionHandler('reis');
}

function openVoorraadBeheer() {
    navigationActionHandler('voorraad');
}

function openEventSalesMixDetails(eventId) {
    const event = findEventByRef(eventId);
    if (event) setActiveDayFromEvent(event);
    navigationActionHandler('inzichten');
}

function openEventActionModal(ref) {
    const event = findEventByRef(ref);
    if (!event) {
        showAlert('Evenement niet gevonden.', 'error');
        return;
    }

    const metrics = computeEventFinancials(event);
    const cheeseUnitsLabel = formatCheeseUnits(metrics.cheeseUnits);
    const cheeseRevenueLabel = formatCurrencyPair(metrics.cheeseRevenueEUR, metrics.cheeseRevenueUSD);
    const souvenirRevenueLabel = formatCurrencyPair(metrics.souvenirRevenueEUR, metrics.souvenirRevenueUSD);
    const cheeseCostLabel = formatCurrencyValue(metrics.cheeseCostEUR, 'EUR');
    const totalRevenueLabel = formatCurrencyPair(metrics.totalRevenueEUR, metrics.totalRevenueUSD);
    const netResultLabel = formatCurrencyValue(metrics.netResultEUR, 'EUR');
    const profitClass = metrics.netResultEUR >= 0 ? 'positive' : 'negative';
    let omzetWarning = '';
    if (metrics.missingTodayOmzet) {
        omzetWarning = 'Dagomzet voor vandaag ontbreekt.';
    } else if (metrics.missingOmzetDays > 0) {
        omzetWarning = `${metrics.missingOmzetDays} dagomzetregistratie(s) ontbreken.`;
    } else if (!metrics.hasOmzetEntries) {
        omzetWarning = 'Nog geen dagomzet geregistreerd.';
    }

    const { box, close } = createModal();
    box.classList.add('event-action-modal');

    const period = formatEventPeriod(event);
    const location = event?.locatie ? `📍 ${event.locatie}` : '';
    const headerMeta = [location, period ? `📅 ${period}` : ''].filter(Boolean).join(' • ');

    const hasStart = Boolean(event?.kaasTelling?.start);
    const hasValidId = Boolean(event?.id);
    const eventRef = event?.id || event?.naam || '';
    const canStart = hasValidId && !hasStart;
    const canSupplement = hasValidId && hasStart;
    const canClose = hasValidId && hasStart;
    const startDisabledReason = canStart
        ? ''
        : !hasValidId
            ? 'Event mist ID'
            : hasStart
                ? 'Starttelling al geregistreerd'
                : '';
    const supplementDisabledReason = canSupplement
        ? ''
        : !hasValidId
            ? 'Event mist ID'
            : !hasStart
                ? 'Starttelling ontbreekt'
                : '';
    const closeDisabledReason = canClose
        ? ''
        : !hasValidId
            ? 'Event mist ID'
            : !hasStart
                ? 'Starttelling ontbreekt'
                : '';

    box.innerHTML = `
        <button class="modal-close" aria-label="Sluiten">✕</button>
        <header class="event-action-modal__head">
            <h2>${escapeHtml(event?.naam || 'Onbekend evenement')}</h2>
            ${headerMeta ? `<p>${escapeHtml(headerMeta)}</p>` : ''}
        </header>
        <div class="event-action-modal__metrics">
            <div>
                <span class="label">Kaas verkocht</span>
                <strong>${escapeHtml(cheeseUnitsLabel)}</strong>
            </div>
            <div>
                <span class="label">Kaasomzet</span>
                <strong>${escapeHtml(cheeseRevenueLabel)}</strong>
            </div>
            <div>
                <span class="label">Souvenir-omzet</span>
                <strong>${escapeHtml(souvenirRevenueLabel)}</strong>
            </div>
            <div>
                <span class="label">Kostprijs kaas</span>
                <strong>${escapeHtml(cheeseCostLabel)}</strong>
            </div>
            <div>
                <span class="label">Totale omzet</span>
                <strong>${escapeHtml(totalRevenueLabel)}</strong>
            </div>
            <div>
                <span class="label">Netto resultaat</span>
                <strong class="${profitClass}">${escapeHtml(netResultLabel)}</strong>
            </div>
        </div>
        ${omzetWarning ? `<p class="event-action-modal__warning">⚠️ ${escapeHtml(omzetWarning)}</p>` : ''}
        <div class="event-action-modal__actions">
            <button class="primary" data-action="start" ${canStart ? '' : `disabled title="${escapeHtml(startDisabledReason)}"`}>
                <span class="event-action-modal__main">🚀 Start event</span>
                <span class="event-action-modal__sub">Starttelling invullen</span>
                ${!canStart && startDisabledReason ? `<span class="event-action-modal__hint">${escapeHtml(startDisabledReason)}</span>` : ''}
            </button>
            <button data-action="supplement" ${canSupplement ? '' : `disabled title="${escapeHtml(supplementDisabledReason)}"`}>
                <span class="event-action-modal__main">➕ Voeg voorraad toe</span>
                <span class="event-action-modal__sub">Aanvulling registreren</span>
                ${!canSupplement && supplementDisabledReason ? `<span class="event-action-modal__hint">${escapeHtml(supplementDisabledReason)}</span>` : ''}
            </button>
            <button data-action="view">
                <span class="event-action-modal__main">👁️ Bekijk event</span>
                <span class="event-action-modal__sub">Details & rapportage</span>
            </button>
            <button data-action="dagomzet">
                <span class="event-action-modal__main">📈 Dagomzet</span>
                <span class="event-action-modal__sub">Registreren of bekijken</span>
            </button>
            <button class="danger" data-action="close" ${canClose ? '' : `disabled title="${escapeHtml(closeDisabledReason)}"`}>
                <span class="event-action-modal__main">🛑 Afsluiten</span>
                <span class="event-action-modal__sub">Eindtelling opslaan</span>
                ${!canClose && closeDisabledReason ? `<span class="event-action-modal__hint">${escapeHtml(closeDisabledReason)}</span>` : ''}
            </button>
        </div>
    `;

    const actionRef = String(eventRef);

    box.querySelector('.modal-close')?.addEventListener('click', close);

    box.querySelectorAll('.event-action-modal__actions button[data-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (btn.disabled) return;
            const action = btn.dataset.action;
            close();
            setTimeout(async () => {
                try {
                    switch (action) {
                        case 'start':
                            openStartEventModal(actionRef);
                            break;
                        case 'supplement':
                            openSupplementModal(actionRef);
                            break;
                        case 'view': {
                            const mod = await import('./9_eventdetails.js');
                            await mod?.openEventDetail?.(actionRef);
                            break;
                        }
                        case 'dagomzet':
                            setActiveDayFromEvent(event);
                            navigationActionHandler('dagomzet');
                            break;
                        case 'close':
                            openCloseEventModal(actionRef);
                            break;
                    }
                } catch (err) {
                    console.error('[POS] Eventactie mislukt', err);
                    showAlert('Actie kon niet worden geopend.', 'error');
                }
            }, 60);
        });
    });
}

function renderSupplementBlock(list) {
    if (!Array.isArray(list) || !list.length) return '';
    const aggregate = list.reduce((acc, entry) => {
        const totals = toCheeseTotals(entry);
        acc.BG += totals.BG;
        acc.ROOK += totals.ROOK;
        acc.GEIT += totals.GEIT;
        return acc;
    }, { BG: 0, ROOK: 0, GEIT: 0 });

    return `
        <div class="cheese-block supplement-block">
            <div class="cheese-block-title">
                Aanvullingen
                <span>${escapeHtml(`${list.length}×`)}</span>
            </div>
            <div class="cheese-grid">
                ${renderCheesePill('BG', aggregate.BG)}
                ${renderCheesePill('ROOK', aggregate.ROOK)}
                ${renderCheesePill('GEIT', aggregate.GEIT)}
            </div>
            <ul class="supplement-list">${renderSupplementListItems(list)}</ul>
        </div>
    `;
}

function renderSupplementHistory(list) {
    if (!Array.isArray(list) || !list.length) return '';
    return `
        <div class="supplement-history">
            <h3>Eerdere aanvullingen</h3>
            <ul class="supplement-list">${renderSupplementListItems(list)}</ul>
        </div>
    `;
}

function renderSupplementListItems(list) {
    return list.map((entry, index) => {
        const totals = toCheeseTotals(entry);
        const stamp = formatDateTime(entry?.timestamp);
        return `
            <li>
                <div class="supplement-list-head">
                    <strong>Aanvulling ${escapeHtml(String(index + 1))}</strong>
                    ${stamp ? `<span>${escapeHtml(stamp)}</span>` : ''}
                </div>
                <div class="supplement-list-values">
                    <span>BG <b>${escapeHtml(totals.BG.toLocaleString('nl-NL'))}</b></span>
                    <span>ROOK <b>${escapeHtml(totals.ROOK.toLocaleString('nl-NL'))}</b></span>
                    <span>GEIT <b>${escapeHtml(totals.GEIT.toLocaleString('nl-NL'))}</b></span>
                </div>
            </li>
        `;
    }).join('');
}

function openStartEventModal(ref) {
    openEventCheeseCountModal(ref, 'start');
}

function openCloseEventModal(ref) {
    openEventCheeseCountModal(ref, 'end');
}

function openEventCheeseCountModal(ref, mode) {
    const event = findEventByRef(ref);
    if (!event) {
        showAlert('Evenement niet gevonden.', 'error');
        return;
    }
    if (!event.id) {
        showAlert('Evenement mist een ID en kan niet worden opgeslagen.', 'error');
        return;
    }

    const telling = event.kaasTelling || {};
    const hasStart = Boolean(telling.start);
    if (mode === 'start' && hasStart) {
        showAlert('De starttelling is al opgeslagen. Gebruik "Aanvulling toevoegen" voor extra voorraad.', 'warning');
        return;
    }
    if (mode === 'end' && !hasStart) {
        showAlert('Starttelling ontbreekt. Vul eerst de starttelling in.', 'warning');
        return;
    }

    const startTotals = toCheeseTotals(telling.start);
    const startSnapshot = sanitizeProductSnapshot(telling.startProducts);
    const busSnapshot = sanitizeProductSnapshot(getBusCheeseProductSnapshot(event?.bus));

    let planHasValues = false;
    let planSnapshot = {};
    let planTotals = { BG: 0, ROOK: 0, GEIT: 0 };
    let planTimestamp = '';
    let planTurnoverParts = [];
    if (mode === 'start') {
        const planning = event?.planning || null;
        planTotals = toCheeseTotals(planning?.cheeseEstimate);
        planHasValues = Object.values(planTotals).some(val => Number(val) > 0);
        planTimestamp = planning?.calculatedAt ? formatDateTime(planning.calculatedAt) : '';
        planTurnoverParts = [];
        if (planning?.expectedTurnover?.usd) planTurnoverParts.push(formatCurrency(toSafeNumber(planning.expectedTurnover.usd), 'USD'));
        if (planning?.expectedTurnover?.eur) planTurnoverParts.push(formatCurrency(toSafeNumber(planning.expectedTurnover.eur), 'EUR'));
        planSnapshot = planHasValues ? distributeCheeseTotalsToProducts(planTotals) : {};
    }

    const endTotals = toCheeseTotals(telling.end);
    const storedEndSnapshot = sanitizeProductSnapshot(telling.endProducts);
    const computedEndSnapshot = computeEventEndProductSnapshot(event, telling.end, telling.endProducts);

    let defaultSnapshot = {};
    let sourceLabel = 'de starttelling';
    if (mode === 'start') {
        const storedSnapshot = sanitizeProductSnapshot(telling.startProducts);
        if (Object.keys(storedSnapshot).length) {
            defaultSnapshot = storedSnapshot;
            sourceLabel = 'de eerder opgeslagen starttelling';
        } else if (hasStart) {
            if (Object.keys(busSnapshot).length) {
                defaultSnapshot = rebalanceSnapshotToTotals(busSnapshot, startTotals);
            } else {
                defaultSnapshot = distributeCheeseTotalsToProducts(startTotals);
            }
            sourceLabel = 'de eerder opgeslagen starttelling';
        } else if (Object.keys(busSnapshot).length) {
            defaultSnapshot = busSnapshot;
            sourceLabel = 'de actuele busvoorraad';
        } else if (planHasValues) {
            defaultSnapshot = planSnapshot;
            sourceLabel = 'de geplande voorraad';
        } else {
            defaultSnapshot = {};
            sourceLabel = 'een lege telling (vul handmatig in)';
        }
    } else {
        const hasEndValues = Object.values(endTotals).some(val => Number(val) > 0);
        if (Object.keys(storedEndSnapshot).length) {
            defaultSnapshot = storedEndSnapshot;
            sourceLabel = 'de laatst opgeslagen eindtelling';
        } else if (hasEndValues && Object.keys(computedEndSnapshot).length) {
            defaultSnapshot = computedEndSnapshot;
            sourceLabel = 'de laatst opgeslagen eindtelling';
        } else if (Object.keys(startSnapshot).length) {
            defaultSnapshot = startSnapshot;
            sourceLabel = 'de starttelling';
        } else if (Object.keys(busSnapshot).length) {
            defaultSnapshot = busSnapshot;
            sourceLabel = 'de busvoorraad';
        } else if (Object.values(startTotals).some(val => Number(val) > 0)) {
            defaultSnapshot = distributeCheeseTotalsToProducts(startTotals);
            sourceLabel = 'de starttelling';
        } else {
            defaultSnapshot = {};
            sourceLabel = 'een lege telling (vul handmatig in)';
        }
    }

    const cheeseProducts = getCheeseProductList();

    const { box, close } = createModal();
    box.classList.add('event-modal');
    ensureStartProductStyles();
    const heading = mode === 'start' ? 'Starttelling' : 'Eindtelling';
    const submitClass = mode === 'start' ? 'primary' : 'danger';
    const submitLabel = mode === 'start' ? 'Opslaan' : 'Afronden';
    const busyLabel = mode === 'start' ? 'Opslaan…' : 'Afronden…';
    const startTotalsNote = hasStart
        ? `<p class="event-modal-note">Starttelling: BG ${escapeHtml(String(startTotals.BG))}, ROOK ${escapeHtml(String(startTotals.ROOK))}, GEIT ${escapeHtml(String(startTotals.GEIT))}</p>`
        : '';

    box.innerHTML = `
        <button class="modal-close" aria-label="Sluiten">✕</button>
        <h2>${heading} — ${escapeHtml(event?.naam || '')}</h2>
        <p class="event-modal-sub">Bus: ${escapeHtml(event?.bus || 'Onbekend')}</p>
        ${mode === 'end' ? startTotalsNote : ''}
        <form class="event-count-form" data-event-id="${escapeHtml(String(event.id))}" data-mode="products">
            <div class="event-product-grid">
                ${cheeseProducts.length ? renderStartProductSections(cheeseProducts, defaultSnapshot) : '<p class="event-modal-note">Geen kaasproducten gevonden in de catalogus.</p>'}
            </div>
            <div class="event-product-summary" data-role="summary">
                <div><span>BG</span><strong data-summary-type="BG">0</strong></div>
                <div><span>ROOK</span><strong data-summary-type="ROOK">0</strong></div>
                <div><span>GEIT</span><strong data-summary-type="GEIT">0</strong></div>
                <div class="total"><span>Totaal</span><strong data-summary-type="TOTAL">0</strong></div>
            </div>
            <div class="event-count-actions">
                <button type="button" class="event-card-btn ghost" data-role="cancel">Annuleren</button>
                ${mode === 'start' && planHasValues ? '<button type="button" class="event-card-btn secondary" data-role="apply-plan">Gebruik planning</button>' : ''}
                <button type="submit" class="event-card-btn ${submitClass}">${submitLabel}</button>
            </div>
        </form>
        <p class="event-modal-note">Vooringevuld met ${escapeHtml(sourceLabel)}.</p>
        ${mode === 'start' && planHasValues
            ? `<p class="event-modal-note">Planning: BG ${escapeHtml(planTotals.BG.toLocaleString('nl-NL'))}, ROOK ${escapeHtml(planTotals.ROOK.toLocaleString('nl-NL'))}, GEIT ${escapeHtml(planTotals.GEIT.toLocaleString('nl-NL'))}${planTurnoverParts.length ? ` — ${escapeHtml(planTurnoverParts.join(' • '))}` : ''}${planTimestamp ? ` (${escapeHtml(planTimestamp)})` : ''}.</p>`
            : ''}
    `;

    box.querySelector('.modal-close')?.addEventListener('click', close);
    box.querySelector('[data-role="cancel"]')?.addEventListener('click', close);

    const form = box.querySelector('.event-count-form');
    if (form && cheeseProducts.length) {
        form.querySelectorAll('.cheese-product-row').forEach(row => {
            updateCheeseProductRow(row);
        });
        updateCheeseProductSummary(form);
        form.querySelectorAll('[data-action="cheese-step"]')?.forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                handleCheeseStepperClick(btn);
            });
        });
        form.addEventListener('input', (ev) => {
            if (!(ev.target instanceof HTMLInputElement)) return;
            if (!ev.target.closest('.cheese-product-row')) return;
            const row = ev.target.closest('.cheese-product-row');
            if (row) {
                updateCheeseProductRow(row);
                updateCheeseProductSummary(form);
            }
        });
    }

    if (mode === 'start' && planHasValues) {
        form?.querySelector('[data-role="apply-plan"]')?.addEventListener('click', () => {
            applyCheeseSnapshotToForm(form, planSnapshot);
        });
    }

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cheeseData = collectCheeseProductData(form);
        const values = cheeseData.categories;
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = busyLabel;
        }
        try {
            event.kaasTelling = { ...(event.kaasTelling || {}) };
            if (mode === 'start') {
                event.kaasTelling.start = { ...values, timestamp: new Date().toISOString() };
                event.kaasTelling.startProducts = sanitizeProductSnapshot(cheeseData.products);
                delete event.kaasTelling.end;
                delete event.kaasTelling.sales;
                delete event.kaasTelling.endProducts;
                event.state = 'active';
                event.afgerond = false;
                const { saveEvent } = await import('./3_data.js');
                const ok = await saveEvent(event.id);
                if (ok === false) throw new Error('save-failed');
                showAlert('Starttelling opgeslagen.', 'success');
                close();
                renderEventCards();
                store.emit?.('events:updated', { eventId: event.id, action: 'start' });
            } else {
                const previousSales = event.kaasTelling?.sales
                    ? {
                        categories: toCheeseTotals(event.kaasTelling.sales),
                        products: cloneProductTotals(event.kaasTelling.sales.products),
                        total: toSafeNumber(event.kaasTelling.sales.total)
                    }
                    : null;
                const productSales = computeEventProductSales(event, values);
                const salesRecord = computeEventSalesSnapshot(event, values, productSales);
                const endTimestamp = new Date().toISOString();
                event.kaasTelling.end = { ...values, timestamp: endTimestamp };
                event.kaasTelling.endProducts = sanitizeProductSnapshot(cheeseData.products);
                if (salesRecord?.source?.end) {
                    salesRecord.source.end.timestamp = endTimestamp;
                }
                event.kaasTelling.sales = salesRecord;
                event.state = 'completed';
                event.afgerond = true;
                const { saveEvent } = await import('./3_data.js');
                const ok = await saveEvent(event.id);
                if (ok === false) throw new Error('save-failed');

                await updateGlobalCheeseMix(event.id, salesRecord, previousSales);

                await synchronizeEventEndStock(event, values, cheeseData.products);

                showAlert('Eindtelling opgeslagen en evenement afgesloten.', 'success');
                close();
                renderEventCards();
                store.emit?.('events:updated', { eventId: event.id, action: 'close' });
            }
        } catch (err) {
            const context = mode === 'start' ? 'Starttelling' : 'Eindtelling';
            console.error(`[POS] ${context} opslaan mislukt`, err);
            showAlert(`Opslaan van ${mode === 'start' ? 'starttelling' : 'eindtelling'} mislukt.`, 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = submitLabel;
            }
        }
    });
}

function openSupplementModal(ref) {
    const event = findEventByRef(ref);
    if (!event) {
        showAlert('Evenement niet gevonden.', 'error');
        return;
    }
    if (!event.id) {
        showAlert('Evenement mist een ID en kan niet worden opgeslagen.', 'error');
        return;
    }
    if (!event?.kaasTelling?.start) {
        showAlert('Vul eerst de starttelling in voordat je kunt aanvullen.', 'warning');
        return;
    }

    const supplements = normalizeSupplements(event?.kaasTelling?.supplements);
    const cheeseProducts = getCheeseProductList();
    const lastSupplement = supplements.length ? supplements[supplements.length - 1] : null;
    const defaultSnapshot = sanitizeProductSnapshot(lastSupplement?.products);

    const { box, close } = createModal();
    box.classList.add('event-modal');
    ensureStartProductStyles();
    box.innerHTML = `
        <button class="modal-close" aria-label="Sluiten">✕</button>
        <h2>Voorraad aanvullen — ${escapeHtml(event?.naam || '')}</h2>
        <p class="event-modal-sub">Bus: ${escapeHtml(event?.bus || 'Onbekend')}</p>
        <form class="event-count-form" data-event-id="${escapeHtml(String(event.id))}" data-mode="products">
            <div class="event-product-grid">
                ${cheeseProducts.length ? renderStartProductSections(cheeseProducts, defaultSnapshot) : '<p class="event-modal-note">Geen kaasproducten gevonden in de catalogus.</p>'}
            </div>
            ${cheeseProducts.length
                ? `<div class="event-product-summary" data-role="summary">
                        <div><span>BG</span><strong data-summary-type="BG">0</strong></div>
                        <div><span>ROOK</span><strong data-summary-type="ROOK">0</strong></div>
                        <div><span>GEIT</span><strong data-summary-type="GEIT">0</strong></div>
                        <div class="total"><span>Totaal</span><strong data-summary-type="TOTAL">0</strong></div>
                   </div>`
                : ''}
            <div class="event-count-actions">
                <button type="button" class="event-card-btn ghost" data-role="cancel">Annuleren</button>
                <button type="submit" class="event-card-btn primary">Opslaan</button>
            </div>
        </form>
        ${supplements.length ? renderSupplementHistory(supplements) : '<p class="event-modal-note">Nog geen aanvullingen geregistreerd.</p>'}
    `;

    box.querySelector('.modal-close')?.addEventListener('click', close);
    box.querySelector('[data-role="cancel"]')?.addEventListener('click', close);

    const form = box.querySelector('.event-count-form');
    if (form && cheeseProducts.length) {
        applyCheeseSnapshotToForm(form, defaultSnapshot);
        form.querySelectorAll('.cheese-product-row').forEach(row => {
            updateCheeseProductRow(row);
        });
        updateCheeseProductSummary(form);
        form.querySelectorAll('[data-action="cheese-step"]').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                handleCheeseStepperClick(btn);
            });
        });
        form.addEventListener('input', (ev) => {
            if (!(ev.target instanceof HTMLInputElement)) return;
            if (!ev.target.closest('.cheese-product-row')) return;
            const row = ev.target.closest('.cheese-product-row');
            if (row) {
                updateCheeseProductRow(row);
                updateCheeseProductSummary(form);
            }
        });
    }

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cheeseData = collectCheeseProductData(form);
        if (!Object.values(cheeseData.categories).some(val => Number(val) > 0)) {
            showAlert('Voer minimaal één hoeveelheid in om aan te vullen.', 'warning');
            return;
        }
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Opslaan…';
        }
        try {
            event.kaasTelling = { ...(event.kaasTelling || {}) };
            const list = normalizeSupplements(event.kaasTelling.supplements);
            const timestamp = new Date().toISOString();
            const entry = {
                ...cheeseData.categories,
                categories: { ...cheeseData.categories },
                products: sanitizeProductSnapshot(cheeseData.products),
                timestamp
            };
            event.kaasTelling.supplements = [...list, entry];
            const { saveEvent } = await import('./3_data.js');
            const ok = await saveEvent(event.id);
            if (ok === false) throw new Error('save-failed');
            showAlert('Aanvulling opgeslagen.', 'success');
            close();
            renderEventCards();
            store.emit?.('events:updated', { eventId: event.id, action: 'supplement' });
        } catch (err) {
            console.error('[POS] Aanvulling opslaan mislukt', err);
            showAlert('Opslaan van aanvulling mislukt.', 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Opslaan';
            }
        }
    });
}

function renderCountInput(label, value = 0) {
    const safe = Number.isFinite(value) ? value : 0;
    return `
        <label class="event-count-field">
            ${escapeHtml(label)}
            <input name="${escapeHtml(label)}" type="number" min="0" step="1" value="${escapeHtml(String(Math.max(0, Math.round(safe))))}" inputmode="numeric" />
        </label>
    `;
}

function ensureStartProductStyles() {
    if (document.getElementById('start-cheese-styles')) return;
    const style = document.createElement('style');
    style.id = 'start-cheese-styles';
    style.textContent = `
        .event-product-grid { display: flex; flex-direction: column; gap: .9rem; }
        .cheese-product-section { border: 1px solid rgba(25, 74, 31, .08); border-radius: 1rem; padding: .75rem; background: rgba(246, 248, 246, .7); display: flex; flex-direction: column; gap: .55rem; }
        .cheese-product-section > header { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; font-weight: 900; color: #194a1f; text-transform: uppercase; font-size: .85rem; }
        .cheese-product-list { display: flex; flex-direction: column; gap: .45rem; }
        .cheese-product-row { display: grid; grid-template-columns: minmax(0, 1fr) repeat(3, auto); align-items: center; gap: .55rem; background: #fff; border-radius: .75rem; padding: .55rem .65rem; box-shadow: inset 0 0 0 1px rgba(25,74,31,.05); }
        .cheese-product-name { font-weight: 800; color: #143814; font-size: .95rem; }
        .cheese-product-control { display: flex; align-items: center; gap: .35rem; font-weight: 700; color: #35513a; }
        .cheese-product-control span.label { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: #728178; font-weight: 700; }
        .cheese-stepper { display: inline-flex; align-items: center; border: 1px solid #d0d5dd; border-radius: .65rem; overflow: hidden; background: #fff; }
        .cheese-stepper button { border: none; background: #f2f4f7; color: #194a1f; font-weight: 900; width: 34px; height: 32px; display: grid; place-items: center; cursor: pointer; font-size: 1.05rem; }
        .cheese-stepper button:active { background: #e0e4eb; }
        .cheese-stepper input { width: 52px; border: none; text-align: center; font-weight: 800; font-size: .95rem; padding: .2rem; outline: none; }
        .cheese-product-total { font-weight: 900; color: #194a1f; font-size: .95rem; min-width: 3ch; text-align: right; }
        .cheese-product-summary { margin-top: .4rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: .4rem; font-weight: 800; color: #194a1f; }
        .cheese-product-summary div { background: rgba(42,150,38,.08); border-radius: .75rem; padding: .5rem .6rem; display: flex; justify-content: space-between; align-items: baseline; gap: .35rem; }
        .cheese-product-summary div span { font-size: .8rem; color: #35513a; text-transform: uppercase; letter-spacing: .04em; }
        .cheese-product-summary div strong { font-size: 1rem; }
        .cheese-product-summary div.total { background: rgba(255,197,0,.18); color: #5a4700; }
        .cheese-product-summary div.total strong { color: #5a4700; }
    `;
    document.head.appendChild(style);
}

function getCheeseProductList() {
    const order = { BG: 0, ROOK: 1, GEIT: 2 };
    const producten = store.state.db?.producten || [];
    return producten
        .filter(isCheeseProduct)
        .map(product => ({
            product,
            name: product.naam || product.name || product.id,
            type: String(product.type || '').toUpperCase(),
            crateSize: getCheeseCrateSize(product)
        }))
        .filter(item => item.name && item.type)
        .sort((a, b) => {
            const diff = (order[a.type] ?? 99) - (order[b.type] ?? 99);
            if (diff !== 0) return diff;
            return a.name.localeCompare(b.name, 'nl-NL');
        });
}

function renderStartProductSections(products, snapshot = {}) {
    const groups = { BG: [], ROOK: [], GEIT: [] };
    products.forEach(item => {
        if (!groups[item.type]) {
            groups[item.type] = [];
        }
        groups[item.type].push(renderStartProductRow(item, snapshot[item.name] || 0));
    });
    return ['BG', 'ROOK', 'GEIT'].map(type => {
        if (!groups[type]?.length) return '';
        return `
            <section class="cheese-product-section" data-type="${escapeHtml(type)}">
                <header>
                    <span>${escapeHtml(type)}</span>
                    <small>${escapeHtml(String(groups[type].length))} producten</small>
                </header>
                <div class="cheese-product-list">${groups[type].join('')}</div>
            </section>
        `;
    }).join('');
}

function renderStartProductRow(item, quantity = 0) {
    const qty = clampCheeseValue(toSafeNumber(quantity));
    const crateSize = Math.max(1, Math.floor(item.crateSize || 1));
    const crates = crateSize > 1 ? Math.floor(qty / crateSize) : qty;
    const loose = crateSize > 1 ? qty % crateSize : 0;
    const total = crates * crateSize + loose;
    const key = normalizeProductKey(item.name) || item.name;
    return `
        <div class="cheese-product-row" data-product="${escapeHtml(item.name)}" data-type="${escapeHtml(item.type)}" data-crate-size="${escapeHtml(String(crateSize))}" data-total="${escapeHtml(String(total))}">
            <div class="cheese-product-name">${escapeHtml(item.name)}</div>
            <div class="cheese-product-control" data-role="crates">
                <span class="label">Kratten</span>
                <div class="cheese-stepper">
                    <button type="button" data-action="cheese-step" data-field="crates" data-step="-1">−</button>
                    <input type="number" min="0" step="1" inputmode="numeric" name="crate:${escapeHtml(key)}" value="${escapeHtml(String(crates))}" />
                    <button type="button" data-action="cheese-step" data-field="crates" data-step="1">+</button>
                </div>
                <span class="label">×${escapeHtml(String(crateSize))}</span>
            </div>
            <div class="cheese-product-control" data-role="loose">
                <span class="label">Los</span>
                <div class="cheese-stepper">
                    <button type="button" data-action="cheese-step" data-field="loose" data-step="-1">−</button>
                    <input type="number" min="0" step="1" inputmode="numeric" name="loose:${escapeHtml(key)}" value="${escapeHtml(String(loose))}" />
                    <button type="button" data-action="cheese-step" data-field="loose" data-step="1">+</button>
                </div>
            </div>
            <div class="cheese-product-total" data-role="total">${escapeHtml(String(total))}</div>
        </div>
    `;
}

function handleCheeseStepperClick(button) {
    const row = button.closest('.cheese-product-row');
    if (!row) return;
    const field = button.dataset.field;
    const step = Number(button.dataset.step) || 0;
    const container = row.querySelector(`[data-role="${field}"]`);
    const input = container?.querySelector('input');
    if (!input) return;
    const current = Math.max(0, Math.floor(Number((input.value || '').replace(',', '.')) || 0));
    const next = Math.max(0, current + step);
    input.value = String(next);
    updateCheeseProductRow(row);
    updateCheeseProductSummary(row.closest('form'));
}

function updateCheeseProductRow(row) {
    if (!row) return { total: 0 };
    const crateSize = Math.max(1, Math.floor(Number(row.dataset.crateSize) || 1));
    const crateInput = row.querySelector('[data-role="crates"] input');
    const looseInput = row.querySelector('[data-role="loose"] input');
    let crates = Math.max(0, Math.floor(Number((crateInput?.value || '').replace(',', '.')) || 0));
    let loose = Math.max(0, Math.floor(Number((looseInput?.value || '').replace(',', '.')) || 0));
    if (crateSize > 1 && loose >= crateSize) {
        crates += Math.floor(loose / crateSize);
        loose = loose % crateSize;
    }
    if (crateInput) crateInput.value = String(crates);
    if (looseInput) looseInput.value = String(loose);
    const total = crates * crateSize + loose;
    const totalEl = row.querySelector('[data-role="total"]');
    if (totalEl) totalEl.textContent = String(total);
    row.dataset.total = String(total);
    return { crates, loose, total };
}

function updateCheeseProductSummary(form) {
    if (!form) return;
    const totals = { BG: 0, ROOK: 0, GEIT: 0 };
    form.querySelectorAll('.cheese-product-row').forEach(row => {
        const type = row.dataset.type;
        const total = updateCheeseProductRow(row).total;
        if (type && totals[type] !== undefined) {
            totals[type] += total;
        }
    });
    const grand = totals.BG + totals.ROOK + totals.GEIT;
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
        const el = form.querySelector(`[data-summary-type="${type}"]`);
        if (el) {
            el.textContent = totals[type].toLocaleString('nl-NL');
        }
    });
    const totalEl = form.querySelector('[data-summary-type="TOTAL"]');
    if (totalEl) {
        totalEl.textContent = grand.toLocaleString('nl-NL');
    }
}

function applyCheeseSnapshotToForm(form, snapshot = {}) {
    if (!form) return;
    form.querySelectorAll('.cheese-product-row').forEach(row => {
        const name = row.dataset.product;
        const crateSize = Math.max(1, Math.floor(Number(row.dataset.crateSize) || 1));
        const qty = clampCheeseValue(toSafeNumber(snapshot?.[name]));
        const crates = crateSize > 1 ? Math.floor(qty / crateSize) : qty;
        const loose = crateSize > 1 ? qty % crateSize : 0;
        const crateInput = row.querySelector('[data-role="crates"] input');
        const looseInput = row.querySelector('[data-role="loose"] input');
        if (crateInput) crateInput.value = String(crates);
        if (looseInput) looseInput.value = String(loose);
        updateCheeseProductRow(row);
    });
    updateCheeseProductSummary(form);
}

function collectCheeseProductData(form) {
    const categories = { BG: 0, ROOK: 0, GEIT: 0 };
    const products = {};
    if (!form) {
        return { categories, products };
    }
    form.querySelectorAll('.cheese-product-row').forEach(row => {
        const { total } = updateCheeseProductRow(row);
        const name = row.dataset.product;
        const type = row.dataset.type;
        if (type && categories[type] !== undefined) {
            categories[type] += total;
        }
        if (name && total > 0) {
            products[name] = (products[name] || 0) + total;
        }
    });
    return { categories, products };
}

function distributeCheeseTotalsToProducts(totals) {
    const snapshot = {};
    const productsByType = getCheeseProductsByType();
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
        const names = productsByType[type] || [];
        const amount = clampCheeseValue(toSafeNumber(totals?.[type]));
        if (!names.length || amount <= 0) return;
        const base = Math.floor(amount / names.length);
        let remainder = amount - base * names.length;
        names.forEach(name => {
            let qty = base;
            if (remainder > 0) {
                qty += 1;
                remainder -= 1;
            }
            if (qty > 0) {
                snapshot[name] = qty;
            }
        });
    });
    return snapshot;
}

function getCheeseCrateSize(product) {
    const type = String(product?.type || '').toUpperCase();
    const name = String(product?.naam || product?.name || '').toLowerCase();
    if (type === 'ROOK') return 10;
    if (type === 'BG') return 18;
    if (type === 'GEIT') {
        if (name.includes('truffel')) return 18;
        return 15;
    }
    return 1;
}

function readCheeseForm(form) {
    const result = {};
    ['BG', 'ROOK', 'GEIT'].forEach(key => {
        const input = form.querySelector(`input[name="${key}"]`);
        const val = input ? Number((input.value || '').replace(',', '.')) : 0;
        result[key] = Number.isFinite(val) ? Math.max(0, Math.round(val)) : 0;
    });
    return result;
}

function normalizeSupplements(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(item => item && typeof item === 'object').map(entry => {
        const source = entry?.categories && typeof entry.categories === 'object' ? entry.categories : entry;
        const categories = {
            BG: toSafeNumber(source?.BG ?? source?.bg),
            ROOK: toSafeNumber(source?.ROOK ?? source?.rook),
            GEIT: toSafeNumber(source?.GEIT ?? source?.geit)
        };
        const products = sanitizeProductSnapshot(entry?.products || entry?.producten || {});
        return {
            ...categories,
            categories: { ...categories },
            products,
            timestamp: entry?.timestamp || null
        };
    });
}

function findEventByRef(ref) {
    if (!ref) return null;
    return (store.state.db?.evenementen || []).find(ev => String(ev.id) === String(ref) || String(ev.naam) === String(ref));
}

function toCheeseTotals(raw) {
    const totals = { BG: 0, ROOK: 0, GEIT: 0 };
    if (!raw || typeof raw !== 'object') {
        return totals;
    }
    const producten = store.state.db?.producten || [];
    const lookup = new Map();
    producten.forEach(product => {
        if (!isCheeseProduct(product)) return;
        const type = String(product.type || '').toUpperCase();
        const name = product.naam;
        if (!type || !name) return;
        lookup.set(name, type);
    });

    const categorySource = raw.categories && typeof raw.categories === 'object' ? raw.categories : raw;
    const hasCategory = { BG: false, ROOK: false, GEIT: false };
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
        const value = toSafeNumber(categorySource?.[type] ?? categorySource?.[type.toLowerCase?.()]);
        if (value > 0) {
            totals[type] += value;
            hasCategory[type] = true;
        }
    });

    const productSource = raw.products && typeof raw.products === 'object' ? raw.products : categorySource;
    Object.entries(productSource || {}).forEach(([name, value]) => {
        if (['BG', 'ROOK', 'GEIT', 'bg', 'rook', 'geit'].includes(name)) return;
        const qty = toSafeNumber(value);
        if (!qty) return;
        const type = lookup.get(name);
        if (type && totals[type] !== undefined && !hasCategory[type]) {
            totals[type] += qty;
        }
    });

    return totals;
}

function toSafeNumber(val) {
    const num = Number(val);
    return Number.isFinite(num) ? num : 0;
}

function cloneProductTotals(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.entries(raw).forEach(([name, value]) => {
        const qty = clampCheeseValue(toSafeNumber(value));
        if (qty > 0) {
            out[name] = qty;
        }
    });
    return out;
}

function normalizeProductKey(name) {
    return String(name || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function isCheeseProduct(product) {
    if (!product) return false;
    const type = String(product.type || '').toUpperCase();
    return type === 'BG' || type === 'ROOK' || type === 'GEIT';
}

function getCheeseProductCatalog() {
    const catalog = new Map();
    const producten = store.state.db?.producten || [];
    producten.forEach((product) => {
        if (!isCheeseProduct(product)) return;
        const key = normalizeProductKey(product.naam || product.name || product.id || product.sku);
        if (!key) return;
        if (!catalog.has(key)) {
            catalog.set(key, product);
        }
    });
    return catalog;
}

function resolveCheeseProduct(catalog, rawName) {
    if (!rawName) return null;
    const key = normalizeProductKey(rawName);
    if (!key) return null;
    if (catalog.has(key)) return catalog.get(key);
    const compressed = key.replace(/\s+/g, '');
    for (const [storedKey, product] of catalog.entries()) {
        if (storedKey.replace(/\s+/g, '') === compressed) {
            return product;
        }
    }
    return null;
}

function sanitizeProductSalesMap(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.entries(raw).forEach(([name, value]) => {
        const qty = clampCheeseValue(toSafeNumber(value));
        if (qty > 0) {
            out[name] = qty;
        }
    });
    return out;
}

function sanitizeProductSnapshot(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.entries(raw).forEach(([name, value]) => {
        const qty = clampCheeseValue(toSafeNumber(value));
        if (qty > 0) {
            out[name] = qty;
        }
    });
    return out;
}

function createCheeseTypeBuckets() {
    const buckets = {
        BG: new Map(),
        ROOK: new Map(),
        GEIT: new Map()
    };
    const producten = store.state.db?.producten || [];
    producten.forEach((product) => {
        if (!isCheeseProduct(product)) return;
        const type = String(product.type || '').toUpperCase();
        const name = product.naam || product.name || product.id;
        if (!name || !buckets[type]) return;
        if (!buckets[type].has(name)) {
            buckets[type].set(name, 0);
        }
    });
    return buckets;
}

// ============ Quick Sale Flow ============

function ensureQuickSaleFab() {
    if (quickSaleFabInitialized) {
        updateQuickSaleFabState();
        return;
    }
    quickSaleFabInitialized = true;
    injectQuickSaleStyles();
    const fab = document.createElement('button');
    fab.id = 'quickSaleFab';
    fab.type = 'button';
    fab.className = 'quick-sale-fab';
    fab.innerHTML = '<span class="label">+ Verkoop</span>';
    fab.addEventListener('click', () => openQuickSaleModal());
    document.body.appendChild(fab);
    updateQuickSaleFabState();
    store.on?.('activeDay:changed', updateQuickSaleFabState);
    store.on?.('session:changed', updateQuickSaleFabState);
    store.on?.('events:updated', (payload) => {
        if (!quickSaleModalContext) return;
        if (!payload?.eventId || String(payload.eventId) !== String(quickSaleModalContext.eventId)) return;
        renderQuickSaleModalContent(quickSaleModalContext);
    });
}

function updateQuickSaleFabState() {
    const fab = document.getElementById('quickSaleFab');
    if (!fab) return;
    const activeDay = store.getActiveEventDay?.();
    const hasEvent = Boolean(activeDay?.eventId);
    fab.disabled = !hasEvent;
    fab.classList.toggle('quick-sale-fab--hidden', !hasEvent);
}

function openQuickSaleModal() {
    const activeDay = store.getActiveEventDay?.();
    if (!activeDay?.eventId) {
        showAlert('Geen actief evenement geselecteerd.', 'error');
        return;
    }

    const { overlay, box, close } = createModal({
        onClose: () => {
            quickSaleModalContext = null;
        }
    });
    box.classList.add('quick-sale-modal');

    const header = document.createElement('header');
    header.className = 'quick-sale-modal__header';
    header.innerHTML = `
        <div>
            <h2>Verkoop invoeren</h2>
            <p>${escapeHtml(activeDay.eventName || 'Onbekend event')} • ${escapeHtml(formatTopbarDate(activeDay.date) || '')}</p>
        </div>
        <button type="button" class="quick-sale-close" aria-label="Sluiten">×</button>
    `;
    header.querySelector('.quick-sale-close').addEventListener('click', close);
    box.appendChild(header);

    const content = document.createElement('div');
    content.className = 'quick-sale-modal__body';
    box.appendChild(content);

    const context = {
        eventId: activeDay.eventId,
        busId: store.state.session?.busId || store.state.session?.meta?.bus || null,
        content,
        close
    };
    quickSaleModalContext = context;
    renderQuickSaleModalContent(context);
}

function renderQuickSaleModalContent(context) {
    if (!context || !context.content) return;
    const event = (store.state.db?.evenementen || []).find(ev => String(ev.id) === String(context.eventId) || String(ev.naam) === String(context.eventId));
    const mutationTotals = aggregateEventMutationTotals(event || {});
    const products = getQuickSaleProducts();
    const catalog = getCheeseProductCatalog();
    const productMap = new Map();
    products.forEach(product => {
        if (!product?.id) return;
        if (!productMap.has(product.id)) {
            productMap.set(product.id, product);
        }
    });
    const grid = document.createElement('div');
    grid.className = 'quick-sale-grid';

    products.forEach((product) => {
        const amount = mutationTotals.products[product.id] || mutationTotals.products[product.name] || 0;
        const transferAmount = mutationTotals?.transfers?.products?.[product.id]
            || mutationTotals?.transfers?.products?.[product.name]
            || 0;
        const transferNote = transferAmount > 0
            ? `<div class="quick-sale-card__note">↔︎ ${transferAmount} verplaatst</div>`
            : '';
        const card = document.createElement('article');
        card.className = 'quick-sale-card';
        card.dataset.product = product.id;
        card.innerHTML = `
            <header>
                <div class="quick-sale-card__title">
                    <h3>${escapeHtml(product.label)}</h3>
                    <span class="type">${escapeHtml(product.type || '')}</span>
                </div>
                <div class="quick-sale-card__count" data-role="count">${amount || 0}</div>
            </header>
            ${transferNote}
            <div class="quick-sale-card__actions">
                <button type="button" data-action="delta" data-delta="-1" title="Correctie −1">−1</button>
                <button type="button" data-action="delta" data-delta="1" title="+1 stuk">+1</button>
                <button type="button" data-action="delta" data-delta="5" title="+5 stuks">+5</button>
                <button type="button" data-action="snijkaas" data-delta="1" title="Snijkaas +1">Snijkaas</button>
            </div>
        `;
        grid.appendChild(card);
    });

    const summary = document.createElement('div');
    summary.className = 'quick-sale-summary';
    summary.innerHTML = `
        <div class="quick-sale-summary__item">
            <p>Totale verkopen</p>
            <strong>${mutationTotals.total || 0}</strong>
        </div>
        <div class="quick-sale-summary__item">
            <p>Mix bron</p>
            <strong>Verkopen + begin/eindvoorraad</strong>
            <span>Elke klik registreert een individuele verkoop.</span>
        </div>
    `;

    context.content.innerHTML = '';
    context.content.appendChild(summary);
    context.content.appendChild(grid);

    if (!context.bound) {
        context.content.addEventListener('click', (ev) => {
            const btn = ev.target.closest('button[data-action]');
            if (!btn) return;
            const card = btn.closest('.quick-sale-card');
            if (!card) return;
            const productId = card.dataset.product;
            const delta = Number(btn.dataset.delta || '0');
            const action = btn.dataset.action;
            const type = action === 'snijkaas' ? 'snijkaas' : 'quick';
            handleQuickSaleAction(context, productId, delta, type);
        });
        context.bound = true;
    }
}

async function handleQuickSaleAction(context, productId, delta, type) {
    if (!context || !productId || !delta) return;
    try {
        await addVerkoopMutatie(context.eventId, {
            productId,
            quantity: delta,
            type
        }, { silent: true });
        renderQuickSaleModalContent(context);
        showAlert(`${delta > 0 ? '+' : ''}${delta} ${type === 'snijkaas' ? 'snijkaas' : 'verkoop'} opgeslagen.`, 'success');
    } catch (err) {
        console.error('[POS] addVerkoopMutatie failed', err);
        showAlert('Opslaan van verkoopmutatie mislukt.', 'error');
    }
}

function getQuickSaleProducts() {
    const catalog = getCheeseProductCatalog();
    const items = [];
    const seen = new Set();
    catalog.forEach((product) => {
        if (!product) return;
        const name = product.naam || product.name || product.id;
        if (!name || seen.has(name)) return;
        seen.add(name);
        const type = normalizeCheeseType(product.type) || inferCheeseTypeFromName(name) || '';
        items.push({
            id: name,
            name,
            label: name,
            type
        });
    });
    items.sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.label.localeCompare(b.label);
    });
    return items;
}

function injectQuickSaleStyles() {
    if (document.getElementById('quick-sale-styles')) return;
    const style = document.createElement('style');
    style.id = 'quick-sale-styles';
    style.textContent = `
        .quick-sale-fab {
            position: fixed;
            bottom: 1.5rem;
            right: 1.5rem;
            background: #2A9626;
            color: #fff;
            border: none;
            border-radius: 999px;
            padding: 0.85rem 1.4rem;
            font-size: 1rem;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            box-shadow: 0 18px 36px rgba(15, 23, 42, 0.18);
            cursor: pointer;
            z-index: 50;
        }
        .quick-sale-fab--hidden {
            opacity: 0;
            pointer-events: none;
        }
        .quick-sale-fab:disabled {
            background: rgba(15, 23, 42, 0.2);
            color: rgba(15, 23, 42, 0.55);
            box-shadow: none;
            cursor: not-allowed;
        }
        .quick-sale-modal {
            width: min(720px, calc(100vw - 2rem));
            max-height: min(90vh, 820px);
            display: flex;
            flex-direction: column;
            background: #fff;
            border-radius: 24px;
            overflow: hidden;
        }
        .quick-sale-modal__header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 1.25rem 1.5rem 0.75rem;
            gap: 1rem;
        }
        .quick-sale-modal__header h2 {
            margin: 0;
            font-size: 1.45rem;
        }
        .quick-sale-modal__header p {
            margin: 0.35rem 0 0;
            color: #4b5563;
            font-size: 0.95rem;
        }
        .quick-sale-close {
            border: none;
            background: rgba(15, 23, 42, 0.08);
            border-radius: 999px;
            font-size: 1.1rem;
            font-weight: 700;
            width: 36px;
            height: 36px;
            cursor: pointer;
        }
        .quick-sale-modal__body {
            padding: 0 1.5rem 1.5rem;
            overflow-y: auto;
        }
        .quick-sale-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 1rem;
        }
        .quick-sale-card { 
            background: #f8fafc;
            border-radius: 1rem;
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.05);
        }
        .quick-sale-card header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 0.5rem;
        }
        .quick-sale-card__note {
            font-size: 0.82rem;
            font-weight: 700;
            color: #1f4a73;
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            margin-top: -0.3rem;
        }
        .quick-sale-card__title h3 {
            margin: 0;
            font-size: 1.1rem;
            color: #143814;
        }
        .quick-sale-card__title .type {
            display: inline-flex;
            align-items: center;
            padding: 0.15rem 0.5rem;
            border-radius: 999px;
            background: rgba(42, 150, 38, 0.12);
            color: #27632a;
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
        }
        .quick-sale-card__count {
            font-size: 1.4rem;
            font-weight: 800;
            color: #1f2937;
        }
        .quick-sale-card__actions {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 0.5rem;
        }
        .quick-sale-card__actions button {
            border: none;
            border-radius: 0.75rem;
            padding: 0.65rem;
            font-weight: 700;
            font-size: 0.95rem;
            cursor: pointer;
            background: #fff;
            box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
        }
        .quick-sale-card__actions button[data-action="delta"][data-delta="1"],
        .quick-sale-card__actions button[data-action="snijkaas"] {
            background: rgba(42, 150, 38, 0.15);
            color: #1f6d1c;
        }
        .quick-sale-card__actions button[data-action="delta"][data-delta="5"] {
            background: rgba(255, 197, 0, 0.18);
            color: #7c5f00;
        }
        .quick-sale-card__actions button[data-action="delta"][data-delta="-1"] {
            background: rgba(231, 76, 60, 0.15);
            color: #b02a1c;
        }
        .quick-sale-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 0.75rem;
            margin-bottom: 1rem;
        }
        .quick-sale-summary__item {
            background: #f8fafc;
            border-radius: 1rem;
            padding: 0.9rem 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.2rem;
            box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.05);
        }
        .quick-sale-summary__item p {
            margin: 0;
            color: #4b5563;
            font-size: 0.9rem;
        }
        .quick-sale-summary__item strong {
            font-size: 1.4rem;
            color: #1f2937;
            line-height: 1.2;
        }
        .quick-sale-summary__item span {
            color: #1f6d1c;
            font-weight: 700;
            font-size: 0.9rem;
        }
        @media (max-width: 640px) {
            .quick-sale-fab {
                right: 1rem;
                left: 1rem;
                width: calc(100% - 2rem);
                justify-content: center;
            }
            .quick-sale-grid {
                grid-template-columns: minmax(0, 1fr);
            }
        }
    `;
    document.head.appendChild(style);
}

function getCheeseProductsByType() {
    const result = { BG: [], ROOK: [], GEIT: [] };
    const producten = store.state.db?.producten || [];
    producten.forEach(product => {
        if (!isCheeseProduct(product)) return;
        const type = String(product.type || '').toUpperCase();
        const name = product.naam || product.name || product.id;
        if (!name || !result[type]) return;
        if (!result[type].includes(name)) {
            result[type].push(name);
        }
    });
    return result;
}

function addSnapshotToBuckets(buckets, snapshot) {
    const catalog = getCheeseProductCatalog();
    Object.entries(snapshot || {}).forEach(([rawName, qty]) => {
        const product = resolveCheeseProduct(catalog, rawName) || resolveCheeseProduct(catalog, String(rawName));
        if (!product || !isCheeseProduct(product)) return;
        const type = String(product.type || '').toUpperCase();
        const name = product.naam || rawName;
        const amount = clampCheeseValue(toSafeNumber(qty));
        if (!amount || !buckets[type]) return;
        const current = toSafeNumber(buckets[type].get(name));
        buckets[type].set(name, clampCheeseValue(current + amount));
    });
}

function distributeQuantityAcrossBucket(bucket, amount) {
    const entries = Array.from(bucket.entries());
    const totalEntries = entries.length;
    if (!totalEntries || !Number.isFinite(amount) || amount <= 0) {
        return {};
    }

    const normalized = entries.map(([name, value]) => ({
        name,
        value: clampCheeseValue(toSafeNumber(value))
    }));
    let total = normalized.reduce((sum, item) => sum + item.value, 0);
    if (total <= 0) {
        normalized.forEach(item => { item.value = 1; });
        total = totalEntries;
    }

    const allocations = normalized.map(item => ({
        name: item.name,
        weight: item.value / total
    }));

    const results = {};
    let assigned = 0;
    allocations.forEach(item => {
        const share = Math.floor(amount * item.weight);
        if (share > 0) {
            results[item.name] = share;
            assigned += share;
        }
    });

    let remainder = clampCheeseValue(amount) - assigned;
    if (remainder > 0) {
        const order = [...allocations].sort((a, b) => {
            if (b.weight !== a.weight) return b.weight - a.weight;
            return a.name.localeCompare(b.name);
        });
        let index = 0;
        while (remainder > 0 && order.length) {
            const target = order[index % order.length];
            results[target.name] = (results[target.name] || 0) + 1;
            remainder -= 1;
            index += 1;
        }
    }

    return Object.fromEntries(Object.entries(results).filter(([, qty]) => qty > 0));
}

function applyDistributionToBucket(bucket, distribution) {
    Object.entries(distribution).forEach(([name, qty]) => {
        const current = clampCheeseValue(toSafeNumber(bucket.get(name)));
        bucket.set(name, clampCheeseValue(current + qty));
    });
}

function rebalanceSnapshotToTotals(snapshot, totals) {
    const catalog = getCheeseProductCatalog();
    const productsByType = getCheeseProductsByType();
    const buckets = { BG: [], ROOK: [], GEIT: [] };

    (Object.entries(snapshot || {})).forEach(([rawName, qty]) => {
        const product = resolveCheeseProduct(catalog, rawName);
        if (!product || !isCheeseProduct(product)) return;
        const type = String(product.type || '').toUpperCase();
        const name = product.naam || rawName;
        buckets[type].push({ name, qty: clampCheeseValue(toSafeNumber(qty)) });
    });

    ['BG', 'ROOK', 'GEIT'].forEach(type => {
        if (!buckets[type].length) {
            productsByType[type].forEach(name => {
                buckets[type].push({ name, qty: 0 });
            });
        }
        if (!buckets[type].length && productsByType[type].length === 0) {
            buckets[type].push({ name: `${type} onbekend`, qty: 0 });
        }
    });

    const adjusted = {};
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
        const target = clampCheeseValue(toSafeNumber(totals?.[type]));
        const entries = buckets[type];
        if (!entries || !entries.length) return;
        const sum = entries.reduce((total, item) => total + clampCheeseValue(toSafeNumber(item.qty)), 0);
        if (target <= 0) {
            return;
        }
        let assigned = 0;
        if (sum > 0) {
            entries.forEach(item => {
                const share = Math.floor(target * clampCheeseValue(toSafeNumber(item.qty)) / sum);
                if (share > 0) {
                    adjusted[item.name] = (adjusted[item.name] || 0) + share;
                    assigned += share;
                }
            });
        }
        let remainder = target - assigned;
        if (remainder > 0) {
            const order = [...entries].sort((a, b) => {
                const diff = clampCheeseValue(toSafeNumber(b.qty)) - clampCheeseValue(toSafeNumber(a.qty));
                if (diff !== 0) return diff;
                return a.name.localeCompare(b.name);
            });
            if (!order.length) {
                order.push(...entries);
            }
            let index = 0;
            while (remainder > 0 && order.length) {
                const targetEntry = order[index % order.length];
                adjusted[targetEntry.name] = (adjusted[targetEntry.name] || 0) + 1;
                remainder -= 1;
                index += 1;
            }
        }
    });

    return adjusted;
}

function getBusCheeseProductSnapshot(busId) {
    const voorraad = store.state.db?.voorraad || {};
    const keys = Object.keys(voorraad);
    if (!keys.length || !busId) return {};
    const match = keys.find(k => k === busId) || keys.find(k => k.toLowerCase() === String(busId).toLowerCase());
    const bucket = match ? voorraad[match] : null;
    if (!bucket || typeof bucket !== 'object') return {};

    const catalog = getCheeseProductCatalog();
    const snapshot = {};
    Object.entries(bucket).forEach(([rawName, qty]) => {
        const product = resolveCheeseProduct(catalog, rawName);
        if (!product || !isCheeseProduct(product)) return;
        const canonical = product.naam || rawName;
        const amount = clampCheeseValue(toSafeNumber(qty));
        if (!amount) return;
        snapshot[canonical] = (snapshot[canonical] || 0) + amount;
    });
    return snapshot;
}

function applySupplementsToBuckets(buckets, supplements) {
    if (!Array.isArray(supplements) || !supplements.length) return;
    supplements.forEach(entry => {
        ['BG', 'ROOK', 'GEIT'].forEach(type => {
            const amount = clampCheeseValue(toSafeNumber(entry?.[type]));
            if (!amount) return;
            const bucket = buckets[type];
            if (!bucket || bucket.size === 0) return;
            const distribution = distributeQuantityAcrossBucket(bucket, amount);
            applyDistributionToBucket(bucket, distribution);
        });
    });
}

function computeProductSalesFromBuckets(buckets, categories) {
    const sales = {};
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
        const amount = clampCheeseValue(toSafeNumber(categories?.[type]));
        if (!amount) return;
        const bucket = buckets[type];
        if (!bucket || bucket.size === 0) return;
        const distribution = distributeQuantityAcrossBucket(bucket, amount);
        Object.entries(distribution).forEach(([name, qty]) => {
            if (qty > 0) {
                sales[name] = (sales[name] || 0) + qty;
            }
        });
    });
    return sales;
}

function computeEventProductSales(event, endValues) {
    if (!event) return {};
    const telling = event.kaasTelling || {};
    const startTotals = toCheeseTotals(telling.start);
    const supplementList = normalizeSupplements(telling.supplements);
    const supplementTotals = sumCheeseEntries(supplementList);
    const endTotals = toCheeseTotals(endValues || telling.end);

    const categories = {
        BG: clampCheeseValue(startTotals.BG + supplementTotals.BG - endTotals.BG),
        ROOK: clampCheeseValue(startTotals.ROOK + supplementTotals.ROOK - endTotals.ROOK),
        GEIT: clampCheeseValue(startTotals.GEIT + supplementTotals.GEIT - endTotals.GEIT)
    };

    const buckets = createCheeseTypeBuckets();
    const startSnapshot = sanitizeProductSnapshot(telling.startProducts);
    const fallbackSnapshot = Object.keys(startSnapshot).length ? null : getBusCheeseProductSnapshot(event?.bus);
    addSnapshotToBuckets(buckets, Object.keys(startSnapshot).length ? startSnapshot : fallbackSnapshot);
    applySupplementsToBuckets(buckets, supplementList);

    return computeProductSalesFromBuckets(buckets, categories);
}

function getBusCheeseSnapshot(busId) {
    const totals = { BG: 0, ROOK: 0, GEIT: 0 };
    if (!busId) return totals;
    const voorraad = store.state.db?.voorraad || {};
    const keys = Object.keys(voorraad);
    if (!keys.length) return totals;
    const hitKey = keys.find(k => k === busId) || keys.find(k => k.toLowerCase() === String(busId).toLowerCase());
    const bucket = hitKey ? voorraad[hitKey] : null;
    if (!bucket) return totals;
    Object.entries(bucket).forEach(([naam, qty]) => {
        const prefix = (naam || '').split(' ')[0]?.toUpperCase();
        if (!['BG', 'ROOK', 'GEIT'].includes(prefix)) return;
        const amount = Number(qty);
        if (!Number.isFinite(amount)) return;
        totals[prefix] += amount;
    });
    return totals;
}

function computeEventSalesSnapshot(event, endValues, productSales = {}) {
    const telling = event?.kaasTelling || {};
    const startTotals = toCheeseTotals(telling.start);
    const supplementTotals = sumCheeseEntries(normalizeSupplements(telling.supplements));
    const endTotals = toCheeseTotals(endValues);

    const mutationTotals = aggregateEventMutationTotals(event);

    const categories = {
        BG: clampCheeseValue(startTotals.BG + supplementTotals.BG - endTotals.BG),
        ROOK: clampCheeseValue(startTotals.ROOK + supplementTotals.ROOK - endTotals.ROOK),
        GEIT: clampCheeseValue(startTotals.GEIT + supplementTotals.GEIT - endTotals.GEIT)
    };
    const hasEndData = hasCheeseMeasurement(telling.end);
    if (!hasEndData && mutationTotals.total > 0) {
        categories.BG = mutationTotals.categories.BG;
        categories.ROOK = mutationTotals.categories.ROOK;
        categories.GEIT = mutationTotals.categories.GEIT;
    } else {
        ['BG', 'ROOK', 'GEIT'].forEach((type) => {
            if (mutationTotals.categories[type] > categories[type]) {
                categories[type] = mutationTotals.categories[type];
            }
        });
    }

    const totalCategories = categories.BG + categories.ROOK + categories.GEIT;
    const productTotals = sanitizeProductSalesMap(productSales);
    Object.entries(mutationTotals.products).forEach(([name, qty]) => {
        productTotals[name] = (productTotals[name] || 0) + qty;
    });
    const totalProducts = Object.values(productTotals).reduce((sum, value) => sum + value, 0);
    const calculatedAt = new Date().toISOString();

    return {
        categories,
        products: productTotals,
        total: totalCategories || totalProducts,
        calculatedAt,
        source: {
            start: { ...startTotals, timestamp: telling.start?.timestamp || null },
            supplements: { ...supplementTotals },
            end: { ...endTotals, timestamp: telling.end?.timestamp || null }
        }
    };
}

function sumCheeseEntries(list) {
    const totals = { BG: 0, ROOK: 0, GEIT: 0 };
    if (!Array.isArray(list)) return totals;
    for (const entry of list) {
        const normalized = toCheeseTotals(entry);
        totals.BG += normalized.BG;
        totals.ROOK += normalized.ROOK;
        totals.GEIT += normalized.GEIT;
    }
    return totals;
}

function aggregateEventMutationTotals(event, options = {}) {
    const entries = Array.isArray(event?.verkoopMutaties?.entries)
        ? event.verkoopMutaties.entries
        : [];
    if (!entries.length) {
        return {
            total: 0,
            categories: { BG: 0, ROOK: 0, GEIT: 0 },
            products: {},
            transfers: { total: 0, products: {}, entries: [] }
        };
    }

    const allowedTypes = Array.isArray(options.includeTypes) && options.includeTypes.length
        ? options.includeTypes.map((type) => String(type || '').toLowerCase())
        : ['quick', 'snijkaas', 'correctie'];
    const rawTotals = new Map();
    const transferTotals = new Map();
    const transferEntries = [];

    entries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const productId = entry.productId || entry.product || entry.name;
        const amount = toSafeNumber(entry.quantity);
        if (!productId || !Number.isFinite(amount) || amount === 0) return;
        const key = String(productId);
        const type = String(entry.type || '').toLowerCase();
        if (type === 'transfer') {
            const direction = entry.meta?.transfer?.direction || null;
            if (direction !== 'in') {
                transferTotals.set(key, (transferTotals.get(key) || 0) + Math.abs(amount));
            }
            const qty = Math.max(0, Math.round(Math.abs(amount)));
            if (qty > 0) {
                transferEntries.push({
                    productId: key,
                    quantity: qty,
                    busId: entry.busId || null,
                    direction,
                    fromBus: entry.meta?.transfer?.from || null,
                    toBus: entry.meta?.transfer?.to || null,
                    createdAt: entry.createdAt || entry.updatedAt || null
                });
            }
            return;
        }
        if (allowedTypes.length && !allowedTypes.includes(type)) {
            return;
        }
        rawTotals.set(key, (rawTotals.get(key) || 0) + amount);
    });

    const products = {};
    rawTotals.forEach((value, key) => {
        const qty = Math.max(0, Math.round(value));
        if (qty > 0) {
            products[key] = qty;
        }
    });

    const transferProducts = {};
    transferTotals.forEach((value, key) => {
        const qty = Math.max(0, Math.round(Math.abs(value)));
        if (qty > 0) {
            transferProducts[key] = qty;
        }
    });

    const categories = { BG: 0, ROOK: 0, GEIT: 0 };
    const catalog = getCheeseProductCatalog();
    Object.entries(products).forEach(([name, qty]) => {
        const product = resolveCheeseProduct(catalog, name);
        const type = normalizeCheeseType(product?.type) || inferCheeseTypeFromName(name);
        if (type && categories[type] != null) {
            categories[type] += qty;
        }
    });

    const total = categories.BG + categories.ROOK + categories.GEIT
        || Object.values(products).reduce((sum, qty) => sum + qty, 0);

    const transferTotal = Object.values(transferProducts).reduce((sum, qty) => sum + qty, 0);

    return {
        total,
        categories,
        products,
        transfers: {
            total: transferTotal,
            products: transferProducts,
            entries: transferEntries
        }
    };
}

function clampCheeseValue(val) {
    if (!Number.isFinite(val)) return 0;
    return Math.max(0, Math.round(val));
}

function cloneSalesSource(source) {
    if (!source || typeof source !== 'object') return null;
    const clone = {};
    if (source.start && typeof source.start === 'object') {
        clone.start = { ...toCheeseTotals(source.start), timestamp: source.start.timestamp || null };
    }
    if (source.supplements && typeof source.supplements === 'object') {
        clone.supplements = { ...toCheeseTotals(source.supplements) };
    }
    if (source.end && typeof source.end === 'object') {
        clone.end = { ...toCheeseTotals(source.end), timestamp: source.end.timestamp || null };
    }
    return clone;
}

function createDefaultCheeseMix() {
    return {
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
}

function cloneCheeseMix(raw) {
    const clone = createDefaultCheeseMix();
    if (!raw || typeof raw !== 'object') return clone;

    const version = Number(raw.version);
    clone.version = Number.isFinite(version) ? version : raw?.totals?.products ? 2 : 1;

    const baseCategories = toCheeseTotals(raw.totals?.categories || raw.totals);
    const baseProducts = cloneProductTotals(raw.totals?.products || raw.products);
    let baseTotal = clampCheeseValue(toSafeNumber(raw.totals?.total));
    if (!baseTotal) {
        const catSum = baseCategories.BG + baseCategories.ROOK + baseCategories.GEIT;
        const prodSum = Object.values(baseProducts).reduce((sum, value) => sum + value, 0);
        baseTotal = catSum || prodSum;
    }
    clone.totals.categories = baseCategories;
    clone.totals.products = baseProducts;
    clone.totals.total = baseTotal;

    if (raw.events && typeof raw.events === 'object') {
        Object.entries(raw.events).forEach(([eventId, entry]) => {
            if (!eventId) return;
            const categories = toCheeseTotals(entry?.categories ?? entry);
            const products = cloneProductTotals(entry?.products);
            let total = clampCheeseValue(toSafeNumber(entry?.total));
            if (!total) {
                const sumCat = categories.BG + categories.ROOK + categories.GEIT;
                const sumProd = Object.values(products).reduce((sum, value) => sum + value, 0);
                total = sumCat || sumProd;
            }
            clone.events[eventId] = {
                categories,
                products,
                total,
                updatedAt: entry?.updatedAt || null,
                calculatedAt: entry?.calculatedAt || null,
                source: cloneSalesSource(entry?.source)
            };
        });
    }

    if (raw.updatedAt) clone.updatedAt = raw.updatedAt;

    if (Object.keys(clone.events).length) {
        const aggregatedCategories = { BG: 0, ROOK: 0, GEIT: 0 };
        const aggregatedProducts = {};
        let aggregatedTotal = 0;
        Object.values(clone.events).forEach(entry => {
            aggregatedCategories.BG += entry.categories.BG;
            aggregatedCategories.ROOK += entry.categories.ROOK;
            aggregatedCategories.GEIT += entry.categories.GEIT;
            Object.entries(entry.products).forEach(([name, value]) => {
                aggregatedProducts[name] = (aggregatedProducts[name] || 0) + value;
            });
            aggregatedTotal += entry.total;
        });
        clone.totals.categories = aggregatedCategories;
        clone.totals.products = aggregatedProducts;
        clone.totals.total = aggregatedTotal || (aggregatedCategories.BG + aggregatedCategories.ROOK + aggregatedCategories.GEIT);
    }

    const totalCat = clone.totals.categories.BG + clone.totals.categories.ROOK + clone.totals.categories.GEIT;
    clone.ratio.categories = totalCat > 0
        ? {
            BG: clone.totals.categories.BG / totalCat,
            ROOK: clone.totals.categories.ROOK / totalCat,
            GEIT: clone.totals.categories.GEIT / totalCat
        }
        : { BG: 0, ROOK: 0, GEIT: 0 };

    const totalProd = Object.values(clone.totals.products).reduce((sum, value) => sum + value, 0);
    clone.ratio.products = totalProd > 0
        ? Object.fromEntries(Object.entries(clone.totals.products).map(([name, value]) => [name, value / totalProd]))
        : {};

    return clone;
}

async function updateGlobalCheeseMix(eventId, newSales, previousSales = null) {
    if (!eventId || !newSales) return;
    const mix = cloneCheeseMix(store.state.db?.verkoopMix);
    const eventKey = String(eventId);

    const prevCategories = previousSales?.categories ? toCheeseTotals(previousSales.categories) : { BG: 0, ROOK: 0, GEIT: 0 };
    const prevProducts = previousSales?.products ? cloneProductTotals(previousSales.products) : {};
    const prevTotal = clampCheeseValue(toSafeNumber(previousSales?.total));

    const newCategories = newSales?.categories ? toCheeseTotals(newSales.categories) : toCheeseTotals(newSales);
    const newProducts = cloneProductTotals(newSales?.products);
    let newTotal = clampCheeseValue(toSafeNumber(newSales?.total));
    if (!newTotal) {
        const sumCat = newCategories.BG + newCategories.ROOK + newCategories.GEIT;
        const sumProd = Object.values(newProducts).reduce((sum, value) => sum + value, 0);
        newTotal = sumCat || sumProd;
    }

    const deltaCategories = {
        BG: newCategories.BG - prevCategories.BG,
        ROOK: newCategories.ROOK - prevCategories.ROOK,
        GEIT: newCategories.GEIT - prevCategories.GEIT
    };

    ['BG', 'ROOK', 'GEIT'].forEach(key => {
        const current = toSafeNumber(mix.totals.categories[key]);
        const next = clampCheeseValue(current + deltaCategories[key]);
        mix.totals.categories[key] = next;
    });

    const updatedProducts = { ...mix.totals.products };
    const productKeys = new Set([...Object.keys(prevProducts), ...Object.keys(newProducts)]);
    productKeys.forEach(name => {
        const current = toSafeNumber(updatedProducts[name]);
        const delta = toSafeNumber(newProducts[name]) - toSafeNumber(prevProducts[name]);
        const next = clampCheeseValue(current + delta);
        if (next > 0) {
            updatedProducts[name] = next;
        } else {
            delete updatedProducts[name];
        }
    });
    mix.totals.products = updatedProducts;

    const catSum = mix.totals.categories.BG + mix.totals.categories.ROOK + mix.totals.categories.GEIT;
    const prodSum = Object.values(mix.totals.products).reduce((sum, value) => sum + value, 0);
    const deltaTotal = newTotal - prevTotal;
    mix.totals.total = clampCheeseValue(toSafeNumber(mix.totals.total) + deltaTotal) || catSum || prodSum;

    const updatedAt = newSales.calculatedAt || new Date().toISOString();
    mix.events[eventKey] = {
        categories: newCategories,
        products: newProducts,
        total: newTotal,
        updatedAt,
        calculatedAt: newSales.calculatedAt || updatedAt,
        source: cloneSalesSource(newSales.source)
    };

    const totalCat = mix.totals.categories.BG + mix.totals.categories.ROOK + mix.totals.categories.GEIT;
    mix.ratio.categories = totalCat > 0
        ? {
            BG: mix.totals.categories.BG / totalCat,
            ROOK: mix.totals.categories.ROOK / totalCat,
            GEIT: mix.totals.categories.GEIT / totalCat
        }
        : { BG: 0, ROOK: 0, GEIT: 0 };

    const totalProd = Object.values(mix.totals.products).reduce((sum, value) => sum + value, 0);
    mix.ratio.products = totalProd > 0
        ? Object.fromEntries(Object.entries(mix.totals.products).map(([name, value]) => [name, value / totalProd]))
        : {};

    mix.updatedAt = updatedAt;

    try {
        await persistCheeseMix(mix);
        store.state.db = store.state.db || {};
        store.state.db.verkoopMix = mix;
        store.emit?.('mix:updated', { eventId: eventKey, mix });
    } catch (err) {
        console.error('[POS] Cumulatieve verkoopmix bijwerken mislukt', err);
        showAlert('Verkoopmix niet bijgewerkt. Probeer later opnieuw.', 'warning');
    }
}

async function synchronizeEventEndStock(event, endValues, endProductsSnapshot) {
    if (!event) return;
    const busCandidate = event.bus || event.busId || event.ownerBus || null;
    if (!busCandidate) return;

    const finalSnapshot = computeEventEndProductSnapshot(event, endValues, endProductsSnapshot);

    try {
        const [{ db, saveVoorraad }, { setVoorraadForProduct }] = await Promise.all([
            import('./3_data.js'),
            import('./voorraad_utils.js')
        ]);

        const voorraad = db.voorraad && typeof db.voorraad === 'object' ? db.voorraad : (db.voorraad = {});
        const { key: busKey, bucket } = ensureVoorraadBucket(busCandidate, voorraad);
        if (!busKey || !bucket) return;

        if (!store.state.db) store.state.db = db;
        if (!store.state.db.voorraad) store.state.db.voorraad = voorraad;

        const catalog = getCheeseProductCatalog();

        const currentMap = new Map();
        Object.entries(bucket).forEach(([rawName, qty]) => {
            const product = resolveCheeseProduct(catalog, rawName);
            if (!product || !isCheeseProduct(product)) return;
            const canonical = product.naam || rawName;
            currentMap.set(canonical, clampCheeseValue(toSafeNumber(qty)));
        });

        const finalMap = new Map();
        Object.entries(finalSnapshot).forEach(([rawName, qty]) => {
            const product = resolveCheeseProduct(catalog, rawName);
            if (!product || !isCheeseProduct(product)) return;
            const canonical = product.naam || rawName;
            finalMap.set(canonical, clampCheeseValue(toSafeNumber(qty)));
        });

        const targetNames = new Set([...currentMap.keys(), ...finalMap.keys()]);
        if (!targetNames.size) {
            // geen kaas in voorraad en geen telling → niets bij te werken
            return;
        }

        let hasChanges = false;
        targetNames.forEach((name) => {
            const currentQty = currentMap.get(name) ?? 0;
            const targetQty = finalMap.get(name) ?? 0;
            if (currentQty !== targetQty) {
                hasChanges = true;
                setVoorraadForProduct(name, targetQty, busKey);
            }
        });

        if (!hasChanges) return;

        try {
            await saveVoorraad(busKey);
            store.emit?.('voorraad:updated', { busId: busKey, source: 'event-close' });
        } catch (err) {
            console.error('[POS] Voorraad opslaan na eindtelling mislukt', err);
            showAlert('Voorraad niet bijgewerkt naar eindtelling. Probeer later opnieuw.', 'warning');
        }
    } catch (err) {
        console.error('[POS] Voorraad synchronisatie na eindtelling mislukt', err);
    }
}

function computeEventEndProductSnapshot(event, endValues, endProductsSnapshot) {
    if (!event) return {};
    const telling = event.kaasTelling || {};
    const endTotals = toCheeseTotals(endValues || telling.end);
    const totalsHaveValues = Object.values(endTotals).some(value => Number.isFinite(value) && value > 0);

    const directSnapshot = sanitizeProductSnapshot(endProductsSnapshot || telling.endProducts);
    if (Object.keys(directSnapshot).length) {
        return directSnapshot;
    }

    const startTotals = toCheeseTotals(telling.start);
    const startSnapshot = sanitizeProductSnapshot(telling.startProducts);
    const busSnapshot = sanitizeProductSnapshot(getBusCheeseProductSnapshot(event?.bus));

    let baseSnapshot = startSnapshot;
    if (!Object.keys(baseSnapshot).length) {
        if (Object.keys(busSnapshot).length) {
            baseSnapshot = busSnapshot;
        } else {
            const startHasValues = Object.values(startTotals).some(value => Number.isFinite(value) && value > 0);
            baseSnapshot = startHasValues ? distributeCheeseTotalsToProducts(startTotals) : {};
        }
    }

    const buckets = createCheeseTypeBuckets();
    if (Object.keys(baseSnapshot).length) {
        addSnapshotToBuckets(buckets, baseSnapshot);
    }

    const supplements = normalizeSupplements(telling.supplements);
    const distributeSupplements = [];
    supplements.forEach(entry => {
        const productSnapshot = sanitizeProductSnapshot(entry.products);
        if (Object.keys(productSnapshot).length) {
            addSnapshotToBuckets(buckets, productSnapshot);
        } else {
            distributeSupplements.push(entry);
        }
    });
    if (distributeSupplements.length) {
        applySupplementsToBuckets(buckets, distributeSupplements);
    }

    const availableSnapshot = {};
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
        const bucket = buckets[type];
        if (!bucket) return;
        bucket.forEach((qty, name) => {
            const amount = clampCheeseValue(toSafeNumber(qty));
            if (amount > 0) {
                availableSnapshot[name] = (availableSnapshot[name] || 0) + amount;
            }
        });
    });

    if (!totalsHaveValues) {
        return {};
    }

    if (!Object.keys(availableSnapshot).length) {
        return sanitizeProductSnapshot(distributeCheeseTotalsToProducts(endTotals));
    }

    return sanitizeProductSnapshot(rebalanceSnapshotToTotals(availableSnapshot, endTotals));
}

function ensureVoorraadBucket(busId, voorraad) {
    if (!voorraad || typeof voorraad !== 'object') {
        return { key: null, bucket: null };
    }
    const keys = Object.keys(voorraad);
    if (busId) {
        const normalized = normalizeBusKey(busId);
        for (const key of keys) {
            if (normalizeBusKey(key) === normalized) {
                const bucket = voorraad[key] || (voorraad[key] = {});
                return { key, bucket };
            }
        }
        const bucket = voorraad[busId] || (voorraad[busId] = {});
        return { key: busId, bucket };
    }
    if (!keys.length) {
        return { key: null, bucket: null };
    }
    const key = keys[0];
    const bucket = voorraad[key] || (voorraad[key] = {});
    return { key, bucket };
}

function normalizeBusKey(value) {
    return String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

async function persistCheeseMix(mix) {
    const res = await apiFetch('/save_json.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'verkoopmix.json', data: mix })
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
    }
    try {
        await res.json();
    } catch {
        // ignore body parse issues; saving succeeded if status ok
    }
}

function isEventCompleted(ev) {
    const state = String(ev?.state || '').toLowerCase();
    return state === 'completed' || state === 'closed' || state === 'afgesloten' || ev?.afgerond === true;
}

function isEventActive(ev) {
    const state = String(ev?.state || '').toLowerCase();
    if (state === 'active') return true;
    if (isEventCompleted(ev)) return false;
    const today = toYMDString(new Date());
    const start = getEventStartDate(ev);
    const end = getEventEndDate(ev);
    return (!!start && start <= today && (!end || end >= today));
}

export { computeEventFinancials, calculateOmzetTotals, collectOmzetEntries, formatCurrencyValue, formatCurrencyPair };

function sortByEventDate(a, b) {
    const aDate = parseDateValue(getEventStartDate(a)) ?? parseDateValue(getEventEndDate(a)) ?? Infinity;
    const bDate = parseDateValue(getEventStartDate(b)) ?? parseDateValue(getEventEndDate(b)) ?? Infinity;
    if (aDate === bDate) return String(a?.naam || '').localeCompare(String(b?.naam || ''));
    return aDate - bDate;
}

function parseDateValue(ymd) {
    if (!ymd) return undefined;
    const d = new Date(ymd);
    return Number.isFinite(d.getTime()) ? d.getTime() : undefined;
}

function getEventStartDate(ev) {
    const candidates = [ev?.startdatum, ev?.startDatum, ev?.beginDatum, ev?.startDate, ev?.start];
    for (const val of candidates) {
        if (val) return normalizeDateString(val);
    }
    return null;
}

function getEventEndDate(ev) {
    const candidates = [ev?.einddatum, ev?.endDatum, ev?.endDate, ev?.eind];
    for (const val of candidates) {
        if (val) return normalizeDateString(val);
    }
    return null;
}

function normalizeDateString(value) {
    if (!value) return null;
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toYMDString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatEventPeriod(ev) {
    const start = getEventStartDate(ev);
    const end = getEventEndDate(ev);
    if (!start && !end) return '';
    if (start && !end) return formatDate(start);
    if (!start && end) return formatDate(end);
    if (start === end) return formatDate(start);
    return `${formatDate(start)} – ${formatDate(end)}`;
}

function formatDate(ymd) {
    if (!ymd) return '';
    const d = new Date(ymd);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleDateString('nl-NL');
}

function formatDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' });
}

function formatCurrency(amount, currency = 'USD') {
    if (!Number.isFinite(amount) || amount <= 0) return '';
    try {
        return new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(amount);
    } catch {
        return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
    }
}

function normalizePlanMix(raw) {
    const base = { BG: 0, ROOK: 0, GEIT: 0 };
    if (!raw || typeof raw !== 'object') return base;
    let total = 0;
    ['BG', 'ROOK', 'GEIT'].forEach(key => {
        const altKey = key.toLowerCase();
        const value = Math.max(0, toSafeNumber(raw?.[key] ?? raw?.[altKey]));
        base[key] = value;
        total += value;
    });
    if (!total) {
        return { BG: 1 / 3, ROOK: 1 / 3, GEIT: 1 / 3 };
    }
    return {
        BG: base.BG / total,
        ROOK: base.ROOK / total,
        GEIT: base.GEIT / total
    };
}

function formatPlanMix(raw) {
    const mix = normalizePlanMix(raw);
    const pct = key => `${Math.round((mix[key] || 0) * 100)}%`;
    return `BG ${pct('BG')} • ROOK ${pct('ROOK')} • GEIT ${pct('GEIT')}`;
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}


// ============ Doelvoortgang kaart ============

export function renderGoalProgressCards(eventsOverride = null) {
    const mount = document.getElementById('goalProgressMount');
    if (!mount) return;

    const source = Array.isArray(eventsOverride)
        ? eventsOverride
        : (Array.isArray(store.state.db?.evenementen) ? store.state.db.evenementen : []);

    const activeEvents = source.filter(ev => isEventActive(ev));
    const cards = activeEvents
        .map(ev => renderGoalProgressCard(ev))
        .filter(Boolean);

    if (!cards.length) {
        mount.innerHTML = `<div class="goal-progress-empty">Geen actieve evenementen met een doelstelling.</div>`;
        return;
    }

    mount.innerHTML = `<div class="goal-progress-deck">${cards.join('')}</div>`;
}

function renderGoalProgressCard(ev) {
    if (!ev) return '';

    const goal = buildGoalProgressSnapshot(ev);
    const location = ev?.locatie ? `<div class="goal-progress-location">📍 ${escapeHtml(ev.locatie)}</div>` : '';
    const percentBadge = goal.hasGoal ? `<span class="goal-progress-percent">${goal.percent}%</span>` : '';

    const progressHtml = goal.hasGoal
        ? `
            <div class="goal-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${escapeHtml(String(goal.targetAmount))}" aria-valuenow="${escapeHtml(String(goal.actualAmount))}" aria-label="Voortgang richting omzetdoel">
                <div class="goal-progress-fill" style="width:${goal.percent}%"></div>
            </div>
            <div class="goal-progress-totals">
                <span>${escapeHtml(goal.actualLabel)} omzet</span>
                <span>${escapeHtml(goal.targetLabel)} doel</span>
            </div>
            <div class="goal-progress-remaining">${goal.remainingAmount > 0 ? `${escapeHtml(goal.remainingLabel)} te gaan` : 'Doel bereikt 🎉'}</div>
        `
        : `<div class="goal-progress-empty-note">Stel een omzetdoel in om voortgang te zien.</div>`;

    const dailyHtml = `
        <div class="goal-progress-daily">
            <span class="goal-progress-daily__label">Gemiddeld per dag</span>
            <span class="goal-progress-daily__value">${escapeHtml(goal.dailyEuroLabel)}</span>
            ${goal.dailyMetaLabel ? `<span class="goal-progress-daily__meta">${escapeHtml(goal.dailyMetaLabel)}</span>` : ''}
        </div>
    `;

    const motivationHtml = goal.motivation.length
        ? `<ul class="goal-progress-motivation">${goal.motivation.map(line => `
                <li>
                    <span class="goal-progress-motivation__icon">${escapeHtml(line.icon || '✨')}</span>
                    <span>${escapeHtml(line.text)}</span>
                </li>
            `).join('')}</ul>`
        : '';

    const metaParts = [];
    if (goal.turnoverLabel) metaParts.push(escapeHtml(goal.turnoverLabel));
    if (goal.mixLabel) metaParts.push(escapeHtml(goal.mixLabel));
    const metaHtml = metaParts.length
        ? `<div class="goal-progress-meta">${metaParts.join(' • ')}</div>`
        : '';

    return `
        <article class="goal-progress-card${goal.hasGoal ? '' : ' goal-progress-card--empty'}" data-event-ref="${escapeHtml(String(ev?.id || ev?.naam || ''))}">
            <div class="goal-progress-head">
                <div class="goal-progress-title-block">
                    <h3 class="goal-progress-title">${escapeHtml(ev?.naam || 'Onbekend evenement')}</h3>
                    ${location}
                </div>
                ${percentBadge}
            </div>
            ${progressHtml}
            ${dailyHtml}
            ${motivationHtml}
            ${metaHtml}
        </article>
    `;
}

function buildGoalProgressSnapshot(ev) {
    const planning = ev?.planning || {};
    const expected = planning.expectedTurnover || {};
    const { currency: eventCurrency, exchangeRate } = determineEventCurrency(ev);

    const targetEUR = pickFirstPositive([
        expected?.eur,
        expected?.EUR,
        expected?.amountEUR,
        planning?.expectedTurnoverEUR,
        planning?.expectedRevenueEUR,
        planning?.expectedRevenue,
        planning?.turnoverEstimate,
        planning?.turnoverEstimateEUR,
        ev?.expectedTurnoverEUR,
        ev?.expectedRevenueEUR,
        ev?.expectedRevenue,
        ev?.verwachteOmzetEUR,
        ev?.verwachteOmzet
    ]);

    const targetUSD = pickFirstPositive([
        expected?.usd,
        expected?.USD,
        expected?.amountUSD,
        planning?.expectedTurnoverUSD,
        planning?.expectedRevenueUSD,
        planning?.turnoverEstimateUSD,
        ev?.expectedTurnoverUSD,
        ev?.expectedRevenueUSD
    ]);

    const currencyHint = typeof expected?.currency === 'string' ? expected.currency.trim().toUpperCase() : null;
    let targetAmount = 0;
    let targetCurrency = 'EUR';

    if (targetEUR > 0) {
        targetAmount = targetEUR;
        targetCurrency = 'EUR';
    }
    if (targetUSD > 0 && (!targetAmount || currencyHint === 'USD' || eventCurrency === 'USD')) {
        targetAmount = targetUSD;
        targetCurrency = 'USD';
    } else if (!targetAmount && targetUSD > 0) {
        targetAmount = targetUSD;
        targetCurrency = 'USD';
    }

    if (!targetAmount && currencyHint === 'USD') {
        targetCurrency = 'USD';
    } else if (!targetAmount && currencyHint === 'EUR') {
        targetCurrency = 'EUR';
    } else if (!targetAmount && eventCurrency) {
        targetCurrency = eventCurrency;
    }

    const totals = calculateOmzetTotals(ev, targetCurrency, exchangeRate);
    const actualAmount = roundCurrency(totals.revenueTarget);
    targetAmount = roundCurrency(targetAmount);
    const hasGoal = targetAmount > 0;
    const percent = hasGoal && targetAmount > 0
        ? Math.min(100, Math.round((actualAmount / targetAmount) * 100))
        : 0;
    const remainingAmount = hasGoal ? Math.max(0, roundCurrency(targetAmount - actualAmount)) : 0;

    const actualLabel = formatCurrencyValue(actualAmount, targetCurrency);
    const targetLabel = formatCurrencyValue(targetAmount, targetCurrency);
    const remainingLabel = formatCurrencyValue(remainingAmount, targetCurrency);

    const entryDates = new Set();
    collectOmzetEntries(ev).forEach(entry => {
        const ymd = normalizeOmzetEntryDate(entry);
        if (ymd) entryDates.add(ymd);
    });
    const recordedDays = entryDates.size;
    const daysForAverage = recordedDays || (totals.hasTurnover ? 1 : 0);

    let euroTotal = totals.revenueEUR;
    if ((!euroTotal || euroTotal <= 0) && totals.revenueUSD > 0 && Number.isFinite(exchangeRate) && exchangeRate > 0) {
        euroTotal = roundCurrency(totals.revenueUSD * exchangeRate);
    }

    const euroPerDayValue = daysForAverage ? roundCurrency(euroTotal / daysForAverage) : 0;
    const dailyEuroLabel = formatCurrencyValue(euroPerDayValue, 'EUR');

    let dailyMetaLabel = '';
    if (recordedDays > 1) {
        dailyMetaLabel = `${recordedDays} dagen geregistreerd`;
    } else if (recordedDays === 1) {
        dailyMetaLabel = 'Op basis van 1 dag';
    } else if (totals.hasTurnover) {
        dailyMetaLabel = 'Op basis van recente omzet';
    } else {
        dailyMetaLabel = 'Nog geen omzet geregistreerd';
    }

    const turnoverParts = [];
    if (targetEUR > 0) turnoverParts.push(formatCurrencyValue(targetEUR, 'EUR'));
    if (targetUSD > 0) turnoverParts.push(formatCurrencyValue(targetUSD, 'USD'));

    const mixLabel = planning.mixSnapshot ? `Mix: ${formatPlanMix(planning.mixSnapshot)}` : '';
    const motivation = buildGoalMotivationLines({
        hasGoal,
        percent,
        remainingLabel: hasGoal ? remainingLabel : '',
        hasTurnover: totals.hasTurnover
    });

    return {
        hasGoal,
        percent,
        targetAmount,
        actualAmount,
        remainingAmount,
        actualLabel,
        targetLabel,
        remainingLabel,
        turnoverLabel: turnoverParts.join(' • '),
        mixLabel,
        dailyEuroLabel,
        dailyMetaLabel,
        motivation,
        hasTurnover: totals.hasTurnover
    };
}

function pickFirstPositive(values) {
    for (const value of values) {
        const num = toSafeNumber(value);
        if (Number.isFinite(num) && num > 0) {
            return num;
        }
    }
    return 0;
}

function buildGoalMotivationLines({ hasGoal, percent, remainingLabel, hasTurnover }) {
    const lines = [];

    if (hasGoal) {
        if (percent >= 100) {
            lines.push({ icon: '🎉', text: 'Doel gehaald! Vier het en upsell souvenirs voor extra marge.' });
        } else if (percent >= 75) {
            lines.push({ icon: '🚀', text: 'Bijna binnen – plan een mini-actie om over de streep te gaan.' });
        } else if (percent >= 50) {
            lines.push({ icon: '🔥', text: 'Halverwege! Houd je tempo en blijf proeven aanbieden.' });
        } else if (percent >= 25) {
            lines.push({ icon: '💡', text: 'Sterke start – spreek actief bezoekers aan voor de volgende sales.' });
        } else {
            lines.push({ icon: '🏁', text: 'Zet kleine uurdoelen neer en maak elke klant bijzonder.' });
        }

        if (percent < 100 && remainingLabel) {
            lines.push({ icon: '🎯', text: `Nog ${remainingLabel} te gaan – focus op je piekmomenten.` });
        } else if (percent >= 100) {
            lines.push({ icon: '🌟', text: 'Gebruik het momentum en bouw aan loyale fans.' });
        }
    } else if (hasTurnover) {
        lines.push({ icon: '🚀', text: 'Mooi werk! Stel nu een doel om gericht te blijven vlammen.' });
    } else {
        lines.push({ icon: '🎯', text: 'Stel vandaag een omzetdoel en deel het met het team.' });
    }

    const tail = [
        { icon: '🤝', text: 'Nodig elke bezoeker uit voor een proefplankje.' },
        { icon: '🧀', text: 'Vertel het verhaal achter je topkazen voor extra beleving.' },
        { icon: '📈', text: 'Registreer omzet direct zodat iedereen realtime inzicht heeft.' }
    ];

    for (const item of tail) {
        if (lines.length >= 3) break;
        if (!lines.some(existing => existing.text === item.text)) {
            lines.push(item);
        }
    }

    return lines.slice(0, 3);
}

function formatCheeseAmount(value) {
    const safe = Number.isFinite(value) && value > 0 ? value : 0;
    return `${safe.toLocaleString('nl-NL')} stuks`;
}


// ============ Upcoming Events Card ============

function initUpcomingEventsWatcher() {
    const mount = document.getElementById('salesMount');
    if (!mount) return;
    const observer = new MutationObserver(renderUpcomingEventsCard);
    observer.observe(mount, { childList: true });
    renderUpcomingEventsCard();
}

function renderUpcomingEventsCard() {
    const mount = document.getElementById('salesMount');
    if (!mount) return;

    const hasSales = mount.querySelector('.sale-btn');
    const existing = document.getElementById('upcomingEventsCard');
    if (hasSales) {
        if (existing) existing.remove();
        return;
    }
    if (existing) return; // al zichtbaar

    const today = new Date().toISOString().split('T')[0];
    const events = (store.state.db?.evenementen || [])
        .filter(e => e.startdatum && e.startdatum >= today)
        .sort((a,b) => a.startdatum.localeCompare(b.startdatum))
        .slice(0, 4);
    if (!events.length) return;

    const card = document.createElement('div');
    card.id = 'upcomingEventsCard';
    card.className = 'upcoming-card';
    const list = events.map(ev => `<li><strong>${ev.startdatum}</strong> ${ev.naam}</li>`).join('');
    card.innerHTML = `<h3>🎪 Binnenkort</h3><ul>${list}</ul>`;
    mount.appendChild(card);
}


// ============ Sessie Meta Modal ============

// ============ Daginfo panel ============

export function renderActiveDayPanel() {
    const panel = document.getElementById('panel-daginfo');
    if (!panel) return;

    const activeDay = store.getActiveEventDay?.();
    if (!activeDay) {
        panel.innerHTML = '<div class="panel-card muted">Geen actieve dag geselecteerd. Kies een evenement in het dashboard om daginfo te bekijken.</div>';
        return;
    }

    const evt = resolveActiveEventRecord() || {};
    const mutationTotals = aggregateEventMutationTotals(evt);
    const categoryChips = buildDayinfoCategoryChips(mutationTotals.categories);
    const topProducts = buildDayinfoTopProducts(mutationTotals.products);
    const busLabel = store.state.session?.busId || store.state.session?.meta?.bus || '';
    const userName = store.state.session?.user?.naam || store.state.session?.user?.name || '';

    const rows = [
        ['Evenement', evt.naam || activeDay.eventName || '-'],
        ['Locatie', evt.locatie || activeDay.meta?.locatie || '-'],
        ['Dag', formatFullDate(activeDay.date)],
        ['Periode', formatRangeLabel(activeDay.range)],
        ['Valuta', (activeDay.currency || 'USD').toUpperCase()],
        ['Wisselkoers', activeDay.exchangeRate ? `1 USD = € ${Number(activeDay.exchangeRate).toFixed(3)}` : 'n.v.t.']
    ].map(([label, value]) => `<div class="meta-row"><strong>${label}</strong><span>${value || '-'}</span></div>`).join('');

    const notes = [];
    if (evt.state && String(evt.state).toLowerCase() !== 'active') {
        notes.push(`Status: ${evt.state}`);
    }
    if (evt.type) notes.push(`Type: ${evt.type}`);

    panel.innerHTML = `
        <section class="panel-card dayinfo-hero">
            <header class="dayinfo-hero__header">
                <div>
                    <p class="dayinfo-hero__eyebrow">Vandaag</p>
                    <h2 class="dayinfo-hero__title">${escapeHtml(evt.naam || activeDay.eventName || 'Actieve dag')}</h2>
                    <p class="dayinfo-hero__meta">${escapeHtml(evt.locatie || activeDay.meta?.locatie || 'Onbekende locatie')} • ${escapeHtml(formatFullDate(activeDay.date))}</p>
                </div>
                <div class="dayinfo-hero__badges">
                    ${userName ? `<span class="dayinfo-badge">👤 ${escapeHtml(userName)}</span>` : ''}
                    ${busLabel ? `<span class="dayinfo-badge">🚌 Bus ${escapeHtml(String(busLabel).toUpperCase())}</span>` : ''}
                    <span class="dayinfo-badge">⚡ ${mutationTotals.total || 0} verkopen</span>
                    ${mutationTotals?.transfers?.total ? `<span class="dayinfo-badge dayinfo-badge--transfer">↔︎ ${mutationTotals.transfers.total} verplaatst</span>` : ''}
                </div>
            </header>
            <div class="dayinfo-hero__chips">${categoryChips}</div>
            <div class="dayinfo-hero__actions">
                <button type="button" class="dayinfo-action" data-day-action="quickSale">⚡ Snelle verkoop</button>
                <button type="button" class="dayinfo-action" data-day-action="omzet">💶 Dagomzet</button>
                <button type="button" class="dayinfo-action" data-day-action="voorraad">📦 Voorraad</button>
                <button type="button" class="dayinfo-action" data-day-action="planner">🧾 Paklijst</button>
            </div>
        </section>
        <section class="panel-card dayinfo-meta">
            <h3>Details</h3>
            <div class="meta-grid">${rows}</div>
            ${notes.length ? `<p class="muted" style="margin-top:.8rem">${notes.join(' • ')}</p>` : ''}
        </section>
        <section class="panel-card dayinfo-sales">
            <div class="dayinfo-sales__header">
                <h3>Verkoopmix live</h3>
                <span class="dayinfo-sales__total">Totaal ${mutationTotals.total || 0} stuks</span>
            </div>
            ${topProducts}
        </section>
    `;

    const actionMap = {
        quickSale: () => openQuickSaleModal(),
        omzet: () => navigationActionHandler('dagomzet'),
        voorraad: () => navigationActionHandler('voorraad'),
        planner: () => navigationActionHandler('reis')
    };

    panel.querySelectorAll('[data-day-action]').forEach((button) => {
        button.addEventListener('click', () => {
            const type = button.dataset.dayAction;
            const handler = actionMap[type];
            if (typeof handler === 'function') {
                handler();
            }
        });
    });
}

function buildDayinfoCategoryChips(categories = {}) {
    const order = [
        { key: 'BG', label: 'Boerenkaas' },
        { key: 'ROOK', label: 'Rook' },
        { key: 'GEIT', label: 'Geit' }
    ];
    return order
        .map(({ key, label }) => {
            const value = Number(categories?.[key] || 0);
            const safeValue = Number.isFinite(value) ? value : 0;
            return `
                <span class="dayinfo-chip" data-type="${key}">
                    <strong>${safeValue}</strong>
                    <span>${label}</span>
                </span>
            `;
        })
        .join('');
}

function buildDayinfoTopProducts(products = {}) {
    const catalog = getCheeseProductCatalog();
    const entries = Object.entries(products || {})
        .map(([key, qty]) => ({ key, qty: Number(qty) || 0 }))
        .filter((entry) => entry.qty > 0)
        .map((entry) => {
            const product = resolveCheeseProduct(catalog, entry.key) || {};
            const name = product.naam || product.name || entry.key;
            const type = normalizeCheeseType(product.type) || inferCheeseTypeFromName(name) || '';
            return { ...entry, label: name, type };
        })
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);

    if (!entries.length) {
        return '<p class="dayinfo-sales__empty muted">Nog geen snelle verkoop geregistreerd.</p>';
    }

    const listItems = entries
        .map((entry) => {
            const typeLabel = entry.type ? `<span class="dayinfo-mix__type">${entry.type}</span>` : '';
            return `
                <li class="dayinfo-mix__item">
                    <span class="dayinfo-mix__label">${escapeHtml(entry.label)}${typeLabel}</span>
                    <span class="dayinfo-mix__qty">${entry.qty}</span>
                </li>
            `;
        })
        .join('');

    return `<ol class="dayinfo-mix-list">${listItems}</ol>`;
}

store.on('activeDay:changed', renderActiveDayPanel);
store.on('events:updated', renderActiveDayPanel);
store.on('db:loaded', renderActiveDayPanel);

// ============ Styles (eenmalig injecteren) ============

function injectCoreStylesOnce() {
    if (document.getElementById('core-ui-styles')) return;
    document.head.insertAdjacentHTML('beforeend', `
        <style id="core-ui-styles">
            /* Globals */
            body { margin: 0; background: #f4f5f7; font-family: sans-serif; }
            #app { display: flex; flex-direction: column; min-height: 100vh; }
            .app-main {
                flex-grow: 1;
                padding: 1rem;
                padding-bottom: calc(5rem + env(safe-area-inset-bottom));
                display: flex;
                flex-direction: column;
                gap: .7rem;
            }
            .app-panel { display: none; flex-direction: column; gap: .8rem; }
            .app-panel-active { display: flex; }
            .panel-stack { display: flex; flex-direction: column; gap: 1rem; }
            .panel-card { background:#fff; border-radius:1rem; padding:1.1rem 1.2rem; box-shadow:0 8px 18px rgba(0,0,0,.08); }
            .panel-header { display:flex; justify-content:space-between; align-items:center; gap:.8rem; }
            .panel-actions { display:flex; gap:.5rem; flex-wrap:wrap; }
            .panel-footer { margin-top:1rem; display:flex; gap:.5rem; justify-content:flex-end; flex-wrap:wrap; }
            .btn-primary { background:#2A9626; color:#fff; border:none; border-radius:999px; padding:.55rem 1.2rem; font-weight:700; cursor:pointer; }
            .btn-secondary { background:#FFC500; color:#1b1b1b; border:none; border-radius:999px; padding:.55rem 1.2rem; font-weight:700; cursor:pointer; }
            .btn-ghost { background:rgba(42,150,38,.12); color:#1F6D1C; border:none; border-radius:999px; padding:.5rem 1.2rem; font-weight:700; cursor:pointer; }
            .btn-danger { background:#ef4444; color:#fff; border:none; border-radius:999px; padding:.5rem 1.2rem; font-weight:700; cursor:pointer; }
            .muted { color:#6b7280; }
            .panel-card.error { background:#fee2e2; color:#7f1d1d; }
            .meta-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:.6rem; margin-top:.8rem; }
            .meta-row { display:flex; flex-direction:column; gap:.2rem; background:#f9fafb; border-radius:.8rem; padding:.6rem .7rem; }
            .user-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:.7rem; }
            .user-row { display:flex; justify-content:space-between; align-items:center; gap:.8rem; background:#f9fafb; border-radius:.9rem; padding:.7rem .9rem; flex-wrap:wrap; }
            .user-meta span { font-size:.85rem; color:#4b5563; }
            .user-actions { display:flex; gap:.4rem; flex-wrap:wrap; }

            /* Topbar */
            .app-topbar {
                position: sticky; top: 0; z-index: 50; display: flex; align-items: center; justify-content: space-between;
                background: linear-gradient(180deg, rgba(255,255,255,.96) 0%, rgba(245,247,244,.92) 100%);
                color: #123f16; padding: .7rem 1rem; box-shadow: 0 10px 30px rgba(20,65,25,.12);
            }
            .tb-left { display: flex; align-items: center; gap: 1rem; min-width: 0; flex: 1; }
            .tb-right { display: flex; align-items: center; gap: .75rem; }
            .tb-event { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: .75rem; border: none; background: rgba(255,255,255,.9); border-radius: 18px; padding: .65rem .9rem; box-shadow: inset 0 0 0 1px rgba(20,65,25,.12); cursor: pointer; font: inherit; color: #123f16; text-align: left; min-width: 0; }
            .tb-event--empty { opacity: .8; cursor: default; }
            .tb-event__icon { font-size: 1.3rem; }
            .tb-event__content { display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
            .tb-event__title { font-size: 1rem; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .tb-event__meta { font-size: .78rem; font-weight: 600; color: #4b5d4f; }
            .tb-event__cta { font-size: .72rem; font-weight: 800; color: #1F6D1C; text-transform: uppercase; letter-spacing: .05em; }
            .tb-context { display: flex; align-items: center; gap: .5rem; }
            .tb-chip { display: flex; align-items: center; gap: .4rem; background: rgba(255,255,255,.92); border-radius: 999px; padding: .35rem .75rem; box-shadow: inset 0 0 0 1px rgba(20,65,25,.1); }
            .tb-chip__icon { font-size: 1rem; }
            .tb-chip__content { display: flex; flex-direction: column; line-height: 1.1; }
            .tb-chip__title { font-weight: 700; font-size: .85rem; }
            .tb-chip__meta { font-size: .7rem; color: #4b5d4f; font-weight: 600; }
            .net { width: 12px; height: 12px; border-radius: 50%; box-shadow: 0 0 0 4px rgba(42,150,38,.12); border: 2px solid #fff; }
            .net.ok { background: #2A9626; } .net.off { background: #E74C3C; }

            /* Bottom navigation */
            .app-bottom-nav {
                position: sticky;
                bottom: 0;
                z-index: 60;
                display: flex;
                gap: .4rem;
                padding: .45rem;
                background: rgba(255,255,255,.96);
                border-top: 1px solid rgba(0,0,0,.08);
                backdrop-filter: blur(16px);
                overflow-x: auto;
                scroll-snap-type: x proximity;
            }
            .app-bottom-nav::-webkit-scrollbar { display: none; }
            .app-bottom-nav button {
                flex: 1 0 auto;
                min-width: 88px;
                background: transparent;
                border: none;
                border-radius: .9rem;
                padding: .45rem .5rem;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: .15rem;
                font-weight: 700;
                color: #1f2937;
                font-size: .85rem;
                cursor: pointer;
                scroll-snap-align: center;
                transition: background .2s ease, color .2s ease;
            }
            .app-bottom-nav button .icon { font-size: 1.25rem; }
            .app-bottom-nav button .badge { position: absolute; top: .35rem; right: .6rem; min-width: 1.2rem; padding: .1rem .35rem; border-radius: 999px; background: rgba(255,197,0,.92); color: #1a2f1e; font-size: .65rem; font-weight: 800; letter-spacing: .04em; box-shadow: 0 2px 6px rgba(0,0,0,.18); display: inline-flex; justify-content: center; align-items: center; }
            .badge--hidden { display: none !important; }
            .app-bottom-nav button:active { background: rgba(42,150,38,.12); color: #1F6D1C; }
            .app-bottom-nav button.active { background: rgba(42,150,38,.18); color: #1F6D1C; }
            .app-bottom-nav button:disabled {
                opacity: .4;
                cursor: not-allowed;
                background: transparent;
            }

            @media (min-width: 900px) {
                .app-main { padding: 1.5rem 2rem calc(5rem + env(safe-area-inset-bottom)); }
                .app-bottom-nav { justify-content: center; gap: .6rem; }
                .app-bottom-nav button { max-width: 120px; }
            }

            /* Dashboard */
            .dashboard-layout { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1fr); }
            .dashboard-layout > * { min-width: 0; }
            #dashboardEventsMount,
            #goalProgressMount,
            #reisPlannerMount,
            #salesMount { grid-column: 1 / -1; }
            .dashboard-layout { display: flex; flex-direction: column; gap: 1rem; }
            .dashboard-summary { display: flex; flex-direction: column; gap: .85rem; }
            .dashboard-summary-grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
            .dashboard-summary-grid--compact { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
            .dashboard-summary-card { background: #fff; border-radius: 1rem; padding: 1rem; box-shadow: 0 8px 18px rgba(0,0,0,.08); border: 1px solid rgba(0,0,0,.04); display: flex; flex-direction: column; gap: .45rem; }
            .dashboard-summary-card--accent { background: rgba(255,197,0,.18); border-color: rgba(255,197,0,.4); }
            .dashboard-summary-card__label { font-size: .78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: #5b6a62; }
            .dashboard-summary-card__value { font-size: 1.4rem; font-weight: 900; color: #143814; }
            .dashboard-summary-card__value--positive { color: #1F6D1C; }
            .dashboard-summary-card__value--negative { color: #C62828; }
            .dashboard-summary-card__meta { font-size: .78rem; font-weight: 700; color: #53645c; }
            .dashboard-summary-card__cta { margin-top: .2rem; align-self: flex-start; border: none; border-radius: .8rem; padding: .45rem .85rem; font-weight: 800; font-size: .86rem; background: #2A9626; color: #fff; cursor: pointer; }
            .dashboard-summary-card__cta:focus-visible { outline: 3px solid rgba(42,150,38,.3); outline-offset: 2px; }
            .dashboard-action-card, .dashboard-highlights { background: #fff; border-radius: 1rem; padding: 1rem; box-shadow: 0 10px 20px rgba(0,0,0,.08); border: 1px solid rgba(0,0,0,.04); display: flex; flex-direction: column; gap: .75rem; }
            .dashboard-card-head { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
            .dashboard-card-head h2 { margin: 0; font-weight: 900; color: #194a1f; font-size: 1.05rem; }
            .dashboard-card-head__meta { font-size: .78rem; font-weight: 800; color: #65716c; text-transform: uppercase; letter-spacing: .05em; }
            .dashboard-empty-note { margin: 0; font-size: .85rem; font-weight: 700; color: #65716c; }
            .dashboard-task-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .6rem; }
            .dashboard-task { width: 100%; display: flex; align-items: center; gap: .65rem; padding: .75rem .85rem; border-radius: .9rem; border: 1px solid rgba(0,0,0,.05); background: rgba(25,74,31,.05); text-align: left; font: inherit; color: #143814; transition: transform .15s ease, box-shadow .15s ease; }
            .dashboard-task[data-task-event], .dashboard-task[data-task-nav] { cursor: pointer; }
            div.dashboard-task { cursor: default; }
            .dashboard-task:hover { transform: translateY(-1px); box-shadow: 0 10px 18px rgba(0,0,0,.08); }
            div.dashboard-task:hover { transform: none; box-shadow: none; }
            .dashboard-task__icon { font-size: 1.4rem; }
            .dashboard-task__content { display: flex; flex-direction: column; gap: .2rem; flex: 1; }
            .dashboard-task__title { font-size: .95rem; font-weight: 800; }
            .dashboard-task__meta { font-size: .8rem; font-weight: 600; color: #52635b; }
            .dashboard-task__cta { font-size: .78rem; font-weight: 800; color: #2A9626; }
            .dashboard-task--critical { border-color: #C62828; background: rgba(198,40,40,.08); }
            .dashboard-task--high { border-color: #FFC500; background: rgba(255,197,0,.16); }
            .dashboard-task--info { border-color: rgba(42,150,38,.25); }
            .dashboard-highlight-grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
            .dashboard-highlight-card { background: rgba(25,74,31,.06); border-radius: .85rem; padding: .75rem .85rem; display: flex; flex-direction: column; gap: .35rem; }
            .dashboard-highlight-card__icon { font-size: 1.35rem; }
            .dashboard-highlight-card__value { font-weight: 900; font-size: 1.05rem; color: #143814; margin: 0; }
            .dashboard-highlight-card__meta { font-size: .8rem; font-weight: 700; color: #52635b; margin: 0; }
            .dashboard-highlight-actions { display: flex; gap: .5rem; flex-wrap: wrap; }
            .dashboard-highlight-actions .btn-secondary { border-radius: .8rem; font-weight: 800; }
            #salesMount { display: flex; flex-direction: column; gap: .8rem; }
            .dashboard-more { background: #fff; border-radius: 1rem; border: 1px solid rgba(0,0,0,.04); box-shadow: 0 8px 18px rgba(0,0,0,.08); overflow: hidden; }
            .dashboard-more__toggle { width: 100%; border: none; display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .9rem 1rem; font-weight: 900; font-size: .98rem; background: linear-gradient(90deg, rgba(255,197,0,.16), rgba(42,150,38,.16)); cursor: pointer; }
            .dashboard-more__toggle--open .dashboard-more__chevron { transform: rotate(180deg); }
            .dashboard-more__chevron { transition: transform .15s ease; }
            .dashboard-more__content { padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
            .dashboard-v2 { gap: 1.2rem; }
            .dashboard-layer { display: flex; flex-direction: column; gap: .85rem; }
            .dashboard-layer__header { display: flex; justify-content: space-between; align-items: flex-end; gap: .6rem; flex-wrap: wrap; }
            .dashboard-layer__eyebrow { margin: 0; font-size: .7rem; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: #5b6a62; }
            .dashboard-layer__title { margin: 0; font-size: 1.15rem; font-weight: 900; color: #194a1f; }
            .dashboard-layer__meta { font-size: .8rem; font-weight: 700; color: #65716c; }
            .dashboard-layer-grid { display: grid; gap: .8rem; grid-template-columns: minmax(0, 1fr); }
            .dashboard-layer-grid--two { grid-template-columns: minmax(0, 1fr); }
            .dashboard-card { background: #fff; border-radius: 1rem; padding: 1rem; box-shadow: 0 10px 20px rgba(0,0,0,.08); border: 1px solid rgba(0,0,0,.04); display: flex; flex-direction: column; gap: .6rem; }
            .dashboard-card--clickable { cursor: pointer; transition: transform .15s ease, box-shadow .15s ease; }
            .dashboard-card--clickable:hover { transform: translateY(-2px); box-shadow: 0 16px 24px rgba(0,0,0,.12); }
            .dashboard-card__head { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
            .dashboard-card__head h3 { margin: 0; font-weight: 900; color: #143814; font-size: 1rem; }
            .dashboard-card__meta { font-size: .78rem; font-weight: 700; color: #65716c; }
            .dashboard-empty-card { background: #fff; border-radius: 1rem; padding: 1.2rem; box-shadow: inset 0 0 0 1px rgba(0,0,0,.05); text-align: center; }
            .dashboard-empty-card h2 { margin: 0 0 .3rem; font-weight: 900; color: #194a1f; }
            .dashboard-empty-card p { margin: 0; color: #65716c; font-weight: 700; }
            .dashboard-today-strip { display: flex; gap: .7rem; overflow-x: auto; padding-bottom: .2rem; }
            .dashboard-today-strip::-webkit-scrollbar { display: none; }
            .dashboard-event-chip { min-width: 170px; background: #fff; border-radius: .9rem; padding: .7rem .8rem; border: 1px solid rgba(0,0,0,.06); box-shadow: 0 6px 14px rgba(0,0,0,.08); display: flex; flex-direction: column; gap: .35rem; text-align: left; cursor: pointer; }
            .dashboard-event-chip.is-selected { border-color: rgba(42,150,38,.55); box-shadow: 0 0 0 2px rgba(42,150,38,.18); }
            .dashboard-event-chip__title { font-weight: 800; color: #143814; font-size: .95rem; }
            .dashboard-event-chip__meta { font-size: .75rem; color: #5b6a62; font-weight: 600; }
            .dashboard-event-chip__badges { display: flex; gap: .35rem; flex-wrap: wrap; }
            .dashboard-chip-badge { font-size: .7rem; font-weight: 800; padding: .2rem .55rem; border-radius: 999px; background: rgba(255,197,0,.25); color: #805400; }
            .dashboard-chip-badge.ok { background: rgba(42,150,38,.18); color: #1F6D1C; }
            .dashboard-chip-badge.warn { background: rgba(255,197,0,.25); color: #805400; }
            .dashboard-progress { display: flex; flex-direction: column; gap: .45rem; }
            .dashboard-progress__bar { background: rgba(42,150,38,.12); border-radius: .75rem; height: .65rem; overflow: hidden; }
            .dashboard-progress__fill { background: #2A9626; height: 100%; }
            .dashboard-progress__labels { display: flex; justify-content: space-between; font-weight: 800; font-size: .85rem; color: #35513a; }
            .dashboard-progress__meta { font-size: .78rem; font-weight: 700; color: #65716c; }
            .dashboard-action-row { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
            .dashboard-btn { border: none; border-radius: .8rem; padding: .6rem .9rem; font-weight: 800; font-size: .9rem; cursor: pointer; }
            .dashboard-btn.primary { background: #2A9626; color: #fff; }
            .dashboard-btn.secondary { background: rgba(42,150,38,.12); color: #1F6D1C; }
            .dashboard-btn.ghost { background: rgba(255,197,0,.2); color: #5a4800; }
            .dashboard-input { width: 100%; border-radius: .8rem; border: 1px solid rgba(0,0,0,.12); padding: .6rem .75rem; font-weight: 700; font-size: .95rem; color: #143814; }
            .dashboard-input:focus { outline: none; border-color: #2A9626; box-shadow: 0 0 0 3px rgba(42,150,38,.15); }
            .dashboard-arap { display: grid; gap: .6rem; }
            .dashboard-arap__item { border: none; border-radius: .8rem; background: rgba(25,74,31,.06); padding: .6rem .7rem; display: flex; flex-direction: column; gap: .25rem; text-align: left; cursor: pointer; }
            .dashboard-arap__label { font-size: .75rem; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: #5b6a62; }
            .dashboard-arap__item strong { font-size: 1.1rem; font-weight: 900; color: #143814; }
            .dashboard-forecast { gap: .75rem; }
            .dashboard-forecast__chart { width: 100%; height: 180px; }
            .dashboard-forecast__summary { display: flex; flex-direction: column; gap: .2rem; font-weight: 800; color: #143814; }
            .dashboard-forecast__hint { font-size: .78rem; color: #65716c; font-weight: 700; }
            .dashboard-forecast-sliders { display: flex; flex-direction: column; gap: .6rem; }
            .dashboard-toggle { border: none; background: rgba(255,197,0,.2); border-radius: .85rem; padding: .55rem .8rem; font-weight: 900; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
            .dashboard-toggle__chevron { transition: transform .15s ease; }
            .dashboard-toggle.is-open .dashboard-toggle__chevron { transform: rotate(180deg); }
            .dashboard-forecast-sliders__panel { display: flex; flex-direction: column; gap: .75rem; max-height: 320px; overflow-y: auto; padding-right: .2rem; }
            .dashboard-slider { background: rgba(25,74,31,.05); border-radius: .85rem; padding: .7rem; display: flex; flex-direction: column; gap: .4rem; }
            .dashboard-slider__head { display: flex; justify-content: space-between; gap: .5rem; }
            .dashboard-slider__title { margin: 0; font-weight: 800; color: #143814; font-size: .92rem; }
            .dashboard-slider__meta { margin: .1rem 0 0; font-size: .75rem; color: #65716c; font-weight: 700; }
            .dashboard-slider__sub { margin: .1rem 0 0; font-size: .72rem; font-weight: 700; color: #52635b; }
            .dashboard-slider__values { display: flex; justify-content: space-between; font-size: .78rem; font-weight: 700; color: #35513a; }
            .dashboard-icon-btn { border: none; background: #fff; border-radius: .6rem; padding: .3rem .45rem; font-weight: 900; cursor: pointer; }
            .dashboard-slider-actions { display: flex; gap: .5rem; flex-wrap: wrap; }
            .dashboard-risk-summary ul { list-style: none; padding: 0; margin: .5rem 0 0; display: flex; flex-direction: column; gap: .35rem; }
            .dashboard-risk-summary li { display: flex; justify-content: space-between; font-weight: 700; font-size: .82rem; color: #35513a; }
            .dashboard-segment { display: inline-flex; border-radius: 999px; background: rgba(25,74,31,.08); padding: .2rem; gap: .2rem; }
            .dashboard-segment__btn { border: none; background: transparent; padding: .25rem .6rem; border-radius: 999px; font-weight: 800; font-size: .75rem; cursor: pointer; color: #35513a; }
            .dashboard-segment__btn.active { background: #2A9626; color: #fff; }
            .dashboard-mix-list { display: flex; flex-direction: column; gap: .5rem; }
            .dashboard-mix-item { display: grid; grid-template-columns: 1fr auto; gap: .35rem; font-weight: 700; font-size: .82rem; color: #35513a; }
            .dashboard-mix-bar { grid-column: 1 / -1; height: .4rem; background: rgba(42,150,38,.12); border-radius: 999px; overflow: hidden; }
            .dashboard-mix-bar__fill { height: 100%; background: #2A9626; }

            @media (min-width: 860px) {
                .dashboard-layer-grid--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .dashboard-arap { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .dashboard-forecast__summary { flex-direction: row; justify-content: space-between; }
            }

            /* Daginfo hero */
            .dayinfo-hero { display: flex; flex-direction: column; gap: 1rem; background: linear-gradient(145deg, rgba(42,150,38,.18) 0%, rgba(255,197,0,.18) 100%); border: 1px solid rgba(20,65,25,.08); }
            .dayinfo-hero__header { display: flex; flex-direction: column; gap: .6rem; }
            @media (min-width: 720px) { .dayinfo-hero__header { flex-direction: row; justify-content: space-between; align-items: flex-start; } }
            .dayinfo-hero__eyebrow { margin: 0; text-transform: uppercase; letter-spacing: .08em; font-size: .72rem; font-weight: 800; color: #315539; }
            .dayinfo-hero__title { margin: 0; font-size: clamp(1.35rem, 5vw, 1.75rem); font-weight: 900; color: #123f16; }
            .dayinfo-hero__meta { margin: 0; font-size: .88rem; font-weight: 600; color: #315539; }
            .dayinfo-hero__badges { display: flex; flex-wrap: wrap; gap: .35rem; }
            .dayinfo-badge { display: inline-flex; align-items: center; gap: .35rem; background: rgba(255,255,255,.85); border-radius: 999px; padding: .3rem .75rem; font-weight: 700; font-size: .78rem; box-shadow: inset 0 0 0 1px rgba(20,65,25,.12); }
            .dayinfo-hero__chips { display: flex; gap: .5rem; flex-wrap: wrap; }
            .dayinfo-chip { display: inline-flex; flex-direction: column; gap: .15rem; background: rgba(255,255,255,.9); border-radius: .9rem; padding: .5rem .75rem; box-shadow: inset 0 0 0 1px rgba(20,65,25,.08); min-width: 94px; }
            .dayinfo-chip strong { font-size: 1.05rem; font-weight: 800; color: #123f16; }
            .dayinfo-chip span { font-size: .72rem; font-weight: 600; color: #45614b; }
            .dayinfo-hero__actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: .5rem; }
            .dayinfo-action { border: none; border-radius: .9rem; padding: .6rem .8rem; font-weight: 800; font-size: .9rem; display: inline-flex; justify-content: center; align-items: center; gap: .45rem; background: rgba(255,255,255,.92); box-shadow: inset 0 0 0 1px rgba(20,65,25,.08); cursor: pointer; }
            .dayinfo-action:hover { box-shadow: inset 0 0 0 1px rgba(20,65,25,.18); }
            .dayinfo-meta h3, .dayinfo-sales h3 { margin: 0 0 .75rem 0; font-size: 1.05rem; font-weight: 800; color: #123f16; }
            .dayinfo-sales__header { display: flex; justify-content: space-between; align-items: center; gap: .6rem; margin-bottom: .75rem; }
            .dayinfo-sales__total { font-size: .82rem; font-weight: 700; color: #45614b; }
            .dayinfo-sales__empty { margin: .5rem 0 0; }
            .dayinfo-mix-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
            .dayinfo-mix__item { display: flex; justify-content: space-between; align-items: center; gap: .75rem; padding: .55rem .75rem; border-radius: .9rem; background: rgba(255,255,255,.85); box-shadow: inset 0 0 0 1px rgba(20,65,25,.08); font-weight: 700; }
            .dayinfo-mix__label { display: inline-flex; flex-direction: column; gap: .15rem; font-size: .88rem; color: #123f16; }
            .dayinfo-mix__type { font-size: .7rem; font-weight: 600; color: #45614b; text-transform: uppercase; letter-spacing: .05em; }
            .dayinfo-mix__qty { font-size: 1rem; font-weight: 800; color: #123f16; }

            @media (min-width: 1024px) {
                .dashboard-layout { max-width: 1200px; margin: 0 auto; }
            }

            /* Goal Progress */
            .goal-progress-deck { display: grid; gap: 1rem; }
            .goal-progress-card { background: #fff; border-radius: .9rem; box-shadow: 0 12px 24px rgba(0,0,0,.08); padding: 1rem; display: flex; flex-direction: column; gap: .6rem; border: 1px solid rgba(0,0,0,.04); }
            .goal-progress-card--empty { box-shadow: 0 6px 12px rgba(0,0,0,.05); }
            .goal-progress-head { display: flex; justify-content: space-between; align-items: flex-start; gap: .6rem; }
            .goal-progress-title-block { display: flex; flex-direction: column; gap: .15rem; }
            .goal-progress-title { margin: 0; font-weight: 900; font-size: 1.05rem; color: #143814; }
            .goal-progress-location { font-weight: 700; color: #35513a; font-size: .85rem; }
            .goal-progress-percent { font-weight: 900; color: #1F6D1C; font-size: 1.35rem; }
            .goal-progress-bar { background: rgba(42,150,38,.12); border-radius: .75rem; height: .65rem; overflow: hidden; position: relative; }
            .goal-progress-fill { background: #2A9626; height: 100%; transition: width .3s ease; }
            .goal-progress-totals { display: flex; justify-content: space-between; font-weight: 800; color: #35513a; font-size: .85rem; }
            .goal-progress-remaining { font-size: .8rem; font-weight: 700; color: #65716c; }
            .goal-progress-daily { display: flex; align-items: baseline; gap: .5rem; padding: .4rem .6rem .4rem 0; font-weight: 800; color: #143814; }
            .goal-progress-daily__label { font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #5b6a62; }
            .goal-progress-daily__value { font-size: 1.2rem; font-weight: 900; color: #1F6D1C; }
            .goal-progress-daily__meta { margin-left: auto; font-size: .75rem; font-weight: 600; color: #65716c; }
            .goal-progress-meta { font-size: .78rem; color: #65716c; font-weight: 600; display: flex; gap: .5rem; flex-wrap: wrap; }
            .goal-progress-empty-note { font-size: .85rem; font-weight: 700; color: #65716c; }
            .goal-progress-empty { background: #fff; border-radius: 1rem; padding: 1rem; box-shadow: inset 0 0 0 1px rgba(0,0,0,.05); font-style: italic; color: #65716c; text-align: center; }
            .goal-progress-motivation { list-style: none; margin: 0; padding: .75rem; border-radius: .85rem; background: rgba(25,74,31,.05); display: flex; flex-direction: column; gap: .55rem; }
            .goal-progress-motivation li { display: flex; align-items: flex-start; gap: .6rem; font-weight: 700; color: #35513a; font-size: .82rem; }
            .goal-progress-motivation__icon { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; font-size: 1.1rem; }

            /* Upcoming Events Card */
            .upcoming-card { background:#fff; border-radius:.9rem; box-shadow:0 4px 12px rgba(0,0,0,.1); padding:.8rem; max-width:320px; aspect-ratio:1/1; display:flex; flex-direction:column; justify-content:center; align-items:center; align-self:center; text-align:center; }
            .upcoming-card h3 { margin:.2rem 0 .6rem; font-weight:900; color:#2A9626; }
            .upcoming-card ul { list-style:none; margin:0; padding:0; font-weight:800; color:#194a1f; }
            .upcoming-card li { margin:.15rem 0; }

            /* Event deck */
            .event-deck { display: flex; flex-direction: column; gap: 1rem; }
            .event-section { display: flex; flex-direction: column; gap: .6rem; }
            .event-section-head h2 { margin: 0; font-weight: 900; color: #194a1f; font-size: 1.15rem; }
            .event-summary-section__head { display: flex; justify-content: space-between; align-items: baseline; gap: .4rem; flex-wrap: wrap; }
            .event-summary-section__count { font-size: .85rem; font-weight: 800; color: #35513a; }
            .event-summary-grid { display: grid; gap: .8rem; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
            .event-summary-card { background: #fff; border-radius: 1rem; box-shadow: 0 10px 20px rgba(0,0,0,.08); padding: 1rem; border: 1px solid rgba(0,0,0,.04); display: flex; flex-direction: column; gap: .75rem; }
            .event-summary-card__head { display: flex; justify-content: space-between; align-items: center; font-weight: 800; color: #194a1f; font-size: .9rem; text-transform: uppercase; letter-spacing: .04em; }
            .event-summary-card__events { font-size: .8rem; font-weight: 700; color: #65716c; text-transform: none; letter-spacing: normal; }
            .event-summary-card__metrics { background: rgba(25,74,31,.05); }
            .event-card-list { display: grid; gap: .8rem; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
            .event-card { background: #fff; border-radius: 1rem; box-shadow: 0 12px 24px rgba(0,0,0,.08); padding: 1rem; display: flex; flex-direction: column; gap: .8rem; border: 1px solid rgba(0,0,0,.04); transition: transform .18s ease, box-shadow .18s ease; cursor: pointer; outline: none; }
            .event-card:hover { transform: translateY(-2px); box-shadow: 0 18px 32px rgba(0,0,0,.12); }
            .event-card:focus-visible { box-shadow: 0 0 0 3px rgba(42,150,38,.28); }
            .event-card-badge { padding: .25rem .6rem; border-radius: 999px; font-weight: 800; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; }
            .event-card-badge.badge-active { background: rgba(42,150,38,.12); color: #1F6D1C; }
            .event-card-badge.badge-planned { background: rgba(255,197,0,.18); color: #805400; }
            .dashboard-event-card__head { display: flex; justify-content: space-between; align-items: flex-start; gap: .8rem; }
            .dashboard-event-card__title { display: flex; flex-direction: column; gap: .25rem; }
            .dashboard-event-card__title h3 { margin: 0; font-weight: 900; font-size: 1.05rem; color: #143814; }
            .dashboard-event-card__meta { display: flex; flex-wrap: wrap; gap: .35rem; font-weight: 700; color: #35513a; font-size: .85rem; }
            .dashboard-event-card__metrics { display: grid; gap: .6rem; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); padding: .65rem .75rem; border-radius: .85rem; background: rgba(25,74,31,.05); }
            .dashboard-event-card__metric { display: flex; flex-direction: column; gap: .2rem; }
            .dashboard-event-card__metric-label { font-size: .75rem; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: #5b6a62; }
            .dashboard-event-card__metric-value { font-size: 1.05rem; font-weight: 900; color: #143814; }
            /* Settings */
            .settings-panel { display: flex; flex-direction: column; gap: 1rem; }
            .settings-card-head h2 { margin: 0; font-weight: 900; color: #143814; }
            .settings-card-head p { margin: .25rem 0 0; font-size: .85rem; }
            .settings-section { display: flex; flex-direction: column; gap: .9rem; }
            .settings-section-head { display: flex; justify-content: space-between; align-items: flex-end; gap: .6rem; flex-wrap: wrap; }
            .settings-section-head h3 { margin: 0; font-weight: 900; color: #194a1f; }
            .settings-location-count { font-weight: 700; }
            .settings-location-form__row { display: flex; gap: .5rem; align-items: center; }
            .settings-location-form__row input { flex: 1 1 auto; border: 1px solid #d1d5db; border-radius: .7rem; padding: .55rem .7rem; font-weight: 700; color: #143814; }
            .settings-location-form__row input:focus { outline: none; border-color: #2A9626; box-shadow: 0 0 0 3px rgba(42,150,38,.18); }
            .settings-location-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
            .settings-location-item { display: flex; justify-content: space-between; align-items: center; gap: .6rem; padding: .65rem .8rem; border-radius: .85rem; background: #f9fafb; border: 1px solid rgba(0,0,0,.05); }
            .settings-location-label { font-weight: 800; color: #194a1f; }
            .settings-location-actions { display: flex; gap: .4rem; }
            .settings-location-empty { padding: .7rem .85rem; border-radius: .85rem; background: rgba(25,74,31,.06); color: #35513a; font-weight: 700; text-align: center; }
            .dashboard-event-card__metric-value--positive { color: #1F6D1C; }
            .dashboard-event-card__metric-value--negative { color: #C62828; }
            .dashboard-event-card__note { margin: .65rem 0 0; font-size: .82rem; font-weight: 700; color: #52635b; display: flex; flex-wrap: wrap; gap: .4rem; }
            .dashboard-event-card__foot { margin-top: .85rem; font-size: .78rem; font-weight: 800; color: #65716c; text-transform: uppercase; letter-spacing: .05em; display: flex; justify-content: space-between; align-items: center; gap: .4rem; }
            .dashboard-event-card__foot::after { content: '→'; font-size: .95rem; color: #2A9626; font-weight: 900; }
            .dashboard-event-card[data-status="upcoming"] .dashboard-event-card__metrics { background: rgba(255,197,0,.14); }
            .cheese-block { background: rgba(42,150,38,.08); border-radius: .8rem; padding: .6rem .75rem; display: flex; flex-direction: column; gap: .5rem; }
            .cheese-block.end { background: rgba(255,197,0,.12); }
            .cheese-block.supplement-block { background: rgba(42,150,38,.05); }
            .cheese-block-title { display: flex; justify-content: space-between; align-items: center; font-weight: 800; color: #194a1f; font-size: .9rem; }
            .cheese-block-title span { font-size: .75rem; font-weight: 700; color: #65716c; }
            .cheese-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: .4rem; }
            .cheese-pill { background: #fff; border-radius: .7rem; border: 1px solid rgba(0,0,0,.08); padding: .45rem .6rem; display: flex; flex-direction: column; gap: .25rem; align-items: flex-start; }
            .cheese-pill span { font-size: .75rem; font-weight: 700; color: #5b6a62; }
            .cheese-pill strong { font-size: 1.05rem; font-weight: 900; color: #1F6D1C; }
            .supplement-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
            .supplement-list li { background: rgba(255,255,255,.82); border-radius: .6rem; padding: .45rem .55rem; display: flex; flex-direction: column; gap: .25rem; }
            .supplement-list-head { display: flex; justify-content: space-between; align-items: center; font-size: .8rem; color: #194a1f; }
            .supplement-list-head span { font-size: .72rem; color: #65716c; font-weight: 600; }
            .supplement-list-values { display: flex; flex-wrap: wrap; gap: .6rem; font-size: .78rem; color: #35513a; }
            .supplement-list-values b { font-weight: 800; color: #1F6D1C; }
            .dashboard-event-card__cta { border: none; border-radius: .8rem; padding: .6rem 1rem; font-weight: 900; font-size: .95rem; background: #2A9626; color: #fff; cursor: pointer; }
            .dashboard-event-card__cta:focus-visible { outline: 3px solid rgba(42,150,38,.28); outline-offset: 2px; }
            .event-empty-card { background: #fff; border-radius: 1rem; padding: 1rem; box-shadow: inset 0 0 0 1px rgba(0,0,0,.05); font-style: italic; color: #65716c; text-align: center; }
            .event-modal { max-width: 520px; }
            .event-modal-sub { margin: .25rem 0 .6rem; font-weight: 700; color: #1F6D1C; }
            .event-modal-note { margin-top: .6rem; font-size: .85rem; color: #52635b; font-style: italic; }
            .event-action-modal { max-width: 420px; }
            .event-action-modal__head h2 { margin: 0; font-weight: 900; color: #143814; }
            .event-action-modal__head p { margin: .25rem 0 0; font-weight: 700; color: #35513a; font-size: .9rem; }
            .event-action-modal__metrics { margin-top: .9rem; display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); background: rgba(25,74,31,.06); border-radius: .9rem; padding: .75rem; }
            .event-action-modal__metrics div { display: flex; flex-direction: column; gap: .2rem; }
            .event-action-modal__metrics span.label { font-size: .75rem; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: #5b6a62; }
            .event-action-modal__metrics strong { font-size: 1.05rem; font-weight: 900; color: #143814; }
            .event-action-modal__metrics strong.negative { color: #C62828; }
            .event-action-modal__metrics strong.positive { color: #1F6D1C; }
            .event-action-modal__warning { margin-top: .8rem; font-weight: 700; color: #C62828; background: rgba(198,40,40,.12); padding: .55rem .7rem; border-radius: .75rem; }
            .event-action-modal__actions { margin-top: 1.2rem; display: flex; flex-direction: column; gap: .55rem; }
            .event-action-modal__actions button { border: none; border-radius: .85rem; padding: .7rem 1rem; font-weight: 800; font-size: 1rem; display: flex; flex-direction: column; align-items: flex-start; gap: .35rem; cursor: pointer; background: #f4f6f5; color: #143814; transition: transform .15s ease, box-shadow .15s ease; }
            .event-action-modal__actions button .event-action-modal__main { font-size: 1rem; font-weight: 800; color: inherit; display: flex; align-items: center; gap: .4rem; }
            .event-action-modal__actions button .event-action-modal__sub { font-size: .85rem; font-weight: 700; color: #65716c; }
            .event-action-modal__actions button .event-action-modal__hint { font-size: .75rem; font-weight: 700; color: #C62828; }
            .event-action-modal__actions button:disabled .event-action-modal__sub { color: #5b6a62; }
            .event-action-modal__actions button:disabled .event-action-modal__main { opacity: .85; }
            .event-action-modal__actions button.primary { background: #2A9626; color: #fff; }
            .event-action-modal__actions button.danger { background: #C62828; color: #fff; }
            .event-action-modal__actions button:disabled { opacity: .55; cursor: not-allowed; box-shadow: none; transform: none; }
            .event-action-modal__actions button:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 10px 18px rgba(0,0,0,.12); }
            .event-count-form { display: flex; flex-direction: column; gap: .9rem; margin-top: .6rem; }
            .event-count-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: .6rem; }
            .event-count-field { display: flex; flex-direction: column; font-weight: 800; color: #194a1f; gap: .25rem; }
            .event-count-field input { border: 1px solid #d0d5dd; border-radius: .7rem; padding: .55rem .65rem; font-size: 1rem; font-weight: 700; background: #fff; }
            .event-count-actions { display: flex; gap: .5rem; justify-content: flex-end; flex-wrap: wrap; }
            .event-modal .supplement-history { margin-top: 1.2rem; display: flex; flex-direction: column; gap: .5rem; }
            .event-modal .supplement-history h3 { margin: 0; font-size: .95rem; font-weight: 800; color: #194a1f; }

            /* Modals */
            .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 200; }
            .modal-box { position: relative; background: #fff; padding: 1.5rem; border-radius: 12px; width: min(92vw, 560px); max-height: 85vh; overflow-y: auto; }
            .modal-close { position: absolute; top: 8px; right: 8px; background: #eee; border: none; border-radius: 50%; width: 32px; height: 32px; font-weight: bold; cursor: pointer; }
            .modal-grid { display: grid; grid-template-columns: auto 1fr; gap: .5rem 1rem; margin-top: 1rem; }
            .modal-actions { display: flex; gap: .5rem; margin-top: 1.2rem; }
            .modal-actions button { background: #2A9626; color: #fff; border: none; border-radius: 8px; padding: .6rem 1rem; font-weight: 800; cursor: pointer; }
            
            /* Toasts & Loading */
            .toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); color: #fff; padding: .7rem 1rem; border-radius: .7rem; font-weight: 800; box-shadow: 0 4px 12px rgba(0,0,0,.2); z-index: 1000; }
            .toast-info { background: #2A9626; } .toast-success { background: #2E7D32; } .toast-warning { background: #FB8C00; } .toast-error { background: #C62828; }
            #loadingOverlay { position: fixed; inset: 0; background: rgba(255,255,255,.9); display: none; align-items: center; justify-content: center; flex-direction: column; z-index: 9999; font-size: 1.5rem; font-weight: 800; color: #2A9626; }
        </style>
    `);
}

// Styles voor het verkoopscherm (scoped op .oc-sales)
export function injectSalesStylesOnce() {
    if (document.getElementById('oc-sales-styles')) return;
    const style = document.createElement('style');
    style.id = 'oc-sales-styles';
    style.textContent = `
/* Scoped op .oc-sales */
.oc-sales .toolbar{display:flex;gap:.5rem;flex-wrap:wrap;margin:.5rem 0 1rem}
.oc-sales .btn{border:none;border-radius:12px;padding:.55rem .85rem;font-weight:800;cursor:pointer}
.oc-sales .btn.primary{background:#2A9626;color:#fff}
.oc-sales .btn.secondary{background:#FFE36A;color:#194a1f}
.oc-sales .btn.ghost{background:#fff;border:1px solid rgba(0,0,0,.08);color:#194a1f}

.oc-sales .btn-grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));max-width:calc(5*160px + 4*.75rem);margin:0 auto}
.oc-sales .sale-btn{padding:.9rem 1rem;border-radius:14px;border:1px solid rgba(0,0,0,.06);
  background:linear-gradient(180deg,#fffdf2 0%,#fff9cf 100%);box-shadow:0 1px 0 rgba(0,0,0,.06),inset 0 1px 0 rgba(255,255,255,.7);
  font-weight:800;color:#194a1f;transform:translateZ(0)}
.oc-sales .sale-btn:hover{transform:translateY(-1px)}
.oc-sales .sale-btn .price{display:block;font-size:1.05rem;margin-top:.1rem}
.oc-sales .sale-btn .meta{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.2rem;font-size:.82rem;opacity:.85}
.oc-sales .chip{border-radius:999px;padding:.15rem .5rem;border:1px solid rgba(0,0,0,.08);background:#fff}

/* kleur op basis van voorraad */
.oc-sales .sale-btn[data-stock="high"]{outline:2px solid rgba(42,150,38,.15)}
.oc-sales .sale-btn[data-stock="mid"] {outline:2px solid rgba(255,197,0,.25)}
.oc-sales .sale-btn[data-stock="low"] {outline:2px solid rgba(255,100,100,.25)}
.oc-sales .sale-btn[disabled]{opacity:.5;filter:grayscale(.25);cursor:not-allowed}

/* sticky dock */
.oc-sales .bag-dock{position:sticky;bottom:0;left:0;right:0;z-index:30;background:linear-gradient(180deg,rgba(255,255,255,0) 0%,#ffffff 24%);
  border-top:2px solid rgba(0,0,0,.06);padding:.75rem .75rem 1rem;backdrop-filter:blur(6px)}
.oc-sales .bag-dock[data-visible="false"]{display:none}
.oc-sales .bag-head{display:flex;align-items:center;gap:.75rem;margin-bottom:.5rem}
.oc-sales .bag-tag{background:#FFC500;color:#194a1f;font-weight:900;padding:.35rem .6rem;border-radius:10px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.1)}
.oc-sales .bag-meta{font-weight:700;color:#194a1f;opacity:.9}
.oc-sales .bag-actions{margin-left:auto;display:flex;gap:.4rem}
.oc-sales .bag-items{display:flex;flex-wrap:wrap;gap:.5rem;max-height:28vh;overflow:auto;padding:.25rem 0}
.oc-sales .bag-item{display:flex;align-items:center;gap:.5rem;padding:.45rem .6rem;border:1px solid rgba(0,0,0,.06);border-radius:12px;background:#fffef5;box-shadow:0 1px 0 rgba(0,0,0,.06)}
.oc-sales .bag-item .name{font-weight:800;color:#194a1f}
.oc-sales .qty{display:flex;align-items:center;gap:.35rem}
.oc-sales .qty button{width:28px;height:28px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:#fff;font-weight:900}
.oc-sales .qty .n{min-width:2ch;text-align:center;font-weight:800}
.oc-sales .bag-footer{display:flex;align-items:center;gap:.75rem;margin-top:.6rem}
.oc-sales .spacer{flex:1}

/* Animaties */
.oc-sales .sale-btn:active{transform:scale(.98)}
.bag-dock.pulse{animation:bagPulse .3s}
@keyframes bagPulse{0%{transform:scale(1);}50%{transform:scale(1.02);}100%{transform:scale(1);}}
`;
    document.head.appendChild(style);
}
