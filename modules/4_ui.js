// 📦 4_ui.js — Hoofd-UI module

// Centrale store als enige state bron
import { store } from './store.js';
import { apiFetch } from './api.js';

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
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
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
                <div class=\"dashboard-layout\">
                    <div id=\"dashboardSummaryMount\"></div>
                    <div id=\"dashboardActionMount\"></div>
                    <div id=\"dashboardHighlightsMount\"></div>
                    <div id=\"salesMount\"></div>
                    <div id=\"dashboardEventsMount\"></div>
                    <div id=\"goalProgressMount\"></div>
                    <div id=\"reisPlannerMount\"></div>
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

    // sales UI wordt elders getriggerd via store events
}

// backwards compat
export const showMainMenu = showMainShell;

// ============ Topbar ============

function renderTopbar() {
    const topbarMount = document.getElementById('appTopbar');
    if (!topbarMount) return;

    const title = getActiveTitle();

    topbarMount.className = 'app-topbar';
    topbarMount.innerHTML = `
        <div class="tb-left">
            <div class="tb-title">${title}</div>
        </div>
        <div class="tb-right">
            <span id="netBadge" title="Netwerkstatus"></span>
        </div>
    `;

    updateNetworkStatus(); // Zet de initiële status
}

function getActiveTitle() {
    const activeDay = store.getActiveEventDay?.();
    if (activeDay) {
        const prefix = isToday(activeDay.date) ? 'Vandaag' : 'Actieve dag';
        const eventName = (activeDay.eventName || '').trim();
        const location = (activeDay.meta?.locatie || '').trim();
        const dateLabel = formatTopbarDate(activeDay.date);
        const detailParts = [eventName, location, dateLabel].filter(Boolean);
        const detail = detailParts.length ? detailParts.join(' • ') : null;
        return detail ? `${prefix}: ${detail}` : `${prefix}: Dagselectie`;
    }
    return "Olga's Cheese POS";
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

    const user = JSON.parse(localStorage.getItem('gebruiker') || '{}');
    const isAdmin = user?.role === 'admin';

    navMount.setAttribute('role', 'menubar');
    navMount.setAttribute('aria-label', 'Hoofdmenu');

    const navItems = [
        { action: 'dashboard', icon: '🏠', label: 'Dashboard' },
        { action: 'daginfo', icon: 'ℹ️', label: 'Daginfo', requiresActiveDay: true },
        { action: 'voorraad', icon: '📦', label: 'Voorraad' },
        { action: 'events', icon: '🎪', label: 'Events' },
        { action: 'reis', icon: '✈️', label: 'Reis' },
        { action: 'accounting', icon: '💶', label: 'Accounting' },
        { action: 'inzichten', icon: '📈', label: 'Inzicht' },
        { action: 'settings', icon: '⚙️', label: 'Instellingen' }
    ];

    if (isAdmin) {
        navItems.splice(4, 0, { action: 'gebruikers', icon: '👤', label: 'Team' });
    }

    navMount.innerHTML = navItems.map(item => {
        const attrs = [`data-action="${item.action}"`];
        if (item.requiresActiveDay) attrs.push('data-requires-active-day="true"');
        return `
            <button type="button" role="menuitem" ${attrs.join(' ')} aria-pressed="false">
                <span class="icon">${item.icon}</span>
                <span class="label">${item.label}</span>
            </button>
        `;
    }).join('');

    navMount.querySelectorAll('button[data-action]').forEach(btn => {
        btn.addEventListener('click', () => navigationActionHandler(btn.dataset.action));
    });

    ensureBottomNavStateListeners();
    updateBottomNavState();
    markActiveNav('dashboard');
}

let bottomNavStateBound = false;
function ensureBottomNavStateListeners() {
    if (bottomNavStateBound) return;
    bottomNavStateBound = true;
    const update = () => updateBottomNavState();
    store.on('activeDay:changed', update);
}

function updateBottomNavState() {
    const nav = document.getElementById('appBottomBar');
    if (!nav) return;
    const hasActiveDay = Boolean(store.getActiveEventDay?.());
    nav.querySelectorAll('button[data-requires-active-day]').forEach(btn => {
        btn.toggleAttribute('disabled', !hasActiveDay);
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

function renderEventCards() {
    const summaryMount = document.getElementById('dashboardSummaryMount');
    const actionMount = document.getElementById('dashboardActionMount');
    const eventsMount = document.getElementById('dashboardEventsMount');
    const highlightsMount = document.getElementById('dashboardHighlightsMount');

    const events = Array.isArray(store.state.db?.evenementen)
        ? store.state.db.evenementen
        : [];

    renderGoalProgressCards(events);

    if (!events.length) {
        if (summaryMount) summaryMount.innerHTML = renderDashboardSummaryEmpty();
        if (actionMount) actionMount.innerHTML = renderDashboardActionEmpty();
        if (eventsMount) eventsMount.innerHTML = `<div class="event-empty-card">Geen evenementen gevonden.</div>`;
        if (highlightsMount) highlightsMount.innerHTML = '';
        return;
    }

    const current = [];
    const upcoming = [];
    const today = startOfLocalDay(new Date());
    const upcomingLimit = startOfLocalDay(addDays(new Date(), 7));
    const todayMs = today.getTime();
    const upcomingLimitMs = upcomingLimit.getTime();

    for (const ev of events) {
        if (!ev || isEventCompleted(ev)) continue;

        const startDate = parseLocalYMD(getEventStartDate(ev));
        const endDate = parseLocalYMD(getEventEndDate(ev));
        const startMs = startDate ? startOfLocalDay(startDate).getTime() : null;
        const endMs = endDate ? startOfLocalDay(endDate).getTime() : null;

        const activeByDate = (
            (startMs != null && endMs != null && startMs <= todayMs && todayMs <= endMs) ||
            (startMs != null && endMs == null && startMs <= todayMs) ||
            (startMs == null && endMs != null && todayMs <= endMs)
        );

        const metrics = computeEventFinancials(ev);
        const entry = {
            event: ev,
            metrics,
            startDate,
            endDate,
            startMs,
            endMs,
            ref: String(ev?.id || ev?.naam || '').trim()
        };

        if (startMs != null) {
            entry.daysUntilStart = Math.ceil((startMs - todayMs) / MS_PER_DAY);
        }
        if (endMs != null) {
            entry.daysUntilEnd = Math.ceil((endMs - todayMs) / MS_PER_DAY);
        }

        if (isEventActive(ev) || activeByDate) {
            current.push(entry);
            continue;
        }

        if (startMs != null && startMs > todayMs && startMs <= upcomingLimitMs) {
            upcoming.push(entry);
        }
    }

    current.sort((a, b) => sortByEventDate(a.event, b.event));
    upcoming.sort((a, b) => sortByEventDate(a.event, b.event));

    const aggregate = aggregateCurrentEventFinancials(current);
    const tasks = buildDashboardTasks(current, upcoming);

    if (summaryMount) {
        summaryMount.innerHTML = renderDashboardSummary(aggregate, current.length, upcoming.length, tasks);
        bindDashboardSummaryActions(summaryMount);
    }
    if (actionMount) {
        actionMount.innerHTML = renderDashboardActionCenter(tasks);
        bindDashboardActionEvents(actionMount);
    }
    if (eventsMount) {
        renderDashboardEventDeck(eventsMount, current, upcoming);
    }
    if (highlightsMount) {
        highlightsMount.innerHTML = renderDashboardHighlights(current, upcoming, aggregate);
    }
}

function renderDashboardSummaryEmpty() {
    const activeDay = store.getActiveEventDay?.();
    const activeHtml = activeDay
        ? `<div class="dashboard-active-day"><span class="dashboard-active-day__icon">🗓️</span><div><strong>${escapeHtml(activeDay.eventName || 'Actieve dag')}</strong><span class="dashboard-active-day__meta">${escapeHtml(formatFullDate(activeDay.date) || '')}</span></div></div>`
        : `<div class="dashboard-active-day dashboard-active-day--empty"><span class="dashboard-active-day__icon">🗓️</span><div><strong>Geen actieve dag</strong><span class="dashboard-active-day__meta">Kies een evenement om te starten.</span></div></div>`;
    return `
        <section class="dashboard-summary">
            ${activeHtml}
            <div class="dashboard-summary-grid">
                <article class="dashboard-summary-card">
                    <span class="dashboard-summary-card__label">Open taken</span>
                    <span class="dashboard-summary-card__value">0</span>
                    <span class="dashboard-summary-card__meta">Alles staat klaar.</span>
                </article>
                <article class="dashboard-summary-card">
                    <span class="dashboard-summary-card__label">Actieve events</span>
                    <span class="dashboard-summary-card__value">0</span>
                    <span class="dashboard-summary-card__meta">Geen geplande evenementen.</span>
                </article>
                <article class="dashboard-summary-card">
                    <span class="dashboard-summary-card__label">Totale omzet</span>
                    <span class="dashboard-summary-card__value">€ 0,00</span>
                    <span class="dashboard-summary-card__meta">Nog geen registraties.</span>
                </article>
                <article class="dashboard-summary-card">
                    <span class="dashboard-summary-card__label">Netto resultaat</span>
                    <span class="dashboard-summary-card__value">€ 0,00</span>
                    <span class="dashboard-summary-card__meta">Wacht op eerste verkoop.</span>
                </article>
            </div>
        </section>
    `;
}

function renderDashboardSummary(aggregate, currentCount, upcomingCount, tasks) {
    const activeDay = store.getActiveEventDay?.();
    const activeHtml = activeDay
        ? `<button type="button" class="dashboard-active-day" data-dashboard-nav="daginfo">
                <span class="dashboard-active-day__icon">🗓️</span>
                <div>
                    <strong>${escapeHtml(activeDay.eventName || 'Actieve dag')}</strong>
                    <span class="dashboard-active-day__meta">${escapeHtml(formatFullDate(activeDay.date) || '')}</span>
                </div>
                <span class="dashboard-active-day__cta">Bekijk daginfo</span>
            </button>`
        : `<div class="dashboard-active-day dashboard-active-day--empty">
                <span class="dashboard-active-day__icon">🗓️</span>
                <div>
                    <strong>Geen actieve dag</strong>
                    <span class="dashboard-active-day__meta">Kies een evenement in het overzicht.</span>
                </div>
            </div>`;

    const totalRevenueLabel = formatCurrencyPair(aggregate.totalRevenueEUR, aggregate.totalRevenueUSD);
    const netResultLabel = formatCurrencyValue(roundCurrency(aggregate.netResultEUR), 'EUR');
    const netClass = aggregate.netResultEUR >= 0
        ? 'dashboard-summary-card__value--positive'
        : 'dashboard-summary-card__value--negative';
    const cheeseLabel = formatCheeseAmount(aggregate.cheeseUnits);
    const tasksCount = tasks.length;
    const directPct = Math.round(toSafeNumber(aggregate?.debtorPercentages?.DIRECT));
    const debtorPct = Math.round(toSafeNumber(aggregate?.debtorPercentages?.DEBTOR));
    const marginPct = aggregate.totalRevenueEUR
        ? Math.round((aggregate.netResultEUR / aggregate.totalRevenueEUR) * 100)
        : 0;

    const upcomingMeta = upcomingCount
        ? `${upcomingCount} starten binnen 7 dagen`
        : 'Geen nieuwe evenementen deze week';

    const taskMeta = tasksCount
        ? 'Pak de belangrijkste acties op'
        : 'Alles loopt op schema';

    return `
        <section class="dashboard-summary">
            ${activeHtml}
            <div class="dashboard-summary-grid">
                <article class="dashboard-summary-card dashboard-summary-card--accent">
                    <span class="dashboard-summary-card__label">Open taken</span>
                    <span class="dashboard-summary-card__value">${tasksCount}</span>
                    <span class="dashboard-summary-card__meta">${escapeHtml(taskMeta)}</span>
                </article>
                <article class="dashboard-summary-card">
                    <span class="dashboard-summary-card__label">Actieve events</span>
                    <span class="dashboard-summary-card__value">${currentCount}</span>
                    <span class="dashboard-summary-card__meta">${escapeHtml(upcomingMeta)}</span>
                </article>
                <article class="dashboard-summary-card">
                    <span class="dashboard-summary-card__label">Totale omzet</span>
                    <span class="dashboard-summary-card__value">${escapeHtml(totalRevenueLabel)}</span>
                    <span class="dashboard-summary-card__meta">${escapeHtml(`Netto marge ${marginPct}%`)}</span>
                </article>
                <article class="dashboard-summary-card">
                    <span class="dashboard-summary-card__label">Netto resultaat</span>
                    <span class="dashboard-summary-card__value ${netClass}">${escapeHtml(netResultLabel)}</span>
                    <span class="dashboard-summary-card__meta">${escapeHtml(`Debiteur ${debtorPct}% • Direct ${directPct}%`)}</span>
                </article>
                <article class="dashboard-summary-card">
                    <span class="dashboard-summary-card__label">Kaas verkocht</span>
                    <span class="dashboard-summary-card__value">${escapeHtml(cheeseLabel)}</span>
                    <span class="dashboard-summary-card__meta">Souvenir-omzet ${escapeHtml(formatCurrencyPair(aggregate.souvenirRevenueEUR, aggregate.souvenirRevenueUSD))}</span>
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
        const marginPct = aggregate.totalRevenueEUR
            ? Math.round((aggregate.netResultEUR / aggregate.totalRevenueEUR) * 100)
            : 0;
        cards.push(`
            <article class="dashboard-highlight-card">
                <span class="dashboard-highlight-card__icon">📈</span>
                <h3>Gemiddelde marge</h3>
                <p class="dashboard-highlight-card__value">${escapeHtml(`${marginPct}%`)}</p>
                <p class="dashboard-highlight-card__meta">Netto resultaat ${escapeHtml(formatCurrencyValue(roundCurrency(aggregate.netResultEUR), 'EUR'))}</p>
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
        totals.cheeseUnits += toSafeNumber(metrics.cheeseUnits);
        totals.cheeseRevenueEUR += toSafeNumber(metrics.cheeseRevenueEUR);
        totals.cheeseRevenueUSD += toSafeNumber(metrics.cheeseRevenueUSD);
        totals.cheeseCostEUR += toSafeNumber(metrics.cheeseCostEUR);
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

    return { ...totals, debtorPercentages };
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
    const cheeseUnitsLabel = formatCheeseUnits(metrics.cheeseUnits);
    const cheeseRevenueLabel = formatCurrencyPair(metrics.cheeseRevenueEUR, metrics.cheeseRevenueUSD);
    const souvenirRevenueLabel = formatCurrencyPair(metrics.souvenirRevenueEUR, metrics.souvenirRevenueUSD);
    const cheeseCostLabel = formatCurrencyValue(metrics.cheeseCostEUR, 'EUR');
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
            </div>
            ${noteHtml}
            <footer class="dashboard-event-card__foot">
                <span>Tap voor acties</span>
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

function normalizeOmzetEntryDate(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const raw = entry.date || entry.datum || entry.dagDatum || entry.dag;
    if (!raw) return null;
    if (raw instanceof Date) return toYMDString(raw);
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
        return raw.trim();
    }
    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) return null;
    return toYMDString(parsed);
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

function buildDashboardActiveDaySnapshot(event) {
    if (!event) return null;
    const start = getEventStartDate(event);
    const end = getEventEndDate(event) || start;
    const today = toYMDString(new Date());
    let date = today;
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

function setActiveDayFromEvent(event) {
    const snapshot = buildDashboardActiveDaySnapshot(event);
    if (!snapshot) return;
    try {
        store.setActiveEventDay?.(snapshot);
    } catch (err) {
        console.warn('[POS] Active day bijwerken mislukt', err);
    }
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

    const categories = {
        BG: clampCheeseValue(startTotals.BG + supplementTotals.BG - endTotals.BG),
        ROOK: clampCheeseValue(startTotals.ROOK + supplementTotals.ROOK - endTotals.ROOK),
        GEIT: clampCheeseValue(startTotals.GEIT + supplementTotals.GEIT - endTotals.GEIT)
    };
    const totalCategories = categories.BG + categories.ROOK + categories.GEIT;
    const productTotals = sanitizeProductSalesMap(productSales);
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

    const goal = getEventCheeseGoal(ev);
    const hasGoal = goal.target > 0;
    const sold = calculateSoldCheese(ev);
    const percent = hasGoal && goal.target > 0
        ? Math.min(100, Math.round((sold / goal.target) * 100))
        : 0;
    const remaining = hasGoal ? Math.max(0, goal.target - sold) : 0;

    const location = ev?.locatie ? `<div class="goal-progress-location">📍 ${escapeHtml(ev.locatie)}</div>` : '';
    const percentBadge = hasGoal ? `<span class="goal-progress-percent">${percent}%</span>` : '';
    const soldLabel = escapeHtml(formatCheeseAmount(sold));
    const targetLabel = escapeHtml(formatCheeseAmount(goal.target));
    const remainingLabel = escapeHtml(formatCheeseAmount(remaining));

    const progressHtml = hasGoal
        ? `
            <div class="goal-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${escapeHtml(String(goal.target))}" aria-valuenow="${escapeHtml(String(sold))}" aria-label="Voortgang richting doelstelling">
                <div class="goal-progress-fill" style="width:${percent}%"></div>
            </div>
            <div class="goal-progress-totals">
                <span>${soldLabel} verkocht</span>
                <span>${targetLabel} doel</span>
            </div>
            <div class="goal-progress-remaining">${remaining > 0 ? `${remainingLabel} te gaan` : 'Doel bereikt 🎉'}</div>
        `
        : `<div class="goal-progress-empty-note">Voeg een voorraadplanning toe om een doel te zien.</div>`;

    const metaParts = [];
    if (goal.turnoverLabel) metaParts.push(escapeHtml(goal.turnoverLabel));
    if (goal.mixLabel) metaParts.push(escapeHtml(goal.mixLabel));
    const metaHtml = metaParts.length
        ? `<div class="goal-progress-meta">${metaParts.join(' • ')}</div>`
        : '';

    return `
        <article class="goal-progress-card${hasGoal ? '' : ' goal-progress-card--empty'}" data-event-ref="${escapeHtml(String(ev?.id || ev?.naam || ''))}">
            <div class="goal-progress-head">
                <div class="goal-progress-title-block">
                    <h3 class="goal-progress-title">${escapeHtml(ev?.naam || 'Onbekend evenement')}</h3>
                    ${location}
                </div>
                ${percentBadge}
            </div>
            ${progressHtml}
            ${metaHtml}
        </article>
    `;
}

function getEventCheeseGoal(ev) {
    const planning = ev?.planning || {};
    let target = clampCheeseValue(toSafeNumber(planning.totalCheese));
    if (!target) {
        const estimate = toCheeseTotals(planning.cheeseEstimate);
        target = clampCheeseValue(estimate.BG + estimate.ROOK + estimate.GEIT);
    }

    const expected = planning.expectedTurnover || {};
    const usd = toSafeNumber(expected.usd);
    const eur = toSafeNumber(expected.eur);
    const turnoverParts = [];
    if (usd > 0) turnoverParts.push(formatCurrency(usd, 'USD'));
    if (eur > 0) turnoverParts.push(formatCurrency(eur, 'EUR'));

    const mixLabel = planning.mixSnapshot ? `Mix: ${formatPlanMix(planning.mixSnapshot)}` : '';

    return {
        target,
        turnoverLabel: turnoverParts.join(' • '),
        mixLabel
    };
}

function calculateSoldCheese(ev) {
    const telling = ev?.kaasTelling || {};
    const sales = telling.sales || null;

    if (sales) {
        const total = clampCheeseValue(toSafeNumber(sales.total));
        if (total > 0) return total;
        const categories = toCheeseTotals(sales.categories);
        const sum = categories.BG + categories.ROOK + categories.GEIT;
        if (sum > 0) return clampCheeseValue(sum);
    }

    if (telling.start && (telling.end || telling.supplements?.length)) {
        try {
            const snapshot = computeEventSalesSnapshot(ev, telling.end || {}, sales?.products);
            if (snapshot) {
                const total = clampCheeseValue(toSafeNumber(snapshot.total));
                if (total > 0) return total;
                const categories = toCheeseTotals(snapshot.categories);
                const sum = categories.BG + categories.ROOK + categories.GEIT;
                if (sum > 0) return clampCheeseValue(sum);
            }
        } catch (err) {
            console.warn('[POS] Kon verkochte kaas niet berekenen voor voortgangskaart', err);
        }
    }

    return 0;
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

    const events = Array.isArray(store.state.db?.evenementen) ? store.state.db.evenementen : [];
    const evt = events.find(e => {
        const candidateId = e.id ?? e.uuid ?? e.slug ?? e.naam;
        return candidateId === activeDay.eventId || e.naam === activeDay.eventName;
    }) || {};

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
        <section class="panel-card">
            <h3>Daginfo</h3>
            <div class="meta-grid">${rows}</div>
            ${notes.length ? `<p class="muted" style="margin-top:.8rem">${notes.join(' • ')}</p>` : ''}
            <div class="panel-footer">
                <button class="btn-primary" id="gotoDagomzetBtn">➕ Dagomzet registreren</button>
            </div>
        </section>
    `;

    panel.querySelector('#gotoDagomzetBtn')?.addEventListener('click', () => {
        navigationActionHandler('dagomzet');
    });
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
                background: #2A9626; color: #fff; padding: .6rem .8rem; box-shadow: 0 2px 8px rgba(0,0,0,.15);
            }
            .tb-left, .tb-right { display: flex; align-items: center; gap: .5rem; }
            .tb-btn { background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.3); color: #fff; padding: .4rem .6rem; border-radius: .6rem; font-weight: 800; cursor: pointer; }
            .tb-title { font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .net { width: 12px; height: 12px; border-radius: 50%; }
            .net.ok { background: #9AE66E; } .net.off { background: #FF7043; }

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
            .dashboard-summary { display: flex; flex-direction: column; gap: .85rem; }
            .dashboard-active-day { display: flex; align-items: center; gap: .75rem; padding: .85rem 1rem; border-radius: 1rem; border: 1px solid rgba(0,0,0,.05); background: #fff; box-shadow: 0 8px 18px rgba(0,0,0,.08); font-weight: 800; color: #143814; text-align: left; width: 100%; }
            button.dashboard-active-day { cursor: pointer; border: none; font: inherit; }
            button.dashboard-active-day:focus-visible { outline: 3px solid rgba(42,150,38,.3); outline-offset: 2px; }
            .dashboard-active-day__icon { font-size: 1.5rem; }
            .dashboard-active-day__meta { display: block; font-size: .78rem; font-weight: 700; color: #53645c; }
            .dashboard-active-day__cta { margin-left: auto; font-size: .78rem; font-weight: 800; color: #2A9626; }
            .dashboard-active-day--empty { border-style: dashed; background: rgba(255,255,255,.65); box-shadow: none; color: #52635b; cursor: default; }
            .dashboard-active-day--empty .dashboard-active-day__cta { display: none; }
            .dashboard-summary-grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
            .dashboard-summary-card { background: #fff; border-radius: 1rem; padding: .9rem 1rem; box-shadow: 0 8px 18px rgba(0,0,0,.08); border: 1px solid rgba(0,0,0,.04); display: flex; flex-direction: column; gap: .4rem; }
            .dashboard-summary-card--accent { background: rgba(255,197,0,.18); border-color: rgba(255,197,0,.4); }
            .dashboard-summary-card__label { font-size: .78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: #5b6a62; }
            .dashboard-summary-card__value { font-size: 1.4rem; font-weight: 900; color: #143814; }
            .dashboard-summary-card__value--positive { color: #1F6D1C; }
            .dashboard-summary-card__value--negative { color: #C62828; }
            .dashboard-summary-card__meta { font-size: .78rem; font-weight: 700; color: #53645c; }
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
            #salesMount { display: flex; flex-direction: column; gap: .8rem; }

            @media (min-width: 1024px) {
                .dashboard-layout { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
            .goal-progress-meta { font-size: .78rem; color: #65716c; font-weight: 600; display: flex; gap: .5rem; flex-wrap: wrap; }
            .goal-progress-empty-note { font-size: .85rem; font-weight: 700; color: #65716c; }
            .goal-progress-empty { background: #fff; border-radius: 1rem; padding: 1rem; box-shadow: inset 0 0 0 1px rgba(0,0,0,.05); font-style: italic; color: #65716c; text-align: center; }

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
            .dashboard-event-card__metrics { display: grid; gap: .6rem; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); padding: .65rem .75rem; border-radius: .85rem; background: rgba(25,74,31,.05); }
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
            .event-card-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
            .event-card-btn { border: none; border-radius: .8rem; padding: .6rem 1rem; font-weight: 800; cursor: pointer; transition: transform .15s ease, box-shadow .15s ease; }
            .event-card-btn:disabled { opacity: .55; cursor: not-allowed; box-shadow: none; transform: none; }
            .event-card-btn:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(0,0,0,.1); }
            .event-card-btn.primary { background: #2A9626; color: #fff; }
            .event-card-btn.secondary { background: #FFE36A; color: #5a4700; }
            .event-card-btn.danger { background: #C62828; color: #fff; }
            .event-card-btn.ghost { background: #fff; border: 1px solid rgba(0,0,0,.1); color: #194a1f; }
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