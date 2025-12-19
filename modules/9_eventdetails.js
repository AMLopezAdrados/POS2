// 📦 modules/9_eventdetails.js — Event Cockpit (single screen)

import {
  db,
  saveEvent,
  getEventOmzet,
  recordExtraCostLedgerEntry,
  deleteExtraCostLedgerEntry
} from './3_data.js';
import { showAlert, showLoading, hideLoading } from './4_ui.js';

export async function openEventDetail(eventRef, options = {}) {
  const opts = typeof options === 'string' ? { initialTab: options } : (options || {});
  const event = resolveEvent(eventRef) || window.actiefEvent;
  ensureStyles();

  if (!event) {
    const modal = mountModal('Event details');
    modal.body.innerHTML = `
      <div class="oc-error">
        <h3>Evenement niet gevonden</h3>
        <p>Het geselecteerde event kon niet worden geladen.</p>
        <button class="btn" id="oc-error-close">Sluiten</button>
      </div>
    `;
    modal.body.querySelector('#oc-error-close')?.addEventListener('click', modal.close);
    return;
  }

  const modal = mountModal(`Event details — ${event.naam || event.name || 'Evenement'}`);
  modal.body.innerHTML = '<div class="oc-skel"></div>';

  try {
    showLoading('Gegevens laden…');
    const state = await buildState(event, opts);
    renderEventCockpit(modal, state);
  } catch (err) {
    console.error('[EventCockpit] Laden mislukt', err);
    showAlert('Kon eventdetails niet laden.', 'error');
  } finally {
    hideLoading();
  }
}

function renderEventCockpit(modal, state) {
  const { event } = state;
  const statusBadge = isClosed(event)
    ? '<span class="oc-badge closed">AFGESLOTEN</span>'
    : '<span class="oc-badge open">OPEN</span>';
  const range = formatEventRange(event);

  modal.body.innerHTML = `
    <div class="oc-eventcockpit" data-event-id="${escapeHtml(event.id || event.naam || event.name || '')}">
      <header class="oc-header">
        <div>
          <h2>Event details — ${escapeHtml(event.naam || event.name || 'Evenement')}</h2>
          <div class="oc-subline">${escapeHtml(range)}${range && event.locatie ? ' • ' : ''}${escapeHtml(event.locatie || '')}</div>
        </div>
        <div class="oc-header-actions">
          ${statusBadge}
          <button class="btn ghost" id="oc-csv">CSV</button>
          <button class="btn ghost" id="oc-pdf">PDF</button>
          ${isClosed(event) ? '' : '<button class="btn danger" id="oc-afronden">Evenement afronden</button>'}
        </div>
      </header>

      <section class="oc-kpis" id="oc-kpi-strip">
        ${renderKpiCards(state)}
      </section>

      <section class="oc-target" id="oc-target-strip">
        ${renderTargetStrip(state)}
      </section>

      ${renderContextAction(state)}

      <section class="oc-core" id="oc-core">
        <div class="oc-col" id="oc-omzet-section">
          ${renderRevenueList(state)}
        </div>
        <div class="oc-col" id="oc-kosten-section">
          ${renderCostsOverview(state)}
        </div>
      </section>

      <section class="oc-charts" id="oc-charts">
        ${renderCharts(state)}
      </section>

      <footer class="oc-footer">
        <span class="muted">Laatst bijgewerkt: ${new Date().toLocaleString('nl-NL')}</span>
      </footer>
    </div>
  `;

  bindEventCockpit(modal, state);
}

async function buildState(event, opts) {
  const omzetEntries = normalizeRevenueEntries(event);
  const costs = normalizeCostEntries(event);
  const metrics = computeMetrics(event, omzetEntries, costs);

  return {
    event,
    omzetEntries,
    costs,
    metrics,
    showAllRevenue: Boolean(opts.showAllRevenue),
    chartInstances: []
  };
}

function renderKpiCards(state) {
  const { metrics } = state;
  const netClass = metrics.netEUR >= 0 ? 'pos' : 'neg';
  const marginLabel = Number.isFinite(metrics.marginPct)
    ? `${Math.round(metrics.marginPct * 100)}%`
    : '—';
  return `
    <button class="oc-kpi" data-scroll="#oc-omzet-section">
      <div class="lbl">Totale omzet</div>
      <div class="val">${formatCurrencyValue(metrics.revenueEUR, 'EUR')}</div>
      <div class="sub">${formatCurrencyValue(metrics.revenueUSD, 'USD')}</div>
    </button>
    <button class="oc-kpi" data-scroll="#oc-kosten-section">
      <div class="lbl">Kaaskosten</div>
      <div class="val">${formatCurrencyValue(metrics.cheeseCostEUR, 'EUR')}</div>
      <div class="sub">${escapeHtml(metrics.cheeseCostLabel)}</div>
    </button>
    <button class="oc-kpi" data-scroll="#oc-kosten-section">
      <div class="lbl">Totale kosten</div>
      <div class="val">${formatCurrencyValue(metrics.totalCostsEUR, 'EUR')}</div>
      <div class="sub">Commissie + stageld + extra</div>
    </button>
    <button class="oc-kpi ${netClass}" data-scroll="#oc-kosten-section">
      <div class="lbl">Netto resultaat</div>
      <div class="val">${formatCurrencyValue(metrics.netEUR, 'EUR')}</div>
      <div class="sub">${netClass === 'pos' ? 'Positief' : 'Negatief'}</div>
    </button>
    <button class="oc-kpi" data-scroll="#oc-kpi-strip">
      <div class="lbl">Marge</div>
      <div class="val">${escapeHtml(marginLabel)}</div>
      <div class="sub">Op omzet (EUR)</div>
    </button>
  `;
}

function renderTargetStrip(state) {
  const { metrics } = state;
  const target = metrics.targetEUR ?? metrics.targetUSD ?? null;
  const current = metrics.targetEUR != null ? metrics.revenueEUR : metrics.revenueUSD;
  const targetLabel = metrics.targetEUR != null ? 'EUR-doel' : metrics.targetUSD != null ? 'USD-doel' : 'Doel';
  if (!target || target <= 0) {
    return `
      <div class="oc-card">
        <h3>${escapeHtml(targetLabel)}</h3>
        <p class="muted">Geen doel ingesteld.</p>
      </div>
      <div class="oc-card">
        <h3>Pace</h3>
        <p class="muted">—</p>
      </div>
    `;
  }

  const progress = Math.min(100, Math.round((current / target) * 100));
  const remaining = Math.max(0, target - current);
  const pace = computePace(state);

  return `
    <div class="oc-card">
      <h3>${escapeHtml(targetLabel)}</h3>
      <div class="oc-progress">
        <div class="bar" style="width:${progress}%"></div>
      </div>
      <div class="oc-progress-meta">
        <span>${progress}%</span>
        <span>Nog te gaan: ${formatCurrencyValue(remaining, metrics.targetEUR != null ? 'EUR' : 'USD')}</span>
      </div>
    </div>
    <div class="oc-card">
      <h3>Pace</h3>
      <div class="oc-pace">
        <div>
          <span class="lbl">Gem. per dag</span>
          <strong>${formatCurrencyValue(pace.avgPerDayEUR, 'EUR')}</strong>
        </div>
        <div>
          <span class="lbl">Nodig per dag</span>
          <strong>${pace.neededPerDayEUR != null ? formatCurrencyValue(pace.neededPerDayEUR, 'EUR') : '—'}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderContextAction(state) {
  const { metrics } = state;
  if (metrics.missingTodayRevenue) {
    return `
      <section class="oc-cta">
        <button class="btn" id="oc-add-today">Vul dagomzet in voor vandaag</button>
      </section>
    `;
  }

  if (metrics.noManualCosts && metrics.eventOlderThanTwoDays) {
    return `
      <section class="oc-cta">
        <button class="btn ghost" id="oc-check-costs">Check kosten</button>
      </section>
    `;
  }

  return '';
}

function renderRevenueList(state) {
  const { omzetEntries, showAllRevenue } = state;
  if (!omzetEntries.length) {
    return `
      <div class="oc-card">
        <div class="oc-section-head">
          <h3>Dagomzet</h3>
          <button class="btn ghost" id="oc-add-omzet">Dagomzet toevoegen</button>
        </div>
        <p class="muted">Nog geen dagomzet geregistreerd.</p>
      </div>
    `;
  }

  const list = showAllRevenue ? omzetEntries : omzetEntries.slice(0, 7);
  const rows = list.map(entry => `
      <div class="oc-row">
        <div>
          <div class="oc-row-title">${escapeHtml(entry.dateLabel)}</div>
          <div class="oc-row-sub">${entry.debtor ? 'Debiteur' : 'Direct'}${entry.note ? ` • ${escapeHtml(entry.note)}` : ''}</div>
        </div>
        <div class="oc-row-values">
          <span>${formatCurrencyValue(entry.eur, 'EUR')}</span>
          <span class="muted">${formatCurrencyValue(entry.usd, 'USD')}</span>
        </div>
      </div>
    `).join('');

  return `
    <div class="oc-card">
      <div class="oc-section-head">
        <h3>Dagomzet</h3>
        <button class="btn ghost" id="oc-add-omzet">Dagomzet toevoegen</button>
      </div>
      <div class="oc-list">${rows}</div>
      <div class="oc-list-actions">
        ${omzetEntries.length > 7 ? `<button class="btn ghost" id="oc-toggle-omzet">${showAllRevenue ? 'Toon minder' : 'Toon alles'}</button>` : ''}
      </div>
    </div>
  `;
}

function renderCostsOverview(state) {
  const { metrics, costs } = state;
  const regularRows = [
    { label: 'Commissie', value: metrics.commissionEUR },
    { label: 'Stageld', value: metrics.stageldEUR },
    { label: `Kaaskosten (${metrics.cheeseCostLabel})`, value: metrics.cheeseCostEUR },
    { label: 'Snijkaas', value: costs.groups.Snijkaas.total }
  ];

  const groupEntries = Object.entries(costs.groups).filter(([key]) => key !== 'Snijkaas');

  const regularList = regularRows.map(row => `
      <div class="oc-row simple">
        <span>${escapeHtml(row.label)}</span>
        <strong>${formatCurrencyValue(row.value, 'EUR')}</strong>
      </div>
    `).join('');

  const extraGroups = groupEntries.map(([key, data]) => {
    const items = data.items.length
      ? data.items.map(item => `
          <div class="oc-subrow" data-cost-id="${escapeHtml(item.id)}">
            <span>${escapeHtml(item.comment || item.label || key)}</span>
            <div class="oc-subrow-actions">
              <em>${formatCurrencyValue(item.amount, 'EUR')}</em>
              ${isClosed(state.event) ? '' : `<button class="x" data-remove-cost="${escapeHtml(item.id)}">×</button>`}
            </div>
          </div>
        `).join('')
      : '<div class="muted">Geen kosten</div>';

    return `
      <details class="oc-group" ${data.items.length ? '' : 'open'}>
        <summary>
          <span>${escapeHtml(key)}</span>
          <strong>${formatCurrencyValue(data.total, 'EUR')}</strong>
        </summary>
        <div class="oc-group-body">${items}</div>
      </details>
    `;
  }).join('');

  return `
    <div class="oc-card">
      <div class="oc-section-head">
        <h3>Kosten</h3>
        <button class="btn ghost" id="oc-add-kost">+ Kost toevoegen</button>
      </div>
      ${regularList}
      <div class="oc-divider"></div>
      ${extraGroups}
      <div class="oc-divider"></div>
      <div class="oc-row total">
        <span>Totaal kosten</span>
        <strong>${formatCurrencyValue(metrics.totalCostsEUR, 'EUR')}</strong>
      </div>
    </div>
  `;
}

function renderCharts(state) {
  return `
    <div class="oc-card">
      <div class="oc-section-head">
        <h3>Omzet per dag</h3>
      </div>
      <div class="oc-chart" data-chart="revenue">
        ${window.Chart ? '<canvas id="oc-revenue-chart"></canvas>' : '<p class="muted">Grafiek niet beschikbaar.</p>'}
      </div>
    </div>
    <div class="oc-card">
      <div class="oc-section-head">
        <h3>Kostenverdeling</h3>
      </div>
      <div class="oc-chart" data-chart="costs">
        ${window.Chart ? '<canvas id="oc-cost-chart"></canvas>' : '<p class="muted">Grafiek niet beschikbaar.</p>'}
      </div>
    </div>
  `;
}

function bindEventCockpit(modal, state) {
  modal.body.querySelectorAll('[data-scroll]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = modal.body.querySelector(btn.dataset.scroll);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  modal.body.querySelector('#oc-csv')?.addEventListener('click', () => callExport('csv', state.event));
  modal.body.querySelector('#oc-pdf')?.addEventListener('click', () => callExport('pdf', state.event));
  modal.body.querySelector('#oc-afronden')?.addEventListener('click', () => callFinalizeEvent(state.event));

  modal.body.querySelector('#oc-add-omzet')?.addEventListener('click', () => callAddRevenue(state.event));
  modal.body.querySelector('#oc-add-today')?.addEventListener('click', () => callAddRevenue(state.event, new Date()));
  modal.body.querySelector('#oc-check-costs')?.addEventListener('click', () => callAddCost(state.event));
  modal.body.querySelector('#oc-add-kost')?.addEventListener('click', () => callAddCost(state.event));

  modal.body.querySelector('#oc-toggle-omzet')?.addEventListener('click', () => {
    state.showAllRevenue = !state.showAllRevenue;
    renderEventCockpit(modal, state);
  });

  modal.body.querySelectorAll('[data-remove-cost]')?.forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-remove-cost');
      if (!id || !confirm('Verwijder kost?')) return;
      await removeCostItem(state, id);
      renderEventCockpit(modal, state);
    });
  });

  if (window.Chart) {
    requestAnimationFrame(() => renderChartInstances(modal, state));
  }
}

function renderChartInstances(modal, state) {
  const revenueCanvas = modal.body.querySelector('#oc-revenue-chart');
  const costCanvas = modal.body.querySelector('#oc-cost-chart');
  state.chartInstances.forEach(chart => chart?.destroy?.());
  state.chartInstances = [];

  if (revenueCanvas) {
    const { labels, data } = buildRevenueChartData(state.omzetEntries);
    const chart = new window.Chart(revenueCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Omzet (EUR)',
          data,
          backgroundColor: '#2A9626',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: value => `€${value}` } } }
      }
    });
    state.chartInstances.push(chart);
    revenueCanvas.closest('.oc-chart')?.addEventListener('click', () => openChartModal('Omzet per dag', chart));
  }

  if (costCanvas) {
    const { labels, data } = buildCostChartData(state.metrics, state.costs);
    const chart = new window.Chart(costCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: ['#FFC500', '#2A9626', '#6CBF6A', '#D97706', '#94A3B8', '#E74C3C']
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } }
      }
    });
    state.chartInstances.push(chart);
    costCanvas.closest('.oc-chart')?.addEventListener('click', () => openChartModal('Kostenverdeling', chart));
  }
}

function openChartModal(title, sourceChart) {
  if (!sourceChart) return;
  const modal = mountModal(title);
  modal.root.classList.add('oc-chart-modal');
  modal.body.innerHTML = '<canvas class="oc-chart-large"></canvas>';
  const canvas = modal.body.querySelector('canvas');
  const cfg = sourceChart.config;
  if (window.Chart && canvas) {
    new window.Chart(canvas.getContext('2d'), cfg);
  }
}

function normalizeRevenueEntries(event) {
  const entries = [];
  const fromEvent = event?.dagomzet || event?.omzetPerDag || event?.dailyRevenue || event?.omzet || [];
  const fromStore = typeof getEventOmzet === 'function' ? getEventOmzet(event?.id || event?.naam || '') : [];
  [...(Array.isArray(fromEvent) ? fromEvent : []), ...(Array.isArray(fromStore) ? fromStore : [])]
    .forEach(entry => entries.push(entry));

  const seen = new Map();
  entries.forEach(entry => {
    const date = normalizeOmzetDate(entry.dateISO || entry.date || entry.datum || entry.dagDatum || entry.dag);
    const eur = toSafeNumber(entry.eur ?? entry.prijs_eur ?? entry.amountEUR ?? entry.bedragEUR);
    const usd = toSafeNumber(entry.usd ?? entry.prijs_usd ?? entry.amountUSD ?? entry.bedragUSD);
    const debtor = resolveEntryDebtorFlag(entry);
    const note = entry.note || entry.comment || '';
    const id = entry.id || entry.entryId || '';
    const key = id || [date || 'onbekend', eur, usd, debtor ? '1' : '0', note].join('|');
    if (seen.has(key)) return;
    seen.set(key, {
      id: id || `${date || 'onbekend'}-${Math.random().toString(36).slice(2)}`,
      date,
      dateLabel: formatOmzetDate(date),
      eur,
      usd,
      debtor,
      note
    });
  });

  return Array.from(seen.values()).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function normalizeCostEntries(event) {
  const sourceCosts = [
    ...(Array.isArray(event?.kosten) ? event.kosten : []),
    ...(Array.isArray(event?.extraKosten) ? event.extraKosten : [])
  ];

  const groups = {
    Diesel: { items: [], total: 0 },
    Overnachten: { items: [], total: 0 },
    Eten: { items: [], total: 0 },
    Overig: { items: [], total: 0 },
    Snijkaas: { items: [], total: 0 }
  };

  const normalized = sourceCosts.map((entry, index) => {
    const rawType = (entry.soort || entry.type || entry.category || 'Overig').toString().trim();
    const amount = toSafeNumber(entry.bedragEUR ?? entry.bedrag ?? entry.amount ?? entry.amountEUR);
    const type = normalizeCostType(rawType);
    const item = {
      id: entry.id || entry.costId || `${type}-${index}-${Math.random().toString(36).slice(2)}`,
      type,
      amount,
      comment: entry.comment || entry.notitie || entry.note || '',
      label: entry.label || entry.omschrijving || '',
      _source: entry
    };
    if (!groups[type]) groups.Overig.items.push(item);
    else groups[type].items.push(item);
    return item;
  });

  Object.values(groups).forEach(group => {
    group.total = group.items.reduce((sum, item) => sum + item.amount, 0);
  });

  return { items: normalized, groups };
}

function computeMetrics(event, omzetEntries, costs) {
  const revenueEUR = omzetEntries.reduce((sum, entry) => sum + entry.eur, 0);
  const revenueUSD = omzetEntries.reduce((sum, entry) => sum + entry.usd, 0);

  const commissionPct = resolveCommissionPct(event);
  const commissionEUR = revenueEUR * commissionPct;

  const actualCheeseCost = firstFinite([
    event?.kaaskostenEUR,
    event?.cheeseCostEUR,
    event?.kaaskosten
  ]);
  const prelimCheeseCost = revenueEUR * 0.3;
  const cheeseCostEUR = actualCheeseCost != null ? actualCheeseCost : prelimCheeseCost;
  const cheeseCostLabel = actualCheeseCost != null ? 'Actueel' : 'Prelim (30%)';

  const stageldEUR = toSafeNumber(event?.stageld ?? event?.stageldEUR);
  const extraCostsEUR = costs.items.reduce((sum, item) => sum + item.amount, 0);

  const totalCostsEUR = commissionEUR + stageldEUR + cheeseCostEUR + extraCostsEUR;
  const netEUR = revenueEUR - totalCostsEUR;
  const marginPct = revenueEUR > 0 ? netEUR / revenueEUR : 0;

  const today = toYMDString(new Date());
  const hasTodayRevenue = omzetEntries.some(entry => entry.date === today);
  const noManualCosts = costs.items.length === 0;
  const eventOlderThanTwoDays = isEventOlderThan(event, 2);

  const target = resolveTargets(event);

  return {
    revenueEUR,
    revenueUSD,
    commissionEUR,
    cheeseCostEUR,
    cheeseCostLabel,
    stageldEUR,
    extraCostsEUR,
    totalCostsEUR,
    netEUR,
    marginPct,
    missingTodayRevenue: !hasTodayRevenue,
    noManualCosts,
    eventOlderThanTwoDays,
    targetEUR: target.eur,
    targetUSD: target.usd
  };
}

function resolveCommissionPct(event) {
  const pct = firstFinite([event?.commissiePct, event?.commissie, event?.commissiePercentage]);
  if (pct == null) return 0;
  if (pct > 0 && pct <= 1) return pct;
  if (pct > 1 && pct <= 100) return pct / 100;
  return 0;
}

function resolveTargets(event) {
  const planning = event?.planning || {};
  const expected = planning.expectedTurnover || {};
  return {
    eur: firstFinite([
      event?.targetEUR,
      event?.doelEUR,
      expected.eur,
      expected.EUR,
      planning.expectedTurnoverEUR,
      planning.turnoverEstimate,
      planning.expectedRevenue
    ]),
    usd: firstFinite([
      event?.targetUSD,
      event?.doelUSD,
      expected.usd,
      expected.USD,
      planning.expectedTurnoverUSD
    ])
  };
}

function computePace(state) {
  const daysWithRevenue = new Set(state.omzetEntries.map(entry => entry.date).filter(Boolean));
  const avgPerDayEUR = daysWithRevenue.size
    ? state.metrics.revenueEUR / daysWithRevenue.size
    : 0;

  const endDate = getEventDate(state.event, 'end');
  const remainingDays = endDate ? Math.max(0, diffDays(new Date(), new Date(endDate)) + 1) : null;
  const targetRemaining = state.metrics.targetEUR != null
    ? Math.max(0, state.metrics.targetEUR - state.metrics.revenueEUR)
    : null;
  const neededPerDayEUR = remainingDays && targetRemaining != null && remainingDays > 0
    ? targetRemaining / remainingDays
    : null;

  return { avgPerDayEUR, neededPerDayEUR };
}

function buildRevenueChartData(entries) {
  const sorted = [...entries].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return {
    labels: sorted.map(entry => entry.dateLabel || entry.date || ''),
    data: sorted.map(entry => entry.eur)
  };
}

function buildCostChartData(metrics, costs) {
  const labels = [
    'Commissie',
    'Stageld',
    `Kaaskosten (${metrics.cheeseCostLabel})`,
    'Diesel',
    'Overnachten',
    'Eten',
    'Overig',
    'Snijkaas'
  ];

  const data = [
    metrics.commissionEUR,
    metrics.stageldEUR,
    metrics.cheeseCostEUR,
    costs.groups.Diesel.total,
    costs.groups.Overnachten.total,
    costs.groups.Eten.total,
    costs.groups.Overig.total,
    costs.groups.Snijkaas.total
  ];

  return { labels, data };
}

async function removeCostItem(state, id) {
  const event = state.event;
  const removeFromArray = (arr) => {
    const index = arr.findIndex(entry => (entry.id || entry.costId) === id);
    if (index >= 0) arr.splice(index, 1);
  };

  if (Array.isArray(event.kosten)) removeFromArray(event.kosten);
  if (Array.isArray(event.extraKosten)) removeFromArray(event.extraKosten);

  await saveEvent(event.id);
  try {
    await deleteExtraCostLedgerEntry?.(event.id, id);
  } catch (err) {
    console.warn('[EventCockpit] Ledger delete kost mislukt:', err);
  }

  state.costs = normalizeCostEntries(event);
  state.metrics = computeMetrics(event, state.omzetEntries, state.costs);
}

function callExport(type, event) {
  const id = event?.id || event?.naam || event?.name;
  const actions = {
    csv: ['exportEventCSV', 'exportEventCsv', 'exportEventExcel'],
    pdf: ['exportEventPDF', 'exportEventPdf']
  };
  const candidates = actions[type] || [];
  for (const fnName of candidates) {
    if (typeof window[fnName] === 'function') {
      window[fnName](id);
      return;
    }
  }
  showAlert(`Export ${type.toUpperCase()} niet beschikbaar.`, 'warning');
}

function callFinalizeEvent(event) {
  const id = event?.id || event?.naam || event?.name;
  const candidates = ['afrondenEvenement', 'openAfrondModal', 'finalizeEvent'];
  for (const fnName of candidates) {
    if (typeof window[fnName] === 'function') {
      window[fnName](id);
      return;
    }
  }
  showAlert('Afronden niet beschikbaar.', 'warning');
}

function callAddRevenue(event, date) {
  const id = event?.id || event?.naam || event?.name;
  const candidates = ['openDagomzetModal', 'showDagomzetInvoer', 'openOmzetModal'];
  for (const fnName of candidates) {
    if (typeof window[fnName] === 'function') {
      window[fnName](id, date ? toYMDString(date) : undefined);
      return;
    }
  }
  showAlert('Dagomzet invoer niet beschikbaar.', 'warning');
}

function callAddCost(event) {
  const id = event?.id || event?.naam || event?.name;
  const candidates = ['toonKostenToevoegen', 'openKostenModal', 'openCostModal'];
  for (const fnName of candidates) {
    if (typeof window[fnName] === 'function') {
      window[fnName](id);
      return;
    }
  }
  showAlert('Kosten invoer niet beschikbaar.', 'warning');
}

function resolveEvent(ref) {
  if (!ref) return null;
  return (db.evenementen || []).find(e => e.id === ref || e.naam === ref || e.name === ref);
}

function normalizeCostType(raw) {
  const key = raw.toLowerCase();
  if (key.includes('diesel')) return 'Diesel';
  if (key.includes('slaap') || key.includes('overnacht')) return 'Overnachten';
  if (key.includes('eten') || key.includes('food')) return 'Eten';
  if (key.includes('snijkaas')) return 'Snijkaas';
  if (key.includes('overig') || key.includes('anders')) return 'Overig';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function resolveEntryDebtorFlag(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.debtor === 'boolean') return entry.debtor;
  if (typeof entry.debiteur === 'boolean') return entry.debiteur;
  if (typeof entry.isDebtor === 'boolean') return entry.isDebtor;
  const raw = entry.debtor ?? entry.debiteur ?? entry.isDebtor;
  if (typeof raw === 'string') {
    const clean = raw.trim().toLowerCase();
    if (['1', 'true', 'ja', 'j', 'yes', 'debiteur', 'debtor', 'invoice', 'factuur'].includes(clean)) return true;
    if (['0', 'false', 'nee', 'n', 'no'].includes(clean)) return false;
  }
  const method = (entry.paymentMethod || entry.pm || '').toString().toUpperCase();
  return method === 'DEBTOR' || method === 'DEBITEUR' || method === 'INVOICE' || method === 'FACTUUR';
}

function isClosed(ev) {
  const state = String(ev?.state || ev?.status || '').toLowerCase();
  return ev?.afgerond === true || state === 'closed' || state === 'afgesloten' || state === 'completed';
}

function isEventOlderThan(event, days) {
  const start = getEventDate(event, 'start');
  if (!start) return false;
  const diff = diffDays(new Date(start), new Date());
  return diff >= days;
}

function diffDays(a, b) {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((b.getTime() - a.getTime()) / dayMs);
}

function formatEventRange(event) {
  const start = getEventDate(event, 'start');
  const end = getEventDate(event, 'end');
  if (!start && !end) return '';
  if (start && end && start === end) return formatDateLong(start);
  const parts = [start ? formatDateLong(start) : '', end ? formatDateLong(end) : ''].filter(Boolean);
  return parts.join(' – ');
}

function getEventDate(event, type) {
  const candidates = type === 'start'
    ? [event.startdatum, event.startDatum, event.beginDatum, event.startDate, event.start]
    : [event.einddatum, event.eindDatum, event.endDate, event.eind];
  for (const val of candidates) {
    if (val) return normalizeOmzetDate(val);
  }
  return null;
}

function normalizeOmzetDate(value) {
  if (!value) return null;
  if (value instanceof Date) return toYMDString(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return toYMDString(parsed);
}

function formatOmzetDate(ymd) {
  if (!ymd) return 'Onbekende datum';
  try {
    const [y, m, d] = ymd.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('nl-NL', { weekday: 'long', day: '2-digit', month: 'long' });
  } catch {
    return ymd;
  }
}

function toYMDString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateLong(ymd) {
  if (!ymd) return '';
  try {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('nl-NL', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch {
    return ymd;
  }
}

function toSafeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function firstFinite(values) {
  for (const value of values) {
    const parsed = parseDecimalValue(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function parseDecimalValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const str = String(raw).trim();
  if (!str) return null;
  const normalized = Number(str.replace(',', '.'));
  return Number.isFinite(normalized) ? normalized : null;
}

function formatCurrencyValue(value, currency) {
  const num = Number(value);
  if (!Number.isFinite(num)) return currency === 'USD' ? 'US$ —' : '€ —';
  const formatted = num.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (currency === 'USD') return `US$ ${formatted}`;
  return `€ ${formatted}`;
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

function mountModal(titleText) {
  const overlay = document.createElement('div');
  overlay.className = 'oc-overlay';
  const box = document.createElement('div');
  box.className = 'oc-modal';
  const head = document.createElement('div');
  head.className = 'oc-modal-head';
  head.innerHTML = `<strong>${escapeHtml(titleText)}</strong><button class="oc-close" aria-label="Sluiten">✕</button>`;
  const body = document.createElement('div');
  body.className = 'oc-modal-body';
  box.appendChild(head);
  box.appendChild(body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');

  const close = () => {
    overlay.remove();
    if (!document.querySelector('.modal-overlay')) document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', onEsc, true);
  };
  const onEsc = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  document.addEventListener('keydown', onEsc, true);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  head.querySelector('.oc-close')?.addEventListener('click', close);

  return { root: box, body, close };
}

function ensureStyles() {
  if (document.getElementById('oc-styles')) return;
  const css = `
  .oc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);display:grid;place-items:center;z-index:10000}
  .oc-modal{width:min(98vw,1180px);max-height:95vh;border-radius:16px;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column}
  .oc-modal-head{display:flex;justify-content:space-between;align-items:center;padding:.7rem 1rem;border-bottom:1px solid #eee;position:sticky;top:0;background:#fff;z-index:2}
  .oc-close{background:#eee;border:none;border-radius:50%;width:32px;height:32px;font-weight:900;cursor:pointer}
  .oc-modal-body{padding:1rem;overflow:auto}
  .oc-eventcockpit{display:flex;flex-direction:column;gap:1rem}
  .oc-header{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap}
  .oc-header h2{margin:0;font-size:1.35rem;color:#1F6D1C}
  .oc-subline{margin-top:.35rem;color:#4a5c4a;font-weight:600}
  .oc-header-actions{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;justify-content:flex-end}
  .oc-badge{padding:.2rem .6rem;border-radius:999px;font-weight:800;font-size:.75rem;color:#fff}
  .oc-badge.open{background:#2A9626}.oc-badge.closed{background:#777}
  .btn{border-radius:999px;border:1px solid #1F6D1C;background:#2A9626;color:#fff;padding:.4rem .8rem;font-weight:800;cursor:pointer}
  .btn.ghost{background:#fff;color:#1F6D1C;border-color:#1F6D1C}
  .btn.danger{background:#E74C3C;border-color:#E74C3C}
  .oc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.6rem}
  .oc-kpi{border:1px solid #eee;border-radius:12px;background:#fff;padding:.7rem;text-align:left;cursor:pointer}
  .oc-kpi .lbl{font-size:.8rem;color:#666}
  .oc-kpi .val{font-size:1.2rem;font-weight:900;color:#1F6D1C}
  .oc-kpi .sub{font-size:.75rem;color:#7a7a7a;margin-top:.2rem}
  .oc-kpi.neg .val{color:#C62828}
  .oc-kpi.pos .val{color:#2A9626}
  .oc-target{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.6rem}
  .oc-card{border:1px solid #eee;border-radius:12px;padding:.8rem;background:#fff}
  .oc-card h3{margin:.1rem 0 .5rem;font-size:1rem;color:#1F6D1C}
  .oc-progress{height:10px;background:#f1f1f1;border-radius:999px;overflow:hidden}
  .oc-progress .bar{height:100%;background:linear-gradient(90deg,#FFC500,#2A9626)}
  .oc-progress-meta{display:flex;justify-content:space-between;font-size:.8rem;margin-top:.35rem;color:#555}
  .oc-pace{display:flex;justify-content:space-between;gap:.8rem}
  .oc-pace .lbl{display:block;font-size:.75rem;color:#777}
  .oc-cta{text-align:center}
  .oc-core{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:.8rem}
  .oc-section-head{display:flex;justify-content:space-between;align-items:center;gap:.5rem}
  .oc-list{display:flex;flex-direction:column;gap:.6rem;margin-top:.6rem}
  .oc-row{display:flex;justify-content:space-between;gap:.6rem;padding:.45rem 0;border-bottom:1px solid #f1f1f1}
  .oc-row.simple{border-bottom:none;padding:.2rem 0}
  .oc-row.total{font-weight:900}
  .oc-row-title{font-weight:700}
  .oc-row-sub{font-size:.8rem;color:#666}
  .oc-row-values{display:flex;flex-direction:column;align-items:flex-end;gap:.1rem;font-weight:700}
  .oc-list-actions{display:flex;justify-content:flex-end;margin-top:.6rem}
  .oc-divider{border-top:1px dashed #eee;margin:.6rem 0}
  .oc-group{border:1px solid #f1f1f1;border-radius:10px;padding:.5rem;margin-bottom:.5rem}
  .oc-group summary{display:flex;justify-content:space-between;align-items:center;font-weight:800;color:#1F6D1C;cursor:pointer}
  .oc-group-body{margin-top:.4rem;display:flex;flex-direction:column;gap:.35rem}
  .oc-subrow{display:flex;justify-content:space-between;align-items:center;gap:.5rem}
  .oc-subrow-actions{display:flex;gap:.5rem;align-items:center}
  .oc-subrow em{font-style:normal;font-weight:700}
  .oc-subrow .x{background:none;border:none;color:#E74C3C;font-weight:900;cursor:pointer;font-size:1.1rem;line-height:1}
  .oc-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.8rem}
  .oc-chart{min-height:180px;display:flex;align-items:center;justify-content:center}
  .oc-chart canvas{width:100% !important;height:180px !important}
  .oc-footer{display:flex;justify-content:flex-end}
  .oc-error{text-align:center;padding:1rem}
  .oc-skel{height:140px;border-radius:12px;background:linear-gradient(90deg,#eee,#f7f7f7,#eee);background-size:200% 100%;animation:sk 1.2s infinite}
  .oc-chart-modal .oc-modal-body{padding:0}
  .oc-chart-large{width:100% !important;height:360px !important}
  .muted{color:#777}
  @keyframes sk{0%{background-position:200% 0}100%{background-position:-200% 0}}
  @media (max-width: 720px){
    .oc-header-actions{width:100%;justify-content:flex-start}
  }
  `;
  const style = document.createElement('style');
  style.id = 'oc-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

// Backwards compatibility entrypoints
window.openEventDetails = window.openEventDetails || openEventDetail;
window.toonEventDetails = window.toonEventDetails || openEventDetail;
window.showEventDetailsModal = window.showEventDetailsModal || openEventDetail;
window.renderEventDetails = window.renderEventDetails || ((eventRef) => openEventDetail(eventRef));
