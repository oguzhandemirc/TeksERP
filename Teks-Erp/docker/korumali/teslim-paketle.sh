#!/bin/sh
# =============================================================================
# KORUMALI LINUX İMAJI — TESLİM PAKETİ (Faz 2f): docker save + sha256 + künye
# =============================================================================
#   [TEKSERP_MUSTERI=<kod>] sh Teks-Erp/docker/korumali/teslim-paketle.sh <imaj-etiketi> <çıktı-dizini>
# Üretir (çıktı dizini REPO DIŞI olmalı):
#   tekserp-korumali_<sürüm>_linux-amd64.tar.gz   docker save | gzip -n (docker load bunu açar)
#   docker-compose.yml · .env.ornek               kurulumun iki dosyası (imajla aynı commit'ten)
#   PAKET-DOCKER.json                             künye = `tekserp-butunluk` v1 belgesi
#   PAKET-DOCKER.json.jws                         künyenin PAKET anahtarıyla imzası (2e aracı: build-korumali-imza.ts belge)
#   SHA256SUMS                                    sha256sum -c ile doğrulanır
# İMZA: anahtar dosyası TEKSERP_PAKET_ANAHTARI (varsayılan ~/.tekserp/satici-hazirlik/paket-hazirlik.paket.json —
#   hazırlık anahtarı yalnız TEST/DEMO); repo DIŞI, CI'a girmez. Anahtar yoksa paket ÜRETİLMEZ (runbook §8).
# =============================================================================
set -eu
ETIKET="${1:?kullanım: teslim-paketle.sh <imaj-etiketi> <çıktı-dizini>}"
CIKTI="${2:?kullanım: teslim-paketle.sh <imaj-etiketi> <çıktı-dizini>}"
BURASI=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$BURASI/../../.." && pwd)
case "$(cd "$(dirname "$CIKTI")" 2>/dev/null && pwd)/" in "$REPO"/*) echo "✖ çıktı dizini repo İÇİNDE: $CIKTI" >&2; exit 1 ;; esac

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

ANAHTAR="${TEKSERP_PAKET_ANAHTARI:-$HOME/.tekserp/satici-hazirlik/paket-hazirlik.paket.json}"
[ -f "$ANAHTAR" ] || { echo "✖ PAKET anahtarı yok: $ANAHTAR (TEKSERP_PAKET_ANAHTARI) — imzasız teslim paketi üretilmez" >&2; exit 1; }

ETIKET_TUR=$(docker image inspect "$ETIKET" --format '{{index .Config.Labels "tr.tekserp.imaj"}}') || { echo "✖ imaj yok: $ETIKET" >&2; exit 1; }
[ "$ETIKET_TUR" = "korumali" ] || { echo "✖ $ETIKET korumalı imaj değil (label tr.tekserp.imaj=$ETIKET_TUR)" >&2; exit 1; }
node "$REPO/scripts/test_korumali_imaj.mjs" --imaj="$ETIKET" || { echo "✖ imaj bekçisi yeşil değil — paket üretilmedi" >&2; exit 1; }

IMAJ_ID=$(docker image inspect "$ETIKET" --format '{{.Id}}')
PLATFORM=$(docker image inspect "$ETIKET" --format '{{.Os}}/{{.Architecture}}')
COMMIT=$(docker image inspect "$ETIKET" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
SURUM=$(docker run --rm --platform linux/amd64 --entrypoint node "$ETIKET" -p 'require("/app/package.json").version')
KUNYE=$(docker run --rm --platform linux/amd64 --entrypoint cat "$ETIKET" /app/dist/server-kunye.json)
AD="tekserp-korumali_${SURUM}_linux-amd64.tar.gz"

mkdir -p "$CIKTI"
CIKTI=$(cd "$CIKTI" && pwd)
docker save "$ETIKET" | gzip -n > "$CIKTI/$AD.part" && mv "$CIKTI/$AD.part" "$CIKTI/$AD"
cp "$BURASI/docker-compose.yml" "$CIKTI/docker-compose.yml"
cp "$BURASI/.env.ornek" "$CIKTI/.env.ornek"

node -e '
const [ad, cikti, etiket, imajId, platform, commit, surum, kunye, ...dosyalar] = process.argv.slice(1);
const fs = require("fs"), crypto = require("crypto"), path = require("path");
const k = JSON.parse(kunye);
// `tekserp-butunluk` v1 belgesi (Teks-Erp/src/lib/license/integrity.ts): sha256 base64url, 2e aynı
// doğrulayıcıyla imzalar/denetler. Ek alanlar (imaj, sunucu, commit) şemada serbest, imzanın kapsamında.
const liste = dosyalar.map((d) => { const b = fs.readFileSync(path.join(cikti, d)); return { yol: d, sha256: crypto.createHash("sha256").update(b).digest("base64url"), boyut: b.length }; });
const paket = { v: 1, paketId: crypto.randomUUID(), urun: "backend-docker", surum, derlemeTarihi: k.zaman,
  musteri: process.env.TEKSERP_MUSTERI || null, commit: commit || k.commit,
  imaj: { etiket, kimlik: imajId, platform, arsiv: ad },
  sunucu: { nodeSurum: k.nodeSurum, v8Taban: k.v8Taban, jscSha256: k.jscSha256, nativeZorunlu: k.nativeZorunlu === true },
  dosyalar: liste };
fs.writeFileSync(path.join(cikti, "PAKET-DOCKER.json"), JSON.stringify(paket, null, 2) + "\n");
' "$AD" "$CIKTI" "$ETIKET" "$IMAJ_ID" "$PLATFORM" "$COMMIT" "$SURUM" "$KUNYE" "$AD" docker-compose.yml .env.ornek

( cd "$REPO/Teks-Erp" && npx tsx scripts/build-korumali-imza.ts belge --belge="$CIKTI/PAKET-DOCKER.json" --anahtar="$ANAHTAR" ) \
  || { echo "✖ künye imzalanamadı — teslim paketi eksik" >&2; exit 1; }

( cd "$CIKTI" && for f in "$AD" docker-compose.yml .env.ornek PAKET-DOCKER.json PAKET-DOCKER.json.jws; do printf '%s  %s\n' "$(sha "$f")" "$f"; done > SHA256SUMS )
echo "✓ teslim paketi: $CIKTI"
cat "$CIKTI/SHA256SUMS"
