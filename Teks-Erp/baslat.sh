#!/usr/bin/env bash
# =============================================================================
# TeksERP - Tek tuşla başlat
# =============================================================================
# Bu script şunları otomatik yapar:
#   1. Docker yüklü/çalışıyor mu kontrol eder
#   2. İlk seferse .env.docker oluşturur (rastgele şifre + JWT secret)
#   3. Container'ları build edip arka planda başlatır
#   4. Migration + seed entrypoint içinde otomatik çalışır
#   5. Sunucu hazır olunca erişim adreslerini yazar
#
# Tekrar çalıştırınca: kodda değişiklik varsa rebuild eder, yoksa hızlıca açar.
# =============================================================================

set -e

cd "$(dirname "$0")"

echo ""
echo "================================================================"
echo "  TeksERP Backend - Docker ile başlatma"
echo "================================================================"

# --- 1) Docker var mı? ---
if ! command -v docker >/dev/null 2>&1; then
  echo "X Docker yüklü değil."
  echo ""
  echo "Mac:     https://docs.docker.com/desktop/install/mac-install/"
  echo "Windows: https://docs.docker.com/desktop/install/windows-install/"
  echo "Linux:   https://docs.docker.com/engine/install/"
  echo ""
  echo "Kurulum sonrası bu script'i tekrar çalıştır."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "X Docker servisi çalışmıyor. Docker Desktop'ı aç ve tekrar dene."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "X 'docker compose' komutu bulunamadı. Docker güncel sürüm kur."
  exit 1
fi

echo "✓ Docker hazır."

# --- 2) .env.docker yoksa otomatik üret ---
if [ ! -f .env.docker ]; then
  echo ""
  echo "İlk kurulum: .env.docker üretiliyor..."

  if command -v openssl >/dev/null 2>&1; then
    JWT=$(openssl rand -hex 32)
    PGPASS=$(openssl rand -hex 20)
  else
    JWT=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 64)
    PGPASS=$(head -c 20 /dev/urandom | base64 | tr -d '/+=' | head -c 32)
  fi

  cat > .env.docker <<EOF
POSTGRES_USER=tekserp
POSTGRES_PASSWORD=${PGPASS}
POSTGRES_DB=tekserp
JWT_SECRET=${JWT}
EOF

  chmod 600 .env.docker
  echo "✓ .env.docker oluşturuldu (rastgele şifreler üretildi, gizli tutulacak)."
fi

# --- 3) Backup klasörü ---
mkdir -p backups

# --- 4) Build + up ---
echo ""
echo "Container'lar build edilip başlatılıyor..."
echo "(İlk seferinde 2-4 dakika sürer, sonraki çalıştırmalarda saniyeler.)"
echo ""

docker compose --env-file .env.docker up -d --build

# --- 5) Sağlık bekle ---
echo ""
echo "Backend sağlık kontrolü..."
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if docker compose exec -T backend wget -qO- http://localhost:4000/health >/dev/null 2>&1 \
     || docker compose exec -T backend node -e "require('http').get('http://localhost:4000/api-docs',r=>process.exit(r.statusCode>=200&&r.statusCode<400?0:1)).on('error',()=>process.exit(1))" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

# --- 6) Bilgi yaz ---
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null \
       || ipconfig getifaddr en1 2>/dev/null \
       || hostname -I 2>/dev/null | awk '{print $1}' \
       || echo "<makinenin-ip-adresi>")

echo ""
echo "================================================================"
if [ "${READY:-0}" = "1" ]; then
  echo "  ✓ TeksERP backend HAZIR"
else
  echo "  ! Container ayakta ama henüz cevap vermiyor. Logları kontrol et:"
  echo "    docker compose logs -f backend"
fi
echo "================================================================"
echo ""
echo "  Bu makinede:       http://localhost:4000"
echo "  Fabrika ağında:    http://${LAN_IP}:4000"
echo "  Swagger dokümanı:  http://${LAN_IP}:4000/api-docs"
echo ""
echo "  Test girişi:       admin / 123123"
echo ""
echo "  Komutlar:"
echo "    Log izle:        docker compose logs -f backend"
echo "    Durdur:          docker compose down"
echo "    Yeniden başlat:  ./baslat.sh"
echo "    DB yedek al:     ./yedekle.sh   (opsiyonel)"
echo ""
echo "================================================================"
