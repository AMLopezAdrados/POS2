// 📦 modules/9_eventdetails.js — Eventdetails (voorraad, omzet, kosten, overzicht)

import { db, saveEvent, getEventOmzet, recordExtraCostLedgerEntry, deleteExtraCostLedgerEntry, recordEventInvoiceLedgerEntry } from './3_data.js';
import { showAlert, showLoading, hideLoading, computeEventFinancials, calculateOmzetTotals, formatCurrencyValue, formatCurrencyPair } from './4_ui.js';

export async function openEventDetail(eventRef, options = {}) {
  const opts = typeof options === 'string' ? { initialTab: options } : (options || {});
  const event = resolveEvent(eventRef);
  if (!event) {
    showAlert('❌ Evenement niet gevonden', 'error');
    return;
  }

  ensureStyles();
  const modal = mountModal(`Event details — ${event.naam}`);
  modal.body.innerHTML = '<div class="ed-skel"></div>';

  try {
    showLoading('Gegevens laden…');
    const state = await buildState(event);
    const requestedTab = (opts.initialTab || '').toString();
    const allowedTabs = new Set(['overzicht', 'voorraad', 'omzet', 'kosten']);
    if (allowedTabs.has(requestedTab)) {
      state.activeTab = requestedTab;
    }
    renderAll(modal, state);
    if (opts.autoOpenCostModal === true && state.activeTab === 'kosten' && !isClosed(state.event)) {
      setTimeout(() => {
        modal.body.querySelector('#ed-add-kost')?.click();
      }, 60);
    }
  } catch (err) {
    console.error('[Eventdetails] Laden mislukt', err);
    showAlert('Kon eventdetails niet laden.', 'error');
  } finally {
    hideLoading();
  }
}

async function buildState(event) {
  const omzetEntries = getEventOmzet(event.id || event.naam || '');
  const normalizedOmzet = normalizeOmzetEntries(omzetEntries);
  event.omzet = normalizedOmzet.map(entry => ({ ...entry.raw }));
  const metrics = computeEventFinancials(event);
  const omzetTotals = calculateOmzetTotals(event, 'EUR', null);
  const invoice = resolveInvoiceSettings(event, metrics);

  return {
    event,
    metrics,
    omzetEntries: normalizedOmzet,
    omzetTotals,
    extraCosts: groupExtraCosts(event),
    invoice,
    activeTab: 'overzicht'
  };
}

function roundAmount(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function resolveInvoiceSettings(event, metrics) {
  const fact = event?.facturatie || event?.invoice || {};
  const metricsInvoice = metrics?.invoice || {};
  const fallbackRevenue = Number.isFinite(metrics?.totalRevenueEUR) ? metrics.totalRevenueEUR : 0;
  const fallbackCommission = Number.isFinite(metrics?.commissionEUR) ? metrics.commissionEUR : 0;
  const computedExpected = roundAmount(Math.max(0, fallbackRevenue - fallbackCommission));
  const expectedEUR = Number.isFinite(metricsInvoice.expectedEUR)
    ? metricsInvoice.expectedEUR
    : Number.isFinite(computedExpected)
      ? computedExpected
      : 0;
  const finalEUR = (() => {
    if (Number.isFinite(metricsInvoice.finalEUR)) return metricsInvoice.finalEUR;
    const raw = fact?.definitief?.eur ?? fact?.factuurBedragEUR;
    const parsed = raw == null ? NaN : Number(String(raw).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const finalUSD = (() => {
    if (Number.isFinite(metricsInvoice.finalUSD)) return metricsInvoice.finalUSD;
    const raw = fact?.definitief?.usd ?? fact?.factuurBedragUSD;
    const parsed = raw == null ? NaN : Number(String(raw).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const differenceEUR = finalEUR == null ? null : roundAmount(finalEUR - expectedEUR);
  const invoiceNumber = metricsInvoice.invoiceNumber || fact.factuurNummer || fact.invoiceNumber || '';
  const checkedAt = metricsInvoice.checkedAt || fact.gecontroleerdOp || fact.checkedAt || '';
  const note = metricsInvoice.note || fact.opmerking || fact.note || '';
  const statusRaw = (metricsInvoice.status || fact.status || '').toString().trim().toUpperCase();
  const status = ['PAID', 'OPEN', 'PENDING'].includes(statusRaw) ? statusRaw : (finalEUR != null ? 'PENDING' : 'DRAFT');
  const debtorFlagCandidates = [
    metricsInvoice.isDebtor,
    fact.debiteur,
    fact.isDebtor,
    fact.debtor,
    event?.debiteur,
    event?.isDebtor,
    event?.debtor
  ];
  let isDebtor = false;
  for (const candidate of debtorFlagCandidates) {
    if (typeof candidate === 'boolean') { isDebtor = candidate; break; }
    if (typeof candidate === 'string') {
      const clean = candidate.trim().toLowerCase();
      if (!clean) continue;
      if (['1', 'true', 'ja', 'j', 'yes', 'debiteur', 'debtor', 'invoice', 'factuur'].includes(clean)) { isDebtor = true; break; }
      if (['0', 'false', 'nee', 'n', 'no'].includes(clean)) { isDebtor = false; break; }
    }
  }

  return {
    isDebtor,
    invoiceNumber,
    expectedEUR: roundAmount(expectedEUR) ?? 0,
    finalEUR: roundAmount(finalEUR),
    finalUSD: roundAmount(finalUSD),
    differenceEUR,
    checkedAt,
    note,
    status
  };
}

function resolveEvent(ref) {
  return (db.evenementen || []).find(e => e.id === ref || e.naam === ref);
}

function renderAll(modal, state) {
  state.invoice = resolveInvoiceSettings(state.event, state.metrics);
  modal.body.innerHTML = `
    ${renderTop(state)}
    ${renderTabs(state)}
    <div class="ed-tabwrap">
      ${renderTabContent(state)}
    </div>
    ${renderFooter(state)}
  `;
  bindHeader(modal, state);
  bindTabs(modal, state);
  bindEventSettings(modal, state);
  bindInvoiceControls(modal, state);
  bindKostenActions(modal, state);
}

function renderTop(state) {
  const { event } = state;
  const open = !isClosed(event);
  const badge = open ? '<span class="badge open">OPEN</span>' : '<span class="badge closed">AFGEROND</span>';
  const range = formatEventRange(event);
  return `
    <div class="ed-head">
      <div class="ed-title">
        <h2>${escapeHtml(event.naam || 'Evenement')}</h2>
        ${badge}
      </div>
      <div class="ed-right">
        <button class="btn ghost" id="ed-csv">CSV</button>
        <button class="btn ghost" id="ed-pdf">PDF</button>
        ${open ? '<button class="btn danger" id="ed-afronden">Evenement afronden</button>' : ''}
      </div>
    </div>
    ${range ? `<p class="ed-range">${escapeHtml(range)}</p>` : ''}
  `;
}

function renderTabs(state) {
  const tab = state.activeTab;
  const btn = (id, label) => `<button class="tab ${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`;
  return `
    <div class="ed-tabs">
      ${btn('overzicht', 'Overzicht')}
      ${btn('voorraad', 'Voorraad')}
      ${btn('omzet', 'Omzet')}
      ${btn('kosten', 'Kosten')}
    </div>
  `;
}

function renderTabContent(state) {
  switch (state.activeTab) {
    case 'voorraad':
      return renderVoorraad(state);
    case 'omzet':
      return renderOmzet(state);
    case 'kosten':
      return renderKosten(state);
    default:
      return renderOverzicht(state);
  }
}

function renderOverzicht(state) {
  const m = state.metrics;
  const debtorPct = Math.round(m.debtorPercentages?.DEBTOR || 0);
  const directPct = Math.round(m.debtorPercentages?.DIRECT || 0);
  const warning = buildOmzetWarning(m);
  const cheeseReady = Boolean(m.cheeseMetricsReady);
  const cheeseUnitsLabel = cheeseReady ? formatCheeseUnits(m.cheeseUnits) : '—';
  const cheeseRevenueLabel = cheeseReady ? formatCurrencyPair(m.cheeseRevenueEUR, m.cheeseRevenueUSD) : '—';
  const souvenirRevenueLabel = cheeseReady ? formatCurrencyPair(m.souvenirRevenueEUR, m.souvenirRevenueUSD) : '—';
  const cheeseCostLabel = m.cheeseCostSource === 'pending'
    ? '—'
    : formatCurrencyValue(m.cheeseCostEUR, 'EUR');
  const cheeseCostTitle = m.cheeseCostSource === 'invoice'
    ? 'Kostprijs kaas (facturen)'
    : m.cheeseCostSource === 'pending'
      ? 'Kostprijs kaas (nog te bepalen)'
      : 'Kostprijs kaas';
  const netResultLabel = cheeseReady ? formatCurrencyValue(m.netResultEUR, 'EUR') : '—';
  const netResultVariant = cheeseReady ? (m.netResultEUR >= 0 ? 'pos' : 'neg') : '';
  return `
    <section class="ed-hero">
      <div class="kpi-card accent">
        <div class="kpi-label">Totale omzet</div>
        <div class="kpi-value">${escapeHtml(formatCurrencyPair(m.totalRevenueEUR, m.totalRevenueUSD))}</div>
        <div class="kpi-sublabel">Inclusief kaas en souvenirs</div>
      </div>
      <div class="kpi-row">
        ${kpi('Kaas verkocht', cheeseUnitsLabel)}
        ${kpi('Kaasomzet', cheeseRevenueLabel)}
        ${kpi('Souvenir-omzet', souvenirRevenueLabel)}
        ${kpi(cheeseCostTitle, cheeseCostLabel)}
        ${kpi('Netto resultaat', netResultLabel, netResultVariant)}
        ${kpi('Debiteur / Direct', `${debtorPct}% / ${directPct}%`)}
      </div>
      ${warning ? `<p class="hint">${escapeHtml(warning)}</p>` : ''}
    </section>
    ${renderInvoiceSummary(state)}
    ${renderEventSettings(state)}
  `;
}

function renderInvoiceSummary(state) {
  const invoice = state.invoice;
  if (!invoice) return '';
  const statusLabel = invoice.status === 'PAID'
    ? 'Betaald'
    : invoice.status === 'OPEN'
      ? 'Openstaand'
      : 'Concept';
  const expected = formatCurrencyValue(invoice.expectedEUR || 0, 'EUR');
  const finalLabel = invoice.finalEUR != null
    ? formatCurrencyValue(invoice.finalEUR, 'EUR')
    : 'Nog niet vastgesteld';
  const differenceLabel = invoice.differenceEUR != null
    ? formatCurrencyValue(invoice.differenceEUR, 'EUR')
    : '—';
  const differenceClass = invoice.differenceEUR == null
    ? ''
    : invoice.differenceEUR >= 0
      ? 'pos'
      : 'neg';
  const checkedLabel = invoice.checkedAt
    ? new Date(invoice.checkedAt).toLocaleDateString('nl-NL')
    : 'Nog niet gecontroleerd';
  const note = invoice.note ? `<p class="muted">${escapeHtml(invoice.note)}</p>` : '';
  const debtorLabel = invoice.isDebtor ? 'Ja' : 'Nee';
  const buttonLabel = invoice.finalEUR != null ? 'Factuur bijwerken' : 'Factuur controleren';
  return `
    <section class="ed-invoice">
      <div class="invoice-card">
        <header>
          <h3>Debiteur &amp; factuur</h3>
          <span class="status ${invoice.status.toLowerCase()}">${escapeHtml(statusLabel)}</span>
        </header>
        <dl class="invoice-grid">
          <div><dt>Debiteur</dt><dd>${debtorLabel}</dd></div>
          <div><dt>Verwachte factuur</dt><dd>${escapeHtml(expected)}</dd></div>
          <div><dt>Definitief</dt><dd>${escapeHtml(finalLabel)}</dd></div>
          <div><dt>Verschil</dt><dd class="${differenceClass}">${escapeHtml(differenceLabel)}</dd></div>
          <div><dt>Laatst gecontroleerd</dt><dd>${escapeHtml(checkedLabel)}</dd></div>
          <div><dt>Factuurnummer</dt><dd>${invoice.invoiceNumber ? escapeHtml(invoice.invoiceNumber) : '—'}</dd></div>
        </dl>
        ${note}
        <div class="invoice-actions">
          <button class="btn" data-open-invoice>${escapeHtml(buttonLabel)}</button>
        </div>
      </div>
    </section>
  `;
}

function renderEventSettings(state) {
  const event = state.event || {};
  const targets = resolvePlanningTargets(event);
  const commissionValue = formatNumberInput(parseDecimalValue(event.commissie));
  const stageldValue = formatNumberInput(parseDecimalValue(event.stageld));
  const goalEurValue = formatNumberInput(targets.eur);
  const goalUsdValue = formatNumberInput(targets.usd);
  return `
    <section class="ed-settings">
      <h3>Doelstelling &amp; vaste waarden</h3>
      <form id="ed-settings-form">
        <div class="settings-grid">
          <label>Doelstelling (EUR)
            <input type="number" step="0.01" min="0" inputmode="decimal" name="goalEur" value="${escapeHtml(goalEurValue)}" placeholder="0,00">
          </label>
          <label>Doelstelling (USD)
            <input type="number" step="0.01" min="0" inputmode="decimal" name="goalUsd" value="${escapeHtml(goalUsdValue)}" placeholder="0.00">
          </label>
          <label>Commissie (%)
            <input type="number" step="0.1" min="0" inputmode="decimal" name="commission" value="${escapeHtml(commissionValue)}" placeholder="0">
          </label>
          <label>Stageld (EUR)
            <input type="number" step="0.01" min="0" inputmode="decimal" name="stageld" value="${escapeHtml(stageldValue)}" placeholder="0,00">
          </label>
        </div>
        <div class="settings-actions">
          <button type="button" class="btn ghost" id="ed-settings-reset">Annuleren</button>
          <button type="submit" class="btn" id="ed-settings-save">Opslaan</button>
        </div>
      </form>
    </section>
  `;
}

function kpi(label, value, variant = '') {
  const variantClass = variant === 'pos' ? 'pos' : variant === 'neg' ? 'neg' : '';
  return `<div class="kpi ${variantClass}"><div class="lbl">${escapeHtml(label)}</div><div class="val">${escapeHtml(value)}</div></div>`;
}

function renderVoorraad(state) {
  const telling = state.event.kaasTelling || {};
  const startTotals = toCheeseTotals(telling.start);
  const endTotals = toCheeseTotals(telling.end);
  const supplements = Array.isArray(telling.supplements) ? telling.supplements : [];
  const ready = Boolean(state.metrics.cheeseMetricsReady);
  const salesProducts = state.metrics.cheeseSnapshot?.products || {};
  const salesCategories = state.metrics.cheeseTypeTotals || { BG: 0, ROOK: 0, GEIT: 0 };

  const supplementsHtml = supplements.length
    ? supplements.map(entry => `<li>${formatCheeseTotals(entry)}</li>`).join('')
    : '<li class="muted">Geen aanvullingen geregistreerd.</li>';

  const productsHtml = ready
    ? (Object.keys(salesProducts).length
        ? Object.entries(salesProducts)
            .sort((a, b) => b[1] - a[1])
            .map(([name, qty]) => `<li><strong>${escapeHtml(name)}</strong><span>${formatCheeseUnits(qty)}</span></li>`)
            .join('')
        : '<li class="muted">Geen verkoop geregistreerd.</li>')
    : '<li class="muted">Verkoopresultaat volgt na eindtelling.</li>';

  const categoryNote = ready
    ? `Categorieën: BG ${salesCategories.BG} • ROOK ${salesCategories.ROOK} • GEIT ${salesCategories.GEIT}`
    : 'Categorieën: gegevens volgen na eindtelling';

  return `
    <section class="stock-grid">
      <article class="stock-card">
        <h3>Starttelling</h3>
        <ul>${formatCheeseTotalsList(startTotals)}</ul>
      </article>
      <article class="stock-card">
        <h3>Aanvullingen</h3>
        <ul>${supplementsHtml}</ul>
      </article>
      <article class="stock-card">
        <h3>Eindtelling</h3>
        <ul>${formatCheeseTotalsList(endTotals)}</ul>
      </article>
      <article class="stock-card">
        <h3>Verkoopresultaat</h3>
        <p class="muted">${escapeHtml(categoryNote)}</p>
        <ul class="product-list">${productsHtml}</ul>
      </article>
    </section>
  `;
}

function renderOmzet(state) {
  const grouped = groupOmzetByDate(state.omzetEntries);
  if (!grouped.length) {
    return '<p class="muted">Nog geen dagomzet geregistreerd.</p>';
  }
  const sections = grouped.map(group => {
    const rows = group.entries.map(entry => `
      <tr>
        <td>${entry.debtor ? 'Ja' : 'Nee'}</td>
        <td class="right">${formatCurrencyValue(entry.eur, 'EUR')}</td>
        <td class="right">${formatCurrencyValue(entry.usd, 'USD')}</td>
        <td>${escapeHtml(entry.note || '')}</td>
      </tr>
    `).join('');
    return `
      <section class="omzet-day">
        <header>
          <h4>${escapeHtml(group.dateLabel)}</h4>
          <span>${escapeHtml(formatCurrencyPair(group.totalEUR, group.totalUSD))}</span>
        </header>
        <table class="tbl">
          <thead><tr><th>Debiteur</th><th>EUR</th><th>USD</th><th>Notitie</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `;
  }).join('');
  return `<div class="omzet-list">${sections}</div>`;
}

function renderKosten(state) {
  const { metrics, extraCosts, event } = state;
  const closed = isClosed(event);
  const extraTotal = extraCosts.total;
  const cheesePending = metrics.cheeseCostSource === 'pending';
  const cheeseRowLabel = metrics.cheeseCostSource === 'invoice'
    ? 'Kostprijs kaas (facturen)'
    : cheesePending
      ? 'Kostprijs kaas (nog te bepalen)'
      : 'Kostprijs kaas';
  const cheeseRowValue = cheesePending
    ? '—'
    : formatCurrencyValue(metrics.cheeseCostEUR, 'EUR');
  const indicativeRow = metrics.cheeseCostSource === 'invoice'
    ? `<div class="row sub muted"><span>Indicatieve kostprijs (tellingen)</span><strong>${formatCurrencyValue(metrics.cheeseCostIndicativeEUR, 'EUR')}</strong></div>`
    : cheesePending
      ? '<div class="row sub muted"><span>Berekend na eindtelling</span><strong>—</strong></div>'
      : '';
  const knownCheeseCost = cheesePending ? 0 : metrics.cheeseCostEUR;
  const fixedTotalLabel = cheesePending
    ? 'Totaal vaste kosten (excl. kaaskosten)'
    : 'Totaal vaste kosten';
  const fixedTotalValue = formatCurrencyValue(knownCheeseCost + metrics.commissionEUR + metrics.stageldEUR, 'EUR');
  const overallLabel = cheesePending
    ? 'Totaal kosten (excl. kaaskosten)'
    : 'Totaal kosten';
  const overallValue = formatCurrencyValue(knownCheeseCost + metrics.commissionEUR + metrics.stageldEUR + extraTotal, 'EUR');
  const extraSections = Object.entries(extraCosts.byCategory).map(([cat, items]) => {
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    const list = items.length
      ? items.map(item => `
          <div class="kost-sub" data-kost-id="${item.id}">
            <em>${formatCurrencyValue(item.amount, 'EUR')}</em>
            ${item.comment ? `<span class="comment">${escapeHtml(item.comment)}</span>` : ''}
            ${closed ? '' : `<button class="x kost-remove" data-id="${item.id}" title="Verwijderen">×</button>`}
          </div>
        `).join('')
      : '<div class="kost-sub muted">Geen kosten</div>';
    return `
      <div class="cost-box">
        <h3>${escapeHtml(cat)} <span class="sum">${formatCurrencyValue(total, 'EUR')}</span></h3>
        ${list}
      </div>
    `;
  }).join('');

  return `
    <section class="cost-grid">
      <div class="cost-col">
        <div class="cost-box">
          <h3>Vaste kosten</h3>
          <div class="row"><span>${escapeHtml(cheeseRowLabel)}</span><strong>${escapeHtml(cheeseRowValue)}</strong></div>
          ${indicativeRow}
          <div class="row"><span>Commissie</span><strong>${formatCurrencyValue(metrics.commissionEUR, 'EUR')}</strong></div>
          <div class="row"><span>Stageld</span><strong>${formatCurrencyValue(metrics.stageldEUR, 'EUR')}</strong></div>
          <div class="row total"><span>${escapeHtml(fixedTotalLabel)}</span><strong>${fixedTotalValue}</strong></div>
        </div>
      </div>
      <div class="cost-col">${extraSections}</div>
      <div class="cost-col">
        <div class="cost-box total-box">
          <h3>Totaal</h3>
          <div class="row"><span>Extra kosten</span><strong>${formatCurrencyValue(extraTotal, 'EUR')}</strong></div>
          <div class="row total"><span>${escapeHtml(overallLabel)}</span><strong>${overallValue}</strong></div>
        </div>
      </div>
    </section>
    ${closed ? '' : '<div class="cost-actions"><button class="btn" id="ed-add-kost">+ Kost toevoegen</button></div>'}
  `;
}

function renderFooter(state) {
  return `<footer class="ed-foot"><span class="muted">Laatst bijgewerkt: ${new Date().toLocaleString('nl-NL')}</span></footer>`;
}

function bindHeader(modal, state) {
  modal.body.querySelector('#ed-csv')?.addEventListener('click', () => showAlert('CSV-export volgt later.', 'info'));
  modal.body.querySelector('#ed-pdf')?.addEventListener('click', () => showAlert('PDF-export volgt later.', 'info'));
  modal.body.querySelector('#ed-afronden')?.addEventListener('click', () => showAlert('Afronden volgt later.', 'info'));
}

function bindTabs(modal, state) {
  modal.body.querySelectorAll('.ed-tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      renderAll(modal, state);
    });
  });
}

function bindEventSettings(modal, state) {
  const form = modal.body.querySelector('#ed-settings-form');
  if (!form) return;
  const saveBtn = form.querySelector('#ed-settings-save');
  const resetBtn = form.querySelector('#ed-settings-reset');

  resetBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    renderAll(modal, state);
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (saveBtn?.dataset.busy === 'true') return;

    const commissionInput = form.querySelector('input[name="commission"]');
    const stageldInput = form.querySelector('input[name="stageld"]');
    const goalEurInput = form.querySelector('input[name="goalEur"]');
    const goalUsdInput = form.querySelector('input[name="goalUsd"]');

    const commission = parseDecimalStrict(commissionInput?.value, { defaultValue: 0 });
    if (Number.isNaN(commission)) {
      showAlert('Ongeldig commissiepercentage.', 'warning');
      commissionInput?.focus();
      return;
    }
    const stageld = parseDecimalStrict(stageldInput?.value, { defaultValue: 0 });
    if (Number.isNaN(stageld)) {
      showAlert('Ongeldige stageldwaarde.', 'warning');
      stageldInput?.focus();
      return;
    }
    const goalEur = parseDecimalStrict(goalEurInput?.value, { defaultValue: null });
    if (Number.isNaN(goalEur)) {
      showAlert('Doelstelling (EUR) is ongeldig.', 'warning');
      goalEurInput?.focus();
      return;
    }
    const goalUsd = parseDecimalStrict(goalUsdInput?.value, { defaultValue: null });
    if (Number.isNaN(goalUsd)) {
      showAlert('Doelstelling (USD) is ongeldig.', 'warning');
      goalUsdInput?.focus();
      return;
    }

    const normalizedCommission = roundToCents(Math.max(0, commission));
    const normalizedStageld = roundToCents(Math.max(0, stageld));
    const normalizedGoalEur = goalEur == null ? null : roundToCents(goalEur);
    const normalizedGoalUsd = goalUsd == null ? null : roundToCents(goalUsd);

    if (saveBtn) {
      saveBtn.dataset.busy = 'true';
      saveBtn.setAttribute('disabled', 'disabled');
    }

    const original = {
      commissie: state.event.commissie,
      stageld: state.event.stageld,
      planning: state.event.planning ? JSON.parse(JSON.stringify(state.event.planning)) : null,
      hadPlanning: Object.prototype.hasOwnProperty.call(state.event, 'planning')
    };

    try {
      state.event.commissie = normalizedCommission;
      state.event.stageld = normalizedStageld;

      if (normalizedGoalEur != null || normalizedGoalUsd != null) {
        if (!state.event.planning || typeof state.event.planning !== 'object') {
          state.event.planning = {};
        }
        const expected = { ...(state.event.planning.expectedTurnover || {}) };
        if (normalizedGoalEur != null) {
          expected.eur = normalizedGoalEur;
        } else {
          delete expected.eur;
        }
        if (normalizedGoalUsd != null) {
          expected.usd = normalizedGoalUsd;
        } else {
          delete expected.usd;
        }
        if (normalizedGoalUsd != null && normalizedGoalEur == null) {
          expected.currency = 'usd';
        } else if (normalizedGoalEur != null) {
          expected.currency = 'eur';
        } else {
          delete expected.currency;
        }
        if (Object.keys(expected).length) {
          state.event.planning.expectedTurnover = expected;
        } else {
          delete state.event.planning.expectedTurnover;
        }
      } else if (state.event.planning && state.event.planning.expectedTurnover) {
        delete state.event.planning.expectedTurnover;
      }

      if (state.event.planning && typeof state.event.planning === 'object' && !Object.keys(state.event.planning).length) {
        delete state.event.planning;
      }

      const ok = await saveEvent(state.event.id);
      if (ok === false) throw new Error('save-failed');

      state.metrics = computeEventFinancials(state.event);
      state.omzetTotals = calculateOmzetTotals(state.event, 'EUR', null);
      state.extraCosts = groupExtraCosts(state.event);
      state.invoice = resolveInvoiceSettings(state.event, state.metrics);

      renderAll(modal, state);
      showAlert('Eventdetails opgeslagen.', 'success');
    } catch (err) {
      console.error('[Eventdetails] Opslaan van instellingen mislukt', err);
      state.event.commissie = original.commissie;
      state.event.stageld = original.stageld;
      if (original.hadPlanning) {
        state.event.planning = original.planning ? JSON.parse(JSON.stringify(original.planning)) : original.planning;
      } else {
        delete state.event.planning;
      }
      showAlert('Opslaan van eventinstellingen mislukt.', 'error');
    } finally {
      if (saveBtn) {
        delete saveBtn.dataset.busy;
        saveBtn.removeAttribute('disabled');
      }
    }
  });
}

function bindInvoiceControls(modal, state) {
  modal.body.querySelector('[data-open-invoice]')?.addEventListener('click', () => {
    openInvoiceModal(state, modal);
  });
}

function bindKostenActions(modal, state) {
  modal.body.querySelector('#ed-add-kost')?.addEventListener('click', () => openExtraKostModal(state, modal));
  modal.body.querySelectorAll('.kost-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeExtraKost(state, btn.dataset.id, modal);
    });
  });
}

async function openInvoiceModal(state, parentModal) {
  const m = mountModal('Factuur controleren');
  const invoice = state.invoice || {};
  const metricsExpected = Number.isFinite(state.metrics?.invoice?.expectedEUR)
    ? state.metrics.invoice.expectedEUR
    : Number.isFinite(state.metrics?.totalRevenueEUR)
      ? roundAmount(Math.max(0, (state.metrics.totalRevenueEUR || 0) - (state.metrics.commissionEUR || 0)))
      : null;
  const expectedEUR = Number.isFinite(invoice.expectedEUR)
    ? invoice.expectedEUR
    : Number.isFinite(metricsExpected)
      ? metricsExpected
      : 0;
  m.body.innerHTML = `
    <div class="form-grid">
      <label class="checkbox-row">
        <input id="invDebtor" type="checkbox" ${invoice.isDebtor ? 'checked' : ''}>
        <span>Event verwerken als debiteur</span>
      </label>
      <label>Definitief bedrag (EUR)
        <input id="invAmountEur" type="number" step="0.01" inputmode="decimal" value="${invoice.finalEUR != null ? invoice.finalEUR : expectedEUR}" placeholder="0,00">
      </label>
      <label>Definitief bedrag (USD)
        <input id="invAmountUsd" type="number" step="0.01" inputmode="decimal" value="${invoice.finalUSD != null ? invoice.finalUSD : ''}" placeholder="0,00">
      </label>
      <label>Factuurnummer
        <input id="invNumber" type="text" maxlength="40" value="${invoice.invoiceNumber ? escapeHtml(invoice.invoiceNumber) : ''}" placeholder="Factuurnummer">
      </label>
      <label>Status
        <select id="invStatus">
          <option value="OPEN" ${invoice.status === 'OPEN' ? 'selected' : ''}>Openstaand</option>
          <option value="PENDING" ${invoice.status === 'PENDING' ? 'selected' : ''}>Te controleren</option>
          <option value="PAID" ${invoice.status === 'PAID' ? 'selected' : ''}>Betaald</option>
        </select>
      </label>
      <label>Notitie
        <textarea id="invNote" rows="3" maxlength="180" placeholder="Opmerking">${invoice.note ? escapeHtml(invoice.note) : ''}</textarea>
      </label>
      <p class="muted">Verwachte factuur: ${escapeHtml(formatCurrencyValue(expectedEUR, 'EUR'))}</p>
      <div class="right">
        <button class="btn ghost" id="invCancel">Annuleren</button>
        <button class="btn" id="invSave">Opslaan</button>
      </div>
    </div>
  `;

  const cancelBtn = m.body.querySelector('#invCancel');
  const saveBtn = m.body.querySelector('#invSave');
  const amountInput = m.body.querySelector('#invAmountEur');
  const usdInput = m.body.querySelector('#invAmountUsd');
  cancelBtn?.addEventListener('click', m.close);
  saveBtn?.addEventListener('click', async () => {
    if (saveBtn.dataset.busy === 'true') return;
    const isDebtor = m.body.querySelector('#invDebtor')?.checked || false;
    const amountStr = amountInput?.value ? amountInput.value.replace(',', '.') : '';
    const usdStr = usdInput?.value ? usdInput.value.replace(',', '.') : '';
    const finalEUR = amountStr ? Number.parseFloat(amountStr) : null;
    const finalUSD = usdStr ? Number.parseFloat(usdStr) : null;
    const invoiceNumber = (m.body.querySelector('#invNumber')?.value || '').trim();
    const status = (m.body.querySelector('#invStatus')?.value || 'OPEN').toUpperCase();
    const note = (m.body.querySelector('#invNote')?.value || '').trim();

    if (isDebtor && (!Number.isFinite(finalEUR) || finalEUR <= 0)) {
      showAlert('⚠️ Vul een definitief bedrag (EUR) in voor debiteurenfactuur.', 'warning');
      amountInput?.focus();
      return;
    }

    saveBtn.dataset.busy = 'true';
    saveBtn.setAttribute('disabled', 'disabled');

    try {
      if (!state.event.facturatie || typeof state.event.facturatie !== 'object') {
        state.event.facturatie = {};
      }
      state.event.facturatie.debiteur = isDebtor;
      state.event.facturatie.factuurNummer = invoiceNumber;
      state.event.facturatie.status = status;
      state.event.facturatie.opmerking = note;
      state.event.facturatie.gecontroleerdOp = new Date().toISOString();
      state.event.facturatie.definitief = {
        eur: Number.isFinite(finalEUR) ? Math.round(finalEUR * 100) / 100 : null,
        usd: Number.isFinite(finalUSD) ? Math.round(finalUSD * 100) / 100 : null
      };
      state.event.debiteur = isDebtor;
      state.event.debtor = isDebtor;
      state.event.isDebtor = isDebtor;

      const saved = await saveEvent(state.event.id);
      if (!saved) {
        throw new Error('Opslaan van evenement mislukt.');
      }

      if (isDebtor && Number.isFinite(finalEUR) && finalEUR > 0) {
        try {
          await recordEventInvoiceLedgerEntry(state.event.id, {
            amount: finalEUR,
            currency: 'EUR',
            invoiceNumber,
            status,
            note,
            expectedEUR,
            checkedAt: state.event.facturatie.gecontroleerdOp
          });
        } catch (ledgerErr) {
          console.warn('[Eventdetails] Factuurboekingsregel mislukt:', ledgerErr);
        }
      }

      state.metrics = computeEventFinancials(state.event);
      state.invoice = resolveInvoiceSettings(state.event, state.metrics);
      showAlert('✅ Factuur bijgewerkt.', 'success');
      m.close();
      renderAll(parentModal, state);
    } catch (err) {
      console.error('[Eventdetails] Factuur opslaan mislukt:', err);
      showAlert('❌ Opslaan van factuurgegevens mislukt.', 'error');
    } finally {
      saveBtn.dataset.busy = 'false';
      saveBtn.removeAttribute('disabled');
    }
  });
}

async function openExtraKostModal(state, parentModal) {
  const m = mountModal('Kost toevoegen');
  m.body.innerHTML = `
    <div class="form-grid">
      <label>Soort
        <select id="kostType">
          <option>Diesel</option>
          <option>Slapen</option>
          <option>Eten</option>
          <option>Overige</option>
        </select>
      </label>
      <label>Bedrag (EUR)
        <input id="kostBedrag" type="number" step="0.01" inputmode="decimal" placeholder="0.00">
      </label>
      <label class="comment-row">Comment
        <input id="kostComment" type="text" placeholder="Optioneel">
      </label>
      <div class="right">
        <button class="btn ghost" id="kostCancel">Annuleren</button>
        <button class="btn" id="kostSave">Opslaan</button>
      </div>
    </div>
  `;
  m.body.querySelector('#kostCancel')?.addEventListener('click', m.close);
  m.body.querySelector('#kostSave')?.addEventListener('click', async () => {
    const type = m.body.querySelector('#kostType').value;
    const bedrag = parseFloat(m.body.querySelector('#kostBedrag').value);
    const comment = (m.body.querySelector('#kostComment').value || '').trim();
    if (!type || isNaN(bedrag)) {
      showAlert('⚠️ Vul soort en bedrag in', 'warning');
      return;
    }
    await addExtraKost(state, { soort: type, bedrag, comment: comment || undefined });
    m.close();
    renderAll(parentModal, state);
  });
}

async function addExtraKost(state, kost) {
  const id = Date.now().toString(36) + Math.random().toString(16).slice(2);
  const entry = { id, timestamp: new Date().toISOString(), ...kost };
  state.event.extraKosten = Array.isArray(state.event.extraKosten) ? state.event.extraKosten : [];
  state.event.extraKosten.push(entry);
  await saveEvent(state.event.id);
  try {
    await recordExtraCostLedgerEntry(state.event.id, entry);
  } catch (err) {
    console.warn('[Eventdetails] Ledger entry voor extra kost mislukt:', err);
  }
  state.metrics = computeEventFinancials(state.event);
  state.extraCosts = groupExtraCosts(state.event);
}

async function removeExtraKost(state, kostId, modal) {
  if (!confirm('Verwijder kost?')) return;
  state.event.extraKosten = (state.event.extraKosten || []).filter(k => k.id !== kostId);
  await saveEvent(state.event.id);
  try {
    await deleteExtraCostLedgerEntry(state.event.id, kostId);
  } catch (err) {
    console.warn('[Eventdetails] Verwijderen ledger entry extra kost mislukt:', err);
  }
  state.metrics = computeEventFinancials(state.event);
  state.extraCosts = groupExtraCosts(state.event);
  renderAll(modal, state);
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

function normalizeOmzetEntries(list) {
  const entries = Array.isArray(list) ? list : [];
  return entries.map(entry => {
    const date = normalizeOmzetDate(entry.date || entry.datum || entry.dagDatum || entry.dag);
    const debtor = resolveEntryDebtorFlag(entry);
    return {
      id: entry.id || entry.entryId || Date.now().toString(36),
      date,
      dateLabel: formatOmzetDate(date),
      eur: toSafeNumber(entry.eur ?? entry.prijs_eur),
      usd: toSafeNumber(entry.usd ?? entry.prijs_usd),
      paymentMethod: (entry.paymentMethod || (debtor ? 'DEBTOR' : 'DIRECT')).toString().toUpperCase(),
      debtor,
      note: entry.note || entry.comment || '',
      raw: { ...entry }
    };
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function groupOmzetByDate(entries) {
  const groups = new Map();
  entries.forEach(entry => {
    const key = entry.date || 'onbekend';
    if (!groups.has(key)) {
      groups.set(key, { date: key, dateLabel: formatOmzetDate(key), entries: [], totalEUR: 0, totalUSD: 0 });
    }
    const bucket = groups.get(key);
    bucket.entries.push(entry);
    bucket.totalEUR += entry.eur;
    bucket.totalUSD += entry.usd;
  });
  return Array.from(groups.values()).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function groupExtraCosts(event) {
  const items = Array.isArray(event.extraKosten) ? event.extraKosten : [];
  const byCategory = { Diesel: [], Slapen: [], Eten: [], Overige: [] };
  items.forEach(entry => {
    const key = (entry.soort || 'Overige').trim();
    const amount = toSafeNumber(entry.bedrag ?? entry.amount);
    const normalized = {
      id: entry.id || Date.now().toString(36),
      amount,
      comment: entry.comment || entry.notitie || '',
      soort: key
    };
    const bucket = byCategory[key] || byCategory.Overige;
    bucket.push(normalized);
  });
  return {
    byCategory,
    total: items.reduce((sum, item) => sum + toSafeNumber(item.bedrag ?? item.amount), 0)
  };
}

function buildOmzetWarning(metrics) {
  if (!metrics) return '';
  const notes = [];
  if (!metrics.cheeseMetricsReady) {
    notes.push('Nog geen eindtelling opgeslagen; kaaskosten en kaasomzet volgen zodra begin- en eindtelling bekend zijn.');
  }
  if (metrics.missingTodayOmzet) {
    notes.push('Dagomzet voor vandaag ontbreekt nog.');
  } else if (metrics.missingOmzetDays > 0) {
    notes.push(`${metrics.missingOmzetDays} dagomzetregistratie(s) ontbreken.`);
  } else if (!metrics.hasOmzetEntries) {
    notes.push('Nog geen dagomzet vastgelegd.');
  }
  return notes.join(' ');
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

function toCheeseTotals(raw) {
  if (!raw || typeof raw !== 'object') return { BG: 0, ROOK: 0, GEIT: 0 };
  const source = raw.categories && typeof raw.categories === 'object' ? raw.categories : raw;
  return {
    BG: toSafeNumber(source?.BG ?? source?.bg),
    ROOK: toSafeNumber(source?.ROOK ?? source?.rook),
    GEIT: toSafeNumber(source?.GEIT ?? source?.geit)
  };
}

function resolvePlanningTargets(event) {
  const planning = event?.planning || {};
  const expected = planning.expectedTurnover || {};
  const eur = firstFinite([
    expected.eur,
    expected.EUR,
    planning.expectedTurnoverEUR,
    planning.turnoverEstimate,
    planning.expectedRevenue
  ]);
  const usd = firstFinite([
    expected.usd,
    expected.USD,
    planning.expectedTurnoverUSD
  ]);
  return { eur, usd };
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
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  const str = String(raw).trim();
  if (!str) return null;
  const normalized = Number(str.replace(',', '.'));
  return Number.isFinite(normalized) ? normalized : null;
}

function formatNumberInput(value, fractionDigits = 2) {
  if (value == null) return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  if (fractionDigits == null) return String(num);
  const fixed = num.toFixed(fractionDigits);
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.0+$/, '').replace(/\.$/, '');
}

function parseDecimalStrict(raw, { defaultValue = null, allowNegative = false } = {}) {
  if (raw == null) return defaultValue;
  const str = String(raw).trim();
  if (!str) return defaultValue;
  const normalized = Number(str.replace(',', '.'));
  if (!Number.isFinite(normalized)) return Number.NaN;
  if (!allowNegative && normalized < 0) return Number.NaN;
  return normalized;
}

function roundToCents(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function formatCheeseTotalsList(totals) {
  return `
    <li>BG: <strong>${formatCheeseUnits(totals.BG)}</strong></li>
    <li>ROOK: <strong>${formatCheeseUnits(totals.ROOK)}</strong></li>
    <li>GEIT: <strong>${formatCheeseUnits(totals.GEIT)}</strong></li>
  `;
}

function formatCheeseTotals(entry) {
  const totals = toCheeseTotals(entry);
  return `BG ${totals.BG} • ROOK ${totals.ROOK} • GEIT ${totals.GEIT}`;
}

function formatCheeseUnits(units) {
  const amount = Math.max(0, Math.round(toSafeNumber(units)));
  return `${amount} stuks`;
}

function toSafeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
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

function mountModal(titleText) {
  const overlay = document.createElement('div');
  overlay.className = 'ed-overlay';
  const box = document.createElement('div');
  box.className = 'ed-box';
  const head = document.createElement('div');
  head.className = 'modal-head';
  head.innerHTML = `<strong>${escapeHtml(titleText)}</strong><button class="modal-close" aria-label="Sluiten">✕</button>`;
  const body = document.createElement('div');
  body.className = 'modal-body ed-body';
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
  head.querySelector('.modal-close')?.addEventListener('click', close);

  return { root: box, body, close };
}

function ensureStyles() {
  if (document.getElementById('ed-styles')) return;
  const css = `
  .ed-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);display:grid;place-items:center;z-index:10000}
  .ed-box{max-width:1100px;width:min(96vw,1100px);max-height:95vh;overflow:auto;border-radius:14px;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.25)}
  .modal-head{display:flex;justify-content:space-between;align-items:center;padding:.7rem 1rem;border-bottom:1px solid #eee;background:#fff;position:sticky;top:0;z-index:2}
  .modal-close{background:#eee;border:none;border-radius:50%;width:32px;height:32px;font-weight:900;cursor:pointer}
  .modal-body{padding:1rem}
  .ed-head{display:flex;align-items:center;justify-content:space-between;margin:.3rem 0 1rem}
  .ed-title{display:flex;align-items:center;gap:.6rem}
  .ed-title h2{margin:0;font-size:1.35rem;color:#1F6D1C}
  .ed-range{margin:-.6rem 0 1.2rem;color:#4a5c4a;font-weight:600}
  .badge{display:inline-flex;align-items:center;padding:.15rem .55rem;border-radius:999px;font-size:.75rem;font-weight:800;color:#fff}
  .badge.open{background:#2A9626}.badge.closed{background:#777}
  .btn{border-radius:999px;border:1px solid #1F6D1C;background:#2A9626;color:#fff;padding:.4rem .75rem;font-weight:800;cursor:pointer}
  .btn.ghost{background:#fff;color:#1F6D1C;border-color:#1F6D1C}
  .btn.danger{background:#C62828;border-color:#C62828}
  .ed-tabs{display:flex;gap:.5rem;margin:.2rem 0 .8rem}
  .ed-tabs .tab{border-radius:10px;border:2px solid #1F6D1C;background:#fff;color:#1F6D1C;font-weight:900;padding:.35rem .7rem;cursor:pointer;opacity:.7}
  .ed-tabs .tab.active{background:#2A9626;color:#fff;opacity:1}
  .ed-hero .kpi-card{border:1px solid #eee;border-radius:12px;padding:.8rem;background:#fff;margin-bottom:.6rem}
  .ed-hero .kpi-card.accent{background:linear-gradient(180deg,#FFF8E1,#FFFFFF);border-color:#FFE082}
  .kpi-card .kpi-label{font-weight:700;color:#333}
  .kpi-card .kpi-sublabel{font-size:.85rem;color:#666;margin-top:.2rem}
  .kpi-card .kpi-value{font-size:1.8rem;font-weight:900;color:#1F6D1C}
  .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.6rem}
  .kpi{border:1px solid #eee;border-radius:10px;padding:.6rem;background:#fff}
  .kpi.neg .val{color:#C62828}
  .kpi.pos .val{color:#1F6D1C}
  .kpi .lbl{font-size:.8rem;color:#666}.kpi .val{font-weight:800;font-size:1.1rem}
  .hint{background:#f4faf3;border:1px dashed #bfe6ba;color:#194a1f;padding:.5rem .6rem;border-radius:10px;margin-top:.6rem}
  .ed-invoice{margin:1rem 0}
  .invoice-card{border:1px solid #eee;border-radius:12px;padding:1rem;background:#fff;display:flex;flex-direction:column;gap:.6rem}
  .invoice-card header{display:flex;justify-content:space-between;align-items:center}
  .invoice-card .status{padding:.25rem .65rem;border-radius:999px;font-size:.75rem;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.02em}
  .invoice-card .status.open{background:#1F6D1C}
  .invoice-card .status.pending{background:#FFB300;color:#4a3200}
  .invoice-card .status.paid{background:#2A9626}
  .invoice-card .status.draft{background:#607D8B}
  .invoice-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.6rem}
  .invoice-grid dt{margin:0;font-size:.7rem;text-transform:uppercase;color:#666;font-weight:700}
  .invoice-grid dd{margin:.15rem 0 0;font-weight:800;color:#1F6D1C}
  .invoice-grid dd.pos{color:#1F6D1C}
  .invoice-grid dd.neg{color:#C62828}
  .invoice-actions{text-align:right}
  .stock-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.75rem}
  .stock-card{border:1px solid #eee;border-radius:12px;padding:.7rem;background:#fff}
  .stock-card h3{margin:.1rem 0 .5rem;font-size:1rem;color:#1F6D1C}
  .stock-card ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.35rem}
  .stock-card ul.product-list li{display:flex;justify-content:space-between;gap:.5rem}
  .stock-card .muted{color:#666;font-style:italic}
  .omzet-list{display:flex;flex-direction:column;gap:.75rem}
  .omzet-day{border:1px solid #eee;border-radius:12px;background:#fff}
  .omzet-day header{display:flex;justify-content:space-between;align-items:center;padding:.6rem .75rem;border-bottom:1px solid #f1f1f1;font-weight:700;color:#2A9626}
  .tbl{width:100%;border-collapse:collapse}
  .tbl th,.tbl td{border-bottom:1px solid #f1f1f1;padding:.45rem .6rem;text-align:left}
  .tbl td.right{text-align:right}
  .muted{color:#777}
  .cost-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.75rem;margin-top:.6rem}
  .cost-box{border:1px solid #eee;border-radius:12px;padding:.7rem;background:#fff}
  .cost-box h3{margin:.1rem 0 .5rem;font-size:1rem;display:flex;justify-content:space-between;align-items:center}
  .cost-box .row{display:flex;justify-content:space-between;padding:.2rem 0;border-bottom:1px dotted #f0f0f0}
  .cost-box .row.total{font-weight:900}
  .kost-sub{display:flex;align-items:center;gap:.4rem;margin-left:.4rem;padding:.2rem 0}
  .kost-sub .comment{color:#555}
  .kost-sub .x{background:none;border:none;color:#C62828;font-weight:900;cursor:pointer}
  .cost-actions{margin-top:.8rem;text-align:right}
  .ed-settings{margin:1.2rem 0;padding:1rem;border:1px solid #eee;border-radius:12px;background:#fff}
  .ed-settings h3{margin:0 0 .75rem;font-size:1.05rem;color:#1F6D1C}
  .ed-settings form{display:flex;flex-direction:column;gap:.75rem}
  .ed-settings .settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.6rem}
  .ed-settings label{display:flex;flex-direction:column;gap:.25rem;font-weight:700;color:#2f3b2f}
  .ed-settings input{padding:.45rem .55rem;border:1px solid #ddd;border-radius:8px;font-weight:600}
  .ed-settings .settings-actions{display:flex;justify-content:flex-end;gap:.5rem}
  .form-grid{display:flex;flex-direction:column;gap:.6rem}
  .form-grid label{display:flex;flex-direction:column;gap:.25rem;font-weight:700}
  .form-grid input,.form-grid select{padding:.45rem .55rem;border:1px solid #ddd;border-radius:8px}
  .form-grid textarea{padding:.45rem .55rem;border:1px solid #ddd;border-radius:8px;font-family:inherit}
  .checkbox-row{display:flex;align-items:center;gap:.5rem;padding:.4rem .55rem;border:1px solid #ddd;border-radius:8px;background:#f8f8f8;font-weight:600}
  .form-grid .right{display:flex;justify-content:flex-end;gap:.45rem}
  .ed-foot{display:flex;justify-content:flex-end;margin-top:.8rem}
  .ed-skel{height:140px;border-radius:12px;background:linear-gradient(90deg,#eee,#f7f7f7,#eee);background-size:200% 100%;animation:sk 1.2s infinite}
  @keyframes sk{0%{background-position:200% 0}100%{background-position:-200% 0}}
  @media (max-width: 980px){ .cost-grid{grid-template-columns:1fr} }
  `;
  const style = document.createElement('style');
  style.id = 'ed-styles';
  style.textContent = css;
  document.head.appendChild(style);
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

function isClosed(ev) {
  const state = String(ev?.state || '').toLowerCase();
  return ev?.afgerond === true || state === 'closed' || state === 'afgesloten' || state === 'completed';
}