#!/usr/bin/env bash
# =============================================================================
# Electron panelini paketler — TEK ORTAK PAKET (argümansız) ya da ESKİ KANAL (müşteri kodu; O15'te kalkar).
# Reçete: docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md · tasarım docs/design/TEK-ORTAK-PAKET.md §2.2
#
#   ./deploy/electron-paketle.sh 1.5.0                  # ORTAK paket: kimlik dağıtım kaydından, çıktı release/ortak/<sürüm>/
#                                                       # (sürüm elle; grup yayını ve terfi O10a'da — bu kip yayın önermez)
#
# ESKİ KANAL YOLU (adnansahin donuk; davranışı değişmez):
#   ./deploy/electron-paketle.sh adnansahin             # yama hanesi OTOMATİK artar
#   ./deploy/electron-paketle.sh yenifabrika 2.9.0     # haneyi elle ver
#   ./deploy/electron-paketle.sh adnansahin --terfi-atla="<kullanıcının cümlesi>"  # K5 acil kaçışı
#
# ⚠️ TERFİ (K5): `terfiKaynagi` olan kanal (adnansahin) yalnız terfi etiketli commit'ten, hazırlık
# kanalında yayınlanmış sürümle paketlenir (scripts/lib/terfi.mjs) — önce `git checkout --detach panel-vX`.
#
# Kod `deploy/kanallar.json`da kayıtlı olmalı; çıktı `Electron/release/<kod>/<sürüm>/`.
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

musteri=""
istenen_surum=""
# Terfi kaçışı (S4) yalnız KULLANICININ cümlesiyle; verilip verilmediği ayrı tutulur ki
# boş `--terfi-atla=` sessizce "verilmedi"ye dönmesin (boş cümle RED).
terfi_atla=""
terfi_atla_verildi=0
for a in "$@"; do
  case "$a" in
    --terfi-atla=*) terfi_atla="${a#--terfi-atla=}"; terfi_atla_verildi=1 ;;
    --terfi-atla) terfi_atla=""; terfi_atla_verildi=1 ;;
    -*) hata "Tanınmayan seçenek: $a" ;;
    *)
      if [ -z "$musteri" ]; then musteri="$a"
      elif [ -z "$istenen_surum" ]; then istenen_surum="$a"
      else hata "Fazla argüman: $a"
      fi
      ;;
  esac
done

# Argümansız (ya da yalnız sürüm) = TEK ORTAK PAKET: derleme müşteri bilmez, kimlik deploy/dagitim.json'dan.
ortak=0
if echo "$musteri" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  [ -z "$istenen_surum" ] || hata "Fazla argüman: $istenen_surum (ortak paket yalnız sürüm alır)"
  istenen_surum="$musteri"
  musteri=""
fi
[ -n "$musteri" ] || ortak=1

if [ "$ortak" = "1" ]; then
  [ "$terfi_atla_verildi" = "0" ] || hata "--terfi-atla yalnız eski kanal yolunda; ortak paketin terfisi grup yayınındadır (O10a)."
  [ -n "$istenen_surum" ] || hata "Ortak pakette sürüm ELLE verilir (ilk sürüm 1.5.0, TEK-ORTAK-PAKET.md §8.3).
  Kullanım: ./deploy/electron-paketle.sh <sürüm>
  Otomatik hane, grup yayınının okunduğu dilimde (O10a) gelir."
else
# Kod URL'in parçası olacak: küçük harf, rakam ve tire. Türkçe karakter/boşluk
# taşıyan bir kod, adresi aktarımda sessizce bozulan bir yayına çevirirdi.
echo "$musteri" | grep -qE '^[a-z0-9][a-z0-9-]{1,30}$' \
  || hata "Müşteri kodu yalnız küçük harf, rakam ve tire içerebilir (2-31 karakter): '$musteri'"
fi

# --- KANAL KAPISI — HİÇBİR DOSYA YAZILMADAN ve ağdan ÖNCE ------------------
# Kod `deploy/kanallar.json`da kayıtlı olmalı (yazım hatası → dur), ağaç dinlenmede
# (varsayilan kanal tabanı) ve kaynak kimliği KANALDAN almalı: literal kimlik taşıyan
# bir kaynak derleme anındaki enjeksiyonu görmez ve paket başka kanalın kimliğiyle
# doğar (aynı makinede o kanalın kurulumu). Çıkış 2 = ÖLÇÜLEMEDİ, o da durdurur.
if [ "$ortak" = "1" ]; then
  # Ortak: ağaç ortak kimlikte dinlenmede + kaynak hiçbir kimliğin literalini taşımıyor (scripts/lib/panel-kimlik.mjs).
  node "$kok/scripts/panel-kimlik-kapisi.mjs" dinlenme \
    || hata "Ortak kimlik kapısı geçilmedi — yukarıdaki satırlara bak (kayıt: deploy/dagitim.json)."
else
node "$kok/scripts/kanal-kapisi.mjs" panel-paketle "$musteri" \
  || hata "Kanal kapısı geçilmedi — yukarıdaki satırlara bak (kayıt defteri: deploy/kanallar.json)."
fi

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

# --- 0) SÜRÜM NUMARASI ----------------------------------------------------
# Sürüm verilmediyse YAMA hanesi otomatik artar (1.1.0 → 1.1.1 → 1.1.2).
#
# ⚠️ TABAN GİT ETİKETİDİR (`panel-v*`), yerel package.json ya da yayın sunucusu
# DEĞİL. Sebep: numara KODA aittir, kanala değil. Taban sunucudan okunsaydı her
# müşteri kendi sayısını üretirdi ve iki farklı kod aynı numarayı taşıyabilirdi
# — "panel 1.1.1'de şu hata var" cümlesi anlamını yitirirdi. Yerel dosyadan
# okunsaydı komutun her koşumu numarayı atlatırdı (bu komut bir turda birden
# çok kez koşar: not kapısı kırmızı verir, derleme düşer).
#
# Etiketi bu script ATMAZ; yayın başarılı olunca `electron-yayinla.sh` atar.
# Yani "şu commit'ten sonrası yeni sürüm" diye bir karar vermek gerekmez.
#
# Küçük/büyük hane bir KARARDIR (sözleşme kırıldı mı) — komuta elle yazılır:
#   ./deploy/electron-paketle.sh adnansahin 1.2.0
if [ -z "$istenen_surum" ]; then
  istenen_surum=$(node --input-type=module -e "
    import {
      etiketDefteriKiyasla, sonrakiSurumEtiketten, yayindakiPanelSurumu,
    } from '$kok/scripts/lib/surum.mjs';
    import { surumNotlariniOku, tavanUyarisi } from '$kok/scripts/lib/surum-notu-tavan.mjs';
    const k = sonrakiSurumEtiketten('panel');
    if (!k.surum) {
      console.error('  ✖ Sıradaki sürüm belirlenemedi: ' + k.gerekce);
      console.error('    İlk sürümü elle ver:  ./deploy/electron-paketle.sh $musteri 1.1.1');
      console.error('    ya da yayındaki sürümü etiketle:  git tag -a panel-v<sürüm> -m panel');
      process.exit(1);
    }
    // Etiket KARAR verir, sunucu DOĞRULAR — gerekçe: scripts/lib/surum.mjs.
    const yayinda = await yayindakiPanelSurumu('$BASE_URL$musteri/electron/');
    const kiyas = etiketDefteriKiyasla(k.surum, yayinda);
    if (kiyas.durum === 'zaten-yayinda') {
      console.error('  ✖ ' + k.surum + ' ZATEN YAYINDA — ' + k.gerekce);
      console.error('    Son yayından beri yeni commit yok, yani çıkacak değişiklik de yok.');
      console.error('    Aynı numaranın üstüne farklı kod yazmak sahada iki ayrı programı');
      console.error('    aynı isimle dolaştırır — kapı bunun için var.');
      console.error('    Yeni iş varsa commit et; yarım kalan yüklemeyi tamamlıyorsan:');
      console.error('      ./deploy/electron-paketle.sh $musteri ' + k.surum);
      process.exit(1);
    }
    if (kiyas.durum === 'bayat') {
      console.error('  ✖ ETİKET DEFTERİ BAYAT — hesaplanan ' + k.surum + ', yayında ' + yayinda);
      console.error('    Bu numarayla yayınlamak, sahadakinden ESKİ bir paketi güncel gösterir.');
      console.error('    Muhtemel sebep: yayın başka bir makineden yapıldı, etiket itilmedi.');
      console.error('    Çözüm:  git fetch --tags   ya da   git tag -a panel-v' + yayinda + ' -m panel');
      process.exit(1);
    }
    if (kiyas.durum === 'olculemedi') {
      console.error('  ⚠  Yayındaki sürüm okunamadı (ssh tekserp-yayin, VDS diski); etiket defteri DOĞRULANMADI.');
    }
    // Yayınlanmamış tur sayısı modal tavanını aşıyorsa söyle (uyarı, blok değil).
    const tavan = tavanUyarisi(surumNotlariniOku('$kok'), 'panel', yayinda, k.surum);
    if (tavan) console.error('  ⚠  ' + tavan);
    console.error('  Sürüm: ' + k.surum + ' — ' + k.gerekce);
    console.log(k.surum);
  ") || hata "Sıradaki sürüm hesaplanamadı."
fi

# --- 0b) TERFİ KAPISI (K5) — dosya yazılmadan ve derlemeden ÖNCE ----------------
# Üretim kanalına (kayıtta `terfiKaynagi` olan) yalnız hazırlık kanalında yayınlanmış ve
# kullanıcının terfi etiketiyle onayladığı commit paketlenir: HEAD == panel-vX · terfi/<kanal>/panel-vX
# HEAD'de · kaynak kanalda yayındaki sürüm ≥ X. Hazırlık kanalında hiçbir şey değişmez.
# Çıkış 1 = şart tutmadı, 2 = ÖLÇÜLEMEDİ; ikisi de durdurur. Yüklem: scripts/lib/terfi.mjs.
terfi_surum="${istenen_surum:-$(node -p "require('./package.json').version")}"
if [ "$ortak" = "1" ]; then
  # Ortak paket gömülü olarak zincirin kök grubunu (test) gösterir; üst gruplara çıkış yayında terfidir (O10a).
  echo "  Terfi: ortak paket — paketlemede terfi yok (grup terfisi yayında, O10a)."
elif [ "$terfi_atla_verildi" = "1" ]; then
  node "$kok/scripts/kanal-kapisi.mjs" terfi "$musteri" panel "$terfi_surum" "--terfi-atla=$terfi_atla" \
    || hata "Terfi kapısı geçilmedi — yukarıdaki satırlara bak."
else
  node "$kok/scripts/kanal-kapisi.mjs" terfi "$musteri" panel "$terfi_surum" \
    || hata "Terfi kapısı geçilmedi — yukarıdaki satırlara bak."
fi

# --- 1) Sürümü yaz — KİMLİK YAZILMAZ ---------------------------------------
# Kanal kimliği (appId · ürün adı · paket adı · güncelleme adresi · çıktı dizini ·
# pencere başlığı · varsayılan sunucu · görünür etiket) ağaca YAZILMAZ: derleme
# ANINDA kayıttan enjekte edilir (electron-builder `-c.*` + `TEKSERP_KANAL` →
# Electron/build-identity.ts). Ağaçtaki package.json dinlenme tabanıdır (ortak kimlik)
# ve paketleme bitince (ya da düşünce) aynen kalır. Yazılan tek şey sürüm numarası:
# numara koda aittir, kanala değil (yayından sonra commit'lenir).
if [ -n "$istenen_surum" ]; then
  node -e "
const fs = require('fs');
const pPath = './package.json';
const p = JSON.parse(fs.readFileSync(pPath, 'utf8'));
if (p.version !== process.argv[1]) {
  p.version = process.argv[1];
  fs.writeFileSync(pPath, JSON.stringify(p, null, 2) + '\n');
}
" "$istenen_surum"
fi

surum=$(node -p "require('./package.json').version")
if [ "$ortak" = "1" ]; then
  beklenen_url=$(node "$kok/scripts/panel-kimlik-kapisi.mjs" feed) || hata "Ortak paketin güncelleme adresi çözülemedi (deploy/dagitim.json)."
  rel="release/ortak/$surum"
  derleme_satirlari=$(node "$kok/scripts/panel-kimlik-kapisi.mjs" derleme) \
    || hata "Ortak kimlik derleme argümanlarına çevrilemedi (deploy/dagitim.json)."
else
beklenen_url="${BASE_URL}${musteri}/electron/"
rel="release/$musteri/$surum"

# Kimlik argümanları kayıttan (satır başına bir `-c.<anahtar>=<değer>`); boşsa DUR.
derleme_satirlari=$(node "$kok/scripts/kanal-kapisi.mjs" panel-derleme "$musteri") \
  || hata "Kanal kimliği derleme argümanlarına çevrilemedi (deploy/kanallar.json)."
fi
derleme_argumanlari=()
while IFS= read -r satir; do
  if [ -n "$satir" ]; then derleme_argumanlari+=("$satir"); fi
done <<< "$derleme_satirlari"
[ "${#derleme_argumanlari[@]}" -gt 0 ] || hata "Kanal kimliği boş çıktı — derleme yapılmadı."
# Derleme commit'i paketin İÇİNE (asar package.json) — yayıncı künyeyle ve HEAD'le kıyaslar.
derleme_argumanlari+=("-c.extraMetadata.gitCommit=$derleme_commit")

if [ "$ortak" = "1" ]; then
  echo "ORTAK PAKET · Sürüm: $surum"
  echo "Gömülü güncelleme adresi (dinlenme grubu): $beklenen_url"
  echo "Kimlik (derleme anında, deploy/dagitim.json):"
else
echo "Müşteri: $musteri · Sürüm: $surum"
echo "Yayın adresi: $beklenen_url"
echo "Kimlik (derleme anında, deploy/kanallar.json):"
fi
printf '  %s\n' "${derleme_argumanlari[@]}"

# --- 2) Tutarlılık bekçisi (derlemeden ÖNCE — ucuz kontrol) ---------------
# Aynı kanalla koşar: derlenecek kanalın kaydı çözülüyor ve gömülecek kimlik kayıtla birebir mi.
if [ "$ortak" = "1" ]; then
  # Ortamdan sızan eski kanal değişkeni ortak derlemeye eski kimliği gömerdi: iki derleyicide de SİLİNİR.
  env -u TEKSERP_KANAL npx vitest run src/test/update-feed-url.test.ts --reporter=dot >/dev/null 2>&1 \
    || hata "Adres bekçisi kırmızı — dağıtım kaydı ile gömülecek ortak kimlik ayrışmış olabilir.
  Ayrıntı için: cd Electron && npx vitest run src/test/update-feed-url.test.ts"
else
TEKSERP_KANAL="$musteri" npx vitest run src/test/update-feed-url.test.ts --reporter=dot >/dev/null 2>&1 \
  || hata "Adres bekçisi kırmızı — kanal kaydı ile gömülecek kimlik ayrışmış olabilir.
  Ayrıntı için: cd Electron && TEKSERP_KANAL=$musteri npx vitest run src/test/update-feed-url.test.ts"
fi

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
# Kanal İKİ derleyiciye de verilir: `TEKSERP_KANAL` electron-vite'a (kod içi kimlik),
# `-c.*` electron-builder'a (paket kimliği). Biri eksik kalırsa 4. adım karışık kimliği yakalar.
if [ "$ortak" = "1" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    env -u TEKSERP_KANAL npm run build:win:cross -- "${derleme_argumanlari[@]}"
  else
    env -u TEKSERP_KANAL npm run build:win -- "${derleme_argumanlari[@]}"
  fi
elif [ "$(uname)" = "Darwin" ]; then
  TEKSERP_KANAL="$musteri" npm run build:win:cross -- "${derleme_argumanlari[@]}"
else
  TEKSERP_KANAL="$musteri" npm run build:win -- "${derleme_argumanlari[@]}"
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
# paketin package.json'ı · ana süreç/arayüz kimliği) kanalla birebir ve başka kanalın
# kimliği YOK mu — yayıncı hedefi bu kimlikten çözer, ağaçtaki musteri.json'dan değil.
if [ "$ortak" = "1" ]; then
  node "$kok/scripts/panel-kimlik-kapisi.mjs" paket "$electron_dir/$rel" \
    || hata "Derlenen paket ortak kimlikte değil — yayınlama."
else
node "$kok/scripts/kanal-kapisi.mjs" panel-yayin "$musteri" "$electron_dir/$rel" \
  || hata "Derlenen paketin kimliği '$musteri' kanalıyla birebir değil — yayınlama."
fi
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
if [ "$ortak" = "1" ]; then
  node "$kok/scripts/panel-kimlik-kapisi.mjs" kunye "$electron_dir/$rel" "$surum" "$derleme_commit" \
    || hata "Derleme künyesi yazılamadı — yayınlama."
  mb=$(( $(wc -c < "$setup") / 1024 / 1024 ))
  echo ""
  echo "HAZIR — ORTAK PAKET / $surum (${mb} MB) · $rel"
  echo "  Yayın: deploy/electron-grup-yayinla.sh --grup=test|oncu|genel (eski kanal yayıncısı bu paketi tanımaz)."
  exit 0
fi
node "$kok/scripts/kanal-kapisi.mjs" panel-derleme-kunyesi "$musteri" "$electron_dir/$rel" "$surum" "$derleme_commit" \
  || hata "Derleme künyesi yazılamadı — yayınlama."

mb=$(( $(wc -c < "$setup") / 1024 / 1024 ))
echo ""
echo "HAZIR — $musteri / $surum (${mb} MB) · $rel"
echo "Yayınlamak için: ./deploy/electron-yayinla.sh --musteri=$musteri --anahtar=<panel imza anahtarı>"
echo "  (künye yayında imzalanır; parola TTY'den sorulur — imzasız latest.yml yüklenmez)"
if [ "$terfi_atla_verildi" = "1" ]; then
  echo "  (terfi atlandı — yayın komutu da kullanıcının cümlesini ister: --terfi-atla=\"…\")"
fi
