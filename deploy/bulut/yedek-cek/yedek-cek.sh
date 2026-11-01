#!/usr/bin/env bash
# =============================================================================
# TeksERP — MAKİNE DIŞI YEDEK ÇEKİCİ (yedek VDS'i, kendi kullanıcısıyla, zamanlayıcıyla) · denetim 2026-11-01 K2
# =============================================================================
# ÇEKME MODELİ: bağlantıyı yedek VDS açar, müşteri VDS'inden YALNIZ şifreli yedekleri (`*.dump.tkenc`) alır.
# Müşteri VDS'inde bu sunucuya giden hiçbir kimlik yoktur → orayı ele geçiren uzak kopyayı silemez/ezemez.
#   · kaynak silinmez (rsync silme bayrağı YOK; karşı tarafta rrsync -ro -no-del)
#   · var olan kopya EZİLMEZ (--ignore-existing): kaynakta aynı adla bozulmuş dosya eskisini bozamaz
#   · zaman damgası kaynaktan ALINMAZ (geliş anı): kaynak sahte tarihle saklamayı kandıramaz
#   · ad deseni + TKENC sihirli baytı tutmayan dosya karantinaya gider (düz döküm saklanmaz)
#   · saklama: SAKLAMA_GUN'den eski kopya silinir, en yeni EN_AZ yaşına bakılmaksızın korunur
# Düz `.dump` hiçbir koşulda çekilmez (süzgeç burada, çıkış dizini müşteri tarafında ayrıca yalnız .tkenc tutar).
#
# Kullanım:
#   yedek-cek.sh --kaynak tekserp-cek@<müşteri-vds>: --hedef /srv/yedek-cekilen/<musteri> [--anahtar ~/.ssh/cek_<musteri>] [--port 2222]
#   yedek-cek.sh --kaynak /yerel/dizin/ --hedef /tmp/h            # yerel prova (ssh'siz)
#   yedek-cek.sh ... --kuru                                         # hiçbir şey yazmadan ne çekileceğini listeler
# Ortam: SAKLAMA_GUN (90) · EN_AZ (14) · AZAMI_SAAT (26) · AZAMI_BOYUT (20G) · CEK_ZAMAN_ASIMI (600 sn)
# Çıkış: 0 tamam · 2 yapılandırma · 3 çekim başarısız · 4 son yeni şifreli yedek AZAMI_SAAT'ten eski · 5 kilitli
# Günlük: <hedef>/.cekim.log · damga <hedef>/.son-cekim (epoch). Kurulum: docs/ops/BULUT-YEDEK-CEKME.md
# =============================================================================
set -u
export LC_ALL=C
umask 077

KAYNAK=""
HEDEF=""
ANAHTAR=""
PORT=""
KURU=0
SAKLAMA="${SAKLAMA_GUN:-90}"
ENAZ="${EN_AZ:-14}"
AZAMI_SAAT="${AZAMI_SAAT:-26}"
AZAMI_BOYUT="${AZAMI_BOYUT:-20G}"
ZAMAN_ASIMI="${CEK_ZAMAN_ASIMI:-600}"
while [ $# -gt 0 ]; do
  case "$1" in
    --kaynak) KAYNAK="${2:-}"; shift 2 ;;
    --hedef) HEDEF="${2:-}"; shift 2 ;;
    --anahtar) ANAHTAR="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --kuru) KURU=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "tanınmayan argüman: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$KAYNAK" ] || [ -z "$HEDEF" ]; then echo "--kaynak ve --hedef zorunlu" >&2; exit 2; fi
[ "$HEDEF" != "/" ] || { echo "hedef / olamaz" >&2; exit 2; }
command -v rsync >/dev/null 2>&1 || { echo "rsync yok" >&2; exit 2; }
mkdir -p "$HEDEF/karantina" || exit 2
LOG="$HEDEF/.cekim.log"
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; printf '%s\n' "$*"; }

KILIT="$HEDEF/.cekim.kilit"
if ! mkdir "$KILIT" 2>/dev/null; then log "HATA başka çekim sürüyor ($KILIT)"; exit 5; fi
trap 'rmdir "$KILIT" 2>/dev/null' EXIT

AD_DESENI='^tekserp[a-z0-9_]*_[0-9]{8}_[0-9]{6}\.dump\.tkenc$'
SIHIR="544b53454e430001"
sihirli() { [ "$(head -c 8 "$1" 2>/dev/null | od -An -tx1 | tr -d ' \n')" = "$SIHIR" ]; }

RSYNC_ARGS=(-r --ignore-existing --no-links --timeout="$ZAMAN_ASIMI" --max-size="$AZAMI_BOYUT"
  --include='*.dump.tkenc' --exclude='*' --out-format='%n')
case "$KAYNAK" in
  /*) [ -d "$KAYNAK" ] || { log "HATA yerel kaynak yok: $KAYNAK"; exit 2; }
      KAYNAK="${KAYNAK%/}/" ;;
  *:*) SSH_KOMUT=(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=30)
       [ -n "$ANAHTAR" ] && SSH_KOMUT+=(-i "$ANAHTAR" -o IdentitiesOnly=yes)
       [ -n "$PORT" ] && SSH_KOMUT+=(-p "$PORT")
       [ -n "${CEK_SSH_KOMUTU:-}" ] && SSH_KOMUT=("$CEK_SSH_KOMUTU")
       RSYNC_ARGS+=(-e "${SSH_KOMUT[*]}") ;;
  *) log "HATA kaynak biçimi: 'kullanici@sunucu:' ya da mutlak yerel dizin"; exit 2 ;;
esac
[ "$KURU" -eq 1 ] && RSYNC_ARGS+=(--dry-run)

ONCE=$(find "$HEDEF" -maxdepth 1 -type f -name '*.dump.tkenc' | wc -l | tr -d ' ')
if ! CIKTI=$(rsync "${RSYNC_ARGS[@]}" "$KAYNAK" "$HEDEF/" 2>&1); then
  log "HATA cekim basarisiz: $(printf '%s' "$CIKTI" | tail -n 3 | tr '\n' ' ')"
  exit 3
fi
if [ "$KURU" -eq 1 ]; then
  log "kuru: cekilecek dosyalar: $(printf '%s\n' "$CIKTI" | grep -E '\.dump\.tkenc$' | tr '\n' ' ')"
  exit 0
fi

# Gelen dosyaları süz: ad deseni ve sihirli bayt tutmayan karantinaya (silinmez — inceleme için).
YENI=0
while read -r ad; do
  if [ -z "$ad" ] || [ ! -f "$HEDEF/$ad" ]; then continue; fi
  if printf '%s\n' "$ad" | grep -Eq "$AD_DESENI" && sihirli "$HEDEF/$ad"; then chmod 0400 "$HEDEF/$ad"; YENI=$((YENI + 1))
  else mv -f "$HEDEF/$ad" "$HEDEF/karantina/" && log "UYARI karantina: $ad (ad/sihirli bayt tutmadı)"; fi
done < <(printf '%s\n' "$CIKTI" | grep -E '\.dump\.tkenc$')
date +%s > "$HEDEF/.son-cekim"

# Saklama (yalnız kendi desenine uyanlar); en yeni ENAZ yaşına bakılmaksızın korunur.
# shellcheck disable=SC2010 # adlar sıkı desenle (yalnız [a-z0-9_]) süzülür; boşluk/yeni satırlı ad eşleşmez
ls -1t "$HEDEF" | grep -E "$AD_DESENI" | tail -n +"$((ENAZ + 1))" | while read -r ad; do
  if [ -n "$(find "$HEDEF/$ad" -maxdepth 0 -mtime +"$SAKLAMA" 2>/dev/null)" ]; then
    rm -f "$HEDEF/$ad" && log "saklama: silindi $ad"
  fi
done

SONRA=$(find "$HEDEF" -maxdepth 1 -type f -name '*.dump.tkenc' | wc -l | tr -d ' ')
# shellcheck disable=SC2010 # aynı gerekçe: desen yalnız [a-z0-9_.] ad kabul eder
SON=$(ls -1t "$HEDEF" | grep -E "$AD_DESENI" | head -n 1)
if [ -z "$SON" ]; then log "HATA YEDEK_YOK hedefte hic sifreli yedek yok"; exit 4; fi
YAS_SAAT=$(( ( $(date +%s) - $(date -r "$HEDEF/$SON" +%s) ) / 3600 ))
log "OK cekim: $YENI yeni (once $ONCE, sonra $SONRA); en yeni $SON $YAS_SAAT saat once geldi"
if [ "$YAS_SAAT" -gt "$AZAMI_SAAT" ]; then log "HATA YEDEK_ESKI en yeni sifreli yedek $YAS_SAAT saat once geldi (<= $AZAMI_SAAT)"; exit 4; fi
exit 0
