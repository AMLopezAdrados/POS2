// 📦 11_gebruikersbeheer.js – Beheer gebruikers Olga’s Cheese POS

import { db, saveGebruiker } from './3_data.js';
import { showAlert, showMainMenu } from './4_ui.js';

export function beheerGebruikers(container) {
  const mount = resolveContainer(container);
  if (!mount) return;
  renderGebruikersBeheer(mount);
}

export function renderGebruikersBeheer(container) {
  const mount = resolveContainer(container);
  if (!mount) return;

  mount.innerHTML = '';
  mount.classList.add('panel-stack');

  const header = document.createElement('div');
  header.className = 'panel-header';
  header.innerHTML = `<h2>👥 Gebruikersbeheer</h2>`;

  const backBtn = document.createElement('button');
  backBtn.className = 'btn-ghost';
  backBtn.textContent = '🔙 Terug naar menu';
  backBtn.addEventListener('click', showMainMenu);
  header.appendChild(backBtn);
  mount.appendChild(header);

  if (!db.gebruikers.length) {
    const leeg = document.createElement('div');
    leeg.className = 'panel-card muted';
    leeg.textContent = '⚠️ Geen gebruikers gevonden.';
    mount.appendChild(leeg);
    return;
  }

  const lijstCard = document.createElement('div');
  lijstCard.className = 'panel-card';

  const lijst = document.createElement('ul');
  lijst.className = 'user-list';
  lijstCard.appendChild(lijst);

  db.gebruikers.forEach((gebruiker, index) => {
    const item = document.createElement('li');
    item.className = 'user-row';

    const naam = gebruiker.username || 'Naam onbekend';
    const rol = gebruiker.role || 'rol onbekend';

    item.innerHTML = `
      <div class="user-meta">
        <b>${naam}</b>
        <span>Rol: <i>${rol}</i></span>
      </div>
      <div class="user-actions">
        <button class="btn-secondary" data-action="edit" data-index="${index}">✏️ Bewerken</button>
        <button class="btn-danger" data-action="remove" data-index="${index}">🗑️ Verwijderen</button>
      </div>
    `;
    lijst.appendChild(item);
  });

  lijst.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    if (btn.dataset.action === 'edit') {
      window.openBewerkGebruikerModal?.(idx);
    } else if (btn.dataset.action === 'remove') {
      window.verwijderGebruiker?.(idx);
    }
  });

  mount.appendChild(lijstCard);

  const footer = document.createElement('div');
  footer.className = 'panel-footer';
  const nieuweGebruikerBtn = document.createElement('button');
  nieuweGebruikerBtn.className = 'btn-primary';
  nieuweGebruikerBtn.textContent = '➕ Nieuwe gebruiker toevoegen';
  nieuweGebruikerBtn.onclick = openNieuweGebruikerModal;
  footer.appendChild(nieuweGebruikerBtn);
  mount.appendChild(footer);
}

function resolveContainer(container) {
  if (container instanceof HTMLElement) return container;
  if (typeof container === 'string') return document.querySelector(container);
  return document.getElementById('panel-gebruikers') || document.getElementById('app');
}

function openNieuweGebruikerModal() {
  const modal = document.createElement("div");
  modal.className = "modal";

  const permissiesLijst = [
    { key: 'voorraad', label: '📦 Voorraad beheren' },
    { key: 'verkoop', label: '🧀 Verkoop doen' },
    { key: 'sessies', label: '📅 Sessies beheren' },
    { key: 'evenementen', label: '🎪 Evenementen beheren' },
    { key: 'kostenbeheer', label: '💵 Kosten beheren' },
    { key: 'gebruikersbeheer', label: '👥 Gebruikersbeheer' },
    { key: 'export', label: '📄 Exporteren' },
    { key: 'dashboard', label: '📊 Dashboard bekijken' }
  ];

  modal.innerHTML = `
    <div style="text-align:center;">
      <h2>➕ Nieuwe Gebruiker</h2>
      <label>Gebruikersnaam:</label><br>
      <input id="nieuweNaam" placeholder="Naam" style="margin:10px;width:80%;"><br>
      <label>Rol:</label><br>
      <select id="nieuweRol" style="margin:10px;width:80%;">
        <option value="verkoper">Verkoper</option>
        <option value="admin">Admin</option>
      </select><br>

      <h3 style="margin-top:1rem;">🛡️ Permissies:</h3>
      <div class="permissies-grid">
        ${permissiesLijst.map(perm => `
          <label class="pretty-checkbox">
            <input type="checkbox" class="permCheckbox" value="${perm.key}" ${['voorraad', 'verkoop'].includes(perm.key) ? 'checked' : ''}>
            <span>${perm.label}</span>
          </label>
        `).join('')}
      </div>

      <br>
      <button id="opslaanNieuweGebruiker" style="margin-top:1rem;">✅ Opslaan</button><br><br>
      <button onclick="this.closest('.modal').remove()">Annuleer</button>
    </div>
  `;
  document.body.appendChild(modal);

  // 🎯 Admin rol? --> Alle vinkjes aanzetten
  document.getElementById("nieuweRol").addEventListener("change", () => {
    const isAdmin = document.getElementById("nieuweRol").value === "admin";
    document.querySelectorAll(".permCheckbox").forEach(cb => {
      cb.checked = isAdmin || ['voorraad', 'verkoop'].includes(cb.value);
    });
  });

  document.getElementById("opslaanNieuweGebruiker").onclick = async () => {
    const naam = document.getElementById("nieuweNaam").value.trim();
    const rol = document.getElementById("nieuweRol").value;
    const permissies = Array.from(document.querySelectorAll(".permCheckbox"))
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    if (!naam) {
      showAlert("⚠️ Naam is verplicht.", "warning");
      return;
    }

    db.gebruikers.push({
      username: naam,
      role: rol,
      permissies: permissies
    });

    await saveGebruiker(db.gebruikers);
    modal.remove();
    showAlert("✅ Nieuwe gebruiker toegevoegd!", "success");
    beheerGebruikers();
  };
}

function openBewerkGebruikerModal(index) {
  const gebruiker = db.gebruikers[index];
  if (!gebruiker) return;

  const modal = document.createElement("div");
  modal.className = "modal";

  modal.innerHTML = `
    <div style="text-align:center; padding: 1rem;">
      <h1>✏️ Gebruiker Bewerken</h1>
      
      <label for="bewerkNaam">Gebruikersnaam:</label><br>
      <input id="bewerkNaam" value="${gebruiker.username || ''}" placeholder="Gebruikersnaam" style="margin:10px; width:80%;"><br>

      <label for="bewerkWachtwoord">Nieuw wachtwoord:</label><br>
      <input id="bewerkWachtwoord" type="password" placeholder="Nieuw wachtwoord (optioneel)" style="margin:10px; width:80%;"><br>

      <label for="bewerkRol">Rol:</label><br>
      <select id="bewerkRol" style="margin:10px; width:80%;">
        <option value="verkoper" ${gebruiker.role === 'verkoper' ? 'selected' : ''}>Verkoper</option>
        <option value="admin" ${gebruiker.role === 'admin' ? 'selected' : ''}>Admin</option>
      </select><br>

      <h3>Permissies:</h3><br>
      <div style="text-align:left; display:inline-block; margin:10px;">
        <div class="permissies-grid">
  ${[
    { key: 'voorraad', label: '📦 Voorraad beheren' },
    { key: 'verkoop', label: '🧀 Verkoop doen' },
    { key: 'sessies', label: '📅 Sessies beheren' },
    { key: 'evenementen', label: '🎪 Evenementen beheren' },
    { key: 'kostenbeheer', label: '💵 Kosten beheren' },
    { key: 'gebruikersbeheer', label: '👥 Gebruikersbeheer' },
    { key: 'export', label: '📄 Exporteren' },
    { key: 'dashboard', label: '📊 Dashboard bekijken' }
  ].map(perm => `
    <label class="pretty-checkbox">
      <input type="checkbox" class="permCheckbox" value="${perm.key}" ${gebruiker.permissies?.includes(perm.key) ? 'checked' : ''}>
      <span>${perm.label}</span>
    </label>
  `).join('')}
</div>
      <div style="margin-top: 20px;">
        <button id="opslaanBewerking">✅ Opslaan</button>
        <button id="stuurWachtwoordBtn" style="margin-left:10px;">✉️ Stuur Wachtwoord</button><br><br>
        <button onclick="this.closest('.modal').remove()">Annuleer</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // ✅ Opslaan knop
  document.getElementById("opslaanBewerking").onclick = async () => {
    const nieuweNaam = document.getElementById("bewerkNaam").value.trim();
    const nieuweRol = document.getElementById("bewerkRol").value;
    const nieuwWachtwoord = document.getElementById("bewerkWachtwoord").value.trim();
    const permissieCheckboxes = document.querySelectorAll(".permCheckbox");
    const permissies = Array.from(permissieCheckboxes)
                            .filter(cb => cb.checked)
                            .map(cb => cb.value);

    if (!nieuweNaam) {
      showAlert("⚠️ Gebruikersnaam is verplicht.", "warning");
      return;
    }

    gebruiker.username = nieuweNaam;
    gebruiker.role = nieuweRol;
    gebruiker.permissies = permissies;
    if (nieuwWachtwoord) {
      gebruiker.password = nieuwWachtwoord;
    }

    await saveGebruiker(db.gebruikers);
    modal.remove();
    showAlert("✅ Gebruiker bijgewerkt.", "success");
    beheerGebruikers();
  };

  // ✉️ Wachtwoord e-mail knop
  document.getElementById("stuurWachtwoordBtn").onclick = () => {
    alert(`✉️ (Later actief) E-mail sturen naar: ${gebruiker.username}@voorbeeld.com`);
  };
}

function verwijderGebruiker(index) {
  if (!confirm("❗ Weet je zeker dat je deze gebruiker wilt verwijderen?")) return;

  db.gebruikers.splice(index, 1);
  saveGebruiker(db.gebruikers)
    .then(() => {
      showAlert("✅ Gebruiker verwijderd.", "success");
      beheerGebruikers();
    })
    .catch(err => {
      console.error("❌ Fout bij verwijderen gebruiker:", err);
      showAlert("⚠️ Verwijderen mislukt.", "error");
    });
}

export function upgradeGebruikersData() {
  db.gebruikers.forEach(gebruiker => {
    if (!gebruiker.permissies) {
      if (gebruiker.role === "admin") {
        gebruiker.permissies = [
          'voorraad', 'verkoop', 'sessies', 'evenementen', 'kostenbeheer', 'gebruikersbeheer', 'export', 'dashboard'
        ];
      } else {
        gebruiker.permissies = ['voorraad', 'verkoop'];
      }
    }
  });
}

window.openBewerkGebruikerModal = openBewerkGebruikerModal;
window.verwijderGebruiker = verwijderGebruiker;