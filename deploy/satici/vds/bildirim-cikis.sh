#!/usr/bin/env bash
# =============================================================================
# Satıcı bildirim ÇIKIŞI — DOCKER-USER + INPUT kuralları (VDS'te root; `tekserp-satici-bildirim-cikis@<ortam>` birimi çağırır)
# =============================================================================
# Yan konteyner `satici-bildirim` (docker-compose.bildirim.yml) internal OLMAYAN `bildirim-cikis` ağına katılır;
# bu betik o ağın çıkışını YALNIZ şuna daraltır (Docker yayımlı/köprü trafiğinde ufw'yi ATLAR → kural DOCKER-USER'da):
#   1) sabit DNS çözücülerine (compose `dns:` — BILDIRIM_DNS_1/2) udp/tcp 53
#   2) özel/iç ağlara (10/8 · 172.16/12 · 192.168/16 · 100.64/10 tailnet · 169.254/16) HİÇBİR yeni bağlantı
#   3) internete YALNIZ tcp/443 (api.telegram.org · api.resend.com)
#   4) başka her YENİ dış bağlantı düşer; VDS'in kendisine (köprü ağ geçidi, INPUT) yeni bağlantı düşer
# Yanıt paketleri (ESTABLISHED) serbest. İdempotent: önce bu betiğin kurallarını SİLER, sonra sırayla koyar
# (yarım kalmış bir koşum sırayı bozmasın). Kullanım: bildirim-cikis.sh <compose dizini> [kaldir]
# =============================================================================
set -euo pipefail
DIZIN=${1:?kullanım: bildirim-cikis.sh <compose dizini> [kaldir]}
KIP=${2:-uygula}
cd "$DIZIN"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
: "${BILDIRIM_CIKIS_AGI:?BILDIRIM_CIKIS_AGI gerekli}"
DNS1=${BILDIRIM_DNS_1:-1.1.1.1}
DNS2=${BILDIRIM_DNS_2:-9.9.9.9}
OZEL=(10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16)
AG=$BILDIRIM_CIKIS_AGI

sil() { local z=$1; shift; while iptables -C "$z" "$@" 2>/dev/null; do iptables -D "$z" "$@"; done; }
koy() { local z=$1; shift; iptables -I "$z" 1 "$@"; }

# Kural kümesi TEK yerde: sil ve koy aynı listeyi kullanır. `koy` en üste ekler → liste SONDAN BAŞA eklenir.
kurallar() {
  local f=$1
  $f INPUT -s "$AG" -m conntrack --ctstate NEW -j DROP
  $f DOCKER-USER -s "$AG" -m conntrack --ctstate NEW -j DROP
  $f DOCKER-USER -s "$AG" -p tcp --dport 443 -m conntrack --ctstate NEW -j RETURN
  for c in "${OZEL[@]}"; do $f DOCKER-USER -s "$AG" -d "$c" -j DROP; done
  for d in "$DNS1" "$DNS2"; do
    $f DOCKER-USER -s "$AG" -d "$d/32" -p udp --dport 53 -j RETURN
    $f DOCKER-USER -s "$AG" -d "$d/32" -p tcp --dport 53 -j RETURN
  done
}

kurallar sil
if [ "$KIP" = "kaldir" ]; then
  echo "bildirim çıkışı: kurallar kaldırıldı ($AG)"
  exit 0
fi
kurallar koy
echo "bildirim çıkışı: $AG → yalnız DNS ($DNS1, $DNS2) + tcp/443; özel ağlar ve VDS'in kendisi KAPALI"
iptables -S DOCKER-USER | grep -F -- "$AG" || true
