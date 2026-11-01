#!/usr/bin/env bash
# =============================================================================
# TeksERP — ÇEKME KAPISI (müşteri VDS'i, authorized_keys `command=`) · denetim 2026-11-01 K2
# =============================================================================
# Yedek VDS'inin anahtarı yalnız bu komutu koşturur: istemcinin istediği rsync komutu `rrsync -ro`dan geçer
# (yalnız gönderici kip, yalnız çıkış dizini; yazma/silme/kabuk YOK). Başarılı her çekimden sonra damga yazılır;
# barındırma kontrol betiği "son çekim yaşı"nı buradan ölçer (çekimi yedek VDS başlatır, müşteri VDS'i başka
# türlü bilemez). Ele geçirilmiş müşteri VDS'i bu yoldan uzak kopyaya ulaşamaz: bağlantı hep yedek VDS'ten gelir.
#
# authorized_keys satırı (tek satır):
#   command="/usr/local/sbin/tekserp-cek-kapisi",restrict ssh-ed25519 AAAA... yedek-vds
# Ortam (betiğin başında sabit; SSH ortamından ALINMAZ): CIKIS_DIZIN · DAMGA · RRSYNC
# =============================================================================
set -u
export LC_ALL=C
CIKIS_DIZIN="${TEKSERP_CEK_CIKIS:-/srv/tekserp-cikis}"
DAMGA="${TEKSERP_CEK_DAMGA:-/var/lib/tekserp-cek/son-cekim}"
RRSYNC="${TEKSERP_CEK_RRSYNC:-}"
if [ -n "${SSH_CONNECTION:-}" ]; then
  # Gerçek SSH oturumunda yollar SABİTTİR (istemci ortam taşıyamaz ama savunma iki katlı olsun).
  CIKIS_DIZIN=/srv/tekserp-cikis; DAMGA=/var/lib/tekserp-cek/son-cekim; RRSYNC=""
fi
if [ -z "$RRSYNC" ]; then
  for r in /usr/bin/rrsync /usr/local/bin/rrsync; do [ -x "$r" ] && RRSYNC="$r" && break; done
fi
[ -n "$RRSYNC" ] && [ -x "$RRSYNC" ] || { echo "cek-kapisi: rrsync bulunamadı (rsync >= 3.2.4)" >&2; exit 2; }
case "${SSH_ORIGINAL_COMMAND:-}" in
  "rsync --server --sender "*) ;;
  *) echo "cek-kapisi: yalnız rsync çekimi kabul edilir" >&2; exit 2 ;;
esac

"$RRSYNC" -ro -no-del "$CIKIS_DIZIN"
KOD=$?
if [ "$KOD" -eq 0 ]; then date +%s > "$DAMGA.yeni" 2>/dev/null && mv -f "$DAMGA.yeni" "$DAMGA" 2>/dev/null; fi
exit "$KOD"
