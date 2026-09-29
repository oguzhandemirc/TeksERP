#!/usr/bin/env bash
# =============================================================================
# Satıcı tailnet hazırlığı — VDS'te root olarak, `tekserp-satici-tailnet@<ortam>` birimi çağırır.
# =============================================================================
# İdempotent; her açılışta ve elle yeniden koşulabilir:
#   1) tailscale0 üzerinde .env'deki TAILNET_IP görünene dek bekler (en çok 300 sn) — başka bir
#      adres ya da hiç adres yoksa DURUR (portal yanlış arayüze yayımlanmasın).
#   2) DOCKER-USER zinciri (Docker yayımlı portlarda ufw'yi ATLAR, kural bu zincirde olmalı):
#      · satıcının tailnet portuna YALNIZ tailscale0'dan gelinir (eth0'dan gelen DNAT'lı paket düşer)
#      · satıcının tailnet köprüsünden YENİ dış bağlantı açılmaz (yanıt paketleri serbest)
#   3) `docker compose up -d` — açılışta Tailscale Docker'dan geç geldiyse bağlanamayan konteyneri kaldırır.
# Kullanım: tailnet-hazirla.sh /opt/stack/apps/tekserp-satici-<ortam>
# =============================================================================
set -euo pipefail
DIZIN=${1:?kullanım: tailnet-hazirla.sh <compose dizini>}
cd "$DIZIN"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
: "${TAILNET_IP:?}" "${TAILNET_KONTEYNER_IP:?}" "${TAILNET_AGI:?}"

bekle=0
until ip -4 -o addr show dev tailscale0 2>/dev/null | grep -q " ${TAILNET_IP}/"; do
  bekle=$((bekle + 1))
  if [ "$bekle" -ge 300 ]; then
    echo "tailscale0 üzerinde ${TAILNET_IP} yok (300 sn) — portal YAYIMLANMADI" >&2
    exit 1
  fi
  sleep 1
done

kural() { iptables -C DOCKER-USER "$@" 2>/dev/null || iptables -I DOCKER-USER 1 "$@"; }
kural -d "${TAILNET_KONTEYNER_IP}/32" -p tcp --dport 4611 ! -i tailscale0 -j DROP
kural -s "${TAILNET_AGI}" -m conntrack --ctstate NEW -j DROP

docker compose up -d
echo "tailnet hazır: ${TAILNET_IP}:${TAILNET_PORT:-4611} → ${TAILNET_KONTEYNER_IP}:4611 · DOCKER-USER kuralları yerinde"
