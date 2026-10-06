#!/bin/sh
# =============================================================================
# Patron bulutu yedek döngüsü — merkez dökümü + HER HAZIR tesis DB'sinin ayrı dökümü + anahtar dizini arşivi
# (patron-totp.key), HEPSİ .tkenc
# =============================================================================
# Alıcılar /yedek-alici/*.tkpub (yalnız AÇIK yarılar; özel yarılar VDS DIŞINDA, Mac + USB).
# Döküm GÖÇ rolüyle alınır (tablo sahibi; RLS'li tabloların tamamı). Roller küme düzeyindedir ve dökümde
# yoktur: geri yüklemede `--no-owner --no-acl`, sonra patron-goc rolleri yeniden kurar ve `tesis-db goc` tesis
# DB'lerinin yetkilerini hizalar. Tesis listesi merkezden (`facility_databases` HAZIR); tek tesisin geri yüklemesi
# yalnız o DB'ye yapılır. Tesis rol anahtarı yedeğe GİRMEZ (parolalar türetilir; anahtar kaybı veri kaybı değil).
# Düz dosya nihai adı hiç almaz: `.part` → doğrulama → şifreleme → düz silinir. Alıcı dizini
# kullanılamıyorsa yedek ALINMAZ (düz döküm üretilmez) ve döngü sesli uyarır.
# Budama: YEDEK_SAKLA_GUN'den eski dosyalar silinir AMA her türün (ve HAZIR her tesisin) en yeni YEDEK_EN_AZ
# kopyası kalır (yedek alınamayan uzun bir dönemde son iyi yedek budanmaz). HAZIR listesinde olmayan (imha edilmiş)
# tesisin dökümleri bu kuraldan MUAFTIR: yalnız yaşa göre budanır ⇒ imhadan sonra en geç YEDEK_SAKLA_GUN içinde
# yedekten de düşer (Ek-6/A §4.4; tutanaktaki son tarih `BACKUP_CLEAR_DAYS` = 35).
#
#   dongu (varsayılan) — saatte bir bakar; en yeni merkez yedeği YEDEK_ARALIK_SAAT'ten eskiyse tam tur alır
#   tek               — hemen tam tur (merkez + bütün HAZIR tesisler) + buda, çık (runbook doğrulaması)
#   tesis <tesisId>   — yalnız o tesisin anlık dökümü (budama yok), çık
# =============================================================================
set -eu
: "${DB_HOST:=patron-db}" "${DB_KULLANICI:=patron_goc}" "${DB_ADI:=patron}"
: "${YEDEK_ARALIK_SAAT:=24}" "${YEDEK_SAKLA_GUN:=30}" "${YEDEK_EN_AZ:=7}"
Y=/yedek
ALICI=/yedek-alici
ANAHTAR=/anahtarlar
ARAC=/arac/yedek-sifrele.cjs

log() { echo "[patron-yedek] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

PGPASSWORD="$(tr -d '\r\n' < "${DB_PAROLA_DOSYASI:-/run/secrets/goc_parolasi}")"
export PGPASSWORD

# En yeni dosyanın yaşı (sn); yoksa çok büyük.
en_yeni_yas() {
  f=$(ls -1t "$Y"/$1 2>/dev/null | head -n 1 || true)
  if [ -z "$f" ]; then echo 999999999; return; fi
  echo $(( $(date +%s) - $(stat -c %Y "$f") ))
}

# psql -At ile merkezden tek sütun/satır listesi.
merkez_sorgu() {
  psql -h "$DB_HOST" -U "$DB_KULLANICI" -d "$DB_ADI" -X -At -v ON_ERROR_STOP=1 -c "$1"
}

hazir_tesisler() {
  merkez_sorgu "SELECT tesis_id::text || ' ' || database_name FROM facility_databases WHERE status = 'HAZIR' ORDER BY tesis_id"
}

# $1 = DB adı, $2 = nihai dosya adı (.tkenc), $3 = .part damgası
dokum() {
  part="$Y/.${3}.dump.part"
  pg_dump -h "$DB_HOST" -U "$DB_KULLANICI" -d "$1" -Fc -f "$part" || { log "HATA: pg_dump ($1)"; return 1; }
  pg_restore --list "$part" >/dev/null || { log "HATA: döküm okunamadı (pg_restore --list, $1)"; return 1; }
  node "$ARAC" sifrele --girdi "$part" --cikti "$Y/$2" --anahtar-dizini "$ALICI" --duzu-sil || { log "HATA: döküm şifrelenemedi ($1)"; return 1; }
}

alici_hazir() {
  node "$ARAC" durum --anahtar-dizini "$ALICI" >/dev/null || { log "HATA: alıcı dizini kullanılamıyor — yedek ALINMADI"; return 1; }
}

# Tam tur: merkez + anahtar arşivi + HAZIR her tesis. Tesis dökümü hatası öteki tesisi durdurmaz (tur hatalı biter).
yedekle() {
  damga=$(date -u +%Y%m%d_%H%M%S)
  arsiv="$Y/.anahtarlar_${damga}.tar.part"
  alici_hazir || return 1
  liste=$(hazir_tesisler) || { log "HATA: tesis listesi okunamadı (merkez)"; return 1; }
  dokum "$DB_ADI" "patron_${damga}.dump.tkenc" "patron_${damga}" || return 1
  tar -C "$ANAHTAR" -cf "$arsiv" . || { log "HATA: anahtar dizini arşivlenemedi"; return 1; }
  node "$ARAC" sifrele --girdi "$arsiv" --cikti "$Y/anahtarlar_${damga}.tar.tkenc" --anahtar-dizini "$ALICI" --duzu-sil || { log "HATA: anahtar arşivi şifrelenemedi"; return 1; }
  hata=0
  adet=0
  for satir in $(echo "$liste" | tr ' ' ':'); do
    tesis=${satir%%:*}
    db=${satir#*:}
    if dokum "$db" "tesis_${tesis}_${damga}.dump.tkenc" "tesis_${tesis}_${damga}"; then adet=$((adet + 1)); else hata=1; fi
  done
  log "tamam: patron_${damga}.dump.tkenc + anahtarlar_${damga}.tar.tkenc + ${adet} tesis dökümü"
  return $hata
}

# Tek tesisin anlık dökümü (yalnız HAZIR tesis; ad merkezden).
tesis_yedekle() {
  case "$1" in
    *[!0-9a-f-]* | "") echo "tesis kimliği UUID olmalı (küçük harf)" >&2; return 2 ;;
  esac
  alici_hazir || return 1
  db=$(merkez_sorgu "SELECT database_name FROM facility_databases WHERE tesis_id = '$1'::uuid AND status = 'HAZIR'") || return 1
  if [ -z "$db" ]; then log "HATA: tesis $1 HAZIR değil (yok ya da imha edildi)"; return 1; fi
  damga=$(date -u +%Y%m%d_%H%M%S)
  dokum "$db" "tesis_${1}_${damga}.dump.tkenc" "tesis_${1}_${damga}" && log "tamam: tesis_${1}_${damga}.dump.tkenc"
}

# $1 = dosya deseni, $2 = en az kopya: en yeni $2 korunur, kalanlardan YEDEK_SAKLA_GUN'den eskiler silinir.
buda() {
  simdi=$(date +%s)
  ls -1t "$Y"/$1 2>/dev/null | tail -n +$(($2 + 1)) | while read -r f; do
    gun=$(( (simdi - $(stat -c %Y "$f")) / 86400 ))
    if [ "$gun" -ge "$YEDEK_SAKLA_GUN" ]; then
      rm -f -- "$f"
      log "budandı: $(basename "$f") (${gun} gün)"
    fi
  done
}

# Tesis dökümleri tesis başına: HAZIR tesis en az YEDEK_EN_AZ kopya; listede olmayan (imha edilmiş) tesis 0.
buda_tesisler() {
  liste=$(hazir_tesisler) || { log "UYARI: tesis listesi okunamadı — tesis dökümleri bu tur budanmadı"; return 0; }
  hazir=$(echo "$liste" | cut -d ' ' -f 1)
  for t in $(ls -1 "$Y" 2>/dev/null | sed -n 's/^tesis_\([0-9a-f-]*\)_[0-9_]*\.dump\.tkenc$/\1/p' | sort -u); do
    if echo "$hazir" | grep -qx "$t"; then buda "tesis_${t}_*.dump.tkenc" "$YEDEK_EN_AZ"; else buda "tesis_${t}_*.dump.tkenc" 0; fi
  done
}

tur() {
  rm -f "$Y"/.*.part
  if yedekle; then
    sonuc=0
  else
    sonuc=$?
    rm -f "$Y"/.*.part
    # Merkez dökümü alınamadıysa budama YOK (son iyi yedek korunur); yalnız tesis hatasında budama sürer.
    [ -f "$Y/patron_${damga}.dump.tkenc" ] || return 1
  fi
  buda 'patron_*.dump.tkenc' "$YEDEK_EN_AZ"
  buda 'anahtarlar_*.tar.tkenc' "$YEDEK_EN_AZ"
  buda_tesisler
  return $sonuc
}

case "${1:-dongu}" in
  tek)
    tur
    ;;
  tesis)
    rm -f "$Y"/.*.part
    tesis_yedekle "${2:-}"
    ;;
  dongu)
    log "başladı: aralık ${YEDEK_ARALIK_SAAT} sa · saklama ${YEDEK_SAKLA_GUN} gün · en az ${YEDEK_EN_AZ} kopya"
    while :; do
      if [ "$(en_yeni_yas 'patron_*.dump.tkenc')" -ge $((YEDEK_ARALIK_SAAT * 3600)) ]; then
        tur || log "yedek bu turda alınamadı — bir saat sonra yeniden"
      fi
      sleep 3600
    done
    ;;
  *)
    echo "kullanım: yedek-dongusu.sh [dongu|tek|tesis <tesisId>]" >&2
    exit 2
    ;;
esac
