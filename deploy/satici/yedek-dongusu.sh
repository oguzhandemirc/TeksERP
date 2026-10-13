#!/bin/sh
# =============================================================================
# Satıcı yedek döngüsü — DB dökümü + anahtar dizini arşivi, İKİSİ DE .tkenc
# =============================================================================
# Alıcılar /yedek-alici/*.tkpub (yalnız AÇIK yarılar; özel yarılar VDS DIŞINDA, Mac + USB).
# Anahtar arşivi ÇİFT katmandır (B8): önce /yedek-alici/anahtar-katmani/*.tkpub (özel yarısı tören YEDEK PAROLASIYLA
# sarılı, VDS dışında), sonra olağan alıcılar → anahtarlar_<damga>.tar.tkenc.tkenc. Dış alıcının özel yarısı tek başına
# imza malzemesini AÇMAZ. Katman alıcısı yoksa anahtar arşivi ALINMAZ (DB dökümü alınır) ve tur hata döner.
# Düz dosya nihai adı hiç almaz: `.part` → doğrulama → şifreleme → düz silinir. Alıcı dizini
# kullanılamıyorsa yedek ALINMAZ (düz döküm üretilmez) ve döngü sesli uyarır.
# Budama: YEDEK_SAKLA_GUN'den eski dosyalar silinir AMA her türün en yeni YEDEK_EN_AZ kopyası kalır
# (yedek alınamayan uzun bir dönemde son iyi yedek budanmaz).
#
#   dongu (varsayılan) — saatte bir bakar; en yeni DB yedeği YEDEK_ARALIK_SAAT'ten eskiyse alır
#   tek               — hemen bir yedek al + buda, çık (runbook doğrulaması)
# =============================================================================
set -eu
: "${DB_HOST:=satici-db}" "${DB_KULLANICI:=satici}" "${DB_ADI:=satici}"
: "${YEDEK_ARALIK_SAAT:=24}" "${YEDEK_SAKLA_GUN:=30}" "${YEDEK_EN_AZ:=7}"
# Yollar compose'da sabittir; ortamla ezilmeleri yalnız bekçi içindir (test_yedek_dongusu).
Y="${YEDEK_KOK:-/yedek}"
ALICI="${YEDEK_ALICI_KOK:-/yedek-alici}"
KATMAN="$ALICI/anahtar-katmani"
ANAHTAR="${YEDEK_ANAHTAR_KOK:-/anahtarlar}"
ARAC="${YEDEK_ARAC:-/arac/yedek-sifrele.cjs}"

log() { echo "[satici-yedek] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

PGPASSWORD="$(tr -d '\r\n' < "${DB_PAROLA_DOSYASI:-/run/secrets/db_parolasi}")"
export PGPASSWORD

# En yeni dosyanın yaşı (sn); yoksa çok büyük.
en_yeni_yas() {
  f=$(ls -1t "$Y"/$1 2>/dev/null | head -n 1 || true)
  if [ -z "$f" ]; then echo 999999999; return; fi
  echo $(( $(date +%s) - $(stat -c %Y "$f") ))
}

yedekle() {
  damga=$(date -u +%Y%m%d_%H%M%S)
  dump="$Y/.satici_${damga}.dump.part"
  arsiv="$Y/.anahtarlar_${damga}.tar.part"
  ic="$Y/.anahtarlar_${damga}.ic.part"
  node "$ARAC" durum --anahtar-dizini "$ALICI" >/dev/null || { log "HATA: alıcı dizini kullanılamıyor — yedek ALINMADI"; return 1; }
  pg_dump -h "$DB_HOST" -U "$DB_KULLANICI" -d "$DB_ADI" -Fc -f "$dump" || { log "HATA: pg_dump"; return 1; }
  pg_restore --list "$dump" >/dev/null || { log "HATA: döküm okunamadı (pg_restore --list)"; return 1; }
  node "$ARAC" sifrele --girdi "$dump" --cikti "$Y/satici_${damga}.dump.tkenc" --anahtar-dizini "$ALICI" --duzu-sil || { log "HATA: DB dökümü şifrelenemedi"; return 1; }
  # Katman alıcısı DB dökümünden SONRA denetlenir: eksik katman anahtar arşivini durdurur, DB yedeğini değil.
  node "$ARAC" durum --anahtar-dizini "$KATMAN" >/dev/null || { log "HATA: anahtar katmanı alıcısı yok ($KATMAN) — anahtar arşivi ALINMADI"; return 1; }
  tar -C "$ANAHTAR" -cf "$arsiv" . || { log "HATA: anahtar dizini arşivlenemedi"; return 1; }
  node "$ARAC" sifrele --girdi "$arsiv" --cikti "$ic" --anahtar-dizini "$KATMAN" --duzu-sil || { log "HATA: anahtar arşivi iç katmanı şifrelenemedi"; return 1; }
  node "$ARAC" sifrele --girdi "$ic" --cikti "$Y/anahtarlar_${damga}.tar.tkenc.tkenc" --anahtar-dizini "$ALICI" --duzu-sil || { log "HATA: anahtar arşivi dış katmanı şifrelenemedi"; return 1; }
  log "tamam: satici_${damga}.dump.tkenc + anahtarlar_${damga}.tar.tkenc.tkenc"
}

# $1 = dosya deseni: en yeni YEDEK_EN_AZ korunur, kalanlardan YEDEK_SAKLA_GUN'den eskiler silinir.
buda() {
  simdi=$(date +%s)
  ls -1t "$Y"/$1 2>/dev/null | tail -n +$((YEDEK_EN_AZ + 1)) | while read -r f; do
    gun=$(( (simdi - $(stat -c %Y "$f")) / 86400 ))
    if [ "$gun" -ge "$YEDEK_SAKLA_GUN" ]; then
      rm -f -- "$f"
      log "budandı: $(basename "$f") (${gun} gün)"
    fi
  done
}

tur() {
  rm -f "$Y"/.*.part
  if yedekle; then
    buda 'satici_*.dump.tkenc'
    buda 'anahtarlar_*.tar.tkenc*'
  else
    rm -f "$Y"/.*.part
    return 1
  fi
}

case "${1:-dongu}" in
  tek)
    tur
    ;;
  dongu)
    log "başladı: aralık ${YEDEK_ARALIK_SAAT} sa · saklama ${YEDEK_SAKLA_GUN} gün · en az ${YEDEK_EN_AZ} kopya"
    while :; do
      if [ "$(en_yeni_yas 'satici_*.dump.tkenc')" -ge $((YEDEK_ARALIK_SAAT * 3600)) ]; then
        tur || log "yedek bu turda alınamadı — bir saat sonra yeniden"
      fi
      sleep 3600
    done
    ;;
  *)
    echo "kullanım: yedek-dongusu.sh [dongu|tek]" >&2
    exit 2
    ;;
esac
