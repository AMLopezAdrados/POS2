// 📦 modules/disableRefresh.js

/**
 * Blokkeer F5 en Ctrl+R om refresh in de app uit te schakelen.
 */
export function disableRefreshKeys() {
  window.addEventListener('keydown', e => {
    // F5
    if (e.key === 'F5') {
      e.preventDefault();
    }
    // Ctrl+R of Cmd+R
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault();
    }
  });
}
