#!/usr/bin/env bash
# =============================================================================
# Satıcı portal JWKS ÇIKIŞI — DOCKER-USER + INPUT kuralları (VDS'te root; `tekserp-satici-jwks-cikis@<ortam>` birimi çağırır)
# =============================================================================
# Yan konteyner `satici-jwks` (docker-compose.portal-genel.yml) internal OLMAYAN `jwks-cikis` ağına katılır; bu betik o
# ağın çıkışını YALNIZ şuna daraltır (Docker köprü trafiğinde ufw'yi ATLAR → kural DOCKER-USER'da). Taban
# PORTAL-GENEL-ERISIM.md §5'in üç kuralıdır; özel ağ ve VDS sedleri bildirim-cikis.sh ile aynıdır:
#   1) DNS (udp/tcp 53) — Docker'ın gömülü çözücüsü ana makinenin üst çözücülerine konteynerin ad alanından sorar
#   2) özel/iç ağlara (10/8 · 172.16/12 · 192.168/16 · 100.64/10 tailnet · 169.254/16) başka HİÇBİR yeni bağlantı
#   3) internete YALNIZ tcp/443 (https://<takım>.cloudflareaccess.com/cdn-cgi/access/certs)
#   4) başka her YENİ dış bağlantı düşer; VDS'in kendisine (köprü ağ geçidi, INPUT) yeni bağlantı düşer
# Yanıt paketleri (ESTABLISHED) serbest. İdempotent: önce bu betiğin kurallarını SİLER, sonra sırayla koyar.
# Kullanım: jwks-cikis.sh <compose dizini> [kaldir]
# =============================================================================
set -euo pipefail
DIZIN=${1:?kullanım: jwks-cikis.sh <compose dizini> [kaldir]}
KIP=${2:-uygula}
cd "$DIZIN"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
: "${JWKS_CIKIS_AGI:?JWKS_CIKIS_AGI gerekli}"
OZEL=(10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16)
AG=$JWKS_CIKIS_AGI

sil() { local z=$1; shift; while iptables -C "$z" "$@" 2>/dev/null; do iptables -D "$z" "$@"; done; }
koy() { local z=$1; shift; iptables -I "$z" 1 "$@"; }

# Kural kümesi TEK yerde: sil ve koy aynı listeyi kullanır. `koy` en üste ekler → liste SONDAN BAŞA eklenir.
kurallar() {
  local f=$1
  $f INPUT -s "$AG" -m conntrack --ctstate NEW -j DROP
  $f DOCKER-USER -s "$AG" -m conntrack --ctstate NEW -j DROP
  $f DOCKER-USER -s "$AG" -p tcp --dport 443 -m conntrack --ctstate NEW -j RETURN
  for c in "${OZEL[@]}"; do $f DOCKER-USER -s "$AG" -d "$c" -j DROP; done
  # DNS durumsuz (bildirim-cikis.sh gibi): özel ağ sedlerinden ÖNCE gelir, yanıt/yeniden deneme düşmesin
  $f DOCKER-USER -s "$AG" -p udp --dport 53 -j RETURN
  $f DOCKER-USER -s "$AG" -p tcp --dport 53 -j RETURN
}

kurallar sil
if [ "$KIP" = "kaldir" ]; then
  echo "jwks çıkışı: kurallar kaldırıldı ($AG)"
  exit 0
fi
kurallar koy
echo "jwks çıkışı: $AG → yalnız DNS + tcp/443; özel ağlar ve VDS'in kendisi KAPALI"
iptables -S DOCKER-USER | grep -F -- "$AG" || true
