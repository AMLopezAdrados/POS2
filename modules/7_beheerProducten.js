// 📦 7_beheerProducten.js – Productbeheer Olga's Cheese POS

import { db, saveProducten } from './3_data.js';
import { toonVerkoopKnoppen } from './8_verkoopscherm.js';
import { toonVoorraadModal } from './6_beheerVoorraad.js';

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

export function openProductModal() {
  const gebruiker = JSON.parse(localStorage.getItem("gebruiker"));
  if (!gebruiker || gebruiker.role !== 'admin') {
    alert("❌ Alleen admins mogen producten beheren.");
    return;
  }

  document.querySelectorAll('.modal').forEach(m => m.remove());

  const { overlay: modal, close } = buildOverlay(() => {
    toonVoorraadModal();
    toonVerkoopKnoppen();
  });

  const content = document.createElement("div");
  Object.assign(content.style, {
    background: "#fff",
    padding: "2rem",
    borderRadius: "12px",
    maxWidth: "800px",
    maxHeight: "80vh",
    overflowY: "auto",
    boxShadow: "0 0 10px rgba(0,0,0,0.3)",
    width: "95vw"
  });

  content.innerHTML = `
    <h2>📦 Productbeheer</h2>
    <table style="width:100%; border-collapse: collapse;" id="productTable">
      <thead>
        <tr><th>Naam</th><th>USD</th><th>EUR</th><th>Inkoop</th><th>Leverancier</th><th>Type</th><th></th></tr>
      </thead>
      <tbody id="productList">
        ${db.producten.map((p, i) => `
          <tr data-index="${i}">
            <td><input value="${p.naam}" style="width:100px"></td>
            <td><input type="number" step="0.01" value="${p.usd ?? ''}" style="width:70px"></td>
            <td><input type="number" step="0.01" value="${p.eur ?? ''}" style="width:70px"></td>
            <td><input type="number" step="0.01" value="${p.inkoop ?? ''}" style="width:70px"></td>
            <td><input value="${p.leverancier ?? ''}" style="width:120px"></td>
            <td>
              <select style="width:100px">
                <option value="BG" ${p.type === 'BG' ? 'selected' : ''}>BG</option>
                <option value="ROOK" ${p.type === 'ROOK' ? 'selected' : ''}>ROOK</option>
                <option value="GEIT" ${p.type === 'GEIT' ? 'selected' : ''}>GEIT</option>
                <option value="SOUV" ${p.type === 'SOUV' ? 'selected' : ''}>SOUV</option>
                <option value="KOEK" ${p.type === 'KOEK' ? 'selected' : ''}>KOEK</option>
                <option value="MOSTERD" ${p.type === 'MOSTERD' ? 'selected' : ''}>MOSTERD</option>
                <option value="OUD" ${p.type === 'OUD' ? 'selected' : ''}>OUD</option>
              </select>
            </td>
            <td><button onclick="window.verwijderProduct(${i})">🗑️</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div style="margin-top: 1rem;">
      <button id="nieuwProductBtn">➕ Nieuw product</button>
      <button id="opslaanProducten">💾 Opslaan</button>
      <button id="sluitProductModalBtn">❌ Sluiten</button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  document.getElementById('nieuwProductBtn').onclick = () => {
    close();
    openAddProductModal();
  };

  document.getElementById("opslaanProducten").onclick = async () => {
    const rows = document.querySelectorAll("#productList tr");
    if (rows.length === 0) {
      alert("❌ Geen rijen gevonden in productList");
      return;
    }

    db.producten = Array.from(rows).map(row => {
      const inputs = row.querySelectorAll("input");
      const select = row.querySelector("select");
      const leverancier = inputs[4]?.value?.trim?.() || "";
      return {
        naam: inputs[0]?.value.trim() || "",
        usd: parseFloat(inputs[1]?.value) || 0,
        eur: parseFloat(inputs[2]?.value) || 0,
        inkoop: parseFloat(inputs[3]?.value) || 0,
        leverancier,
        supplier: leverancier,
        type: select?.value || ""
      };
    });

    try {
      await saveProducten();
      alert("✅ Producten opgeslagen.");
    } catch (err) {
      alert("⚠️ Opslaan mislukt.");
    }

    close();
  };

  document.getElementById("sluitProductModalBtn").onclick = close;
}

function openAddProductModal() {
  const gebruiker = JSON.parse(localStorage.getItem('gebruiker'));
  if (!gebruiker || gebruiker.role !== 'admin') {
    alert('❌ Alleen admins mogen producten beheren.');
    return;
  }

  document.querySelectorAll('.modal').forEach(m => m.remove());

  const { overlay: modal, close } = buildOverlay(() => openProductModal());

  const content = document.createElement('div');
  Object.assign(content.style, {
    background:'#fff', padding:'1.5rem', borderRadius:'12px', width:'min(400px,90vw)',
    boxShadow:'0 0 10px rgba(0,0,0,0.3)', display:'flex', flexDirection:'column', gap:'.6rem'
  });

  content.innerHTML = `
    <h3 style="margin-top:0">➕ Nieuw product</h3>
    <input id="addNaam" placeholder="Naam" />
    <input id="addUSD" type="number" step="0.01" placeholder="USD" />
    <input id="addEUR" type="number" step="0.01" placeholder="EUR" />
    <input id="addInkoop" type="number" step="0.01" placeholder="Inkoop (EUR)" />
    <input id="addLeverancier" placeholder="Leverancier" />
    <select id="addType">
      <option value="">-- Kies type --</option>
      <option value="BG">BG</option>
      <option value="ROOK">ROOK</option>
      <option value="GEIT">GEIT</option>
      <option value="SOUV">SOUV</option>
      <option value="KOEK">KOEK</option>
      <option value="MOSTERD">MOSTERD</option>
      <option value="OUD">OUD</option>
    </select>
    <div style="display:flex; gap:.5rem; margin-top:.5rem; justify-content:flex-end;">
      <button id="addSave">Opslaan</button>
      <button id="addCancel">Annuleren</button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  document.getElementById('addSave').onclick = () => {
    const naam = document.getElementById('addNaam').value.trim();
    const usd = parseFloat(document.getElementById('addUSD').value);
    const eur = parseFloat(document.getElementById('addEUR').value);
    const inkoop = parseFloat(document.getElementById('addInkoop').value);
    const leverancier = document.getElementById('addLeverancier').value.trim();
    const type = document.getElementById('addType').value.trim().toUpperCase();
    if (!naam || isNaN(usd) || isNaN(eur) || isNaN(inkoop) || !type) {
      alert('⚠️ Vul alle velden correct in.');
      return;
    }
    db.producten.push({ naam, usd, eur, inkoop, type, leverancier, supplier: leverancier });
    close();
  };
  document.getElementById('addCancel').onclick = close;
}

// Window exposen voor inline button events
function verwijderProduct(index) {
  db.producten.splice(index, 1);
  openProductModal();
}

window.verwijderProduct = verwijderProduct;
window.openProductModal = openProductModal;
