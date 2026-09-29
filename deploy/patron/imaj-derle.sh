#!/usr/bin/env bash
# =============================================================================
# Patron bulutu imajlarını YEREL makinede derler, VDS'e taşınacak TEK arşivi üretir.
# =============================================================================
# VDS'te derleme YOK ve kaynak VDS'e gitmez: bağlam HEAD'in commit'lenmiş hâlinden (git archive)
# kurulur — kirli ağaç RED (arşivdeki imaj, sha'sının söylediği kod olsun).
#   sunucu : patron/sunucu (npm ci → prisma generate → tsc + CLI → prune) + patron/uygulama web çıktısı
#            (npm ci → expo export --platform web; yalnız çıktı imaja geçer → PATRON_WEB_DIZINI)
#   yedek  : Teks-Erp/scripts/build-araclar.mjs'in ürettiği yedek-sifrele.cjs + yedek-dongusu.sh
#
# Kullanım:  deploy/patron/imaj-derle.sh [--platform linux/amd64] [--cikti <dizin>]
#   VDS x86_64'tür → varsayılan linux/amd64 (Apple Silicon'da öykünmeyle, birkaç dakika).
#   Yerel duman testi için: --platform linux/arm64 --yukle-yok (arşiv yazmadan yalnız imaj).
# Çıktı: <cikti>/tekserp-patron-<sha>.tar.gz + .sha256 → runbook §4 (scp + docker load).
# =============================================================================
set -euo pipefail

KOK=$(git rev-parse --show-toplevel)
PLATFORM=linux/amd64
CIKTI="$HOME/.tekserp/patron-imaj"
ARSIV=1
while [ $# -gt 0 ]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --cikti) CIKTI="$2"; shift 2 ;;
    --yukle-yok) ARSIV=0; shift ;;
    *) echo "Bilinmeyen argüman: $1" >&2; exit 2 ;;
  esac
done

KAYNAKLAR=(patron/sunucu patron/uygulama deploy/patron Teks-Erp/scripts Teks-Erp/src Teks-Erp/package.json)
if ! git -C "$KOK" diff --quiet HEAD -- "${KAYNAKLAR[@]}" || [ -n "$(git -C "$KOK" ls-files --others --exclude-standard -- "${KAYNAKLAR[@]}")" ]; then
  echo "⛔ Kirli ağaç: ${KAYNAKLAR[*]} altında commit'lenmemiş değişiklik var — imaj HEAD'i temsil etmezdi." >&2
  exit 1
fi
[ -d "$KOK/Teks-Erp/node_modules/esbuild" ] || { echo "⛔ Teks-Erp/node_modules/esbuild yok (araç derlemesi için)" >&2; exit 1; }

SHA=$(git -C "$KOK" rev-parse --short=12 HEAD)
IMAJ="tekserp-patron:$SHA"
YEDEK_IMAJ="tekserp-patron-yedek:$SHA"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "→ kaynak: HEAD $SHA (git archive)"
mkdir -p "$TMP/kaynak" "$TMP/baglam"
git -C "$KOK" archive HEAD "${KAYNAKLAR[@]}" | tar -x -C "$TMP/kaynak"

echo "→ yedek-sifrele.cjs (build-araclar.mjs — paketle aynı derleme tanımı)"
ln -s "$KOK/Teks-Erp/node_modules" "$TMP/kaynak/Teks-Erp/node_modules"
(cd "$TMP/kaynak/Teks-Erp" && node scripts/build-araclar.mjs >/dev/null)

cp -R "$TMP/kaynak/patron/sunucu" "$TMP/baglam/sunucu"
cp -R "$TMP/kaynak/patron/uygulama" "$TMP/baglam/uygulama"
cp "$TMP/kaynak/Teks-Erp/dist/tools/yedek-sifrele.cjs" "$TMP/baglam/"
cp "$TMP/kaynak/deploy/patron/patron-baslat.sh" "$TMP/kaynak/deploy/patron/yedek-dongusu.sh" "$TMP/baglam/"

for hedef in sunucu yedek; do
  etiket=$([ "$hedef" = sunucu ] && echo "$IMAJ" || echo "$YEDEK_IMAJ")
  echo "→ docker build --target $hedef --platform $PLATFORM → $etiket"
  docker buildx build --platform "$PLATFORM" --target "$hedef" \
    --label "org.opencontainers.image.revision=$SHA" \
    -t "$etiket" -f "$TMP/kaynak/deploy/patron/Dockerfile" --load "$TMP/baglam"
done

if [ "$ARSIV" = 1 ]; then
  mkdir -p "$CIKTI"
  chmod 700 "$CIKTI"
  hedef="$CIKTI/tekserp-patron-$SHA.tar.gz"
  docker save "$IMAJ" "$YEDEK_IMAJ" | gzip -9 > "$hedef"
  (cd "$CIKTI" && shasum -a 256 "$(basename "$hedef")" > "$(basename "$hedef").sha256")
  echo "✅ $hedef ($(du -h "$hedef" | cut -f1))"
  echo "   PATRON_IMAJ=$IMAJ"
  echo "   PATRON_YEDEK_IMAJ=$YEDEK_IMAJ"
else
  echo "✅ imajlar yüklendi (arşiv yok): $IMAJ · $YEDEK_IMAJ"
fi
