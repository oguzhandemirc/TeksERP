#!/usr/bin/env bash
# =============================================================================
# Electron panelini BELİRLİ BİR MÜŞTERİ için paketler.
# Reçete: docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md
#
#   ./deploy/electron-paketle.sh adnansahin
#   ./deploy/electron-paketle.sh yenifabrika 2.9.0     # sürümü de ayarla
#
# NEDEN AYRI BİR KOMUT: yayın adresi pakete DERLEME ANINDA gömülür. Müşteri kodu
# elle değiştirilseydi, unutulan tek bir düzenleme "yeni fabrikanın paneli başka
# bir fabrikanın güncellemesini indirip kurar" sonucunu verirdi — ve bu hata
# SESSİZDİR: dosyalar kendi aralarında tutarlı kalır, yalnızca yanlış müşteriyi
# gösterirler. Tek müşteriyle hiç görünmez, ikincisinde patlar.
#
# ⚠️ ASIL KORUMA SON ADIMDA: derleme BİTTİKTEN sonra paketin İÇİNDEKİ gömülü
# adres (`win-unpacked/resources/app-update.yml`) okunur ve beklenen müşteriyle
# karşılaştırılır. Kapı derlemenin ÖNÜNDE dursaydı, sonradan değişen bir değer
# yayına sızabilirdi — mobil tarafında tam olarak bu yaşandı (yanlış adres
# taşıyan APK yayınlandı, çünkü kapı derlemeden önce koşuyordu).
# =============================================================================
set -euo pipefail

kok="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
electron_dir="$kok/Electron"
BASE_URL="https://guncelleme.etkiliyazilim.com/"

hata() { echo "HATA: $*" >&2; exit 1; }

musteri="${1:-}"
istenen_surum="${2:-}"

[ -n "$musteri" ] || hata "Müşteri kodu gerekli.
  Kullanım: ./deploy/electron-paketle.sh <müşteri-kodu> [sürüm]
  Örnek:    ./deploy/electron-paketle.sh adnansahin"

# Kod URL'in parçası olacak: küçük harf, rakam ve tire. Türkçe karakter/boşluk
# taşıyan bir kod, adresi aktarımda sessizce bozulan bir yayına çevirirdi.
echo "$musteri" | grep -qE '^[a-z0-9][a-z0-9-]{1,30}$' \
  || hata "Müşteri kodu yalnız küçük harf, rakam ve tire içerebilir (2-31 karakter): '$musteri'"

cd "$electron_dir"

# --- 1) Müşteriyi ve sürümü tek kaynağa yaz -------------------------------
mevcut=$(node -p "require('./shared/musteri.json').kod")
if [ "$mevcut" != "$musteri" ]; then
  echo "Müşteri değişiyor: $mevcut → $musteri"
fi

node -e "
const fs = require('fs');
const kod = process.argv[1];
const surum = process.argv[2] || null;
const base = process.argv[3];

// shared/musteri.json — adres bundan TÜRETİLİR (shared/update-feed.ts)
const mPath = './shared/musteri.json';
const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
if (m.kod !== kod) { m.kod = kod; }
fs.writeFileSync(mPath, JSON.stringify(m, null, 2) + '\n');

// package.json > build.publish — electron-builder bunu app-update.yml olarak
// pakete GÖMER. İki dosya birlikte yazılır; bekçi eşitliklerini kilitler.
const pPath = './package.json';
const p = JSON.parse(fs.readFileSync(pPath, 'utf8'));
p.build.publish = [{ provider: 'generic', url: base + kod + '/electron/', channel: 'latest' }];
if (surum) p.version = surum;
fs.writeFileSync(pPath, JSON.stringify(p, null, 2) + '\n');
" "$musteri" "$istenen_surum" "$BASE_URL"

surum=$(node -p "require('./package.json').version")
beklenen_url="${BASE_URL}${musteri}/electron/"
echo "Müşteri: $musteri · Sürüm: $surum"
echo "Yayın adresi: $beklenen_url"

# --- 2) Tutarlılık bekçisi (derlemeden ÖNCE — ucuz kontrol) ---------------
npx vitest run src/test/update-feed-url.test.ts --reporter=dot >/dev/null 2>&1 \
  || hata "Adres bekçisi kırmızı — musteri.json ile package.json ayrışmış olabilir.
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
rm -rf "release/$surum"
if [ "$(uname)" = "Darwin" ]; then
  npm run build:win:cross
else
  npm run build:win
fi

# --- 4) GÖMÜLÜ ADRES KAPISI (asıl koruma) ---------------------------------
# Paketin içine gerçekten ne yazıldığını okur. Buraya kadarki her kontrol
# KAYNAK dosyalara bakıyordu; bu, ÇIKTIYA bakan tek kontrol.
gomulu_yml="release/$surum/win-unpacked/resources/app-update.yml"
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

setup="release/$surum/TeksERP-$surum-Setup.exe"
[ -f "$setup" ] || hata "Kurulum paketi üretilmemiş: $setup"
[ -f "release/$surum/latest.yml" ] || hata "latest.yml üretilmemiş — package.json > build.publish eksik olabilir."

mb=$(( $(wc -c < "$setup") / 1024 / 1024 ))
echo ""
echo "HAZIR — $musteri / $surum (${mb} MB)"
echo "Yayınlamak için: ./deploy/electron-yayinla.sh"
