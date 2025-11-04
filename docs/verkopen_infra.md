# Verkoopdata-infrastructuur (v2)
- Geen transactiesessies meer: verkoopdata komt uit tellingen en `omzet.json` per event.
- Dagomzet wordt aangemaakt in de dagomzetmodule en gesynchroniseerd via `save_evenement.php` per event.
- De map `/api/verkopen/` is legacy. Gebruik `DELETE /verkopen/index.php/<event>/<sessie>.json` om achtergebleven bestanden te verwijderen.
- Oude clients of scripts mogen niet langer naar `/api/verkopen/` schrijven; verwijder referenties naar `verkoopManager`.
