#!/bin/sh
# =============================================================================
# KORUMALI LINUX İMAJI — TESLİM PAKETİ (`backend-oci`, sözleşme 5 · GUNCELLEYICI-SAGLAMLIK §1.3 / L3)
# =============================================================================
#   TEKSERP_PAKET_ANAHTARI=<anahtar dosyası> sh Teks-Erp/docker/korumali/teslim-paketle.sh \
#       <imaj-etiketi> <güncelleyici-dizini> <çıktı-dizini>
# <imaj-etiketi>       İMZALI imaj (`imaj-imzala.mjs` çıktısı, label tr.tekserp.butunluk) ve etiketi TAM
#                      `tekserp-korumali:<sürüm>` (compose onu ister); imzasız taban reddedilir.
# <güncelleyici-dizini> CI yapıtı `guncelleyici-linux-x64`: `tekserp-guncelleyici` (linux-x64 ELF) +
#                      `guncelleyici-kunye.json`; künye imajın içinde ikiliden YENİDEN ölçülür ve dosyayla eşit olmalı.
# Üretir (çıktı dizini REPO DIŞI): `tekserp-backend-oci-<sürüm>.tar` — TEK sıkıştırılmamış dış tar, üyeleri düz ad
# (biçim tek kaynak `Teks-Erp/scripts/lib/oci-paket.ts`; yayıncı `backend-yayinla.mjs --urun=backend-oci` aynısını
# ölçer):
#   tekserp-korumali_<sürüm>_linux-amd64.tar.gz   docker save | gzip -n
#   docker-compose.yml                           güncelleyicili şablon, `@@SURUM@@` dolu
#   .env.ornek · tekserp-guncelleyici · guncelleyici-kunye.json
#   PAKET-DOCKER.json(.jws) · butunluk-liste.txt   künye = `tekserp-butunluk` yükü (2e aracı `belge`), kapsam üyeler
#   SHA256SUMS                                    elle denetim (sha256sum -c)
# İmaj kimliği CONFIG ÖZETİDİR, arşivden ölçülür (`backend-bildirim.ts imaj-kimlik`); `docker image inspect .Id`
# containerd deposunda index özetidir ve KULLANILMAZ.
# İMZA: anahtar dosyası TEKSERP_PAKET_ANAHTARI ile AÇIKÇA verilir, varsayılan yol YOK; repo DIŞI, CI'a girmez.
#   Anahtar verilmezse ya da yoksa paket ÜRETİLMEZ (runbook §8). Künye müşteri taşımaz (ortak paket).
# =============================================================================
set -eu
KULLANIM="kullanım: teslim-paketle.sh <imaj-etiketi> <güncelleyici-dizini> <çıktı-dizini>"
ETIKET="${1:?$KULLANIM}"
GDIZIN="${2:?$KULLANIM}"
CIKTI="${3:?$KULLANIM}"
BURASI=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$BURASI/../../.." && pwd)
case "$(cd "$(dirname "$CIKTI")" 2>/dev/null && pwd)/" in "$REPO"/*) echo "✖ çıktı dizini repo İÇİNDE: $CIKTI" >&2; exit 1 ;; esac

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

ANAHTAR="${TEKSERP_PAKET_ANAHTARI:-}"
[ -n "$ANAHTAR" ] || { echo "✖ PAKET anahtarı verilmedi (TEKSERP_PAKET_ANAHTARI) — varsayılan yol yok; üretim anahtarı PAKET sertifikalı pkt-* zincirindendir (3.9 D5/D8) — imzasız teslim paketi üretilmez" >&2; exit 1; }
[ -f "$ANAHTAR" ] || { echo "✖ PAKET anahtarı yok: $ANAHTAR (TEKSERP_PAKET_ANAHTARI) — imzasız teslim paketi üretilmez" >&2; exit 1; }
[ -f "$GDIZIN/tekserp-guncelleyici" ] && [ -f "$GDIZIN/guncelleyici-kunye.json" ] || { echo "✖ güncelleyici dizini eksik: $GDIZIN (tekserp-guncelleyici + guncelleyici-kunye.json — CI yapıtı guncelleyici-linux-x64)" >&2; exit 1; }
GDIZIN=$(cd "$GDIZIN" && pwd)

ETIKET_TUR=$(docker image inspect "$ETIKET" --format '{{index .Config.Labels "tr.tekserp.imaj"}}') || { echo "✖ imaj yok: $ETIKET" >&2; exit 1; }
[ "$ETIKET_TUR" = "korumali" ] || { echo "✖ $ETIKET korumalı imaj değil (label tr.tekserp.imaj=$ETIKET_TUR)" >&2; exit 1; }
# Teslim edilen imaj İMZALI olmalı (imaj içi liste; imzasız imajda native çekirdek yüklenmez, lisans etkinleşmez).
node "$REPO/scripts/test_korumali_imaj.mjs" --imaj="$ETIKET" --imzali || { echo "✖ imaj bekçisi (--imzali) yeşil değil — önce imaj-imzala.mjs; paket üretilmedi" >&2; exit 1; }
BUTUNLUK_KID=$(docker image inspect "$ETIKET" --format '{{index .Config.Labels "tr.tekserp.butunluk"}}')

PLATFORM=$(docker image inspect "$ETIKET" --format '{{.Os}}/{{.Architecture}}')
COMMIT=$(docker image inspect "$ETIKET" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
icinde() { docker run --rm --network none --platform linux/amd64 --entrypoint node "$ETIKET" "$@"; }
SURUM=$(icinde -p 'require("/app/package.json").version')
KUNYE=$(docker run --rm --network none --platform linux/amd64 --entrypoint cat "$ETIKET" /app/dist/server-kunye.json)
GOC=$(icinde -p 'require("fs").readdirSync("/app/prisma/migrations",{withFileTypes:true}).filter((e)=>e.isDirectory()).length')
[ "$ETIKET" = "tekserp-korumali:$SURUM" ] || { echo "✖ imaj etiketi $ETIKET — tekserp-korumali:$SURUM olmalı (güncelleyicili compose bu etiketi ister): docker tag $ETIKET tekserp-korumali:$SURUM" >&2; exit 1; }
AD="tekserp-korumali_${SURUM}_linux-amd64.tar.gz"
PAKET="tekserp-backend-oci-${SURUM}.tar"

# Güncelleyici künyesi dosyadan DEĞİL ikiliden: imajın içinde (glibc/OpenSSL hedefle aynı), ağsız, salt okunur bağla.
GKUNYE=$(docker run --rm --network none --platform linux/amd64 -v "$GDIZIN:/g:ro" --entrypoint /g/tekserp-guncelleyici "$ETIKET" kunye) \
  || { echo "✖ güncelleyici imajın içinde çalışmadı (linux-x64 ELF mi, glibc ≤ imajınki mi?)" >&2; exit 1; }

mkdir -p "$CIKTI"
CIKTI=$(cd "$CIKTI" && pwd)
[ ! -e "$CIKTI/$PAKET" ] || { echo "✖ $CIKTI/$PAKET zaten var — teslim paketi EZİLMEZ" >&2; exit 1; }
SAHNE=$(mktemp -d "$CIKTI/.sahne-$SURUM.XXXXXX")
trap 'rm -rf "$SAHNE"' EXIT
docker save "$ETIKET" | gzip -n > "$SAHNE/$AD"
sed "s/@@SURUM@@/$SURUM/g" "$BURASI/docker-compose.guncelleyici.yml" > "$SAHNE/docker-compose.yml"
if grep -q '@@' "$SAHNE/docker-compose.yml"; then echo "✖ compose şablonunda doldurulmamış yer tutucu kaldı" >&2; exit 1; fi
cp "$BURASI/.env.ornek" "$SAHNE/.env.ornek"
cp "$GDIZIN/tekserp-guncelleyici" "$SAHNE/tekserp-guncelleyici"
cp "$GDIZIN/guncelleyici-kunye.json" "$SAHNE/guncelleyici-kunye.json"
chmod 0755 "$SAHNE/tekserp-guncelleyici"
IMAJ_KIMLIK=$( cd "$REPO/Teks-Erp" && npx tsx scripts/backend-bildirim.ts imaj-kimlik --arsiv="$SAHNE/$AD" ) \
  || { echo "✖ imaj kimliği arşivden ölçülemedi" >&2; exit 1; }

node -e '
const [sahne, ad, etiket, imajKimlik, platform, commit, surum, kunye, butunlukKid, goc, gKunyeOlculen, ...dosyalar] = process.argv.slice(1);
const fs = require("fs"), crypto = require("crypto"), path = require("path");
const k = JSON.parse(kunye);
const gDosya = JSON.parse(fs.readFileSync(path.join(sahne, "guncelleyici-kunye.json"), "utf8"));
const gOlcu = JSON.parse(gKunyeOlculen);
const ayni = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
if (!ayni(gDosya, gOlcu)) { console.error("✖ güncelleyici-kunye.json ikilinin kendi künyesiyle AYNI değil"); process.exit(1); }
if (gOlcu.ad !== "tekserp-guncelleyici" || gOlcu.hedef !== "linux" || gOlcu.testCapasi !== false || gOlcu.capaKipi !== "uretim") {
  console.error("✖ güncelleyici sürüm derlemesi değil: " + JSON.stringify(gOlcu)); process.exit(1);
}
if (!/^sha256:[0-9a-f]{64}$/.test(imajKimlik) || !(Number(goc) >= 1)) { console.error("✖ imaj kimliği / göç sayısı ölçülemedi"); process.exit(1); }
const gSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(sahne, "tekserp-guncelleyici"))).digest("hex");
// `tekserp-butunluk` yükü (Teks-Erp/src/lib/license/integrity.ts): üye listesini ve özetini imza aracı ölçüp yazar
// (butunluk-liste.txt); ek alanlar şemada serbest, imzanın kapsamında (yayıncı `oci-paket.ts` okur).
const paket = { v: 1, paketId: crypto.randomUUID(), urun: "backend-docker", surum, derlemeTarihi: k.zaman,
  musteri: null, commit: commit || k.commit, platform: "linux-x64-oci", gocSayisi: Number(goc),
  imaj: { etiket, kimlik: imajKimlik, platform, arsiv: ad, butunlukKid },
  sunucu: { nodeSurum: k.nodeSurum, v8Taban: k.v8Taban, jscSha256: k.jscSha256, nativeZorunlu: k.nativeZorunlu === true },
  guncelleyici: { surum: gOlcu.surum, sha256: gSha },
  kapsam: { dizinler: [], dosyalar } };
fs.writeFileSync(path.join(sahne, "PAKET-DOCKER.json"), JSON.stringify(paket, null, 2) + "\n");
' "$SAHNE" "$AD" "$ETIKET" "$IMAJ_KIMLIK" "$PLATFORM" "$COMMIT" "$SURUM" "$KUNYE" "$BUTUNLUK_KID" "$GOC" "$GKUNYE" \
  "$AD" docker-compose.yml .env.ornek tekserp-guncelleyici guncelleyici-kunye.json

( cd "$REPO/Teks-Erp" && npx tsx scripts/build-korumali-imza.ts belge --belge="$SAHNE/PAKET-DOCKER.json" --anahtar="$ANAHTAR" ) \
  || { echo "✖ künye imzalanamadı — teslim paketi eksik" >&2; exit 1; }

UYELER="$AD docker-compose.yml .env.ornek tekserp-guncelleyici guncelleyici-kunye.json PAKET-DOCKER.json PAKET-DOCKER.json.jws butunluk-liste.txt SHA256SUMS"
( cd "$SAHNE" && for f in "$AD" docker-compose.yml .env.ornek tekserp-guncelleyici guncelleyici-kunye.json butunluk-liste.txt PAKET-DOCKER.json PAKET-DOCKER.json.jws; do printf '%s  %s\n' "$(sha "$f")" "$f"; done > SHA256SUMS )
# Dış tar: ustar, sahip 0:0, Mac meta verisi yok (._*, xattr) — GNU tar ve bsdtar aynı üye kümesini üretir.
if tar --version 2>/dev/null | grep -q 'GNU tar'; then
  ( cd "$SAHNE" && tar --format=ustar --owner=0 --group=0 --numeric-owner -cf "$CIKTI/$PAKET.part" $UYELER )
else
  ( cd "$SAHNE" && COPYFILE_DISABLE=1 tar --format=ustar --uid 0 --gid 0 --no-xattrs --no-mac-metadata -cf "$CIKTI/$PAKET.part" $UYELER )
fi
mv "$CIKTI/$PAKET.part" "$CIKTI/$PAKET"
echo "✓ teslim paketi: $CIKTI/$PAKET · sha256 $(sha "$CIKTI/$PAKET") · imaj $IMAJ_KIMLIK · güncelleyici $(printf '%s' "$GKUNYE" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).surum')"
