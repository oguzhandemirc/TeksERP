#!/bin/sh
# =============================================================================
# TeksERP — GECE YEDEĞİ (Linux/Docker ikizi: deploy/yedekle.ps1) · compose servisi `yedek`
# =============================================================================
# NEDEN AYRI SERVİS: backend zamanlayıcısı imajda KAPALI (BACKUP_SCHEDULE_ENABLED=false);
# bağımsız süreç backend çökmüşken de yedek alır. İkisi birden açık kalırsa gece iki döküm.
# AKIŞ: pg_dump -Fc → `<ad>.dump.part` → pg_restore --list → [ŞİFRELE .tkenc] → nihai ad →
#   saklama (YEDEK_SAKLAMA_GUN günden eski silinir, en yeni YEDEK_EN_AZ korunur).
# ŞİFRELEME: BACKUP_KEY_DIR (imajda beyanlı) içinde `*.tkpub` alıcı varsa dist/tools/
#   yedek-sifrele.cjs ile şifrelenir, düz döküm silinir. Alıcı yok / şifreleme düşerse düz
#   yedek KORUNUR (yedeksiz kalmaktan iyidir) ve günlüğe HATA yazılır (çıkış 3).
# ZAMAN: YEDEK_SAAT (SS:DD, Europe/Istanbul) geçmiş ve bugün koşmamışsa koşar — kaçırılan
#   yedek açılışta telafi edilir; damga işin BAŞINDA yazılır (düşen yedek 5 dk'da bir
#   yeniden denenip günlüğü doldurmasın). İlk denetim YEDEK_ILK_BEKLEME sn sonra (backend
#   migration'ı bitsin; ilk kurulumda boş şemanın dökümü alınmasın). YEDEK_SIMDI=1 → tek yedek al ve çık.
# KİMLİK: PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (compose verir; parola günlüğe GİRMEZ).
# =============================================================================
set -u
umask 077  # döküm fabrika verisidir: yalnız servis kullanıcısı okur
DIR="${BACKUP_DIR:?BACKUP_DIR tanımsız}"
KEYDIR="${BACKUP_KEY_DIR:-}"
SAAT="${YEDEK_SAAT:-03:00}"
SAKLAMA="${YEDEK_SAKLAMA_GUN:-30}"
ENAZ="${YEDEK_EN_AZ:-3}"
ARAC=/app/dist/tools/yedek-sifrele.cjs
LOG="$DIR/backup.log"
DAMGA="$DIR/.son-yedek-gunu"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

case "${PGDATABASE:?PGDATABASE tanımsız}" in
  tekserp|tekserp_*) ONEK="$PGDATABASE" ;;
  *) ONEK="tekserp_$PGDATABASE" ;;
esac

sakla() {
  # YALNIZ kendi desenine dokunur: premigrate_/pre-restore_/elle getirilenler silinmez.
  ls -1t "$DIR" 2>/dev/null | grep -E "^${ONEK}_[0-9]{8}_[0-9]{6}\.dump(\.tkenc)?$" | tail -n +"$((ENAZ + 1))" |
    while read -r f; do
      if [ -n "$(find "$DIR/$f" -maxdepth 0 -mtime +"$SAKLAMA" 2>/dev/null)" ]; then
        rm -f "$DIR/$f" && log "saklama: silindi $f"
      fi
    done
}

yedek_al() {
  AD="${ONEK}_$(date +%Y%m%d_%H%M%S).dump"
  HEDEF="$DIR/$AD"
  YARIM="$HEDEF.part"
  if ! pg_dump -Fc -f "$YARIM" >/tmp/yedek.err 2>&1; then
    rm -f "$YARIM"; log "HATA pg_dump: $(head -c 400 /tmp/yedek.err)"; return 1
  fi
  if ! pg_restore --list "$YARIM" >/dev/null 2>/tmp/yedek.err; then
    rm -f "$YARIM"; log "HATA dogrulama (pg_restore --list) - bozuk dokum SILINDI: $(head -c 400 /tmp/yedek.err)"; return 1
  fi
  SIFRE_HATA=""
  if [ -n "$KEYDIR" ]; then
    if [ ! -d "$KEYDIR" ]; then SIFRE_HATA="anahtar dizini yok: $KEYDIR"
    elif ! ls "$KEYDIR"/*.tkpub >/dev/null 2>&1; then SIFRE_HATA="anahtar dizininde alici (*.tkpub) yok: $KEYDIR"
    elif node "$ARAC" sifrele --girdi "$YARIM" --cikti "$HEDEF.tkenc" --anahtar-dizini "$KEYDIR" >/tmp/yedek.err 2>&1 \
         && [ -f "$HEDEF.tkenc" ]; then
      rm -f "$YARIM"; HEDEF="$HEDEF.tkenc"; AD="$AD.tkenc"
    else SIFRE_HATA="sifreleme basarisiz: $(head -c 400 /tmp/yedek.err)"
    fi
  fi
  [ -f "$YARIM" ] && mv -f "$YARIM" "$HEDEF"
  BOYUT=$(du -k "$HEDEF" | cut -f1)
  case "$AD" in *.tkenc) log "OK $AD (${BOYUT} KB, dogrulandi, sifreli)" ;; *) log "OK $AD (${BOYUT} KB, dogrulandi)" ;; esac
  sakla
  if [ -n "$SIFRE_HATA" ]; then log "HATA SIFRELENEMEDI - duz yedek korundu: $SIFRE_HATA"; return 3; fi
  return 0
}

mkdir -p "$DIR"
if [ "${YEDEK_SIMDI:-0}" = "1" ]; then yedek_al; exit $?; fi

HEDEF_DK=$(echo "$SAAT" | awk -F: '{ print ($1 * 60) + $2 }')
log "zamanlayici acik - hedef saat $SAAT, saklama $SAKLAMA gun (en az $ENAZ), sifreleme $( [ -n "$KEYDIR" ] && echo beyanli || echo kapali )"
sleep "${YEDEK_ILK_BEKLEME:-120}"
while :; do
  BUGUN=$(date +%Y%m%d)
  SIMDI_DK=$(( $(date +%-H) * 60 + $(date +%-M) ))
  if [ "$SIMDI_DK" -ge "$HEDEF_DK" ] && [ "$(cat "$DAMGA" 2>/dev/null)" != "$BUGUN" ]; then
    echo "$BUGUN" > "$DAMGA"
    yedek_al || true
  fi
  sleep 300
done
