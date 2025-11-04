// modules/15_eventSchedule.js
import { db, saveEvent, getKnownLocations } from './3_data.js';
import { showAlert } from './4_ui.js';


function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


export function openEventEditModal(eventId) {
  const event = db.evenementen.find(e => e.id === eventId);
  if (!event) {
    return showAlert('❌ Evenement niet gevonden', 'error');
  }

  // overlay bovenop de bestaande modals
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  Object.assign(overlay.style, {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 4000
  });
  document.body.appendChild(overlay);

  // modal container
  const modal = document.createElement('div');
  Object.assign(modal.style, {
    background: '#fff', padding: '1.5rem',
    borderRadius: '10px', width: '90%', maxWidth: '480px',
    maxHeight: '85vh', overflowY: 'auto', position: 'relative'
  });
  overlay.appendChild(modal);

  // ✕ sluit-knop
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, {
    position: 'absolute', top: '8px', right: '8px',
    background: '#2A9626', border: 'none', fontSize: '1.2rem', cursor: 'pointer'
  });
  closeBtn.onclick = () => overlay.remove();
  modal.appendChild(closeBtn);

  // Titel
  const h2 = document.createElement('h3');
  h2.textContent = `✏️ Bewerk Evenement: ${event.naam}`;
  h2.style.marginTop = '0';
  modal.appendChild(h2);

  // Basisgegevens
  const info = document.createElement('div');
  info.innerHTML = `
    <p><strong>Type:</strong> ${event.type}</p>
    <p><strong>Locatie:</strong> ${event.locatie}</p>
    <p><strong>Periode:</strong> ${event.startdatum} – ${event.einddatum}</p>
    <p><strong>Bus:</strong> ${event.bus}</p>
    <p><strong>Verkopers:</strong> ${event.personen.join(', ')}</p>
    <p><strong>Commissie:</strong> ${event.commissie}%</p>
    <p><strong>Stageld:</strong> €${event.stageld}</p>
    <hr>
  `;
  modal.appendChild(info);

  // Extra kosten lijst
  const kostenSectie = document.createElement('div');
  kostenSectie.style.marginBottom = '1rem';
  kostenSectie.innerHTML = `<h4>➕ Extra Kosten</h4>`;
  const kostenList = document.createElement('ul');
  kostenList.style.padding = '0';
  kostenList.style.listStyle = 'none';
  kostenSectie.appendChild(kostenList);

  function renderKosten() {
    kostenList.innerHTML = '';
    const extra = event.kosten?.extra || [];
    if (extra.length === 0) {
      kostenList.innerHTML = '<li>Geen extra kosten.</li>';
    } else {
      extra.forEach((k, i) => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.marginBottom = '0.4rem';
        li.innerHTML = `
          <span>${k.soort}: €${k.bedrag.toFixed(2)}${k.comment ? ' – ' + k.comment : ''}</span>
          <button type="button" style="background:#c00;color:#fff;border:none;border-radius:4px;padding:2px 6px;cursor:pointer">×</button>
        `;
        li.querySelector('button').onclick = async () => {
          // verwijder deze kost
          event.kosten.extra.splice(i,1);
          await saveEvent(event.id);
          renderKosten();
          showAlert('✅ Kost verwijderd', 'success');
        };
        kostenList.appendChild(li);
      });
    }
  }
  renderKosten();
  modal.appendChild(kostenSectie);

  // Form voor nieuwe extra kost
  const kostForm = document.createElement('div');
  kostForm.style.display = 'flex';
  kostForm.style.flexDirection = 'column';
  kostForm.style.gap = '0.5rem';
  kostForm.style.marginBottom = '1rem';
  kostForm.innerHTML = `
    <select id="newCostType">
    <option value="Diesel">Diesel</option>
    <option value="Overnachten">Overnachten</option>
    <option value="Eten">Eten</option>
    <option value="Anders">Anders</option>
  </select>
  <input type="number" placeholder="Bedrag" id="newCostAmt">
  <input type="text" placeholder="Commentaar (optioneel)" id="newCostComment" style="display:none;">
  <button type="button">Voeg toe</button>
  `;
  modal.appendChild(kostForm);
  
  const selectType   = kostForm.querySelector('#newCostType');
const commentField = kostForm.querySelector('#newCostComment');
selectType.addEventListener('change', () => {
  commentField.style.display = selectType.value === 'Anders' ? 'block' : 'none';
});

  kostForm.querySelector('button').onclick = async () => {
    const soort = kostForm.querySelector('#newCostType').value.trim();
    const bedrag = parseFloat(kostForm.querySelector('#newCostAmt').value);
    const comment = kostForm.querySelector('#newCostComment').value.trim();
    if (!soort || isNaN(bedrag)) {
      return showAlert('⚠️ Vul soort en bedrag correct in.', 'warning');
    }
    event.kosten = event.kosten || {};
    event.kosten.extra = event.kosten.extra || [];
    event.kosten.extra.push({ soort, bedrag, comment });
    await saveEvent(event.id);
    renderKosten();
    showAlert('✅ Extra kost toegevoegd', 'success');
    kostForm.querySelector('#newCostType').value = '';
    kostForm.querySelector('#newCostAmt').value = '';
    kostForm.querySelector('#newCostComment').value = '';
  };

  // Bewerk-knop: sluit deze modal en opent de schedule-modal met eventData
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.textContent = '✏️ Bewerk in formulier';
  Object.assign(editBtn.style, {
    background: '#2A9626', color: '#fff',
    border: 'none', padding: '0.6rem 1rem',
    borderRadius: '6px', cursor: 'pointer'
  });
  editBtn.onclick = () => {
    overlay.remove();
    openEventScheduleModal(event);
  };
  modal.appendChild(editBtn);
}

export function openPlannedEventsModal() {
  // overlay bovenop de bestaande modal
  const overlay2 = document.createElement('div');
  overlay2.className = 'modal';
  Object.assign(overlay2.style, {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 3000
  });

  // container
  const modal2 = document.createElement('div');
  Object.assign(modal2.style, {
    background: '#fff', padding: '1rem',
    borderRadius: '10px', width: '90%', maxWidth: '400px',
    maxHeight: '80vh', overflowY: 'auto', position: 'relative'
  });

  // sluit-knop
  const close2 = document.createElement('button');
  close2.type = 'button';
  close2.textContent = '✕';
  Object.assign(close2.style, {
    position: 'absolute', top: '8px', right: '8px',
    background: 'transparent', border: 'none',
    fontSize: '1.2rem', cursor: 'pointer'
  });
  close2.onclick = () => overlay2.remove();
  modal2.appendChild(close2);

  // header
  const h2 = document.createElement('h3');
  h2.textContent = '📋 Geplande Evenementen';
  modal2.appendChild(h2);

  // filter op state==='planned'
  const planned = db.evenementen.filter(e => e.state === 'planned');
  if (planned.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Geen geplande evenementen.';
    modal2.appendChild(p);
  } else {
    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    planned.forEach(evt => {
      const li = document.createElement('li');
      li.style.marginBottom = '0.75rem';

      const span = document.createElement('span');
      span.textContent = `${evt.naam} (${evt.startdatum} – ${evt.einddatum})`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Bewerken';
      btn.style.marginLeft = '0.5rem';
      btn.onclick = () => {
        overlay2.remove();
        // heropen de schedule-modal in bewerk-modus
        openEventEditModal(evt.id);
      };

      li.append(span, btn);
      ul.appendChild(li);
    });
    modal2.appendChild(ul);
  }

  overlay2.appendChild(modal2);
  document.body.appendChild(overlay2);
}

export function openEventScheduleModal(eventData = null) {
  const isNew = !eventData || !eventData.id;

  // --- CSS injectie (eerder toegevoegd) blijft ongewijzigd ---
  // (zie vorige versie)

  // --- Sluit oude modals ---
  document.querySelectorAll('.modal').forEach(m => m.remove());

  // --- Overlay & modal container ---
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  Object.assign(overlay.style, {
    position:'fixed', inset:0,
    background:'rgba(0,0,0,0.4)',
    display:'flex', alignItems:'center', justifyContent:'center',
    zIndex:2000
  });
  const modal = document.createElement('div');
  modal.id = 'scheduleModal';
  Object.assign(modal.style, {
    background:'#fff', padding:'1.5rem',
    borderRadius:'12px', width:'90%', maxWidth:'500px',
    maxHeight:'90vh', overflowY:'auto',
    boxShadow:'0 8px 24px rgba(0,0,0,0.25)'
  });

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('h2');
  title.textContent = isNew ? '📅 Nieuw Evenement Plannen' : '✏️ Bewerk Evenement';
  title.style.color = '#2A9626';
  header.appendChild(title);
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const listBtn = document.createElement('button');
  listBtn.type = 'button';
  listBtn.className = 'save-btn';
  listBtn.textContent = 'Evenementenlijst';
  listBtn.style.width = 'auto';
  listBtn.addEventListener('click', e => {
   e.preventDefault();
  openPlannedEventsModal();
 });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cancel-btn';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => overlay.remove());
  actions.append(listBtn, closeBtn);
  header.appendChild(actions);
  modal.appendChild(header);

  // --- Formulier ---
  const form = document.createElement('form');
  form.id = 'scheduleForm';
  const locationOptions = getKnownLocations();
  const locationOptionsHtml = locationOptions
    .map(loc => `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`)
    .join('');
  form.innerHTML = `
    <div class="form-field">
      <label for="evtName">Naam evenement</label>
      <input type="text" id="evtName" readonly required>
    </div>
    <div class="form-field">
      <label for="evtType">Type evenement</label>
      <select id="evtType">
        <option value="">Kies type</option>
        <option value="BX">BX</option>
        <option value="Bazaar">Bazaar</option>
      </select>
    </div>
    <div class="form-field">
      <label for="evtLocation">Locatie</label>
      <select id="evtLocation">
        <option value="">Kies locatie</option>
        ${locationOptionsHtml || '<option value="" disabled>(Geen locaties beschikbaar)</option>'}
      </select>
    </div>
    <div class="form-field">
      <label for="evtStart">Startdatum</label>
      <input type="date" id="evtStart">
    </div>
    <div class="form-field">
      <label for="evtEnd">Einddatum</label>
      <input type="date" id="evtEnd">
    </div>
    <div class="form-field">
      <label for="evtBus">Bus</label>
      <select id="evtBus">
        ${Object.keys(db.voorraad).map(b=>`<option value="${b}">${b}</option>`).join('')}
      </select>
    </div>
    <fieldset class="form-field">
      <legend>Verkopers</legend>
      <label class="pretty-checkbox">
        <input type="checkbox" name="personen" value="Olga"> Olga
      </label>
      <label class="pretty-checkbox">
        <input type="checkbox" name="personen" value="Alberto"> Alberto
      </label>
    </fieldset>
    <div class="form-field">
      <label for="evtCommission">Commissie %</label>
      <input type="number" id="evtCommission" step="0.1" value="0">
    </div>
    <div class="form-field">
      <label for="evtStipend">Stageld (€)</label>
      <input type="number" id="evtStipend" step="1" min="0">
    </div>
    <fieldset class="form-field" id="evtPlanningBlock" style="border:1px solid #d1d5db;border-radius:12px;padding:1rem;display:flex;flex-direction:column;gap:.75rem;">
      <legend style="font-weight:800;color:#194a1f;padding:0 .4rem;">Voorraadplanning</legend>
      <div class="planning-turnover-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;">
        <label style="display:flex;flex-direction:column;font-weight:700;color:#194a1f;gap:.35rem;">
          Verwachte omzet (USD)
          <input type="number" id="evtTurnoverUsd" step="0.01" min="0" placeholder="0" style="border:1px solid #d0d5dd;border-radius:.7rem;padding:.55rem .65rem;font-weight:700;">
        </label>
        <label style="display:flex;flex-direction:column;font-weight:700;color:#194a1f;gap:.35rem;">
          Verwachte omzet (EUR)
          <input type="number" id="evtTurnoverEur" step="0.01" min="0" placeholder="0" style="border:1px solid #d0d5dd;border-radius:.7rem;padding:.55rem .65rem;font-weight:700;">
        </label>
      </div>
      <small id="evtMixSummary" style="display:block;font-size:.8rem;color:#4b5563;font-weight:600;"></small>
      <div>
        <label style="display:block;font-weight:800;color:#194a1f;margin-bottom:.4rem;">Geplande startvoorraad (stuks)</label>
        <div class="planning-cheese-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.6rem;">
          <label style="display:flex;flex-direction:column;font-weight:700;color:#194a1f;gap:.35rem;">
            BG
            <input type="number" id="evtEstimateBG" min="0" step="1" placeholder="0" style="border:1px solid #d0d5dd;border-radius:.7rem;padding:.55rem .65rem;font-weight:700;">
          </label>
          <label style="display:flex;flex-direction:column;font-weight:700;color:#194a1f;gap:.35rem;">
            ROOK
            <input type="number" id="evtEstimateRook" min="0" step="1" placeholder="0" style="border:1px solid #d0d5dd;border-radius:.7rem;padding:.55rem .65rem;font-weight:700;">
          </label>
          <label style="display:flex;flex-direction:column;font-weight:700;color:#194a1f;gap:.35rem;">
            GEIT
            <input type="number" id="evtEstimateGeit" min="0" step="1" placeholder="0" style="border:1px solid #d0d5dd;border-radius:.7rem;padding:.55rem .65rem;font-weight:700;">
          </label>
        </div>
      </div>
      <div class="planning-actions" style="display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;">
        <button type="button" id="evtCalcSupply" style="background:#FFE36A;color:#5a4700;border:none;border-radius:.75rem;padding:.55rem 1rem;font-weight:800;cursor:pointer;">Bereken o.b.v. mix</button>
        <small id="evtEstimateHint" style="font-size:.8rem;color:#4b5563;font-weight:600;"></small>
      </div>
    </fieldset>
    <button type="button" class="save-btn" id="saveScheduleBtn">✅ Opslaan</button>
  `;
  modal.appendChild(form);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // --- References & automatische naam ---
  const nameInput      = form.querySelector('#evtName');
  const typeSelect     = form.querySelector('#evtType');
  const locationSelect = form.querySelector('#evtLocation');
  const startInput     = form.querySelector('#evtStart');
  const turnoverUsdInput = form.querySelector('#evtTurnoverUsd');
  const turnoverEurInput = form.querySelector('#evtTurnoverEur');
  const cheeseInputs = {
    BG: form.querySelector('#evtEstimateBG'),
    ROOK: form.querySelector('#evtEstimateRook'),
    GEIT: form.querySelector('#evtEstimateGeit')
  };
  const calcBtn = form.querySelector('#evtCalcSupply');
  const mixSummary = form.querySelector('#evtMixSummary');
  const estimateHint = form.querySelector('#evtEstimateHint');

  let lastEstimateInfo = null;
  let isApplyingEstimate = false;
  let planningCleared = false;
  let autoSuggestionInfo = null;
  let isApplyingTurnoverSuggestion = false;
  let userEditedTurnover = false;

  const averagePrices = computeAveragePrices();

  updateMixSummary();
  setEstimateHint('empty');

  calcBtn?.addEventListener('click', () => {
    const selection = getTurnoverSelection();
    if (selection.amount <= 0) {
      setEstimateHint('empty');
      return;
    }
    const mix = getCategoryMixSnapshot();
    const estimate = estimateCheeseFromTurnover(selection.amount, selection.currency, mix);
    applyEstimateToInputs(estimate);
    const crateInfo = computeCrateBreakdown(estimate);
    const now = new Date().toISOString();
    lastEstimateInfo = {
      currency: selection.currency,
      amount: selection.amount,
      mix,
      method: 'mix',
      averagePrices: {
        currency: selection.currency,
        ...cloneAveragePriceSnapshot(selection.currency)
      },
      timestamp: now,
      crates: crateInfo,
      reason: {
        method: 'manual-mix',
        label: 'Berekening via verkoopmix',
        matches: 0
      }
    };
    autoSuggestionInfo = null;
    setEstimateHint('calculated', lastEstimateInfo);
  });

  [turnoverUsdInput, turnoverEurInput].forEach(input => {
    input?.addEventListener('input', () => {
      if (!isApplyingTurnoverSuggestion) {
        userEditedTurnover = true;
        autoSuggestionInfo = null;
      }
      lastEstimateInfo = null;
      const selection = getTurnoverSelection();
      if (selection.amount > 0) {
        setEstimateHint('pending', selection);
      } else {
        setEstimateHint('empty');
      }
    });
    input?.addEventListener('change', () => {
      if (isApplyingTurnoverSuggestion) return;
      const usdVal = toPositiveNumber(turnoverUsdInput?.value);
      const eurVal = toPositiveNumber(turnoverEurInput?.value);
      if (!usdVal && !eurVal) {
        userEditedTurnover = false;
      }
    });
  });

  Object.values(cheeseInputs).forEach(input => {
    input?.addEventListener('input', () => {
      if (isApplyingEstimate) return;
      autoSuggestionInfo = null;
      lastEstimateInfo = null;
      const totals = readCheeseInputs();
      const hasTotals = totals.BG > 0 || totals.ROOK > 0 || totals.GEIT > 0;
      setEstimateHint(hasTotals ? 'manual-cheese' : 'empty');
    });
  });

  function computeAveragePrices() {
    const currencies = {
      usd: { BG: { sum: 0, count: 0 }, ROOK: { sum: 0, count: 0 }, GEIT: { sum: 0, count: 0 } },
      eur: { BG: { sum: 0, count: 0 }, ROOK: { sum: 0, count: 0 }, GEIT: { sum: 0, count: 0 } }
    };
    (db.producten || []).forEach(product => {
      const type = String(product?.type || '').toUpperCase();
      if (!['BG', 'ROOK', 'GEIT'].includes(type)) return;
      const usd = Number(product?.usd);
      const eur = Number(product?.eur);
      if (Number.isFinite(usd) && usd > 0) {
        currencies.usd[type].sum += usd;
        currencies.usd[type].count += 1;
      }
      if (Number.isFinite(eur) && eur > 0) {
        currencies.eur[type].sum += eur;
        currencies.eur[type].count += 1;
      }
    });
    const defaults = { usd: 20, eur: 18 };
    const result = { usd: {}, eur: {} };
    ['usd', 'eur'].forEach(currency => {
      ['BG', 'ROOK', 'GEIT'].forEach(type => {
        const entry = currencies[currency][type];
        if (entry.count > 0) {
          result[currency][type] = entry.sum / entry.count;
        } else {
          result[currency][type] = defaults[currency];
        }
      });
    });
    return result;
  }

  function cloneAveragePriceSnapshot(currency) {
    const bucket = averagePrices?.[currency] || {};
    return {
      BG: Number(bucket.BG || 0),
      ROOK: Number(bucket.ROOK || 0),
      GEIT: Number(bucket.GEIT || 0)
    };
  }

  function getTurnoverSelection() {
    const usd = toPositiveNumber(turnoverUsdInput?.value);
    const eur = toPositiveNumber(turnoverEurInput?.value);
    if (usd > 0) return { amount: usd, currency: 'usd' };
    if (eur > 0) return { amount: eur, currency: 'eur' };
    return { amount: 0, currency: 'usd' };
  }

  function estimateCheeseFromTurnover(amount, currency, mix) {
    const normalizedMix = normalizeMixSnapshot(mix);
    const prices = cloneAveragePriceSnapshot(currency);
    const result = { BG: 0, ROOK: 0, GEIT: 0 };
    const crateMeta = {};
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
      const price = Number(prices[type] || 0);
      if (!price) return;
      const share = normalizedMix[type] || 0;
      if (share <= 0) return;
      const rawQuantity = Math.max(0, Math.ceil((amount * share) / price));
      const crateSize = getCategoryCrateSize(type);
      const crates = crateSize > 1 ? Math.ceil(rawQuantity / crateSize) : rawQuantity;
      const quantity = crateSize > 1 ? crates * crateSize : rawQuantity;
      result[type] = quantity;
      crateMeta[type] = { crates, size: crateSize, units: quantity };
    });
    result.__meta = { crates: crateMeta };
    return result;
  }

  function computeCrateBreakdown(estimate) {
    const breakdown = {};
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
      const qty = Math.max(0, Math.round(Number(estimate?.[type] || 0)));
      const meta = estimate?.__meta?.crates?.[type] || {};
      const size = Math.max(1, Math.round(Number(meta.size || getCategoryCrateSize(type))));
      let crates = meta.crates != null ? Math.max(0, Math.round(Number(meta.crates))) : null;
      if (crates == null) {
        crates = size > 1 ? Math.ceil(qty / size) : qty;
      }
      const units = size > 1 ? crates * size : qty;
      breakdown[type] = { crates, size, units };
    });
    return breakdown;
  }

  function cloneCrateBreakdown(source) {
    const clone = {};
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
      const entry = source?.[type] || {};
      const size = Math.max(1, Math.round(Number(entry.size || entry.capacity || getCategoryCrateSize(type))));
      const crates = Math.max(0, Math.round(Number(entry.crates || entry.count || 0)));
      let units = Math.max(0, Math.round(Number(entry.units || entry.total || crates * size)));
      if (!units) units = crates * size;
      clone[type] = { crates, size, units };
    });
    return clone;
  }

  function formatCrateSummary(crates) {
    if (!crates || typeof crates !== 'object') return '';
    const parts = [];
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
      const entry = crates[type];
      if (!entry) return;
      const cratesCount = Math.max(0, Math.round(Number(entry.crates || 0)));
      if (!cratesCount) return;
      const units = Math.max(0, Math.round(Number(entry.units || cratesCount * getCategoryCrateSize(type))));
      const label = cratesCount === 1 ? 'krat' : 'kratten';
      parts.push(`${type} ${cratesCount} ${label} (${units} stuks)`);
    });
    return parts.join(' • ');
  }

  function getCategoryCrateSize(type) {
    const key = String(type || '').toUpperCase();
    if (key === 'ROOK') return 10;
    if (key === 'BG') return 18;
    if (key === 'GEIT') return 15;
    return 1;
  }

  function applyEstimateToInputs(estimate) {
    isApplyingEstimate = true;
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
      const input = cheeseInputs[type];
      if (!input) return;
      const value = Math.max(0, Math.round(Number(estimate?.[type] || 0)));
      input.value = value ? String(value) : '';
    });
    isApplyingEstimate = false;
  }

  function readCheeseInputs() {
    const totals = { BG: 0, ROOK: 0, GEIT: 0 };
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
      const input = cheeseInputs[type];
      if (!input) return;
      const val = Math.max(0, Math.round(Number(input.value || 0)));
      totals[type] = val;
    });
    return totals;
  }

  function setEstimateHint(mode, meta = {}) {
    if (!estimateHint) return;
    if (mode === 'calculated') {
      const amountText = meta.amount && meta.currency ? formatCurrency(meta.amount, meta.currency) : '';
      const mixText = meta.mix ? formatMixSummary(meta.mix) : '';
      const reasonLabel = meta.reason?.label || '';
      const crateText = formatCrateSummary(meta.crates);
      const parts = [];
      if (reasonLabel) parts.push(reasonLabel);
      if (amountText) parts.push(amountText);
      if (mixText) parts.push('mix ' + mixText);
      if (crateText) parts.push('Bestellijst: ' + crateText);
      let textValue = parts.filter(Boolean).join(' • ');
      if (!textValue) textValue = 'Advies bijgewerkt.';
      const ts = meta.timestamp ? new Date(meta.timestamp).toLocaleString('nl-NL') : '';
      if (ts) textValue += ' — ' + ts;
      estimateHint.textContent = textValue;
    } else if (mode === 'pending') {
      const currencyLabel = meta.currency === 'eur' ? 'EUR' : 'USD';
      estimateHint.textContent = `Klik op “Bereken o.b.v. mix” om een advies te krijgen voor ${currencyLabel}.`;
    } else if (mode === 'manual-cheese') {
      estimateHint.textContent = 'Voorraadplanning handmatig aangepast.';
    } else {
      estimateHint.textContent = 'Voer een verwachte omzet in en klik op “Bereken o.b.v. mix” voor een adviesvoorraad.';
    }
  }

  function updateMixSummary() {
    if (!mixSummary) return;
    const mix = getCategoryMixSnapshot();
    const mixText = formatMixSummary(mix);
    const updated = db?.verkoopMix?.updatedAt;
    const suffix = updated ? ` (laatste update ${new Date(updated).toLocaleDateString('nl-NL')})` : '';
    mixSummary.textContent = `Huidige verkoopmix: ${mixText}${suffix}`;
  }

  function getCategoryMixSnapshot() {
    const mix = db?.verkoopMix || {};
    const ratio = mix?.ratio?.categories;
    if (ratio && Object.values(ratio).some(v => Number(v) > 0)) {
      return normalizeMixSnapshot(ratio);
    }
    const totals = mix?.totals?.categories;
    if (totals && Object.values(totals).some(v => Number(v) > 0)) {
      return normalizeMixSnapshot(totals);
    }
    return { BG: 1 / 3, ROOK: 1 / 3, GEIT: 1 / 3 };
  }

  function normalizeMixSnapshot(raw) {
    const base = { BG: 0, ROOK: 0, GEIT: 0 };
    if (!raw || typeof raw !== 'object') return base;
    let total = 0;
    ['BG', 'ROOK', 'GEIT'].forEach(type => {
      const value = Math.max(0, Number(raw?.[type] ?? raw?.[type?.toLowerCase?.()]));
      base[type] = value;
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

  function formatMixSummary(mix) {
    const normalized = normalizeMixSnapshot(mix);
    return `BG ${(normalized.BG * 100).toFixed(0)}% • ROOK ${(normalized.ROOK * 100).toFixed(0)}% • GEIT ${(normalized.GEIT * 100).toFixed(0)}%`;
  }

  function hasTurnoverValues() {
    return toPositiveNumber(turnoverUsdInput?.value) > 0 || toPositiveNumber(turnoverEurInput?.value) > 0;
  }

  function formatTurnoverValue(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return '';
    return Math.abs(amount % 1) < 1e-6 ? String(Math.round(amount)) : amount.toFixed(2);
  }

  function detectPreferredCurrency() {
    const planningCurrency = eventData?.planning?.expectedTurnover?.currency || eventData?.planning?.estimateMeta?.currency;
    if (planningCurrency && typeof planningCurrency === 'string') {
      const normalized = planningCurrency.trim().toLowerCase();
      if (normalized === 'usd' || normalized === 'eur') {
        return normalized;
      }
    }
    const usdVal = toPositiveNumber(turnoverUsdInput?.value);
    const eurVal = toPositiveNumber(turnoverEurInput?.value);
    if (usdVal > eurVal) return 'usd';
    if (eurVal > usdVal) return 'eur';
    return null;
  }

  function maybeAutoEstimateFromHistory(options = {}) {
    const { force = false, allowUpdate = false } = options;
    if (!typeSelect?.value || !locationSelect?.value) return;
    const hasValues = hasTurnoverValues();
    if (!force) {
      if (userEditedTurnover) return;
      if (hasValues && !(allowUpdate && autoSuggestionInfo)) return;
    }
    const suggestion = calculateHistoricalTurnoverSuggestion({
      type: typeSelect.value,
      location: locationSelect.value,
      preferredCurrency: detectPreferredCurrency(),
      excludeEventId: eventData?.id || null
    });
    if (!suggestion || suggestion.amount <= 0) return;
    applyTurnoverSuggestion(suggestion);
  }

  function applyTurnoverSuggestion(suggestion) {
    isApplyingTurnoverSuggestion = true;
    if (suggestion.currency === 'usd') {
      if (turnoverUsdInput) turnoverUsdInput.value = formatTurnoverValue(suggestion.amount);
      if (turnoverEurInput) turnoverEurInput.value = '';
    } else {
      if (turnoverEurInput) turnoverEurInput.value = formatTurnoverValue(suggestion.amount);
      if (turnoverUsdInput) turnoverUsdInput.value = '';
    }
    isApplyingTurnoverSuggestion = false;
    autoSuggestionInfo = suggestion;
    userEditedTurnover = false;

    const mix = getCategoryMixSnapshot();
    const estimate = estimateCheeseFromTurnover(suggestion.amount, suggestion.currency, mix);
    applyEstimateToInputs(estimate);
    const crateInfo = computeCrateBreakdown(estimate);
    const now = new Date().toISOString();
    lastEstimateInfo = {
      currency: suggestion.currency,
      amount: suggestion.amount,
      mix,
      method: suggestion.reason?.method || 'history',
      averagePrices: {
        currency: suggestion.currency,
        ...cloneAveragePriceSnapshot(suggestion.currency)
      },
      timestamp: now,
      crates: crateInfo,
      reason: suggestion.reason
    };
    setEstimateHint('calculated', lastEstimateInfo);
  }

  function calculateHistoricalTurnoverSuggestion(context = {}) {
    const type = String(context.type || '').trim();
    const location = String(context.location || '').trim();
    const preferredCurrency = String(context.preferredCurrency || '').trim().toLowerCase();
    const excludeId = context.excludeEventId;
    const groups = {
      locType: createHistoryGroup('locType'),
      location: createHistoryGroup('location'),
      type: createHistoryGroup('type'),
      global: createHistoryGroup('global')
    };
    const events = Array.isArray(db.evenementen) ? db.evenementen : [];
    const now = Date.now();
    events.forEach(evt => {
      if (!evt || evt.id === excludeId) return;
      const turnover = resolveEventTurnover(evt);
      if (!turnover || (turnover.eur <= 0 && turnover.usd <= 0)) return;
      const endDate = parseEventDate(evt.einddatum) || parseEventDate(evt.startdatum) || null;
      const state = String(evt.state || '').toLowerCase();
      const isPastState = ['done', 'completed', 'gefinished', 'archived', 'afgerond', 'closed'].includes(state);
      const isPastDate = endDate ? endDate.getTime() <= now : false;
      if (!isPastState && !isPastDate) return;
      const recencyWeight = computeRecencyWeight(endDate);
      const weight = turnover.confidence * recencyWeight;
      if (!weight || weight <= 0) return;
      const matchesLocation = location && String(evt.locatie || '') === location;
      const matchesType = type && String(evt.type || '') === type;
      const info = { id: evt.id, naam: evt.naam, locatie: evt.locatie, type: evt.type, turnover, endDate, weight };
      if (matchesLocation && matchesType) addEventToHistoryGroup(groups.locType, info);
      if (matchesLocation) addEventToHistoryGroup(groups.location, info);
      if (matchesType) addEventToHistoryGroup(groups.type, info);
      addEventToHistoryGroup(groups.global, info);
    });

    const priority = ['locType', 'location', 'type', 'global'];
    for (const key of priority) {
      const group = groups[key];
      if (!group) continue;
      const currency = selectHistoryCurrency(group, preferredCurrency);
      if (!currency) continue;
      const total = group.totals[currency];
      const weight = group.weights[currency];
      if (!weight || !total) continue;
      const average = total / weight;
      if (!Number.isFinite(average) || average <= 0) continue;
      const amount = roundSuggestedTurnover(average);
      if (amount <= 0) continue;
      return {
        currency,
        amount,
        average,
        reason: buildSuggestionReason(key, group, currency, { type, location })
      };
    }
    return null;
  }

  function createHistoryGroup(key) {
    return { key, totals: { usd: 0, eur: 0 }, weights: { usd: 0, eur: 0 }, events: [] };
  }

  function addEventToHistoryGroup(group, eventInfo) {
    if (!group) return;
    const { turnover, weight } = eventInfo;
    if (turnover.eur > 0) {
      group.totals.eur += turnover.eur * weight;
      group.weights.eur += weight;
    }
    if (turnover.usd > 0) {
      group.totals.usd += turnover.usd * weight;
      group.weights.usd += weight;
    }
    group.events.push({
      id: eventInfo.id,
      name: eventInfo.naam,
      location: eventInfo.locatie,
      type: eventInfo.type,
      amount: { eur: turnover.eur, usd: turnover.usd },
      weight,
      confidence: turnover.confidence,
      currency: turnover.primaryCurrency,
      source: turnover.source,
      endDate: eventInfo.endDate
    });
  }

  function selectHistoryCurrency(group, preferredCurrency) {
    const weights = group.weights || {};
    const order = ['usd', 'eur'];
    let best = null;
    let bestWeight = 0;
    order.forEach(cur => {
      const value = weights[cur] || 0;
      if (value > bestWeight) {
        best = cur;
        bestWeight = value;
      }
    });
    if (preferredCurrency && (weights[preferredCurrency] || 0) > 0) {
      const preferredWeight = weights[preferredCurrency] || 0;
      if (!best || preferredWeight >= bestWeight * 0.85) {
        return preferredCurrency;
      }
    }
    if (!best || (weights[best] || 0) <= 0) {
      if (preferredCurrency && (weights[preferredCurrency] || 0) > 0) return preferredCurrency;
      return null;
    }
    return best;
  }

  function buildSuggestionReason(groupKey, group, currency, context) {
    const matches = group.events.filter(evt => {
      const amount = currency === 'usd' ? evt.amount.usd : evt.amount.eur;
      return Number.isFinite(amount) && amount > 0;
    });
    if (!matches.length) {
      return { method: 'history', group: groupKey, label: 'Historisch advies', matches: 0, currency };
    }
    matches.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    const topNames = matches.slice(0, 2).map(evt => evt.name || evt.id).filter(Boolean);
    let labelBase = 'Historische events';
    if (groupKey === 'locType' && context.location && context.type) {
      labelBase = context.location + ' • ' + context.type;
    } else if (groupKey === 'location' && context.location) {
      labelBase = context.location;
    } else if (groupKey === 'type' && context.type) {
      labelBase = 'Type ' + context.type;
    }
    const confidence = Math.min(1, matches.reduce((sum, evt) => sum + (evt.confidence || 0), 0) / matches.length || 0);
    return {
      method: 'history',
      group: groupKey,
      label: `${labelBase}: ${matches.length} vergelijkbare events`,
      matches: matches.length,
      currency,
      confidence,
      events: matches.map(evt => ({
        id: evt.id,
        name: evt.name,
        amount: currency === 'usd' ? evt.amount.usd : evt.amount.eur,
        weight: evt.weight,
        source: evt.source,
        endDate: evt.endDate instanceof Date ? evt.endDate.toISOString().slice(0, 10) : evt.endDate
      })),
      sample: topNames
    };
  }

  function roundSuggestedTurnover(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    if (amount < 500) return Math.round(amount / 25) * 25;
    if (amount < 2000) return Math.round(amount / 50) * 50;
    if (amount < 5000) return Math.round(amount / 100) * 100;
    return Math.round(amount / 250) * 250;
  }

  function computeRecencyWeight(endDate) {
    if (!endDate || !Number.isFinite(endDate?.getTime())) return 1;
    const diffDays = (Date.now() - endDate.getTime()) / (1000 * 60 * 60 * 24);
    if (!Number.isFinite(diffDays)) return 1;
    if (diffDays <= 30) return 1.15;
    const months = diffDays / 30;
    const weight = 1.15 - months * 0.1;
    return Math.max(0.35, weight);
  }

  function parseEventDate(value) {
    if (!value) return null;
    const direct = new Date(value);
    if (Number.isFinite(direct.getTime())) return direct;
    const str = String(value).trim();
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      if (Number.isFinite(date.getTime())) return date;
    }
    return null;
  }

  function resolveEventTurnover(evt) {
    if (!evt) return null;
    const toNumber = value => {
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    };
    let eur = 0;
    let usd = 0;
    let source = null;
    let confidence = 0;

    const list = Array.isArray(evt.omzet) ? evt.omzet : Array.isArray(evt.omzet?.entries) ? evt.omzet.entries : [];
    list.forEach(entry => {
      if (!entry || typeof entry !== 'object') return;
      const eurVal = toNumber(entry.eur ?? entry.prijs_eur ?? entry.amountEUR);
      const usdVal = toNumber(entry.usd ?? entry.prijs_usd ?? entry.amountUSD);
      if (eurVal) eur += eurVal;
      if (usdVal) usd += usdVal;
    });
    if (eur > 0 || usd > 0) {
      source = 'omzet';
      confidence = 1;
    }

    const aggEUR = toNumber(evt.omzet?.eur ?? evt.omzet?.totalEUR ?? evt.omzet?.amountEUR ?? evt.omzetEUR ?? evt.omzet_eur);
    const aggUSD = toNumber(evt.omzet?.usd ?? evt.omzet?.totalUSD ?? evt.omzet?.amountUSD ?? evt.omzetUSD ?? evt.omzet_usd);
    if (aggEUR > 0 || aggUSD > 0) {
      if (aggEUR > eur) eur = aggEUR;
      if (aggUSD > usd) usd = aggUSD;
      if (!source) source = 'omzet';
      confidence = Math.max(confidence, 0.9);
    }

    if (eur <= 0 && usd <= 0) {
      const categories = evt?.kaasTelling?.sales?.categories || evt?.kaasTelling?.verkoop?.categories;
      if (categories && typeof categories === 'object') {
        let eurEstimate = 0;
        let usdEstimate = 0;
        ['BG', 'ROOK', 'GEIT'].forEach(type => {
          const qty = Math.max(0, Number(categories?.[type] ?? categories?.[type?.toLowerCase?.()]) || 0);
          if (!qty) return;
          const eurPrice = Number(averagePrices?.eur?.[type] || 0);
          const usdPrice = Number(averagePrices?.usd?.[type] || 0);
          if (eurPrice > 0) eurEstimate += qty * eurPrice;
          if (usdPrice > 0) usdEstimate += qty * usdPrice;
        });
        if (eurEstimate > 0 || usdEstimate > 0) {
          eur = Math.max(eur, eurEstimate);
          usd = Math.max(usd, usdEstimate);
          source = 'kaasverkoop';
          confidence = Math.max(confidence, 0.75);
        }
      }
    }

    if (eur <= 0 && usd <= 0) {
      const planning = evt?.planning?.expectedTurnover || evt?.planning;
      const planEUR = toNumber(planning?.eur ?? planning?.EUR ?? planning?.amountEUR ?? evt?.planning?.expectedTurnoverEUR);
      const planUSD = toNumber(planning?.usd ?? planning?.USD ?? planning?.amountUSD ?? evt?.planning?.expectedTurnoverUSD);
      if (planEUR > 0 || planUSD > 0) {
        eur = Math.max(eur, planEUR);
        usd = Math.max(usd, planUSD);
        source = 'planning';
        confidence = Math.max(confidence, 0.45);
      }
    }

    if (eur <= 0 && usd <= 0) {
      const metaAmount = toNumber(evt?.planning?.estimateMeta?.amount);
      const metaCurrency = String(evt?.planning?.estimateMeta?.currency || '').toLowerCase();
      if (metaAmount > 0) {
        if (metaCurrency === 'usd') {
          usd = Math.max(usd, metaAmount);
        } else if (metaCurrency === 'eur') {
          eur = Math.max(eur, metaAmount);
        }
        if (!source) source = 'planning';
        confidence = Math.max(confidence, 0.35);
      }
    }

    if (eur <= 0 && usd <= 0) return null;

    const primaryCurrency = determineEventCurrency(evt, eur, usd);
    return { eur: Math.max(0, eur), usd: Math.max(0, usd), source, confidence, primaryCurrency };
  }

  function determineEventCurrency(evt, eur, usd) {
    const candidates = [
      evt?.planning?.expectedTurnover?.currency,
      evt?.planning?.estimateMeta?.currency,
      evt?.omzet?.currency,
      evt?.currency,
      evt?.defaultCurrency,
      evt?.valuta
    ];
    for (const value of candidates) {
      if (typeof value !== 'string') continue;
      const normalized = value.trim().toLowerCase();
      if (normalized === 'usd' || normalized === 'eur') return normalized;
    }
    if (usd > eur && usd > 0) return 'usd';
    if (eur > 0) return 'eur';
    if (usd > 0) return 'usd';
    return 'eur';
  }

  function toPositiveNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }

  function formatCurrency(amount, currency) {
    if (!Number.isFinite(amount) || amount <= 0) return '';
    try {
      return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: currency?.toUpperCase() || 'USD' }).format(amount);
    } catch {
      return `${currency?.toUpperCase() || ''} ${amount.toFixed(2)}`.trim();
    }
  }

  function cloneMixSnapshot(mix) {
    const normalized = normalizeMixSnapshot(mix);
    return { ...normalized };
  }

  function applyPlanningToForm(planning) {
    if (!planning) {
      autoSuggestionInfo = null;
      userEditedTurnover = false;
      setEstimateHint('empty');
      return;
    }
    const hasUsd = Number(planning?.expectedTurnover?.usd || 0) > 0;
    const hasEur = Number(planning?.expectedTurnover?.eur || 0) > 0;
    if (planning.expectedTurnover) {
      if (turnoverUsdInput) {
        turnoverUsdInput.value = hasUsd ? String(planning.expectedTurnover.usd) : '';
      }
      if (turnoverEurInput) {
        turnoverEurInput.value = hasEur ? String(planning.expectedTurnover.eur) : '';
      }
      userEditedTurnover = hasUsd || hasEur;
    } else {
      userEditedTurnover = false;
    }
    if (planning.cheeseEstimate) {
      applyEstimateToInputs(planning.cheeseEstimate);
    }
    if (planning.estimateMeta) {
      lastEstimateInfo = {
        currency: planning.estimateMeta.currency,
        amount: planning.estimateMeta.amount,
        mix: cloneMixSnapshot(planning.estimateMeta.mix || planning.mixSnapshot),
        method: planning.estimateMeta.method || 'mix',
        averagePrices: planning.estimateMeta.averagePrices ? { ...planning.estimateMeta.averagePrices } : undefined,
        timestamp: planning.estimateMeta.timestamp || planning.calculatedAt || null,
        reason: planning.estimateMeta.reason ? { ...planning.estimateMeta.reason } : undefined,
        crates: planning.estimateMeta.crates
          ? cloneCrateBreakdown(planning.estimateMeta.crates)
          : planning.cheeseEstimate
            ? cloneCrateBreakdown(planning.cheeseEstimate.crates || computeCrateBreakdown(planning.cheeseEstimate))
            : undefined
      };
      setEstimateHint('calculated', lastEstimateInfo);
    } else if (planning.expectedTurnover) {
      const currency = planning.expectedTurnover.currency || (hasUsd ? 'usd' : 'eur');
      const amount = currency === 'eur'
        ? Number(planning.expectedTurnover.eur || 0)
        : Number(planning.expectedTurnover.usd || 0);
      setEstimateHint(amount > 0 ? 'pending' : 'empty', { currency, amount });
    } else if (planning.cheeseEstimate) {
      setEstimateHint('manual-cheese');
    } else {
      setEstimateHint('empty');
    }

    queueMicrotask(() => {
      if (!hasTurnoverValues() && !(planning.cheeseEstimate && (planning.cheeseEstimate.BG || planning.cheeseEstimate.ROOK || planning.cheeseEstimate.GEIT))) {
        maybeAutoEstimateFromHistory({ allowUpdate: true });
      }
    });
  }

  function collectPlanningData(existingPlanning = null) {
    planningCleared = false;
    const usd = toPositiveNumber(turnoverUsdInput?.value);
    const eur = toPositiveNumber(turnoverEurInput?.value);
    const totals = readCheeseInputs();
    const hasCheese = totals.BG > 0 || totals.ROOK > 0 || totals.GEIT > 0;
    const hasTurnover = usd > 0 || eur > 0;
    const turnoverProvided = Boolean(
      (turnoverUsdInput && String(turnoverUsdInput.value || '').trim() !== '') ||
      (turnoverEurInput && String(turnoverEurInput.value || '').trim() !== '')
    );
    const cheeseProvided = Object.values(cheeseInputs).some(input => input && String(input.value || '').trim() !== '');

    if (!hasCheese && !hasTurnover) {
      if (existingPlanning && !turnoverProvided && !cheeseProvided) {
        planningCleared = true;
      }
      return null;
    }

    const planning = {};
    if (hasTurnover) {
      planning.expectedTurnover = {};
      if (usd > 0) planning.expectedTurnover.usd = Math.round(usd * 100) / 100;
      if (eur > 0) planning.expectedTurnover.eur = Math.round(eur * 100) / 100;
      planning.expectedTurnover.currency = usd > 0 ? 'usd' : 'eur';
    }
    if (hasCheese) {
      const crateBreakdown = computeCrateBreakdown({ ...totals });
      planning.cheeseEstimate = {
        ...totals,
        categories: { ...totals },
        products: {},
        crates: crateBreakdown,
        rounding: 'crates'
      };
      planning.totalCheese = totals.BG + totals.ROOK + totals.GEIT;
    }

    const mix = getCategoryMixSnapshot();
    planning.mixSnapshot = cloneMixSnapshot(mix);

    const now = new Date().toISOString();
    const calculatedAt = lastEstimateInfo?.timestamp || existingPlanning?.calculatedAt || now;
    planning.calculatedAt = calculatedAt;

    const baseCurrency = planning.expectedTurnover?.currency
      || lastEstimateInfo?.currency
      || existingPlanning?.expectedTurnover?.currency
      || null;
    if (baseCurrency) {
      planning.priceSnapshot = {
        currency: baseCurrency,
        ...cloneAveragePriceSnapshot(baseCurrency)
      };
    }

    if (lastEstimateInfo && (!baseCurrency || lastEstimateInfo.currency === baseCurrency)) {
      planning.estimateMeta = {
        currency: lastEstimateInfo.currency,
        amount: lastEstimateInfo.amount,
        mix: cloneMixSnapshot(lastEstimateInfo.mix || mix),
        method: lastEstimateInfo.method || 'mix',
        averagePrices: lastEstimateInfo.averagePrices ? { ...lastEstimateInfo.averagePrices } : undefined,
        timestamp: lastEstimateInfo.timestamp || calculatedAt,
        reason: lastEstimateInfo.reason ? { ...lastEstimateInfo.reason } : undefined,
        crates: lastEstimateInfo.crates ? cloneCrateBreakdown(lastEstimateInfo.crates) : planning.cheeseEstimate ? cloneCrateBreakdown(planning.cheeseEstimate.crates) : undefined
      };
    } else if (planning.expectedTurnover) {
      const currency = baseCurrency || planning.expectedTurnover.currency;
      const amount = currency === 'eur'
        ? Number(planning.expectedTurnover.eur || 0)
        : Number(planning.expectedTurnover.usd || 0);
      planning.estimateMeta = {
        currency,
        amount,
        mix: cloneMixSnapshot(mix),
        method: 'mix',
        averagePrices: currency ? { currency, ...cloneAveragePriceSnapshot(currency) } : undefined,
        timestamp: calculatedAt,
        reason: { method: 'mix', label: 'Verkoopmix inschatting', matches: 0, currency },
        crates: planning.cheeseEstimate ? cloneCrateBreakdown(planning.cheeseEstimate.crates) : undefined
      };
    }

    return planning;
  }

  function generateName() {
    if (!isNew) return;
    const tp  = typeSelect.value;
    const loc = locationSelect.value;
    const sd  = startInput.value;
    if (tp && loc && sd) {
      const m = new Date(sd).toLocaleString('nl-NL',{month:'long',year:'2-digit'});
      nameInput.value = `${loc} ${tp} ${m}`;
    }
  }
  typeSelect?.addEventListener('change', () => {
    generateName();
    maybeAutoEstimateFromHistory({ force: true, allowUpdate: true });
  });
  locationSelect?.addEventListener('change', () => {
    generateName();
    maybeAutoEstimateFromHistory({ force: true, allowUpdate: true });
  });
  startInput?.addEventListener('change', generateName);
  generateName();

  queueMicrotask(() => {
    if (!hasTurnoverValues()) {
      maybeAutoEstimateFromHistory({ allowUpdate: true });
    }
  });

  // --- Pre-fill bij bewerken ---
  if (!isNew) {
    nameInput.value      = eventData.naam;
    typeSelect.value     = eventData.type;
    locationSelect.value = eventData.locatie;
    form.querySelector('#evtStart').value = eventData.startdatum;
    form.querySelector('#evtEnd').value   = eventData.einddatum;
    form.querySelector('#evtBus').value   = eventData.bus;
    (eventData.personen||[]).forEach(p=>{
      const cb = form.querySelector(`input[name="personen"][value="${p}"]`);
      if(cb) cb.checked = true;
    });
    form.querySelector('#evtCommission').value = eventData.commissie||0;
    form.querySelector('#evtStipend').value    = eventData.stageld  ||0;
    applyPlanningToForm(eventData.planning);
  }

  // --- Opslaan: exact zoals in module 5 :contentReference[oaicite:0]{index=0}&#8203;:contentReference[oaicite:1]{index=1} ---
  form.querySelector('#saveScheduleBtn').addEventListener('click', async ()=>{
    const naam      = nameInput.value.trim();
    const typeVal   = typeSelect.value;
    const locatie   = locationSelect.value;
    const startVal  = form.querySelector('#evtStart').value;
    const eindVal   = form.querySelector('#evtEnd').value;
    const bus       = form.querySelector('#evtBus').value;
    const personen  = Array.from(
                       form.querySelectorAll('input[name="personen"]:checked')
                     ).map(cb=>cb.value);
    const commissie = parseFloat(form.querySelector('#evtCommission').value)||0;
    const stageld   = parseFloat(form.querySelector('#evtStipend').value)||0;

    if(!naam||!typeVal||!locatie||!startVal||!eindVal||personen.length===0){
      return showAlert('⚠️ Vul alle verplichte velden in.','warning');
    }

    try {
      let id;
      if (isNew) {
        id = crypto.randomUUID?.()||Date.now().toString();
        const newEvt = {
          id, naam, locatie, type: typeVal, personen,
          bus, commissie, stageld, state:'planned',
          startdatum:startVal, einddatum:eindVal,
          sessions:[], kosten:{}
        };
        const planningData = collectPlanningData();
        if (planningData) {
          newEvt.planning = planningData;
        }
        db.evenementen.push(newEvt);
      } else {
        id = eventData.id;
        const idx = db.evenementen.findIndex(e=>e.id===id);
        const current = db.evenementen[idx] || {};
        const planningData = collectPlanningData(current.planning);
        const updated = {
          ...current,
          naam, locatie, type:typeVal, personen,
          bus, commissie, stageld, state:'planned',
          startdatum:startVal, einddatum:eindVal
        };
        delete updated.planning;
        if (planningData) {
          updated.planning = planningData;
        } else if (!planningCleared && current.planning) {
          updated.planning = current.planning;
        }
        db.evenementen[idx] = updated;
      }
      await saveEvent(id);
      showAlert(isNew ? '✅ Evenement opgeslagen!' : '✅ Evenement bijgewerkt!','success');
      overlay.remove();
    } catch(err) {
      console.error(err);
      showAlert('⚠️ Opslaan mislukt.','error');
    }
  });
}
