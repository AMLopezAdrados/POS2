// 📦 6_beheerVoorraad.js – Voorraadbeheer/transfer/inkoop (heldere UI, compatible met huidige systeem)

import { db, saveVoorraad, addVerkoopMutatie } from './3_data.js';
import { openProductModal } from './7_beheerProducten.js';
import { toonVerkoopKnoppen } from './8_verkoopscherm.js';
import { showAlert } from './4_ui.js';
import { addVoorraadForProduct, getVoorraadForProductInBus, setVoorraadForProduct } from './voorraad_utils.js';
import { store } from './store.js';

const LOCATION_ORDER = ['RENE', 'PIERRE', 'VOLENDAM'];
const LOCATION_META = {
  RENE: {
    label: 'RENE',
    description: '🚐 Bestelbus – inzet bij events'
  },
  PIERRE: {
    label: 'PIERRE',
    description: '🚐 Bestelbus – inzet bij events'
  },
  VOLENDAM: {
    label: 'VOLENDAM',
    description: '🏠 Thuisbasis en voorraadbuffer'
  }
};

function normalizeLocationKey(rawKey) {
  if (!rawKey && rawKey !== 0) return null;
  const normalized = String(rawKey)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  if (!normalized) return null;
  if (normalized === 'RENE' || normalized === 'RENEE') return 'RENE';
  if (normalized === 'PIERRE') return 'PIERRE';
  if (normalized === 'VOLENDAM') return 'VOLENDAM';
  return normalized;
}

function resolveActiveEventIdForTransfers() {
  const session = store.state.session || {};
  if (session.eventId) return session.eventId;
  if (session.eventKey) return session.eventKey;
  const activeDay = store.getActiveEventDay?.();
  if (activeDay?.eventId) return activeDay.eventId;
  if (activeDay?.id) return activeDay.id;
  const events = Array.isArray(store.state.db?.evenementen) ? store.state.db.evenementen : [];
  const eventName = session?.meta?.eventName;
  if (eventName) {
    const match = events.find(ev => String(ev?.naam || ev?.title || ev?.name || '') === String(eventName));
    if (match) return match.id || match.naam || match.uuid || match.slug || null;
  }
  return null;
}

async function logTransferMutations(eventId, transfers, sourceBus, destinationBus) {
  if (!eventId || !Array.isArray(transfers) || !transfers.length) return;
  const source = sourceBus ? String(sourceBus) : '';
  const destination = destinationBus ? String(destinationBus) : '';
  const note = source && destination ? `Transfer ${source} → ${destination}` : 'Transfer tussen bussen';
  const tasks = [];
  transfers.forEach((item) => {
    if (!item || !item.productId || !item.qty) return;
    const baseMeta = {
      transfer: {
        from: source || null,
        to: destination || null,
        label: item.naam || item.productId || null
      }
    };
    tasks.push(
      addVerkoopMutatie(eventId, {
        productId: item.productId,
        quantity: item.qty,
        type: 'transfer',
        busId: source || null,
        meta: { ...baseMeta, transfer: { ...baseMeta.transfer, direction: 'out' } },
        note
      }, { silent: true })
    );
    tasks.push(
      addVerkoopMutatie(eventId, {
        productId: item.productId,
        quantity: item.qty,
        type: 'transfer',
        busId: destination || null,
        meta: { ...baseMeta, transfer: { ...baseMeta.transfer, direction: 'in' } },
        note
      }, { silent: true })
    );
  });
  try {
    await Promise.all(tasks);
  } catch (err) {
    console.error('[Voorraad] logTransferMutations failed', err);
  }
}

// ===== Helpers =====
function ensureBussen() {
  const source = (db.voorraad && typeof db.voorraad === 'object') ? db.voorraad : {};
  const normalized = {};

  Object.entries(source).forEach(([key, value]) => {
    const canonical = normalizeLocationKey(key);
    if (canonical) {
      normalized[canonical] = { ...(normalized[canonical] || {}), ...(value || {}) };
    } else if (key) {
      normalized[key] = { ...(normalized[key] || {}), ...(value || {}) };
    }
  });

  LOCATION_ORDER.forEach((location) => {
    if (!normalized[location]) {
      normalized[location] = {};
    }
  });

  db.voorraad = normalized;
}
function getBussen() {
  ensureBussen();
  const keys = Object.keys(db.voorraad || {});
  const extras = keys.filter(key => !LOCATION_ORDER.includes(key));
  return [...LOCATION_ORDER, ...extras];
}
function packSize(name) {
  const n = String(name || '').toUpperCase();
  if (n.includes('ROOK')) return 10;
  if (n.includes('GEIT')) return 15;
  if (n.includes('BG'))   return 18;
  return 1;
}
function btnPrimary(el) {
  Object.assign(el.style, {
    background:'#2A9626', color:'#fff', border:'none', borderRadius:'10px', padding:'.55rem .9rem', fontWeight:'900'
  });
}
function btnWarn(el) {
  Object.assign(el.style, {
    background:'#FFC500', color:'#1b1b1b', border:'none', borderRadius:'10px', padding:'.55rem .9rem', fontWeight:'900'
  });
}
function btnInfo(el) {
  Object.assign(el.style, {
    background:'#1976D2', color:'#fff', border:'none', borderRadius:'10px', padding:'.55rem .9rem', fontWeight:'900'
  });
}
function btnDanger(el) {
  Object.assign(el.style, {
    background:'#E53935', color:'#fff', border:'none', borderRadius:'10px', padding:'.55rem .9rem', fontWeight:'900'
  });
}
function chip(el, active=false) {
  Object.assign(el.style, {
    padding:'.45rem .8rem', borderRadius:'999px', border:'1px solid #ddd',
    background: active ? '#2A9626' : '#f7f7f7', color: active ? '#fff' : '#222',
    fontWeight:'800', cursor:'pointer'
  });
}

function buildOverlay(onClose) {
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  Object.assign(overlay.style, {
    position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
    background:'rgba(0,0,0,.35)', backdropFilter:'blur(2px)', zIndex:9999
  });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  function esc(e){ if(e.key==='Escape') close(); }
  document.addEventListener('keydown', esc);
  return { overlay, close };
}

// ===== Public: Voorraad modal (tabs) =====
export function toonVoorraadModal() {
  // Sluit modals
  document.querySelectorAll('.modal').forEach(m => m.remove());
  ensureBussen();

  const { overlay: modal, close } = buildOverlay(() => toonVerkoopKnoppen());

  const content = document.createElement('div');
  Object.assign(content.style, {
    background:'#fff', padding:'1rem 1.1rem', borderRadius:'14px',
    width:'min(980px, 96vw)', maxHeight:'90vh', overflow:'auto',
    boxShadow:'0 10px 30px rgba(0,0,0,.25)'
  });

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.marginBottom = '.6rem';
  header.innerHTML = `<h2 style="margin:0; color:#2A9626">📦 Voorraadbeheer</h2>`;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '❌ Sluiten';
  btnDanger(closeBtn);
  closeBtn.onclick = close;
  header.appendChild(closeBtn);
  content.appendChild(header);

  // Tabs
  const tabRow = document.createElement('div');
  tabRow.style.display = 'flex';
  tabRow.style.gap = '.4rem';
  tabRow.style.flexWrap = 'wrap';

  const t1 = document.createElement('button'); t1.textContent = '🧮 Voorraad';
  const t2 = document.createElement('button'); t2.textContent = '🔄 Verplaatsen';
  const t3 = document.createElement('button'); t3.textContent = '🛒 Inkoop';
  chip(t1, true); chip(t2); chip(t3);
  tabRow.append(t1, t2, t3);
  content.appendChild(tabRow);

  const tabWrap = document.createElement('div');
  tabWrap.style.marginTop = '.6rem';
  content.appendChild(tabWrap);

  modal.appendChild(content);
  document.body.appendChild(modal);

  // Renderers
  const renderVoorraad = () => {
    tabWrap.innerHTML = '';
    tabRow.querySelectorAll('button').forEach(b => chip(b, false)); chip(t1, true);

    // Admin acties
    const gebruiker = JSON.parse(localStorage.getItem('gebruiker')) || {};
    if (gebruiker.role === 'admin') {
      const bar = document.createElement('div');
      bar.style.display = 'flex';
      bar.style.gap = '.5rem';
      bar.style.flexWrap = 'wrap';
      bar.style.marginBottom = '.6rem';

      const btnProd = document.createElement('button');
      btnProd.textContent = '📦 Producten beheren';
      btnInfo(btnProd);
      btnProd.onclick = () => { close(); setTimeout(openProductModal, 50); };

      const btnInk = document.createElement('button');
      btnInk.textContent = '🛒 Inkoop toevoegen';
      btnPrimary(btnInk);
      btnInk.onclick = () => { close(); openInkoopModal(); };

      bar.append(btnProd, btnInk);
      tabWrap.appendChild(bar);
    }

    // Tabel per bus
    const bussen = getBussen();
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr';
    grid.style.gap = '.8rem';

    bussen.forEach(bus => {
      const card = document.createElement('div');
      Object.assign(card.style, {
        border:'1px solid #eee', borderRadius:'12px', padding:'.6rem .7rem'
      });
      const title = document.createElement('div');
      title.innerHTML = `<b>Bus: ${bus}</b>`;
      card.appendChild(title);

      const tableWrap = document.createElement('div');
      tableWrap.style.overflowX = 'auto';
      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';

      const thead = document.createElement('thead');
      thead.innerHTML = `
        <tr>
          <th style="text-align:left; padding:.45rem; position:sticky; top:0; background:#f5f5f5;">Product</th>
          <th style="padding:.45rem; position:sticky; top:0; background:#f5f5f5;">Aantal</th>
          <th style="padding:.45rem; position:sticky; top:0; background:#f5f5f5;">Opslag</th>
        </tr>`;
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      db.producten.forEach(p => {
        const tr = document.createElement('tr');

        const pid = p.id || p.sku || p.code || p.naam;
        const curr = getVoorraadForProductInBus(pid, bus);

        tr.innerHTML = `
          <td style="padding:.45rem;">${p.naam}</td>
          <td style="padding:.45rem; text-align:center;">
            <input type="number" data-bus="${bus}" data-prod="${pid}" value="${curr}" min="0"
                   style="width:90px; text-align:right; padding:.35rem; border:1px solid #ddd; border-radius:8px;">
          </td>
          <td style="padding:.45rem; text-align:center;">
            <span style="font-size:.85rem; color:#666;">${packSize(p.naam)} per krat/doos</span>
          </td>
        `;
        const input = tr.querySelector('input');
        input.addEventListener('change', async (e) => {
          const val = Math.max(0, parseInt(e.target.value, 10) || 0);
          setVoorraadForProduct(pid, val, bus);
          await saveVoorraad(bus);
          showAlert('💾 Voorraad opgeslagen', 'success');
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      card.appendChild(tableWrap);
      grid.appendChild(card);
    });

    tabWrap.appendChild(grid);

    // Sluiten
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '.5rem';
    actions.style.marginTop = '.7rem';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '❌ Sluiten';
    btnDanger(closeBtn);
    closeBtn.onclick = close;

    actions.append(closeBtn);
    tabWrap.appendChild(actions);
  };

  const renderTransfer = () => {
    tabWrap.innerHTML = '';
    tabRow.querySelectorAll('button').forEach(b => chip(b, false)); chip(t2, true);

    const bussen = getBussen();
    if (bussen.length < 2) {
      tabWrap.innerHTML = `<div style="padding:.7rem; background:#FFF4E5; border:1px solid #FFE0B2; border-radius:10px; color:#6B4E00;">
        Je hebt minimaal twee bussen nodig om te verplaatsen.</div>`;
      return;
    }

    const cheeseProducts = resolveCheeseProducts();
    if (!cheeseProducts.length) {
      tabWrap.innerHTML = `<div style="padding:.7rem; background:#FFF4E5; border:1px solid #FFE0B2; border-radius:10px; color:#6B4E00;">
        Geen kaasproducten beschikbaar om te verplaatsen.</div>`;
      return;
    }

    // Kop: bron/dest
    const pick = document.createElement('div');
    pick.style.display = 'grid';
    pick.style.gridTemplateColumns = '1fr 1fr';
    pick.style.gap = '.6rem';
    pick.style.alignItems = 'center';

    const srcSel = document.createElement('select');
    const dstSel = document.createElement('select');
    [srcSel, dstSel].forEach(sel => {
      Object.assign(sel.style, { padding:'.5rem', border:'1px solid #ddd', borderRadius:'8px' });
      bussen.forEach(b => {
        const o = document.createElement('option'); o.value = b; o.textContent = b; sel.appendChild(o);
      });
    });
    dstSel.selectedIndex = 1;

    const swapBtn = document.createElement('button');
    swapBtn.textContent = '⇄ Wissel';
    btnWarn(swapBtn);
    swapBtn.onclick = () => {
      const si = srcSel.selectedIndex;
      srcSel.selectedIndex = dstSel.selectedIndex;
      dstSel.selectedIndex = si;
      renderRows();
    };

    pick.append(
      wrapLabel('Van bus', srcSel),
      wrapLabel('Naar bus', dstSel)
    );

    const toolsRow = document.createElement('div');
    toolsRow.style.display = 'flex';
    toolsRow.style.justifyContent = 'space-between';
    toolsRow.style.alignItems = 'center';
    toolsRow.style.margin = '.6rem 0';

    const hint = document.createElement('div');
    hint.style.color = '#555';
    hint.textContent = 'Vul per product het aantal te verplaatsen stuks in; elke verplaatsing wordt in het actieve event gelogd.';

    const fillAllBtn = document.createElement('button');
    fillAllBtn.textContent = '↦ Alles verplaatsen (max)';
    btnInfo(fillAllBtn);

    toolsRow.append(hint, fillAllBtn);

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '.35rem';

    const renderRows = () => {
      list.innerHTML = '';
      cheeseProducts.forEach((product) => {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display:'grid', gridTemplateColumns:'1fr auto 120px', gap:'.5rem', alignItems:'center',
          border:'1px solid #eee', borderRadius:'10px', padding:'.45rem .55rem'
        });
        const storageKey = product.storageKey;
        const avail = Math.max(0, Number(getVoorraadForProductInBus(storageKey, srcSel.value)) || 0);
        row.dataset.transferRow = '1';
        row.dataset.storageKey = storageKey;
        row.dataset.productName = product.naam;
        const name = document.createElement('div');
        name.innerHTML = `<div style="font-weight:800">${product.naam}</div>
                          <div style="font-size:.8rem; color:#666;">Beschikbaar: ${avail}</div>`;

        const packTag = document.createElement('div');
        packTag.style.fontSize = '.85rem';
        packTag.style.color = '#666';
        packTag.textContent = `${packSize(product.naam)}/krat/doos`;

        const inp = document.createElement('input');
        Object.assign(inp, { type:'number', min:0, max:avail, value:0 });
        Object.assign(inp.style, {
          width:'120px', textAlign:'right', padding:'.4rem .45rem', border:'1px solid #ddd', borderRadius:'8px'
        });
        inp.oninput = () => {
          const v = Math.max(0, Math.min(avail, parseInt(inp.value, 10) || 0));
          inp.value = v;
        };

        row.append(name, packTag, inp);
        list.appendChild(row);
      });
    };

    fillAllBtn.onclick = () => {
      list.querySelectorAll('[data-transfer-row="1"]').forEach((row) => {
        const storageKey = row.dataset.storageKey;
        const input = row.querySelector('input[type="number"]');
        if (!storageKey || !input) return;
        const avail = Math.max(0, Number(getVoorraadForProductInBus(storageKey, srcSel.value)) || 0);
        input.value = avail;
      });
    };

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '.5rem';
    actions.style.marginTop = '.7rem';

    const doBtn = document.createElement('button');
    doBtn.textContent = '✅ Overboeken';
    btnPrimary(doBtn);

    const backBtn = document.createElement('button');
    backBtn.textContent = '❌ Annuleren';
    btnDanger(backBtn);

    doBtn.onclick = async () => {
      if (srcSel.value === dstSel.value) return showAlert('⚠️ Kies twee verschillende bussen.', 'warning');

      let moved = 0;
      const transfers = [];
      list.querySelectorAll('[data-transfer-row="1"]').forEach((row) => {
        const input = row.querySelector('input[type="number"]');
        const storageKey = row.dataset.storageKey;
        if (!input || !storageKey) return;
        const requested = Math.max(0, parseInt(input.value, 10) || 0);
        if (!requested) return;
        const available = Math.max(0, Number(getVoorraadForProductInBus(storageKey, srcSel.value)) || 0);
        if (!available) return;
        const qty = Math.min(requested, available);
        addVoorraadForProduct(storageKey, -qty, srcSel.value);
        addVoorraadForProduct(storageKey, qty, dstSel.value);
        transfers.push({ qty, naam: row.dataset.productName || storageKey, productId: storageKey });
      });

      if (!transfers.length) {
        return showAlert('⚠️ Geen aantallen ingevoerd om te verplaatsen.', 'warning');
      }

      moved = transfers.reduce((sum, item) => sum + item.qty, 0);
      await Promise.all([saveVoorraad(srcSel.value), saveVoorraad(dstSel.value)]);
      const eventId = resolveActiveEventIdForTransfers();
      if (eventId) {
        await logTransferMutations(eventId, transfers, srcSel.value, dstSel.value);
      } else {
        console.warn('[Voorraad] Geen actief evenement gevonden voor transfer logging.');
      }
      showAlert(`✅ ${moved} stuks verplaatst: ${srcSel.value} → ${dstSel.value}`, 'success');
      close();
    };
    backBtn.onclick = close;

    // Init
    renderRows();
    srcSel.onchange = renderRows;
    dstSel.onchange = renderRows;

    tabWrap.append(pick, toolsRow, list, actions);
    actions.append(doBtn, backBtn);
  };

  const renderInkoop = () => {
    tabWrap.innerHTML = '';
    tabRow.querySelectorAll('button').forEach(b => chip(b, false)); chip(t3, true);
    openInkoopModal(); // gebruikt losstaande modal; sluit deze en heropen voorraadmodal indien nodig
    setTimeout(close, 0);
  };

  // Tab handlers
  t1.onclick = renderVoorraad;
  t2.onclick = renderTransfer;
  t3.onclick = renderInkoop;

  // Start
  renderVoorraad();

  function wrapLabel(label, node) {
    const w = document.createElement('div');
    w.innerHTML = `<div style="font-weight:800; margin-bottom:.2rem;">${label}</div>`;
    w.appendChild(node);
    return w;
  }
}

const CHEESE_TYPES = new Set(['BG', 'ROOK', 'GEIT']);
const CHEESE_TYPE_ORDER = ['BG', 'ROOK', 'GEIT'];

function sortCheeseProducts(a, b) {
  const orderA = CHEESE_TYPE_ORDER.indexOf(a.type);
  const orderB = CHEESE_TYPE_ORDER.indexOf(b.type);
  const safeA = orderA === -1 ? Number.MAX_SAFE_INTEGER : orderA;
  const safeB = orderB === -1 ? Number.MAX_SAFE_INTEGER : orderB;
  if (safeA !== safeB) return safeA - safeB;
  return a.naam.localeCompare(b.naam, 'nl', { sensitivity: 'base' });
}

function fallbackCheeseType(name) {
  const upper = String(name || '').toUpperCase();
  for (const type of CHEESE_TYPE_ORDER) {
    if (upper.startsWith(type)) return type;
  }
  if (upper.includes('GEIT')) return 'GEIT';
  if (upper.includes('ROOK')) return 'ROOK';
  if (upper.includes('BG')) return 'BG';
  if (upper.includes('EDAMMER')) return 'BG';
  if (upper.includes('KAAS')) return 'BG';
  return null;
}

function resolveCheeseProducts() {
  const unique = new Map();
  if (Array.isArray(db.producten) && db.producten.length) {
    db.producten.forEach((product) => {
      const type = String(product?.type || '').toUpperCase();
      if (!CHEESE_TYPES.has(type)) return;
      const storageKey = product.id || product.sku || product.code || product.naam;
      if (!storageKey) return;
      const naam = product.naam || storageKey;
      if (!unique.has(storageKey)) {
        unique.set(storageKey, { storageKey, naam, type });
      }
    });
  }

  if (!unique.size) {
    Object.values(db.voorraad || {}).forEach((bucket) => {
      Object.keys(bucket || {}).forEach((key) => {
        const type = fallbackCheeseType(key);
        if (!type) return;
        if (!unique.has(key)) {
          unique.set(key, { storageKey: key, naam: key, type });
        }
      });
    });
  }

  return Array.from(unique.values()).sort(sortCheeseProducts);
}

function parseQuantity(value) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

function computeCheeseTotal(bucket, cheeseList) {
  const source = bucket || {};
  return cheeseList.reduce((sum, product) => {
    const raw = source[product.storageKey];
    const qty = Number.parseInt(raw, 10);
    if (!Number.isFinite(qty) || qty < 0) return sum;
    return sum + qty;
  }, 0);
}

export function renderVoorraadInMain(container) {
  const mount = resolveContainer(container);
  if (!mount) return;
  ensureBussen();
  injectMainStyles();

  mount.innerHTML = '';
  mount.classList.add('panel-stack');

  const header = document.createElement('div');
  header.className = 'panel-header';

  const headerTitle = document.createElement('div');
  headerTitle.className = 'panel-header-title';
  const h2 = document.createElement('h2');
  h2.textContent = '📦 Voorraadbeheer';
  const subtitle = document.createElement('p');
  subtitle.className = 'muted';
  subtitle.textContent = 'Tel enkel onze kazen per locatie.';
  headerTitle.append(h2, subtitle);

  const actionBar = document.createElement('div');
  actionBar.className = 'panel-actions';

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn-ghost';
  refreshBtn.textContent = '🔄 Vernieuwen';
  refreshBtn.addEventListener('click', () => renderVoorraadInMain(mount));

  const productBtn = document.createElement('button');
  productBtn.className = 'btn-secondary';
  productBtn.textContent = '📦 Producten beheren';
  productBtn.onclick = openProductModal;

  const inkoopBtn = document.createElement('button');
  inkoopBtn.className = 'btn-primary';
  inkoopBtn.textContent = '🛒 Inkoop toevoegen';
  inkoopBtn.onclick = () => openInkoopModal();

  actionBar.append(refreshBtn, productBtn, inkoopBtn);
  header.append(headerTitle, actionBar);
  mount.appendChild(header);

  const cheeseProducts = resolveCheeseProducts();
  if (!cheeseProducts.length) {
    const empty = document.createElement('div');
    empty.className = 'panel-card muted';
    empty.textContent = 'Geen kaasproducten gevonden.';
    mount.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'voorraad-grid';

  LOCATION_ORDER.forEach((locationKey) => {
    const meta = LOCATION_META[locationKey] || { label: locationKey, description: '' };
    const bucket = db.voorraad[locationKey] || (db.voorraad[locationKey] = {});
    const originalValues = {};

    const card = document.createElement('section');
    card.className = 'panel-card voorraad-card';
    card.dataset.location = locationKey;

    const cardHeader = document.createElement('header');
    const titleRow = document.createElement('div');
    titleRow.className = 'voorraad-card-title';
    const title = document.createElement('h3');
    title.textContent = meta.label;
    const totalBadge = document.createElement('span');
    totalBadge.className = 'voorraad-total';
    const totalValue = document.createElement('span');
    totalValue.className = 'voorraad-total-value';
    totalBadge.append(totalValue, document.createTextNode(' stuks'));
    titleRow.append(title, totalBadge);
    cardHeader.appendChild(titleRow);
    if (meta.description) {
      const note = document.createElement('p');
      note.className = 'subtitle';
      note.textContent = meta.description;
      cardHeader.appendChild(note);
    }
    card.appendChild(cardHeader);

    const table = document.createElement('table');
    table.className = 'voorraad-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const thName = document.createElement('th');
    thName.textContent = 'Kaas';
    const thQty = document.createElement('th');
    thQty.className = 'right';
    thQty.textContent = 'Aantal';
    headRow.append(thName, thQty);
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    cheeseProducts.forEach((product) => {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      const nameWrap = document.createElement('div');
      nameWrap.className = 'cheese-name';
      const nameText = document.createElement('span');
      nameText.textContent = product.naam;
      const typeBadge = document.createElement('span');
      typeBadge.className = `cheese-type type-${product.type.toLowerCase()}`;
      typeBadge.textContent = product.type;
      nameWrap.append(nameText, typeBadge);
      nameCell.appendChild(nameWrap);

      const qtyCell = document.createElement('td');
      qtyCell.className = 'right';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.inputMode = 'numeric';
      input.pattern = '[0-9]*';
      const storageKey = product.storageKey;
      const currentValue = Number.parseInt(bucket[storageKey], 10);
      const safeValue = Number.isFinite(currentValue) && currentValue >= 0 ? currentValue : 0;
      originalValues[storageKey] = safeValue;
      input.value = String(safeValue);
      input.addEventListener('input', () => {
        const qty = parseQuantity(input.value);
        bucket[storageKey] = qty;
        updateTotal();
        updateDirtyState();
      });
      input.addEventListener('blur', () => {
        const qty = parseQuantity(input.value);
        input.value = String(qty);
        bucket[storageKey] = qty;
        updateTotal();
        updateDirtyState();
      });
      qtyCell.appendChild(input);

      row.append(nameCell, qtyCell);
      tbody.appendChild(row);
    });

    card.appendChild(table);

    const footer = document.createElement('footer');
    const status = document.createElement('span');
    status.className = 'save-status muted';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary save-btn';
    saveBtn.type = 'button';
    saveBtn.textContent = '💾 Opslaan';
    saveBtn.disabled = true;

    footer.append(status, saveBtn);
    card.appendChild(footer);

    function updateTotal() {
      const total = computeCheeseTotal(bucket, cheeseProducts);
      totalValue.textContent = String(total);
    }

    function updateDirtyState() {
      const hasChanges = cheeseProducts.some((product) => {
        const key = product.storageKey;
        const original = Number.parseInt(originalValues[key], 10) || 0;
        const current = Number.parseInt(bucket[key], 10) || 0;
        return original !== current;
      });
      saveBtn.disabled = !hasChanges;
      card.classList.toggle('is-dirty', hasChanges);
      status.textContent = hasChanges ? 'Wijzigingen niet opgeslagen' : 'Alles opgeslagen';
    }

    saveBtn.addEventListener('click', async () => {
      status.textContent = 'Opslaan…';
      saveBtn.disabled = true;
      await saveVoorraad(locationKey);
      showAlert(`${meta.label}: voorraad opgeslagen`, 'success');
      renderVoorraadInMain(mount);
    });

    updateTotal();
    updateDirtyState();

    grid.appendChild(card);
  });

  mount.appendChild(grid);
}

function resolveContainer(container) {
  if (container instanceof HTMLElement) return container;
  if (typeof container === 'string') return document.querySelector(container);
  return document.getElementById('panel-voorraad') || document.getElementById('app');
}

function injectMainStyles() {
  if (document.getElementById('voorraad-main-styles')) return;
  const css = `
    .voorraad-grid{display:grid;gap:1rem;margin-top:.75rem;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));}
    .voorraad-card{display:flex;flex-direction:column;gap:1rem;}
    .voorraad-card header{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;}
    .panel-header-title{display:flex;flex-direction:column;gap:.25rem;}
    .voorraad-card-title{display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap;}
    .voorraad-total{display:inline-flex;align-items:center;gap:.3rem;font-weight:700;font-variant-numeric:tabular-nums;color:#1F6D1C;}
    .voorraad-total-value{font-size:1.35rem;}
    .voorraad-table{width:100%;border-collapse:collapse;border:1px solid rgba(15,23,42,.05);border-radius:12px;overflow:hidden;}
    .voorraad-table thead th{background:rgba(42,150,38,.08);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(15,23,42,.65);}
    .voorraad-table th,.voorraad-table td{padding:.45rem .6rem;border-bottom:1px solid rgba(15,23,42,.06);}
    .voorraad-table tbody tr:last-child td{border-bottom:none;}
    .voorraad-table td.right{text-align:right;width:120px;}
    .voorraad-table input{width:100%;padding:.35rem .4rem;border-radius:10px;border:1px solid rgba(15,23,42,.12);text-align:right;font-weight:600;font-variant-numeric:tabular-nums;background:#fff;}
    .cheese-name{display:flex;justify-content:space-between;align-items:center;gap:.5rem;font-weight:600;color:#123821;}
    .cheese-type{display:inline-flex;align-items:center;justify-content:center;padding:.15rem .5rem;border-radius:999px;font-size:.7rem;font-weight:700;letter-spacing:.05em;}
    .cheese-type.type-bg{background:rgba(255,197,0,.18);color:#8C6B00;}
    .cheese-type.type-rook{background:rgba(255,116,77,.2);color:#9A3412;}
    .cheese-type.type-geit{background:rgba(125,211,161,.24);color:#166534;}
    .voorraad-card footer{display:flex;justify-content:space-between;align-items:center;gap:.75rem;flex-wrap:wrap;}
    .save-status{font-size:.85rem;}
    .voorraad-card.is-dirty .save-btn{box-shadow:0 0 0 2px rgba(42,150,38,.25);}
  `;
  const style = document.createElement('style');
  style.id = 'voorraad-main-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

// ===== Public: Inkoop (per krat/doos) =====
export function openInkoopModal() {
  // Sluit bestaande modals
  document.querySelectorAll('.modal').forEach(m => m.remove());
  ensureBussen();

  const { overlay: modal, close } = buildOverlay();

  const content = document.createElement('div');
  Object.assign(content.style, {
    background:'#fff',
    padding:'1rem 1.2rem',
    borderRadius:'12px',
    width:'min(760px, 94vw)',
    maxHeight:'90vh',
    overflowY:'auto',
    boxShadow:'0 8px 24px rgba(0,0,0,0.25)'
  });

  const h2 = document.createElement('h2');
  h2.textContent = '🛒 Inkoop per krat/doos';
  h2.style.marginTop = '0';
  h2.style.color = '#2A9626';
  content.appendChild(h2);

  // Bus select
  const busWrap = document.createElement('div');
  busWrap.style.display = 'grid';
  busWrap.style.gridTemplateColumns = 'auto 1fr';
  busWrap.style.alignItems = 'center';
  busWrap.style.gap = '.6rem';
  busWrap.style.margin = '.2rem 0 .8rem 0';
  busWrap.innerHTML = `<label style="font-weight:800;">Ontvangende bus</label>`;
  const busSel = document.createElement('select');
  Object.assign(busSel.style, { padding: '.5rem', border: '1px solid #ddd', borderRadius: '8px' });
  getBussen().forEach(b => {
    const o = document.createElement('option'); o.value = b; o.textContent = b; busSel.appendChild(o);
  });
  busWrap.appendChild(busSel);
  content.appendChild(busWrap);

  // Legenda
  const legend = document.createElement('div');
  legend.innerHTML = `
    <div style="font-size:.95rem; color:#444; margin:.2rem 0 .8rem 0;">
      <b>Per verpakking:</b> BG = 18, ROOK = 10, GEIT = 15.<br>
      Met <b>+/−</b> wijzig je het aantal kratten/dozen; daarna kun je <i>losse stuks</i> handmatig aanpassen.
    </div>
  `;
  content.appendChild(legend);

  // Lijst
  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '.45rem';
  content.appendChild(list);

  db.producten.forEach(p => {
    const pack = packSize(p.naam);

    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'grid',
      gridTemplateColumns: '1fr auto auto auto',
      gap: '.5rem',
      alignItems: 'center',
      border: '1px solid #eee',
      borderRadius: '10px',
      padding: '.5rem .6rem'
    });

    const nameCol = document.createElement('div');
    nameCol.innerHTML = `
      <div style="font-weight:800">${p.naam}</div>
      <div style="font-size:.85rem; color:#666;">per ${pack >= 10 ? 'krat/doos' : 'stuks'}: <b>${pack}</b></div>
    `;

    const btnMin = document.createElement('button');
    btnMin.textContent = '−';
    Object.assign(btnMin.style, {
      width: '42px', height: '36px', borderRadius: '8px',
      background: '#E53935', color: '#fff', border: 'none', fontWeight: '900', fontSize:'1.1rem'
    });

    const crateCol = document.createElement('div');
    crateCol.style.textAlign = 'center';
    crateCol.innerHTML = `
      <div style="font-size:1.05rem; font-weight:900" data-crates>0</div>
      <div style="font-size:.8rem; color:#666">kratten</div>
    `;

    const btnPlus = document.createElement('button');
    btnPlus.textContent = '+';
    Object.assign(btnPlus.style, {
      width: '42px', height: '36px', borderRadius: '8px',
      background: '#2A9626', color: '#fff', border: 'none', fontWeight: '900', fontSize:'1.1rem'
    });

    const unitsWrap = document.createElement('div');
    unitsWrap.style.gridColumn = '1 / -1';
    unitsWrap.style.display = 'grid';
    unitsWrap.style.gridTemplateColumns = 'auto 140px';
    unitsWrap.style.alignItems = 'center';
    unitsWrap.style.gap = '.5rem';
    unitsWrap.innerHTML = `
      <label style="font-weight:700;">Totaal stuks</label>
      <input type="number" min="0" step="1" value="0" data-units
        style="width: 140px; padding:.45rem .5rem; border:1px solid #ddd; border-radius:8px; text-align:right;">
    `;

    row.append(nameCol, btnMin, crateCol, btnPlus, unitsWrap);
    list.appendChild(row);

    const cratesEl = crateCol.querySelector('[data-crates]');
    const unitsEl  = unitsWrap.querySelector('[data-units]');

    function setCrates(newCrates) {
      const c = Math.max(0, Number(newCrates || 0));
      cratesEl.textContent = String(c);
      unitsEl.value = String(c * pack);
    }
    function syncCratesFromUnits() {
      const u = Math.max(0, Number(unitsEl.value || 0));
      const c = Math.floor(u / pack);
      cratesEl.textContent = String(c);
    }

    btnMin.onclick = () => setCrates(Number(cratesEl.textContent) - 1);
    btnPlus.onclick = () => setCrates(Number(cratesEl.textContent) + 1);
    unitsEl.oninput = () => { syncCratesFromUnits(); };

    setCrates(0);
  });

  // Acties
  const bar = document.createElement('div');
  Object.assign(bar.style, { display: 'flex', gap: '.5rem', justifyContent: 'space-between', marginTop: '.8rem', flexWrap:'wrap' });

  const leftBtnWrap = document.createElement('div');
  leftBtnWrap.style.display = 'flex';
  leftBtnWrap.style.gap = '.5rem';

  const btnLoad = document.createElement('button');
  btnLoad.textContent = '📥 Bestelling ophalen';
  btnInfo(btnLoad);
  btnLoad.onclick = () => {
    close();
    if (typeof openBestellingModal === 'function') {
      openBestellingModal();
    } else {
      alert('📥 Bestelling ophalen modal niet gevonden.');
    }
  };
  leftBtnWrap.appendChild(btnLoad);

  const rightBtnWrap = document.createElement('div');
  rightBtnWrap.style.display = 'flex';
  rightBtnWrap.style.gap = '.5rem';

  const btnConfirm = document.createElement('button');
  btnConfirm.textContent = '✅ Opslaan in voorraad';
  btnPrimary(btnConfirm);

  btnConfirm.onclick = async () => {
    const bus = busSel.value;
    if (!bus) { showAlert('⚠️ Kies eerst een bus.', 'warning'); return; }

    let totalUnitsAdded = 0;
    Array.from(list.children).forEach((row, i) => {
      const p = db.producten[i];
      if (!p) return;
      const unitsEl = row.querySelector('[data-units]');
      const units = Math.max(0, parseInt(unitsEl.value, 10) || 0);
      if (units > 0) {
        const pid = p.id || p.sku || p.code || p.naam;
        addVoorraadForProduct(pid, units, bus);
        totalUnitsAdded += units;
      }
    });

    if (totalUnitsAdded === 0) {
      showAlert('Geen voorraad geselecteerd om toe te voegen.', 'info');
      return;
    }

    try {
      await saveVoorraad(bus);
      showAlert(`✅ ${totalUnitsAdded} stuks toegevoegd aan ${bus}.`, 'success');
      close();
      if (typeof toonVoorraadModal === 'function') setTimeout(() => toonVoorraadModal(), 30);
    } catch (e) {
      console.error(e);
      showAlert('❌ Opslaan voorraad mislukt.', 'error');
    }
  };

  const btnCancel = document.createElement('button');
  btnCancel.textContent = '❌ Annuleren';
  btnDanger(btnCancel);
  btnCancel.onclick = close;

  rightBtnWrap.append(btnConfirm, btnCancel);
  bar.append(leftBtnWrap, rightBtnWrap);
  content.appendChild(bar);

  // Sluitknop in hoek
  const closeTop = document.createElement('button');
  closeTop.textContent = '✕';
  Object.assign(closeTop.style, {
    position:'absolute', top:'10px', right:'12px', background:'#FFC500', color:'#1b1b1b',
    border:'none', borderRadius:'8px', padding:'.25rem .5rem', fontWeight:'900'
  });
  closeTop.onclick = close;
  content.appendChild(closeTop);

  modal.appendChild(content);
  document.body.appendChild(modal);
}

// ===== Public: Bestelling (dummy loader) =====
export function openBestellingModal() {
  document.querySelectorAll('.modal').forEach(m => m.remove());

  const { overlay: modal, close } = buildOverlay();

  const content = document.createElement('div');
  Object.assign(content.style, {
    background:'#fff', padding:'1rem 1.2rem', borderRadius:'12px',
    width:'min(600px, 94vw)', maxHeight:'80vh', overflowY:'auto',
    boxShadow:'0 8px 24px rgba(0,0,0,0.25)'
  });

  const h2 = document.createElement('h2');
  h2.textContent = '📋 Bestelling ophalen';
  h2.style.marginTop = '0';
  h2.style.color = '#2A9626';
  content.appendChild(h2);

  const lijst = document.createElement('div');
  lijst.style.display = 'flex';
  lijst.style.flexDirection = 'column';
  lijst.style.gap = '.45rem';

  if (!Array.isArray(db.reizen) || !db.reizen.length) {
    const p = document.createElement('p');
    p.textContent = 'Geen geplande reizen gevonden.';
    lijst.appendChild(p);
  } else {
    db.reizen.forEach(reis => {
      const btn = document.createElement('button');
      btn.textContent = `Reis: ${reis.start} → ${reis.end}`;
      btnInfo(btn);
      btn.style.textAlign = 'left';
      btn.onclick = () => {
        close();
        openInkoopModal();
        setTimeout(() => {
          // Prefill: kies bus + zet per product #kratten (op basis van reis.bestelling)
          const inoModal = document.querySelector('.modal');
          if (!inoModal) return;

          // Bus selecteren indien aanwezig
          const busSel = inoModal.querySelector('select');
          if (busSel && reis.bus) busSel.value = reis.bus;

          if (Array.isArray(reis.bestelling)) {
            const rows = inoModal.querySelectorAll('div[style*="grid-template-columns: 1fr auto auto auto"]');
            reis.bestelling.forEach(item => {
              const name = item.product;
              const crates = item.crates || 0;
              // Best-effort mapping: loop producten na in zelfde volgorde:
              db.producten.forEach((p, idx) => {
                if (p.naam === name) {
                  const row = rows[idx];
                  if (!row) return;
                  const cratesEl = row.querySelector('[data-crates]');
                  const unitsEl  = row.querySelector('[data-units]');
                  const pack     = packSize(p.naam);
                  if (cratesEl && unitsEl) {
                    cratesEl.textContent = String(crates);
                    unitsEl.value = String(crates * pack);
                  }
                }
              });
            });
          }
        }, 50);
      };
      lijst.appendChild(btn);
    });
  }

  const back = document.createElement('button');
  back.textContent = '❌ Terug';
  btnDanger(back);
  back.style.marginTop = '.6rem';
  back.onclick = () => { close(); openInkoopModal(); };

  content.append(lijst, back);
  modal.appendChild(content);
  document.body.appendChild(modal);
}

// Console helpers (optioneel)
window.toonVoorraadModal = toonVoorraadModal;
window.openInkoopModal = openInkoopModal;
window.openBestellingModal = openBestellingModal;