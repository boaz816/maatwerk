# Maatwerk

Muziek-oefengame in de browser: ritme meeklikken, absoluut en relatief gehoor, BPM raden en
maatsoort herkennen, met een statistiekenpagina.

**Online:** https://boaz816.github.io/maatwerk/ — die link kun je doorsturen. Op een telefoon kun je hem
op je beginscherm zetten, dan werkt hij als een app, ook zonder internet:
- iPhone: open de link in Safari → Deel-knop → *Zet op beginscherm*.
- Android: open de link in Chrome → menu (⋮) → *Toevoegen aan startscherm* of *App installeren*.

Op iPhone heeft de app op het beginscherm een eigen opslag, los van Safari. Zet hem er dus eerst op en speel
dan daar, anders lijken je scores weg.

**Bijwerken:** elke wijziging die op GitHub in `main` komt, staat binnen een paar minuten online. Wie de app
daarna opent (of nog open heeft), krijgt bovenaan de melding *Er is een nieuwe versie* met een knop
*Bijwerken*. Eén tik en de nieuwe versie staat erop.

**Lokaal openen:** dubbelklik op `index.html`. Of start een kleine server in deze map en ga naar
http://localhost:5183:

    python3 -m http.server 5183

**Eerst doen:** ga naar Instellingen → Timing kalibreren, met de koptelefoon of speakers waarmee je
oefent. Vooral bij bluetooth is dat nodig, anders lijkt het alsof je steeds te laat klikt.

Je gegevens staan alleen in deze browser. Maak af en toe een reservekopie via
Instellingen → Exporteren.

Voor wie eraan bouwt: zie `docs/CONTRACT.md` (afspraken) en `design-system/maatwerk/MASTER.md` (stijl).
