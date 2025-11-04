// modules/19_settings.js – Instellingenbeheer
import { getKnownLocations, saveSettings } from './3_data.js';
import { showAlert } from './4_ui.js';
import { store } from './store.js';

const settingsMountRegistry = new Map();
let storeListenerBound = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function registerMount(mount, renderFn) {
  settingsMountRegistry.set(mount, renderFn);
  if (storeListenerBound) return;
  storeListenerBound = true;
  store.on('settings:updated', () => {
    settingsMountRegistry.forEach((render, host) => {
      if (!host.isConnected) {
        settingsMountRegistry.delete(host);
        return;
      }
      try {
        render();
      } catch (err) {
        console.warn('[POS] Settings her-render mislukt:', err);
      }
    });
  });
}

function normalizeName(value) {
  return value.replace(/\s+/g, ' ').trim();
}

export function renderSettingsPage(target = '#panel-settings') {
  const mount = typeof target === 'string' ? document.querySelector(target) : target;
  if (!mount) return;

  mount.classList.add('settings-panel');
  mount.innerHTML = `
    <div class="panel-card settings-card">
      <header class="settings-card-head">
        <div>
          <h2>⚙️ Instellingen</h2>
          <p class="muted">Beheer vaste waarden die gebruikt worden bij planning en rapportages.</p>
        </div>
      </header>
      <section class="settings-section">
        <div class="settings-section-head">
          <div>
            <h3>📍 Locaties</h3>
            <p class="muted">Deze lijst verschijnt bij het plannen van evenementen.</p>
          </div>
          <span class="settings-location-count muted"></span>
        </div>
        <form class="settings-location-form" autocomplete="off">
          <div class="settings-location-form__row">
            <input type="text" class="settings-location-input" placeholder="Nieuwe locatie" aria-label="Nieuwe locatie" required>
            <button type="submit" class="btn-primary settings-location-submit">Toevoegen</button>
          </div>
        </form>
        <ul class="settings-location-list"></ul>
      </section>
    </div>
  `;

  const listEl = mount.querySelector('.settings-location-list');
  const countEl = mount.querySelector('.settings-location-count');
  const form = mount.querySelector('.settings-location-form');
  const input = mount.querySelector('.settings-location-input');
  const submitBtn = mount.querySelector('.settings-location-submit');

  if (!listEl || !form || !input || !submitBtn) {
    return;
  }

  const renderLocations = () => {
    const locations = getKnownLocations();
    if (countEl) {
      const label = locations.length === 1 ? 'locatie' : 'locaties';
      countEl.textContent = `${locations.length} ${label}`;
    }
    if (!locations.length) {
      listEl.innerHTML = '<li class="settings-location-empty">Nog geen locaties opgeslagen. Voeg hierboven een locatie toe.</li>';
      return;
    }
    listEl.innerHTML = locations
      .map(loc => `
        <li class="settings-location-item">
          <span class="settings-location-label">${escapeHtml(loc)}</span>
          <div class="settings-location-actions">
            <button type="button" class="btn-danger settings-location-remove" data-loc="${escapeHtml(loc)}" aria-label="Verwijder ${escapeHtml(loc)}">Verwijderen</button>
          </div>
        </li>
      `)
      .join('');
  };

  registerMount(mount, renderLocations);
  renderLocations();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const normalized = normalizeName(input.value || '');
    if (!normalized) {
      showAlert('Voer een locatienaam in.', 'warning');
      input.focus();
      return;
    }
    const existing = getKnownLocations();
    const exists = existing.some(loc => loc.toLowerCase() === normalized.toLowerCase());
    if (exists) {
      showAlert('Deze locatie staat al in de lijst.', 'info');
      input.focus();
      return;
    }

    submitBtn.disabled = true;
    try {
      const updated = [...existing, normalized];
      const ok = await saveSettings({ locaties: updated }, { silent: true });
      if (ok) {
        showAlert(`Locatie '${normalized}' toegevoegd.`, 'success');
        input.value = '';
        renderLocations();
      } else {
        showAlert('Locatie kon niet worden toegevoegd.', 'error');
      }
    } catch (err) {
      console.error('[POS] Locatie toevoegen mislukt:', err);
      showAlert('Locatie kon niet worden toegevoegd.', 'error');
    } finally {
      submitBtn.disabled = false;
      input.focus();
    }
  });

  listEl.addEventListener('click', async (ev) => {
    const button = ev.target instanceof HTMLElement
      ? ev.target.closest('.settings-location-remove')
      : null;
    if (!button) return;
    const loc = button.dataset.loc || '';
    if (!loc) return;
    if (!window.confirm(`Locatie '${loc}' verwijderen?`)) return;

    button.disabled = true;
    try {
      const existing = getKnownLocations();
      const updated = existing.filter(item => item.toLowerCase() !== loc.toLowerCase());
      const ok = await saveSettings({ locaties: updated }, { silent: true });
      if (ok) {
        showAlert(`Locatie '${loc}' verwijderd.`, 'success');
        renderLocations();
      } else {
        showAlert('Locatie kon niet worden verwijderd.', 'error');
      }
    } catch (err) {
      console.error('[POS] Locatie verwijderen mislukt:', err);
      showAlert('Locatie kon niet worden verwijderd.', 'error');
    } finally {
      button.disabled = false;
    }
  });
}

export default { renderSettingsPage };
