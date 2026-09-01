#!/bin/zsh
# =============================================================================
# DEMO DEPLOY — Paket C + D  (docs/ops/SURUM-2026-08-14-PAKET-C-D-DEPLOY.md §4)
# =============================================================================
# Kullanım:  zsh deploy-demo.sh            → KURU ÇALIŞMA (hiçbir şey değişmez)
#            zsh deploy-demo.sh --apply    → gerçek deploy
#
# ⚠️ SIRA PAZARLIK DIŞI:
#   rsync → build → migrate deploy → up -d (boot uzlaştırması) → demo seed
#   Uzlaştırma koşmadan seed koşarsa WEB_TRADE şablonu yeni izinleri henüz
#   taşımaz ve merge ESKİ listeyi uygular → demo kullanıcısı yeni ekranları
#   göremez ve sebebi hiçbir yerde yazmaz.
# =============================================================================
set -u
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

# Depo kökü betiğin KENDİ konumundan türetilir (docs/ops/ → iki üst dizin) —
# yerel yol gömmek, betiği başka bir makinede/worktree.de sessizce yanlış
# ağacı göndermeye iterdi.
SRC=${0:A:h:h:h}
HOST=yenisunucu
APPDIR=/opt/stack/apps/tekserp-demo

say()  { print -r -- ""; print -r -- "▸ $*"; }
run()  {
  if [ "$APPLY" -eq 1 ]; then
    print -r -- "  \$ $*"
    eval "$@" || { print -r -- "  ❌ BAŞARISIZ (çıkış $?) — deploy DURDURULDU"; exit 1; }
  else
    print -r -- "  [kuru] $*"
  fi
}

print -r -- "=== DEMO DEPLOY — $([ $APPLY -eq 1 ] && echo 'UYGULA' || echo 'KURU ÇALIŞMA') ==="

# --- 0) ÖN KOŞUL: çalışma ağacı temiz mi -------------------------------------
say "0/6 Ön koşul: commit edilmemiş değişiklik var mı"
DIRTY=$(cd "$SRC" && git status --porcelain | wc -l | tr -d ' ')
print -r -- "  commit edilmemiş dosya: $DIRTY"
if [ "$DIRTY" -ne 0 ] && [ "$APPLY" -eq 1 ]; then
  print -r -- "  ⚠️ UYARI: rsync ÇALIŞMA AĞACINI gönderir, commit'i değil."
  print -r -- "     Commit edilmemiş dosyalar da sunucuya gider. Devam ediliyor."
fi

# --- 1) Kaynağı gönder --------------------------------------------------------
say "1/6 rsync → $HOST:$APPDIR/repo/"
RSYNC_OPTS="-az --delete --exclude='.git' --exclude='node_modules' --exclude='mobil' --exclude='dist' --exclude='dist-web' --exclude='out' --exclude='.claude' --exclude='.env'"
if [ "$APPLY" -eq 1 ]; then
  eval "cd '$SRC' && rsync $RSYNC_OPTS ./ $HOST:$APPDIR/repo/" || { print -r -- "  ❌ rsync başarısız"; exit 1; }
  print -r -- "  ✓ gönderildi"
else
  eval "cd '$SRC' && rsync -n $RSYNC_OPTS --stats ./ $HOST:$APPDIR/repo/" 2>&1 | grep -E "Number of files transferred|Total transferred"
fi

# --- 2) İmajı sunucuda derle --------------------------------------------------
say "2/6 docker compose build (imaj SUNUCUDA derlenir — sürüm kayması olmasın)"
run "ssh $HOST 'cd $APPDIR && sudo docker compose build'"

# --- 3) Migration -------------------------------------------------------------
# Sağlamlık paketi: +3 (→180) · G2 short-close (2026-08-14 gece): +1 → 181.
# ⚠️ BİRLEŞTİRME (2026-09-01): `integration/depo-muhasebe` dalı `adnansahin`in
# 44 migration'ını da getirir + bu turda 2 yeni (arama fold kolonları ve ad
# seddi) → sunucudaki 181'den 227'ye çıkar. Sayı YERİNDE ölçüldü.
say "3/6 prisma migrate deploy (181 → 227 beklenir)"
run "ssh $HOST 'cd $APPDIR && sudo docker compose run --rm --entrypoint sh app -c \"npx prisma migrate deploy\"'"

# --- 4) Ayağa kaldır (boot uzlaştırması: 6 izin + rol şablonları) -------------
say "4/6 docker compose up -d  → boot uzlaştırması izinleri ve rolleri getirir"
run "ssh $HOST 'cd $APPDIR && sudo docker compose up -d'"
if [ "$APPLY" -eq 1 ]; then
  print -r -- "  … konteyner sağlıklı olana kadar bekleniyor"
  for i in {1..30}; do
    st=$(ssh "$HOST" 'sudo docker inspect -f "{{.State.Health.Status}}" tekserp-demo 2>/dev/null' 2>/dev/null)
    [ "$st" = "healthy" ] && { print -r -- "  ✓ healthy"; break; }
    sleep 5
  done
fi

# --- 5) Demo seed'i TEKRAR (izinleri kullanıcıya MERGE eder) ------------------
say "5/6 seed-ticaret-demo.ts — ⚠️ ATLANIRSA kullanıcı yeni ekranları GÖREMEZ"
run "ssh $HOST 'cd $APPDIR && sudo docker compose run --rm --entrypoint sh app -c \"npx tsx prisma/seed-ticaret-demo.ts\"'"

# --- 6) Doğrulama -------------------------------------------------------------
say "6/6 Doğrulama"
if [ "$APPLY" -eq 1 ]; then
  print -r -- "  --- uçlar (404 = MOUNT YOK; 401 kesin sinyal DEĞİL) ---"
  for u in /api/finance/cheques /api/finance/period-closes /api/finance/cash-period-closes \
           /api/reports/finance/aging /api/yarn/stocks /api/item-prices /api/purchase-orders; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://demo.etkiliyazilim.com$u")
    mark=$([ "$code" = "404" ] && echo "❌ MOUNT YOK" || echo "✓")
    printf '  %-34s %s  %s\n' "$u" "$code" "$mark"
  done
  # ⚠️ BEKLENEN SAYILAR BİRLEŞTİRMEYLE DEĞİŞTİ (2026-09-01, yerelde ölçüldü):
  #   izin katalogu 83 → 86 · rol şablonu 39 → 28 (kod kataloğuna taşındı, sistem
  #   rolleri konsolide) · migration 181 → 227 · demo kullanıcısı 40 → 86
  #   (ADMIN_FULL: WEB_TRADE üretim/kartela/rapor izinlerini taşımıyordu).
  print -r -- "  --- sayılar (beklenen: izin 86 / rol 28 / demo 86 / migration 227) ---"
  ssh "$HOST" "sudo docker exec postgres psql -U tekserp -d tekserp_demo -tAF' | ' -c \"
SELECT 'izin katalogu', count(*)::text FROM permissions
UNION ALL SELECT 'WEB_TRADE sablonu', count(*)::text FROM permission_template_items i JOIN permission_templates t ON t.id=i.\\\"templateId\\\" WHERE t.code='WEB_TRADE'
UNION ALL SELECT 'demo kullanicisi', count(*)::text FROM user_permissions up JOIN users u ON u.id=up.\\\"userId\\\" WHERE u.username='demo'
UNION ALL SELECT 'migration', count(*)::text FROM _prisma_migrations WHERE finished_at IS NOT NULL;\"" 2>/dev/null | sed 's/^/  /'
else
  print -r -- "  [kuru] uç yoklaması + sayı doğrulaması --apply ile koşar"
fi

print -r -- ""; print -r -- "=== BİTTİ ==="
# ⚠️ Son satır bir TEST OLAMAZ: zsh betiğin çıkış kodunu son komuttan alır ve
# APPLY=1 iken bu test false döner → BAŞARILI deploy "exit 1" raporlanır
# (bu bir kez yaşandı ve deploy başarısız sanıldı).
if [ "$APPLY" -eq 0 ]; then
  print -r -- "Gerçek deploy için: zsh deploy-demo.sh --apply"
fi
exit 0
