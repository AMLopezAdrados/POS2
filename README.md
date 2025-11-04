# Olga's Cheese POS

Modulaire POS-webapp (HTML/JS) met verkoopregistratie, voorraad, evenementen en exports.

## Repo-structuur
- `modules/` – alle JS-modules (dagomzet, events, inzicht, etc.)
- `api/`     – PHP/JSON endpoints
- `assets/`  – logo’s / styles (optioneel)
- `docs/`    – documentatie (bv. verkoopdata-infra)
- `index.html`, `style.css`, `sw.js`, ...

## Legacy
- De losse accounting-subapp is verwijderd; boekhouding loopt buiten de POS.

## Boekhouding & offline retries
- Nieuwe accountingdata leeft in `accounting.json` en wordt geladen naar `db.accounting`.
- Opslaan gaat via `saveAccountingData` → `api/save_accounting.php` (atomair schrijven met tmp-bestand).
- Bij netwerkfouten markeren `recordLedgerEntry`, `updateLedgerEntry` en `deleteLedgerEntry` regels als `pending` en plaatsen ze in `db.accounting.pendingQueue` voor automatische retry zodra de verbinding terug is.
- De wachtrij wordt tevens in `localStorage` bewaard en `processAccountingPendingQueue` triggert automatische sync wanneer `navigator.onLine` omschakelt naar online.

## Exports & rapportage
- Het **Insights**-paneel bevat nu een tab "Boekhouding" met KPI-kaarten en grafieken per maand, categorie en rekening. Deze visualisaties combineren dagomzet met het grootboek (`db.accounting`).
- De accountinghub (`modules/18_accounting.js`) biedt exportknoppen voor **CSV**, **Excel** en **PDF**. De filters (event, rekening, periode) worden toegepast op alle exports. Bedragen worden overal geformatteerd via `formatCurrencyValue` zodat valuta-consistentie gewaarborgd blijft.
- `api/Finance.php` levert één gecombineerde payload met event-metrics én ledger-entries. Hierdoor kan externe boekhouding dezelfde JSON gebruiken voor rapportage, audit of import naar een financieel pakket.

### Standaard categoriecodes
Categorieën in `accounting.json` sturen de aggregaties en labels in de dashboards. Onderstaande codes worden standaard gehanteerd binnen Olga's Cheese POS:

| Code                | Beschrijving                           |
|---------------------|-----------------------------------------|
| `sales.direct`      | Contante/pin omzet op events            |
| `sales.debtor`      | Gefactureerde omzet (debiteuren)        |
| `costs.fixed`       | Vaste lasten (stageld, commissie)       |
| `costs.variable`    | Variabele kosten (eten, crew, promo)    |
| `costs.travel`      | Reiskosten (diesel, tol, hotel)         |
| `inventory.purchases` | Inkoop van kaas en merchandise        |
| `fees.payment`      | Betaal-/transactiekosten                |
| `other.misc`        | Overige posten                          |

Breid het overzicht uit door dezelfde structuur (`id`, `name`) in `accounting.json` te gebruiken; de nieuwe rapportages nemen de labels automatisch over.

## Verkoopdata-infra (BELANGRIJK)
- Verkoopregistratie gebeurt uitsluitend via tellingen en dagomzet (`modules/8_verkoopscherm.js`).
- Dagtotalen worden opgeslagen in `evenementen/<id>/omzet.json`; individuele transacties worden **niet** meer bewaard.
- De legacy-map **/api/verkopen/** blijft alleen bestaan voor opruimen. Gebruik `DELETE /verkopen/index.php/<event>/<sessie>.json` om oude sessiebestanden te verwijderen.
- Applicatiecode mag niet meer naar `/api/verkopen/` schrijven en verwijst alleen naar dagomzet- en telling-API’s.

## Lokale dev
Open `index.html` in de browser óf draai een simpele server:
```bash
python3 -m http.server 8000



