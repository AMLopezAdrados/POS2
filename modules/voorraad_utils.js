// modules/voorraad_utils.js
// Robuuste bus- en voorraadhelpers (accent/case tolerant) + compat-exports.

import { store } from './store.js';

// ---------- normalizers ----------
function normalizeKey(s) {
  return String(s ?? '')
    .normalize('NFKD')                // accents weg
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function findBusKeyCandidate(candidate, voorraadObj) {
  if (!candidate || !voorraadObj) return null;
  const want = normalizeKey(candidate);
  for (const key of Object.keys(voorraadObj)) {
    if (normalizeKey(key) === want) return key; // canonieke key teruggeven
  }
  return null;
}

// ---------- bus helpers ----------
export function listBussen() {
  const v = store.state.db?.voorraad;
  return v && typeof v === 'object' ? Object.keys(v) : [];
}

/**
 * setActiveBus(busId)
 * Forceer actief bus-profiel (tolerant match) en sla op in session.meta + localStorage.
 */
export function setActiveBus(busId) {
  const db = store.state.db || {};
  const v = db.voorraad && typeof db.voorraad === 'object' ? db.voorraad : null;
  if (!v) return null;
  const hit = findBusKeyCandidate(busId, v);
  if (!hit) return null;

  const sess = store.state.session || (store.state.session = {});
  try { sess.meta = { ...(sess.meta || {}), bus: hit }; } catch {}
  try { localStorage.setItem('activeBus', hit); } catch {}
  return hit;
}

/**
 * resolveBusId()
 * Prioriteit:
 * 1) session.meta.bus | session.meta.busId
 * 2) event.bus | event.busId | event.ownerBus
 * 3) localStorage.activeBus
 * 4) fallback: eerste key in voorraad.json
 * Resultaat is ALTIJD een key die werkelijk in voorraad.json bestaat.
 */
export function resolveBusId() {
  const db = store.state.db || {};
  const voorraad = db.voorraad && typeof db.voorraad === 'object' ? db.voorraad : null;
  const session = store.state.session || {};
  if (!voorraad) return null;

  const candidates = [];
  if (session?.meta?.bus)   candidates.push(session.meta.bus);
  if (session?.meta?.busId) candidates.push(session.meta.busId);

  if (session?.eventKey && Array.isArray(db.evenementen)) {
    const ev = db.evenementen.find(e => e.id === session.eventKey || e.naam === session.eventKey);
    if (ev?.bus)      candidates.push(ev.bus);
    if (ev?.busId)    candidates.push(ev.busId);
    if (ev?.ownerBus) candidates.push(ev.ownerBus);
  }

  try {
    const ls = localStorage.getItem('activeBus');
    if (ls) candidates.push(ls);
  } catch {}

  // Zoek de eerste kandidaat die echt bestaat
  for (const cand of candidates) {
    const hit = findBusKeyCandidate(cand, voorraad);
    if (hit) {
      try { session.meta = { ...(session.meta || {}), bus: hit }; } catch {}
      try { localStorage.setItem('activeBus', hit); } catch {}
      return hit;
    }
  }

  // Fallback: eerste bus in voorraad.json
  const first = Object.keys(voorraad)[0] || null;
  if (first) {
    try { session.meta = { ...(session.meta || {}), bus: first }; } catch {}
    try { localStorage.setItem('activeBus', first); } catch {}
  }
  return first;
}

// ---------- product voorraad ----------
function candidatesForProductId(productId) {
  const raw = String(productId ?? '');
  const out = [raw];
  const norm = normalizeKey(raw);
  if (!out.includes(norm)) out.push(norm);
  return out;
}

/**
 * getVoorraadForProduct(productId, perBus = true)
 * Geeft getal terug (>=0) of null bij onbekend.
 */
export function getVoorraadForProductInBus(productId, busId = null) {
  const db = store.state.db || {};
  const v = db.voorraad && typeof db.voorraad === 'object' ? db.voorraad : null;
  if (!v) {
    if (typeof window !== 'undefined' && window.OC_DEBUG_STOCK) {
      console.warn('[STOCK:MISS]', { busKey: null, productId, normalized: normalizeKey(productId), bucketKeys: [], bucketSize: 0 });
    }
    return 0;
  }

  const busKey = busId ? findBusKeyCandidate(busId, v) : resolveBusId();
  if (!busKey) {
    if (typeof window !== 'undefined' && window.OC_DEBUG_STOCK) {
      console.warn('[STOCK:MISS]', { busKey, productId, normalized: normalizeKey(productId), bucketKeys: [], bucketSize: 0 });
    }
    return 0;
  }

  const bucket = v[busKey] || {};

  if (Object.prototype.hasOwnProperty.call(bucket, productId)) {
    return Number(bucket[productId] ?? 0);
  }

  const want = candidatesForProductId(productId);
  for (const [k, val] of Object.entries(bucket)) {
    if (want.includes(normalizeKey(k)) || want.includes(k)) {
      return Number(val ?? 0);
    }
  }

  if (typeof window !== 'undefined' && window.OC_DEBUG_STOCK) {
    console.warn('[STOCK:MISS]', { busKey, productId, normalized: normalizeKey(productId), bucketKeys: Object.keys(bucket).slice(0, 5), bucketSize: Object.keys(bucket).length });
  }
  return 0;
}

export function getVoorraadForProduct(productId, perBus = true) {
  if (perBus) {
    return getVoorraadForProductInBus(productId, null);
  }

  const db = store.state.db || {};
  const v = db.voorraad && typeof db.voorraad === 'object' ? db.voorraad : null;
  if (!v) {
    if (typeof window !== 'undefined' && window.OC_DEBUG_STOCK) {
      console.warn('[STOCK:MISS]', { busKey: null, productId, normalized: normalizeKey(productId), bucketKeys: [], bucketSize: 0 });
    }
    return 0;
  }

  // totaal over alle bussen
  let sum = 0;
  const want = candidatesForProductId(productId);
  for (const bucket of Object.values(v)) {
    if (!bucket) continue;
    if (Object.prototype.hasOwnProperty.call(bucket, productId)) {
      sum += Number(bucket[productId] ?? 0);
      continue;
    }
    for (const [k, val] of Object.entries(bucket)) {
      if (want.includes(normalizeKey(k)) || want.includes(k)) {
        sum += Number(val ?? 0);
        break;
      }
    }
  }
  return sum;
}

/**
 * setVoorraadForProduct(productId, qty, busId?)
 * Zet of overschrijft de voorraad-teller voor 1 product in de (eventueel) opgegeven bus.
 * Tolerant qua productnaam; gebruikt bestaande key als die bestaat.
 */
export function setVoorraadForProduct(productId, qty, busId = null) {
  const db = store.state.db || {};
  const v = db.voorraad && typeof db.voorraad === 'object' ? db.voorraad : (db.voorraad = {});
  const key = busId ? findBusKeyCandidate(busId, v) : resolveBusId();
  if (!key) return false;

  const bucket = v[key] || (v[key] = {});

  // bestaande key behouden indien aanwezig
  let prodKey = null;
  if (Object.prototype.hasOwnProperty.call(bucket, productId)) {
    prodKey = productId;
  } else {
    const want = normalizeKey(productId);
    for (const k of Object.keys(bucket)) {
      if (normalizeKey(k) === want) { prodKey = k; break; }
    }
  }
  prodKey = prodKey || productId;
  bucket[prodKey] = Number(qty || 0);
  return true;
}

export function addVoorraadForProduct(productId, delta, busId = null) {
  const increment = Number(delta || 0);
  if (!increment) return getVoorraadForProductInBus(productId, busId);

  const current = getVoorraadForProductInBus(productId, busId);
  const next = Math.max(0, current + increment);
  setVoorraadForProduct(productId, next, busId);
  return next;
}

// ---------- compat voor 6_beheerVoorraad.js ----------
export function getVoorraadMapForBus(busId = null) {
  const db = store.state.db || {};
  const v = db.voorraad && typeof db.voorraad === 'object' ? db.voorraad : null;
  if (!v) return {};
  const hit = busId ? findBusKeyCandidate(busId, v) : resolveBusId();
  return hit ? (v[hit] || {}) : {};
}

// ---------- debug helpers ----------
function pidDebug(p) {
  return p?.naam || p?.name || p?.id || p?.sku || p?.code || '';
}

export function ocAuditStockKeys() {
  const db = store.state.db || {};
  const producten = Array.isArray(db.producten) ? db.producten : [];
  const voorraad = db.voorraad && typeof db.voorraad === 'object' ? db.voorraad : {};
  const busKey = resolveBusId();
  const bucket = busKey ? (voorraad[busKey] || {}) : {};

  const prodKeys = producten.map(p => normalizeKey(pidDebug(p)));
  const bucketKeys = Object.keys(bucket);
  const bucketNorm = bucketKeys.map(normalizeKey);

  const prodSet = new Set(prodKeys);
  const bucketSet = new Set(bucketNorm);

  const unmatchedProducts = producten
    .map(p => pidDebug(p))
    .filter((k, idx) => !bucketSet.has(prodKeys[idx]));
  const unmatchedBucketKeys = bucketKeys.filter((k, idx) => !prodSet.has(bucketNorm[idx]));

  const summary = {
    activeBus: busKey,
    unmatchedProducts,
    unmatchedBucketKeys,
    bucketKeys,
  };
  console.warn('[STOCK:AUDIT]', summary);
  return summary;
}

if (typeof window !== 'undefined') {
  window.ocAuditStockKeys = ocAuditStockKeys;
  if (window.OC_DEBUG_STOCK) {
    const { activeBus, unmatchedProducts, bucketKeys } = ocAuditStockKeys();
    console.warn('[STOCK:SUMMARY]', {
      activeBus,
      sampleUnmatchedProducts: unmatchedProducts.slice(0, 5),
      sampleBucketKeys: bucketKeys.slice(0, 5),
    });
  }
}
