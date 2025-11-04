🧠 Olga’s Cheese POS – AGENTS.md
Mobile-First Event Management & Insight Platform
🧭 Mission

Olga’s Cheese POS is een mobiel-gerichte webapp voor dagelijkse administratie, voorraadvergelijking en winst-inzicht.
Niet langer een kassa-app, maar een “smart notebook” dat helpt om elk evenement winstgevend te houden door drie eenvoudige pijlers:

📊 Verkoopmix – inzicht krijgen in productprestaties via tellingen.

💰 Kosten & Baten – alles registreren wat geld oplevert of kost.

🔍 Inzicht & Rapportage – omzet, marges, kosten en trends begrijpen.

📱 Mobile-First Philosophy

Offline-first: werkt volledig zonder internet, synchroniseert bij verbinding.

Touch-geoptimaliseerd: ontworpen voor telefoons en tablets.

Één scherm = één taak: duidelijk, snel, foutloos.

Server-is-leading: synchronisatie herstelt altijd naar serverstatus.

Lage cognitieve belasting: minder klikken, minder tekst, meer overzicht.

🧩 System Architecture
/modules/
  1_sessiebeheer.js
  2_tellingen.js
  3_kostenbaten.js
  4_inzichten.js
  5_data.js
  6_exports.js
  7_ui.js
/api/
  evenementen.json
  voorraad.json
  producten.json
  kosten.json
  omzet.json

⚙️ Kernconcepten
Onderdeel	Functie	Beschrijving
Event	Administratieve eenheid	Verzamelt alle tellingen, kosten en baten.
Telling	Begin/eindvoorraad	Gebruiker telt kazen → systeem berekent verschil.
Verkoopmix	Resultaat van telling	Percentages per product (voor inkoopplanning).
Omzet	Dagelijkse registratie	Gebruiker voert totale dagomzet in USD/EUR in.
Kosten	Vaste & variabele posten	Commissie, stageld, diesel, overnachting, eten, enz.
Inzichten	Geaggregeerde data	Grafieken en tabellen over omzet, kosten en winst.
🔄 Data Flow Overview
Type	Locatie	Schrijfmethode	Beschrijving
Productdata	/api/producten.json	saveProducts()	Lijst van alle kazen en souvenirs
Voorraad	/api/voorraad.json	saveVoorraad()	Begin- en eindvoorraad per event
Evenementen	/api/evenementen.json	saveEvent()	Basisinfo: locatie, type, commissie, etc.
Tellingen	/api/evenementen/<id>/tellingen.json	saveTelling()	Begin- en eindtelling
Kosten	/api/evenementen/<id>/kosten.json	saveKosten()	Alle kostenposten
Omzet	/api/evenementen/<id>/omzet.json	saveOmzet()	Dagelijkse omzet
Inzichten	Berekening client-side	generateInsights()	Grafieken, ratios, verkoopmix
🧑‍💻 De Drie Hoofdtaken
1️⃣ Verkoopmix Maken

Gebruiker voert begin- en eindtelling in per product.

App berekent automatisch het verschil = verkoopmix.

Mix wordt weergegeven in percentages per product (bv. BG Natural 2.3%, Rook Herbs 1.8%).

Doel: inzicht in verkoopverhouding en toekomstige inkoopbehoefte.

Data opgeslagen in tellingen.json.

Scherm:

Grid van producten met telvelden begin/eind.

Automatische berekening na elke wijziging.

Opslaan-knop + grafiek (pie/bar).

2️⃣ Kosten/Baten Tracking

Aan het eind van elke dag:

Gebruiker vult omzet in (USD/EUR).

App berekent vaste kosten (kaaskosten, commissie, stageld).

Gebruiker voegt variabele of incidentele kosten toe (diesel, eten, overnachting, anders).

Alle bedragen worden opgeslagen in kosten.json en omzet.json.

Scherm:

Drie kolommen:

Vaste kosten

Diesel & Overnachting

Eten & Anders

Knoppen:

“+ Kost Toevoegen” → dropdown + bedrag + commentaarveld bij “Anders”.

“Dagomzet Registreren” → formulier met valuta, datum en bedrag.

3️⃣ Inzicht & Rapportage

Gebruiker kan op elk moment inzichten oproepen:

Omzet per dag of event (USD/EUR).

Kostenverdeling per categorie.

Verkoopmix visualisatie (piechart/bar).

Nettoresultaat en marges.

Data komt uit lokale cache, berekend via generateInsights().

Scherm:

Compact grid met grafieken:

Piechart (kosten)

Bar (omzet per dag)

Bar (verkoopmix per product)

Export-knoppen: PDF / Excel.

📊 Exports & Analyse
Bestand	Inhoud	Opmaak
PDF	Kosten/baten analyse, omzetoverzicht, verkoopmix	Logo bovenaan, kleuren #FFC500 / #2A9626
Excel	Tabellen voor kosten, omzet, mix, winst	Gestructureerd, sorteerbaar
CSV	Vereenvoudigde data voor boekhouding	Datum, type, bedrag, categorie
💻 UI/UX Richtlijnen
Element	Richtlijn
Layout	Mobile-first, verticale scroll, duidelijke secties
Kleuren	Primair geel #FFC500, secundair groen #2A9626, fout rood #E74C3C
Typografie	Grote cijfers en titels voor snelle interpretatie
Knoppen	Minimaal, afgerond, max. 4 per rij, directe feedback
Grafieken	Compact, responsive, consistent in kleurcodering
Modals	Gecentreerd, blurred overlay, één sluitactie
Focus	Snel in te vullen velden, weinig tekstinvoer
Offline modus	Data opslaan in cache + sync bij reconnect
🚫 Verboden

❌ Transactie-per-verkoop opslag (verkoopManager legacy).

❌ Writes naar evenementen.json buiten metadata.

❌ Complexe interfaces (geen nested modals of submenu’s).

❌ Nieuwe dependencies zonder toestemming.

❌ Onvolledige module-snippets of console-errors in PR’s.

✅ Acceptatiecriteria

Tellingen correct opgeslagen en verschil berekend.

Kosten per categorie correct gegroepeerd en opslaan werkt.

Dagelijkse omzet invoer correct en persistent.

Inzichten tonen juiste berekende data (mix, kosten, omzet).

PDF/Excel exports volledig en visueel correct.

UI mobiel-vriendelijk, foutloos en zonder lag.

App blijft bruikbaar offline en synchroniseert bij reconnect.

🧠 Agents (Nieuw Functioneel Model)
Agent	Taak	Beschrijving
TellingAgent	Beheert begin/eindtelling, berekent verkoopmix.	
KostenAgent	Registreert vaste, variabele en incidentele kosten.	
OmzetAgent	Verwerkt dagomzet en omzetanalyses.	
InsightAgent	Genereert grafieken en rapportages.	
SyncAgent	Synchroniseert lokale data met server.	
ExportAgent	Bouwt PDF/Excel-rapporten met bedrijfsstijl.	
UIAgent	Houdt UX consistent en reageert op status (offline/online).	
🧾 Developer Checklist

 Begin- en eindtelling invoer werkt correct

 Verkoopmixberekening klopt (percentages afgerond)

 Dagomzet kan worden ingevoerd en opgeslagen

 Kosten verschijnen in juiste categorie met totalen

 Inzichten tonen juiste waarden (mix/kosten/omzet)

 Exports genereren zonder fouten

 Offline → online sync getest

 Geen console-fouten

🌍 Roadmap (vNext)

🔐 Inlog + rechten per gebruiker

💼 Gebruikersbeheer & rollen

📅 Meerdere events tegelijk

🧾 Volledige boekhoudexport

🧠 Slimme inkoopvoorspelling op basis van verkoopmix

📈 AI-gestuurde kostenanalyse (detecteert afwijkingen)

⚡ Quick Summary for Agents

“Meet. Log. Understand.”

Geen transacties, alleen tellingen en totals.

Data = eenvoud → inzicht → betere inkoop.

App = mobiel, offline, agent-gedreven.
