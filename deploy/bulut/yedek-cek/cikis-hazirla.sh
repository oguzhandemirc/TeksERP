#!/usr/bin/env bash
# =============================================================================
# TeksERP — ÇIKIŞ DİZİNİ HAZIRLAYICI (müşteri VDS'i, root, zamanlayıcıyla) · denetim 2026-11-01 K2
# =============================================================================
# Yedek birimindeki YALNIZ şifreli gece yedeklerini (`*.dump.tkenc`, TKENC sihirli baytıyla) ayrı bir çıkış
# dizinine KOPYALAR; yedek VDS'i yalnız bu dizini salt-okur çeker (cek-kapisi.sh). Neden ayrı dizin: çekme
# anahtarı düz `.dump`a, premigrate dökümlerine ya da anahtar dizinine hiçbir koşulda ulaşamasın.
# Kaynağa DOKUNMAZ (silmez, değiştirmez). Çıkış dizininde ÇIKIS_SAKLAMA_GUN'den eski kopyalar silinir
# (en yeni CIKIS_EN_AZ korunur) — uzun saklama yedek VDS'tedir.
#
# Kullanım: cikis-hazirla.sh --kaynak <yedek birimi> [--cikis /srv/tekserp-cikis] [--grup tekserp-cek]
#           (--grup "" grup atamaz — yalnız yerel prova)
# Ortam:    CIKIS_SAKLAMA_GUN (7) · CIKIS_EN_AZ (3)
# Çıkış:    0 tamam · 2 yapılandırma · 3 kopya hatası. Kurulum: docs/ops/BULUT-YEDEK-CEKME.md
# =============================================================================
set -u
export LC_ALL=C
umask 027

KAYNAK=""
CIKIS="/srv/tekserp-cikis"
GRUP="tekserp-cek"
SAKLAMA="${CIKIS_SAKLAMA_GUN:-7}"
ENAZ="${CIKIS_EN_AZ:-3}"
while [ $# -gt 0 ]; do
  case "$1" in
    --kaynak) KAYNAK="${2:-}"; shift 2 ;;
    --cikis) CIKIS="${2:-}"; shift 2 ;;
    --grup) GRUP="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "tanınmayan argüman: $1" >&2; exit 2 ;;
  esac
done

log() { printf '%s cikis-hazirla %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
if [ -z "$KAYNAK" ] || [ ! -d "$KAYNAK" ]; then log "HATA kaynak dizini yok: ${KAYNAK:-?}"; exit 2; fi
if [ -z "$CIKIS" ] || [ "$CIKIS" = "/" ]; then log "HATA çıkış dizini geçersiz"; exit 2; fi
case "$(cd "$CIKIS" 2>/dev/null && pwd -P)/" in
  "$(cd "$KAYNAK" && pwd -P)/"*) log "HATA çıkış dizini kaynağın içinde olamaz"; exit 2 ;;
esac
mkdir -p "$CIKIS" || { log "HATA çıkış dizini yaratılamadı: $CIKIS"; exit 2; }

# TKENC sihirli baytı: "TKSENC\0\1" (src/lib/backup-crypto/format.ts TKENC_MAGIC).
SIHIR="544b53454e430001"
# Yalnız gece öneği (`tekserp…`); premigrate_/pre-restore_ dökümleri çıkışa hiç girmez.
AD_DESENI='^tekserp[a-z0-9_]*_[0-9]{8}_[0-9]{6}\.dump\.tkenc$'
sihirli() { [ "$(head -c 8 "$1" 2>/dev/null | od -An -tx1 | tr -d ' \n')" = "$SIHIR" ]; }

# Saklamadan eski kaynak yalnız en yeni ENAZ içindeyse kopyalanır; yoksa her koşum onu kopyalayıp
# aynı koşumun saklaması siler (kaynak 30 gün, çıkış 7 gün tutar) — boşa disk yazımı + geçici şişme.
# shellcheck disable=SC2010 # adlar sıkı desenle süzülür
EN_YENI=$(ls -1t "$KAYNAK" 2>/dev/null | grep -E "$AD_DESENI" | head -n "$ENAZ")
HATA=0
YENI=0
for yol in "$KAYNAK"/*.dump.tkenc; do
  [ -f "$yol" ] || continue
  [ -L "$yol" ] && continue
  ad=$(basename "$yol")
  printf '%s\n' "$ad" | grep -Eq "$AD_DESENI" || continue
  [ -e "$CIKIS/$ad" ] && continue
  if [ -n "$(find "$yol" -maxdepth 0 -mtime +"$SAKLAMA" 2>/dev/null)" ] \
     && ! printf '%s\n' "$EN_YENI" | grep -Fqx "$ad"; then continue; fi
  if ! sihirli "$yol"; then log "UYARI sihirli bayt yok, kopyalanmadı: $ad"; continue; fi
  if cp -p "$yol" "$CIKIS/.$ad.part" && { [ -z "$GRUP" ] || chgrp "$GRUP" "$CIKIS/.$ad.part"; } && chmod 0640 "$CIKIS/.$ad.part" \
     && mv -f "$CIKIS/.$ad.part" "$CIKIS/$ad"; then
    YENI=$((YENI + 1))
  else
    rm -f "$CIKIS/.$ad.part"; HATA=1; log "HATA kopyalanamadı: $ad"
  fi
done

# Saklama: yalnız kendi desenine uyan kopyalar; en yeni ENAZ yaşına bakılmaksızın korunur.
# shellcheck disable=SC2010 # adlar sıkı desenle (yalnız [a-z0-9_]) süzülür; boşluk/yeni satırlı ad eşleşmez
ls -1t "$CIKIS" 2>/dev/null | grep -E "$AD_DESENI" | tail -n +"$((ENAZ + 1))" | while read -r ad; do
  if [ -n "$(find "$CIKIS/$ad" -maxdepth 0 -mtime +"$SAKLAMA" 2>/dev/null)" ]; then
    rm -f "$CIKIS/$ad" && log "saklama: silindi $ad"
  fi
done

if [ -z "$GRUP" ] || chgrp "$GRUP" "$CIKIS"; then chmod 0750 "$CIKIS"; fi
log "tamam: $YENI yeni şifreli yedek çıkışa kondu"
[ "$HATA" -eq 0 ] || exit 3
exit 0
