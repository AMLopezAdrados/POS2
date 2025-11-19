// modules/14_reisPlanning.js
// Reisplanner — maandkalender + twee wizards (Voorraad & Beschikbaarheid) + quick-edit

import { db, saveEvent, saveReizen } from './3_data.js';
import { showAlert, closeAllModals, formatCurrencyValue } from './4_ui.js';

const CHEESE_TYPES = ['BG', 'ROOK', 'GEIT'];
const BUFFER_FACTOR = 1.1;

function isClosed(ev) {
  const state = String(ev?.state || ev?.status || '').toLowerCase();
  return ev?.afgerond === true || state === 'closed' || state === 'afgesloten';
}

// ================= Public API =================
export function openReisPlannerModal() {
  closeAllModals();

  const overlay = document.createElement('div');
  overlay.className = 'modal rp-modal';

  const shell = document.createElement('div');
  shell.className = 'rp-shell';
  overlay.appendChild(shell);

  const header = _buildHeader();
  shell.appendChild(header.bar);

  const cal = _buildCalendar(() => {
    header.planStock.disabled = !(selStart && selEnd);
    _updateTitle();
  });
  shell.appendChild(cal.wrap);
  shell.appendChild(_renderTripList());

  // Header actions
  header.prev.onclick  = () => { _shiftMonth(-1); cal.renderMonth(currentYear, currentMonth); };
  header.next.onclick  = () => { _shiftMonth(+1); cal.renderMonth(currentYear, currentMonth); };
  header.today.onclick = () => { const d=new Date(); currentYear=d.getFullYear(); currentMonth=d.getMonth(); cal.renderMonth(currentYear,currentMonth); };
  header.close.onclick = closeAllModals;

  header.planStock.onclick   = () => selStart && selEnd && _wizardVoorraad(selStart, selEnd);
  header.avail.onclick       = () => _wizardBeschikbaarheid();
  header.newEvt.onclick      = async () => {
    try { const { openEventScheduleModal } = await import('./15_eventSchedule.js'); openEventScheduleModal(true); }
    catch { showAlert('Kan nieuw evenement formulier niet openen.', 'error'); }
  };

  // Init kalender
  const now = new Date();
  selStart = null;
  selEnd = null;
  currentYear  = now.getFullYear();
  currentMonth = now.getMonth();
  cal.renderMonth(currentYear, currentMonth);

  _injectPlannerCSS();
  document.body.appendChild(overlay);
}

export function renderReisPlannerPage(container) {
  const mount = resolveContainer(container);
  if (!mount) return;
  injectInlineStyles();

  const events = Array.isArray(db?.evenementen) ? db.evenementen.slice() : [];
  const upcoming = events
    .filter(ev => !isClosed(ev))
    .sort((a, b) => new Date(a.beginDatum || a.startdatum || a.start || 0) - new Date(b.beginDatum || b.startdatum || b.start || 0))
    .slice(0, 6);

  const trips = Array.isArray(db?.reizen) ? db.reizen.slice() : [];
  const tripBuckets = _categorizeTripsForDisplay(trips);
  const activeTrips = tripBuckets.active;
  const upcomingTrips = tripBuckets.upcoming;

  mount.innerHTML = '';
  mount.classList.add('panel-stack');

  const header = document.createElement('div');
  header.className = 'panel-header';
  header.innerHTML = '<h2>✈️ Reisplanning</h2>';

  const actionBar = document.createElement('div');
  actionBar.className = 'panel-actions';

  const fullBtn = document.createElement('button');
  fullBtn.className = 'btn-secondary';
  fullBtn.textContent = '🗓️ Open planner';
  fullBtn.onclick = () => openReisPlannerModal();

  const newEventBtn = document.createElement('button');
  newEventBtn.className = 'btn-primary';
  newEventBtn.textContent = '➕ Nieuw evenement';
  newEventBtn.onclick = async () => {
    try {
      const { openEventScheduleModal } = await import('./15_eventSchedule.js');
      openEventScheduleModal(true);
    } catch (err) {
      console.warn('[POS] event schedule openen faalde', err);
      showAlert('Kan nieuw evenement formulier niet openen.', 'error');
    }
  };

  actionBar.append(fullBtn, newEventBtn);
  header.appendChild(actionBar);
  mount.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'reis-grid';

  const upcomingCard = document.createElement('section');
  upcomingCard.className = 'panel-card';
  upcomingCard.innerHTML = '<h3>Komende evenementen</h3>';
  if (!upcoming.length) {
    upcomingCard.innerHTML += '<p class="muted">Geen geplande evenementen.</p>';
  } else {
    const list = document.createElement('ul');
    list.className = 'reis-list';
    upcoming.forEach(ev => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reis-item';
      const start = formatDate(ev.beginDatum || ev.startdatum || ev.start);
      const end = formatDate(ev.eindDatum || ev.einddatum || ev.end);
      const revenueLabel = _formatExpectedTurnoverLabel(ev) || 'Geen omzet gepland';
      const hasPlan = _eventHasCheesePlan(ev);
      const statusClass = hasPlan ? 'reis-status' : 'reis-status reis-status--warn';
      const statusLabel = hasPlan ? '🧀 Kaas gepland' : '⚪ Kaas niet gepland';
      button.innerHTML = `
        <div class="reis-title">${esc(ev.naam || 'Onbekend')}</div>
        <div class="reis-meta">${start}${end ? ` – ${end}` : ''} • ${esc(ev.locatie || 'n.t.b.')}</div>
        <div class="reis-amount">${esc(revenueLabel)}</div>
        <div class="reis-badges"><span class="${statusClass}">${esc(statusLabel)}</span></div>
      `;
      button.addEventListener('click', () => _openEventQuickLook(ev));
      item.appendChild(button);
      list.appendChild(item);
    });
    upcomingCard.appendChild(list);
  }
  grid.appendChild(upcomingCard);

  const tripsCard = document.createElement('section');
  tripsCard.className = 'panel-card';
  tripsCard.innerHTML = '<h3>Reizen & logistiek</h3>';

  const buildTripSection = (label, items) => {
    const section = document.createElement('div');
    section.className = 'reis-trip-section';
    const heading = document.createElement('h4');
    heading.className = 'reis-subtitle';
    heading.textContent = label;
    section.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'reis-list';
    items.forEach(meta => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reis-item';
      const range = _formatTripRange(meta.startIso, meta.endIso);
      const route = meta.bestemming ? ` • ${esc(meta.bestemming)}` : '';

      const infoBits = [];
      if (meta.bus) infoBits.push(`Bus ${esc(meta.bus)}`);
      if (meta.eventCount) infoBits.push(`${meta.eventCount} evt`);
      if (meta.omzet > 0) infoBits.push(`$${Number(meta.omzet).toLocaleString('nl-NL', { minimumFractionDigits: 0 })}`);
      if (meta.totalNeeded > 0) infoBits.push(`${meta.totalNeeded} stuks kaas mee`);
      if (meta.orderCrates > 0) infoBits.push(`${meta.orderCrates} kratten bestelling`);
      else {
        const pieceCount = meta.orderPieces > 0 ? meta.orderPieces : meta.totalOrderPieces;
        if (pieceCount > 0) infoBits.push(`${pieceCount} stuks bestellen`);
      }
      const infoLine = infoBits.join(' • ');

      const logistiekBits = [];
      if (meta.totalCentralPieces > 0) logistiekBits.push(`${meta.totalCentralPieces} stuks vanuit basis`);
      if (meta.totalFromBus > 0) logistiekBits.push(`${meta.totalFromBus} stuks al in bus`);
      const logistiekLine = logistiekBits.join(' • ');

      const notesLine = meta.notes ? esc(meta.notes) : '';
      const statusNormalized = String(meta.status || '').toLowerCase();
      const isWarnStatus = ['cancelled', 'geannuleerd', 'stopped'].includes(statusNormalized);
      const statusLabel = meta.status ? meta.status.toString().toUpperCase() : 'PLANNING';
      const statusClass = isWarnStatus ? 'reis-status reis-status--warn' : 'reis-status';

      button.innerHTML = `
        <div class="reis-title">${esc(meta.title)}</div>
        <div class="reis-meta">${range}${route}</div>
        ${infoLine ? `<div class="reis-notes">${infoLine}</div>` : ''}
        ${logistiekLine ? `<div class="reis-notes">${logistiekLine}</div>` : ''}
        ${notesLine ? `<div class="reis-notes">${notesLine}</div>` : ''}
        <div class="reis-badges"><span class="${statusClass}">${esc(statusLabel)}</span></div>
      `;
      button.addEventListener('click', () => _openTripDetails(meta));
      item.appendChild(button);
      list.appendChild(item);
    });

    section.appendChild(list);
    return section;
  };

  const hasTrips = activeTrips.length || upcomingTrips.length;
  if (!hasTrips) {
    tripsCard.innerHTML += '<p class="muted">Nog geen actuele of toekomstige reizen.</p>';
  } else {
    if (activeTrips.length) {
      tripsCard.appendChild(buildTripSection('🚚 Onderweg', activeTrips.slice(0, 4)));
    }
    if (upcomingTrips.length) {
      tripsCard.appendChild(buildTripSection('📅 Komende reizen', upcomingTrips.slice(0, 6)));
    }
  }

  grid.appendChild(tripsCard);

  mount.appendChild(grid);
}

function _formatExpectedTurnoverLabel(evt) {
  const amounts = _resolveExpectedTurnoverAmounts(evt);
  const parts = [];
  if (amounts.eur > 0) parts.push(formatCurrencyValue(amounts.eur, 'EUR'));
  if (amounts.usd > 0) parts.push(formatCurrencyValue(amounts.usd, 'USD'));
  if (parts.length) return parts.join(' • ');
  const fallback = _toNumber(evt?.verwachteOmzet || evt?.expectedRevenue || evt?.budget || evt?.bedrag);
  if (fallback > 0) {
    return formatCurrencyValue(fallback, 'USD');
  }
  return '';
}

function _resolveExpectedTurnoverAmounts(evt) {
  if (!evt) return { usd: 0, eur: 0 };
  const planning = evt?.planning?.expectedTurnover || evt?.planning || {};
  const usdCandidates = [
    planning?.usd,
    planning?.USD,
    planning?.amountUSD,
    planning?.expectedTurnoverUSD,
    planning?.expectedRevenueUSD,
    evt?.expectedTurnoverUSD,
    evt?.verwachteOmzetUSD,
    evt?.budgetUSD,
    evt?.bedragUSD
  ];
  const eurCandidates = [
    planning?.eur,
    planning?.EUR,
    planning?.amountEUR,
    planning?.expectedTurnoverEUR,
    planning?.expectedRevenueEUR,
    evt?.expectedTurnoverEUR,
    evt?.verwachteOmzetEUR,
    evt?.budgetEUR,
    evt?.bedragEUR
  ];

  let usd = 0;
  for (const candidate of usdCandidates) {
    const value = _toNumber(candidate);
    if (value > 0) {
      usd = value;
      break;
    }
  }

  let eur = 0;
  for (const candidate of eurCandidates) {
    const value = _toNumber(candidate);
    if (value > 0) {
      eur = value;
      break;
    }
  }

  if (!usd) {
    const fallbackUsd = _toNumber(evt?.bedrag || evt?.verwachteOmzet || evt?.expectedRevenue || 0);
    if (fallbackUsd > 0) {
      usd = fallbackUsd;
    }
  }

  return { usd, eur };
}

function _eventHasCheesePlan(evt) {
  const plan = _extractCheesePlan(evt);
  return Object.values(plan).some(value => Number(value) > 0);
}

function _extractCheesePlan(evt) {
  const plan = {};
  if (!evt) return plan;
  const estimate = evt?.planning?.cheeseEstimate;
  const sourceProducts = estimate && typeof estimate === 'object'
    ? (estimate.products && typeof estimate.products === 'object' ? estimate.products : estimate)
    : null;
  if (sourceProducts && typeof sourceProducts === 'object') {
    Object.entries(sourceProducts).forEach(([name, value]) => {
      const qty = Math.max(0, Math.round(Number(value) || 0));
      if (qty) plan[name] = qty;
    });
  }
  if (!Object.keys(plan).length && evt.plan && typeof evt.plan === 'object') {
    Object.entries(evt.plan).forEach(([name, value]) => {
      const qty = Math.max(0, Math.round(Number(value) || 0));
      if (qty) plan[name] = qty;
    });
  }
  return plan;
}

function _getCheeseCatalog() {
  const catalog = {};
  (db.producten || []).forEach(prod => {
    const type = String(prod?.type || '').toUpperCase();
    if (!CHEESE_TYPES.includes(type)) return;
    catalog[prod.naam] = {
      type,
      capacity: _capacity(prod.naam)
    };
  });
  return catalog;
}

function _cheeseTotalsFromPlan(plan) {
  const totals = { BG: 0, ROOK: 0, GEIT: 0 };
  const catalog = _getCheeseCatalog();
  Object.entries(plan || {}).forEach(([name, value]) => {
    const qty = Math.max(0, Math.round(Number(value) || 0));
    if (!qty) return;
    const type = catalog[name]?.type;
    if (type && type in totals) {
      totals[type] += qty;
    }
  });
  return totals;
}

function _formatPieces(value) {
  return Number(value || 0).toLocaleString('nl-NL');
}

function _analyzeEventCheese(evt) {
  const plan = _extractCheesePlan(evt);
  const hasPlan = Object.values(plan).some(val => Number(val) > 0);
  const catalog = _getCheeseCatalog();
  const availableTotals = _sumStock(db.voorraad || {});
  const availableByType = { BG: 0, ROOK: 0, GEIT: 0 };
  Object.entries(availableTotals).forEach(([product, qty]) => {
    const type = catalog[product]?.type;
    if (type && type in availableByType) {
      availableByType[type] += Math.max(0, Math.round(Number(qty) || 0));
    }
  });
  const totalAvailableAll = Object.values(availableTotals).reduce((sum, qty) => sum + Math.max(0, Math.round(Number(qty) || 0)), 0);
  const totalPieces = Object.values(plan).reduce((sum, qty) => sum + Math.max(0, Math.round(Number(qty) || 0)), 0);
  const shortages = [];
  Object.entries(plan).forEach(([product, qty]) => {
    const needed = Math.max(0, Math.round(Number(qty) || 0));
    const available = Math.max(0, Math.round(Number(availableTotals[product] || 0)));
    if (needed > available) {
      shortages.push({
        name: product,
        needed,
        available,
        shortage: needed - available,
        type: catalog[product]?.type || ''
      });
    }
  });

  const busKey = evt?.bus || '';
  const rawBusStock = (db?.voorraad && typeof db.voorraad === 'object') ? (db.voorraad[busKey] || {}) : {};
  const busStock = {};
  Object.entries(rawBusStock).forEach(([product, qty]) => {
    busStock[product] = Math.max(0, Math.round(Number(qty) || 0));
  });
  const busShortages = [];
  Object.entries(plan).forEach(([product, qty]) => {
    const needed = Math.max(0, Math.round(Number(qty) || 0));
    const available = Math.max(0, Math.round(Number(busStock[product] || 0)));
    if (needed > available) {
      busShortages.push({
        name: product,
        needed,
        available,
        shortage: needed - available,
        type: catalog[product]?.type || ''
      });
    }
  });
  const totalBusStock = Object.values(busStock).reduce((sum, qty) => sum + qty, 0);

  return {
    hasPlan,
    plan,
    totalPieces,
    planByType: _cheeseTotalsFromPlan(plan),
    availableTotals,
    availableByType,
    shortages,
    hasEnough: shortages.length === 0,
    busKey,
    busStock,
    busShortages,
    busHasEnough: busShortages.length === 0,
    totalAvailableAll,
    totalBusStock
  };
}

function _openEventQuickLook(evt) {
  if (!evt) return;
  const analysis = _analyzeEventCheese(evt);
  const start = formatDate(evt.beginDatum || evt.startdatum || evt.start);
  const end = formatDate(evt.eindDatum || evt.einddatum || evt.end);
  const revenueLabel = _formatExpectedTurnoverLabel(evt) || 'Geen omzet gepland';

  _modal(() => {
    const box = document.createElement('div');
    box.appendChild(_h2(`🧀 Kaascheck • ${evt.naam || 'Event'}`));

    const metaGrid = document.createElement('div');
    metaGrid.className = 'reis-detail-grid';
    metaGrid.innerHTML = `
      <div><strong>Periode</strong><span>${esc(start || '?')}${end ? ` → ${esc(end)}` : ''}</span></div>
      <div><strong>Locatie</strong><span>${esc(evt.locatie || 'n.t.b.')}</span></div>
      <div><strong>Bus</strong><span>${esc(evt.bus || 'n.t.b.')}</span></div>
      <div><strong>Omzet</strong><span>${esc(revenueLabel || 'n.t.b.')}</span></div>
    `;
    box.appendChild(metaGrid);

    if (!analysis.hasPlan) {
      box.appendChild(_p('Nog geen kaasplanning voor dit evenement.'));
    } else {
      const summaryGrid = document.createElement('div');
      summaryGrid.className = 'reis-detail-grid';
      const busLabel = analysis.busKey ? `${analysis.busKey} • ${_formatPieces(analysis.totalBusStock)} stuks` : `${_formatPieces(analysis.totalBusStock)} stuks`;
      summaryGrid.innerHTML = `
        <div><strong>Verwachte vraag</strong><span>${_formatPieces(analysis.totalPieces)} stuks</span></div>
        <div><strong>Totaal voorraad</strong><span>${_formatPieces(analysis.totalAvailableAll)} stuks</span></div>
        <div><strong>Voorraad bus</strong><span>${esc(busLabel)}</span></div>
      `;
      box.appendChild(summaryGrid);

      const statusNote = document.createElement('div');
      statusNote.className = 'rp-pack-note';
      if (analysis.hasEnough) {
        statusNote.textContent = '✅ Genoeg kaas in totale voorraad om de planning te dekken.';
      } else {
        statusNote.textContent = '⚠️ Onvoldoende voorraad voor alle producten. Bekijk de tekorten hieronder.';
        statusNote.style.background = 'rgba(198,40,40,.08)';
        statusNote.style.color = '#c62828';
      }
      box.appendChild(statusNote);

      if (!analysis.busHasEnough && analysis.hasEnough) {
        const busNote = document.createElement('div');
        busNote.className = 'rp-pack-note';
        busNote.textContent = 'Let op: busvoorraad is onvoldoende, vul aan vanuit de basis.';
        box.appendChild(busNote);
      }

      const table = document.createElement('table');
      table.className = 'rp-table rp-compact';
      table.innerHTML = `<thead><tr><th>Product</th><th style="text-align:right">Nodig</th><th style="text-align:right">Voorraad totaal</th><th style="text-align:right">Voorraad bus</th><th style="text-align:right">Tekort</th></tr></thead><tbody></tbody>`;
      const tbody = table.querySelector('tbody');
      Object.entries(analysis.plan)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([product, needed]) => {
          const availableAll = Math.max(0, Math.round(Number(analysis.availableTotals[product] || 0)));
          const availableBus = Math.max(0, Math.round(Number(analysis.busStock[product] || 0)));
          const shortageEntry = analysis.shortages.find(item => item.name === product);
          const shortage = shortageEntry ? shortageEntry.shortage : 0;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${_esc(product)}</td>
            <td style="text-align:right">${needed}</td>
            <td style="text-align:right">${availableAll}</td>
            <td style="text-align:right">${availableBus}</td>
            <td style="text-align:right" class="${shortage > 0 ? 'rp-neg' : 'rp-pos'}">${shortage}</td>
          `;
          tbody.appendChild(tr);
        });
      box.appendChild(table);
    }

    const actions = document.createElement('div');
    actions.className = 'rp-cta';
    const closeBtn = _btn('❌ Sluiten', 'red');
    closeBtn.onclick = closeAllModals;
    actions.appendChild(closeBtn);
    if (evt.startdatum && evt.einddatum) {
      const planBtn = _btn('📦 Plan aanpassen', 'green');
      planBtn.onclick = () => {
        closeAllModals();
        _wizardVoorraad(evt.startdatum, evt.einddatum);
      };
      actions.appendChild(planBtn);
    }
    box.appendChild(actions);
    return box;
  });
}

function _openTripDetails(meta) {
  if (!meta || !meta.raw) return;
  const reis = meta.raw;
  const startLabel = formatDate(meta.startIso || reis.start || reis.begin || reis.startdatum);
  const endLabel = formatDate(meta.endIso || reis.end || reis.eind || reis.einddatum);
  const updatedLabel = reis.updatedAt ? new Date(reis.updatedAt).toLocaleString('nl-NL') : 'Onbekend';
  const omzetLabel = meta.omzet > 0 ? `$${Number(meta.omzet).toLocaleString('nl-NL', { minimumFractionDigits: 0 })}` : 'n.t.b.';
  const kostenLabel = Number(reis.kosten) > 0 ? formatCurrencyValue(Number(reis.kosten), 'EUR') : 'n.t.b.';
  const statusLabel = String(reis.status || reis.state || 'planned').toUpperCase();

  _modal(() => {
    const box = document.createElement('div');
    box.appendChild(_h2(`✈️ ${esc(meta.title || 'Reis')}`));

    const infoCard = document.createElement('div');
    infoCard.className = 'rp-card';
    const infoHead = document.createElement('div');
    infoHead.className = 'rp-card-head';
    infoHead.textContent = 'Reisdetails';
    infoCard.appendChild(infoHead);

    const infoGrid = document.createElement('div');
    infoGrid.className = 'reis-detail-grid';
    infoGrid.innerHTML = `
      <div><strong>Periode</strong><span>${esc(startLabel || '?')}${endLabel ? ` → ${esc(endLabel)}` : ''}</span></div>
      <div><strong>Bus</strong><span>${esc(meta.bus || reis.bus || 'n.t.b.')}</span></div>
      <div><strong>Status</strong><span class="reis-inline-badge">${esc(statusLabel)}</span></div>
      <div><strong>Omzet</strong><span>${esc(omzetLabel)}</span></div>
      <div><strong>Kosten</strong><span>${esc(kostenLabel)}</span></div>
      <div><strong>Laatst bijgewerkt</strong><span>${esc(updatedLabel)}</span></div>
    `;
    infoCard.appendChild(infoGrid);
    box.appendChild(infoCard);

    const orders = Array.isArray(reis.bestelling) ? reis.bestelling : [];
    const orderCard = document.createElement('div');
    orderCard.className = 'rp-card';
    const orderHead = document.createElement('div');
    orderHead.className = 'rp-card-head';
    orderHead.textContent = '🛒 Bestellijst';
    orderCard.appendChild(orderHead);
    if (!orders.length) {
      orderCard.appendChild(_p('Geen bestelling nodig voor deze reis.'));
    } else {
      const table = document.createElement('table');
      table.className = 'rp-table rp-compact';
      table.innerHTML = `<thead><tr><th>Product</th><th style="text-align:right">Kratten</th><th style="text-align:right">Stuks</th></tr></thead><tbody></tbody>`;
      const tbody = table.querySelector('tbody');
      orders
        .slice()
        .sort((a, b) => String(a?.product || '').localeCompare(String(b?.product || '')))
        .forEach(order => {
          const crates = Math.max(0, Math.round(Number(order?.crates) || 0));
          const pieces = Math.max(0, Math.round(Number(order?.pieces || order?.stuks) || 0));
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${_esc(order?.product || 'Product')}</td><td style="text-align:right">${crates}</td><td style="text-align:right">${pieces}</td>`;
          tbody.appendChild(tr);
        });
      orderCard.appendChild(table);
    }
    box.appendChild(orderCard);

    const load = reis.logistiek?.load || {};
    const loadEntries = Object.entries(load || {});
    const packCard = document.createElement('div');
    packCard.className = 'rp-card';
    const packHead = document.createElement('div');
    packHead.className = 'rp-card-head';
    packHead.textContent = '🚚 Pakbon overzicht';
    packCard.appendChild(packHead);
    if (!loadEntries.length) {
      packCard.appendChild(_p('Geen pakbon beschikbaar.'));
    } else {
      const table = document.createElement('table');
      table.className = 'rp-table rp-compact';
      table.innerHTML = `<thead><tr><th>Product</th><th style="text-align:right">Nodig</th><th style="text-align:right">Uit bus</th><th style="text-align:right">Uit basis</th><th style="text-align:right">Bestellen</th><th style="text-align:right">Mee te nemen</th><th style="text-align:right">Kratten</th></tr></thead><tbody></tbody>`;
      const tbody = table.querySelector('tbody');
      loadEntries
        .slice()
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([product, details]) => {
          const info = details || {};
          const needed = Math.max(0, Math.round(Number(info.needed) || 0));
          const fromBus = Math.max(0, Math.round(Number(info.fromBus) || 0));
          const fromCentral = Math.max(0, Math.round(Number(info.fromCentral) || 0));
          const fromOrder = Math.max(0, Math.round(Number(info.fromOrder) || 0));
          const toLoad = fromCentral + fromOrder;
          const capacity = Math.max(1, Math.round(Number(info.capacity) || _capacity(product)));
          const breakdown = _crateBreakdown(toLoad, capacity);
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${_esc(product)}</td>
            <td style="text-align:right">${needed}</td>
            <td style="text-align:right">${fromBus}</td>
            <td style="text-align:right">${fromCentral}</td>
            <td style="text-align:right">${fromOrder}</td>
            <td style="text-align:right">${toLoad}</td>
            <td style="text-align:right">${_formatUnitLabel(product, breakdown.crates, breakdown.loose)}</td>
          `;
          tbody.appendChild(tr);
        });
      packCard.appendChild(table);
    }
    box.appendChild(packCard);

    const actions = document.createElement('div');
    actions.className = 'rp-cta';
    const refreshBtn = _btn('🔄 Actualiseren', 'blue');
    refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      try {
        await _actualizeTrip(meta, refreshBtn);
      } finally {
        refreshBtn.disabled = false;
      }
    };
    const closeBtn = _btn('❌ Sluiten', 'red');
    closeBtn.onclick = closeAllModals;
    actions.append(refreshBtn, closeBtn);
    box.appendChild(actions);
    return box;
  });
}

function _buildSelectionFromTrip(meta) {
  const reis = meta?.raw;
  if (!reis) return [];
  const bus = meta?.bus || reis.bus || '';
  const events = Array.isArray(reis.events) ? reis.events : [];
  const allEvents = Array.isArray(db?.evenementen) ? db.evenementen : [];
  return events
    .map(entry => {
      const eventId = entry?.id || entry?.eventId;
      if (!eventId) return null;
      const sourceEvent = allEvents.find(ev => ev?.id === eventId);
      if (!sourceEvent) return null;
      const turnover = _resolveExpectedTurnoverAmounts(sourceEvent);
      const plan = _extractCheesePlan(sourceEvent);
      return {
        evt: sourceEvent,
        eventId: sourceEvent.id,
        naam: sourceEvent.naam,
        locatie: sourceEvent.locatie,
        type: sourceEvent.type,
        bus: bus || sourceEvent.bus || 'VOLENDAM',
        startdatum: sourceEvent.startdatum || entry.start || entry.begin || sourceEvent.beginDatum,
        einddatum: sourceEvent.einddatum || entry.eind || entry.end || sourceEvent.eindDatum,
        bedrag: turnover.usd > 0 ? turnover.usd : turnover.eur,
        plan,
        demand: plan,
        cheeseEstimate: sourceEvent.planning?.cheeseEstimate
      };
    })
    .filter(Boolean);
}

async function _actualizeTrip(meta) {
  if (!meta || !meta.raw) {
    showAlert('Geen reis geselecteerd om te actualiseren.', 'warning');
    return;
  }
  const selection = _buildSelectionFromTrip(meta);
  if (!selection.length) {
    showAlert('Geen gekoppelde evenementen gevonden voor deze reis.', 'warning');
    return;
  }

  const startIso = _normalizeTripDate(meta.startIso || meta.raw.start || meta.raw.begin || meta.raw.startdatum || selection[0]?.startdatum);
  const endIso = _normalizeTripDate(meta.endIso || meta.raw.end || meta.raw.eind || meta.raw.einddatum || selection[selection.length - 1]?.einddatum);

  const planning = _computePlanningDataForEvents(selection, startIso, endIso);
  if (!planning.ok) {
    showAlert(planning.error || 'Kan planning niet berekenen.', 'error');
    return;
  }

  const data = planning.data;
  const busKey = meta.bus || meta.raw.bus || (data.busPlans[0]?.bus || 'VOLENDAM');
  const busPlan = data.busPlans.find(plan => plan.bus === busKey) || data.busPlans[0];
  if (!busPlan) {
    showAlert('Geen busplanning gevonden om op te slaan.', 'warning');
    return;
  }

  const savePromises = [];
  data.plannedEvents.forEach(entry => {
    const event = entry.evt || (db.evenementen || []).find(ev => ev?.id === entry.eventId);
    if (!event) return;
    if (!event.planning) event.planning = {};
    const plan = entry.plan || {};
    const hasPieces = Object.values(plan).some(value => Number(value) > 0);
    if (hasPieces) {
      const totals = _cheeseTotalsFromPlan(plan);
      event.planning.cheeseEstimate = {
        ...totals,
        categories: { ...totals },
        products: { ...plan }
      };
    } else if (event.planning && event.planning.cheeseEstimate) {
      delete event.planning.cheeseEstimate;
    }
    savePromises.push(saveEvent(event.id));
  });

  try {
    await Promise.all(savePromises);
  } catch (err) {
    console.warn('[POS] Evenementen opslaan faalde', err);
    showAlert('Opslaan van evenementen is deels mislukt.', 'error');
  }

  const nowIso = new Date().toISOString();
  const updatedTrip = _convertPlanToTrip(busPlan, {
    selectionStart: startIso,
    selectionEnd: endIso,
    periodLabel: data.periodLabel
  }) || {};

  const mergedTrip = {
    ...meta.raw,
    ...updatedTrip,
    id: meta.raw.id || updatedTrip.id || _generateTripId(),
    bus: busPlan.bus || meta.raw.bus,
    createdAt: meta.raw.createdAt || updatedTrip.createdAt || nowIso,
    updatedAt: nowIso,
    status: updatedTrip.status || meta.raw.status || 'planned',
    state: updatedTrip.state || meta.raw.state || 'planned'
  };

  if (!Array.isArray(db.reizen)) {
    db.reizen = [];
  }
  const idx = db.reizen.findIndex(trip => trip.id === mergedTrip.id);
  if (idx >= 0) {
    db.reizen[idx] = { ...db.reizen[idx], ...mergedTrip };
  } else {
    db.reizen.push(mergedTrip);
  }

  const saved = await saveReizen();
  if (!saved) {
    showAlert('Opslaan van reisplanning mislukt.', 'error');
    return;
  }

  showAlert('Reisplanning geactualiseerd.', 'success');
  closeAllModals();
  const refreshed = _buildTripDisplay(mergedTrip);
  if (refreshed) {
    _openTripDetails(refreshed);
  } else {
    openReisPlannerModal();
  }
}

function resolveContainer(container) {
  if (container instanceof HTMLElement) return container;
  if (typeof container === 'string') return document.querySelector(container);
  return document.getElementById('panel-reis') || document.getElementById('app');
}

function injectInlineStyles() {
  if (document.getElementById('reisplanner-inline-styles')) return;
  const css = `
    .reis-grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));}
    .reis-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.6rem;}
    .reis-list li{margin:0;padding:0;}
    .reis-item{background:#f9fafb;border-radius:12px;padding:.75rem .9rem;display:flex;flex-direction:column;gap:.35rem;border:none;width:100%;text-align:left;cursor:pointer;font:inherit;color:inherit;transition:background .2s ease,transform .2s ease;}
    .reis-item:hover{background:#f1f5f9;transform:translateY(-1px);}
    .reis-item:focus-visible{outline:3px solid rgba(42,150,38,.35);outline-offset:2px;}
    .reis-trip-section{margin-top:.75rem;display:flex;flex-direction:column;gap:.4rem;}
    .reis-trip-section:first-of-type{margin-top:.4rem;}
    .reis-subtitle{margin:0;color:#1f7a2e;font-weight:800;font-size:1rem;}
    .reis-title{font-weight:800;color:#194a1f;}
    .reis-meta{font-size:.85rem;color:#4b5563;}
    .reis-amount{font-size:.85rem;font-weight:700;color:#1f2937;}
    .reis-notes{font-size:.8rem;color:#6b7280;font-style:italic;}
    .reis-badges{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;}
    .reis-status{display:inline-flex;align-items:center;gap:.35rem;font-size:.78rem;font-weight:700;padding:.2rem .55rem;border-radius:999px;background:rgba(42,150,38,.08);color:#1f7a2e;}
    .reis-status--warn{background:rgba(198,40,40,.1);color:#c62828;}
    .reis-trip-section .reis-item{background:#fff;border:1px solid rgba(15,23,42,.08);}
    .reis-detail-grid{display:grid;gap:.6rem;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin:.4rem 0;}
    .reis-detail-grid div{display:flex;flex-direction:column;gap:.15rem;font-size:.82rem;color:#374151;}
    .reis-detail-grid strong{font-size:.72rem;font-weight:800;text-transform:uppercase;color:#1f7a2e;}
    .reis-inline-badge{display:inline-flex;align-items:center;gap:.35rem;font-size:.75rem;font-weight:700;padding:.2rem .55rem;border-radius:999px;background:rgba(15,23,42,.08);color:#1f2937;}
  `;
  const style = document.createElement('style');
  style.id = 'reisplanner-inline-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function esc(value) {
  return _esc(value);
}

// Exporteer wizards (optioneel bruikbaar buitenom)
export function openVoorraadPlanningForSelection(a,b){ return _wizardVoorraad(a,b); }
export function openBeschikbaarheidWizard(){ return _wizardBeschikbaarheid(); }

// ================= Module state =================
let currentYear = 0;
let currentMonth = 0;
let selStart = null;
let selEnd   = null;

function _shiftMonth(delta){
  currentMonth += delta;
  if (currentMonth < 0){
    currentMonth = 11;
    currentYear--;
  }
  if (currentMonth > 11){
    currentMonth = 0;
    currentYear++;
  }
}

// ================= Header & Kalender =================
function _buildHeader(){
  const bar = document.createElement('div');
  bar.className = 'rp-header';

  const left = document.createElement('div'); left.className = 'rp-h-left';
  const prev  = _btn('◀','amber');
  const today = _btn('Vandaag','blue');
  const next  = _btn('▶','amber');
  left.append(prev,today,next);

  const mid  = document.createElement('div'); mid.id='rp-title'; mid.className='rp-h-title';

  const right = document.createElement('div'); right.className='rp-h-right';
  const planStock   = _btn('📦 Kaasplanning','green'); planStock.disabled = true;
  const avail       = _btn('🗓️ Beschikbaarheid','indigo');
  const newEvt      = _btn('➕ Nieuw evenement','amber');
  const close       = _btn('✕','red');
  right.append(planStock, avail, newEvt, close);

  bar.append(left, mid, right);
  return { bar, prev, today, next, planStock, avail, newEvt, close };
}

function _updateTitle(){
  const t = document.getElementById('rp-title');
  if(!t) return;
  t.textContent = `${_monthName(currentMonth)} ${currentYear}` + (selStart&&selEnd?` • ${selStart} → ${selEnd}`:'');
}

function _buildCalendar(onSelectionChange){
  const wrap = document.createElement('div'); wrap.className='rp-cal-wrap';

  const wd = document.createElement('div'); wd.className='rp-weekdays';
  ['M','T','W','T','F','S','S'].forEach(d=>{ const c=document.createElement('div'); c.textContent=d; wd.appendChild(c); });

  const grid = document.createElement('div'); grid.className='rp-grid';
  wrap.append(wd, grid);

  function renderMonth(y,m){
    grid.innerHTML='';

    const first = new Date(y,m,1);
    const firstIdx = (first.getDay()+6)%7;
    const days = new Date(y,m+1,0).getDate();

    const cells=[];
    for(let i=0;i<42;i++){
      const dNum = i-firstIdx+1;
      const inMonth = dNum>=1 && dNum<=days;
      const cell = document.createElement('div');
      cell.className = `rp-cell${inMonth?'':' dim'}`;

      if(inMonth){
        const dateStr = _iso(y,m,dNum);
        cell.dataset.date = dateStr;

        const dn = document.createElement('div'); dn.className='rp-daynum'; dn.textContent=dNum;
        cell.appendChild(dn);

        cell.addEventListener('click', ()=>{
          if(!selStart || selEnd){ selStart=dateStr; selEnd=null; }
          else{ selEnd=dateStr; if(selEnd<selStart)[selStart,selEnd]=[selEnd,selStart]; }
          _applySelectionToCells(cells);
          onSelectionChange?.();
          _updateTitle();
        });
      }

      grid.appendChild(cell); cells.push(cell);
    }

    _renderEventsInto(cells,y,m);
    _applySelectionToCells(cells);
    _updateTitle();
    onSelectionChange?.();
  }

  return { wrap, renderMonth };
}

function _applySelectionToCells(cells){
  if(!Array.isArray(cells)) return;
  const start = selStart;
  const end = selEnd;
  cells.forEach(cell => {
    if(!cell) return;
    if(!cell.dataset || !cell.dataset.date){
      if(cell.classList) cell.classList.remove('selected','inrange','range-edge');
      return;
    }
    const date = cell.dataset.date;
    const isSingle = !!(start && !end && date === start);
    const inRange = !!(start && end && date >= start && date <= end);
    const isEdge = !!(start && end && (date === start || date === end));
    cell.classList.toggle('selected', isSingle);
    cell.classList.toggle('inrange', inRange);
    cell.classList.toggle('range-edge', isEdge);
  });
}

function _renderEventsInto(cells,y,m){
  const monthStart = _iso(y,m,1);
  const monthEnd   = _iso(y,m,new Date(y,m+1,0).getDate());

  (db.evenementen||[]).forEach(evt=>{
    if(!evt.startdatum || !evt.einddatum) return;

    const start = _maxDate(evt.startdatum, monthStart);
    const eind  = _minDate(evt.einddatum,  monthEnd);
    if(start>eind) return;

    const locColor = _locColor(evt.locatie);
    const perColor = _personColor(evt.personen);

    for(let d=new Date(start); d<=new Date(eind); d.setDate(d.getDate()+1)){
      const key = _iso(d.getFullYear(), d.getMonth(), d.getDate());
      const cell = cells.find(c=>c.dataset.date===key);
      if(!cell) continue;
      const mark = document.createElement('div');
      mark.className='rp-fill';
      mark.style.setProperty('--loc', locColor);
      mark.style.setProperty('--per', perColor);
      cell.appendChild(mark);
    }

    const firstCell = cells.find(c=>c.dataset.date===start);
    if(firstCell){
      const tag = document.createElement('div');
      tag.className='rp-tag';
      tag.textContent = evt.naam||'';
      tag.style.background = locColor;
      tag.title = `${evt.naam||''}\n${evt.locatie||''}\n${evt.startdatum} → ${evt.einddatum}`;
      tag.onclick = ()=> _openQuickEdit(evt);
      firstCell.appendChild(tag);
    }
  });
}

// ================= Reisoverzicht =================
function _renderTripList(){
  const wrap = document.createElement('div');
  wrap.className = 'rp-triplist';
  const reizen = (db.reizen||[]).slice().sort((a,b)=> new Date(b.start) - new Date(a.start));
  if(!reizen.length){
    wrap.innerHTML = '<p class="rp-p">Geen opgeslagen reizen.</p>';
    return wrap;
  }
  reizen.forEach(r=>{
    const card = document.createElement('div');
    card.className = 'rp-card';
    const bestel = (r.bestelling||[]).map(b=>`${_esc(b.product)}: ${b.crates} ${b.type}`).join('<br>');
    card.innerHTML = `
      <div class="rp-card-head">${_esc(r.start)} → ${_esc(r.end)}</div>
      <div class="rp-line"><span class="rp-lab">Omzet</span><span>$${Number(r.inkomsten||0).toFixed(2)}</span></div>
      <div class="rp-line"><span class="rp-lab">Kosten</span><span>€${Number(r.kosten||0).toFixed(2)}</span></div>
      <details class="rp-details"><summary>Bestellijst</summary>${bestel||'—'}</details>
    `;
    wrap.appendChild(card);
  });
  return wrap;
}

// ================= Wizard 1: Periode → Voorraad =================
function _wizardVoorraad(aStart, aEnd){
  const events = (db.evenementen||[]).filter(e => _rangesOverlap(aStart,aEnd,e.startdatum,e.einddatum));

  _modal(()=>{
    const box = document.createElement('div');
    box.appendChild(_h2(`🧀 Kaasplanning (${_fmt(aStart)} → ${_fmt(aEnd)})`));

    if(!events.length){
      box.appendChild(_p('Geen evenementen in de gekozen periode.'));
      return box;
    }

    box.appendChild(_p('Selecteer de evenementen die je wilt meenemen in de planning en vul de verwachte omzet in.'));

    const busOptions = Object.keys(db.voorraad||{});
    const list = document.createElement('div');
    list.className = 'rp-event-grid';
    const inputs=[];

    events.forEach(evt=>{
      const card = document.createElement('section');
      card.className = 'rp-event-card';

      const head = document.createElement('div');
      head.className = 'rp-event-head';
      const title = document.createElement('div');
      title.className = 'rp-event-title';
      title.textContent = evt.naam || 'Event';
      const meta = document.createElement('div');
      meta.className = 'rp-event-meta';
      const dateLabel = `${_fmt(evt.startdatum)} → ${_fmt(evt.einddatum)}`;
      meta.textContent = `${dateLabel} • ${evt.locatie || 'Locatie n.t.b.'}`;
      head.append(title, meta);

      const fields = document.createElement('div');
      fields.className = 'rp-event-fields';

      const includeField = document.createElement('label');
      includeField.className = 'rp-event-field';
      includeField.innerHTML = '<span>Meenemen</span>';
      const includeToggle = document.createElement('input');
      includeToggle.type = 'checkbox';
      includeToggle.checked = true;
      includeField.appendChild(includeToggle);

      const busField = document.createElement('label');
      busField.className = 'rp-event-field';
      busField.innerHTML = '<span>Bus</span>';
      const busSel=document.createElement('select');
      const fallbackBussen = ['RENE','PIERRE','VOLENDAM'];
      const seenBussen = new Set();
      const addBusOption = (value) => {
        const label = (value || '').toString().trim();
        if (!label || seenBussen.has(label)) return;
        busSel.append(new Option(label, label));
        seenBussen.add(label);
      };
      if (busOptions.length){
        busOptions.forEach(addBusOption);
      } else {
        fallbackBussen.forEach(addBusOption);
      }
      fallbackBussen.forEach(addBusOption);
      addBusOption(evt.bus);
      const defaultBus = evt.bus && seenBussen.has(evt.bus) ? evt.bus : (busOptions[0] || fallbackBussen[0] || 'VOLENDAM');
      busSel.value = defaultBus;
      busField.appendChild(busSel);

      const omzetField = document.createElement('label');
      omzetField.className = 'rp-event-field';
      omzetField.innerHTML = '<span>Verwachte omzet (USD)</span>';
      const omzetInput = document.createElement('input');
      omzetInput.type = 'number';
      omzetInput.step = '1';
      omzetInput.inputMode = 'numeric';
      omzetInput.placeholder = '0';
      omzetInput.value = String(_estimateUSD(evt) || '');
      omzetField.appendChild(omzetInput);

      fields.append(includeField, busField, omzetField);

      const statusLine = document.createElement('div');
      statusLine.className = 'rp-event-total';
      statusLine.textContent = 'Geselecteerd';

      card.append(head, fields, statusLine);
      list.appendChild(card);

      inputs.push({
        evt,
        card,
        includeToggle,
        busSel,
        omzetInput,
        statusLine
      });
    });
    box.append(list);

    const total = document.createElement('div'); total.className='rp-total'; box.append(total);
    const perBusWrap = document.createElement('div'); perBusWrap.className = 'rp-bus-summary';
    box.append(perBusWrap);

    const updateTotal = ()=>{
      const perBus = {};
      let sumUsd = 0;
      let includedCount = 0;

      inputs.forEach(row=>{
        const active = !!row.includeToggle.checked;
        const usd = parseFloat(row.omzetInput.value)||0;
        const bus = row.busSel.value || 'VOLENDAM';

        row.card.classList.toggle('rp-event-card--inactive', !active);
        row.busSel.disabled = !active;
        row.omzetInput.disabled = !active;

        if (active) {
          includedCount += 1;
          sumUsd += usd;
          if (!perBus[bus]) {
            perBus[bus] = { events:0, usd:0 };
          }
          perBus[bus].events += 1;
          perBus[bus].usd += usd;
          row.statusLine.textContent = usd > 0 ? `Verwachte omzet $${usd.toFixed(0)}` : 'Verwachte omzet n.t.b.';
        } else {
          row.statusLine.textContent = 'Uit planning';
        }
      });

      total.textContent = includedCount
        ? `${includedCount} evenementen geselecteerd • Verwachte omzet $${sumUsd.toFixed(0)}`
        : 'Geen evenementen geselecteerd.';

      perBusWrap.innerHTML = '';
      Object.entries(perBus)
        .sort((a,b)=>a[0].localeCompare(b[0]))
        .forEach(([bus,data])=>{
          const chip = document.createElement('div');
          chip.className = 'rp-bus-total-card';

          const title = document.createElement('div');
          title.className = 'rp-bus-title';
          title.textContent = `Bus ${bus}`;
          const eventsLine = document.createElement('div');
          eventsLine.className = 'rp-bus-line';
          eventsLine.textContent = data.events === 1 ? '1 evenement' : `${data.events} evenementen`;
          chip.append(title, eventsLine);

          const usdLabel = document.createElement('div');
          usdLabel.className = 'rp-bus-omzet';
          usdLabel.textContent = data.usd > 0 ? `Omzet $${data.usd.toFixed(0)}` : 'Omzet n.t.b.';
          chip.appendChild(usdLabel);

          perBusWrap.appendChild(chip);
        });
    };

    inputs.forEach(row=>{
      row.includeToggle.addEventListener('change', updateTotal);
      row.busSel.addEventListener('change', ()=>{
        row.evt.bus = row.busSel.value || row.evt.bus || '';
        updateTotal();
      });
      row.omzetInput.addEventListener('input', updateTotal);
    });

    updateTotal();

    box.append(_cta([
      ['❌ Sluiten','red', closeAllModals],
      ['Kratten plannen →','green', ()=>{
        const selectie = inputs
          .filter(row => row.includeToggle.checked)
          .map(row => {
            const selectedBus = row.busSel.value || row.evt.bus || '';
            row.evt.bus = selectedBus;
            return {
              evt: row.evt,
              eventId: row.evt.id,
              naam: row.evt.naam,
              locatie: row.evt.locatie,
              type: row.evt.type,
              bus: selectedBus,
              startdatum: row.evt.startdatum,
              einddatum: row.evt.einddatum,
              bedrag: parseFloat(row.omzetInput.value) || 0
            };
          });
        if (!selectie.length) {
          showAlert('Selecteer minstens één evenement voor de planning.', 'warning');
          return;
        }
        closeAllModals();
        _wizardVoorraadStap2(aStart, aEnd, selectie);
      }]
    ]));
    return box;
  });
}


function _wizardVoorraadStap2(aStart, aEnd, selectie){
  const events = Array.isArray(selectie) ? selectie.filter(item => item && (item.evt || item.eventId)) : [];
  if (!events.length) {
    showAlert('Geen evenementen geselecteerd voor de kaasplanning.', 'warning');
    return;
  }

  const products = (db.producten||[])
    .filter(p => CHEESE_TYPES.includes(String(p.type||'').toUpperCase()))
    .map(p => ({ ...p, type: String(p.type||'').toUpperCase() }));

  if (!products.length) {
    showAlert('Geen kaasproducten gevonden om te plannen.', 'error');
    return;
  }

  const productMeta = {};
  const typeGroups = CHEESE_TYPES.reduce((acc, type) => {
    acc[type] = [];
    return acc;
  }, {});
  products.forEach(prod => {
    productMeta[prod.naam] = {
      type: prod.type,
      capacity: _capacity(prod.naam),
      usd: Number(prod.usd) || 0,
      eur: Number(prod.eur) || 0
    };
    typeGroups[prod.type].push(prod.naam);
  });

  const orderedProducts = products
    .slice()
    .sort((a, b) => {
      if (a.type === b.type) return a.naam.localeCompare(b.naam);
      return CHEESE_TYPES.indexOf(a.type) - CHEESE_TYPES.indexOf(b.type);
    })
    .map(prod => prod.naam);

  const weights = _normalizeProductWeights(products);
  const bufferFactor = BUFFER_FACTOR;
  const periodLabel = `${_fmt(aStart)} → ${_fmt(aEnd)}`;

  const eventStates = [];
  let summaryLabel;
  let summaryWrap;

  function updateEventTotals(targetState){
    if (!targetState?.totalLabel) return;
    let totalCrates = 0;
    let totalPieces = 0;
    orderedProducts.forEach(name => {
      const crates = Math.max(0, Math.round(Number(targetState.planCrates[name] || 0)));
      const capacity = productMeta[name]?.capacity || 1;
      totalCrates += crates;
      totalPieces += crates * capacity;
    });
    if (!totalCrates) {
      targetState.totalLabel.textContent = 'Nog geen kratten ingepland';
      return;
    }
    const crateLabel = totalCrates === 1 ? 'krat' : 'kratten';
    targetState.totalLabel.textContent = `${totalCrates} ${crateLabel} (${totalPieces} stuks)`;
  }

  function updateSummaryLabel(){
    if (!summaryLabel) return;
    const totalsByType = { BG:0, ROOK:0, GEIT:0 };
    let totalCrates = 0;
    eventStates.forEach(state => {
      orderedProducts.forEach(name => {
        const crates = Math.max(0, Math.round(Number(state.planCrates[name] || 0)));
        if (!crates) return;
        totalCrates += crates;
        const type = productMeta[name]?.type;
        if (type && type in totalsByType) {
          totalsByType[type] += crates;
        }
      });
    });
    if (!totalCrates) {
      summaryLabel.textContent = 'Nog geen kratten ingepland.';
      return;
    }
    const labelFor = (count) => count === 1 ? 'krat' : 'kratten';
    const parts = CHEESE_TYPES
      .filter(type => totalsByType[type] > 0)
      .map(type => `${type} ${totalsByType[type]} ${labelFor(totalsByType[type])}`);
    parts.push(`Totaal ${totalCrates} ${labelFor(totalCrates)}`);
    summaryLabel.textContent = parts.join(' • ');
  }

  function mapStatesToPlanned(){
    return eventStates.map(state => {
      const plan = {};
      const demand = {};
      const categoryTotals = { BG:0, ROOK:0, GEIT:0 };
      orderedProducts.forEach(name => {
        const pieces = Math.max(0, Math.round(Number(state.planPieces[name] || 0)));
        if (!pieces) return;
        plan[name] = pieces;
        const type = productMeta[name]?.type;
        if (type && type in categoryTotals) {
          categoryTotals[type] += pieces;
        }
      });
      orderedProducts.forEach(name => {
        const expected = Math.max(0, Math.round(Number(state.expectedDemand?.[name] || 0)));
        if (expected) {
          demand[name] = expected;
        }
      });
      const evt = state.entry.evt;
      const totalPieces = Object.values(plan).reduce((sum, val) => sum + val, 0);
      if (evt) {
        if (!evt.planning) evt.planning = {};
        if (totalPieces > 0) {
          evt.planning.cheeseEstimate = {
            ...categoryTotals,
            categories: { ...categoryTotals },
            products: { ...plan }
          };
        } else if (evt.planning && evt.planning.cheeseEstimate) {
          delete evt.planning.cheeseEstimate;
        }
        evt.bus = state.entry.bus;
      }
      return {
        evt,
        eventId: state.entry.eventId,
        naam: state.entry.naam,
        locatie: state.entry.locatie,
        type: state.entry.type,
        bus: state.entry.bus,
        startdatum: state.entry.startdatum,
        einddatum: state.entry.einddatum,
        bedrag: Number(state.entry.bedrag) || 0,
        plan,
        demand,
        totalPieces
      };
    });
  }

  function renderSummary(){
    if (!summaryWrap) return;
    const planned = mapStatesToPlanned();
    summaryWrap.innerHTML = '';
    if (!planned.length) {
      summaryWrap.appendChild(_p('Geen planning beschikbaar.'));
      return;
    }
    const planning = _computePlanningDataForEvents(planned, aStart, aEnd, { bufferFactor });
    if (!planning.ok) {
      summaryWrap.appendChild(_p(planning.error || 'Kan planning niet berekenen.'));
      return;
    }
    _renderPlanningSummary(summaryWrap, planning.data, {
      selectionStart: aStart,
      selectionEnd: aEnd,
      periodLabel: planning.data?.periodLabel || periodLabel
    });
  }

  const scheduleSummaryRefresh = (() => {
    let scheduled = false;
    return () => {
      if (scheduled) return;
      scheduled = true;
      const runner = () => {
        scheduled = false;
        renderSummary();
      };
      if (typeof window?.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(runner);
      } else {
        setTimeout(runner, 50);
      }
    };
  })();

  _modal(()=>{
    const box=document.createElement('div');
    box.appendChild(_h2(`🧺 Kratten plannen (${periodLabel})`));
    box.appendChild(_p('Pas het aantal kratten per smaak aan. Losse kazen worden automatisch afgerond naar hele kratten.'));

    const list = document.createElement('div');
    list.className = 'rp-event-grid';

    events.forEach(entry => {
      const sourceEvent = entry.evt || (db.evenementen||[]).find(e => e.id === entry.eventId);
      const base = {
        evt: sourceEvent,
        eventId: entry.eventId || sourceEvent?.id,
        naam: entry.naam || sourceEvent?.naam || 'Event',
        locatie: entry.locatie || sourceEvent?.locatie || '',
        type: entry.type || sourceEvent?.type || '',
        startdatum: entry.startdatum || entry.start || sourceEvent?.startdatum,
        einddatum: entry.einddatum || entry.eind || sourceEvent?.einddatum,
        bedrag: Number(entry.bedrag) || 0,
        bus: entry.bus || sourceEvent?.bus || 'VOLENDAM'
      };

      const storedEstimate = sourceEvent?.planning?.cheeseEstimate;
      const storedPlan = storedEstimate
        ? _buildEventPlan({ cheeseEstimate: storedEstimate }, products, weights, typeGroups, 1)
        : {};
      const incomingPlan = entry.plan && typeof entry.plan === 'object' ? entry.plan : {};

      const planPieces = {};
      const expectedDemand = {};
      let autoGenerated = false;

      orderedProducts.forEach(name => {
        const demand = Math.max(0, Math.round(Number(incomingPlan[name] || storedPlan[name] || 0)));
        if (demand) {
          planPieces[name] = demand;
        }
      });

      if (!Object.keys(planPieces).length) {
        const recommendation = _buildEventPlan({ ...entry, bedrag: base.bedrag }, products, weights, typeGroups, bufferFactor);
        Object.assign(planPieces, recommendation);
        autoGenerated = true;
      }

      if (entry.expectedDemand && typeof entry.expectedDemand === 'object') {
        Object.entries(entry.expectedDemand).forEach(([name, qty]) => {
          const amount = Math.max(0, Math.round(Number(qty) || 0));
          if (amount) {
            expectedDemand[name] = amount;
          }
        });
      } else if (sourceEvent?.planning?.cheeseEstimate?.products) {
        Object.entries(sourceEvent.planning.cheeseEstimate.products).forEach(([name, qty]) => {
          const amount = Math.max(0, Math.round(Number(qty) || 0));
          if (amount) {
            expectedDemand[name] = amount;
          }
        });
      } else if (autoGenerated) {
        Object.entries(planPieces).forEach(([name, qty]) => {
          const amount = Math.max(0, Math.round(Number(qty) || 0));
          if (amount) {
            expectedDemand[name] = amount;
          }
        });
      }

      const planCrates = {};
      const applyFns = {};
      orderedProducts.forEach(name => {
        const capacity = productMeta[name]?.capacity || 1;
        const pieces = Math.max(0, Math.round(Number(planPieces[name] || 0)));
        const crates = pieces > 0 ? Math.ceil(pieces / capacity) : 0;
        planCrates[name] = crates;
        planPieces[name] = crates * capacity;
        expectedDemand[name] = Math.max(0, Math.round(Number(expectedDemand[name] || 0)));
      });

      const state = {
        entry: base,
        planCrates: { ...planCrates },
        planPieces: { ...planPieces },
        expectedDemand: { ...expectedDemand },
        autoGenerated,
        totalLabel: null,
        applyFns
      };
      eventStates.push(state);

      const card = document.createElement('section');
      card.className = 'rp-event-card';

      const head = document.createElement('div');
      head.className = 'rp-event-head';
      const title = document.createElement('div');
      title.className = 'rp-event-title';
      title.textContent = base.naam || 'Event';
      const meta = document.createElement('div');
      meta.className = 'rp-event-meta';
      const dateLabel = `${_fmt(base.startdatum)} → ${_fmt(base.einddatum)}`;
      meta.textContent = `${dateLabel} • ${base.locatie || 'Locatie n.t.b.'}`;
      head.append(title, meta);

      const hint = document.createElement('div');
      hint.className = 'rp-slot-hint';
      const omzetLabel = base.bedrag > 0 ? `$${base.bedrag.toFixed(0)}` : 'n.t.b.';
      hint.textContent = `Bus ${base.bus || 'VOLENDAM'} • Verwachte omzet ${omzetLabel}`;

      const crateGrid = document.createElement('div');
      crateGrid.className = 'rp-crate-grid';

      orderedProducts.forEach(name => {
        const capacity = productMeta[name]?.capacity || 1;
        const row = document.createElement('div');
        row.className = 'rp-crate-row';

        const left = document.createElement('div');
        left.className = 'rp-crate-left';
        const label = document.createElement('div');
        label.className = 'rp-crate-name';
        label.textContent = name;
        const info = document.createElement('div');
        info.className = 'rp-crate-info';
        info.textContent = `${productMeta[name]?.type || ''} • ${capacity} st/krat`;
        left.append(label, info);

        const right = document.createElement('div');
        right.className = 'rp-crate-right';
        const controls = document.createElement('div');
        controls.className = 'rp-qty';
        const minus = document.createElement('button');
        minus.type = 'button';
        minus.className = 'rp-qty-btn';
        minus.textContent = '−';
        const count = document.createElement('span');
        count.className = 'rp-qty-count';
        const plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'rp-qty-btn';
        plus.textContent = '+';
        controls.append(minus, count, plus);

        const piecesLabel = document.createElement('div');
        piecesLabel.className = 'rp-crate-pieces';
        right.append(controls, piecesLabel);

        row.append(left, right);
        crateGrid.appendChild(row);

        const expected = state.expectedDemand[name] || 0;
        const applyValue = (nextValue) => {
          const safe = Math.max(0, Math.round(Number(nextValue)||0));
          state.planCrates[name] = safe;
          const pieces = safe * capacity;
          state.planPieces[name] = pieces;
          count.textContent = String(safe);
          const delta = pieces - expected;
          const hintLabel = delta === 0
            ? `≈ verwacht ${expected}`
            : delta > 0
              ? `+${delta} tov. verwachting`
              : `${delta} tov. verwachting`;
          piecesLabel.innerHTML = `<strong>${pieces}</strong> stuks<span>${hintLabel}</span>`;
          minus.disabled = safe === 0;
          updateEventTotals(state);
          updateSummaryLabel();
          scheduleSummaryRefresh();
        };

        state.applyFns[name] = applyValue;
        minus.addEventListener('click', ()=> applyValue((state.planCrates[name] || 0) - 1));
        plus.addEventListener('click', ()=> applyValue((state.planCrates[name] || 0) + 1));

        applyValue(state.planCrates[name] || 0);
      });

      const totalLine = document.createElement('div');
      totalLine.className = 'rp-event-total';
      state.totalLabel = totalLine;
      updateEventTotals(state);

      card.append(head, hint, crateGrid, totalLine);
      list.appendChild(card);
    });

    _rebalanceCratesByBus(eventStates, orderedProducts, productMeta);
    eventStates.forEach(state => {
      orderedProducts.forEach(name => {
        const apply = state.applyFns?.[name];
        if (apply) apply(state.planCrates[name] || 0);
      });
    });

    summaryLabel = document.createElement('div');
    summaryLabel.className = 'rp-total';
    updateSummaryLabel();

    box.append(list);
    box.append(summaryLabel);

    summaryWrap = document.createElement('section');
    summaryWrap.className = 'rp-summary-panel';
    box.append(summaryWrap);

    const navRow = _cta([
      ['← Selectie aanpassen','blue', ()=>{ closeAllModals(); _wizardVoorraad(aStart, aEnd); }],
      ['❌ Sluiten','red', closeAllModals]
    ]);
    box.append(navRow);

    renderSummary();

    return box;
  });
}

function _computePlanningDataForEvents(eventsInput, aStart, aEnd, options = {}) {
  const events = Array.isArray(eventsInput)
    ? eventsInput.filter(item => item && (item.evt || item.eventId))
    : [];
  if (!events.length) {
    return { ok: false, error: 'Geen evenementen geselecteerd voor de kaasplanning.' };
  }

  const products = (db.producten || [])
    .filter(p => CHEESE_TYPES.includes(String(p.type || '').toUpperCase()))
    .map(p => ({ ...p, type: String(p.type || '').toUpperCase() }));

  if (!products.length) {
    return { ok: false, error: 'Geen kaasproducten gevonden om te plannen.' };
  }

  const productMeta = {};
  const typeGroups = CHEESE_TYPES.reduce((acc, type) => {
    acc[type] = [];
    return acc;
  }, {});
  products.forEach(prod => {
    productMeta[prod.naam] = {
      type: prod.type,
      capacity: _capacity(prod.naam),
      usd: Number(prod.usd) || 0,
      eur: Number(prod.eur) || 0
    };
    typeGroups[prod.type].push(prod.naam);
  });

  const weights = _normalizeProductWeights(products);
  const bufferFactor = Number(options.bufferFactor) > 0 ? Number(options.bufferFactor) : BUFFER_FACTOR;
  const periodLabel = `${_fmt(aStart)} → ${_fmt(aEnd)}`;

  const plannedEvents = events.map(entry => {
    const sourceEvent = entry.evt || (db.evenementen || []).find(ev => ev?.id === entry.eventId);
    const baseBus = entry.bus || sourceEvent?.bus || 'VOLENDAM';
    const budget = Number(entry.bedrag) || 0;

    const directPlan = {};
    if (entry.plan && typeof entry.plan === 'object') {
      Object.entries(entry.plan).forEach(([product, qty]) => {
        const value = Math.max(0, Math.round(Number(qty) || 0));
        if (value) directPlan[product] = value;
      });
    }

    let plan = { ...directPlan };
    if (!Object.keys(plan).length && entry.cheeseEstimate && typeof entry.cheeseEstimate === 'object') {
      plan = _buildEventPlan({ cheeseEstimate: entry.cheeseEstimate }, products, weights, typeGroups, 1);
    }
    if (!Object.keys(plan).length && sourceEvent?.planning?.cheeseEstimate) {
      plan = _buildEventPlan({ cheeseEstimate: sourceEvent.planning.cheeseEstimate }, products, weights, typeGroups, 1);
    }
    if (!Object.keys(plan).length) {
      plan = _buildEventPlan({ ...entry, bedrag: budget }, products, weights, typeGroups, bufferFactor);
    }

    const normalizedPlan = {};
    Object.entries(plan || {}).forEach(([product, qty]) => {
      const amount = Math.max(0, Math.round(Number(qty) || 0));
      if (amount) normalizedPlan[product] = amount;
    });

    const demand = { ...normalizedPlan };
    const totalPieces = Object.values(normalizedPlan).reduce((sum, val) => sum + (Number(val) || 0), 0);

    return {
      ...entry,
      evt: sourceEvent,
      bus: baseBus,
      bedrag: budget,
      plan: normalizedPlan,
      demand,
      totalPieces
    };
  });

  const totalBudget = plannedEvents.reduce((sum, evt) => sum + (Number(evt.bedrag) || 0), 0);
  const totalNeeded = {};
  const totalByType = { BG: 0, ROOK: 0, GEIT: 0 };
  const eventsByBus = {};

  plannedEvents.forEach(evt => {
    const busKey = evt.bus || 'VOLENDAM';
    if (!eventsByBus[busKey]) {
      eventsByBus[busKey] = { bus: busKey, events: [] };
    }
    eventsByBus[busKey].events.push(evt);

    Object.entries(evt.demand || evt.plan || {}).forEach(([product, qty]) => {
      const amount = Math.max(0, Math.round(Number(qty) || 0));
      if (!amount) return;
      totalNeeded[product] = (totalNeeded[product] || 0) + amount;
      const type = productMeta[product]?.type;
      if (type && type in totalByType) {
        totalByType[type] += amount;
      }
    });
  });

  const stockOriginal = _cloneStock(db.voorraad || {});
  const centralKey = _detectCentralLocation(stockOriginal);
  const stockWorking = _cloneStock(stockOriginal);
  const orderNeeds = {};

  const busPlans = Object.values(eventsByBus).map(plan => {
    const load = {};
    const busStock = stockWorking[plan.bus] = stockWorking[plan.bus] || {};
    const centralStock = stockWorking[centralKey] = stockWorking[centralKey] || {};
    const sortedEvents = plan.events.slice().sort((a, b) => {
      const aDate = a.startdatum || a.start || '';
      const bDate = b.startdatum || b.start || '';
      return new Date(aDate) - new Date(bDate);
    });
    const eventDetails = sortedEvents.map(evt => ({
      naam: evt.naam,
      start: evt.startdatum || evt.start,
      eind: evt.einddatum || evt.eind,
      loads: {},
      totalDemand: 0,
      totalLoaded: 0
    }));

    sortedEvents.forEach((evt, index) => {
      const demandSource = evt.demand && typeof evt.demand === 'object' ? evt.demand : (evt.plan || {});
      const planSource = evt.plan && typeof evt.plan === 'object' ? evt.plan : {};
      const detail = eventDetails[index];
      const productKeys = new Set([...Object.keys(demandSource || {}), ...Object.keys(planSource || {})]);

      productKeys.forEach(product => {
        const capacity = productMeta[product]?.capacity || 1;
        const demand = Math.max(0, Math.round(Number(demandSource?.[product] || 0)));
        let plannedLoad = Math.max(0, Math.round(Number(planSource?.[product] || 0)));
        const stockBeforeLoad = Math.max(0, Math.round(Number(busStock[product] || 0)));
        let addedFromCentral = 0;
        let addedFromOrder = 0;

        if (plannedLoad === 0 && demand > stockBeforeLoad) {
          const deficit = demand - stockBeforeLoad;
          plannedLoad = Math.ceil(deficit / capacity) * capacity;
        }

        if (plannedLoad > 0) {
          const availableCentral = Math.max(0, Math.round(Number(centralStock[product] || 0)));
          addedFromCentral = Math.min(plannedLoad, availableCentral);
          if (addedFromCentral) {
            centralStock[product] = availableCentral - addedFromCentral;
          }
          const remainingLoad = plannedLoad - addedFromCentral;
          if (remainingLoad > 0) {
            addedFromOrder = remainingLoad;
            orderNeeds[product] = (orderNeeds[product] || 0) + remainingLoad;
          }
          busStock[product] = stockBeforeLoad + plannedLoad;
        } else {
          busStock[product] = stockBeforeLoad;
        }

        const availableAfterLoad = Math.max(0, Math.round(Number(busStock[product] || 0)));
        const used = Math.min(availableAfterLoad, demand);
        const usedFromExisting = Math.min(stockBeforeLoad, used);
        busStock[product] = availableAfterLoad - used;

        if (!load[product]) {
          load[product] = {
            needed: 0,
            fromBus: 0,
            fromCentral: 0,
            fromOrder: 0,
            capacity
          };
        }

        load[product].needed += demand;
        load[product].fromBus += usedFromExisting;
        load[product].fromCentral += addedFromCentral;
        load[product].fromOrder += addedFromOrder;

        if (plannedLoad > 0 || demand > 0) {
          detail.loads[product] = {
            demand,
            loaded: plannedLoad,
            fromBus: usedFromExisting,
            fromCentral: addedFromCentral,
            fromOrder: addedFromOrder,
            remaining: busStock[product]
          };
          detail.totalDemand += demand;
          detail.totalLoaded += plannedLoad;
        }
      });
    });

    return { ...plan, events: sortedEvents, load, eventDetails, centralKey };
  });

  const totalStockAll = _sumStock(stockOriginal);
  const stockByType = { BG: 0, ROOK: 0, GEIT: 0 };
  Object.entries(totalStockAll).forEach(([product, qty]) => {
    const type = productMeta[product]?.type;
    if (type && type in stockByType) {
      stockByType[type] += Math.max(0, Number(qty) || 0);
    }
  });

  const demandRows = products
    .map(prod => {
      const needed = Math.max(0, Math.round(Number(totalNeeded[prod.naam] || 0)));
      const available = Math.max(0, Math.round(Number(totalStockAll[prod.naam] || 0)));
      const shortage = Math.max(0, needed - available);
      const breakdown = _crateBreakdown(needed, productMeta[prod.naam].capacity);
      return {
        product: prod.naam,
        type: prod.type,
        needed,
        available,
        shortage,
        capacity: productMeta[prod.naam].capacity,
        breakdown
      };
    })
    .sort((a, b) => a.product.localeCompare(b.product));

  const orderRows = demandRows
    .filter(row => row.shortage > 0)
    .map(row => {
      const meta = productMeta[row.product] || {};
      const pricing = _resolveUnitPrice(meta);
      const supplier = _supplierForProduct(row.product);
      const cost = pricing.price > 0 ? pricing.price * row.shortage : 0;
      return {
        ...row,
        orderBreakdown: _crateBreakdown(row.shortage, row.capacity),
        supplier,
        unitPrice: pricing.price,
        priceCurrency: pricing.currency,
        cost,
        costLabel: cost > 0 ? formatCurrencyValue(cost, pricing.currency) : 'n.t.b.'
      };
    });

  const totalDemandPieces = Object.values(totalNeeded).reduce((sum, val) => sum + (Number(val) || 0), 0);
  const totalCentralPieces = busPlans.reduce((sum, plan) => {
    const entries = Object.values(plan.load || {});
    return sum + entries.reduce((acc, item) => acc + (Number(item.fromCentral) || 0), 0);
  }, 0);
  const totalOrderPieces = Object.values(orderNeeds).reduce((sum, val) => sum + (Number(val) || 0), 0);
  const totalBusUsage = busPlans.reduce((sum, plan) => {
    const entries = Object.values(plan.load || {});
    return sum + entries.reduce((acc, item) => acc + (Number(item.fromBus) || 0), 0);
  }, 0);

  return {
    ok: true,
    data: {
      products,
      productMeta,
      typeGroups,
      weights,
      plannedEvents,
      totalBudget,
      totalByType,
      totalNeeded,
      busPlans,
      orderNeeds,
      totalStockAll,
      stockByType,
      demandRows,
      orderRows,
      periodLabel,
      centralKey,
      selectionStart: aStart,
      selectionEnd: aEnd,
      totalDemandPieces,
      totalCentralPieces,
      totalBusUsage,
      totalOrderPieces
    }
  };
}

function _rebalanceCratesByBus(eventStates, orderedProducts, productMeta){
  if (!Array.isArray(eventStates) || !eventStates.length) return;
  const groups = {};
  eventStates.forEach(state => {
    if (!state || !state.entry) return;
    const busKey = state.entry.bus || 'VOLENDAM';
    if (!groups[busKey]) groups[busKey] = [];
    groups[busKey].push(state);
  });

  Object.values(groups).forEach(list => {
    list.sort((a,b)=>{
      const aDate = a.entry.startdatum || a.entry.start || '';
      const bDate = b.entry.startdatum || b.entry.start || '';
      return new Date(aDate) - new Date(bDate);
    });

    const busKey = list[0]?.entry?.bus || 'VOLENDAM';
    const initialStock = (db?.voorraad && typeof db.voorraad === 'object') ? (db.voorraad[busKey] || {}) : {};
    const carry = {};
    orderedProducts.forEach(name => {
      const startQty = Math.max(0, Math.round(Number(initialStock?.[name] || 0)));
      if (startQty > 0) carry[name] = startQty;
    });
    list.forEach(state => {
      orderedProducts.forEach(name => {
        const capacity = productMeta[name]?.capacity || 1;
        const demand = Math.max(0, Math.round(Number(state.expectedDemand?.[name] || 0)));
        const plannedPieces = Math.max(0, Math.round(Number(state.planPieces?.[name] || 0)));
        let remainder = carry[name] || 0;

        if (state.autoGenerated) {
          if (demand <= remainder) {
            state.planCrates[name] = 0;
            state.planPieces[name] = 0;
            remainder = remainder - demand;
          } else {
            const needed = demand - remainder;
            const crates = Math.ceil(needed / capacity);
            state.planCrates[name] = crates;
            state.planPieces[name] = crates * capacity;
            remainder = remainder + (crates * capacity) - demand;
          }
        } else {
          const crates = Math.max(0, Math.round(Number(state.planCrates?.[name] || 0)));
          state.planCrates[name] = crates;
          state.planPieces[name] = plannedPieces;
          remainder = Math.max(0, remainder + plannedPieces - demand);
        }

        carry[name] = remainder;
      });
    });
  });
}


function _renderPlanningSummary(target, planningData, meta = {}){
  if (!target) return;
  target.innerHTML = '';

  const data = planningData && typeof planningData === 'object' ? planningData : {};
  const {
    products = [],
    productMeta = {},
    plannedEvents: plannedEventList = [],
    totalBudget: rawBudget = 0,
    totalByType = {},
    demandRows: demandList = [],
    orderRows: orderList = [],
    busPlans: busPlanList = [],
    stockByType = {},
    totalDemandPieces = 0,
    totalCentralPieces = 0,
    totalBusUsage = 0,
    totalOrderPieces = 0,
    periodLabel: rawPeriodLabel = ''
  } = data;

  const plannedEvents = Array.isArray(plannedEventList) ? plannedEventList : [];
  const demandRows = Array.isArray(demandList) ? demandList : [];
  const orderRows = Array.isArray(orderList) ? orderList : [];
  const busPlans = Array.isArray(busPlanList) ? busPlanList.slice() : [];
  const periodLabel = rawPeriodLabel || `${_fmt(meta.selectionStart)} → ${_fmt(meta.selectionEnd)}`;

  const fmtPieces = value => Number(value || 0).toLocaleString('nl-NL');
  const safeBudget = Number(rawBudget) || 0;

  const title = document.createElement('h3');
  title.className = 'rp-sub';
  title.textContent = `📦 Voorraadplanning (${periodLabel})`;
  target.appendChild(title);

  const intro = document.createElement('p');
  intro.className = 'rp-p';
  intro.textContent = `${plannedEvents.length} evenementen, verwachte omzet $${safeBudget.toFixed(2)}.`;
  target.appendChild(intro);

  const summaryGrid = document.createElement('div');
  summaryGrid.className = 'rp-summary-grid';
  summaryGrid.innerHTML = `
      <div class="rp-summary-card"><span class="rp-summary-label">Evenementen</span><span class="rp-summary-value">${plannedEvents.length}</span></div>
      <div class="rp-summary-card"><span class="rp-summary-label">Verwachte vraag</span><span class="rp-summary-value">${fmtPieces(totalDemandPieces)} st</span></div>
      <div class="rp-summary-card"><span class="rp-summary-label">Uit busvoorraad</span><span class="rp-summary-value">${fmtPieces(totalBusUsage)} st</span></div>
      <div class="rp-summary-card"><span class="rp-summary-label">Aanvullen centrale</span><span class="rp-summary-value">${fmtPieces(totalCentralPieces)} st</span></div>
      <div class="rp-summary-card"><span class="rp-summary-label">Te bestellen</span><span class="rp-summary-value">${fmtPieces(totalOrderPieces)} st</span></div>`;
  target.appendChild(summaryGrid);

  const typeTable = document.createElement('table');
  typeTable.className = 'rp-table';
  typeTable.innerHTML = `<thead><tr><th>Categorie</th><th style="text-align:right">Nodig (st)</th><th style="text-align:right">Voorraad (st)</th><th style="text-align:right">Saldo</th></tr></thead><tbody></tbody>`;
  const typeBody = typeTable.querySelector('tbody');
  CHEESE_TYPES.forEach(type => {
    const needed = Math.round(totalByType[type] || 0);
    const available = Math.round(stockByType[type] || 0);
    const saldo = available - needed;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${type}</td><td style="text-align:right">${needed}</td><td style="text-align:right">${available}</td><td style="text-align:right" class="${saldo < 0 ? 'rp-neg' : 'rp-pos'}">${saldo}</td>`;
    typeBody.appendChild(tr);
  });
  target.appendChild(typeTable);

  const demandTitle = document.createElement('h3');
  demandTitle.className = 'rp-sub';
  demandTitle.textContent = 'Benodigde kaas per product';
  target.appendChild(demandTitle);

  const demandTable = document.createElement('table');
  demandTable.className = 'rp-table';
  demandTable.innerHTML = `<thead><tr><th>Product</th><th style="text-align:right">Nodig</th><th style="text-align:right">Voorraad totaal</th><th style="text-align:right">Tekort</th><th style="text-align:right">Kratten</th></tr></thead><tbody></tbody>`;
  const demandBody = demandTable.querySelector('tbody');
  demandRows.forEach(row => {
    const breakdown = row.breakdown || { crates: 0, loose: 0 };
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${_esc(row.product)}</td><td style="text-align:right">${row.needed}</td><td style="text-align:right">${row.available}</td><td style="text-align:right" class="${row.shortage > 0 ? 'rp-neg' : 'rp-pos'}">${row.shortage}</td><td style="text-align:right">${_formatUnitLabel(row.product, breakdown.crates, breakdown.loose)}</td>`;
    demandBody.appendChild(tr);
  });
  target.appendChild(demandTable);

  const orderSection = document.createElement('details');
  orderSection.className = 'rp-collapse';
  const orderSummary = document.createElement('summary');
  const orderCountLabel = orderRows.length ? `<span class="rp-summary-pill">${orderRows.length}</span>` : '';
  orderSummary.innerHTML = `🛒 Bestellijst ${orderCountLabel}`;
  orderSection.appendChild(orderSummary);

  const orderContainer = document.createElement('div');
  orderContainer.className = 'rp-collapse-body';

  const orderGroups = _groupOrdersBySupplier(orderRows);
  if (!orderGroups.length) {
    orderContainer.appendChild(_p('Er is genoeg voorraad beschikbaar, geen bestelling nodig.'));
  } else {
    const aggregatedTotals = {};
    orderGroups.forEach(group => {
      if (group.totalCostByCurrency) {
        Object.entries(group.totalCostByCurrency).forEach(([currency, value]) => {
          aggregatedTotals[currency] = (aggregatedTotals[currency] || 0) + value;
        });
      }

      const groupTitle = document.createElement('h4');
      groupTitle.className = 'rp-sub';
      groupTitle.textContent = `${group.supplier} • ${fmtPieces(group.totalShortage)} st`;
      orderContainer.appendChild(groupTitle);

      if (group.totalCostLabel) {
        const costLine = document.createElement('div');
        costLine.className = 'rp-order-total';
        costLine.textContent = `Kosten: ${group.totalCostLabel}`;
        orderContainer.appendChild(costLine);
      }

      const actionRow = document.createElement('div');
      actionRow.className = 'rp-order-actions';
      actionRow.appendChild(_shareButtons(`Bestellijst ${group.supplier} ${periodLabel}`, () => _formatOrderShare(periodLabel, [group])));
      const pdfControls = _buildOrderPdfButtons([group], periodLabel);
      if (pdfControls) actionRow.appendChild(pdfControls);
      orderContainer.appendChild(actionRow);

      const groupTable = document.createElement('table');
      groupTable.className = 'rp-table';
      groupTable.innerHTML = `<thead><tr><th>Product</th><th style="text-align:right">Tekort</th><th style="text-align:right">Kratten</th><th style="text-align:right">Kosten</th></tr></thead><tbody></tbody>`;
      const groupBody = groupTable.querySelector('tbody');
      group.rows.forEach(row => {
        const breakdown = row.orderBreakdown || { crates: 0, loose: 0 };
        const tr = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.textContent = row.product;
        tr.appendChild(nameCell);

        const shortageCell = document.createElement('td');
        shortageCell.style.textAlign = 'right';
        shortageCell.textContent = row.shortage;
        tr.appendChild(shortageCell);

        const crateCell = document.createElement('td');
        crateCell.style.textAlign = 'right';
        crateCell.textContent = _formatUnitLabel(row.product, breakdown.crates, breakdown.loose);
        tr.appendChild(crateCell);

        const costCell = document.createElement('td');
        costCell.style.textAlign = 'right';
        if (row.cost > 0 && row.priceCurrency) {
          costCell.textContent = row.costLabel;
        } else {
          costCell.classList.add('rp-muted');
          costCell.textContent = 'n.t.b.';
        }
        tr.appendChild(costCell);

        groupBody.appendChild(tr);
      });
      orderContainer.appendChild(groupTable);
    });

    const totalLabel = document.createElement('div');
    totalLabel.className = 'rp-order-total';
    const totalText = _formatTotalsLabel(aggregatedTotals);
    totalLabel.textContent = totalText ? `Totale kosten: ${totalText}` : 'Totale kosten: n.t.b.';
    orderContainer.appendChild(totalLabel);
  }

  orderSection.appendChild(orderContainer);
  target.appendChild(orderSection);

  const packTitle = document.createElement('h3');
  packTitle.className = 'rp-sub';
  packTitle.textContent = '🚚 Pakbonnen per bus';
  target.appendChild(packTitle);

  busPlans.sort((a, b) => (a.bus || '').localeCompare(b.bus || '')).forEach(plan => {
    const packDetails = document.createElement('details');
    packDetails.className = 'rp-collapse';
    const summary = document.createElement('summary');
    const eventCount = Array.isArray(plan.events) ? plan.events.length : 0;
    const totalToLoad = Object.values(plan.load || {}).reduce((sum, info) => sum + Math.max(0, Number(info.fromCentral || 0) + Number(info.fromOrder || 0)), 0);
    summary.innerHTML = `🚚 ${_esc(plan.bus)} <span class="rp-summary-meta">${eventCount} evenementen • ${fmtPieces(totalToLoad)} st mee</span>`;
    packDetails.appendChild(summary);

    const container = document.createElement('div');
    container.className = 'rp-collapse-body';

    const header = document.createElement('div');
    header.className = 'rp-pack-head';
    header.innerHTML = `<strong>${_esc(plan.bus)}</strong> • ${eventCount} evenementen`;
    container.appendChild(header);

    const timeline = document.createElement('div');
    timeline.className = 'rp-pack-timeline';
    (plan.eventDetails || []).forEach(det => {
      const chip = document.createElement('div');
      chip.className = 'rp-pack-chip';
      chip.innerHTML = `<strong>${_esc(det.naam || 'Event')}</strong><span>${_fmt(det.start)} → ${_fmt(det.eind)}</span><span>${fmtPieces(det.totalDemand)} st verwacht</span>`;
      timeline.appendChild(chip);
    });
    container.appendChild(timeline);

    const packActions = document.createElement('div');
    packActions.className = 'rp-pack-actions';
    packActions.appendChild(_shareButtons(`Pakbon ${plan.bus} ${periodLabel}`, () => _formatPackShare(periodLabel, plan)));
    const pdfBtn = _btn('📄 PDF', 'amber');
    pdfBtn.onclick = () => _exportPackPdf(plan, periodLabel);
    packActions.appendChild(pdfBtn);
    container.appendChild(packActions);

    const transferSourceName = plan.centralKey;
    const transferHeaderLabel = transferSourceName && transferSourceName !== plan.bus ? `Uit ${_esc(transferSourceName)}` : 'Uit basis';
    const transferTotal = Object.values(plan.load || {}).reduce((sum, info) => sum + Math.max(0, Number(info.fromCentral || 0)), 0);
    if (transferTotal > 0) {
      const transferNote = document.createElement('div');
      transferNote.className = 'rp-pack-note';
      const sourceLabel = transferSourceName && transferSourceName !== plan.bus ? transferSourceName : 'de basis';
      transferNote.textContent = `Verplaats ${fmtPieces(transferTotal)} stuks vanuit ${sourceLabel} naar ${plan.bus} voor vertrek.`;
      container.appendChild(transferNote);
    }

    const table = document.createElement('table');
    table.className = 'rp-table rp-compact';
    table.innerHTML = `<thead><tr><th>Product</th><th style="text-align:right">Nodig</th><th style="text-align:right">Uit bus</th><th style="text-align:right">${transferHeaderLabel}</th><th style="text-align:right">Mee te nemen</th><th style="text-align:right">Kratten</th></tr></thead><tbody></tbody>`;
    const body = table.querySelector('tbody');
    Object.entries(plan.load || {}).sort((a, b) => a[0].localeCompare(b[0])).forEach(([product, details]) => {
      const breakdown = _crateBreakdown(details.needed, details.capacity);
      const transfer = Math.max(0, Math.round(Number(details.fromCentral) || 0));
      const order = Math.max(0, Math.round(Number(details.fromOrder) || 0));
      const toLoad = transfer + order;

      const tr = document.createElement('tr');

      const productCell = document.createElement('td');
      productCell.textContent = product;
      tr.appendChild(productCell);

      const neededCell = document.createElement('td');
      neededCell.style.textAlign = 'right';
      neededCell.textContent = Math.max(0, Math.round(Number(details.needed) || 0));
      tr.appendChild(neededCell);

      const fromBusCell = document.createElement('td');
      fromBusCell.style.textAlign = 'right';
      fromBusCell.textContent = Math.max(0, Math.round(Number(details.fromBus) || 0));
      tr.appendChild(fromBusCell);

      const transferCell = document.createElement('td');
      transferCell.style.textAlign = 'right';
      transferCell.textContent = transfer;
      tr.appendChild(transferCell);

      const loadCell = document.createElement('td');
      loadCell.style.textAlign = 'right';
      loadCell.textContent = toLoad;
      if (order > 0) {
        const badge = document.createElement('div');
        badge.className = 'rp-pack-flag';
        badge.textContent = `Inclusief ${order} st bestelling`;
        loadCell.appendChild(badge);
      }
      tr.appendChild(loadCell);

      const crateCell = document.createElement('td');
      crateCell.style.textAlign = 'right';
      crateCell.textContent = _formatUnitLabel(product, breakdown.crates, breakdown.loose);
      tr.appendChild(crateCell);

      body.appendChild(tr);
    });
    container.appendChild(table);

    packDetails.appendChild(container);
    target.appendChild(packDetails);
  });

  const orderGroupsForExport = orderGroups;
  const handleExport = () => {
    try {
      const lines = ['Leverancier;Product;Tekort;Kratten;Kosten'];
      if (!orderGroupsForExport.length) {
        lines.push('Geen bestelling nodig;;;;');
      } else {
        orderGroupsForExport.forEach(group => {
          group.rows.forEach(row => {
            const breakdown = row.orderBreakdown || { crates: 0, loose: 0 };
            const crates = Math.max(0, Math.round(Number(breakdown.crates) || 0));
            const loose = Math.max(0, Math.round(Number(breakdown.loose) || 0));
            const capacity = Math.max(1, Math.round(Number(row.capacity) || Number(productMeta[row.product]?.capacity) || 1));
            const totalCrates = crates + (loose > 0 ? Math.ceil(loose / capacity) : 0);
            const costLabel = row.cost > 0 ? row.costLabel : 'n.t.b.';
            lines.push(`${group.supplier};${row.product};${row.shortage};${totalCrates};${costLabel}`);
          });
        });
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bestellijst_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      showAlert('CSV export mislukte.', 'error');
    }
  };

  const ctaRow = document.createElement('div');
  ctaRow.className = 'rp-cta';

  const saveBtn = _btn('💾 Reizen opslaan', 'green');
  saveBtn.onclick = async ev => {
    const btn = ev?.currentTarget;
    if (btn) btn.disabled = true;
    try {
      await _persistBusPlans(busPlans, {
        selectionStart: meta.selectionStart,
        selectionEnd: meta.selectionEnd,
        periodLabel
      });
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  const exportBtn = _btn('⬇️ Export CSV', 'amber');
  exportBtn.onclick = handleExport;

  ctaRow.append(saveBtn, exportBtn);
  target.appendChild(ctaRow);
}

async function _persistBusPlans(busPlans, meta = {}) {
  const plans = Array.isArray(busPlans) ? busPlans : [];
  if (!plans.length) {
    showAlert('Geen busplannen om op te slaan.', 'warning');
    return;
  }

  const prepared = plans
    .map(plan => _convertPlanToTrip(plan, meta))
    .filter(Boolean);

  if (!prepared.length) {
    showAlert('Geen reizen om op te slaan.', 'warning');
    return;
  }

  if (!Array.isArray(db.reizen)) {
    db.reizen = [];
  }

  const nowIso = new Date().toISOString();

  prepared.forEach(trip => {
    const signature = _tripSignature(trip);
    const idx = db.reizen.findIndex(existing => _tripSignature(existing) === signature);
    if (idx >= 0) {
      const existing = db.reizen[idx] || {};
      db.reizen[idx] = {
        ...existing,
        ...trip,
        id: existing.id || trip.id || _generateTripId(),
        createdAt: existing.createdAt || trip.createdAt || nowIso,
        updatedAt: nowIso,
        status: trip.status || existing.status || existing.state || 'planned',
        state: trip.state || existing.state || existing.status || 'planned'
      };
    } else {
      db.reizen.push({
        ...trip,
        id: trip.id || _generateTripId(),
        createdAt: trip.createdAt || nowIso,
        updatedAt: nowIso,
        status: trip.status || 'planned',
        state: trip.state || 'planned'
      });
    }
  });

  const saved = await saveReizen();
  if (saved) {
    closeAllModals();
    openReisPlannerModal();
  }
}

// ================= Wizard 2: Beschikbaarheid (lege periodes) =================
function _wizardBeschikbaarheid(){
  // Bepaal bezette periodes per persoon
  const persons = ['Olga','Alberto'];
  const perPers = persons.map(p => ({
    naam: p,
    occupied: (db.evenementen||[])
      .filter(e => (e.personen||[]).includes(p))
      .map(e => ({ start:e.startdatum, eind:e.einddatum, loc:e.locatie, naam:e.naam }))
      .sort((a,b)=> new Date(a.start)-new Date(b.start))
  }));

  // Construeer vrije slots in de komende ~120 dagen
  const today = _fmt(new Date().toISOString().slice(0,10));
  const horizon = _fmt(_isoAddDays(today, 120));
  const free = perPers.map(pp => ({ naam:pp.naam, slots:_freeSlots(pp.occupied, today, horizon) }));

  _modal(()=>{
    const box=document.createElement('div');
    box.appendChild(_h2('🗓️ Beschikbaarheid & opties'));

    free.forEach(pp=>{
      const h = document.createElement('h3'); h.className='rp-sub'; h.textContent = pp.naam; box.appendChild(h);
      if(!pp.slots.length){ box.appendChild(_p('Geen vrije periodes in de komende 120 dagen.')); return; }

      pp.slots.forEach(slot=>{
        const card=document.createElement('div'); card.className='rp-card';
        const head=document.createElement('div'); head.className='rp-card-head';
        head.innerHTML = `<b>${slot.start} → ${slot.eind}</b> (${slot.days} dagen)`;
        card.appendChild(head);

        const intro=_p('Vrije periode – ideaal om een extra evenement of rustdag te plannen.');
        card.appendChild(intro);

        const hint=document.createElement('div');
        hint.className='rp-slot-hint';
        hint.textContent='Gebruik de knoppen hieronder om een nieuw evenement te plannen of de periode te delen met het team.';
        card.appendChild(hint);

        const actions=document.createElement('div');
        actions.className='rp-slot-actions';

        const planBtn=_btn('Nieuw evenement plannen','green');
        planBtn.onclick=async ()=>{
          try {
            const { openEventScheduleModal } = await import('./15_eventSchedule.js');
            openEventScheduleModal({
              naam: '',
              locatie: '',
              type: 'Nieuw evenement',
              personen: [pp.naam],
              bus: '',
              startdatum: slot.start,
              einddatum: slot.eind,
            planning: { cheeseEstimate: { BG:0, ROOK:0, GEIT:0, categories: { BG:0, ROOK:0, GEIT:0 }, products: {} } }
            });
          } catch (err) {
            console.warn('[POS] Eventplanner openen faalde', err);
            showAlert('Kan eventplanner niet openen.', 'error');
          }
        };

        const shareBtn=_btn('📋 Kopieer periode','amber');
        shareBtn.onclick=async ()=>{
          const text=`${slot.start} → ${slot.eind} (${slot.days} dagen, ${pp.naam})`;
          try {
            if (navigator?.clipboard?.writeText) {
              await navigator.clipboard.writeText(text);
              showAlert('Periode gekopieerd naar klembord.', 'success');
            } else {
              throw new Error('Clipboard API niet beschikbaar');
            }
          } catch {
            showAlert(`Kopieer handmatig: ${text}`, 'warning');
          }
        };

        actions.append(planBtn, shareBtn);
        card.appendChild(actions);
        box.appendChild(card);
      });
    });

    box.append(_cta([['❌ Sluiten','red', closeAllModals]]));
    return box;
  });
}

// ================= Quick‑edit =================
function _openQuickEdit(evt){
  _modal(()=>{
    const box=document.createElement('div');
    box.appendChild(_h2(`✏️ ${evt.naam||'Event'}`));

    const r1=_lineInput('Start','date',evt.startdatum||'');
    const r2=_lineInput('Einde','date',evt.einddatum||'');
    const r3=_lineSelect('Bus', Object.keys(db.voorraad||{}), evt.bus||'');
    const r4=_lineChecks('Personen',['Olga','Alberto'], evt.personen||[]);
    const r5=_lineInput('Type','text', evt.type||'');
    const r6=_lineInput('Locatie','text', evt.locatie||'');

    box.append(r1.wrap,r2.wrap,r3.wrap,r4.wrap,r5.wrap,r6.wrap);

    box.append(_cta([
      ['❌ Sluiten','red', closeAllModals],
      ['💾 Opslaan','green', async ()=>{
        evt.startdatum=r1.input.value||evt.startdatum;
        evt.einddatum =r2.input.value||evt.einddatum;
        evt.bus       =r3.select.value||'';
        evt.personen  =r4.getValues();
        evt.type      =r5.input.value||evt.type;
        evt.locatie   =r6.input.value||evt.locatie;
        await saveEvent(evt.id);
        closeAllModals(); showAlert('✅ Event bijgewerkt.','success'); openReisPlannerModal();
      }]
    ]));
    return box;
  });
}

// ================= Helpers: DOM / widgets =================
function _btn(label,color='green'){
  const b=document.createElement('button'); b.className=`rp-btn rp-${color}`; b.textContent=label; return b;
}
function _h2(t){ const h=document.createElement('h2'); h.className='rp-title'; h.textContent=t; return h;}
function _p(t){ const p=document.createElement('p'); p.className='rp-p'; p.textContent=t; return p;}
function _cta(items){ const row=document.createElement('div'); row.className='rp-cta'; items.forEach(([l,c,fn])=>{const b=_btn(l,c); b.onclick=fn; row.appendChild(b);}); return row;}
function _buildCheeseField(label, value){
  const wrap = document.createElement('label');
  wrap.className = 'rp-event-field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.inputMode = 'numeric';
  input.placeholder = '0';
  if (Number.isFinite(value) && value > 0) {
    input.value = String(Math.round(value));
  }
  wrap.append(span, input);
  return { wrap, input };
}
function _lineInput(label,type,val){ const wrap=document.createElement('div'); wrap.className='rp-line'; const lab=document.createElement('label'); lab.className='rp-lab'; lab.textContent=label; const input=document.createElement('input'); input.type=type; if(val) input.value=val; wrap.append(lab,input); return {wrap,input};}
function _lineSelect(label,options,val){ const wrap=document.createElement('div'); wrap.className='rp-line'; const lab=document.createElement('label'); lab.className='rp-lab'; lab.textContent=label; const sel=document.createElement('select'); (options||[]).forEach(o=>sel.append(new Option(o,o))); sel.value=val||''; wrap.append(lab,sel); return {wrap,select:sel};}
function _lineChecks(label,opts,vals){ const wrap=document.createElement('div'); wrap.className='rp-line'; const lab=document.createElement('label'); lab.className='rp-lab'; lab.textContent=label; const box=document.createElement('div'); box.style.cssText='display:flex;gap:.6rem;flex-wrap:wrap'; const inputs=(opts||[]).map(o=>{ const l=document.createElement('label'); l.className='pretty-checkbox'; const i=document.createElement('input'); i.type='checkbox'; i.value=o; if((vals||[]).includes(o)) i.checked=true; l.append(i, document.createTextNode(' '+o)); box.appendChild(l); return i; }); wrap.append(lab,box); return {wrap, getValues:()=>inputs.filter(i=>i.checked).map(i=>i.value)};}
function _shareButtons(subject, bodyBuilder){
  const wrap=document.createElement('div');
  wrap.className='rp-share';
  const email=_btn('📧 Deel per e-mail','blue');
  email.onclick=()=>{
    const body = bodyBuilder?.() || '';
    _shareViaEmail(subject, body);
  };
  const whatsapp=_btn('📱 Deel via WhatsApp','green');
  whatsapp.onclick=()=>{
    const body = bodyBuilder?.() || '';
    _shareViaWhatsApp(body);
  };
  wrap.append(email, whatsapp);
  return wrap;
}
function _shareViaEmail(subject, body){
  const href=`mailto:?subject=${encodeURIComponent(subject||'Voorraadplanning')}&body=${encodeURIComponent(body||'')}`;
  window.open(href, '_blank', 'noopener');
}
function _shareViaWhatsApp(body){
  const url=`https://wa.me/?text=${encodeURIComponent(body||'')}`;
  window.open(url, '_blank', 'noopener');
}
function _toCheeseTotals(source){
  const totals = { BG:0, ROOK:0, GEIT:0 };
  if (!source || typeof source !== 'object') return totals;
  const catalog = {};
  (db.producten || []).forEach(prod => {
    const type = String(prod?.type || '').toUpperCase();
    const name = prod?.naam;
    if (!CHEESE_TYPES.includes(type) || !name) return;
    catalog[name] = type;
  });
  const bucket = source.categories && typeof source.categories === 'object'
    ? source.categories
    : source;
  const hasCategory = {};
  CHEESE_TYPES.forEach(type => {
    const value = Number(bucket?.[type] ?? bucket?.[type.toLowerCase?.()] ?? 0);
    if (value > 0) {
      totals[type] += Math.max(0, Math.round(value));
      hasCategory[type] = true;
    }
  });
  const products = source.products && typeof source.products === 'object'
    ? source.products
    : bucket;
  Object.entries(products || {}).forEach(([name, value]) => {
    if (CHEESE_TYPES.includes(name.toUpperCase())) return;
    const qty = Math.max(0, Math.round(Number(value) || 0));
    if (!qty) return;
    const type = catalog[name];
    if (type && type in totals && !hasCategory[type]) {
      totals[type] += qty;
    }
  });
  return totals;
}
function _formatOrderShare(periodLabel, groups){
  const list = Array.isArray(groups) ? groups : [];
  const lines=[`Bestellijst ${periodLabel}`];
  if (!list.length){
    lines.push('', 'Geen bestelling nodig.');
    return lines.join('\n');
  }
  list.forEach(group => {
    lines.push('', `Leverancier: ${group.supplier || 'Onbekend'}`);
    lines.push('Product | Tekort | Kratten | Kosten');
    (group.rows || []).forEach(row => {
      const breakdown = row.orderBreakdown || { crates: 0, loose: 0 };
      const costLabel = row.cost > 0 ? row.costLabel : 'n.t.b.';
      lines.push(`${row.product}: ${row.shortage} st | ${_formatUnitLabel(row.product, breakdown.crates, breakdown.loose)} | ${costLabel}`);
    });
  });
  return lines.join('\n');
}
function _formatPackShare(periodLabel, plan){
  const lines=[`Pakbon ${plan.bus} (${periodLabel})`];
  if (plan.events?.length){
    lines.push(`Evenementen: ${plan.events.map(ev=>`${ev.naam || 'Event'} ${_fmt(ev.start)}→${_fmt(ev.eind)}`).join(', ')}`);
  }
  const transferSource = plan.centralKey || '';
  const transferLabel = transferSource && transferSource !== plan.bus ? `Uit ${transferSource}` : 'Uit basis';
  lines.push('', `Product | Nodig | Uit bus | ${transferLabel} | Mee te nemen | Kratten`);
  Object.entries(plan.load||{})
    .sort((a,b)=>a[0].localeCompare(b[0]))
    .forEach(([product, details])=>{
      const breakdown=_crateBreakdown(details.needed, details.capacity);
      const transfer = Math.max(0, Math.round(Number(details.fromCentral)||0));
      const order = Math.max(0, Math.round(Number(details.fromOrder)||0));
      const toLoad = transfer + order;
      const orderSuffix = order > 0 ? ` (+${order} st bestelling)` : '';
      lines.push(`${product}: ${details.needed} | ${details.fromBus} | ${transfer} | ${toLoad}${orderSuffix} | ${_formatUnitLabel(product, breakdown.crates, breakdown.loose)}`);
    });
  return lines.join('\n');
}

function _formatTotalsLabel(totals){
  const entries = Object.entries(totals || {}).filter(([, value]) => Number.isFinite(value) && Math.abs(value) > 0.0001);
  if (!entries.length) return '';
  return entries
    .map(([currency, value]) => formatCurrencyValue(value, currency))
    .join(' + ');
}

function _buildOrderPdfButtons(groups, periodLabel){
  const list = Array.isArray(groups)
    ? groups.filter(group => Array.isArray(group?.rows) && group.rows.length)
    : [];
  if (!list.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'rp-order-pdf';
  list.forEach(group => {
    const btn = _btn(`📄 PDF ${group.supplier}`, 'amber');
    btn.onclick = () => _exportOrderPdf(group, periodLabel);
    wrap.appendChild(btn);
  });
  return wrap;
}

function _groupOrdersBySupplier(rows){
  const buckets = new Map();
  (rows || []).forEach(row => {
    if (!row) return;
    const supplier = (row.supplier && String(row.supplier).trim()) || 'Leverancier';
    if (!buckets.has(supplier)) {
      buckets.set(supplier, {
        supplier,
        rows: [],
        totalShortage: 0,
        totalCostByCurrency: {}
      });
    }
    const bucket = buckets.get(supplier);
    bucket.rows.push(row);
    bucket.totalShortage += Math.max(0, Number(row.shortage) || 0);
    if (row.cost > 0 && row.priceCurrency) {
      bucket.totalCostByCurrency[row.priceCurrency] = (bucket.totalCostByCurrency[row.priceCurrency] || 0) + row.cost;
    }
  });
  return Array.from(buckets.values()).map(bucket => {
    bucket.rows.sort((a, b) => a.product.localeCompare(b.product));
    bucket.totalCostLabel = _formatTotalsLabel(bucket.totalCostByCurrency);
    return bucket;
  });
}

function _exportOrderPdf(group, periodLabel){
  const jsPDF = window.jspdf?.jsPDF;
  if (typeof jsPDF !== 'function') {
    showAlert('PDF-export vereist jsPDF in de browser.', 'error');
    return;
  }
  const rows = Array.isArray(group?.rows) ? group.rows : [];
  if (!rows.length) {
    showAlert(`Geen producten voor ${group?.supplier || 'deze leverancier'}.`, 'info');
    return;
  }

  const doc = new jsPDF('p', 'pt', 'a4');
  const margin = 40;
  const lineHeight = 18;
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(`Bestellijst ${group.supplier}`, margin, y);
  y += lineHeight;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(`Periode: ${periodLabel}`, margin, y);
  y += lineHeight;

  const totalsByCurrency = {};
  const columnX = {
    product: margin,
    qty: margin + 260,
    crates: margin + 360,
    cost: margin + 450
  };

  const renderHeader = () => {
    doc.setFont('helvetica', 'bold');
    doc.text('Product', columnX.product, y);
    doc.text('Aantal', columnX.qty, y);
    doc.text('Kratten', columnX.crates, y);
    doc.text('Kosten', columnX.cost, y);
    doc.setFont('helvetica', 'normal');
    y += lineHeight;
  };

  renderHeader();

  rows.forEach(row => {
    const breakdown = row.orderBreakdown || { crates: 0, loose: 0 };
    const crateLabel = _formatUnitLabel(row.product, breakdown.crates, breakdown.loose);
    const costLabel = row.cost > 0 ? row.costLabel : 'n.t.b.';
    if (row.cost > 0 && row.priceCurrency) {
      totalsByCurrency[row.priceCurrency] = (totalsByCurrency[row.priceCurrency] || 0) + row.cost;
    }
    const productLines = doc.splitTextToSize(row.product || 'Product', columnX.qty - columnX.product - 10);
    productLines.forEach((line, index) => {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
        renderHeader();
      }
      doc.text(line, columnX.product, y);
      if (index === 0) {
        doc.text(String(row.shortage || 0), columnX.qty, y);
        doc.text(crateLabel, columnX.crates, y);
        doc.text(costLabel, columnX.cost, y);
      }
      y += lineHeight;
    });
  });

  if (y > pageHeight - margin) {
    doc.addPage();
    y = margin;
  }

  doc.setFont('helvetica', 'bold');
  doc.text('Totale kosten:', columnX.product, y);
  doc.setFont('helvetica', 'normal');
  const totalsLabel = _formatTotalsLabel(totalsByCurrency) || 'n.t.b.';
  doc.text(totalsLabel, columnX.qty, y);

  const safeName = (group.supplier || 'leverancier').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  doc.save(`bestelling_${safeName}_${Date.now()}.pdf`);
}

function _exportPackPdf(plan, periodLabel){
  const jsPDF = window.jspdf?.jsPDF;
  if (typeof jsPDF !== 'function') {
    showAlert('PDF-export vereist jsPDF in de browser.', 'error');
    return;
  }
  if (!plan || !plan.bus) {
    showAlert('Geen pakbon data beschikbaar.', 'info');
    return;
  }

  const doc = new jsPDF('p', 'pt', 'a4');
  const margin = 40;
  const lineHeight = 18;
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = margin;

  const ensureSpace = extra => {
    if (y + extra > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(`Pakbon ${plan.bus}`, margin, y);
  y += lineHeight;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text(`Periode: ${periodLabel}`, margin, y);
  y += lineHeight;

  const events = Array.isArray(plan.events) ? plan.events : [];
  if (events.length) {
    doc.setFont('helvetica', 'bold');
    doc.text('Evenementen', margin, y);
    y += lineHeight;
    doc.setFont('helvetica', 'normal');
    events.forEach(ev => {
      ensureSpace(lineHeight);
      const label = `${ev.naam || 'Event'} • ${_fmt(ev.start)} → ${_fmt(ev.eind)}`;
      doc.text(`• ${label}`, margin, y);
      y += lineHeight;
    });
  }

  const transferSourceName = plan.centralKey;
  const transferHeaderLabel = transferSourceName && transferSourceName !== plan.bus ? `Uit ${transferSourceName}` : 'Uit basis';

  const columnX = {
    product: margin,
    needed: margin + 220,
    bus: margin + 300,
    transfer: margin + 380,
    load: margin + 460,
    crates: margin + 540
  };

  ensureSpace(lineHeight * 2);
  doc.setFont('helvetica', 'bold');
  doc.text('Product', columnX.product, y);
  doc.text('Nodig', columnX.needed, y, { align: 'right' });
  doc.text('Uit bus', columnX.bus, y, { align: 'right' });
  doc.text(transferHeaderLabel, columnX.transfer, y, { align: 'right' });
  doc.text('Mee', columnX.load, y, { align: 'right' });
  doc.text('Kratten', columnX.crates, y, { align: 'right' });
  y += lineHeight;
  doc.setFont('helvetica', 'normal');

  const entries = Object.entries(plan.load || {}).sort((a, b) => a[0].localeCompare(b[0]));
  entries.forEach(([product, details]) => {
    ensureSpace(lineHeight);
    const breakdown = _crateBreakdown(details.needed, details.capacity);
    const transfer = Math.max(0, Math.round(Number(details.fromCentral) || 0));
    const order = Math.max(0, Math.round(Number(details.fromOrder) || 0));
    const toLoad = transfer + order;

    doc.text(product, columnX.product, y);
    doc.text(String(Math.max(0, Math.round(Number(details.needed) || 0))), columnX.needed, y, { align: 'right' });
    doc.text(String(Math.max(0, Math.round(Number(details.fromBus) || 0))), columnX.bus, y, { align: 'right' });
    doc.text(String(transfer), columnX.transfer, y, { align: 'right' });
    doc.text(String(toLoad), columnX.load, y, { align: 'right' });
    doc.text(_formatUnitLabel(product, breakdown.crates, breakdown.loose), columnX.crates, y, { align: 'right' });
    y += lineHeight;
  });

  const transferTotal = entries.reduce((sum, [, details]) => sum + Math.max(0, Number(details.fromCentral) || 0), 0);
  if (transferTotal > 0) {
    ensureSpace(lineHeight * 2);
    doc.setFont('helvetica', 'italic');
    const sourceLabel = transferSourceName && transferSourceName !== plan.bus ? transferSourceName : 'de basis';
    doc.text(`Verplaats ${transferTotal} stuks vanuit ${sourceLabel}`, margin, y);
    doc.setFont('helvetica', 'normal');
  }

  const safeName = String(plan.bus || 'bus').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  doc.save(`pakbon_${safeName}_${Date.now()}.pdf`);
}

function _modal(build){
  closeAllModals();
  const ov=document.createElement('div'); ov.className='modal rp-modal';
  const box=document.createElement('div'); box.className='rp-dialog';
  const close=_btn('✕','red');
  close.style.position='absolute';
  close.style.right='10px';
  close.style.top='10px';
  close.onclick=closeAllModals;
  box.append(close, build());
  ov.appendChild(box);
  _injectPlannerCSS();
  document.body.appendChild(ov);
}

// ================= Utils =================
function _crateBreakdown(quantity, capacity){
  const cap = Math.max(1, Math.round(Number(capacity)||1));
  const qty = Math.max(0, Math.round(Number(quantity)||0));
  const crates = Math.floor(qty / cap);
  const loose = qty - crates * cap;
  return { crates, loose };
}

function _convertPlanToTrip(plan, meta = {}) {
  if (!plan || !Array.isArray(plan.events) || !plan.events.length) {
    return null;
  }

  const selectionStartIso = _normalizeTripDate(meta.selectionStart);
  const selectionEndIso = _normalizeTripDate(meta.selectionEnd);
  const periodLabel = meta.periodLabel || `${_fmt(selectionStartIso) || selectionStartIso || '?'} → ${_fmt(selectionEndIso) || selectionEndIso || '?'}`;

  const normalizedEvents = plan.events
    .map(evt => {
      const id = evt?.eventId || evt?.id;
      if (!id) return null;
      const start = _normalizeTripDate(evt.start || evt.begin || evt.startdatum || evt.startDate || evt.beginDatum);
      const end = _normalizeTripDate(evt.eind || evt.end || evt.einddatum || evt.endDate || evt.eindDatum);
      return {
        id,
        naam: evt.naam || evt.title || '',
        locatie: evt.locatie || evt.location || '',
        start,
        eind: end,
        bedrag: _toNumber(evt.bedrag || evt.omzet || 0),
        bus: evt.bus || plan.bus || '',
        type: evt.type || ''
      };
    })
    .filter(Boolean);

  if (!normalizedEvents.length) {
    return null;
  }

  const startIso = _minIsoDate([
    ...normalizedEvents.map(ev => ev.start),
    selectionStartIso
  ]);
  const endIso = _maxIsoDate([
    ...normalizedEvents.map(ev => ev.eind),
    selectionEndIso
  ]);

  const bestemmingParts = _uniqueNonEmpty([
    plan.bestemming,
    plan.destination,
    ...(normalizedEvents.map(ev => ev.locatie))
  ]);
  const bestemming = bestemmingParts.join(' · ');

  const route = normalizedEvents
    .map(ev => {
      const loc = ev.locatie || 'n.t.b.';
      return ev.start ? `${loc} (${ev.start})` : loc;
    })
    .filter(Boolean)
    .join(' → ');

  const omzet = normalizedEvents.reduce((sum, ev) => sum + (Number.isFinite(ev.bedrag) ? ev.bedrag : 0), 0);
  const orderList = _buildOrderListFromLoad(plan.load);

  const logistiek = {
    periode: {
      start: startIso || selectionStartIso || '',
      end: endIso || selectionEndIso || ''
    },
    load: _clonePlanLoad(plan.load)
  };

  return {
    bus: plan.bus || '',
    start: startIso,
    end: endIso,
    bestemming,
    title: _composeTripTitle(plan.bus, bestemming, normalizedEvents.length),
    route,
    periodLabel,
    events: normalizedEvents,
    bestelling: orderList,
    logistiek,
    inkomsten: Number.isFinite(omzet) ? Number(omzet.toFixed(2)) : 0,
    kosten: _toNumber(plan.kosten || 0),
    notities: `Gepland via voorraadwizard (${periodLabel})`,
    status: 'planned',
    state: 'planned'
  };
}

function _buildOrderListFromLoad(load){
  return Object.entries(load || {})
    .map(([product, details]) => {
      const info = details || {};
      const orderPieces = Math.max(0, Math.round(_toNumber(info.fromOrder)));
      if (!orderPieces) return null;
      const capacity = Math.max(1, Math.round(_toNumber(info.capacity) || _capacity(product)));
      const crates = Math.ceil(orderPieces / capacity);
      return {
        product,
        type: _orderType(product),
        crates,
        pieces: orderPieces
      };
    })
    .filter(Boolean);
}

function _clonePlanLoad(load){
  const out = {};
  Object.entries(load || {}).forEach(([product, details]) => {
    const info = details || {};
    out[product] = {
      needed: Math.max(0, Math.round(_toNumber(info.needed))),
      fromBus: Math.max(0, Math.round(_toNumber(info.fromBus))),
      fromCentral: Math.max(0, Math.round(_toNumber(info.fromCentral))),
      fromOrder: Math.max(0, Math.round(_toNumber(info.fromOrder))),
      capacity: Math.max(1, Math.round(_toNumber(info.capacity) || _capacity(product)))
    };
  });
  return out;
}

function _composeTripTitle(bus, bestemming, eventCount){
  const base = bus ? `Bus ${bus}` : 'Reis';
  if (bestemming) return `${base} • ${bestemming}`;
  if (eventCount > 1) return `${base} • ${eventCount} evenementen`;
  return base;
}

function _tripSignature(reis){
  if (!reis) return '';
  const bus = reis.bus || '';
  const eventIds = Array.isArray(reis.events) ? reis.events.map(ev => ev?.id || ev?.eventId).filter(Boolean).sort().join('|') : '';
  if (eventIds) return `${bus}__${eventIds}`;
  const start = _normalizeTripDate(reis.start || reis.begin || reis.startdatum || reis.beginDatum);
  const end = _normalizeTripDate(reis.end || reis.eind || reis.enddatum || reis.eindDatum);
  return `${bus}__${start}__${end}`;
}

function _generateTripId(){
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (err) {
    console.warn('crypto.randomUUID niet beschikbaar', err);
  }
  return `reis-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function _normalizeTripDate(value){
  if (!value && value !== 0) return '';
  const iso = _fmt(value);
  if (iso) return iso;
  try {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0,10);
    }
  } catch {}
  return '';
}

function _minIsoDate(list){
  const arr = (list || []).map(item => _normalizeTripDate(item)).filter(Boolean).sort();
  return arr.length ? arr[0] : '';
}

function _maxIsoDate(list){
  const arr = (list || []).map(item => _normalizeTripDate(item)).filter(Boolean).sort();
  return arr.length ? arr[arr.length - 1] : '';
}

function _uniqueNonEmpty(list){
  const set = new Set();
  (list || []).forEach(item => {
    const val = (item ?? '').toString().trim();
    if (val) set.add(val);
  });
  return Array.from(set);
}

function _toNumber(value){
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function _categorizeTripsForDisplay(list){
  const todayIso = new Date().toISOString().slice(0,10);
  const todayMs = Date.parse(todayIso);
  const active = [];
  const upcoming = [];

  (list || []).forEach(reis => {
    const meta = _buildTripDisplay(reis);
    if (!meta) return;
    const { startMs, endMs } = meta;
    if (startMs != null && endMs != null && startMs <= todayMs && endMs >= todayMs) {
      active.push(meta);
      return;
    }
    if ((startMs != null && startMs > todayMs) || (startMs == null && endMs != null && endMs >= todayMs)) {
      upcoming.push(meta);
    }
  });

  active.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
  upcoming.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
  return { active, upcoming };
}

function _buildTripDisplay(reis){
  if (!reis) return null;
  const startIso = _normalizeTripDate(reis.start || reis.begin || reis.startdatum || reis.beginDatum);
  const endIso = _normalizeTripDate(reis.end || reis.eind || reis.enddatum || reis.eindDatum);
  const events = Array.isArray(reis.events) ? reis.events : [];
  const bestemming = _uniqueNonEmpty([
    reis.bestemming,
    reis.route,
    ...(events.map(ev => ev?.locatie || ev?.location))
  ]).join(' · ');
  const title = reis.title || _composeTripTitle(reis.bus, bestemming, events.length);
  const omzet = _toNumber(reis.inkomsten || events.reduce((sum, ev) => sum + _toNumber(ev?.bedrag), 0));
  const bestellingen = Array.isArray(reis.bestelling) ? reis.bestelling : [];
  const orderCrates = bestellingen.reduce((sum, item) => sum + Math.max(0, _toNumber(item?.crates)), 0);
  const orderPieces = bestellingen.reduce((sum, item) => sum + Math.max(0, _toNumber(item?.pieces || item?.stuks)), 0);
  const load = reis.logistiek?.load || reis.load || {};
  const loadValues = Object.values(load || {});
  const totalNeeded = loadValues.reduce((sum, info) => sum + Math.max(0, _toNumber(info?.needed)), 0);
  const totalOrderPieces = loadValues.reduce((sum, info) => sum + Math.max(0, _toNumber(info?.fromOrder)), 0);
  const totalCentralPieces = loadValues.reduce((sum, info) => sum + Math.max(0, _toNumber(info?.fromCentral)), 0);
  const totalFromBus = loadValues.reduce((sum, info) => sum + Math.max(0, _toNumber(info?.fromBus)), 0);

  return {
    raw: reis,
    title,
    bestemming,
    startIso,
    endIso,
    startMs: startIso ? Date.parse(startIso) : null,
    endMs: endIso ? Date.parse(endIso) : null,
    bus: reis.bus || '',
    eventCount: events.length,
    omzet,
    orderCrates,
    orderPieces,
    totalNeeded,
    totalOrderPieces,
    totalCentralPieces,
    totalFromBus,
    notes: reis.notities || '',
    status: reis.status || reis.state || 'planned'
  };
}

function _formatTripRange(startIso, endIso){
  const startLabel = formatDate(startIso);
  const endLabel = formatDate(endIso);
  if (startLabel && endLabel && startLabel !== endLabel) {
    return `${startLabel} – ${endLabel}`;
  }
  return startLabel || endLabel || 'Datum n.t.b.';
}

function _formatUnitLabel(product, crates, loose){
  const type=_orderType(product);
  const crateSing = type === 'dozen' ? 'doos' : 'krat';
  const cratePlural = type === 'dozen' ? 'dozen' : 'kratten';
  const baseCrates = Math.max(0, Math.round(Number(crates)||0));
  const extraPieces = Math.max(0, Math.round(Number(loose)||0));
  const capacity = Math.max(1, Math.round(_capacity(product)));
  const totalCrates = baseCrates + (extraPieces > 0 ? Math.ceil(extraPieces / capacity) : 0);
  const labelCount = totalCrates || 0;
  return `${labelCount} ${labelCount === 1 ? crateSing : cratePlural}`;
}
function _iso(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function _fmt(d){ if(!d) return ''; const t=new Date(d); return isNaN(t)?'':t.toISOString().slice(0,10); }
function _monthName(m){ return new Date(2000,m,1).toLocaleString('nl-NL',{month:'long'}); }
function _minDate(a,b){ return (new Date(a) < new Date(b)) ? a : b; }
function _maxDate(a,b){ return (new Date(a) > new Date(b)) ? a : b; }
function _rangesOverlap(aS,aE,bS,bE){ if(!aS||!aE||!bS||!bE) return false; const A1=new Date(aS),A2=new Date(aE),B1=new Date(bS),B2=new Date(bE); return A1<=B2 && B1<=A2; }
function _esc(s){ return String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function _totalOmzetUSD(event){
  const omzetLijst = Array.isArray(event?.omzet) ? event.omzet : [];
  return omzetLijst.reduce((tot, entry) => {
    const usd = Number(entry?.usd);
    if (Number.isFinite(usd) && usd > 0) {
      return tot + usd;
    }
    const eur = Number(entry?.eur);
    if (Number.isFinite(eur) && eur > 0) {
      const rate = Number(entry?.exchangeRate);
      if (Number.isFinite(rate) && rate > 0) {
        return tot + (eur / rate);
      }
      return tot + eur;
    }
    return tot;
  }, 0);
}

function _estimateUSD(evt){
  if (!evt) return 0;
  const vergelijkbaar = (db.evenementen||[])
    .filter(e => e && e.id !== evt.id && e.locatie === evt.locatie && e.type === evt.type)
    .slice(-5);
  const totals = vergelijkbaar
    .map(e => _totalOmzetUSD(e))
    .filter(val => Number.isFinite(val) && val > 0);
  if (!totals.length) return 0;
  const sum = totals.reduce((acc, val) => acc + val, 0);
  return Math.round(sum / totals.length);
}
function _capacity(name){ const n=name||''; if(n.startsWith('BG')||n.startsWith('GEIT truffel'))return 18; if(n.startsWith('GEIT'))return 15; if(n.startsWith('ROOK'))return 10; return 1; }
function _orderType(name){ return (name||'').startsWith('ROOK') ? 'dozen' : 'kratten'; }
function _supplierForProduct(name){
  const prod = (db.producten || []).find(p => p.naam === name);
  if (prod) {
    const supplierField = prod.leverancier ?? prod.supplier;
    if (typeof supplierField === 'string' && supplierField.trim()) {
      return supplierField.trim();
    }
    const type = String(prod.type || '').toUpperCase();
    if (['SOUV', 'KOEK', 'MOSTERD'].includes(type)) {
      return 'Souvenirleverancier';
    }
  }
  return 'Kaashandel';
}
function _resolveUnitPrice(meta = {}){
  const eur = Number(meta?.eur);
  if (Number.isFinite(eur) && eur > 0) {
    return { price: eur, currency: 'EUR' };
  }
  const usd = Number(meta?.usd);
  if (Number.isFinite(usd) && usd > 0) {
    return { price: usd, currency: 'USD' };
  }
  return { price: 0, currency: 'EUR' };
}
function _weightsFromHistory(){
  const totals = (db.verkoopMix?.totals?.products) || {};
  const weights = {};
  let grandTotal = 0;
  Object.entries(totals).forEach(([product, value]) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return;
    weights[product] = amount;
    grandTotal += amount;
  });
  if (grandTotal <= 0) return {};
  Object.keys(weights).forEach(k => {
    weights[k] = weights[k] / grandTotal;
  });
  return weights;
}
function _normalizeProductWeights(products){
  const hist=_weightsFromHistory();
  const weights={};
  products.forEach(prod=>{
    const val=Math.max(0, Number(hist?.[prod.naam]||0));
    if (val>0) weights[prod.naam]=val;
  });
  let sum=Object.values(weights).reduce((a,b)=>a+b,0);
  if (sum<=0){
    const mix=_categoryMix();
    const counts={};
    products.forEach(prod=>{ counts[prod.type]=(counts[prod.type]||0)+1; });
    products.forEach(prod=>{
      const share=(mix[prod.type]||0)/(counts[prod.type]||1);
      weights[prod.naam]=share;
    });
    sum=Object.values(weights).reduce((a,b)=>a+b,0);
  }
  if (sum<=0){
    const equal=1/Math.max(1,products.length);
    products.forEach(prod=>{ weights[prod.naam]=equal; });
    sum=1;
  }
  products.forEach(prod=>{
    if (!(prod.naam in weights) || !Number.isFinite(weights[prod.naam]) || weights[prod.naam]<=0){
      weights[prod.naam]=1/Math.max(1,products.length);
    }
  });
  const total=products.reduce((acc,prod)=>acc+(weights[prod.naam]||0),0) || 1;
  return products.reduce((acc,prod)=>{
    acc[prod.naam]=(weights[prod.naam]||0)/total;
    return acc;
  },{});
}
function _categoryMix(){
  const mix=db?.verkoopMix || {};
  const ratio=mix?.ratio?.categories;
  const totals=mix?.totals?.categories;
  const source=(ratio && Object.values(ratio).some(v=>Number(v)>0)) ? ratio : totals;
  const base={ BG:0, ROOK:0, GEIT:0 };
  if (source){
    Object.keys(base).forEach(key=>{
      const value=Number(source?.[key] ?? source?.[key.toLowerCase?.()] ?? 0);
      if (value>0) base[key]=value;
    });
  }
  let sum=Object.values(base).reduce((a,b)=>a+b,0);
  if (sum<=0){
    base.BG=base.ROOK=base.GEIT=1/3;
    return base;
  }
  Object.keys(base).forEach(key=>{ base[key]=base[key]/sum; });
  return base;
}

function _buildEventPlan(entry, products, weights, typeGroups, bufferFactor){
  const plan={};
  const estimate=entry?.cheeseEstimate;
  const typeLookup = products.reduce((acc, prod) => {
    acc[prod.naam] = prod.type;
    return acc;
  }, {});

  if (estimate && typeof estimate === 'object'){
    const directProducts = {};
    const totals={ BG:0, ROOK:0, GEIT:0 };

    const sourceProducts = estimate.products && typeof estimate.products === 'object'
      ? estimate.products
      : estimate;
    Object.entries(sourceProducts || {}).forEach(([name, value]) => {
      const qty = Math.max(0, Math.round(Number(value)||0));
      if (!qty) return;
      const type = typeLookup[name];
      if (type && CHEESE_TYPES.includes(type)) {
        directProducts[name] = qty;
        totals[type] += qty;
      }
    });

    CHEESE_TYPES.forEach(type => {
      const raw = Number(estimate?.[type] ?? estimate?.[type.toLowerCase?.()] ?? 0);
      if (raw > 0) {
        totals[type] = Math.max(totals[type], Math.round(raw));
      }
      const cat = Number(estimate?.categories?.[type] ?? 0);
      if (cat > 0) {
        totals[type] = Math.max(totals[type], Math.round(cat));
      }
    });

    products.forEach(prod => {
      plan[prod.naam] = directProducts[prod.naam] || 0;
    });

    Object.entries(typeGroups).forEach(([type, names])=>{
      if (!names.length) return;
      const totalType=Math.max(0, totals[type]||0);
      if (!totalType) {
        return;
      }
      const currentSum = names.reduce((acc,name)=>acc+(plan[name]||0),0);
      const remainder = Math.max(0, totalType - currentSum);
      if (!remainder) {
        return;
      }
      const weightSum=names.reduce((acc,name)=>acc+(weights[name]||0),0) || names.length;
      const allocation = names.map(name=>{
        const weight = weights[name] || (1/names.length);
        const share = weight / weightSum;
        const raw = remainder * share;
        const base = Math.floor(raw);
        return { name, base, frac: raw - base };
      });
      let allocated = allocation.reduce((acc,item)=>acc+item.base,0);
      let diff = remainder - allocated;
      if (diff > 0){
        allocation.sort((a,b)=>b.frac - a.frac);
        for(let i=0;i<diff;i++){
          const target = allocation[i % allocation.length];
          if (!target) break;
          target.base += 1;
        }
      }
      allocation.forEach(item=>{
        plan[item.name] = Math.max(0, (plan[item.name]||0) + item.base);
      });
    });
  } else {
    const amount=Math.max(0, Number(entry?.bedrag)||0) * (Number(bufferFactor)||1);
    products.forEach(prod=>{
      const price=Math.max(1, Number(prod.usd)||Number(prod.eur)||1);
      const share=Math.max(0, weights[prod.naam]||0);
      plan[prod.naam]=Math.round((amount*share)/price);
    });
  }
  products.forEach(prod=>{ if (!(prod.naam in plan)) plan[prod.naam]=0; });
  return plan;
}
function _cloneStock(stock){
  const out={};
  Object.entries(stock||{}).forEach(([loc, items])=>{
    out[loc]={};
    Object.entries(items||{}).forEach(([product, qty])=>{
      out[loc][product]=Math.max(0, Number(qty)||0);
    });
  });
  return out;
}
function _sumStock(stock){
  const totals={};
  Object.values(stock||{}).forEach(location=>{
    Object.entries(location||{}).forEach(([product, qty])=>{
      totals[product]=(totals[product]||0)+Math.max(0,Number(qty)||0);
    });
  });
  return totals;
}
function _detectCentralLocation(stock){
  const keys=Object.keys(stock||{});
  if (!keys.length) return 'VOLENDAM';
  const match=keys.find(key=>key.toUpperCase().includes('VOLENDAM'));
  return match || keys[0];
}
function _locColor(loc){
  const map={'Ramstein':'#2E7D32','Wiesbaden':'#00796B','Chievres':'#2A62B9','Spangdahlem':'#FB8C00','Grafenwoehr':'#6D4C41','Aviano':'#8E24AA','Vicenza':'#3949AB','Napels':'#C62828','Rota':'#1565C0','Brunssum':'#455A64'};
  return map[loc] || '#2A9626';
}
function _personColor(pers){ const p=Array.isArray(pers)?pers.join(','):(pers||''); if(p.includes('Olga'))return'#7E57C2'; if(p.includes('Alberto'))return'#009688'; return'#2A9626'; }
function _isoAddDays(iso,days){ const d=new Date(iso); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }
function _freeSlots(occupied,today,horizon){
  const slots=[]; let cursor=today;
  const occ=[...occupied].sort((a,b)=> new Date(a.start)-new Date(b.start));
  for(const o of occ){
    const s=o.start, e=o.eind;
    if(new Date(cursor)<new Date(s)){ slots.push({start:cursor, eind:_fmt(_isoAddDays(s,-1)), days: (new Date(s)-new Date(cursor))/(1000*60*60*24) }); }
    if(new Date(e)>=new Date(cursor)) cursor=_fmt(_isoAddDays(e,1));
  }
  if(new Date(cursor)<=new Date(horizon)){
    slots.push({start:cursor, eind:horizon, days: (new Date(horizon)-new Date(cursor))/(1000*60*60*24) });
  }
  return slots.filter(s=>s.days>=2); // minimale duur 2 dagen
}

// ================= CSS inject =================
function _injectPlannerCSS(){
  if (document.getElementById('rp-css')) return;
  const css=document.createElement('style'); css.id='rp-css';
  css.textContent = `
  .rp-modal > .rp-shell{ width:min(96vw,1200px); max-width:min(96vw,1200px); max-height:92vh; overflow:hidden; border-radius:12px; background:#fff; display:flex; flex-direction:column; }
  .rp-modal > .rp-dialog{ width:min(96vw,1100px); max-height:90vh; overflow:auto; border-radius:12px; background:#fff; padding:1rem; position:relative; }

  .rp-header{ background:#2A9626; color:#fff; display:flex; justify-content:space-between; align-items:center; gap:.6rem; padding:.6rem .8rem; }
  .rp-h-left,.rp-h-right{ display:flex; gap:.4rem; align-items:center; flex-wrap:wrap; }
  .rp-h-title{ font-weight:900; }

  .rp-btn{ border:none; border-radius:.6rem; padding:.5rem .75rem; font-weight:900; color:#fff; cursor:pointer; }
  .rp-green{ background:#2E7D32; } .rp-blue{ background:#1976D2; } .rp-amber{ background:#FB8C00; } .rp-red{ background:#C62828; } .rp-indigo{ background:#5C6BC0; }
  .rp-btn:disabled{ opacity:.6; cursor:not-allowed; }

  .rp-cal-wrap{ padding:.7rem; }
  .rp-weekdays{ display:grid; grid-template-columns:repeat(7,1fr); gap:6px; padding:0 .2rem; color:#2A9626; font-weight:900; }
  .rp-weekdays>div{ text-align:center; }
  .rp-collapse{ border:1px solid rgba(15,23,42,.08); border-radius:12px; margin-top:1rem; background:#f8fafc; overflow:hidden; }
  .rp-collapse summary{ list-style:none; cursor:pointer; padding:.75rem 1rem; font-weight:800; display:flex; justify-content:space-between; align-items:center; gap:.6rem; }
  .rp-collapse summary::-webkit-details-marker{ display:none; }
  .rp-collapse[open]>summary{ border-bottom:1px solid rgba(15,23,42,.08); }
  .rp-collapse-body{ padding:1rem; display:flex; flex-direction:column; gap:1rem; }
  .rp-summary-pill{ display:inline-flex; align-items:center; justify-content:center; background:#2A9626; color:#fff; font-size:.72rem; border-radius:999px; padding:.1rem .6rem; font-weight:700; }
  .rp-summary-meta{ font-size:.72rem; font-weight:600; color:rgba(15,23,42,.65); }
  .rp-order-actions{ display:flex; flex-wrap:wrap; gap:.75rem; align-items:center; }
  .rp-order-pdf{ display:flex; flex-wrap:wrap; gap:.5rem; }
  .rp-order-total{ margin-top:.25rem; font-weight:800; color:#194a1f; }
  .rp-pack-actions{ display:flex; flex-wrap:wrap; gap:.5rem; margin:.75rem 0; }
  .rp-pack-note{ background:rgba(42,150,38,.08); border-radius:10px; padding:.6rem .8rem; color:#194a1f; font-weight:600; }
  .rp-pack-flag{ margin-top:.25rem; font-size:.7rem; color:#C62828; font-weight:700; }
  .rp-muted{ color:rgba(15,23,42,.5) !important; }
  .rp-grid{ display:grid; grid-template-columns:repeat(7,1fr); grid-template-rows:repeat(6,1fr); gap:6px; height:calc(92vh - 120px); }
  .rp-cell{ background:#fff; border:1px solid #e8e8e8; border-radius:10px; position:relative; overflow:hidden; padding:2px 4px; }
  .rp-cell.dim{ background:#fafafa; }
  .rp-daynum{ position:absolute; top:6px; right:8px; font-weight:800; color:#444; }
  .rp-cell.selected{ outline:3px solid #1976D2; outline-offset:-3px; }
  .rp-cell.inrange { outline:3px solid rgba(25,118,210,.35); outline-offset:-3px; }
  .rp-cell.range-edge{ outline:3px solid #1976D2; outline-offset:-3px; }

  .rp-fill{ position:absolute; inset:0; background:linear-gradient(to bottom, var(--loc) 0 50%, var(--per) 50% 100%); opacity:.18; }
  .rp-tag{ position:absolute; left:6px; bottom:6px; color:#fff; background:#2A9626; padding:.15rem .45rem; border-radius:.45rem; font-weight:900; max-width:calc(100% - 12px); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; box-shadow:0 2px 8px rgba(0,0,0,.25); }

  .rp-title{ color:#2A9626; margin:.2rem 0 .6rem; }
  .rp-sub{ color:#2A9626; margin:.8rem 0 .3rem; }
  .rp-p{ color:#444; margin:.3rem 0 .6rem; }
  .rp-line{ display:flex; align-items:center; gap:.6rem; margin:.45rem 0; }
  .rp-lab{ min-width:120px; font-weight:800; }
  .rp-cta{ display:flex; gap:.5rem; justify-content:flex-end; margin-top:1rem; }
  .rp-table{ width:100%; border-collapse:collapse; }
  .rp-table th,.rp-table td{ padding:8px; border-bottom:1px solid #eee; }
  .rp-table th{ text-align:left; color:#2A9626; }
  .rp-table thead th{ background:rgba(42,150,38,.08); font-size:.72rem; text-transform:uppercase; letter-spacing:.08em; }
  .rp-table tbody tr:nth-child(even){ background:rgba(15,23,42,.03); }
  .rp-table.rp-compact th,.rp-table.rp-compact td{ padding:6px; }
  .rp-total{ margin-top:.6rem; font-weight:900; color:#2A9626; }
  .rp-event-grid{ display:flex; flex-direction:column; gap:.75rem; margin:.6rem 0; }
  .rp-event-card{ background:#f9fafb; border-radius:14px; padding:.8rem; display:flex; flex-direction:column; gap:.65rem; box-shadow:0 3px 12px rgba(0,0,0,.06); }
  .rp-event-head{ display:flex; flex-direction:column; gap:.2rem; }
  .rp-event-title{ font-weight:900; color:#194a1f; font-size:1.05rem; }
  .rp-event-meta{ color:#4b5563; font-size:.85rem; }
  .rp-event-fields{ display:grid; gap:.55rem; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); }
  .rp-event-field{ display:flex; flex-direction:column; gap:.2rem; font-weight:700; color:#194a1f; }
  .rp-event-field span{ font-size:.8rem; text-transform:uppercase; letter-spacing:.03em; color:#25633b; }
  .rp-event-field input,
  .rp-event-field select{ border:1px solid #d1d5db; border-radius:.6rem; padding:.45rem .55rem; font-size:.95rem; font-weight:700; color:#111827; background:#fff; }
  .rp-event-field input:focus,
  .rp-event-field select:focus{ outline:2px solid rgba(42,150,38,.35); outline-offset:2px; }
  .rp-event-total{ font-weight:800; color:#25633b; font-size:.9rem; text-align:right; }
  .rp-event-card--inactive{ opacity:.45; }
  .rp-crate-grid{ display:flex; flex-direction:column; gap:.5rem; }
  .rp-crate-row{ display:flex; justify-content:space-between; align-items:center; padding:.55rem .65rem; border:1px solid #e5e7eb; border-radius:10px; background:#fff; }
  .rp-crate-left{ display:flex; flex-direction:column; gap:.15rem; }
  .rp-crate-name{ font-weight:800; color:#194a1f; }
  .rp-crate-info{ font-size:.7rem; color:#4b5563; letter-spacing:.04em; text-transform:uppercase; }
  .rp-crate-right{ display:flex; flex-direction:column; align-items:flex-end; gap:.3rem; }
  .rp-qty{ display:flex; align-items:center; gap:.4rem; }
  .rp-qty-btn{ width:34px; height:34px; border-radius:50%; border:none; background:#2A9626; color:#fff; font-size:1.1rem; font-weight:900; display:flex; align-items:center; justify-content:center; cursor:pointer; }
  .rp-qty-btn:disabled{ opacity:.35; cursor:not-allowed; }
  .rp-qty-count{ min-width:30px; text-align:center; font-weight:900; font-size:1.05rem; color:#111827; }
  .rp-crate-pieces{ font-size:.78rem; color:#25633b; font-weight:700; display:flex; flex-direction:column; gap:.15rem; min-width:120px; text-align:right; }
  .rp-crate-pieces strong{ font-size:1.05rem; color:#0f172a; }
  .rp-crate-pieces span{ font-size:.7rem; color:rgba(15,23,42,.55); font-weight:600; }
  .rp-bus-summary{ display:flex; flex-direction:column; gap:.5rem; margin:.6rem 0; }
  .rp-bus-total-card{ background:#f1f8f3; border-radius:12px; padding:.6rem .75rem; display:flex; flex-direction:column; gap:.2rem; box-shadow:0 2px 10px rgba(30,90,40,.08); }
  .rp-bus-title{ font-weight:900; color:#194a1f; }
  .rp-bus-line{ color:#25633b; font-size:.85rem; }
  .rp-bus-total{ color:#12361b; font-weight:800; font-size:.9rem; }
  .rp-bus-omzet{ color:#25633b; font-size:.8rem; }
  .rp-slot-hint{ color:#4b5563; font-size:.85rem; }
  .rp-slot-actions{ display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.4rem; }
  .rp-share{ display:flex; gap:.4rem; flex-wrap:wrap; margin:.4rem 0; }
  .rp-pack{ border:1px solid #e5e7eb; border-radius:12px; padding:.9rem 1rem; margin:.8rem 0; background:#fdfdfd; box-shadow:0 10px 30px -26px rgba(15,23,42,.75); }
  .rp-pack-head{ font-weight:900; color:#194a1f; margin-bottom:.4rem; display:flex; justify-content:space-between; align-items:center; }
  .rp-pack-timeline{ display:flex; flex-wrap:wrap; gap:.5rem; margin-bottom:.5rem; }
  .rp-pack-chip{ background:rgba(42,150,38,.08); color:#194a1f; border-radius:.8rem; padding:.45rem .7rem; display:flex; flex-direction:column; gap:.1rem; font-size:.72rem; min-width:165px; box-shadow:0 4px 12px -10px rgba(15,23,42,.6); }
  .rp-pack-chip strong{ font-size:.84rem; color:#0f172a; }
  .rp-pack-chip span:last-child{ color:rgba(15,23,42,.6); }
  .rp-summary-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:.75rem; margin:1rem 0; }
  .rp-summary-card{ background:linear-gradient(135deg,rgba(42,150,38,.16),rgba(42,150,38,.05)); border-radius:14px; padding:.8rem; display:flex; flex-direction:column; gap:.25rem; box-shadow:0 18px 36px -28px rgba(15,23,42,.65); }
  .rp-summary-label{ font-size:.72rem; text-transform:uppercase; letter-spacing:.08em; color:rgba(15,23,42,.55); }
  .rp-summary-value{ font-size:1.3rem; font-weight:800; color:#0f172a; }
  .rp-neg{ color:#C62828; font-weight:700; }
  .rp-pos{ color:#2E7D32; font-weight:700; }

  .rp-card{ border:1px solid #eee; border-radius:10px; padding:.6rem; margin:.4rem 0; background:#fff; box-shadow:0 2px 8px rgba(0,0,0,.06); }
  .rp-card-head{ font-weight:900; color:#2A9626; margin-bottom:.4rem; }
  .rp-triplist{ padding:.6rem; overflow:auto; max-height:35vh; }
  .rp-details{ margin-top:.4rem; }
  .rp-details summary{ cursor:pointer; color:#1976D2; }
  `;
  document.head.appendChild(css);
}
