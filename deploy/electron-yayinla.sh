#!/usr/bin/env bash
# =============================================================================
# Electron panelinin yeni sürümünü güncelleme sunucusuna yayınlar (macOS/Linux;
# Windows'ta Git Bash/WSL). Kapısız ikinci yol YOK: `deploy/electron-yayinla.ps1`
# fail-closed saplamadır.
#
# Kullanım:
#   ./deploy/electron-yayinla.sh --musteri=adnansahin             # paketin sürümüne yayınla
#   ./deploy/electron-yayinla.sh --musteri=adnansahin 2.8.1       # belirli sürümü yayınla
#   ./deploy/electron-yayinla.sh --musteri=adnansahin --dogrula   # YÜKLEME YOK — yayını denetle
#   ./deploy/electron-yayinla.sh --musteri=testfabrika --kuru     # AĞ YOK — yerel kapılar + yükleme planı
#   ./deploy/electron-yayinla.sh --musteri=adnansahin --terfi-atla="<kullanıcının cümlesi>"  # K5 acil kaçışı
#
# ⚠️ TERFİ (K5): `terfiKaynagi` olan kanala (adnansahin) yalnız terfi etiketli commit'ten, hazırlık
# kanalında yayınlanmış sürüm çıkar (scripts/lib/terfi.mjs); kaçış yalnız kullanıcının cümlesiyle.
# Reçete: docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md
#
# Script'in asıl işi YÜKLEME SIRASINI korumaktır: `latest.yml` EN SON gider.
# Ters sırada, henüz yüklenmemiş bir .exe'yi işaret eden bir latest.yml yayında
# kalır ve o aralıkta kontrol yapan paneller "sürüm dosyası bulunamadı" der.
#
# ⚠️ İKİ AŞAMALI YAYIN (2026-11-07; 1.3.8 · 1.3.13 · 1.3.15'te üç kez 403): scp dosyayı Mac'teki
# kipiyle (0600) taşır, nginx okuyamaz. Paket + blockmap yüklenir → yerelde ve sunucuda 0644 →
# dışarıdan HTTP 200 + boyut + sha512 → ANCAK O ZAMAN latest.yml geçici ada gider, 0644 + atomik
# `mv`. Ön doğrulama düşerse latest.yml'e DOKUNULMAZ (paneller eski sürümde kalır), çıkış ≠ 0.
# Defter · budama · etiket yayın canlıya çıktığı (mv) anda koşar; defter satırı idempotenttir.
#
# ⚠️ HEDEF PAKETİN KİMLİĞİNDEN ÇÖZÜLÜR: `--musteri` NİYETTİR, paketin gömülü
# kimliği (app-update.yml adresi · updater önbelleği · exe adı) OTORİTEDİR; ikisi
# aynı kanalı göstermezse ssh'tan ÖNCE durulur. Çalışma ağacındaki musteri.json
# OKUNMAZ: o bir beyandır ve yarıda kalan bir paketleme onu başka kanalda bırakır.
# =============================================================================
set -euo pipefail

# ~/.ssh/config takma adı. ⚠️ 2026-09-01'de `yenisunucu`dan `tekserp-yayin`e
# çevrildi: yayın 80.253.255.188'e taşındı ve DNS de oraya döndü. İki ayrıntı
# load-bearing:
#  · `yenisunucu` artık ESKİ sunucudur (91.217.119.138) — adı yanıltıcı ama
#    demo işi ve bir haftalık geri dönüş yolu orada, o yüzden bırakıldı.
#  · `tekserp-yayin` kullanıcısı `yayinci`: sudo YOK, yalnız yayın ağacına
#    yazar. Yönetici hesabıyla yayın yapılmaz.
SSH_HEDEF="${SSH_HEDEF:-tekserp-yayin}"
YAYIN_KOK="${YAYIN_KOK:-/opt/stack/apps/tekserp-guncelleme/html}"
BASE_URL="${BASE_URL:-https://guncelleme.etkiliyazilim.com}"

kok="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
electron_dir="$kok/Electron"

hata() { echo "HATA: $*" >&2; exit 1; }

# --- Argümanlar ------------------------------------------------------------
musteri=""
denetim_kipi=0
kuru=0
surum_arg=""
terfi_atla=""
terfi_atla_verildi=0
for a in "$@"; do
  case "$a" in
    --musteri=*) musteri="${a#--musteri=}" ;;
    --dogrula) denetim_kipi=1 ;;
    --kuru) kuru=1 ;;
    --terfi-atla=*) terfi_atla="${a#--terfi-atla=}"; terfi_atla_verildi=1 ;;
    --terfi-atla) terfi_atla=""; terfi_atla_verildi=1 ;;
    -*) hata "Tanınmayan seçenek: $a" ;;
    *)
      [ -z "$surum_arg" ] || hata "Fazla argüman: $a"
      surum_arg="$a"
      ;;
  esac
done

[ "$kuru" = "1" ] && [ "$denetim_kipi" = "1" ] && hata "--kuru ile --dogrula birlikte verilemez (--dogrula yayına bakar, --kuru hiç ağa çıkmaz)."
[ "$terfi_atla_verildi" = "1" ] && [ "$denetim_kipi" = "1" ] && hata "--terfi-atla yalnız yayında verilir (--dogrula hiçbir şey yüklemez)."

[ -n "$musteri" ] || hata "HANGİ KANALA YAYINLANIYOR? --musteri=<kod> zorunlu.
  Hedef klasör paketin kimliğinden çözülür; argüman niyettir ve onunla birebir olmalı.
  Örnek: ./deploy/electron-yayinla.sh --musteri=adnansahin"

# Kanal kayıtlı mı (kayıt defteri kırmızıysa da DUR) — hiçbir ağ/ssh işinden ÖNCE.
node "$kok/scripts/kanal-kapisi.mjs" kanal "$musteri" \
  || hata "Kanal kapısı geçilmedi (kayıt defteri: deploy/kanallar.json)."

rel=""
if [ "$denetim_kipi" = "0" ]; then
  surum="${surum_arg:-$(node -p "require('$electron_dir/package.json').version")}"
  rel="$electron_dir/release/$musteri/$surum"
  if [ ! -d "$rel" ]; then
    if [ -d "$electron_dir/release/$surum" ]; then
      hata "Paket ESKİ düzende: release/$surum (kanal ayrımından önce üretilmiş).
  Yayıncı paketi release/<kanal>/<sürüm>/ altında arar ve kimliğini oradan okur.
  Yeniden paketle: ./deploy/electron-paketle.sh $musteri"
    fi
    hata "Paket klasörü yok: $rel
  Önce derle: ./deploy/electron-paketle.sh $musteri
  Sürüm numarasını ARTIRMAYI unutma."
  fi
  # ARTEFAKT OTORİTESİ — paket gerçekten bu kanalın mı? (ssh'tan ÖNCE)
  node "$kok/scripts/kanal-kapisi.mjs" panel-yayin "$musteri" "$rel" \
    || hata "Paket '$musteri' kanalının değil ya da kimliği okunamadı — yükleme yapılmadı."
  # TERFİ KAPISI (K5) — üretim kanalına yalnız hazırlık kanalında yayınlanmış, kullanıcının terfi
  # etiketiyle onayladığı commit (ssh'tan ÖNCE). --kuru ağa çıkmaz: kaynak kanalın sürümü orada ölçülmez.
  terfi_ek=()
  [ "$kuru" = "1" ] && terfi_ek+=("--kuru")
  [ "$terfi_atla_verildi" = "1" ] && terfi_ek+=("--terfi-atla=$terfi_atla")
  if [ "${#terfi_ek[@]}" -gt 0 ]; then
    node "$kok/scripts/kanal-kapisi.mjs" terfi "$musteri" panel "$surum" "${terfi_ek[@]}" \
      || hata "Terfi kapısı geçilmedi — yükleme yapılmadı."
  else
    node "$kok/scripts/kanal-kapisi.mjs" terfi "$musteri" panel "$surum" \
      || hata "Terfi kapısı geçilmedi — yükleme yapılmadı."
  fi
fi

# Hedef yalnız doğrulanmış kanal kodundan türer.
UZAK_DIZIN="${UZAK_DIZIN:-$YAYIN_KOK/$musteri/electron}"
YAYIN_URL="${YAYIN_URL:-$BASE_URL/$musteri/electron}"

# --- Salt denetim kipi ---------------------------------------------------
# `--dogrula [sürüm]` yükleme YAPMADAN mevcut yayını denetler. İki işi var:
# ① "yayın hâlâ ayakta mı" sorusunun ucuz cevabı (elle tur sırasında, ya da
#    bir makine güncelleme alamıyor diye şüphelenince);
# ② aşağıdaki `dogrula()` dallarının ölü harf olmadığını sınayabilmek.
if [ "$denetim_kipi" = "1" ]; then
  denetim_surum="$surum_arg"
  if [ -z "$denetim_surum" ]; then
    denetim_surum=$(curl -fsS "$YAYIN_URL/latest.yml?onbellek-atla=$$" 2>/dev/null | grep "^version:" | awk '{print $2}') \
      || hata "Yayındaki latest.yml okunamadı: $YAYIN_URL/latest.yml"
    [ -n "$denetim_surum" ] || hata "Yayında latest.yml yok ya da sürüm satırı okunamadı."
  fi
  echo "Yayın denetleniyor: $musteri / $denetim_surum"
  surum="$denetim_surum"
else
  echo "Müşteri: $musteri · Sürüm: $surum"
fi

setup="$rel/TeksERP-$surum-Setup.exe"
blockmap="$setup.blockmap"
latest="$rel/latest.yml"

if [ "$denetim_kipi" = "0" ]; then
  for f in "$setup" "$blockmap" "$latest"; do
    [ -f "$f" ] || hata "Eksik dosya: $f
  latest.yml yoksa package.json > build.publish eksik olabilir."
  done
fi

if [ "$denetim_kipi" = "0" ]; then
  # latest.yml gerçekten BU sürümü mü gösteriyor? (eski build kalıntısı tuzağı)
  grep -q "^version: $surum\$" "$latest" || hata "latest.yml '$surum' sürümünü göstermiyor — eski build kalıntısı olabilir."

  mb=$(( $(wc -c < "$setup") / 1024 / 1024 ))
  echo "Yüklenecek: TeksERP-$surum-Setup.exe (${mb} MB) + blockmap + latest.yml"

  # --- KURU KİP: yerel kapıların hepsi geçti; hiçbir ağ/ssh/scp/curl/etiket işi yok ---
  if [ "$kuru" = "1" ]; then
    echo "[kuru] hedef      : $SSH_HEDEF:$UZAK_DIZIN/"
    echo "[kuru] sıra       : 1) yerelde chmod 0644 → TeksERP-$surum-Setup.exe + .blockmap  2) sunucuda chmod 0644 → dışarıdan HTTP 200 + boyut + sha512 (manifestten ÖNCE)  3) latest.yml → latest.yml.yukleniyor (0644) → atomik mv (EN SON)  4) son dış doğrulama → defter · budama · etiket"
    echo "[kuru] yayın adresi: $YAYIN_URL/latest.yml"
    echo "[kuru] defter     : $(dirname "$YAYIN_KOK")/defter/$musteri-YAYIN-DEFTERI.tsv (sürüm + özet satırı varsa yeniden yazılmaz)"
    echo "[kuru] değişmezlik · izin · ön doğrulama · sha512 · dış doğrulama · budama · panel-v$surum etiketi ATLANDI (ağ gerektirir)"
    [ "$terfi_atla_verildi" = "1" ] && echo "[kuru] terfi atlama kaydı (yayın defteri + etiket mesajı) ATLANDI (yayın yok)"
    echo "KURU — paket '$musteri' kanalının; yükleme yapılmadı."
    exit 0
  fi

  # --- DEĞİŞMEZLİK KAPISI ------------------------------------------------
  # Yayınlanmış bir sürümün dosyaları ÜZERİNE YAZILMAZ. Aynı numarayla farklı
  # bayt iki şeyi birden bozar: ① `blockmap` delta güncellemesi eski pakete
  # göre hesaplandığı için sahadaki panel bozuk indirme yapar; ② "1.0.0 hangi
  # derleme" sorusu cevapsız kalır — hata raporu ile paket eşleşmez.
  # Aynı bayt ise yükleme atlanır (yeniden yayın zararsız/idempotent olsun).
  uzak_sha=$(ssh "$SSH_HEDEF" "test -f '$UZAK_DIZIN/TeksERP-$surum-Setup.exe' && \
      sha256sum '$UZAK_DIZIN/TeksERP-$surum-Setup.exe' | cut -d' ' -f1" 2>/dev/null || true)
  if [ -n "$uzak_sha" ]; then
    yerel_sha=$(shasum -a 256 "$setup" | cut -d' ' -f1)
    if [ "$uzak_sha" = "$yerel_sha" ]; then
      echo "  ↷ $surum sunucuda AYNI baytlarla zaten var — yükleme atlanıyor."
      atla_yukleme=1
    else
      hata "DEĞİŞMEZLİK İHLALİ — $surum sunucuda FARKLI baytlarla duruyor.
  sunucu: $uzak_sha
  yerel : $yerel_sha
  Yayınlanmış bir sürümün üzerine yazmak, sahadaki panellerin delta
  güncellemesini bozar. Sürüm numarasını ARTIR ve yeniden paketle."
    fi
  fi

  # --- AŞAMA 1: paket + blockmap -------------------------------------------
  # scp kaynağın kipini taşır: başka makineden kopyalanmış/0600 paket sunucuda
  # 0600 olur, nginx (www-data) okuyamaz → 403. Kip YEREL + SUNUCU, ikisinde de.
  chmod 0644 "$setup" "$blockmap" "$latest" \
    || hata "Yerel paket dosyalarının kipi 0644 yapılamadı — yükleme yapılmadı."
  if [ "${atla_yukleme:-0}" != "1" ]; then
  echo "1/3  paket + blockmap..."
  scp "$setup" "$blockmap" "$SSH_HEDEF:$UZAK_DIZIN/"
  fi
  # Atlanan yüklemede de: eski bir yüklemeden kalmış 0600 dosya aynı 403'ü verir.
  echo "2/3  sunucuda kip 0644 + dışarıdan ön doğrulama (manifestten ÖNCE)..."
  ssh "$SSH_HEDEF" "chmod 0644 '$UZAK_DIZIN/TeksERP-$surum-Setup.exe' '$UZAK_DIZIN/TeksERP-$surum-Setup.exe.blockmap'" \
    || hata "Paket dosyalarının kipi sunucuda 0644 yapılamadı — latest.yml YÜKLENMEDİ (paneller eski sürümde kalır)."

  # --- AŞAMA 2: ön doğrulama — latest.yml'den ÖNCE -----------------------
  # Panelin göreceği yoldan (HTTP, önbelleği atlayan adres): 200 + boyut. Dışarıdan
  # okunamayan pakete yönlendiren manifest, panelleri "indirilemiyor"da bırakır.
  on_dogrula() {
    local ad="$1" yerel="$2" url kod uzak
    url="$YAYIN_URL/$ad"
    kod=$(curl -s -o /dev/null -w "%{http_code}" -I "$url?on-dogrulama=$$") || kod="000"
    if [ "$kod" != "200" ]; then
      hata "$ad dışarıdan HTTP $kod veriyor — latest.yml YÜKLENMEDİ (paneller indirilemeyen pakete yönlenmez).
  Sunucuda kipi ve sahibi incele: ls -l $UZAK_DIZIN/$ad"
    fi
    uzak=$(curl -s -o /dev/null -w "%{size_download}" "$url?onbellek-atla=$$") || uzak="?"
    [ "$uzak" = "$yerel" ] \
      || hata "$ad boyutu uyuşmuyor (yerel: $yerel, yayında: $uzak) — latest.yml YÜKLENMEDİ. Yükleme yarım kalmış olabilir."
    echo "  ✓ $ad dışarıdan 200 + boyut $yerel (manifestten önce)"
  }
  on_dogrula "TeksERP-$surum-Setup.exe.blockmap" "$(wc -c < "$blockmap" | tr -d ' ')"
  on_dogrula "TeksERP-$surum-Setup.exe" "$(wc -c < "$setup" | tr -d ' ')"

  # --- SAĞLAMA DOĞRULAMASI (boyut YETMEZ) — latest.yml'den ÖNCE ---------
  # Boyut yarım yüklemeyi yakalar, BOZUK yüklemeyi yakalamaz. `latest.yml`in
  # taşıdığı sha512 electron-updater'ın kuracağı beklentidir; sunucuya İNEN
  # dosyadan yeniden hesaplanır (SUNUCUDA — 141 MB geri indirilmeden).
  bek_sha512=$(grep -m1 -A2 "url: TeksERP-$surum-Setup.exe" "$latest" | grep -m1 "sha512:" | awk '{print $2}')
  if [ -n "$bek_sha512" ]; then
    gercek_sha512=$(ssh "$SSH_HEDEF" \
      "openssl dgst -sha512 -binary '$UZAK_DIZIN/TeksERP-$surum-Setup.exe' | openssl base64 -A") \
      || hata "Sunucuda sha512 hesaplanamadı — latest.yml YÜKLENMEDİ."
    if [ "$bek_sha512" != "$gercek_sha512" ]; then
      hata "SAĞLAMA UYUŞMUYOR — sunucudaki paket latest.yml'in söylediği dosya DEĞİL; latest.yml YÜKLENMEDİ.
  beklenen: $bek_sha512
  sunucuda: $gercek_sha512
  Panel bu paketi reddederdi. Yeniden yükle."
    fi
    echo "  ✓ sha512 doğrulandı (latest.yml ↔ sunucudaki paket)"
  else
    echo "  ⚠️ latest.yml'de sha512 bulunamadı — sağlama doğrulaması ATLANDI."
  fi

  # --- AŞAMA 3: latest.yml — geçici ad, 0644, atomik mv (yayını AÇAN adım) ---
  # Nihai ada doğrudan scp iki pencere açar: yarım yazılmış manifest ve 0600 manifest.
  # Geçici ada yükle → kip → `mv` (aynı dizin, tek rename): paneller ya eskiyi ya yeniyi görür.
  gecici_yml="$UZAK_DIZIN/latest.yml.yukleniyor"
  gecici_sil() { ssh "$SSH_HEDEF" "unlink '$gecici_yml' 2>/dev/null || true" 2>/dev/null || true; }
  echo "3/3  latest.yml (EN SON — geçici ad → 0644 → atomik mv)..."
  scp "$latest" "$SSH_HEDEF:$gecici_yml" \
    || { gecici_sil; hata "latest.yml geçici ada yüklenemedi — yayındaki latest.yml DEĞİŞMEDİ."; }
  ssh "$SSH_HEDEF" "chmod 0644 '$gecici_yml' && mv -f '$gecici_yml' '$UZAK_DIZIN/latest.yml'" \
    || { gecici_sil; hata "latest.yml kipi/yerine koyma düştü — yayındaki latest.yml DEĞİŞMEDİ, geçici dosya silindi."; }
  echo "  ✓ latest.yml yerine kondu — yayın AÇIK: $surum"
fi

echo "Doğrulanıyor..."

# Her dosyayı ÖNCE temiz URL ile, sorun varsa önbelleği atlayarak dener.
# Amaç, "404" ile "önbellekte kalmış 404"ü YÜKLEME ANINDA ayırmak: ikisi aynı
# görünür ama biri yeniden yüklemekle, diğeri yalnız Cloudflare purge'üyle
# çözülür. (2026-08-26'da bu ayrım elle yapıldı; buraya o yüzden kondu.)
dogrula() {
  local ad="$1" yerel="$2" url kod origin uzak
  url="$YAYIN_URL/$ad"
  kod=$(curl -s -o /dev/null -w "%{http_code}" -I "$url")
  if [ "$kod" != "200" ]; then
    origin=$(curl -s -o /dev/null -w "%{http_code}" -I "$url?onbellek-atla=$$")
    # ⚠️ Bu dal İSTEYEREK ÜRETİLEMEDİ (2026-08-27, mobil oturumuyla birlikte
    # ölçüldü): sunucudaki `error_page 404 → Cache-Control: no-store` ikinci
    # hattı 404'lerin Cloudflare önbelleğine girmesini zaten engelliyor
    # (`cf-cache-status: DYNAMIC`). Yani dal bugün teoride kalıyor ve kodda
    # savunma derinliği olarak duruyor: o nginx kuralı değişirse ya da başka
    # bir hata yolu önbelleğe girerse, tek sinyal bu olur.
    if [ "$origin" = "200" ]; then
      hata "$ad — ÖNBELLEK SORUNU (temiz URL: $kod, origin: 200).
  Dosya sunucuda DURUYOR; Cloudflare eski bir yanıtı önbellekte tutuyor.
  Çözüm: Cloudflare → Caching → Configuration → Purge Cache → Custom Purge → By URL:
    $url"
    fi
    hata "$ad — yayında görünmüyor (HTTP $kod). Dosya gerçekten yüklenmemiş olabilir."
  fi
  # Boyut kıyası: yarım yüklenmiş dosya 200 döner ama eksiktir.
  uzak=$(curl -s -o /dev/null -w "%{size_download}" "$url?onbellek-atla=$$")
  if [ -n "$yerel" ] && [ "$uzak" != "$yerel" ]; then
    hata "$ad — boyut uyuşmuyor (yerel: $yerel, yayında: $uzak). Yükleme yarım kalmış olabilir."
  fi
}

son_dogrulama() {
  local yayindaki
  yayindaki=$(curl -fsS "$YAYIN_URL/latest.yml?onbellek-atla=$$" | grep "^version:" | awk '{print $2}')
  [ "$yayindaki" = "$surum" ] || hata "Yayındaki sürüm '$yayindaki', beklenen '$surum'."
  dogrula "latest.yml" ""
  if [ "$denetim_kipi" = "1" ]; then
    # Yerel paket yoksa boyut kıyası yapılamaz; yalnız erişilebilirlik denetlenir.
    dogrula "TeksERP-$surum-Setup.exe.blockmap" ""
    dogrula "TeksERP-$surum-Setup.exe" ""
  else
    dogrula "TeksERP-$surum-Setup.exe.blockmap" "$(wc -c < "$blockmap" | tr -d ' ')"
    dogrula "TeksERP-$surum-Setup.exe" "$(wc -c < "$setup" | tr -d ' ')"
  fi
}

if [ "$denetim_kipi" = "1" ]; then
  # --dogrula yalnız RAPORLAR: eksik defter/etiket kaydını tamamlamaz.
  son_dogrulama
  echo "OK — yayında: $surum"
  exit 0
fi

# Yayın `mv` anında CANLI oldu; son dış doğrulama düşse de (önbellek vb.) defter · budama · etiket
# yazılır — aksi hâlde kayıt gerçeği yansıtmaz ve elle tamamlanır (1.3.15'te yaşandı). Çıkış yine ≠ 0.
son_kod=0
( son_dogrulama ) || son_kod=$?
if [ "$son_kod" = "0" ]; then
  echo "OK — yayında: $surum"
else
  echo "⚠️ latest.yml yerine kondu (yayın CANLI) ama son dış doğrulama düştü — defter/budama/etiket yine yazılıyor.
  Sonra: ./deploy/electron-yayinla.sh --musteri=$musteri --dogrula $surum" >&2
fi

# --- YAYIN DEFTERİ ---------------------------------------------------------
# "Bu sürümü kim, ne zaman, hangi makineden, hangi sağlamayla yayınladı."
# Sahada bir panel bozulduğunda ilk soru "hangi paketi almış" olur; defter
# olmadan cevap yalnız dosya tarihidir ve o da kopyalamayla değişir.
#
# ⚠️ Defter yayın ağacının (html/) DIŞINDA durur. İlk yazımda html/ içindeydi ve
# internete AÇIKTI (ölçüldü: HTTP 200) — iç makine adlarını ve yayın geçmişini
# sızdırıyordu. nginx'e kural yazmak da olurdu ama kırılgan: yarın oraya konan
# ikinci bir iç dosya yine sızardı. Ayrım DİZİNDE olmalı — html/ yalnız kamuya
# açık olması gereken şeyleri barındırır.
DEFTER_DIZIN="$(dirname "$YAYIN_KOK")/defter"
# Terfi atlandıysa (S4) kullanıcının cümlesi 6. kolon olur; tek tırnak uzak kabuk için kaçırılır.
defter_bicim='%s\t%s\t%s\t%s\t%s\n'
defter_ek=""
if [ "$terfi_atla_verildi" = "1" ]; then
  defter_bicim='%s\t%s\t%s\t%s\t%s\t%s\n'
  terfi_atla_kacisli=$(printf '%s' "$terfi_atla" | tr '\t\r\n' '   ' | sed "s/'/'\\\\''/g")
  defter_ek=" 'terfi-atlandi: $terfi_atla_kacisli'"
fi
# İDEMPOTENT: aynı sürüm + aynı özet (2. ve 4. kolon) zaten varsa satır yinelenmez — yarıda kalan
# yayının yeniden koşumu defteri çiftlemez ("ne oldu" bir kez yazılır).
defter_dosya="$DEFTER_DIZIN/$musteri-YAYIN-DEFTERI.tsv"
defter_sha16=$(shasum -a 256 "$setup" | cut -c1-16)
defter_sonuc=$(ssh "$SSH_HEDEF" "mkdir -p '$DEFTER_DIZIN' && \
  if [ -f '$defter_dosya' ] && awk -F'\t' -v s='$surum' -v h='$defter_sha16' '\$2==s && \$4==h {b=1} END {exit !b}' '$defter_dosya'; then echo zaten-var; \
  else printf '$defter_bicim' \
  '$(date -Iseconds)' '$surum' '$(whoami)@$(hostname -s)' \
  '$defter_sha16' '$(wc -c < "$setup" | tr -d " ")'$defter_ek \
  >> '$defter_dosya' && echo yazildi; fi" 2>/dev/null) || defter_sonuc="hata"
case "$defter_sonuc" in
  yazildi)   echo "  ✓ yayın defterine yazıldı" ;;
  zaten-var) echo "  · yayın defterinde zaten var ($surum · $defter_sha16) — yeniden yazılmadı" ;;
  *)         echo "  ⚠️ yayın defteri yazılamadı (yayın etkilenmedi)" ;;
esac

# --- ESKİ SÜRÜMLERİ BUDA ---------------------------------------------------
# Son 5 sürüm durur. Bugün sınırsız birikiyordu: her paket ~141 MB, yılda
# birkaç sürümle disk sessizce doluyor. `latest.yml` her zaman korunur;
# silinen yalnız ARTIK GÖSTERİLMEYEN eski paketlerdir.
# ⚠️ Silmeden önce yayındaki sürüm dışlanır — çalışan yayına dokunulmaz.
ssh -T "$SSH_HEDEF" bash -s -- "$UZAK_DIZIN" "$surum" <<'BUDA' 2>/dev/null || true
  dizin="$1"; guncel="$2"; tut=5
  cd "$dizin" || exit 0
  ls -1t TeksERP-*-Setup.exe 2>/dev/null | grep -v "TeksERP-$guncel-Setup.exe" \
    | tail -n +$tut | while read -r eski; do
        echo "  ↷ budandı: $eski"
        rm -f "$eski" "$eski.blockmap"
      done
BUDA

# --- SÜRÜM ETİKETİ ---------------------------------------------------------
# Bir sonraki turun tabanı budur (`electron-paketle.sh` okur). Etiket YAYIN
# BİTTİKTEN sonra atılır — "sahaya çıkan kod tam olarak buydu" kaydıdır, elle
# verilen bir karar değil.
#
# ⚠️ BEST-EFFORT: yayın zaten yapıldı. Etiketleme düşerse UYARI basılır, yayın
# başarısız sayılmaz — aksi hâlde operatör başarılı bir yayını tekrarlamaya
# itilirdi. Var olan etiket TAŞINMAZ: aynı turda ikinci müşteriye yayın
# yaparken `-f` ile taşımak, etiketin işaret ettiği kodu sessizce değiştirirdi.
#
# Terfi atlandıysa (S4) kullanıcının cümlesi etiket MESAJINA girer: yeni atılan sürüm etiketine ve
# `terfi/<kanal>/panel-vX` kaçış etiketine (cümle argv'den — kabuk metnine gömülmez).
node --input-type=module -e "
  import { etiketAt } from '$kok/scripts/lib/surum.mjs';
  import { cumleDenetle, terfiAtlaMesaji } from '$kok/scripts/lib/terfi.mjs';
  const cumle = process.argv[1] ? cumleDenetle(process.argv[1]).cumle : '';
  const s = etiketAt('panel', '$surum', cumle ? { mesaj: terfiAtlaMesaji({ kod: '$musteri', urun: 'panel', surum: '$surum', cumle }) } : {});
  const mesaj = {
    'atildi': '  ✓ sürüm etiketi atıldı: ' + s.ad,
    'zaten-var': '  · sürüm etiketi zaten var: ' + s.ad + ' (aynı tur)',
    'basarisiz': '  ⚠️ sürüm etiketi atılamadı: ' + s.ad + ' (yayın etkilenmedi)',
  }[s.durum];
  console.log(mesaj + (s.not ? ' — ' + s.not : ''));
" -- "$terfi_atla" || echo "  ⚠️ sürüm etiketi atılamadı (yayın etkilenmedi)"
if [ "$terfi_atla_verildi" = "1" ]; then
  node "$kok/scripts/kanal-kapisi.mjs" terfi-atla-kaydi "$musteri" panel "$surum" "$terfi_atla" \
    || echo "  ⚠️ terfi atlama etiketi atılamadı (yayın etkilenmedi; kayıt yayın defterinde)"
fi

echo "Bu kanaldaki paneller en geç 15 dk içinde görür (açılışta 30 sn)."
echo "Hemen denemek için: Genel Ayarlar > Bu Bilgisayar > Güncelleme > Şimdi kontrol et"
# Kayıtlar yazıldı; son dış doğrulama düştüyse yayın yine de "temiz" sayılmaz.
[ "$son_kod" = "0" ] || hata "Son dış doğrulama düştü (yukarıdaki satırlar) — yayın canlı, kayıtlar yazıldı; önbelleği temizleyip --dogrula ile yeniden denetle."
