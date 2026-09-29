#!/bin/zsh
# =============================================================================
# DEMO DEPLOY — Paket C + D  (docs/ops/SURUM-2026-08-14-PAKET-C-D-DEPLOY.md §4)
# =============================================================================
# Kullanım:  zsh deploy-demo.sh            → KURU ÇALIŞMA (hiçbir şey değişmez)
#            zsh deploy-demo.sh --apply    → gerçek deploy
#
# ⚠️ SUNUCUYA GİDEN AĞAÇ İZİN LİSTESİYLE KURULUR (`deploy-demo-izin-listesi.txt`):
#   `git archive HEAD` yalnız listedeki İZLENEN dosyaları çıkarır, yasak desen
#   kapısı (YASAK_DESEN) sonra bir kez daha tarar. Paylaşımlı sunucuya döküm,
#   .env, paket çıktısı ya da rapor dosyası GİDEMEZ; commit edilmemiş iş de gitmez.
#
# ⚠️ SIRA PAZARLIK DIŞI:
#   aktarım → build (çalışma + seed imajı) → migrate deploy → up -d (boot uzlaştırması) → demo seed
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
# ⚠️ TAKMA AD ZORUNLU DEĞİL (2026-09-01): `~/.ssh/config`teki `yenisunucu`
# girdisi her makinede bulunmayabilir (bu turda yoktu). Ortamdan geçersiz
# kılınabilir; `SSH_OPTS` de rsync'in taşıyıcısına aktarılır ki alternatif port
# gerektiğinde config'e DOKUNMADAN deploy edilebilsin.
HOST=${DEMO_HOST:-yenisunucu}
SSH_OPTS=${DEMO_SSH_OPTS:-}
[ -n "$SSH_OPTS" ] && export RSYNC_RSH="ssh $SSH_OPTS"
ssh() { command ssh ${=SSH_OPTS} "$@"; }
APPDIR=/opt/stack/apps/tekserp-demo
SEED_IMAGE=tekserp-demo-seed:latest

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

# --- 0) Aktarılacak ağaç: izin listesi → HEAD → geçici dizin ------------------
say "0/6 Aktarım ağacı: izin listesi + HEAD ($(cd "$SRC" && git rev-parse --short HEAD))"
LISTE="$SRC/docs/ops/deploy-demo-izin-listesi.txt"
# Yasak desen: bu yollardan biri aktarım ağacında belirirse gönderim DURUR.
YASAK_DESEN='(^|/)dump/|[.]dump$|(^|/)release/|(^|/)BULGULAR-[^/]*[.]md$|(^|/)[.]env|(^|/)_anahtarlar(/|$)|(^|/)[.]claude/|(^|/)[.]git/'
[ -f "$LISTE" ] || { print -r -- "  ❌ izin listesi yok: $LISTE"; exit 1; }
PATHSPECS=(${(f)"$(grep -v '^[[:space:]]*#' "$LISTE" | grep -v '^[[:space:]]*$')"})
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/tekserp-demo-aktarim.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
( cd "$SRC" && git archive --format=tar HEAD -- $PATHSPECS ) | tar -x -C "$STAGE" \
  || { print -r -- "  ❌ git archive başarısız — gönderim DURDURULDU"; exit 1; }
YASAK=$(cd "$STAGE" && find . -type f | sed 's|^\./||' | grep -E "$YASAK_DESEN")
if [ -n "$YASAK" ]; then
  print -r -- "  ❌ YASAK DOSYA aktarım ağacında — gönderim DURDURULDU:"
  print -r -- "$YASAK" | sed 's/^/     /'
  exit 1
fi
print -r -- "  aktarılacak dosya: $(cd "$STAGE" && find . -type f | wc -l | tr -d ' ')"
DIRTY=$(cd "$SRC" && git status --porcelain | wc -l | tr -d ' ')
[ "$DIRTY" -ne 0 ] && print -r -- "  ⚠️ $DIRTY commit edilmemiş dosya var — GİTMEZ (yalnız HEAD gönderilir)."

# --- 1) Ağacı gönder ----------------------------------------------------------
# `--delete`: sunucudaki repo/ kopyası izin listesinin birebir aynası olur —
# listede olmayan her şey (önceki dışlama listesiyle sızmış dosyalar dahil) silinir.
say "1/6 rsync (izin listesi) → $HOST:$APPDIR/repo/"
RSYNC_OPTS="-az --delete"
if [ "$APPLY" -eq 1 ]; then
  eval "rsync $RSYNC_OPTS '$STAGE/' $HOST:$APPDIR/repo/" || { print -r -- "  ❌ rsync başarısız"; exit 1; }
  print -r -- "  ✓ gönderildi"
else
  KURU_CIKTI=$(eval "rsync -n $RSYNC_OPTS --itemize-changes '$STAGE/' $HOST:$APPDIR/repo/" 2>&1)
  if [ $? -ne 0 ]; then
    print -r -- "  ⚠️ sunucuyla karşılaştırılamadı (silinecekler listelenemedi):"
    print -r -- "$KURU_CIKTI" | tail -2 | sed 's/^/     /'
  else
    print -r -- "$KURU_CIKTI" | grep -E '^\*deleting' | sed 's/^/  sunucudan silinecek: /'
    print -r -- "  [kuru] listede olmayan her dosya sunucudaki repo/ kopyasından silinir (yukarıdaki satırlar)"
  fi
fi

# --- 2) İmajı sunucuda derle --------------------------------------------------
say "2/6 docker compose build + seed imajı (imaj SUNUCUDA derlenir — sürüm kayması olmasın)"
run "ssh $HOST 'cd $APPDIR && sudo docker compose build'"
# Çalışma imajı src/tsx taşımaz; demo seed'i kendi hedefinden (`--target seed`) koşar.
run "ssh $HOST 'cd $APPDIR && sudo docker build --target seed -t $SEED_IMAGE repo'"

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
run "ssh $HOST 'cd $APPDIR && sudo docker run --rm --env-file .env --network backend $SEED_IMAGE npx tsx prisma/seed-ticaret-demo.ts'"

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
