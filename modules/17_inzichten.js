// 17_inzichten.js — Inzichten & Vooruitzicht (Charts + Forecast)
// Vereist: Chart.js (window.Chart), html2canvas, jsPDF (UMD)
// Exporteert: openInzichtenModal()

import { db } from './3_data.js';
import {
  showAlert,
  closeAllModals,
  computeEventFinancials,
  collectOmzetEntries,
  formatCurrencyValue,
  formatCurrencyPair
} from './4_ui.js';

function isClosed(ev) {
  const state = String(ev?.state || ev?.status || '').toLowerCase();
  return ev?.afgerond === true || state === 'closed' || state === 'afgesloten';
}

const DEBTOR_KEYS = ['DIRECT', 'DEBTOR'];

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeCheeseTypeLocal(type) {
  if (!type) return null;
  const upper = String(type).trim().toUpperCase();
  if (upper === 'BG' || upper === 'ROOK' || upper === 'GEIT') return upper;
  return null;
}

function inferCheeseTypeFromNameLocal(name) {
  if (!name) return null;
  const upper = String(name).trim().toUpperCase();
  if (upper.startsWith('BG')) return 'BG';
  if (upper.startsWith('ROOK')) return 'ROOK';
  if (upper.startsWith('GEIT')) return 'GEIT';
  return null;
}

function buildCatalogContext() {
  const catalog = Array.isArray(db?.producten) ? db.producten : [];
  const normalizeName = (value) => (value || '').toString().trim().toLowerCase();
  const index = new Map();
  const averages = {
    BG: { eur: 0, usd: 0, inkoop: 0, count: 0 },
    ROOK: { eur: 0, usd: 0, inkoop: 0, count: 0 },
    GEIT: { eur: 0, usd: 0, inkoop: 0, count: 0 }
  };

  catalog.forEach((product) => {
    const key = normalizeName(product?.naam);
    if (key) index.set(key, product);
    const type = normalizeCheeseTypeLocal(product?.type);
    if (type && averages[type]) {
      averages[type].eur += toNumber(product?.eur ?? product?.prijs_eur);
      averages[type].usd += toNumber(product?.usd ?? product?.prijs_usd);
      averages[type].inkoop += toNumber(product?.inkoop);
      averages[type].count += 1;
    }
  });

  const resolvedAverages = Object.fromEntries(
    Object.entries(averages).map(([type, data]) => {
      const count = data.count || 1;
      return [type, {
        eur: count ? data.eur / count : 0,
        usd: count ? data.usd / count : 0,
        inkoop: count ? data.inkoop / count : 0
      }];
    })
  );

  return {
    index,
    averages: resolvedAverages,
    normalizeName
  };
}

function resolveProductFinancials(name, context = null) {
  const ctx = context || buildCatalogContext();
  const key = ctx.normalizeName(name);
  const product = key ? ctx.index.get(key) : null;
  const type = normalizeCheeseTypeLocal(product?.type) || inferCheeseTypeFromNameLocal(name) || 'BG';
  const average = ctx.averages[type] || { eur: 0, usd: 0, inkoop: 0 };
  return {
    name: product?.naam || (typeof name === 'string' && name.trim() ? name : `Onbekend (${type})`),
    type,
    priceEUR: toNumber(product?.eur ?? product?.prijs_eur ?? average.eur),
    priceUSD: toNumber(product?.usd ?? product?.prijs_usd ?? average.usd),
    costEUR: toNumber(product?.inkoop ?? average.inkoop)
  };
}

function resolveDebtorKey(entry) {
  if (!entry || typeof entry !== 'object') return 'DIRECT';
  if (typeof entry.debtor === 'boolean') return entry.debtor ? 'DEBTOR' : 'DIRECT';
  if (typeof entry.debiteur === 'boolean') return entry.debiteur ? 'DEBTOR' : 'DIRECT';
  if (typeof entry.isDebtor === 'boolean') return entry.isDebtor ? 'DEBTOR' : 'DIRECT';
  const raw = entry.debtor ?? entry.debiteur ?? entry.isDebtor;
  if (typeof raw === 'string') {
    const clean = raw.trim().toLowerCase();
    if (['1', 'true', 'ja', 'j', 'yes', 'debiteur', 'debtor', 'invoice', 'factuur'].includes(clean)) return 'DEBTOR';
    if (['0', 'false', 'nee', 'n', 'no'].includes(clean)) return 'DIRECT';
  }
  const method = (entry.paymentMethod || entry.pm || '').toString().toUpperCase();
  if (DEBTOR_KEYS.includes(method)) return method;
  if (['DEBITEUR', 'INVOICE', 'FACTUUR', 'FACTUUR/DEBITEUR'].includes(method)) return 'DEBTOR';
  return 'DIRECT';
}

function resolveEventExchangeRate(ev) {
  const candidates = [
    ev?.omzet?.exchangeRate,
    ev?.exchangeRateEURperUSD,
    ev?.exchangeRate,
    ev?.meta?.exchangeRate
  ];
  for (const candidate of candidates) {
    const rate = Number(candidate);
    if (Number.isFinite(rate) && rate > 0) return rate;
  }
  return null;
}

function resolveEntryRate(entry, fallbackRate) {
  const rate = Number(entry?.exchangeRate);
  if (Number.isFinite(rate) && rate > 0) return rate;
  return fallbackRate;
}

function convertEntryToEUR(eurValue, usdValue, rate) {
  const eur = Number(eurValue);
  if (Number.isFinite(eur) && eur !== 0) return eur;
  const usd = Number(usdValue);
  if (Number.isFinite(usd)) {
    if (Number.isFinite(rate) && rate > 0) return usd * rate;
    return usd;
  }
  return Number.isFinite(eur) ? eur : 0;
}

function convertEntryToUSD(eurValue, usdValue, rate) {
  const usd = Number(usdValue);
  if (Number.isFinite(usd) && usd !== 0) return usd;
  const eur = Number(eurValue);
  if (Number.isFinite(eur)) {
    if (Number.isFinite(rate) && rate > 0) return eur / rate;
    return eur;
  }
  return Number.isFinite(usd) ? usd : 0;
}

function parseEntryDate(entry) {
  if (!entry) return null;
  const raw = entry.date || entry.datum || entry.dagDatum || entry.dag;
  if (!raw) return null;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return new Date(`${raw.trim()}T00:00:00`).getTime();
  }
  const parsed = new Date(raw);
  const ts = parsed.getTime();
  return Number.isFinite(ts) ? ts : null;
}

function toYMDStringLocal(tsOrDate) {
  if (tsOrDate == null) return '';
  const date = tsOrDate instanceof Date ? tsOrDate : new Date(tsOrDate);
  if (!Number.isFinite(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function openInzichtenModal() {
  injectStylesOnce();
  closeAllModals();

  const overlay = document.createElement('div');
  overlay.className = 'modal';
  const box = document.createElement('div');
  box.className = 'inz-modal';
  overlay.appendChild(box);

  const locs = [...new Set((db.evenementen||[]).map(e=>e.locatie).filter(Boolean))];
  const types = [...new Set((db.evenementen||[]).map(e=>e.type).filter(Boolean))];

  box.innerHTML = `
    <div class="inz-head">
      <h2>📈 Inzichten</h2>
      <div class="inz-head-actions">
        <button class="btn-amber" id="btnExportCSV">📁 CSV</button>
        <button class="btn-green" id="btnExportXLS">📊 Excel</button>
        <button class="btn-blue"  id="btnExportPDF">📄 PDF</button>
        <button class="btn-red"   id="btnClose">✕</button>
      </div>
    </div>

  <div class="inz-filters">
      <div class="row">
        <label>Event</label>
        <select id="fEvent">
          <option value="__ALL__">Alle events</option>
          ${(db.evenementen||[]).map(e=>`<option value="${e.id}">${esc(e.naam)} ${e.locatie?`— ${esc(e.locatie)}`:''}</option>`).join('')}
        </select>
      </div>
      <div class="row">
        <label>Locatie</label>
        <select id="fLoc">
          <option value="__ALL__">Alle locaties</option>
          ${locs.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('')}
        </select>
      </div>
      <div class="row">
        <label>Type</label>
        <select id="fType">
          <option value="__ALL__">Alle types</option>
          ${types.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}
        </select>
      </div>
      <div class="row">
        <label>Periode</label>
        <select id="fRange">
          <option value="7">Laatste 7 dagen</option>
          <option value="30" selected>Laatste 30 dagen</option>
          <option value="90">Laatste 90 dagen</option>
          <option value="365">Laatste 365 dagen</option>
          <option value="__ALL__">Alles</option>
        </select>
      </div>
      <div class="row">
        <label>Valuta‑weergave</label>
        <select id="fCurr">
          <option value="EUR" selected>EUR</option>
          <option value="USD">USD</option>
        </select>
      </div>
    </div>

    <div class="inz-tabs">
      <button class="tab active" data-tab="overzicht">Overzicht</button>
      <button class="tab" data-tab="producten">Producten</button>
      <button class="tab" data-tab="tijd">Tijd</button>
      <button class="tab" data-tab="boekhouding">Boekhouding</button>
      <button class="tab" data-tab="vooruitzicht">Vooruitzicht</button>
    </div>

    <div class="inz-content">
      <section id="tab-overzicht" class="tab-pane active">
        <div class="kpi-grid" id="kpiGrid"></div>
        <div class="mini-grid">
          <div class="panel mini" data-tab="tijd"><canvas id="miniTrend"></canvas></div>
          <div class="panel mini" data-tab="producten"><canvas id="miniProduct"></canvas></div>
          <div class="panel mini" data-tab="tijd"><canvas id="miniHour"></canvas></div>
          <div class="panel mini" data-tab="tijd"><canvas id="miniDay"></canvas></div>
        </div>
      </section>

      <section id="tab-producten" class="tab-pane">
        <div class="panel">
          <canvas id="chartOmzetVsKosten"></canvas>
        </div>
        <div class="panel">
          <div class="table-wrap">
            <table id="tblProducts">
              <thead>
                <tr>
                  <th>Product</th><th>Omzet (EUR)</th><th>Kosten (EUR)</th><th>Marge €</th><th>Marge %</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="tab-tijd" class="tab-pane">
        <div class="panel">
          <canvas id="chartPerUur"></canvas>
        </div>
        <div class="panel">
          <canvas id="chartPerDag"></canvas>
        </div>
      </section>

      <section id="tab-boekhouding" class="tab-pane">
        <div class="panel">
          <div class="kpi-grid" id="ledgerKpiGrid"></div>
        </div>
        <div class="panel">
          <canvas id="chartLedgerMonthly"></canvas>
        </div>
        <div class="panel">
          <canvas id="chartLedgerCategory"></canvas>
        </div>
        <div class="panel">
          <canvas id="chartLedgerAccount"></canvas>
        </div>
      </section>

      <section id="tab-vooruitzicht" class="tab-pane">
        <div class="panel">
          <div class="table-wrap">
            <table id="tblForecast">
              <thead>
                <tr>
                  <th>Event</th><th>Locatie</th><th>Type</th>
                  <th>Begroot omzet (EUR)</th><th>Begrote kosten (EUR)</th><th>Begrote winst (EUR)</th>
                </tr>
              </thead>
              <tbody></tbody>
              <tfoot>
                <tr>
                  <th colspan="3" style="text-align:right">TOTAAL</th>
                  <th id="fcOmzet">€0.00</th><th id="fcKosten">€0.00</th><th id="fcWinst">€0.00</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <div class="panel">
          <canvas id="chartForecastStack"></canvas>
        </div>
      </section>
    </div>
  `;

  document.body.appendChild(overlay);

  // events
  box.querySelector('#btnClose').onclick = closeAllModals;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeAllModals();
  });

  const selEvent = box.querySelector('#fEvent');
  const selLoc   = box.querySelector('#fLoc');
  const selType  = box.querySelector('#fType');
  const selRange = box.querySelector('#fRange');
  const selCurr  = box.querySelector('#fCurr');

  function activateTab(id){
    box.querySelectorAll('.inz-tabs .tab').forEach(x=>x.classList.remove('active'));
    box.querySelector(`.inz-tabs .tab[data-tab="${id}"]`)?.classList.add('active');
    box.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
    box.querySelector(`#tab-${id}`)?.classList.add('active');
    renderAll();
  }

  // tabs
  box.querySelectorAll('.inz-tabs .tab').forEach(b=>{
    b.onclick = () => activateTab(b.dataset.tab);
  });

  // mini chart clicks
  box.querySelectorAll('.mini-grid .panel').forEach(p=>{
    const t = p.dataset.tab;
    if (t) p.onclick = () => activateTab(t);
  });

  // filters
  [selEvent, selLoc, selType, selRange, selCurr].forEach(el => el.onchange = renderAll);

  // export
  box.querySelector('#btnExportCSV').onclick = () => exportCSVCurrent(selEvent.value, selRange.value, selLoc.value, selType.value);
  box.querySelector('#btnExportXLS').onclick = () => exportExcelCurrent(selEvent.value, selRange.value, selLoc.value, selType.value);
  box.querySelector('#btnExportPDF').onclick = () => exportPDF(box);

  // state
  let charts = {};

  // main render
  renderAll();

  async function renderAll() {
    const filter = {
      eventId: selEvent.value,
      locatie: selLoc.value,
      type:    selType.value,
      days:    selRange.value,
      curr:    selCurr.value
    };
    const insightsData = await loadSales(filter);
    renderKPIs(insightsData, filter, box.querySelector('#kpiGrid'));
    renderAccountingKPIs(insightsData.accounting, box.querySelector('#ledgerKpiGrid'));
    charts = renderMiniCharts(charts, insightsData);
    charts = drawOrUpdateCharts(charts, insightsData, filter);
    charts = drawAccountingCharts(charts, insightsData.accounting);
    renderProductsTable(insightsData, filter, box.querySelector('#tblProducts tbody'));
    renderForecast(insightsData, filter, box);
  }
}


function buildInlineInsightsMarkup(events, state) {
  const label = buildRangeLabel(state.days);
  const eventLabel = resolveEventLabel(state.eventId, events);
  return `
    <header class="insights-inline__header">
      <div>
        <h2>📈 Inzichten</h2>
        <p class="muted">Mobiele samenvatting van omzet, mix en boekhouding.</p>
      </div>
      <button type="button" class="btn-secondary" data-role="open-modal">Volledige analyse</button>
    </header>
    <div class="insights-inline__filters">
      <div class="chip-group" data-role="range-group" aria-label="Periode">
        <button type="button" class="chip" data-range="7">7 dagen</button>
        <button type="button" class="chip" data-range="30">30 dagen</button>
        <button type="button" class="chip" data-range="90">90 dagen</button>
        <button type="button" class="chip" data-range="__ALL__">Alles</button>
      </div>
      <label class="insights-inline__select">
        <span>Event</span>
        <select data-role="event" aria-label="Kies event">
          <option value="__ALL__">Alle evenementen</option>
          ${events.map(ev => `<option value="${esc(ev.id)}">${esc(ev.naam || ev.slug || ev.id)}</option>`).join('')}
        </select>
      </label>
      <p class="insights-inline__filters-note">${esc(eventLabel)} · ${esc(label)}</p>
    </div>
    <div class="insights-inline__loading" data-role="loading">Gegevens laden…</div>
    <section class="insights-inline__hero" data-role="hero" hidden></section>
    <div class="insights-inline__grid" data-role="grid" hidden>
      <section class="insights-inline__card" data-role="products">
        <header>
          <h3>Topproducten</h3>
          <span class="insights-inline__card-meta" data-role="product-meta"></span>
        </header>
        <ol class="insights-inline__list" data-role="product-list"></ol>
      </section>
      <section class="insights-inline__card" data-role="ledger">
        <header>
          <h3>Boekhouding</h3>
          <span class="insights-inline__card-meta" data-role="ledger-meta"></span>
        </header>
        <ul class="insights-inline__list" data-role="ledger-list"></ul>
      </section>
      <section class="insights-inline__card" data-role="timeline">
        <header>
          <h3>Omzettijdlijn</h3>
          <span class="insights-inline__card-meta" data-role="timeline-meta"></span>
        </header>
        <ul class="insights-inline__list" data-role="timeline-list"></ul>
      </section>
      <section class="insights-inline__card" data-role="coverage">
        <header>
          <h3>Registratiecheck</h3>
          <span class="insights-inline__card-meta" data-role="coverage-meta"></span>
        </header>
        <ul class="insights-inline__list" data-role="coverage-list"></ul>
      </section>
    </div>
  `;
}

function populateEventSelect(selectEl, events, activeId) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="__ALL__">Alle evenementen</option>' + events.map(ev => `<option value="${esc(ev.id)}">${esc(ev.naam || ev.slug || ev.id)}</option>`).join('');
  const value = activeId && events.some(ev => String(ev.id) === String(activeId)) ? activeId : '__ALL__';
  selectEl.value = value;
  if (selectEl.value !== value) {
    selectEl.value = '__ALL__';
  }
}

function setActiveRange(buttons, active) {
  buttons.forEach((btn) => {
    const isActive = btn.dataset.range === active;
    btn.classList.toggle('chip--active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function showLoadingState(loadingEl, heroEl, gridEl, isLoading, isError = false) {
  if (loadingEl) {
    loadingEl.hidden = !isLoading && !isError;
    loadingEl.classList.toggle('insights-inline__loading--error', Boolean(isError));
  }
  if (heroEl) heroEl.hidden = isLoading || isError;
  if (gridEl) gridEl.hidden = isLoading || isError;
}

function renderInlineHero(heroEl, insights, events, state) {
  if (!heroEl) return;
  const totals = insights?.totals || {};
  const revenueEUR = totals.revenue?.EUR || 0;
  const revenueUSD = totals.revenue?.USD || 0;
  const cheeseEUR = totals.cheeseRevenue?.EUR || 0;
  const netResultEUR = totals.netResultEUR || 0;
  const cheeseShare = revenueEUR > 0 ? Math.round((cheeseEUR / revenueEUR) * 100) : 0;
  const souvenirShare = revenueEUR > 0 ? Math.max(0, 100 - cheeseShare) : 0;
  const eventLabel = resolveEventLabel(state.eventId, events);
  const rangeLabel = buildRangeLabel(state.days);
  const omzetRegistraties = totals.dagOmzetCount || 0;

  heroEl.innerHTML = `
    <div class="insights-inline__hero-primary">
      <span class="insights-inline__eyebrow">${esc(eventLabel)} · ${esc(rangeLabel)}</span>
      <strong class="insights-inline__hero-value">${esc(formatCurrencyPair(revenueEUR, revenueUSD))}</strong>
      <p>Totale omzet</p>
    </div>
    <div class="insights-inline__hero-stats">
      <div class="insights-inline__stat">
        <span>Netto resultaat</span>
        <strong class="${netResultEUR < 0 ? 'negative' : 'positive'}">${esc(formatCurrencyValue(netResultEUR, 'EUR'))}</strong>
      </div>
      <div class="insights-inline__stat">
        <span>Kaas vs. overig</span>
        <strong>${cheeseShare}% kaas · ${souvenirShare}% overig</strong>
      </div>
      <div class="insights-inline__stat">
        <span>Registraties</span>
        <strong>${omzetRegistraties}</strong>
      </div>
    </div>
  `;
}

function renderInlineProducts(listEl, metaEl, insights) {
  if (!listEl || !metaEl) return;
  const products = Array.isArray(insights?.productSummaries) ? insights.productSummaries : [];
  const top = products.filter(item => (item?.units || 0) > 0).slice(0, 4);

  metaEl.textContent = products.length ? `${products.length} producten` : 'Nog geen producten';

  if (!top.length) {
    listEl.innerHTML = '<li class="insights-inline__empty">Nog geen verkopen geregistreerd.</li>';
    return;
  }

  listEl.innerHTML = top.map((item, index) => `
    <li>
      <span class="insights-inline__badge">${index + 1}</span>
      <div class="insights-inline__list-body">
        <strong>${esc(item.name)}</strong>
        <span>${formatUnits(item.units)} stuks · ${esc(formatCurrencyPair(item.revenueEUR, item.revenueUSD))}</span>
      </div>
    </li>
  `).join('');
}

function renderInlineLedger(listEl, metaEl, insights) {
  if (!listEl || !metaEl) return;
  const accounting = insights?.accounting || {};
  const totals = accounting.totals || { incomeEUR: 0, expenseEUR: 0, balanceEUR: 0 };
  const perCategory = Array.isArray(accounting.perCategory) ? accounting.perCategory : [];
  const topCategory = perCategory[0];

  metaEl.textContent = `Saldo ${formatCurrencyValue(totals.balanceEUR || 0, 'EUR')}`;

  const rows = [
    { label: 'Inkomsten', value: formatCurrencyValue(totals.incomeEUR || 0, 'EUR'), icon: '⬆️' },
    { label: 'Uitgaven', value: formatCurrencyValue(Math.abs(totals.expenseEUR || 0), 'EUR'), icon: '⬇️' },
    { label: 'Belangrijkste categorie', value: topCategory ? `${esc(topCategory.label)} · ${formatCurrencyValue(topCategory.balance, 'EUR')}` : 'Geen categorieën', icon: '🏷️' }
  ];

  listEl.innerHTML = rows.map(row => `
    <li>
      <span class="insights-inline__badge">${row.icon}</span>
      <div class="insights-inline__list-body">
        <strong>${row.label}</strong>
        <span>${esc(row.value)}</span>
      </div>
    </li>
  `).join('');
}

function renderInlineTimeline(listEl, metaEl, insights, state) {
  if (!listEl || !metaEl) return;
  const timeline = Array.isArray(insights?.timeline) ? insights.timeline.slice(-5).reverse() : [];
  if (!timeline.length) {
    metaEl.textContent = 'Geen registraties';
    listEl.innerHTML = '<li class="insights-inline__empty">Nog geen omzetregistraties voor deze periode.</li>';
    return;
  }

  const label = state.days === '__ALL__' ? 'Volledige historie' : `Laatste ${state.days} dagen`;
  metaEl.textContent = label;

  listEl.innerHTML = timeline.map((item) => `
    <li>
      <span class="insights-inline__badge">${esc(item.date)}</span>
      <div class="insights-inline__list-body">
        <strong>${esc(formatCurrencyPair(item.eur, item.usd))}</strong>
        <span>Omzetregistratie</span>
      </div>
    </li>
  `).join('');
}

function renderInlineCoverage(listEl, metaEl, insights, events) {
  if (!listEl || !metaEl) return;
  const coverage = Array.isArray(insights?.coverage) ? insights.coverage : [];
  const missing = coverage.filter(item => (item?.missing || 0) > 0);

  if (!coverage.length) {
    metaEl.textContent = 'Geen gegevens';
    listEl.innerHTML = '<li class="insights-inline__empty">Nog geen events geselecteerd.</li>';
    return;
  }

  if (!missing.length) {
    metaEl.textContent = 'Alles bijgewerkt';
    listEl.innerHTML = '<li class="insights-inline__empty">Alle dagomzet registraties zijn ingevoerd.</li>';
    return;
  }

  const totalMissing = missing.reduce((sum, item) => sum + (item.missing || 0), 0);
  metaEl.textContent = `${totalMissing} open registratie${totalMissing === 1 ? '' : 's'}`;

  listEl.innerHTML = missing.slice(0, 4).map(item => {
    const name = resolveEventLabel(item.id, events, item.name);
    const expected = item.expected || 0;
    const recorded = item.recorded || 0;
    return `
      <li>
        <span class="insights-inline__badge">⚠️</span>
        <div class="insights-inline__list-body">
          <strong>${esc(name)}</strong>
          <span>${recorded}/${expected} dagen geregistreerd · ${item.missing} open</span>
        </div>
      </li>
    `;
  }).join('');
}

const unitsFormatter = new Intl.NumberFormat('nl-NL', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1
});

function formatUnits(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return unitsFormatter.format(num);
}

function resolveEventLabel(eventId, events, fallback = 'Onbekend event') {
  if (!eventId || eventId === '__ALL__') return 'Alle evenementen';
  const match = events.find(ev => String(ev.id) === String(eventId));
  return match ? (match.naam || match.slug || match.id || fallback) : fallback;
}

function buildRangeLabel(range) {
  switch (range) {
    case '7':
      return 'Laatste 7 dagen';
    case '30':
      return 'Laatste 30 dagen';
    case '90':
      return 'Laatste 90 dagen';
    case '365':
      return 'Laatste 365 dagen';
    case '__ALL__':
    default:
      return 'Volledige historie';
  }
}

function resolveContainer(container) {
  if (container instanceof HTMLElement) return container;
  if (typeof container === 'string') return document.querySelector(container);
  return document.getElementById('panel-inzichten') || document.getElementById('app');
}

function injectInlineStyles() {
  if (document.getElementById('insights-inline-styles')) return;
  const style = document.createElement('style');
  style.id = 'insights-inline-styles';
  style.textContent = `
    .insights-inline{display:flex;flex-direction:column;gap:1rem;padding-bottom:1rem;}
    .insights-inline__header{display:flex;justify-content:space-between;align-items:flex-start;gap:.85rem;flex-wrap:wrap;}
    .insights-inline__header h2{margin:0;font-size:1.25rem;font-weight:900;color:#143814;}
    .insights-inline__header p{margin:.15rem 0 0;font-weight:700;color:#35513a;font-size:.9rem;}
    .insights-inline__filters{background:#fff;border-radius:1.1rem;box-shadow:0 16px 32px rgba(0,0,0,.08);border:1px solid rgba(0,0,0,.04);padding:1rem;display:flex;flex-direction:column;gap:.75rem;}
    .insights-inline__filters-note{margin:0;font-weight:700;color:#35513a;font-size:.85rem;}
    .chip-group{display:flex;gap:.5rem;flex-wrap:wrap;}
    .chip{border:none;border-radius:999px;background:#f4f6f5;color:#143814;font-weight:800;padding:.45rem .95rem;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.6);transition:transform .15s ease,box-shadow .15s ease;}
    .chip--active{background:#2A9626;color:#fff;box-shadow:0 10px 20px rgba(42,150,38,.25);}
    .chip:focus-visible{outline:3px solid rgba(42,150,38,.32);outline-offset:2px;}
    .chip:active{transform:scale(.97);}
    .insights-inline__select{display:flex;flex-direction:column;gap:.3rem;font-weight:800;color:#35513a;}
    .insights-inline__select select{border-radius:.8rem;border:1px solid #d1d5db;padding:.55rem .75rem;font-weight:800;color:#143814;background:#fff;}
    .insights-inline__select select:focus{outline:none;border-color:#2A9626;box-shadow:0 0 0 3px rgba(42,150,38,.18);}
    .insights-inline__loading{padding:1rem;border-radius:1rem;background:rgba(25,74,31,.06);font-weight:800;color:#194a1f;text-align:center;}
    .insights-inline__loading--error{background:rgba(198,40,40,.12);color:#c62828;}
    .insights-inline__hero{background:linear-gradient(135deg,#fff9d6,#f1fbef);border-radius:1.2rem;padding:1.2rem;box-shadow:0 20px 38px rgba(0,0,0,.1);display:grid;gap:1rem;}
    .insights-inline__hero-primary{display:flex;flex-direction:column;gap:.45rem;}
    .insights-inline__eyebrow{font-size:.8rem;font-weight:800;letter-spacing:.05em;color:#5b6a62;text-transform:uppercase;}
    .insights-inline__hero-value{font-size:1.85rem;font-weight:900;color:#143814;}
    .insights-inline__hero p{margin:0;font-weight:700;color:#35513a;}
    .insights-inline__hero-stats{display:grid;gap:.6rem;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));}
    .insights-inline__stat{background:#fff;border-radius:.95rem;padding:.75rem .85rem;box-shadow:0 12px 24px rgba(0,0,0,.08);display:flex;flex-direction:column;gap:.25rem;font-weight:800;color:#35513a;}
    .insights-inline__stat span{font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:#5b6a62;}
    .insights-inline__stat strong{font-size:1.1rem;font-weight:900;color:#143814;}
    .insights-inline__stat strong.negative{color:#C62828;}
    .insights-inline__stat strong.positive{color:#1F6D1C;}
    .insights-inline__grid{display:grid;gap:1rem;}
    @media (min-width:860px){.insights-inline__grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
    .insights-inline__card{background:#fff;border-radius:1rem;border:1px solid rgba(0,0,0,.05);box-shadow:0 14px 28px rgba(0,0,0,.08);padding:1rem;display:flex;flex-direction:column;gap:.75rem;}
    .insights-inline__card header{display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem;}
    .insights-inline__card h3{margin:0;font-size:1rem;font-weight:900;color:#143814;}
    .insights-inline__card-meta{font-weight:700;color:#35513a;font-size:.85rem;}
    .insights-inline__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.6rem;}
    .insights-inline__list li{display:flex;align-items:flex-start;gap:.6rem;}
    .insights-inline__badge{min-width:2.2rem;height:2.2rem;border-radius:999px;background:#FFE36A;color:#143814;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:.95rem;}
    .insights-inline__list-body{display:flex;flex-direction:column;gap:.25rem;font-weight:800;color:#143814;}
    .insights-inline__list-body span{font-size:.82rem;font-weight:700;color:#5b6a62;}
    .insights-inline__empty{background:rgba(25,74,31,.06);border-radius:.9rem;padding:.75rem .85rem;font-weight:700;color:#35513a;text-align:center;}
    .insights-inline__card[data-role="coverage"] .insights-inline__badge{background:rgba(198,40,40,.16);color:#8b1d1d;}
    .insights-inline__card[data-role="ledger"] .insights-inline__badge{background:rgba(42,150,38,.18);color:#1F6D1C;}
    .insights-inline__card[data-role="timeline"] .insights-inline__badge{background:rgba(16,86,155,.18);color:#0f4c81;}
    .insights-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.8rem;}
    .insights-kpi-grid .kpi{background:#f4faf3;border-radius:12px;padding:.75rem .9rem;display:flex;flex-direction:column;gap:.2rem;}
    .insights-kpi-grid .kpi-label{font-size:.85rem;color:#4b5563;text-transform:uppercase;letter-spacing:.05em;}
    .insights-kpi-grid .kpi-value{font-size:1.5rem;color:#14532d;}
    .insights-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.4rem;}
    .insights-list li{display:flex;justify-content:space-between;align-items:center;}
    .insights-forecast-card{display:flex;flex-direction:column;gap:1rem;}
    .insights-forecast-head{display:flex;flex-direction:column;gap:.75rem;}
    .insights-forecast-meta{display:flex;flex-wrap:wrap;gap:.75rem;}
    .insights-forecast-meta .metric{flex:1 1 150px;background:#f9fafb;border-radius:12px;padding:.7rem .85rem;display:flex;flex-direction:column;gap:.25rem;}
    .insights-forecast-meta .metric-label{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;}
    .insights-forecast-meta .metric-value{font-size:1.35rem;font-weight:600;color:#0f172a;}
    .insights-forecast-chart{width:100%;min-height:240px;}
  `;
  document.head.appendChild(style);
}

function countWithNote(events) {
  return events.filter(ev => typeof ev.notities === 'string' && ev.notities.trim().length > 0).length;
}

function computeForecastSnapshot(events) {
  const summary = {
    actualRevenue: 0,
    actualProfit: 0,
    projectedRevenue: 0,
    marginNumerator: 0,
    marginDenominator: 0
  };

  events.forEach((ev) => {
    const metrics = computeEventFinancials(ev) || {};
    const entries = collectOmzetEntries(ev) || [];
    const recordedDays = new Set();

    entries.forEach((entry) => {
      const ts = parseEntryDate(entry);
      const key = toYMDStringLocal(ts);
      if (key) recordedDays.add(key);
    });

    const metricsRecorded = Number.isFinite(metrics.omzetEntriesCount) ? metrics.omzetEntriesCount : 0;
    const countedDays = recordedDays.size || metricsRecorded;
    const expectedDaysRaw = Number.isFinite(metrics.expectedOmzetDays) ? metrics.expectedOmzetDays : countedDays;
    const expectedDays = Math.max(expectedDaysRaw, countedDays);
    const missingDays = Math.max(0, expectedDays - countedDays);
    const averageDayRevenue = countedDays ? metrics.totalRevenueEUR / countedDays : 0;
    const projectedRevenue = missingDays > 0 && Number.isFinite(averageDayRevenue)
      ? averageDayRevenue * missingDays
      : 0;

    const revenue = Number.isFinite(metrics.totalRevenueEUR) ? metrics.totalRevenueEUR : 0;
    const profit = Number.isFinite(metrics.netResultEUR) ? metrics.netResultEUR : 0;

    summary.actualRevenue += revenue;
    summary.actualProfit += profit;
    summary.projectedRevenue += projectedRevenue;
    if (revenue !== 0) {
      summary.marginNumerator += profit;
      summary.marginDenominator += revenue;
    }
  });

  const averageMargin = summary.marginDenominator !== 0
    ? summary.marginNumerator / summary.marginDenominator
    : 0;

  const expectedRevenue = summary.actualRevenue + summary.projectedRevenue;
  const forecastProfit = expectedRevenue * averageMargin;

  return {
    actualRevenue: summary.actualRevenue,
    actualProfit: summary.actualProfit,
    expectedRevenue,
    forecastProfit,
    projectedRevenue: summary.projectedRevenue,
    averageMargin
  };
}

function formatMarginPercentage(value) {
  if (!Number.isFinite(value)) return '0%';
  return value.toLocaleString('nl-NL', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

export function renderInzichtenPage(container) {
  const mount = resolveContainer(container);
  if (!mount) return;
  injectInlineStyles();

  const events = Array.isArray(db?.evenementen) ? db.evenementen : [];
  const state = {
    days: '30',
    eventId: '__ALL__'
  };

  mount.innerHTML = '';
  mount.classList.add('panel-stack');

  const wrapper = document.createElement('div');
  wrapper.className = 'insights-inline';
  wrapper.innerHTML = buildInlineInsightsMarkup(events, state);

  const openModalBtn = wrapper.querySelector('[data-role="open-modal"]');
  openModalBtn?.addEventListener('click', () => openInzichtenModal());

  const eventSelect = wrapper.querySelector('[data-role="event"]');
  populateEventSelect(eventSelect, events, state.eventId);

  const rangeButtons = Array.from(wrapper.querySelectorAll('[data-range]'));
  setActiveRange(rangeButtons, state.days);

  const loadingEl = wrapper.querySelector('[data-role="loading"]');
  const heroEl = wrapper.querySelector('[data-role="hero"]');
  const gridEl = wrapper.querySelector('[data-role="grid"]');

  const filtersNote = wrapper.querySelector('.insights-inline__filters-note');
  const productMeta = wrapper.querySelector('[data-role="product-meta"]');
  const productList = wrapper.querySelector('[data-role="product-list"]');
  const ledgerMeta = wrapper.querySelector('[data-role="ledger-meta"]');
  const ledgerList = wrapper.querySelector('[data-role="ledger-list"]');
  const timelineMeta = wrapper.querySelector('[data-role="timeline-meta"]');
  const timelineList = wrapper.querySelector('[data-role="timeline-list"]');
  const coverageMeta = wrapper.querySelector('[data-role="coverage-meta"]');
  const coverageList = wrapper.querySelector('[data-role="coverage-list"]');

  mount.appendChild(wrapper);

  rangeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const value = btn.dataset.range || '30';
      if (state.days === value) return;
      state.days = value;
      setActiveRange(rangeButtons, value);
      refresh();
    });
  });

  eventSelect?.addEventListener('change', () => {
    state.eventId = eventSelect.value || '__ALL__';
    refresh();
  });

  refresh();

  async function refresh() {
    showLoadingState(loadingEl, heroEl, gridEl, true);
    try {
      const filter = {
        eventId: state.eventId,
        locatie: '__ALL__',
        type: '__ALL__',
        days: state.days,
        curr: 'EUR'
      };
      const insights = await loadSales(filter);
      const currentEventLabel = resolveEventLabel(state.eventId, events);
      const currentRangeLabel = buildRangeLabel(state.days);
      if (filtersNote) {
        filtersNote.textContent = `${currentEventLabel} · ${currentRangeLabel}`;
      }
      renderInlineHero(heroEl, insights, events, state);
      renderInlineProducts(productList, productMeta, insights);
      renderInlineLedger(ledgerList, ledgerMeta, insights);
      renderInlineTimeline(timelineList, timelineMeta, insights, state);
      renderInlineCoverage(coverageList, coverageMeta, insights, events);
      showLoadingState(loadingEl, heroEl, gridEl, false);
    } catch (err) {
      console.warn('[POS] kon inline inzichten niet laden', err);
      if (loadingEl) {
        const message = err?.message || String(err || 'Onbekende fout');
        loadingEl.textContent = `Kon inzichten niet laden: ${message}`;
      }
      showLoadingState(loadingEl, heroEl, gridEl, false, true);
    }
  }
}

/* =========================
   Data & Aggregaties
   ========================= */

function daysToMs(days) {
  if (days === '__ALL__') return 0;
  const n = Number(days);
  return Number.isFinite(n) ? n*24*60*60*1000 : 0;
}

async function loadSales(filter) {
  const now = Date.now();
  const windowMs = daysToMs(filter.days);
  const sinceTs = windowMs ? (now - windowMs) : 0;

  const events = Array.isArray(db?.evenementen) ? db.evenementen : [];
  const scopeEvents = events.filter((event) => {
    if (filter.eventId && filter.eventId !== '__ALL__' && event.id !== filter.eventId) return false;
    if (filter.locatie && filter.locatie !== '__ALL__' && event.locatie !== filter.locatie) return false;
    if (filter.type && filter.type !== '__ALL__' && event.type !== filter.type) return false;
    return true;
  });

  const catalogContext = buildCatalogContext();
  const aggregate = {
    revenueEUR: 0,
    revenueUSD: 0,
    cheeseRevenueEUR: 0,
    cheeseRevenueUSD: 0,
    souvenirRevenueEUR: 0,
    souvenirRevenueUSD: 0,
    cheeseCostEUR: 0,
    commissionEUR: 0,
    stageldEUR: 0,
    extraCostsEUR: 0,
    netResultEUR: 0,
    dagOmzetCount: 0
  };

  const debtorTotalsEUR = { DIRECT: 0, DEBTOR: 0 };
  const debtorTotalsUSD = { DIRECT: 0, DEBTOR: 0 };
  const timelineBuckets = new Map();
  const productBuckets = new Map();
  const typeTotals = { BG: 0, ROOK: 0, GEIT: 0 };
  const coverage = [];
  const metricsByEvent = {};
  const eventSummaries = [];
  const omzetEntries = [];

  for (const ev of scopeEvents) {
    const metrics = computeEventFinancials(ev);
    metricsByEvent[ev.id] = metrics;

    const eventEntries = collectOmzetEntries(ev) || [];
    const eventRate = resolveEventExchangeRate(ev);
    let eventRevenueEUR = 0;
    let eventRevenueUSD = 0;

    const filteredEntries = eventEntries.filter((entry) => {
      if (!sinceTs) return true;
      const ts = parseEntryDate(entry);
      if (!ts) return true;
      return ts >= sinceTs;
    });

    filteredEntries.forEach((entry) => {
      const rate = resolveEntryRate(entry, eventRate);
      const eurValue = convertEntryToEUR(entry?.eur ?? entry?.prijs_eur, entry?.usd ?? entry?.prijs_usd, rate);
      const usdValue = convertEntryToUSD(entry?.eur ?? entry?.prijs_eur, entry?.usd ?? entry?.prijs_usd, rate);

      if (!eurValue && !usdValue) return;

      eventRevenueEUR += eurValue;
      eventRevenueUSD += usdValue;

      const debtorKey = resolveDebtorKey(entry);
      debtorTotalsEUR[debtorKey] += eurValue;
      debtorTotalsUSD[debtorKey] += usdValue;

      const ts = parseEntryDate(entry);
      const dayKey = toYMDStringLocal(ts);
      if (dayKey) {
        const bucket = timelineBuckets.get(dayKey) || { eur: 0, usd: 0 };
        bucket.eur += eurValue;
        bucket.usd += usdValue;
        timelineBuckets.set(dayKey, bucket);
      }

      omzetEntries.push({
        eventId: ev.id,
        eventName: ev.naam || ev.slug || ev.id,
        date: dayKey,
        eur: eurValue,
        usd: usdValue,
        debtor: debtorKey === 'DEBTOR'
      });
    });

    const totalRevenueEUR = toNumber(metrics.totalRevenueEUR);
    const totalRevenueUSD = toNumber(metrics.totalRevenueUSD);
    const cheeseRevenueEUR = toNumber(metrics.cheeseRevenueEUR);
    const cheeseRevenueUSD = toNumber(metrics.cheeseRevenueUSD);
    const cheeseCostEUR = toNumber(metrics.cheeseCostEUR);
    const commissionEUR = toNumber(metrics.commissionEUR);
    const stageldEUR = toNumber(metrics.stageldEUR);
    const extraCostsEUR = toNumber(metrics.extraCostsEUR);

    const revenueShareEUR = totalRevenueEUR > 0 ? Math.min(1, eventRevenueEUR / totalRevenueEUR) : (filteredEntries.length ? 1 : 0);
    const revenueShareUSD = totalRevenueUSD > 0 ? Math.min(1, eventRevenueUSD / totalRevenueUSD) : revenueShareEUR;

    const eventCheeseRevenueEUR = cheeseRevenueEUR > 0 ? cheeseRevenueEUR * revenueShareEUR : 0;
    const eventCheeseRevenueUSD = cheeseRevenueUSD > 0 ? cheeseRevenueUSD * revenueShareUSD : 0;
    const eventSouvenirRevenueEUR = Math.max(0, eventRevenueEUR - eventCheeseRevenueEUR);
    const eventSouvenirRevenueUSD = Math.max(0, eventRevenueUSD - eventCheeseRevenueUSD);

    const cheeseShare = cheeseRevenueEUR > 0 ? (eventCheeseRevenueEUR / cheeseRevenueEUR) : 0;
    const eventCheeseCostEUR = cheeseCostEUR * cheeseShare;
    const eventCommissionEUR = commissionEUR * revenueShareEUR;
    const hasRevenue = eventRevenueEUR > 0 || eventRevenueUSD > 0;
    const eventStageldEUR = hasRevenue ? stageldEUR : 0;
    const eventExtraCostsEUR = hasRevenue ? extraCostsEUR : 0;
    const eventNetResultEUR = eventRevenueEUR - (eventCheeseCostEUR + eventCommissionEUR + eventStageldEUR + eventExtraCostsEUR);

    aggregate.revenueEUR += eventRevenueEUR;
    aggregate.revenueUSD += eventRevenueUSD;
    aggregate.cheeseRevenueEUR += eventCheeseRevenueEUR;
    aggregate.cheeseRevenueUSD += eventCheeseRevenueUSD;
    aggregate.souvenirRevenueEUR += eventSouvenirRevenueEUR;
    aggregate.souvenirRevenueUSD += eventSouvenirRevenueUSD;
    aggregate.cheeseCostEUR += eventCheeseCostEUR;
    aggregate.netResultEUR += eventNetResultEUR;
    aggregate.commissionEUR += eventCommissionEUR;
    aggregate.stageldEUR += eventStageldEUR;
    aggregate.extraCostsEUR += eventExtraCostsEUR;
    aggregate.dagOmzetCount += filteredEntries.length;

    const cheeseSnapshot = metrics.cheeseSnapshot || {};
    const shareForUnits = cheeseShare;

    Object.entries(cheeseSnapshot.products || {}).forEach(([productName, qty]) => {
      const baseUnits = toNumber(qty);
      if (!baseUnits) return;
      const units = baseUnits * shareForUnits;
      if (!units) return;
      const info = resolveProductFinancials(productName, catalogContext);
      const bucket = productBuckets.get(info.name) || {
        name: info.name,
        type: info.type,
        units: 0,
        revenueEUR: 0,
        revenueUSD: 0,
        costEUR: 0
      };
      bucket.units += units;
      bucket.revenueEUR += info.priceEUR * units;
      bucket.revenueUSD += info.priceUSD * units;
      bucket.costEUR += info.costEUR * units;
      productBuckets.set(info.name, bucket);
    });

    const typeSnapshot = metrics.cheeseTypeTotals || {};
    ['BG', 'ROOK', 'GEIT'].forEach((type) => {
      const base = toNumber(typeSnapshot[type]);
      if (!base) return;
      typeTotals[type] += base * shareForUnits;
    });

    coverage.push({
      id: ev.id,
      name: ev.naam || ev.slug || ev.id,
      missing: metrics.missingOmzetDays || 0,
      expected: metrics.expectedOmzetDays || 0,
      recorded: filteredEntries.length,
      totalRecorded: metrics.omzetEntriesCount || 0
    });

    eventSummaries.push({
      id: ev.id,
      name: ev.naam || ev.slug || ev.id,
      revenueEUR: eventRevenueEUR,
      revenueUSD: eventRevenueUSD,
      cheeseRevenueEUR: eventCheeseRevenueEUR,
      souvenirRevenueEUR: eventSouvenirRevenueEUR,
      netResultEUR: eventNetResultEUR,
      commissionEUR: eventCommissionEUR,
      stageldEUR: eventStageldEUR,
      extraCostsEUR: eventExtraCostsEUR,
      cheeseCostEUR: eventCheeseCostEUR
    });
  }

  const timeline = Array.from(timelineBuckets.entries())
    .map(([date, sums]) => ({ date, eur: sums.eur, usd: sums.usd }))
    .sort((a, b) => a.date.localeCompare(b.date));

const productSummaries = Array.from(productBuckets.values())
  .sort((a, b) => b.revenueEUR - a.revenueEUR);

const accounting = buildAccountingAggregates(filter, scopeEvents);

  return {
    events: scopeEvents,
    totals: {
      currency: filter.curr && filter.curr.toUpperCase() === 'USD' ? 'USD' : 'EUR',
      revenue: { EUR: aggregate.revenueEUR, USD: aggregate.revenueUSD },
      cheeseRevenue: { EUR: aggregate.cheeseRevenueEUR, USD: aggregate.cheeseRevenueUSD },
      souvenirRevenue: { EUR: aggregate.souvenirRevenueEUR, USD: aggregate.souvenirRevenueUSD },
      cheeseCostEUR: aggregate.cheeseCostEUR,
      commissionEUR: aggregate.commissionEUR,
      stageldEUR: aggregate.stageldEUR,
      extraCostsEUR: aggregate.extraCostsEUR,
      netResultEUR: aggregate.netResultEUR,
      dagOmzetCount: aggregate.dagOmzetCount,
      eventCount: scopeEvents.length
    },
    productSummaries,
    typeTotals,
    timeline,
    debtorTotals: { EUR: debtorTotalsEUR, USD: debtorTotalsUSD },
    coverage,
    metricsByEvent,
    eventSummaries,
    entries: omzetEntries,
    accounting
  };
}

const ledgerRateCache = new Map();

export function buildAccountingAggregates(filter, scopeEvents) {
  const ledgerEntries = Array.isArray(db?.accounting?.entries) ? db.accounting.entries : [];
  if (!ledgerEntries.length) return createEmptyAccountingAggregates();

  const filterByEvent =
    (filter.eventId && filter.eventId !== '__ALL__') ||
    (filter.locatie && filter.locatie !== '__ALL__') ||
    (filter.type && filter.type !== '__ALL__');

  const accountFilter = normalizeLedgerId(filter.accountId);

  const allowedEventIds = new Set();
  if (filterByEvent) {
    scopeEvents.forEach((event) => {
      const id = normalizeLedgerId(event?.id || event?.uuid || event?.slug);
      if (id) allowedEventIds.add(id);
    });
    if (!allowedEventIds.size) return createEmptyAccountingAggregates();
  }

  const windowMs = daysToMs(filter.days);
  const sinceTs = windowMs ? (Date.now() - windowMs) : 0;

  const categoryMap = buildLedgerDictionary(db?.accounting?.categories);
  const accountMap = buildLedgerDictionary(db?.accounting?.accounts);

  const perMonth = new Map();
  const perCategory = new Map();
  const perAccount = new Map();

  let totalIncome = 0;
  let totalExpense = 0;

  ledgerRateCache.clear();

  for (const entry of ledgerEntries) {
    if (!entry) continue;

    if (filterByEvent) {
      const entryEventId = normalizeLedgerId(entry.eventId || entry.event || entry.eventUuid || entry.meta?.eventId);
      if (!entryEventId || !allowedEventIds.has(entryEventId)) continue;
    }

    if (accountFilter) {
      const entryAccountId = normalizeLedgerId(entry.accountId || entry.account);
      if (!entryAccountId || entryAccountId !== accountFilter) continue;
    }

    const ts = parseEntryDate(entry);
    if (sinceTs && (!ts || ts < sinceTs)) continue;

    const signedEUR = convertLedgerEntryToEUR(entry);
    if (!Number.isFinite(signedEUR) || signedEUR === 0) continue;

    const income = signedEUR >= 0 ? signedEUR : 0;
    const expense = signedEUR < 0 ? Math.abs(signedEUR) : 0;

    totalIncome += income;
    totalExpense += expense;

    const monthKey = formatLedgerMonth(ts);
    if (monthKey) {
      const bucket = ensureLedgerBucket(perMonth, monthKey, monthKey);
      bucket.income += income;
      bucket.expense += expense;
      bucket.balance += signedEUR;
    }

    const categoryId = normalizeLedgerId(entry.categoryId || entry.category);
    if (categoryId) {
      const label = categoryMap.get(categoryId)?.name || categoryId;
      const bucket = ensureLedgerBucket(perCategory, categoryId, label);
      bucket.income += income;
      bucket.expense += expense;
      bucket.balance += signedEUR;
    }

    const accountId = normalizeLedgerId(entry.accountId || entry.account);
    if (accountId) {
      const label = accountMap.get(accountId)?.name || accountId;
      const bucket = ensureLedgerBucket(perAccount, accountId, label);
      bucket.income += income;
      bucket.expense += expense;
      bucket.balance += signedEUR;
    }
  }

  const totals = {
    incomeEUR: roundLedgerAmount(totalIncome),
    expenseEUR: roundLedgerAmount(totalExpense),
    balanceEUR: roundLedgerAmount(totalIncome - totalExpense)
  };

  const perMonthList = Array.from(perMonth.values())
    .map((bucket) => ({
      month: bucket.key,
      label: bucket.label,
      income: roundLedgerAmount(bucket.income),
      expense: roundLedgerAmount(bucket.expense),
      balance: roundLedgerAmount(bucket.balance)
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const perCategoryList = Array.from(perCategory.values())
    .map((bucket) => ({
      id: bucket.key,
      label: bucket.label,
      income: roundLedgerAmount(bucket.income),
      expense: roundLedgerAmount(bucket.expense),
      balance: roundLedgerAmount(bucket.balance)
    }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  const perAccountList = Array.from(perAccount.values())
    .map((bucket) => ({
      id: bucket.key,
      label: bucket.label,
      income: roundLedgerAmount(bucket.income),
      expense: roundLedgerAmount(bucket.expense),
      balance: roundLedgerAmount(bucket.balance)
    }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  return {
    totals,
    perMonth: perMonthList,
    perCategory: perCategoryList,
    perAccount: perAccountList
  };
}

function createEmptyAccountingAggregates() {
  return {
    totals: { incomeEUR: 0, expenseEUR: 0, balanceEUR: 0 },
    perMonth: [],
    perCategory: [],
    perAccount: []
  };
}

function ensureLedgerBucket(map, key, label) {
  if (!map.has(key)) {
    map.set(key, { key, label, income: 0, expense: 0, balance: 0 });
  }
  return map.get(key);
}

function buildLedgerDictionary(list) {
  const map = new Map();
  if (!Array.isArray(list)) return map;
  list.forEach((item) => {
    if (!item) return;
    const id = normalizeLedgerId(item.id || item.uuid || item.code || item.slug);
    if (!id) return;
    const name = (item.name || item.naam || item.label || id).toString().trim() || id;
    map.set(id, { ...item, name });
  });
  return map;
}

function normalizeLedgerId(value) {
  if (value == null) return '';
  return String(value).trim();
}

function roundLedgerAmount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function formatLedgerMonth(ts) {
  if (!Number.isFinite(ts)) return null;
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function convertLedgerEntryToEUR(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  const currency = (entry.currency || entry.valuta || 'EUR').toString().toUpperCase();
  const signedCandidate = Number(entry.signedAmount ?? entry.amountSigned ?? entry.signed_amount);
  if (Number.isFinite(signedCandidate) && signedCandidate !== 0) {
    return convertLedgerValueWithRate(signedCandidate, currency, entry);
  }

  const amount = Number(entry.amount ?? entry.value ?? entry.bedrag);
  if (!Number.isFinite(amount) || amount === 0) return 0;
  const directionRaw = (entry.direction || entry.type || '').toString().toUpperCase();
  const sign = directionRaw === 'CREDIT' || directionRaw === 'EXPENSE' || directionRaw === 'UITGAVE' ? -1 : 1;
  return convertLedgerValueWithRate(amount * sign, currency, entry);
}

function convertLedgerValueWithRate(value, currency, entry) {
  if (!Number.isFinite(value) || value === 0) return 0;
  if (!currency || currency === 'EUR') return value;
  const rate = resolveLedgerExchangeRate(currency, entry);
  if (!Number.isFinite(rate) || rate <= 0) return value;
  return value * rate;
}

function resolveLedgerExchangeRate(currency, entry) {
  const candidates = [
    entry?.exchangeRate,
    entry?.rate,
    entry?.meta?.exchangeRate,
    entry?.meta?.eurPerUsd,
    entry?.meta?.usdToEur
  ];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return resolveLedgerRate(currency);
}

function resolveLedgerRate(currency) {
  const code = (currency || '').toString().toUpperCase();
  if (!code || code === 'EUR') return 1;
  if (ledgerRateCache.has(code)) return ledgerRateCache.get(code);

  const list = Array.isArray(db?.wisselkoersen) ? db.wisselkoersen : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const from = (item.from || item.source || item.currency || item.code || '').toString().toUpperCase();
    const to = (item.to || item.target || item.doel || item.quote || 'EUR').toString().toUpperCase();
    const rate = Number(item.rate ?? item.value ?? item.prijs ?? item.eur ?? item.factor ?? item.amount ?? item.usdToEur);
    if (from === code && (!to || to === 'EUR') && Number.isFinite(rate) && rate > 0) {
      ledgerRateCache.set(code, rate);
      return rate;
    }
    if (to === code && from === 'EUR' && Number.isFinite(rate) && rate > 0) {
      const converted = 1 / rate;
      ledgerRateCache.set(code, converted);
      return converted;
    }
  }

  ledgerRateCache.set(code, 1);
  return 1;
}

/* =========================
   KPI & Charts
   ========================= */

function renderKPIs(data, filter, mount) {
  const currency = data.totals?.currency === 'USD' ? 'USD' : 'EUR';
  const totalRevenue = data.totals?.revenue?.[currency] || 0;
  const cheeseRevenue = data.totals?.cheeseRevenue?.[currency] || 0;
  const souvenirRevenue = data.totals?.souvenirRevenue?.[currency] || 0;
  const eventCount = data.totals?.eventCount || 0;
  const avgPerEvent = eventCount ? totalRevenue / eventCount : 0;
  const cheeseCostEUR = data.totals?.cheeseCostEUR || 0;
  const netResultEUR = data.totals?.netResultEUR || 0;
  const dagOmzetCount = data.totals?.dagOmzetCount || 0;
  const missingDays = (data.coverage || []).reduce((sum, entry) => sum + (entry.missing || 0), 0);
  const expectedDays = (data.coverage || []).reduce((sum, entry) => sum + (entry.expected || 0), 0);
  const coveragePct = expectedDays ? Math.max(0, Math.round(((expectedDays - missingDays) / expectedDays) * 100)) : 100;
  const topEvent = (data.eventSummaries || []).slice().sort((a, b) => b.revenueEUR - a.revenueEUR)[0];

  const cards = [
    `<div class="kpi"><div class="kpi-title">Totale omzet (${currency})</div><div class="kpi-value">${formatCurrencyValue(totalRevenue, currency)}</div></div>`,
    `<div class="kpi"><div class="kpi-title">Gemiddeld per event</div><div class="kpi-value">${formatCurrencyValue(avgPerEvent, currency)}</div></div>`,
    `<div class="kpi small"><div class="kpi-title">Kaas omzet</div><div class="kpi-value">${formatCurrencyValue(cheeseRevenue, currency)}</div></div>`,
    `<div class="kpi small"><div class="kpi-title">Souvenir omzet</div><div class="kpi-value">${formatCurrencyValue(souvenirRevenue, currency)}</div></div>`,
    `<div class="kpi small"><div class="kpi-title">Kostprijs kaas</div><div class="kpi-value">${formatCurrencyValue(cheeseCostEUR, 'EUR')}</div></div>`,
    `<div class="kpi small"><div class="kpi-title">Netto resultaat</div><div class="kpi-value">${formatCurrencyValue(netResultEUR, 'EUR')}</div></div>`,
    `<div class="kpi small badge">Registraties: ${dagOmzetCount}</div>`,
    `<div class="kpi small badge">Ontbrekende dagen: ${missingDays}</div>`
  ];

  if (topEvent) {
    cards.push(`<div class="kpi small badge">Top event: ${esc(topEvent.name)}</div>`);
  }
  cards.push(`<div class="kpi small badge">Dekgraad dagomzet: ${Number.isFinite(coveragePct) ? coveragePct : 0}%</div>`);

  if (data.accounting?.totals) {
    const ledgerTotals = data.accounting.totals;
    cards.push(`<div class="kpi"><div class="kpi-title">Ledger saldo</div><div class="kpi-value">${formatCurrencyValue(ledgerTotals.balanceEUR, 'EUR')}</div></div>`);
    cards.push(`<div class="kpi small"><div class="kpi-title">Ledger inkomsten</div><div class="kpi-value">${formatCurrencyValue(ledgerTotals.incomeEUR, 'EUR')}</div></div>`);
    cards.push(`<div class="kpi small"><div class="kpi-title">Ledger uitgaven</div><div class="kpi-value">${formatCurrencyValue(ledgerTotals.expenseEUR, 'EUR')}</div></div>`);
  }

  mount.innerHTML = cards.join('');
}

export function renderAccountingKPIs(accountingData, mount) {
  if (!mount) return;
  if (!accountingData) {
    mount.innerHTML = '<p class="muted">Geen ledgerdata voor deze selectie.</p>';
    return;
  }

  const totals = accountingData.totals || { incomeEUR: 0, expenseEUR: 0, balanceEUR: 0 };
  const cards = [
    `<div class="kpi"><div class="kpi-title">Saldo (EUR)</div><div class="kpi-value">${formatCurrencyValue(totals.balanceEUR || 0, 'EUR')}</div></div>`,
    `<div class="kpi small"><div class="kpi-title">Inkomsten</div><div class="kpi-value">${formatCurrencyValue(totals.incomeEUR || 0, 'EUR')}</div></div>`,
    `<div class="kpi small"><div class="kpi-title">Uitgaven</div><div class="kpi-value">${formatCurrencyValue(totals.expenseEUR || 0, 'EUR')}</div></div>`
  ];

  const topCategory = (accountingData.perCategory || []).find((item) => Number.isFinite(item.balance) && item.balance !== 0) || accountingData.perCategory?.[0];
  if (topCategory) {
    cards.push(`<div class="kpi small badge">Top categorie: ${esc(topCategory.label || topCategory.id)} (${formatCurrencyValue(topCategory.balance, 'EUR')})</div>`);
  }

  const topAccount = (accountingData.perAccount || []).find((item) => Number.isFinite(item.balance) && item.balance !== 0) || accountingData.perAccount?.[0];
  if (topAccount) {
    cards.push(`<div class="kpi small badge">Actief account: ${esc(topAccount.label || topAccount.id)} (${formatCurrencyValue(topAccount.balance, 'EUR')})</div>`);
  }

  mount.innerHTML = cards.join('');
}

function renderMiniCharts(charts, data){
  const currency = data.totals?.currency === 'USD' ? 'USD' : 'EUR';
  const timeline = data.timeline || [];
  const ctxTrend = document.getElementById('miniTrend');
  if (ctxTrend) {
    charts.miniTrend && charts.miniTrend.destroy?.();
    const labels = timeline.map(item => item.date);
    const values = timeline.map(item => currency === 'USD' ? item.usd : item.eur);
    charts.miniTrend = new Chart(ctxTrend, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: '#2A9626',
          backgroundColor: 'rgba(42,150,38,0.15)',
          tension: 0.25,
          fill: true,
          label: `Omzet (${currency})`
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  const topProducts = (data.productSummaries || []).slice(0, 5);
  const ctxProduct = document.getElementById('miniProduct');
  if (ctxProduct) {
    charts.miniProd && charts.miniProd.destroy?.();
    charts.miniProd = new Chart(ctxProduct, {
      type: 'bar',
      data: {
        labels: topProducts.map(item => item.name),
        datasets: [{
          data: topProducts.map(item => item.revenueEUR),
          backgroundColor: '#FFC500',
          label: 'Omzet (EUR)'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { autoSkip: false, maxRotation: 0, minRotation: 0 } },
          y: { beginAtZero: true }
        }
      }
    });
  }

  const debtorTotals = data.debtorTotals?.[currency] || { DIRECT: 0, DEBTOR: 0 };
  const ctxPayment = document.getElementById('miniHour');
  if (ctxPayment) {
    charts.miniHour && charts.miniHour.destroy?.();
    charts.miniHour = new Chart(ctxPayment, {
      type: 'doughnut',
      data: {
        labels: ['Direct', 'Debiteur'],
        datasets: [{
          data: [debtorTotals.DIRECT || 0, debtorTotals.DEBTOR || 0],
          backgroundColor: ['#1976D2', '#FFC500']
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  const coverage = (data.coverage || []).slice().sort((a, b) => (b.missing || 0) - (a.missing || 0)).slice(0, 5);
  const ctxCoverage = document.getElementById('miniDay');
  if (ctxCoverage) {
    charts.miniDay && charts.miniDay.destroy?.();
    charts.miniDay = new Chart(ctxCoverage, {
      type: 'bar',
      data: {
        labels: coverage.map(item => item.name),
        datasets: [{
          label: 'Ontbrekende dagen',
          data: coverage.map(item => item.missing || 0),
          backgroundColor: '#FB8C00'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        indexAxis: 'y',
        scales: { x: { beginAtZero: true } }
      }
    });
  }

  return charts;
}

function drawOrUpdateCharts(charts, data, filter) {
  const currency = data.totals?.currency === 'USD' ? 'USD' : 'EUR';
  const products = (data.productSummaries || []).slice(0, 20);
  const ctxProducts = document.getElementById('chartOmzetVsKosten');
  if (ctxProducts) {
    charts.prod && charts.prod.destroy?.();
    charts.prod = new Chart(ctxProducts, {
      type: 'bar',
      data: {
        labels: products.map(item => item.name),
        datasets: [
          { label: 'Omzet (EUR)', data: products.map(item => item.revenueEUR), backgroundColor: '#2A9626' },
          { label: 'Kosten (EUR)', data: products.map(item => item.costEUR), backgroundColor: '#C62828' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { ticks: { autoSkip: true, maxRotation: 0, minRotation: 0 } }, y: { beginAtZero: true } }
      }
    });
  }

  const ctxTimeline = document.getElementById('chartPerUur');
  if (ctxTimeline) {
    charts.hour && charts.hour.destroy?.();
    const labels = (data.timeline || []).map(item => item.date);
    const values = (data.timeline || []).map(item => currency === 'USD' ? item.usd : item.eur);
    charts.hour = new Chart(ctxTimeline, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          label: `Dagomzet (${currency})`,
          borderColor: '#1976D2',
          backgroundColor: 'rgba(25,118,210,0.15)',
          tension: 0.25,
          fill: true
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  const ctxEvents = document.getElementById('chartPerDag');
  if (ctxEvents) {
    charts.day && charts.day.destroy?.();
    const events = (data.eventSummaries || []).slice().sort((a, b) => (currency === 'USD' ? b.revenueUSD - a.revenueUSD : b.revenueEUR - a.revenueEUR)).slice(0, 12);
    charts.day = new Chart(ctxEvents, {
      type: 'bar',
      data: {
        labels: events.map(item => item.name),
        datasets: [{
          label: `Omzet (${currency})`,
          data: events.map(item => currency === 'USD' ? item.revenueUSD : item.revenueEUR),
          backgroundColor: '#FB8C00'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { ticks: { autoSkip: false, maxRotation: 0, minRotation: 0 } }, y: { beginAtZero: true } }
      }
    });
  }

  return charts;
}

export function drawAccountingCharts(charts, accountingData) {
  if (!charts) charts = {};
  const monthly = Array.isArray(accountingData?.perMonth) ? accountingData.perMonth : [];
  const categories = Array.isArray(accountingData?.perCategory) ? accountingData.perCategory.slice(0, 8) : [];
  const accounts = Array.isArray(accountingData?.perAccount) ? accountingData.perAccount.slice(0, 8) : [];

  const ctxMonthly = document.getElementById('chartLedgerMonthly');
  if (ctxMonthly) {
    charts.ledgerMonthly && charts.ledgerMonthly.destroy?.();
    if (monthly.length) {
      charts.ledgerMonthly = new Chart(ctxMonthly, {
        type: 'bar',
        data: {
          labels: monthly.map((item) => item.label || item.month),
          datasets: [
            {
              label: 'Inkomsten (EUR)',
              data: monthly.map((item) => item.income || 0),
              backgroundColor: '#2A9626'
            },
            {
              label: 'Uitgaven (EUR)',
              data: monthly.map((item) => (item.expense || 0) * -1),
              backgroundColor: '#C62828'
            },
            {
              label: 'Saldo (EUR)',
              data: monthly.map((item) => item.balance || 0),
              type: 'line',
              borderColor: '#1976D2',
              backgroundColor: 'rgba(25,118,210,0.2)',
              tension: 0.25,
              yAxisID: 'y1',
              fill: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true },
            y1: {
              position: 'right',
              beginAtZero: true,
              grid: { drawOnChartArea: false }
            }
          }
        }
      });
    }
  }

  const ctxCategory = document.getElementById('chartLedgerCategory');
  if (ctxCategory) {
    charts.ledgerCategory && charts.ledgerCategory.destroy?.();
    if (categories.length) {
      charts.ledgerCategory = new Chart(ctxCategory, {
        type: 'bar',
        data: {
          labels: categories.map((item) => item.label || item.id || 'Categorie'),
          datasets: [
            {
              label: 'Saldo (EUR)',
              data: categories.map((item) => item.balance || 0),
              backgroundColor: categories.map((item) => (item.balance || 0) >= 0 ? '#2A9626' : '#C62828')
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true } }
        }
      });
    }
  }

  const ctxAccount = document.getElementById('chartLedgerAccount');
  if (ctxAccount) {
    charts.ledgerAccount && charts.ledgerAccount.destroy?.();
    if (accounts.length) {
      charts.ledgerAccount = new Chart(ctxAccount, {
        type: 'bar',
        data: {
          labels: accounts.map((item) => item.label || item.id || 'Account'),
          datasets: [
            {
              label: 'Inkomsten (EUR)',
              data: accounts.map((item) => item.income || 0),
              backgroundColor: '#FFC500'
            },
            {
              label: 'Uitgaven (EUR)',
              data: accounts.map((item) => (item.expense || 0) * -1),
              backgroundColor: '#C62828'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true } },
          plugins: { legend: { display: true } }
        }
      });
    }
  }

  return charts;
}

function renderProductsTable(data, filter, tbody) {
  const rows = (data.productSummaries || [])
    .map((item) => {
      const omzet = item.revenueEUR || 0;
      const kosten = item.costEUR || 0;
      const marge = omzet - kosten;
      const margePct = omzet ? (marge / omzet) * 100 : 0;
      return `
        <tr>
          <td>${esc(item.name)}</td>
          <td>${formatCurrencyValue(omzet, 'EUR')}</td>
          <td>${formatCurrencyValue(kosten, 'EUR')}</td>
          <td>${formatCurrencyValue(marge, 'EUR')}</td>
          <td style="color:${marge >= 0 ? '#2E7D32' : '#C62828'}">${margePct.toFixed(1)}%</td>
        </tr>
      `;
    })
    .join('');

  tbody.innerHTML = rows || `<tr><td colspan="5" style="text-align:center;color:#666">Geen data</td></tr>`;
}

/* =========================
   Vooruitzicht (Forecast)
   ========================= */

function historicalAverages() {
  const events = Array.isArray(db?.evenementen) ? db.evenementen : [];
  const completed = events.filter((event) => {
    const state = String(event?.state || event?.status || '').toLowerCase();
    return state === 'closed' || state === 'completed' || state === 'active' || event?.afgerond === true;
  });
  const cache = new Map();

  return {
    completed,
    ensureEventMetrics(ev) {
      if (!ev || !ev.id) {
        return { omzetEUR: 0, kostenTotaal: 0, winst: 0 };
      }
      if (!cache.has(ev.id)) {
        const metrics = computeEventFinancials(ev);
        const kostenTotaal =
          (metrics.cheeseCostEUR || 0) +
          (metrics.commissionEUR || 0) +
          (metrics.stageldEUR || 0) +
          (metrics.extraCostsEUR || 0);
        cache.set(ev.id, {
          omzetEUR: metrics.totalRevenueEUR || 0,
          kostenTotaal,
          winst: metrics.netResultEUR || 0
        });
      }
      return cache.get(ev.id);
    }
  };
}

function renderForecast(data, filter, root) {
  const tbody = root.querySelector('#tblForecast tbody');
  if (!tbody) return;

  const planned = (Array.isArray(db?.evenementen) ? db.evenementen : []).filter((e) => {
    const state = String(e?.state || e?.status || '').toLowerCase();
    return state === 'planned';
  });
  if (!planned.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#666">Geen geplande evenementen.</td></tr>`;
    const ctx = root.querySelector('#chartForecastStack');
    if (ctx && ctx._chart) { ctx._chart.destroy(); ctx._chart = null; }
    root.querySelector('#fcOmzet').textContent = '€0.00';
    root.querySelector('#fcKosten').textContent = '€0.00';
    root.querySelector('#fcWinst').textContent  = '€0.00';
    return;
  }

  const { completed, ensureEventMetrics } = historicalAverages();

  const rows = [];
  let totalOmzet = 0;
  let totalKosten = 0;
  let totalWinst = 0;
  const chartOmzet = [];
  const chartKosten = [];
  const chartWinst = [];

  planned.forEach((ev) => {
    const locSet = completed.filter((e) => e.locatie === ev.locatie);
    const typeSet = completed.filter((e) => e.type === ev.type);
    const pickSet = locSet.length ? locSet : (typeSet.length ? typeSet : completed);
    let sumOmzet = 0;
    let sumKosten = 0;
    let sumWinst = 0;
    pickSet.forEach((ref) => {
      const metrics = ensureEventMetrics(ref);
      sumOmzet += metrics.omzetEUR;
      sumKosten += metrics.kostenTotaal;
      sumWinst += metrics.winst;
    });
    const count = pickSet.length || 1;
    const avgOmzet = sumOmzet / count;
    const avgKosten = sumKosten / count;
    const avgWinst = sumWinst / count;

    totalOmzet += avgOmzet;
    totalKosten += avgKosten;
    totalWinst += avgWinst;

    chartOmzet.push(avgOmzet);
    chartKosten.push(avgKosten);
    chartWinst.push(avgWinst);

    rows.push(`
      <tr>
        <td>${esc(ev.naam)}</td>
        <td>${esc(ev.locatie || '-')}</td>
        <td>${esc(ev.type || '-')}</td>
        <td>${formatCurrencyValue(avgOmzet, 'EUR')}</td>
        <td>${formatCurrencyValue(avgKosten, 'EUR')}</td>
        <td style="color:${avgWinst >= 0 ? '#2E7D32' : '#C62828'}">${formatCurrencyValue(avgWinst, 'EUR')}</td>
      </tr>
    `);
  });

  tbody.innerHTML = rows.join('');

  root.querySelector('#fcOmzet').textContent = formatCurrencyValue(totalOmzet, 'EUR');
  root.querySelector('#fcKosten').textContent = formatCurrencyValue(totalKosten, 'EUR');
  root.querySelector('#fcWinst').textContent = formatCurrencyValue(totalWinst, 'EUR');

  const ctx = root.querySelector('#chartForecastStack');
  if (ctx) {
    ctx._chart && ctx._chart.destroy?.();
    ctx._chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: planned.map((ev) => ev.naam),
        datasets: [
          { label: 'Omzet (EUR)', data: chartOmzet, backgroundColor: '#2A9626', stack: 'stack' },
          { label: 'Kosten (EUR)', data: chartKosten, backgroundColor: '#C62828', stack: 'stack' },
          { label: 'Winst (EUR)', data: chartWinst, backgroundColor: '#1976D2', stack: 'stack' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true, ticks: { autoSkip: false, maxRotation: 0, minRotation: 0 } },
          y: { stacked: true, beginAtZero: true }
        }
      }
    });
  }
}

/* =========================
   Exports: CSV / Excel / PDF
   ========================= */

function exportCSVCurrent(eventId, days, locatie, type) {
  try {
    // simpele CSV van producttabel + KPI’s zou prima zijn;
    // hier exporteren we alleen productregels die in DOM staan
    const rows = [];
    const tbl = document.querySelector('#tblProducts');
    if (tbl) {
      const heads = Array.from(tbl.querySelectorAll('thead th')).map(th=>th.textContent.trim());
      rows.push(heads.join(','));
      tbl.querySelectorAll('tbody tr').forEach(tr=>{
        const cells = Array.from(tr.children).map(td => `"${td.textContent.replaceAll('"','""')}"`);
        rows.push(cells.join(','));
      });
    }
    const blob = new Blob([rows.join('\n')], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `inzichten_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    showAlert('CSV export mislukte.', 'error');
  }
}

async function exportExcelCurrent(eventId, days, locatie, type) {
  try {
    const data = await loadSales({ eventId, days, curr: 'EUR', locatie, type });
    const timeline = data.timeline || [];
    const totalRevenue = data.totals?.revenue?.EUR || 0;
    const totalCosts =
      (data.totals?.cheeseCostEUR || 0) +
      (data.totals?.commissionEUR || 0) +
      (data.totals?.stageldEUR || 0) +
      (data.totals?.extraCostsEUR || 0);

    const rows = timeline.map((item) => {
      const share = totalRevenue > 0 ? item.eur / totalRevenue : 0;
      const kosten = totalCosts * share;
      const netto = item.eur - kosten;
      return `<tr><td>${esc(item.date)}</td><td>${item.eur.toFixed(2)}</td><td>${kosten.toFixed(2)}</td><td>${netto.toFixed(2)}</td></tr>`;
    }).join('');

    const table = `<table><thead><tr><th>Datum</th><th>Omzet (EUR)</th><th>Geschatte kosten (EUR)</th><th>Netto (EUR)</th></tr></thead><tbody>${rows}</tbody></table>`;
    const html = `<html><head><meta charset="utf-8" /></head><body>${table}</body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `inzichten_${Date.now()}.xls`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error(e);
    showAlert('Excel export mislukte.', 'error');
  }
}

async function exportPDF(container) {
  try {
    const node = container.closest('.modal') || container;
    const canvas = await window.html2canvas(node, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new window.jspdf.jsPDF('p', 'pt', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW - 40;
    const imgH = canvas.height * (imgW / canvas.width);
    pdf.addImage(imgData, 'PNG', 20, 20, imgW, imgH);
    pdf.save(`inzichten_${Date.now()}.pdf`);
  } catch (e) {
    console.error(e);
    showAlert('PDF export mislukte.', 'error');
  }
}

/* =========================
   Utils & Styles
   ========================= */

function esc(s){ return String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }


function injectStylesOnce(){
  if (document.getElementById('inz-css')) return;
  const css = document.createElement('style');
  css.id = 'inz-css';
  css.textContent = `
    .modal{ position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,.35); z-index:9999; }
    .inz-modal{ width:min(1100px, 96vw); max-height:92vh; overflow:auto; background:#fff; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,.25); padding:1rem; }
    .inz-head{ display:flex; justify-content:space-between; align-items:center; gap:.5rem; border-bottom:1px solid #eee; padding-bottom:.5rem; }
    .inz-head-actions{ display:flex; gap:.4rem; }
    .btn-green{ background:#2E7D32; color:#fff; border:none; border-radius:8px; padding:.5rem .8rem; font-weight:900; cursor:pointer; }
    .btn-blue{ background:#1976D2; color:#fff; border:none; border-radius:8px; padding:.5rem .8rem; font-weight:900; cursor:pointer; }
    .btn-amber{ background:#FB8C00; color:#1b1b1b; border:none; border-radius:8px; padding:.5rem .8rem; font-weight:900; cursor:pointer; }
    .btn-red{ background:#C62828; color:#fff; border:none; border-radius:8px; padding:.5rem .8rem; font-weight:900; cursor:pointer; }
    .inz-filters{ display:flex; gap:1rem; flex-wrap:wrap; margin:.6rem 0 .4rem 0; }
    .inz-filters .row{ display:flex; flex-direction:column; gap:.25rem; }
    .inz-filters select{ padding:.45rem .6rem; border:1px solid #ddd; border-radius:8px; }

    .inz-tabs{ display:flex; gap:.4rem; border-bottom:1px solid #eee; margin-top:.2rem; }
    .inz-tabs .tab{ background:#1976D2; color:#fff; border:none; border-radius:8px 8px 0 0; padding:.45rem .8rem; font-weight:900; cursor:pointer; opacity:.7; }
    .inz-tabs .tab.active{ opacity:1; }

    .inz-content{ padding:.6rem .2rem; }
    .tab-pane{ display:none; }
    .tab-pane.active{ display:block; }

    .kpi-grid{ display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:.6rem; margin:.4rem 0; }
    .kpi{ background:#F3FFF1; border:1px solid #D7F2D0; border-radius:10px; padding:.6rem .7rem; }
    .kpi.small{ padding:.45rem .6rem; }
    .kpi.badge{ background:#E8F4FF; border:1px solid #CFE6FF; }
    .kpi-title{ font-weight:800; color:#2A9626; }
    .kpi-value{ font-weight:900; font-size:1.25rem; }

    .mini-grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:.6rem; }
    .panel{ background:#fff; border:1px solid #eee; border-radius:12px; padding:.6rem; margin:.4rem 0; min-height:220px; }
    .panel.mini{ min-height:160px; cursor:pointer; }
    .panel.mini:hover{ box-shadow:0 0 0 2px #2A9626 inset; }
    .table-wrap{ overflow:auto; max-height:45vh; }
    table{ width:100%; border-collapse:collapse; }
    th,td{ padding:.45rem .5rem; border-bottom:1px solid #eee; text-align:left; }
    thead th{ position:sticky; top:0; background:#f8f8f8; }
    canvas{ width:100%; max-height:300px; }
  `;
  document.head.appendChild(css);
}