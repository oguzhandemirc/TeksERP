#!/bin/zsh
# =============================================================================
# DEMO SIFIRLAMA — tekserp_demo veritabanını SIFIRDAN kurar
# =============================================================================
# Kullanım:  zsh demo-reset.sh                 → KURU ÇALIŞMA (hiçbir şey değişmez)
#            zsh demo-reset.sh --apply         → gerçek sıfırlama (DB adını yazarak onaylatır)
#            zsh demo-reset.sh --apply --yes   → onay sorusunu atlar (otomasyon; niyet çağıranda yazılı)
#
# NE YAPAR: uygulamayı durdurur → veritabanını DROP/CREATE eder → migration'ları
# uygular → fabrika seed'i (izin + rol katalogları + admin) → ticaret demo seed'i
# → uygulamayı kaldırır → doğrular.
#
# NE ZAMAN: demoyu gezen kişiler veriyi kirletince ("üç sayfa boyunca TEST
# faturası var"), ya da seed zenginleştikten sonra eski demoda yeni örnekler
# görünmesin diye. Günlük deploy AKIŞI DEĞİLDİR — onun için `deploy-demo.sh`.
#
# ⚠️⚠️ BU BETİK VERİ SİLER. Diğer ops betiklerinden (deploy-demo.sh, yedekle.ps1)
# ayrıldığı tek nokta budur ve tüm sertleştirme buradan doğar:
#
#   1) HEDEF VERİTABANI SABİT YAZILIDIR: `tekserp_demo`. Parametreyle DB adı
#      ALINMAZ. Sebep: bu betiğin tek adımlık bir "yanlış DB'yi sil" yoluna
#      dönüşmesi için tek gereken şey, yorgun bir gecede kabuk geçmişinden
#      yanlış satırı seçmektir. Aynı sunucudaki `postgres` konteynerinde canlı
#      komşular var (mail, iki WordPress, fizyoterapist sitesi, Next.js).
#      Değişken yok → yanlış hedef yok.
#   2) TANINMAYAN HER ARGÜMAN REDDEDİLİR (yalnız `--dry-run`/`--apply`/`--yes`).
#      Bu kural TEORİK DEĞİL: betiğin ilk hâlinde yalnız `$1` okunuyordu ve
#      `--apply --extra` çağrısında ikinci argüman sessizce yutulup CANLI demo
#      veritabanı gerçekten sıfırlandı (2026-08-14; yedek alınmıştı, demo
#      sağlıklı döndü). "Bilinmeyen bayrağı yok say" davranışının bedeli budur.
#   3) VARSAYILAN KURU ÇALIŞMADIR ve `--apply` TEK BAŞINA YETMEZ: silinecek DB'nin
#      adı elle yazılarak onaylanır. TTY yoksa (ajan / CI / `>/dev/null`) soru
#      sorulamaz → betik REDDEDER; otomasyon niyetini `--yes` ile AÇIKÇA yazar.
#   4) DROP'TAN ÖNCE YEDEK ALINIR ve boyutu doğrulanır. Yedek alınamazsa betik
#      DURUR — "demo verisi zaten önemsiz" savunması, gezinti sırasında girilmiş
#      gerçek bir müşteri senaryosunu kaybettiğiniz gün çöker.
#      ⚠️ Yedek adı `pre-reset_` ile başlar: uygulamanın gece rotasyonu YALNIZ
#      `tekserp_` önekli dosyaları siler (`services/helpers/backup-naming.helper.ts`
#      tek kaynak), yani bu dosya kendiliğinden silinmez.
#
# ⚠️ SIRA PAZARLIK DIŞI:
#   stop app → yedek → DROP/CREATE → statement_timeout → migrate deploy →
#   seed.ts → seed-ticaret-demo.ts → seed-demo-full.ts → up -d → doğrulama
#
#   • `stop app` ÖNCE: açık bağlantı varken `DROP DATABASE` hata verir. Betik
#     ayrıca artık bağlantıları `pg_terminate_backend` ile düşürür (healthcheck
#     ya da başka bir konsol asılı kalmış olabilir).
#   • `statement_timeout` DROP'TAN SONRA YENİDEN yazılır: per-DB ayarlar
#     `pg_db_role_setting`'de veritabanının **OID**'sine bağlıdır ve DB
#     silinince o satır da gider. Kök CLAUDE.md bunu "migration ile değil elle
#     uygulanır" diye yazar — yani hiçbir migration onu geri getirmez ve
#     atlanırsa demo, kaçak bir sorguyu 50 sn'de iptal etme korumasını sessizce
#     kaybeder.
#   • `seed.ts` demo seed'inden ÖNCE: izin ve rol kataloglarını o kurar; ticaret
#     seed'i `WEB_TRADE` şablonunu demo kullanıcısına uygular. Ters sırada demo
#     kullanıcısı giriş yapar ama hiçbir ekranı açamaz.
#   • `up -d` seed'lerden SONRA: `docker compose run --rm` tek seferlik bir
#     konteyner kaldırır ve uygulamanın kendisi ayakta olmadan koşar; boot
#     uzlaştırması (izin + rol katalogları) `seed.ts` ile zaten geldiği için
#     sıralamada kayıp yok.
#
# ⚠️ DEMO KULLANICISININ ŞİFRESİ `$APPDIR/.env` içindeki `DEMO_USER_PASSWORD`'tan
# gelir (`docker compose run` `env_file`'ı okur). Orada tanımlı DEĞİLSE seed
# rastgele bir şifre üretip EKRANA basar — betiğin çıktısını kaybetmeyin.
#
# Emsal / ayrıntı: docs/ops/DEMO-YAYIN-RUNBOOK.md · docs/ops/deploy-demo.sh
# =============================================================================
set -u

# --- ARGÜMAN AYRIŞTIRMA -------------------------------------------------------
# ⚠️ HER argüman tanınmak ZORUNDA. "Bilinmeyeni yok say" davranışı bu betikte
# ÖLÇÜLMÜŞ bir kazaya yol açtı (2026-08-14): `--apply --extra` çağrısında ikinci
# argüman sessizce yutuldu, `--apply` geçerli sayıldı ve CANLI demo veritabanı
# gerçekten sıfırlandı. Yedek alınmıştı ve demo sağlıklı döndü — ama olay
# betiğin kendi uyarısının ("bilinmeyen bayrağı yok saymak" tehlikelidir)
# gerçekleşmesiydi. Artık tanınmayan HER argüman ve fazladan argüman REDDEDİLİR.
APPLY=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) APPLY=0 ;;
    --apply)   APPLY=1 ;;
    --yes)     ASSUME_YES=1 ;;
    *)
      print -r -- "❌ Tanınmayan argüman: ${arg}"
      print -r -- "   Kullanım: zsh demo-reset.sh [--dry-run | --apply [--yes]]"
      print -r -- "   ⚠️ Veritabanı adı parametreyle VERİLEMEZ (sabit: tekserp_demo)."
      exit 2
      ;;
  esac
done

# --- SABİTLER — değişkenleştirilmez (yukarıdaki 1. madde) ---------------------
# ⚠️ TAKMA AD ZORUNLU DEĞİL (2026-09-01) — `deploy-demo.sh` ile aynı gerekçe:
# `~/.ssh/config`teki `yenisunucu` girdisi her makinede bulunmayabilir.
HOST=${DEMO_HOST:-yenisunucu}
SSH_OPTS=${DEMO_SSH_OPTS:-}
[ -n "$SSH_OPTS" ] && export RSYNC_RSH="ssh $SSH_OPTS"
ssh() { command ssh ${=SSH_OPTS} "$@"; }
APPDIR=/opt/stack/apps/tekserp-demo
DB=tekserp_demo          # ⚠️ SABİT. Parametreyle değiştirilemez.
DB_OWNER=tekserp
PG_CONTAINER=postgres    # komşu canlı servislerin de kullandığı konteyner
APP_CONTAINER=tekserp-demo
APP_URL=https://demo.etkiliyazilim.com
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP=$APPDIR/backups/pre-reset_${DB}_${STAMP}.dump

say() { print -r -- ""; print -r -- "▸ $*"; }
run() {
  if [ "$APPLY" -eq 1 ]; then
    print -r -- "  \$ $*"
    eval "$@" || { print -r -- "  ❌ BAŞARISIZ (çıkış $?) — SIFIRLAMA DURDURULDU"; exit 1; }
  else
    print -r -- "  [kuru] $*"
  fi
}
# Kuru çalışmada da GERÇEKTEN koşan salt-okunur yoklama (ölçüm olmadan
# "ne silineceğini" göstermek, kullanıcıya soyut bir söz vermek olurdu).
peek() { ssh "$HOST" "$1" 2>/dev/null }

print -r -- "=== DEMO SIFIRLAMA — $([ $APPLY -eq 1 ] && echo 'UYGULA' || echo 'KURU ÇALIŞMA') ==="
print -r -- "  sunucu : $HOST"
print -r -- "  hedef  : $DB   (SABİT — parametreyle değiştirilemez)"
print -r -- "  yedek  : $BACKUP"

# --- 0) NE SİLİNECEK -----------------------------------------------------------
say "0/8 Silinecek verinin dökümü (salt-okunur)"
peek "sudo docker exec $PG_CONTAINER psql -U postgres -d $DB -tAF' | ' -c \"
SELECT 'boyut', pg_size_pretty(pg_database_size('$DB'))
UNION ALL SELECT 'kullanici', count(*)::text FROM users
UNION ALL SELECT 'cari kart', count(*)::text FROM customers
UNION ALL SELECT 'top', count(*)::text FROM rolls
UNION ALL SELECT 'sevkiyat', count(*)::text FROM shipments
UNION ALL SELECT 'fatura', count(*)::text FROM invoices
UNION ALL SELECT 'cek', count(*)::text FROM cheques
UNION ALL SELECT 'kasa hareketi', count(*)::text FROM cash_transactions;\"" | sed 's/^/  /'
if [ "$APPLY" -eq 0 ]; then
  print -r -- "  ⚠️ --apply ile koşulursa YUKARIDAKİ HER SATIR SİLİNİR."
fi

# --- YIKICI İŞLEM ONAYI -------------------------------------------------------
# Kök CLAUDE.md: "Yıkıcı işlemlerde detaylı onay zorunlu". Burada onay, silinecek
# veritabanının ADININ ELLE YAZILMASIDIR — "y/e" tuşu, kazayla basılabilecek bir
# tuştur ve tam da bu betiğin kaza yaptığı sınıfı kapatmaz.
#
# ⚠️ TTY YOKSA ONAY SORULAMAZ → REDDEDİLİR. Betik bir CI adımından, bir ajandan
# ya da `>/dev/null` ile çağrıldığında soru ekrana çıkmaz; "soruyu soramadım,
# devam ediyorum" davranışı sessiz yıkımdır. Otomasyon için bilinçli kapı:
# `--apply --yes` (niyet, çağıran tarafta yazılı olur).
if [ "$APPLY" -eq 1 ] && [ "$ASSUME_YES" -eq 0 ]; then
  if [ ! -t 0 ]; then
    print -r -- ""
    print -r -- "❌ ONAY ALINAMIYOR — terminal (TTY) yok, soru sorulamaz."
    print -r -- "   Bu betik VERİ SİLER; onaysız çalıştırılmaz."
    print -r -- "   Otomasyondan çağırıyorsanız niyeti AÇIKÇA yazın: --apply --yes"
    exit 3
  fi
  print -r -- ""
  print -r -- "⚠️ '$DB' veritabanı SİLİNİP sıfırdan kurulacak. Yukarıdaki tüm kayıtlar gider."
  print -rn -- "   Onaylamak için veritabanı adını yazın ($DB): "
  read -r ONAY
  if [ "$ONAY" != "$DB" ]; then
    print -r -- "   ✋ Onay eşleşmedi — hiçbir şey yapılmadı."
    exit 3
  fi
fi

# --- 1) Uygulamayı durdur ------------------------------------------------------
say "1/8 docker compose stop app  (açık bağlantı DROP'u engeller)"
run "ssh $HOST 'cd $APPDIR && sudo docker compose stop app'"

# --- 2) Yedek ------------------------------------------------------------------
say "2/8 DROP öncesi yedek → $BACKUP"
run "ssh $HOST 'sudo docker exec $PG_CONTAINER pg_dump -U postgres -Fc $DB | sudo tee $BACKUP > /dev/null'"
if [ "$APPLY" -eq 1 ]; then
  # ⚠️ Boyut DOĞRULANIR. `pg_dump | tee` boru zincirinde pg_dump'ın çıkış kodu
  # kaybolur (son komut `tee` başarılıdır) → sıfır baytlık bir "yedek" sessizce
  # oluşur ve DROP ondan sonra gelir. Bu kontrol o pencereyi kapatır.
  SIZE=$(ssh "$HOST" "sudo stat -c %s '$BACKUP' 2>/dev/null || echo 0")
  print -r -- "  yedek boyutu: ${SIZE} bayt"
  if [ "${SIZE:-0}" -lt 10000 ]; then
    print -r -- "  ❌ Yedek alınamadı ya da şüpheli küçük — SIFIRLAMA DURDURULDU."
    print -r -- "     Uygulamayı geri kaldırın: ssh $HOST 'cd $APPDIR && sudo docker compose up -d'"
    exit 1
  fi
fi

# --- 3) DROP / CREATE ----------------------------------------------------------
say "3/8 DROP + CREATE $DB  (⚠️ YIKICI)"
# Artık bağlantılar düşürülür — healthcheck ya da unutulmuş bir psql oturumu
# `DROP DATABASE`'i "is being accessed by other users" ile reddettirir.
run "ssh $HOST \"sudo docker exec $PG_CONTAINER psql -U postgres -d postgres -c \\\"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB' AND pid <> pg_backend_pid();\\\"\""
run "ssh $HOST \"sudo docker exec $PG_CONTAINER psql -U postgres -d postgres -c 'DROP DATABASE IF EXISTS $DB;'\""
run "ssh $HOST \"sudo docker exec $PG_CONTAINER psql -U postgres -d postgres -c 'CREATE DATABASE $DB OWNER $DB_OWNER;'\""

# --- 4) Per-DB ayar ------------------------------------------------------------
say "4/8 statement_timeout = 50s  (DROP ile kaybolur — migration GERİ GETİRMEZ)"
run "ssh $HOST \"sudo docker exec $PG_CONTAINER psql -U postgres -d postgres -c \\\"ALTER DATABASE $DB SET statement_timeout = '50s';\\\"\""

# --- 5) Migration --------------------------------------------------------------
say "5/8 prisma migrate deploy"
run "ssh $HOST 'cd $APPDIR && sudo docker compose run --rm --entrypoint sh app -c \"npx prisma migrate deploy\"'"

# --- 6) Seed'ler (SIRA ÖNEMLİ) -------------------------------------------------
say "6/8 seed.ts  → izin + rol katalogları, admin, istasyonlar"
run "ssh $HOST 'cd $APPDIR && sudo docker compose run --rm --entrypoint sh app -c \"npx tsx prisma/seed.ts\"'"

say "7/8 seed-ticaret-demo.ts  → demo verisi + WEB_TRADE yetkisi"
# ⚠️ Bu seed idempotenttir ve KENDİ mükerrer taramasını koşar; mükerrer bulursa
# çıkış kodu 1 verir → `run` betiği durdurur. Sıfır veritabanında kırmızı
# vermesi, seed'in bir yazma yolunda `clientToken` çıpasını kaybettiği anlamına
# gelir (bkz. `findDuplicateDemoRecords` başlığı).
run "ssh $HOST 'cd $APPDIR && sudo docker compose run --rm --entrypoint sh app -c \"npx tsx prisma/seed-ticaret-demo.ts\"'"

say "7.5/8 seed-demo-full.ts  → tam vitrin (katalog · sipariş · üretim · sevkiyat · muhasebe)"
# ⚠️ SIRA: ticaret seed'inden SONRA. Bu seed onun ürettiği carileri, kasa/banka
# hesaplarını ve `demo` kullanıcısını KULLANIR (demo hesabına ADMIN_FULL uygular).
#
# ⚠️ ÇIKIŞ KODU 1 = "bir ekran BOŞ kalacak" ya da bir senaryo sessizce atlandı.
# Seed kendi kabul ölçütlerini ölçer (en önemlisi: bitmiş/sevk edilmiş hiçbir top
# RENKSİZ olamaz) ve ekran doluluk tablosunu basar. `run` betiği durdurur — bu
# BİLİNÇLİDİR: boş ekranla yayına çıkmak, demonun tek kabul edilemez sonucudur.
run "ssh $HOST 'cd $APPDIR && sudo docker compose run --rm --entrypoint sh app -c \"npx tsx prisma/seed-demo-full.ts\"'"

# --- 8) Ayağa kaldır + doğrula -------------------------------------------------
say "8/8 docker compose up -d + doğrulama"
run "ssh $HOST 'cd $APPDIR && sudo docker compose up -d'"

if [ "$APPLY" -eq 1 ]; then
  print -r -- "  … konteyner sağlıklı olana kadar bekleniyor"
  for i in {1..30}; do
    st=$(ssh "$HOST" "sudo docker inspect -f '{{.State.Health.Status}}' $APP_CONTAINER 2>/dev/null" 2>/dev/null)
    [ "$st" = "healthy" ] && { print -r -- "  ✓ healthy"; break; }
    sleep 5
  done

  print -r -- "  --- uçlar (404 = MOUNT YOK; 401 kesin sinyal DEĞİL) ---"
  for u in /health /api/finance/cheques /api/finance/period-closes /api/finance/cash-period-closes \
           /api/reports/finance/aging /api/purchase-orders /api/item-prices; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$APP_URL$u")
    mark=$([ "$code" = "404" ] && echo "❌ MOUNT YOK" || echo "✓")
    printf '  %-38s %s  %s\n' "$u" "$code" "$mark"
  done

  print -r -- "  --- katalog + demo verisi ---"
  # Demo verisi sayaçları seed'in özet bloğuyla AYNI şeyi ölçer; ikisi ayrışırsa
  # seed'in bir bölümü sessizce atlanmış demektir (uyarı satırı yutulmuş olabilir).
  ssh "$HOST" "sudo docker exec $PG_CONTAINER psql -U $DB_OWNER -d $DB -tAF' | ' -c \"
SELECT 'izin katalogu', count(*)::text FROM permissions
UNION ALL SELECT 'WEB_TRADE sablonu', count(*)::text FROM permission_template_items i JOIN permission_templates t ON t.id=i.\\\"templateId\\\" WHERE t.code='WEB_TRADE'
UNION ALL SELECT 'demo kullanicisi', count(*)::text FROM user_permissions up JOIN users u ON u.id=up.\\\"userId\\\" WHERE u.username='demo'
UNION ALL SELECT 'migration', count(*)::text FROM _prisma_migrations WHERE finished_at IS NOT NULL
UNION ALL SELECT 'demo cari kart', count(*)::text FROM customers WHERE code LIKE 'DEMO-%'
UNION ALL SELECT 'alis siparisi', count(*)::text FROM purchase_orders
UNION ALL SELECT 'mal kabul', count(*)::text FROM goods_receipts
UNION ALL SELECT 'top', count(*)::text FROM rolls
UNION ALL SELECT 'sevkiyat', count(*)::text FROM shipments
UNION ALL SELECT 'iade', count(*)::text FROM roll_returns WHERE \\\"cancelledAt\\\" IS NULL
UNION ALL SELECT 'fatura', count(*)::text FROM invoices
UNION ALL SELECT 'cek', count(*)::text FROM cheques
UNION ALL SELECT 'kasa hareketi', count(*)::text FROM cash_transactions
UNION ALL SELECT 'donem kapanisi (cari)', count(*)::text FROM cari_period_closes WHERE \\\"reopenedAt\\\" IS NULL
UNION ALL SELECT 'donem kapanisi (kasa)', count(*)::text FROM cash_period_closes WHERE \\\"reopenedAt\\\" IS NULL;\"" 2>/dev/null | sed 's/^/  /'

  print -r -- ""
  print -r -- "  Geri dönüş (yedekten): "
  print -r -- "    ssh $HOST 'cd $APPDIR && sudo docker compose stop app'"
  print -r -- "    ssh $HOST \"sudo docker exec -i $PG_CONTAINER pg_restore -U postgres -d $DB --clean --if-exists < $BACKUP\""
  print -r -- "    ssh $HOST 'cd $APPDIR && sudo docker compose up -d'"
else
  print -r -- "  [kuru] uç yoklaması + sayı doğrulaması --apply ile koşar"
fi

print -r -- ""; print -r -- "=== BİTTİ ==="
# ⚠️ Son satır bir TEST OLAMAZ: zsh betiğin çıkış kodunu son komuttan alır ve
# APPLY=1 iken bu test false döner → BAŞARILI sıfırlama "exit 1" raporlanır
# (deploy-demo.sh'ta bir kez yaşandı ve deploy başarısız sanıldı).
if [ "$APPLY" -eq 0 ]; then
  print -r -- "Gerçek sıfırlama için: zsh demo-reset.sh --apply"
  print -r -- "⚠️ VERİ SİLER. Önce yedek alınır ve boyutu doğrulanır; DROP ondan sonra gelir."
fi
exit 0
