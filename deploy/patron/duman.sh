#!/usr/bin/env bash
# =============================================================================
# Patron bulutu YEREL DUMANI — imaj-derle.sh'in yüklediği imajları kendi projesiyle (tekserp-patron-duman)
# kaldırır, YALNIZ 127.0.0.1'e yayımlar, kendi DB konteynerini kullanır; VDS'e/satıcıya dokunmaz.
#   deploy/patron/duman.sh kur <sha>      → yığın + göç + tesis/davet + HTTP ölçümleri + uygulama dumanı + yedek
#   deploy/patron/duman.sh sifirla <sha>  → compose down -v (YALNIZ bu proje) + durum dizini; imajlar KALIR
#   deploy/patron/duman.sh kaldir <sha>   → sifirla + YALNIZ bu iki imaj
# Durum dizini (sırlar, anahtar, yedek) $TMPDIR altında, 0700; sırlar ekrana basılmaz.
# =============================================================================
set -euo pipefail
KOMUT=${1:?kullanım: duman.sh kur|kaldir <sha>}
SHA=${2:?imaj sha gerekli (imaj-derle.sh çıktısı)}
BURASI=$(cd "$(dirname "$0")" && pwd)
KOK=$(cd "$BURASI/../.." && pwd)
PROJE=tekserp-patron-duman
D="${TMPDIR:-/tmp}/tekserp-patron-duman"
PORT=${DUMAN_PORT:-18620}
URL="http://127.0.0.1:$PORT"
IMAJ="tekserp-patron:$SHA"
YIMAJ="tekserp-patron-yedek:$SHA"
dc() { docker compose -p "$PROJE" --env-file "$D/.env" -f "$BURASI/docker-compose.yml" -f "$BURASI/docker-compose.duman.yml" "$@"; }
olc() { printf '%-58s %s\n' "$1" "$2"; }

if [ "$KOMUT" = kaldir ] || [ "$KOMUT" = sifirla ]; then
  [ -f "$D/.env" ] && dc --profile goc down -v --remove-orphans || true
  rm -rf "$D"
  [ "$KOMUT" = kaldir ] && { docker rmi "$IMAJ" "$YIMAJ" 2>/dev/null || true; }
  echo "✅ $KOMUT: proje $PROJE (birimler dahil) · $D$([ "$KOMUT" = kaldir ] && echo " · $IMAJ · $YIMAJ")"
  exit 0
fi
[ "$KOMUT" = kur ] || { echo "kullanım: duman.sh kur|sifirla|kaldir <sha>" >&2; exit 2; }
docker image inspect "$IMAJ" "$YIMAJ" >/dev/null || { echo "⛔ imaj yok — önce: deploy/patron/imaj-derle.sh --yukle-yok" >&2; exit 1; }
[ -e "$D" ] && { echo "⛔ $D var — önce: duman.sh kaldir $SHA" >&2; exit 1; }

umask 077
mkdir -p "$D/sirlar" "$D/anahtarlar" "$D/yedek-alici" "$D/yedek"
for s in goc uygulama esitleme; do openssl rand -hex 32 > "$D/sirlar/$s-parolasi"; done
: > "$D/sirlar/ic-api-belirteci"   # boş = iç API kapalı (kayıt kipi)
node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url")+"\n")' > "$D/anahtarlar/patron-totp.key"
chmod 755 "$D" "$D/sirlar" "$D/anahtarlar" "$D/yedek-alici" "$D/yedek"; chmod 644 "$D"/sirlar/* "$D/anahtarlar/patron-totp.key"
docker run --rm --network none -v "$D:/d" --entrypoint node "$YIMAJ" /arac/yedek-sifrele.cjs \
  anahtar-uret --ad patron --dizin /d/yedek-alici --ozel-cikti /d/yedek-ozel.txt >/dev/null 2>&1
cat > "$D/.env" <<EOF
ORTAM=duman
PATRON_HOST=patron.duman.invalid
PATRON_IMAJ=$IMAJ
PATRON_YEDEK_IMAJ=$YIMAJ
KENAR_AGI=172.31.240.0/28
KENAR_IP=172.31.240.2
KENAR_DINAMIK_ARALIK=172.31.240.8/29
SATICI_IC_API_AGI=tekserp-patron-duman-ic-api
SATICI_IC_API_IP=172.31.241.2
PATRON_IC_IP=172.31.241.3
SIR_GID=61062
GOC_PAROLA_DOSYASI=$D/sirlar/goc-parolasi
UYGULAMA_PAROLA_DOSYASI=$D/sirlar/uygulama-parolasi
ESITLEME_PAROLA_DOSYASI=$D/sirlar/esitleme-parolasi
IC_API_BELIRTEC_DOSYASI_HOST=$D/sirlar/ic-api-belirteci
ANAHTAR_DIZINI_HOST=$D/anahtarlar
YEDEK_ALICI_DIZINI_HOST=$D/yedek-alici
YEDEK_DIZINI_HOST=$D/yedek
DUMAN_PORT=$PORT
EOF

echo "→ DB + göç + roller"
dc up -d --wait patron-db
dc --profile goc run --rm patron-goc
TESIS=$(node -e 'console.log(require("crypto").randomUUID())')
dc --profile goc run --rm patron-goc node dist-cli/scripts/tesis.js tesis-ac --tesis="$TESIS" --ad="Duman Tekstil" | tail -1
# Açık abonelik: hesap yazmaları (gelen kutusu) tesisin URETIM + patron-bulut kurulumunu ister.
ANAHTAR_X=$(node -e 'const{generateKeyPairSync:g}=require("crypto");console.log(g("ed25519").publicKey.export({format:"jwk"}).x)')
BITIS=$(node -e 'console.log(new Date(Date.now()+365*864e5).toISOString())')
dc --profile goc run --rm patron-goc node dist-cli/scripts/tesis.js kurulum-kaydet --tesis="$TESIS" --kurulum="$(node -e 'console.log(require("crypto").randomUUID())')" \
  --acik-anahtar="$ANAHTAR_X" --sinif=URETIM --moduller=patron-bulut --bitis="$BITIS" | tail -1
dc --profile goc run --rm patron-goc node dist-cli/scripts/tesis.js yonetici-davet --tesis="$TESIS" --eposta=yonetici@duman.invalid --ad="Duman Yönetici" \
  | sed -n 's/.*: \([A-Za-z0-9_-]\{20,\}\)$/\1/p' > "$D/davet"
[ -s "$D/davet" ] || { echo "⛔ davet belirteci alınamadı" >&2; exit 1; }

echo "→ sunucu + yedek"
dc up -d --wait patron patron-yedek

echo "→ HTTP (yalnız 127.0.0.1)"
h() { curl -s -o /dev/null -D - "$URL$1" | tr -d '\r'; }
kod() { curl -s -o /dev/null -w '%{http_code}' "$URL$1"; }
olc "/saglik" "$(curl -s "$URL/saglik")"
KOKH=$(h /); olc "/ (web kökü)" "$(echo "$KOKH" | head -1) · $(echo "$KOKH" | grep -i '^content-type' | cut -d' ' -f2-) · $(echo "$KOKH" | grep -i '^cache-control' | cut -d' ' -f2-)"
olc "/ CSP style-src" "$(echo "$KOKH" | grep -i '^content-security-policy' | tr ';' '\n' | grep style-src | xargs)"
GIRIS=$(curl -s "$URL/" | sed -n 's/.*src="\(\/_expo\/static\/js\/web\/[^"]*\)".*/\1/p')
olc "$GIRIS" "$(h "$GIRIS" | grep -i '^cache-control' | cut -d' ' -f2-) · $(kod "$GIRIS")"
olc "/cariler/x (istemci yönlendirmesi)" "$(kod /cariler/x)"
olc "/api/yok · /v1/yok · /ic/v1/zil · /yonetim" "$(kod /api/yok) · $(kod /v1/yok) · $(kod /ic/v1/zil) · $(kod /yonetim)"
olc "/api/oturum (oturumsuz)" "$(kod /api/oturum)"
olc "Traefik etiketi (konteyner)" "$(docker inspect tekserp-patron-duman --format '{{index .Config.Labels "traefik.http.routers.tekserp-patron-duman.rule"}}')"
olc "ic-api'de 4620 dinlenmez (BIND)" "$(docker exec tekserp-patron-duman node -e "require('http').get('http://172.31.241.3:4620/saglik',r=>console.log(r.statusCode)).on('error',e=>console.log(e.code))")"

if [ -x "$KOK/patron/sunucu/node_modules/.bin/tsx" ]; then
  echo "→ uygulama dumanı (uygulamanın kendi istemcisi: davet → TOTP → giriş → pano → gelen kutusu)"
  (cd "$KOK/patron/uygulama" && ../sunucu/node_modules/.bin/tsx scripts/duman.ts --api="$URL" --davet="$(cat "$D/davet")")
fi

PW="$KOK/Electron/node_modules/playwright"
if [ -d "$PW" ]; then
  echo "→ gerçek tarayıcı (Chromium): CSP ihlali · konsol hatası · giriş ekranı"
  PW="$PW" node "$BURASI/tarayici-duman.cjs" "$URL" "$D/web-kok.png"
fi

echo "→ yedek (tek) + Mac'te açma"
dc exec -T patron-yedek /arac/yedek-dongusu.sh tek
DOKUM=$(ls "$D/yedek" | grep '^patron_.*\.dump\.tkenc$' | head -1)
docker run --rm --network none -v "$D:/d" --entrypoint sh "$YIMAJ" -c \
  "node /arac/yedek-sifrele.cjs coz --girdi /d/yedek/$DOKUM --cikti /tmp/p.dump --anahtar /d/yedek-ozel.txt >/dev/null && pg_restore --list /tmp/p.dump | grep -c 'TABLE DATA'" \
  | sed 's/^/  açılan dökümde tablo verisi: /'
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}} {{.PIDs}}' tekserp-patron-duman tekserp-patron-duman-db tekserp-patron-duman-yedek
echo "✅ duman tamam — kaldırmak için: deploy/patron/duman.sh kaldir $SHA"
