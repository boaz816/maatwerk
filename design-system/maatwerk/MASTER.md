# Maatwerk — ontwerpsysteem (bron van waarheid)

Gekozen met de ui-ux-pro-max-skill: stijl "Modern Dark (Cinema)", aangepast voor het web, met de
kleurlogica van muziek-apps (donkere basis, heldere accenten). De eerste automatische suggestie
(claymorphism, webinar-indeling) paste niet bij een oefenapp en is verworpen.

## Karakter
Een rustige studio-omgeving: diep donker, dunne lijnen, weinig ruis, één heldere kleur per oefening.
Het speelscherm is groot en leeg genoeg om je op het geluid te concentreren; cijfers zijn scherp en
in monospace, zodat ms en bpm als meetwaarden lezen.

## Tokens (zie css/base.css)
- Ondergrond: `--bg #09090c` → `--bg-2` → `--surface #13131a` → `--surface-2` → `--surface-3`
- Lijnen: `--line` (7% wit), `--line-2` (12% wit)
- Tekst: `--text #ededf2`, `--text-2 #a3a3b3` (≥ 4.5:1 op surface), `--text-3 #7c7c8e` (alleen bijzaak)
- Oefeningen: ritme `--c-ritme #3ddc84`, gehoor `--c-gehoor #8b7cff`, bpm `--c-bpm #ffb547`, maatsoort `--c-maat #4cc3ff`
- Betekenis: `--ok` raak, `--early` te vroeg (blauw), `--late` te laat (oranje), `--bad` fout, `--warn`
- Letters: Inter (interface), JetBrains Mono (cijfers)
- Hoeken: 8 / 12 / 18 px. Beweging: `--ease` = cubic-bezier(.16,1,.3,1), 150–240 ms

## Regels
1. Eén accentkleur per scherm: `var(--mode)`. Betekeniskleuren alleen voor feedback.
2. Kleur nooit als enige drager van betekenis: altijd teken (+/−), woord of icoon erbij.
3. Lijn-iconen uit `App.ui.icon`, geen emoji.
4. Klikdoelen ≥ 44 px, zichtbare focusring, alles met toetsenbord te bedienen.
5. Telefoon (375 px) tot breedbeeld, geen horizontale scroll; op mobiel een onderbalk.
6. Grote speelknop (`.btn-lg .btn-primary`), instellingen in `.panel`, resultaten met `scoreRing` + `.stat`.
7. Geen versiering die niets betekent; animatie laat iets zien (een tel, een treffer, een overgang).
