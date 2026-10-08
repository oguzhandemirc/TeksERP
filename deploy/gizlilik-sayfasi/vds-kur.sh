#!/usr/bin/env bash
# =============================================================================
# Gizlilik sayfası kökeni — VDS kurulumu (https://tekserp.etkiliyazilim.com/gizlilik → /opt/stack/apps/tekserp-gizlilik)
# =============================================================================
# Kullanım (Mac, herhangi bir dizinden):
#   deploy/gizlilik-sayfasi/vds-kur.sh             KURU (varsayılan): denetler, planı basar, VDS'e YAZMAZ
#   deploy/gizlilik-sayfasi/vds-kur.sh --uygula    kurar ya da günceller (dosyalar + konteyner)
#   deploy/gizlilik-sayfasi/vds-kur.sh --geri-al   konteyneri durdurur; dizin SİLİNMEZ (önce Cloudflare'de DNS kaydı silinir)
#   deploy/gizlilik-sayfasi/vds-kur.sh --html             KURU: yalnız html güncellemesinin planı (VDS'e yazmaz)
#   deploy/gizlilik-sayfasi/vds-kur.sh --html --uygula    yalnız html/gizlilik.html değişir; compose/conf/konteyner aynı kalır
# sudo YOK: kök sahipli yazımlar tek seferlik yardımcı konteynerle (nginx:alpine, --network none; SATICI-KURULUM.md §12).
# Her kipte önce/sonra komşu ölçümü: adnansahin eski adresi + indir kapısı (olc.mjs --adnansahin) + deploy/vds-dogrula.sh.
# Ortam: TEKSERP_VDS_SSH (varsayılan tekserp-vds = oguzhan@80.253.255.188:2222, docker grubunda).
set -euo pipefail
cd "$(dirname "$0")/../.."

SSH_HEDEF="${TEKSERP_VDS_SSH:-tekserp-vds}"
K=/opt/stack/apps/tekserp-gizlilik
ADRES=https://tekserp.etkiliyazilim.com/gizlilik
HOST=tekserp.etkiliyazilim.com
KOKEN_IP=80.253.255.188
D=deploy/gizlilik-sayfasi
KIP=kuru
case "${*:-}" in
  '') ;;
  --uygula) KIP=uygula ;;
  --geri-al) KIP=geri-al ;;
  --html) KIP=html-kuru ;;
  '--html --uygula') KIP=html-uygula ;;
  *) echo "bilinmeyen argüman: $* (yalnız --uygula | --geri-al | --html [--uygula])" >&2; exit 2 ;;
esac

v() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HEDEF" "$@"; }
dur() { echo "⛔ DUR: $*" >&2; exit 1; }
koken_kodu() { curl -sk -o /dev/null -w '%{http_code}' -m 15 --resolve "$HOST:443:$KOKEN_IP" "$ADRES" || true; }

komsu_olc() {
  echo "── komşu ölçümü ($1)"
  node "$D/olc.mjs" --adnansahin || return 1
  if [ -f "${TEKSERP_VDS_TABAN:-$HOME/.tekserp/vds-taban}/adnansahin.sha" ]; then
    deploy/vds-dogrula.sh || return 1
  else
    echo "⏭ deploy/vds-dogrula.sh: taban yok (~/.tekserp/vds-taban) — yalnız HTTP ölçümü"
  fi
}

echo "═══ gizlilik sayfası — kip: $KIP · hedef: $SSH_HEDEF:$K · adres: $ADRES"

# 1) Repo tarafı
node scripts/test_gizlilik_sayfasi.mjs >/dev/null || dur "bekçi yeşil değil: node scripts/test_gizlilik_sayfasi.mjs"
echo "✅ bekçi yeşil"
YT=$(grep -oE '\[[A-ZÇĞİÖŞÜ][^]]{1,80}\]' "$D/html/gizlilik.html" | tr '\n' ' ' || true)
if [ -n "$YT" ]; then
  case "$KIP" in uygula|html-uygula) dur "sayfada yer tutucu var: $YT — docs/legal/GIZLILIK-POLITIKASI.md doldurulur, node $D/uret.mjs, commit" ;; esac
  echo "⏳ yer tutucu (--uygula durdurur): $YT"
fi
if ! git diff --quiet HEAD -- "$D" docs/legal/GIZLILIK-POLITIKASI.md; then
  case "$KIP" in uygula|html-uygula) dur "commit edilmemiş değişiklik var ($D) — yayınlanan bayt commit'te olmalı" ;; esac
  echo "⚠ commit edilmemiş değişiklik var"
fi
HTML_SHA=$(shasum -a 256 "$D/html/gizlilik.html" | cut -d' ' -f1)

# 2) VDS salt-okuma
DURUM=$(v "K=$K bash -s" <<'UZAK'
set -u
id -nG | tr ' ' '\n' | grep -qx docker && echo "docker=evet" || echo "docker=HAYIR"
docker network inspect web >/dev/null 2>&1 && echo "ag=evet" || echo "ag=HAYIR"
docker image inspect nginx:alpine >/dev/null 2>&1 && echo "imaj=evet" || echo "imaj=HAYIR"
[ -d "$K" ] && echo "dizin=var" || echo "dizin=yok"
KD=$(docker inspect -f '{{.State.Status}}' tekserp-gizlilik 2>/dev/null) || KD=yok
echo "konteyner=$KD"
UZAK
) || dur "ssh $SSH_HEDEF bağlanamadı"
echo "$DURUM" | sed 's/^/   VDS /'
for g in docker=evet ag=evet imaj=evet; do echo "$DURUM" | grep -qx "$g" || dur "VDS önkoşulu yok: $g"; done
echo "   köken (Cloudflare'siz) şimdi: HTTP $(koken_kodu)  (kurulu ve kapılı: 403 · yönlendirici yok: 404)"

komsu_olc önce || dur "komşu ölçümü önce düştü — kurulumdan bağımsız bir sorun var, önce o"

if [ "$KIP" = kuru ]; then
  cat <<PLAN

KURU — VDS'e hiçbir şey yazılmadı. --uygula şunları yapar:
  1. nginx -t (yardımcı konteyner, yeni conf ile) — geçmezse durur
  2. ~/tekserp-gizlilik-gecici.* → yardımcı konteyner (root, --network none) → $K/{docker-compose.yml,nginx/default.conf,html/gizlilik.html}
     root:root 0644; var olanlar önce $K/onceki/'ye kopyalanır
  3. cd $K && docker compose up -d --force-recreate   (proje tekserp-gizlilik, yalnız bu konteyner)
  4. konteyner içinden /gizlilik sha256 = repo ($HTML_SHA) · köken Cloudflare'siz → 403
  5. geçici dizin silinir · komşu ölçümü sonra
PLAN
  exit 0
fi

if [ "$KIP" = html-kuru ] || [ "$KIP" = html-uygula ]; then
  echo "$DURUM" | grep -qx "konteyner=running" || dur "tekserp-gizlilik çalışmıyor — ilk kurulum: $0 --uygula"
  YAYIN_SHA=$(v "sha256sum $K/html/gizlilik.html | cut -d' ' -f1") || dur "VDS'teki html okunamadı"
  echo "   VDS html: $YAYIN_SHA · repo: $HTML_SHA"
  if [ "$KIP" = html-kuru ]; then
    cat <<PLAN

KURU — VDS'e hiçbir şey yazılmadı. --html --uygula şunları yapar:
  1. html/gizlilik.html → ~/tekserp-gizlilik-gecici.* → yardımcı konteyner (root, --network none) → $K/html/gizlilik.html
     root:root 0644; önceki $K/onceki/html_gizlilik.html'e kopyalanır. compose, conf ve konteyner DEĞİŞMEZ
     (html dizin bağı: nginx yeni dosyayı yeniden başlatmadan sunar)
  2. konteyner içinden /gizlilik sha256 = repo ($HTML_SHA) · köken Cloudflare'siz → 403
  3. geçici dizin silinir · komşu ölçümü sonra · node $D/olc.mjs (kenar en geç 5 dk'da tazelenir)
PLAN
    exit 0
  fi
  G=$(v 'mktemp -d "$HOME/tekserp-gizlilik-gecici.XXXXXX"') || dur "geçici dizin açılamadı"
  temizle() { v "rm -rf '$G'" || echo "⚠ geçici dizin kaldı: $G"; }
  trap temizle EXIT
  scp -q -o BatchMode=yes "$D/html/gizlilik.html" "$SSH_HEDEF:$G/" || dur "scp"
  v "G=$G bash -s" <<'UZAK' || dur "yardımcı konteyner yazamadı"
set -eu
docker run --rm --network none --user 0 -v /opt/stack/apps/tekserp-gizlilik:/h -v "$G:/g:ro" --entrypoint sh nginx:alpine -c '
  set -eu
  install -d -o 0 -g 0 -m 0755 /h/onceki
  cp -p /h/html/gizlilik.html /h/onceki/html_gizlilik.html
  install -o 0 -g 0 -m 0644 /g/gizlilik.html /h/html/gizlilik.html
'
UZAK
  echo "✅ html yazıldı (root:root 0644; önceki onceki/html_gizlilik.html)"
  ICERDE=$(v "docker exec tekserp-gizlilik wget -qO- http://127.0.0.1/gizlilik | sha256sum | cut -d' ' -f1") || ICERDE=YOK
  [ "$ICERDE" = "$HTML_SHA" ] || dur "konteyner içinden sayfa repodakiyle aynı değil ($ICERDE ↔ $HTML_SHA)"
  echo "✅ konteyner içinden /gizlilik = repo ($HTML_SHA)"
  KOD=$(koken_kodu)
  [ "$KOD" = 403 ] || dur "köken Cloudflare'siz isteğe 403 vermedi (HTTP $KOD)"
  echo "✅ köken Cloudflare'siz → 403"
  komsu_olc sonra || dur "komşu ölçümü SONRA düştü — önceki sürüm: $K/onceki/html_gizlilik.html"
  echo "✅ bitti — kenar tazelenince: node $D/olc.mjs"
  exit 0
fi

if [ "$KIP" = geri-al ]; then
  echo "$DURUM" | grep -qx "dizin=var" || dur "$K yok — geri alınacak bir şey yok"
  echo "⚠ Önce Cloudflare'de DNS kaydı 'tekserp' silinmiş olmalı (docs/ops/SUNUCU-ENVANTERI.md)."
  v "cd $K && docker compose down"
  echo "✅ konteyner durdu; dizin duruyor ($K)"
  komsu_olc sonra || dur "komşu ölçümü SONRA düştü"
  exit 0
fi

# 3) Uygula
G=$(v 'mktemp -d "$HOME/tekserp-gizlilik-gecici.XXXXXX"') || dur "geçici dizin açılamadı"
temizle() { v "rm -rf '$G'" || echo "⚠ geçici dizin kaldı: $G"; }
trap temizle EXIT
scp -q -o BatchMode=yes "$D/docker-compose.yml" "$D/nginx/default.conf" "$D/html/gizlilik.html" "$SSH_HEDEF:$G/" || dur "scp"

v "G=$G bash -s" <<'UZAK' || dur "nginx -t geçmedi — hiçbir şey yazılmadı"
set -eu
docker run --rm --network none -v "$G/default.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t -q
UZAK
echo "✅ nginx -t"

v "K=$K G=$G bash -s" <<'UZAK' || dur "yardımcı konteyner yazamadı"
set -eu
docker run --rm --network none --user 0 -v /opt/stack/apps:/a -v "$G:/g:ro" --entrypoint sh nginx:alpine -c '
  set -eu
  H=/a/tekserp-gizlilik
  install -d -o 0 -g 0 -m 0755 "$H" "$H/nginx" "$H/html" "$H/onceki"
  for f in docker-compose.yml nginx/default.conf html/gizlilik.html; do
    if [ -f "$H/$f" ]; then cp -p "$H/$f" "$H/onceki/$(echo "$f" | tr / _)"; fi
  done
  install -o 0 -g 0 -m 0644 /g/docker-compose.yml "$H/docker-compose.yml"
  install -o 0 -g 0 -m 0644 /g/default.conf "$H/nginx/default.conf"
  install -o 0 -g 0 -m 0644 /g/gizlilik.html "$H/html/gizlilik.html"
'
ls -ln "$K" "$K/nginx" "$K/html" | grep -v '^total'
UZAK
echo "✅ dosyalar yazıldı (root:root 0644)"

v "cd $K && docker compose up -d --force-recreate" || dur "docker compose up — geri almak için: $0 --geri-al"
sleep 3
ICERDE=$(v "docker exec tekserp-gizlilik wget -qO- http://127.0.0.1/gizlilik | sha256sum | cut -d' ' -f1") || ICERDE=YOK
[ "$ICERDE" = "$HTML_SHA" ] || dur "konteyner içinden sayfa repodakiyle aynı değil ($ICERDE ↔ $HTML_SHA)"
echo "✅ konteyner içinden /gizlilik = repo ($HTML_SHA)"
KOD=$(koken_kodu)
[ "$KOD" = 403 ] || dur "köken Cloudflare'siz isteğe 403 vermedi (HTTP $KOD) — yönlendirici/ipallowlist eksik"
echo "✅ köken Cloudflare'siz → 403 (yönlendirici canlı, CF kapısı çalışıyor)"

komsu_olc sonra || dur "komşu ölçümü SONRA düştü — $0 --geri-al ve incele"
if [ -n "$(dig +short "$HOST" 2>/dev/null)" ]; then
  node "$D/olc.mjs" || dur "canlı ölçüm düştü"
else
  echo "⏭ DNS kaydı henüz yok — Cloudflare adımından sonra: node $D/olc.mjs"
fi
echo "✅ bitti"
