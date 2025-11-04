// 📦 autoRefresh.js

import { loadData } from './3_data.js';
import { toonVerkoopKnoppen } from './8_verkoopscherm.js';

let intervalId = null;

/**
 * Start een interval dat elke 5 seconden:
 * - data herlaadt
 * - verkoopknoppen opnieuw tekent
 * - omzetkaart bijwerkt met animatie als data verandert
 */
export function startAutoRefresh() {
  if (intervalId) return;

  intervalId = setInterval(async () => {
    console.log('🔄 Auto-refresh gestart...');
    await loadData();
    toonVerkoopKnoppen();

    if (typeof window.updateOmzetCard === 'function') {
      window.updateOmzetCard();
    }
  }, 5000);
}

/** Stop de auto-refresh en reset state */
export function stopAutoRefresh() {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
  console.log('⏹️ Auto-refresh gestopt.');
}