// 18_accounting.js — Cashflow overzicht

import { formatCurrencyValue, showAlert } from './4_ui.js';
import { buildCashflowProjection, getFinanceState, updateFinanceState } from './19_cashflow.js';

const cashflowState = {
  balanceInput: '',
  expanded: false,
  activeForm: null,
  editingFixedCostId: null
};

let activeRoot = null;
let chartInstance = null;
let stylesInjected = false;

export function renderAccountingPage(target) {
  const mount = typeof target === 'string' ? document.querySelector(target) : target;
  if (!mount) return;
  activeRoot = mount;
  ensureStyles();
  refreshCashflowView();
}

function refreshCashflowView() {
  if (!activeRoot) return;
  const finance = getFinanceState();
  const balanceValue = cashflowState.balanceInput;
  const balanceEUR = balanceValue ? parseEuroInput(balanceValue) : finance.lastKnownBalance?.amountEUR;
  const projection = buildCashflowProjection({
    months: 6,
    balanceEUR: Number.isFinite(balanceEUR) ? balanceEUR : 0
  });

  activeRoot.innerHTML = buildMarkup(finance, projection);
  bindActions(activeRoot, finance, projection);
  drawChart(activeRoot, projection);
}

function buildMarkup(finance, projection) {
  const totals = projection.totals || { openReceivableEUR: 0, openPayableEUR: 0 };
  const months = projection.months || [];
  const endBaseline = months.length ? months[months.length - 1].baselineBalanceEUR : 0;
  const endScenario = months.length ? months[months.length - 1].scenarioBalanceEUR : 0;
  const hasEventContrib = projection.breakdown.eventContrib.length > 0;
  const hasFixedCosts = finance.fixedCosts.length > 0;
  const hasOpenItems = finance.debtors.some(isOpen) || finance.creditors.some(isOpen);

  return `
    <div class="cashflow-shell">
      <header class="cashflow-header">
        <div>
          <p class="cashflow-eyebrow">Cashflow</p>
          <h2>Overzicht & vooruitzicht</h2>
          <p class="muted">Automatisch gevuld met dagomzet, kosten en open posten.</p>
        </div>
      </header>

      <section class="cashflow-summary">
        <button type="button" class="cashflow-card" data-scroll="receivables">
          <span class="cashflow-card__label">Te ontvangen</span>
          <strong>${escapeHtml(formatCurrencyValue(totals.openReceivableEUR || 0, 'EUR'))}</strong>
          <span class="cashflow-card__meta">Open debiteuren</span>
        </button>
        <button type="button" class="cashflow-card" data-scroll="payables">
          <span class="cashflow-card__label">Te betalen</span>
          <strong>${escapeHtml(formatCurrencyValue(totals.openPayableEUR || 0, 'EUR'))}</strong>
          <span class="cashflow-card__meta">Open crediteuren</span>
        </button>
        <div class="cashflow-card cashflow-card--input">
          <label>
            <span class="cashflow-card__label">Huidig saldo</span>
            <input type="text" inputmode="decimal" placeholder="Voer saldo in" value="${escapeHtml(cashflowState.balanceInput)}" data-balance-input>
          </label>
          <span class="cashflow-card__meta">Tijdelijke override</span>
        </div>
      </section>

      <section class="cashflow-actions">
        <button type="button" class="btn-primary" data-open-form="debtor">+ Nieuwe debiteur</button>
        <button type="button" class="btn-secondary" data-open-form="creditor">+ Nieuwe crediteur</button>
        <button type="button" class="btn-secondary" data-open-form="fixed">+ Vaste kost</button>
      </section>

      <section class="cashflow-form" data-form="debtor" ${cashflowState.activeForm === 'debtor' ? '' : 'hidden'}>
        <h3>Nieuwe debiteur</h3>
        <form data-submit="debtor">
          <div class="cashflow-form__grid">
            <label>Naam<input type="text" name="name" required></label>
            <label>Bedrag EUR<input type="number" name="amount" min="0" step="0.01" required></label>
            <label>Vervaldatum<input type="date" name="dueDate"></label>
          </div>
          <label>Notitie<textarea name="notes" rows="2"></textarea></label>
          <div class="cashflow-form__actions">
            <button type="submit" class="btn-primary">Opslaan</button>
            <button type="button" class="btn-secondary" data-cancel-form>Annuleren</button>
          </div>
        </form>
      </section>

      <section class="cashflow-form" data-form="creditor" ${cashflowState.activeForm === 'creditor' ? '' : 'hidden'}>
        <h3>Nieuwe crediteur</h3>
        <form data-submit="creditor">
          <div class="cashflow-form__grid">
            <label>Naam<input type="text" name="name" required></label>
            <label>Bedrag EUR<input type="number" name="amount" min="0" step="0.01" required></label>
            <label>Vervaldatum<input type="date" name="dueDate"></label>
          </div>
          <label>Notitie<textarea name="notes" rows="2"></textarea></label>
          <div class="cashflow-form__actions">
            <button type="submit" class="btn-primary">Opslaan</button>
            <button type="button" class="btn-secondary" data-cancel-form>Annuleren</button>
          </div>
        </form>
      </section>

      <section class="cashflow-form" data-form="fixed" ${cashflowState.activeForm === 'fixed' ? '' : 'hidden'}>
        <h3>${cashflowState.editingFixedCostId ? 'Vaste kost aanpassen' : 'Nieuwe vaste kost'}</h3>
        <form data-submit="fixed">
          <div class="cashflow-form__grid">
            <label>Naam<input type="text" name="name" required></label>
            <label>Bedrag EUR<input type="number" name="amount" min="0" step="0.01" required></label>
            <label>Frequentie
              <select name="frequency">
                <option value="monthly">Maandelijks</option>
                <option value="weekly">Wekelijks</option>
                <option value="yearly">Jaarlijks</option>
              </select>
            </label>
            <label>Startdatum<input type="date" name="startDate"></label>
          </div>
          <label><input type="checkbox" name="active" checked> Actief</label>
          <div class="cashflow-form__actions">
            <button type="submit" class="btn-primary">${cashflowState.editingFixedCostId ? 'Opslaan' : 'Toevoegen'}</button>
            <button type="button" class="btn-secondary" data-cancel-form>Annuleren</button>
          </div>
        </form>
      </section>

      <section class="cashflow-forecast">
        <div class="cashflow-forecast__head">
          <h3>Cashflow forecast (6 maanden)</h3>
          <span class="muted">Baseline vs scenario</span>
        </div>
        <div class="cashflow-forecast__chart">
          <canvas id="cashflowChart" height="220"></canvas>
        </div>
        <div class="cashflow-forecast__summary">
          <span>Baseline einde: ${escapeHtml(formatCurrencyValue(endBaseline, 'EUR'))}</span>
          <span>Scenario einde: ${escapeHtml(formatCurrencyValue(endScenario, 'EUR'))}</span>
        </div>
        <button type="button" class="btn-secondary" data-toggle-breakdown>Bekijk details</button>
      </section>

      <section class="cashflow-breakdown" ${cashflowState.expanded ? '' : 'hidden'}>
        <div class="cashflow-breakdown__section" data-section="events">
          <div class="cashflow-breakdown__head">
            <h4>Events bijdrage</h4>
            <span class="muted">Auto uit dagomzet</span>
          </div>
          ${hasEventContrib ? renderEventContribList(projection.breakdown.eventContrib) : renderEmptyState('Geen eventbijdragen beschikbaar.', 'events')}
        </div>

        <div class="cashflow-breakdown__section" data-section="fixed">
          <div class="cashflow-breakdown__head">
            <h4>Vaste kosten</h4>
            <span class="muted">Bewerk of verwijder</span>
          </div>
          ${hasFixedCosts ? renderFixedCostsList(finance.fixedCosts) : renderEmptyState('Nog geen vaste kosten.', 'fixed')}
        </div>

        <div class="cashflow-breakdown__section" data-section="open">
          <div class="cashflow-breakdown__head">
            <h4>Open posten</h4>
            <span class="muted">Markeer als betaald</span>
          </div>
          ${hasOpenItems ? renderOpenItemsList(finance.debtors, finance.creditors) : renderEmptyState('Geen open posten.', 'debtor')}
        </div>
      </section>
    </div>
  `;
}

function renderEventContribList(list) {
  const sorted = [...list].sort((a, b) => String(a.monthISO).localeCompare(String(b.monthISO)));
  return `
    <ul class="cashflow-list">
      ${sorted.map((item) => `
        <li>
          <button type="button" class="cashflow-list__item" data-open-event="${escapeHtml(item.eventId)}">
            <div>
              <strong>${escapeHtml(item.name || 'Event')}</strong>
              <span class="muted">${escapeHtml(formatMonthLabel(item.monthISO))} · ${item.source === 'scenario' ? 'Scenario' : 'Actueel'}</span>
            </div>
            <span class="cashflow-list__value">${escapeHtml(formatCurrencyValue(item.netEUR || 0, 'EUR'))}</span>
          </button>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderFixedCostsList(list) {
  return `
    <ul class="cashflow-list">
      ${list.map((item) => `
        <li>
          <div class="cashflow-list__row">
            <div>
              <strong>${escapeHtml(item.name)}</strong>
              <span class="muted">${escapeHtml(formatFrequency(item.frequency))}</span>
            </div>
            <span class="cashflow-list__value">-${escapeHtml(formatCurrencyValue(item.amountEUR || 0, 'EUR'))}</span>
          </div>
          <div class="cashflow-list__actions">
            <button type="button" class="btn-secondary" data-edit-fixed="${escapeHtml(item.id)}">Bewerk</button>
            <button type="button" class="btn-secondary" data-remove-fixed="${escapeHtml(item.id)}">Verwijder</button>
          </div>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderOpenItemsList(debtors, creditors) {
  const openDebtors = debtors.filter(isOpen);
  const openCreditors = creditors.filter(isOpen);
  const debtorsMarkup = openDebtors.length
    ? openDebtors.map((item) => renderOpenItem(item, 'debtor')).join('')
    : '<li class="cashflow-list__empty">Geen open debiteuren.</li>';
  const creditorsMarkup = openCreditors.length
    ? openCreditors.map((item) => renderOpenItem(item, 'creditor')).join('')
    : '<li class="cashflow-list__empty">Geen open crediteuren.</li>';

  return `
    <div class="cashflow-open">
      <div>
        <h5>Debiteuren</h5>
        <ul class="cashflow-list">${debtorsMarkup}</ul>
      </div>
      <div>
        <h5>Crediteuren</h5>
        <ul class="cashflow-list">${creditorsMarkup}</ul>
      </div>
    </div>
  `;
}

function renderOpenItem(item, type) {
  return `
    <li>
      <div class="cashflow-list__row">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <span class="muted">${escapeHtml(formatDueDate(item.dueDateISO))}</span>
        </div>
        <span class="cashflow-list__value">${escapeHtml(formatCurrencyValue(item.amountEUR || 0, 'EUR'))}</span>
      </div>
      <div class="cashflow-list__actions">
        <button type="button" class="btn-secondary" data-mark-paid="${escapeHtml(item.id)}" data-type="${type}">Markeer betaald</button>
      </div>
    </li>
  `;
}

function renderEmptyState(message, ctaForm) {
  return `
    <div class="cashflow-empty">
      <p>${escapeHtml(message)}</p>
      <button type="button" class="btn-secondary" data-open-form="${escapeHtml(ctaForm)}">Toevoegen</button>
    </div>
  `;
}

function bindActions(root, finance, projection) {
  const balanceInput = root.querySelector('[data-balance-input]');
  if (balanceInput) {
    balanceInput.addEventListener('input', () => {
      cashflowState.balanceInput = balanceInput.value;
      refreshCashflowView();
    });
  }

  root.querySelectorAll('[data-open-form]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = btn.dataset.openForm;
      cashflowState.activeForm = form;
      if (form !== 'fixed') cashflowState.editingFixedCostId = null;
      refreshCashflowView();
    });
  });

  root.querySelectorAll('[data-cancel-form]').forEach((btn) => {
    btn.addEventListener('click', () => {
      cashflowState.activeForm = null;
      cashflowState.editingFixedCostId = null;
      refreshCashflowView();
    });
  });

  const fixedForm = root.querySelector('[data-form="fixed"] form');
  if (fixedForm) {
    const editing = finance.fixedCosts.find((item) => item.id === cashflowState.editingFixedCostId);
    if (editing) {
      fixedForm.name.value = editing.name || '';
      fixedForm.amount.value = editing.amountEUR ?? '';
      fixedForm.frequency.value = editing.frequency || 'monthly';
      fixedForm.startDate.value = editing.startDateISO || '';
      fixedForm.active.checked = editing.active !== false;
    }
    fixedForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const payload = {
        id: editing?.id,
        name: fixedForm.name.value.trim(),
        amountEUR: Number(fixedForm.amount.value) || 0,
        frequency: fixedForm.frequency.value,
        startDateISO: fixedForm.startDate.value || null,
        active: fixedForm.active.checked
      };
      if (!payload.name || !payload.amountEUR) {
        showAlert('Vul naam en bedrag in.', 'warning');
        return;
      }
      updateFinanceState((current) => {
        const list = [...current.fixedCosts];
        if (editing) {
          const idx = list.findIndex((item) => item.id === editing.id);
          if (idx >= 0) list[idx] = { ...list[idx], ...payload };
        } else {
          list.push({ ...payload, id: payload.id || null });
        }
        return { ...current, fixedCosts: list };
      });
      cashflowState.activeForm = null;
      cashflowState.editingFixedCostId = null;
      refreshCashflowView();
    });
  }

  root.querySelectorAll('[data-submit="debtor"], [data-submit="creditor"]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const type = form.dataset.submit;
      const payload = {
        name: form.name.value.trim(),
        amountEUR: Number(form.amount.value) || 0,
        dueDateISO: form.dueDate.value || null,
        status: 'open',
        notes: form.notes.value.trim()
      };
      if (!payload.name || !payload.amountEUR) {
        showAlert('Vul naam en bedrag in.', 'warning');
        return;
      }
      updateFinanceState((current) => {
        const key = type === 'debtor' ? 'debtors' : 'creditors';
        return { ...current, [key]: [...current[key], payload] };
      });
      cashflowState.activeForm = null;
      refreshCashflowView();
    });
  });

  root.querySelectorAll('[data-mark-paid]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.markPaid;
      const type = btn.dataset.type;
      updateFinanceState((current) => {
        const key = type === 'creditor' ? 'creditors' : 'debtors';
        const updated = current[key].map((entry) =>
          entry.id === id ? { ...entry, status: 'paid' } : entry
        );
        return { ...current, [key]: updated };
      });
      refreshCashflowView();
    });
  });

  root.querySelectorAll('[data-edit-fixed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      cashflowState.activeForm = 'fixed';
      cashflowState.editingFixedCostId = btn.dataset.editFixed;
      refreshCashflowView();
    });
  });

  root.querySelectorAll('[data-remove-fixed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.removeFixed;
      updateFinanceState((current) => ({
        ...current,
        fixedCosts: current.fixedCosts.filter((item) => item.id !== id)
      }));
      refreshCashflowView();
    });
  });

  root.querySelectorAll('[data-open-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const eventId = btn.dataset.openEvent;
      import('./9_eventdetails.js')
        .then((mod) => mod?.openEventDetail?.(eventId, { initialTab: 'omzet' }))
        .catch(() => showAlert('Eventdetails konden niet worden geopend.', 'error'));
    });
  });

  const toggle = root.querySelector('[data-toggle-breakdown]');
  if (toggle) {
    toggle.addEventListener('click', () => {
      cashflowState.expanded = !cashflowState.expanded;
      refreshCashflowView();
    });
  }

  root.querySelectorAll('[data-scroll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      cashflowState.expanded = true;
      refreshCashflowView();
      requestAnimationFrame(() => {
        const section = root.querySelector(`[data-section="${btn.dataset.scroll}"]`);
        section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  });

  if (cashflowState.activeForm) {
    const form = root.querySelector(`[data-form="${cashflowState.activeForm}"]`);
    form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function drawChart(root, projection) {
  const canvas = root.querySelector('#cashflowChart');
  if (!canvas) return;
  if (chartInstance?.destroy) {
    try {
      chartInstance.destroy();
    } catch (err) {
      console.debug('[Cashflow] Chart cleanup mislukt', err);
    }
    chartInstance = null;
  }
  if (typeof Chart !== 'function') return;
  const labels = projection.months.map((month) => formatMonthLabel(month.monthISO));
  const baseline = projection.months.map((month) => month.baselineBalanceEUR);
  const scenario = projection.months.map((month) => month.scenarioBalanceEUR);
  const context = canvas.getContext('2d');
  if (!context) return;

  chartInstance = new Chart(context, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Baseline',
          data: baseline,
          borderColor: '#8aa29b',
          backgroundColor: 'rgba(138,162,155,.12)',
          tension: 0.35,
          fill: true
        },
        {
          label: 'Scenario',
          data: scenario,
          borderColor: '#2A9626',
          backgroundColor: 'rgba(42,150,38,.18)',
          tension: 0.35,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${formatCurrencyValue(item.parsed?.y || 0, 'EUR')}`
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
}

function formatMonthLabel(monthISO) {
  const parsed = new Date(`${monthISO}-01`);
  if (!Number.isFinite(parsed.getTime())) return monthISO;
  return parsed.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' });
}

function formatFrequency(value) {
  switch (value) {
    case 'weekly':
      return 'Wekelijks';
    case 'yearly':
      return 'Jaarlijks';
    default:
      return 'Maandelijks';
  }
}

function formatDueDate(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.getTime())) return 'Onbekende datum';
  return parsed.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' });
}

function parseEuroInput(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function isOpen(entry) {
  return (entry?.status || 'open') !== 'paid';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .cashflow-shell { display: flex; flex-direction: column; gap: 1rem; }
    .cashflow-header h2 { margin: .2rem 0 0; font-size: 1.4rem; color: #194a1f; }
    .cashflow-eyebrow { margin: 0; font-size: .7rem; font-weight: 800; text-transform: uppercase; color: #5b6a62; }
    .cashflow-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: .75rem; }
    .cashflow-card { background: #fff; border-radius: .9rem; padding: .9rem; border: 1px solid rgba(0,0,0,.06); box-shadow: 0 8px 16px rgba(0,0,0,.08); display: flex; flex-direction: column; gap: .35rem; text-align: left; }
    .cashflow-card strong { font-size: 1.2rem; color: #143814; }
    .cashflow-card__label { font-size: .75rem; font-weight: 800; text-transform: uppercase; color: #5b6a62; }
    .cashflow-card__meta { font-size: .75rem; color: #5b6a62; }
    .cashflow-card--input input { width: 100%; border-radius: .6rem; border: 1px solid rgba(0,0,0,.15); padding: .4rem .6rem; font-weight: 700; }
    .cashflow-actions { display: flex; gap: .6rem; flex-wrap: wrap; }
    .btn-primary { border: none; border-radius: .8rem; background: #2A9626; color: #fff; font-weight: 800; padding: .55rem .9rem; cursor: pointer; }
    .btn-secondary { border: none; border-radius: .8rem; background: rgba(255,197,0,.2); color: #5a4800; font-weight: 800; padding: .55rem .9rem; cursor: pointer; }
    .cashflow-form { background: #fff; border-radius: .9rem; padding: 1rem; border: 1px solid rgba(0,0,0,.06); box-shadow: 0 8px 16px rgba(0,0,0,.06); display: flex; flex-direction: column; gap: .7rem; }
    .cashflow-form__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .6rem; }
    .cashflow-form label { font-size: .85rem; font-weight: 700; color: #35513a; display: flex; flex-direction: column; gap: .35rem; }
    .cashflow-form input, .cashflow-form select, .cashflow-form textarea { border-radius: .6rem; border: 1px solid rgba(0,0,0,.12); padding: .45rem .6rem; font-weight: 700; }
    .cashflow-form__actions { display: flex; gap: .5rem; flex-wrap: wrap; }
    .cashflow-forecast { background: #fff; border-radius: .9rem; padding: 1rem; border: 1px solid rgba(0,0,0,.06); box-shadow: 0 8px 16px rgba(0,0,0,.06); display: flex; flex-direction: column; gap: .7rem; }
    .cashflow-forecast__chart { width: 100%; height: 240px; }
    .cashflow-forecast__summary { display: flex; flex-direction: column; gap: .2rem; font-weight: 800; }
    .cashflow-breakdown { background: #fff; border-radius: .9rem; padding: 1rem; border: 1px solid rgba(0,0,0,.06); box-shadow: 0 8px 16px rgba(0,0,0,.06); display: flex; flex-direction: column; gap: 1rem; }
    .cashflow-breakdown__section { display: flex; flex-direction: column; gap: .6rem; }
    .cashflow-breakdown__head { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
    .cashflow-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .6rem; }
    .cashflow-list__item { width: 100%; background: rgba(25,74,31,.05); border: none; border-radius: .8rem; padding: .7rem; display: flex; justify-content: space-between; align-items: center; text-align: left; cursor: pointer; }
    .cashflow-list__row { display: flex; justify-content: space-between; align-items: center; gap: .6rem; }
    .cashflow-list__value { font-weight: 900; color: #143814; }
    .cashflow-list__actions { display: flex; gap: .4rem; flex-wrap: wrap; }
    .cashflow-list__empty { font-size: .8rem; color: #65716c; }
    .cashflow-open { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: .8rem; }
    .cashflow-empty { display: flex; align-items: center; justify-content: space-between; gap: .6rem; background: rgba(25,74,31,.05); padding: .7rem .8rem; border-radius: .8rem; font-weight: 700; color: #35513a; }
  `;
  document.head.appendChild(style);
}
