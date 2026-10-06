#!/usr/bin/env bash
# =============================================================================
# Electron panelini paketler — TEK ORTAK PAKET (kimlik deploy/dagitim.json'dan, derleme müşteri bilmez).
# Reçete: docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md · tasarım docs/design/TEK-ORTAK-PAKET.md §2.2
#
#   ./deploy/electron-paketle.sh 1.5.0                  # çıktı Electron/release/ortak/<sürüm>/
#                                                       # (sürüm elle; yayın ve terfi grup yayınında)
#
# Eski kanal yolu (müşteri kodlu paketleme) emekli: `eski-kanal-son` etiketi, docs/ops/ESKI-KANAL-ACIL.md.
#
# ⚠️ ASIL KORUMA SON ADIMDA: derleme BİTTİKTEN sonra paketin İÇİNDEKİ gömülü
# adres (`win-unpacked/resources/app-update.yml`) ve kimlik okunur ve ortak kimlikle
# karşılaştırılır. Kapı derlemenin ÖNÜNDE dursaydı, sonradan değişen bir değer
# yayına sızabilirdi — mobil tarafında tam olarak bu yaşandı (yanlış adres
# taşıyan APK yayınlandı, çünkü kapı derlemeden önce koşuyordu).
# =============================================================================
set -euo pipefail

kok="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
electron_dir="$kok/Electron"

hata() { echo "HATA: $*" >&2; exit 1; }

istenen_surum=""
for a in "$@"; do
  case "$a" in
    --terfi-atla|--terfi-atla=*) hata "--terfi-atla paketlemede yok; ortak paketin terfisi grup yayınındadır (deploy/electron-grup-yayinla.sh)." ;;
    -*) hata "Tanınmayan seçenek: $a" ;;
    *)
      if [ -z "$istenen_surum" ]; then istenen_surum="$a"
      else hata "Fazla argüman: $a (ortak paket yalnız sürüm alır)"
      fi
      ;;
  esac
done

echo "$istenen_surum" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || hata "Ortak pakette sürüm ELLE verilir (X.Y.Z; ilk sürüm 1.5.0, TEK-ORTAK-PAKET.md §8.3).
  Kullanım: ./deploy/electron-paketle.sh <sürüm>
  Müşteri kodlu paketleme emekli (eski-kanal-son etiketi, docs/ops/ESKI-KANAL-ACIL.md)."

# --- KİMLİK KAPISI — HİÇBİR DOSYA YAZILMADAN ve ağdan ÖNCE ------------------
# Ağaç ortak kimlikte dinlenmede + kaynak hiçbir kimliğin literalini taşımıyor (scripts/lib/panel-kimlik.mjs).
# Literal kimlik taşıyan bir kaynak derleme anındaki enjeksiyonu görmez. Çıkış 2 = ÖLÇÜLEMEDİ, o da durdurur.
node "$kok/scripts/panel-kimlik-kapisi.mjs" dinlenme \
  || hata "Ortak kimlik kapısı geçilmedi — yukarıdaki satırlara bak (kayıt: deploy/dagitim.json)."

# --- PANEL İMZA ÇAPASI — derlemeden ÖNCE ------------------------------------
# Panel güncellemeyi yalnız gömülü çapadaki anahtarla imzalanmış künyeyle kurar (Electron/electron/guncelleme/).
# Çapası boş ya da bozuk panel HİÇBİR güncellemeyi doğrulayamaz (çıkışsız kapı) → paketlenmez.
node "$kok/scripts/grup-yayin-kapisi.mjs" capa \
  || hata "Panel imza çapası kullanılamaz — paket üretilmedi (anahtar kararı + guven-capasi-ekle.ts panel)."

# --- TEMİZ AĞAÇ (G22) — derlemeden ve dosya yazmadan ÖNCE -----------------------
# Paket commit'lenmemiş/izlenmeyen içerik taşımaz: derleme commit'i pakete (asar package.json `gitCommit`) ve yanındaki
# derleme künyesine (derleme.json) yazılır; yayıncı onu HEAD'e ve terfi etiketine bağlar. Tek istisna paketlemenin
# kendi yazdığı sürüm alanı (Electron/package.json version). Çıkış 1 kirli, 2 ölçülemedi — ikisi de DURDURUR.
derleme_commit=$(node "$kok/scripts/grup-yayin-kapisi.mjs" temiz-agac) \
  || hata "Çalışma ağacı temiz değil ya da okunamadı — paket üretilmedi (yukarıdaki satırlar)."

cd "$electron_dir"

# Sembolik bağlı node_modules'te electron-builder bağımlılık ağacını eksik toplar ve
# paket açılışta ERR_MODULE_NOT_FOUND ile düşer (1.3.2: electron-store → conf eksikti).
[ -L node_modules ] && hata "Electron/node_modules sembolik bağ — paket bağımlılıkları eksik toplanır. Bu ağaçta gerçek 'npm ci' koş."

# --- 1) Sürümü yaz — KİMLİK YAZILMAZ ---------------------------------------
# Kimlik (appId · ürün adı · paket adı · güncelleme adresi · çıktı dizini · pencere başlığı) ağaca
# YAZILMAZ: derleme ANINDA dağıtım kaydından enjekte edilir (electron-builder `-c.*` +
# Electron/build-identity.ts). Ağaçtaki package.json dinlenme tabanıdır ve paketleme bitince
# (ya da düşünce) aynen kalır. Yazılan tek şey sürüm numarası (yayından sonra commit'lenir).
node -e "
const fs = require('fs');
const pPath = './package.json';
const p = JSON.parse(fs.readFileSync(pPath, 'utf8'));
if (p.version !== process.argv[1]) {
  p.version = process.argv[1];
  fs.writeFileSync(pPath, JSON.stringify(p, null, 2) + '\n');
}
" "$istenen_surum"

surum=$(node -p "require('./package.json').version")
beklenen_url=$(node "$kok/scripts/panel-kimlik-kapisi.mjs" feed) || hata "Ortak paketin güncelleme adresi çözülemedi (deploy/dagitim.json)."
rel="release/ortak/$surum"
derleme_satirlari=$(node "$kok/scripts/panel-kimlik-kapisi.mjs" derleme) \
  || hata "Ortak kimlik derleme argümanlarına çevrilemedi (deploy/dagitim.json)."
derleme_argumanlari=()
while IFS= read -r satir; do
  if [ -n "$satir" ]; then derleme_argumanlari+=("$satir"); fi
done <<< "$derleme_satirlari"
[ "${#derleme_argumanlari[@]}" -gt 0 ] || hata "Ortak kimlik boş çıktı — derleme yapılmadı."
# Derleme commit'i paketin İÇİNE (asar package.json) — yayıncı künyeyle ve HEAD'le kıyaslar.
derleme_argumanlari+=("-c.extraMetadata.gitCommit=$derleme_commit")

echo "ORTAK PAKET · Sürüm: $surum"
echo "Gömülü güncelleme adresi (dinlenme grubu): $beklenen_url"
echo "Kimlik (derleme anında, deploy/dagitim.json):"
printf '  %s\n' "${derleme_argumanlari[@]}"

# --- 2) Tutarlılık bekçisi (derlemeden ÖNCE — ucuz kontrol) ---------------
npx vitest run src/test/update-feed-url.test.ts --reporter=dot >/dev/null 2>&1 \
  || hata "Adres bekçisi kırmızı — dağıtım kaydı ile gömülecek ortak kimlik ayrışmış olabilir.
  Ayrıntı için: cd Electron && npx vitest run src/test/update-feed-url.test.ts"

# --- 2b) SÜRÜM NOTU KAPISI ------------------------------------------------
# Not yazılmadan sürüm çıkmaz (kullanıcı kararı). Bekçi ayrıca kopyaların taze
# olduğunu ve dilin operatör dili kaldığını da denetler.
#
# ⚠️ DAİRESEL DEĞİL: beklenen sürüm ARGÜMANDAN ($surum) geliyor, not dosyası
# onu üretmiyor yalnız doğruluyor. Hiçbir script `surumler.panel` alanını
# package.json'dan okuyup YAZMAMALI — yazsaydı kapı kendi yazdığını doğrular,
# yani hiçbir şey doğrulamazdı.
node "$kok/scripts/check-surum-notlari.mjs" --panel="$surum" \
  || hata "Sürüm notu kapısı kırmızı.
  $surum için operatör notu yok ya da not kuralları ihlal edilmiş.
  1) surum-notlari.json'a bu sürüm için kayıt ekle
  2) node scripts/surum-notlari-kopyala.mjs
  3) komutu tekrarla"

# --- 3) Derle -------------------------------------------------------------
echo "Derleniyor (bu birkaç dakika sürer)…"
rm -rf "$rel"
if [ "$(uname)" = "Darwin" ]; then
  npm run build:win:cross -- "${derleme_argumanlari[@]}"
else
  npm run build:win -- "${derleme_argumanlari[@]}"
fi

# --- 4) GÖMÜLÜ ADRES KAPISI (asıl koruma) ---------------------------------
# Paketin içine gerçekten ne yazıldığını okur. Buraya kadarki her kontrol
# KAYNAK dosyalara bakıyordu; bu, ÇIKTIYA bakan tek kontrol.
gomulu_yml="$rel/win-unpacked/resources/app-update.yml"
[ -f "$gomulu_yml" ] || hata "Gömülü güncelleme yapılandırması bulunamadı: $gomulu_yml
  Derleme yarım kalmış olabilir."

gomulu_url=$(grep -E '^url:' "$gomulu_yml" | head -1 | sed 's/^url:[[:space:]]*//' | tr -d '\r')
if [ "$gomulu_url" != "$beklenen_url" ]; then
  hata "PAKET YANLIŞ MÜŞTERİYİ GÖSTERİYOR — yayınlama!
  pakette : $gomulu_url
  beklenen: $beklenen_url
  Bu paket kurulursa BAŞKA BİR FABRİKANIN güncellemelerini indirir."
fi
echo "✓ Gömülü adres doğru: $gomulu_url"

# Aynı yüklem yayıncıda da koşar: paket kimliği (adres · updater önbelleği · exe adı ·
# paketin package.json'ı · ana süreç/arayüz kimliği) ortak kimlikle birebir ve eski kanalın
# kimliği YOK mu.
node "$kok/scripts/panel-kimlik-kapisi.mjs" paket "$electron_dir/$rel" \
  || hata "Derlenen paket ortak kimlikte değil — yayınlama."
# Çapa ve künye doğrulayıcısı ana sürece GERÇEKTEN gömüldü mü (kaynak değil, çıktı okunur).
node "$kok/scripts/grup-yayin-kapisi.mjs" capa "$electron_dir/$rel" \
  || hata "Derlenen panel imza çapasını taşımıyor — yayınlama."

setup="$rel/TeksERP-$surum-Setup.exe"
[ -f "$setup" ] || hata "Kurulum paketi üretilmemiş: $setup"
[ -f "$rel/latest.yml" ] || hata "latest.yml üretilmemiş — package.json > build.publish eksik olabilir."

# --- DERLEME KÜNYESİ (G22) — derleme sırasında ağaç/HEAD değişmediyse ----------------
son_commit=$(node "$kok/scripts/grup-yayin-kapisi.mjs" temiz-agac) \
  || hata "Derleme sırasında çalışma ağacı değişti — paket güvenilmez, yayınlama."
[ "$son_commit" = "$derleme_commit" ] || hata "Derleme sırasında HEAD değişti ($derleme_commit → $son_commit) — paket güvenilmez, yayınlama."
node "$kok/scripts/panel-kimlik-kapisi.mjs" kunye "$electron_dir/$rel" "$surum" "$derleme_commit" \
  || hata "Derleme künyesi yazılamadı — yayınlama."
mb=$(( $(wc -c < "$setup") / 1024 / 1024 ))
echo ""
echo "HAZIR — ORTAK PAKET / $surum (${mb} MB) · $rel"
echo "  Yayın: deploy/electron-grup-yayinla.sh --grup=test|oncu|genel"
