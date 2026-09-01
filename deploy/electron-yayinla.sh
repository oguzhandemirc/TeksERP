#!/usr/bin/env bash
# =============================================================================
# Electron panelinin yeni sürümünü güncelleme sunucusuna yayınlar (macOS/Linux).
# Windows eşdeğeri: deploy/electron-yayinla.ps1
#
# Kullanım:
#   ./deploy/electron-yayinla.sh              # paketin müşterisine + sürümüne yayınla
#   ./deploy/electron-yayinla.sh 2.8.1        # belirli sürümü yayınla
#   ./deploy/electron-yayinla.sh --dogrula    # YÜKLEME YOK — mevcut yayını denetle
# Reçete: docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md
#
# Script'in asıl işi YÜKLEME SIRASINI korumaktır: `latest.yml` EN SON gider.
# Ters sırada, henüz yüklenmemiş bir .exe'yi işaret eden bir latest.yml yayında
# kalır ve o aralıkta kontrol yapan paneller "sürüm dosyası bulunamadı" der.
# =============================================================================
set -euo pipefail

SSH_HEDEF="${SSH_HEDEF:-yenisunucu}"   # ~/.ssh/config takma adı (port 2222 orada)
YAYIN_KOK="${YAYIN_KOK:-/opt/stack/apps/tekserp-guncelleme/html}"
BASE_URL="${BASE_URL:-https://guncelleme.etkiliyazilim.com}"

kok="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
electron_dir="$kok/Electron"

# Müşteri, paketin KENDİ içinden okunur (`shared/musteri.json`) — elle yazılan
# ikinci bir kopya yok. Böylece "adnansahin paketini yenifabrika klasörüne
# yükleme" hatası yapısal olarak imkânsız: yüklenecek yer, paketin kimliğinden
# türer.
musteri="$(node -p "require('$electron_dir/shared/musteri.json').kod" 2>/dev/null)" \
  || { echo "HATA: shared/musteri.json okunamadı" >&2; exit 1; }
UZAK_DIZIN="${UZAK_DIZIN:-$YAYIN_KOK/$musteri/electron}"
YAYIN_URL="${YAYIN_URL:-$BASE_URL/$musteri/electron}"

hata() { echo "HATA: $*" >&2; exit 1; }

# --- Salt denetim kipi ---------------------------------------------------
# `--dogrula [sürüm]` yükleme YAPMADAN mevcut yayını denetler. İki işi var:
# ① "yayın hâlâ ayakta mı" sorusunun ucuz cevabı (elle tur sırasında, ya da
#    bir makine güncelleme alamıyor diye şüphelenince);
# ② aşağıdaki `dogrula()` dallarının ölü harf olmadığını sınayabilmek.
if [ "${1:-}" = "--dogrula" ]; then
  denetim_surum="${2:-}"
  if [ -z "$denetim_surum" ]; then
    denetim_surum=$(curl -fsS "$YAYIN_URL/latest.yml?onbellek-atla=$$" 2>/dev/null | grep "^version:" | awk '{print $2}') \
      || hata "Yayındaki latest.yml okunamadı: $YAYIN_URL/latest.yml"
    [ -n "$denetim_surum" ] || hata "Yayında latest.yml yok ya da sürüm satırı okunamadı."
  fi
  echo "Yayın denetleniyor: $musteri / $denetim_surum"
fi


# Denetim kipinde yerel paket klasörü aranmaz — sunucudaki yayın denetlenir.
if [ "${1:-}" = "--dogrula" ]; then
  denetim_kipi=1
  surum="$denetim_surum"
else
  denetim_kipi=0
  surum="${1:-$(node -p "require('$electron_dir/package.json').version")}"
  echo "Müşteri: $musteri · Sürüm: $surum"
fi

rel="$electron_dir/release/$surum"
[ "$denetim_kipi" = "1" ] || [ -d "$rel" ] || hata "Paket klasörü yok: $rel
  Önce derle: ./deploy/electron-paketle.sh $musteri
  Sürüm numarasını ARTIRMAYI unutma."

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

  if [ "${atla_yukleme:-0}" != "1" ]; then
  echo "1/2  paket + blockmap..."
  scp "$setup" "$blockmap" "$SSH_HEDEF:$UZAK_DIZIN/"

  echo "2/2  latest.yml (en son — sıra önemli)..."
  scp "$latest" "$SSH_HEDEF:$UZAK_DIZIN/"
  fi

  # --- SAĞLAMA DOĞRULAMASI (boyut YETMEZ) --------------------------------
  # Boyut kıyası yarım yüklemeyi yakalar ama BOZUK yüklemeyi yakalamaz: aynı
  # uzunlukta bozulmuş bayt dizisi de doğru boyutu verir. `latest.yml`in
  # taşıdığı sha512 zaten electron-updater'ın kuracağı beklentidir — sunucuya
  # İNEN dosyadan yeniden hesaplayıp karşılaştırmak, panel indirmeden önce
  # aynı soruyu sormak demektir. Hesap SUNUCUDA yapılır (141 MB'ı geri
  # indirmeden).
  bek_sha512=$(grep -m1 -A2 "url: TeksERP-$surum-Setup.exe" "$latest" | grep -m1 "sha512:" | awk '{print $2}')
  if [ -n "$bek_sha512" ]; then
    gercek_sha512=$(ssh "$SSH_HEDEF" \
      "openssl dgst -sha512 -binary '$UZAK_DIZIN/TeksERP-$surum-Setup.exe' | openssl base64 -A")
    if [ "$bek_sha512" != "$gercek_sha512" ]; then
      hata "SAĞLAMA UYUŞMUYOR — sunucudaki paket latest.yml'in söylediği dosya DEĞİL.
  beklenen: $bek_sha512
  sunucuda: $gercek_sha512
  Panel bu paketi reddeder. Yeniden yükle."
    fi
    echo "  ✓ sha512 doğrulandı (latest.yml ↔ sunucudaki paket)"
  else
    echo "  ⚠️ latest.yml'de sha512 bulunamadı — sağlama doğrulaması ATLANDI."
  fi
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

echo "OK — yayında: $surum"
[ "$denetim_kipi" = "1" ] && exit 0

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
ssh "$SSH_HEDEF" "mkdir -p '$DEFTER_DIZIN' && printf '%s\t%s\t%s\t%s\t%s\n' \
  '$(date -Iseconds)' '$surum' '$(whoami)@$(hostname -s)' \
  '$(shasum -a 256 "$setup" | cut -c1-16)' '$(wc -c < "$setup" | tr -d " ")' \
  >> '$DEFTER_DIZIN/$musteri-YAYIN-DEFTERI.tsv'" 2>/dev/null \
  && echo "  ✓ yayın defterine yazıldı" \
  || echo "  ⚠️ yayın defteri yazılamadı (yayın etkilenmedi)"

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

echo "Fabrikadaki paneller en geç 4 saat içinde görür."
echo "Hemen denemek için: Genel Ayarlar > Bu Bilgisayar > Güncelleme > Şimdi kontrol et"
