#!/bin/sh
# Zet de site klaar om online te zetten: kopieert de app naar een nieuwe map en vult de versie in
# (index.html, sw.js, version.json). GitHub doet dit bij elke push naar main; zie docs/CONTRACT.md.
# Gebruik: sh tools/bouw-site.sh <nieuwe-map> [versie]
set -eu
UIT="${1:?geef een nieuwe map op, bijvoorbeeld _site}"
cd "$(dirname "$0")/.."
VERSIE="${2:-$(git rev-parse --short HEAD)}"
case "$VERSIE" in *[!0-9A-Za-z._-]*|"") echo "Ongeldige versie: $VERSIE" >&2; exit 1 ;; esac
if [ -e "$UIT" ]; then echo "$UIT bestaat al; kies een nieuwe map" >&2; exit 1; fi

mkdir -p "$UIT"
cp -R index.html manifest.webmanifest sw.js css js icons "$UIT"/

# Alle bestanden die de service worker vooraf bewaart (behalve hijzelf)
LIJST=$(cd "$UIT" && find . -type f ! -name sw.js ! -name .DS_Store | sed 's|^\./||' | sort | sed 's/.*/"&"/' | paste -sd, -)

vul_in() { # bestand, zoek, vervang (letterlijke tekst); stopt als de zoektekst er niet in staat
  grep -qF "$2" "$1" || { echo "Niet gevonden in $1: $2" >&2; exit 1; }
  zoek=$(printf '%s' "$2" | sed 's/[][\\.*^$|]/\\&/g')
  vervang=$(printf '%s' "$3" | sed 's/[\\&|]/\\&/g')
  sed "s|$zoek|$vervang|" "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}
vul_in "$UIT/index.html" '<meta name="maatwerk-version" content="dev">' "<meta name=\"maatwerk-version\" content=\"$VERSIE\">"
vul_in "$UIT/sw.js" 'const VERSIE = "dev";' "const VERSIE = \"$VERSIE\";"
vul_in "$UIT/sw.js" 'const BESTANDEN = [];' "const BESTANDEN = [$LIJST];"
printf '{"version":"%s"}\n' "$VERSIE" > "$UIT/version.json"
echo "Klaar: $UIT (versie $VERSIE)"
