# Sürüm 2026-07-31 — Deploy Reçetesi (veri bütünlüğü denetimi sürümü)

> **BU DOSYA YARIN SUNUCUDA ÇALIŞACAK CLAUDE'A NOTTUR** (Windows Server, canlı DB).
> Mac'teki oturum belleği sunucuda YOK — bağlamın tamamı bu dosya + repo.
> Genel kurallar `DEPLOY-RUNBOOK.md` + `URETIM-KONTROL-LISTESI.md`; burada yalnız
> bu sürümün migration'ları, ön-taramaları, doğrulamaları ve tuzakları var.
> Denetim arka planı: `docs/audit/VERI-BUTUNLUGU-RAPORU-2026-07-31.md`.

---

## İLK 5 DAKİKA (sunucuda oturum açar açmaz)

1. Bu dosyayı SONUNA KADAR oku; sonra `DEPLOY-RUNBOOK.md §3` (güncelleme akışı).
2. `git log --oneline -10` — şu 7 commit gelmiş olmalı (gelmediyse DUR, pull sorunu):
   `docs(denetim)` → `fix(yarış)` → `feat(db) 18 constraint` → `fix(denetim) A3/A5/A9/A10`
   → `feat(idempotency) Sack+Shipment` → `fix(denetim düşük-öncelik)` → bu reçete.
3. Canlı DB'de bekleyen migration setini gör (aşağıdaki §1 sorgusu) — **2026-07-30
   sürümü de bekliyorsa** `SURUM-2026-07-30-DEPLOY.md` reçetesi DE geçerlidir
   (özellikle oradaki 0a: iş emri kapatma sözleşmesi → Electron'suz backend deploy'u
   iş emri kapatmayı kullanılamaz yapar).
4. Kullanıcıyla vardiya penceresini teyit et — `CREATE INDEX`/`VALIDATE` çalışma
   saatinde koşmaz (kök kural 14).
5. İşe §2'deki SALT-OKUNUR taramalarla başla. Yazan hiçbir şey ön-tarama + yedek
   bitmeden koşmaz.

## ⛔ CANLI VERİ MUTLAK YASAKLARI

- `prisma migrate reset` / `npm run seed` / `seed:fixtures` — ASLA.
- **`npm test` CANLIDA ASLA** — test scriptleri fixture YARATIR (TEST- kayıtları
  canlı DB'ye yazılır; `test_admin_guard_race` gerçek admin'leri geçici pasifler!).
  Canlıda koşması güvenli tek test: `npx tsx scripts/test_db_invariants.ts`
  (salt pg-katalog okur, 55 kontrol) — deploy sonrası KOŞ.
- Toplu `DELETE`/`UPDATE` yok; veri düzeltmesi gerekirse dry-run script + kullanıcı onayı.
- `db-copy`/restore akışları canlı DB'yi hedeflemez (kopya DB'ye çalışır).
- Tarama sorguları salt-okunur; sonuçları dosyaya logla, yorumla, DOKUNMA.

---

## 0a) ⚠️ SÜRÜM EŞLEŞMESİ — mobil OLMADAN backend deploy ETME

**`POST /api/orders/quick-from-rolls` artık `clientToken` ZORUNLU** (Zod, denetim A3).
Mobil token desteği `8cee4a3` ile geldi ve **bu dağıtım penceresinin içinde** —
sahadaki mevcut APK token GÖNDERMİYOR. Yalnız backend güncellenirse:

- Mobil **Hızlı Sipariş** (TartıPaket → HizliSiparisScreen) her denemede
  `400 — Geçersiz istemci anahtarı / Invalid input` alır → özellik kullanılamaz.
- Sessiz veri bozulması YOK (istek tamamen reddedilir) ama saha çağrısı gelir.

→ **Backend + mobil APK aynı pencerede.** Electron bu uca hiç çağrı yapmıyor
(grep 2026-07-31) ama 2026-07-30 sürümü bekliyorsa Electron da zorunlu (0a orada).
Diğer yeni token'lar (`openSack`/`createShipment`) OPSİYONEL — eski istemci bozulmaz.

**APK HAZIR (2026-07-31 Mac'te derlendi):** `TeksERP-mobil-2.1.2-vc7.apk`
(Mac Desktop'ta + `mobil/android/app/build/outputs/apk/release/app-release.apk`;
eski 2.1.1-vc6 SİLİNDİ — tek geçerli APK bu). Sürüm 2.1.2 / versionCode 7;
içerik: token'lar + **Tambur GERİ AL** (Üretilen Toplar → geri al ikonu);
`EXPO_PUBLIC_API_URL=http://192.168.1.50:4000/api` gömülü (bundle'da doğrulandı —
sunucu IP'si bu DEĞİLSE yeniden derleme gerekir!).
İmza: debug keystore (repo standardı — önceki sideload APK'larla aynı yol).
Tablette güncelleme "imza uyuşmazlığı" ile reddedilirse: kaldır + yeniden kur
(operatör yeniden login olur, cihaz kaydı `deviceId` upsert'i sayesinde korunur).

## 0b) Operatöre önceden söylenecek davranış değişiklikleri (bu sürüm)

| Ne değişti | Görünen etki |
|---|---|
| Sipariş düzenleme yarış koruması | Nadir durumda yeni 409: "Sipariş durumu bu sırada değişti — sayfayı yenileyip tekrar deneyin." |
| Kalıcı silme guard'ları | Kumaş (hedefleyen İE varsa) / müşteri (özel rotası varsa) / cihaz (bağlı terazi-yazıcı varsa) için yeni, anlamlı engel mesajları |
| Sevkiyat/çuval retry | Yeni istemcilerde timeout-retry artık "zaten sürüyor/409" yerine kurulan kaydın kendisini döndürür |
| Son admin koruması | Davranış aynı (son admin pasife alınamaz), artık eşzamanlı istekte de delinemez |

Yeni permission YOK; SystemSetting değişikliği YOK.

---

## 1) Bekleyen migration setini gör (salt-okunur)

```sql
-- psql -U <user> -d TeksErpDb  (psql yolu: DEPLOY-RUNBOOK §0)
SELECT migration_name FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 10;
```

Bu sürümün ÜÇ migration'ı (dizinde var, canlıda henüz yok olmalı):

| Migration | İçerik | Risk notu |
|---|---|---|
| `20260731120000_audit_check_hardening` | 18 CHECK (NOT VALID + VALIDATE) | **VALIDATE ihlalde DÜŞER** → §2 ön-taraması ŞART |
| `20260731150000_sack_shipment_client_token` | sacks+shipments `clientToken` kolon + unique | Küçük/hızlı; kırıcı değil |
| `20260731160000_lowprio_unique_hardening` | route_steps/customer_branches unique + users/permission_templates `lower()` unique | **CREATE UNIQUE ihlalde DÜŞER** → §2 ön-taraması ŞART |

Üçü de dev'de bugünkü elle-akışla uygulanıp doğrulandı; `migrate deploy` aynı SQL'i koşar.
Hepsinin başında `SET statement_timeout = 0` var (canlıdaki 50s limiti DDL'i kesmesin).

## 2) Deploy ÖNCESİ ön-tarama — SALT-OKUNUR, hepsi 0 dönmeli

**2a. CHECK ihlal taraması (18 kural):** herhangi biri > 0 ise `migrate deploy` KOŞMA —
satırları listele, kullanıcıya götür, veri kararı ver (dry-run script), sonra dön.

```sql
SELECT 'rm_qtyIn', count(*) FROM roll_movements WHERE "qtyIn" < 0
UNION ALL SELECT 'rm_qtyOut', count(*) FROM roll_movements WHERE "qtyOut" IS NOT NULL AND "qtyOut" < 0
UNION ALL SELECT 'rm_weightIn', count(*) FROM roll_movements WHERE "weightIn" IS NOT NULL AND "weightIn" < 0
UNION ALL SELECT 'rm_weightOut', count(*) FROM roll_movements WHERE "weightOut" IS NOT NULL AND "weightOut" < 0
UNION ALL SELECT 're_startMeter', count(*) FROM roll_errors WHERE "startMeter" < 0
UNION ALL SELECT 'sa_qty', count(*) FROM sack_allocations WHERE qty <= 0
UNION ALL SELECT 'wtol_alloc', count(*) FROM work_order_to_order_lines WHERE "allocatedQty" < 0
UNION ALL SELECT 'sdi_qty', count(*) FROM subcontractor_dispatch_items WHERE "dispatchedQty" <= 0
UNION ALL SELECT 'sdi_weight', count(*) FROM subcontractor_dispatch_items WHERE "dispatchedWeight" IS NOT NULL AND "dispatchedWeight" < 0
UNION ALL SELECT 'kdi_qty', count(*) FROM kartela_dispatch_items WHERE "dispatchedQty" <= 0
UNION ALL SELECT 'kdi_weight', count(*) FROM kartela_dispatch_items WHERE "dispatchedWeight" IS NOT NULL AND "dispatchedWeight" < 0
UNION ALL SELECT 'kri_count', count(*) FROM kartela_receipt_items WHERE "kartelaCount" <= 0
UNION ALL SELECT 'ssr_count', count(*) FROM swatch_stock_reductions WHERE count <= 0
UNION ALL SELECT 'rr_qty', count(*) FROM roll_returns WHERE qty <= 0
UNION ALL SELECT 'dsa_qty', count(*) FROM subcontractor_direct_ship_allocations WHERE qty <= 0
UNION ALL SELECT 'ds_totalQty', count(*) FROM direct_shipments WHERE "totalQty" <= 0
UNION ALL SELECT 'ds_rollCount', count(*) FROM direct_shipments WHERE "rollCount" <= 0
UNION ALL SELECT 'wo_stockprod', count(*) FROM work_orders WHERE type = 'STOCK_PRODUCTION' AND "targetItemId" IS NULL;
```

**2b. Unique ihlal taraması (4 kural):** aynı kural — > 0 ise DUR.

```sql
SELECT 'route_steps dup', count(*) FROM (SELECT "routeId", sequence FROM route_steps GROUP BY 1,2 HAVING count(*)>1) x
UNION ALL SELECT 'branch dup', count(*) FROM (SELECT "customerId", code FROM customer_branches WHERE code IS NOT NULL GROUP BY 1,2 HAVING count(*)>1) y
UNION ALL SELECT 'username lower dup', count(*) FROM (SELECT lower(username) FROM users GROUP BY 1 HAVING count(*)>1) z
UNION ALL SELECT 'template lower dup', count(*) FROM (SELECT lower(name) FROM permission_templates GROUP BY 1 HAVING count(*)>1) w;
```

**2c. Genel hasar taraması:** `psql -d TeksErpDb -f Teks-Erp/scripts/consistency-check.sql > tutarlilik-oncesi.log`
— §1-§19 tamamı. Çıkan satırlar deploy'u durdurmaz (yalnız 2a/2b durdurur) ama
İLK GERÇEK ENVANTERDİR; sınıflandırma rehberi raporun "Dev DB Koşum Sonuçları"
tablosunda (§10 = Kurtar adayı; §12 = 64263fc cutover'ı öncesi kalıntı olabilir;
§15/§16 üretimde gerçek anomali).

## 3) Yedek — migration'lardan HEMEN ÖNCE

`DEPLOY-RUNBOOK §3 adım 1`: `premigrate_` ön-ekli yedek + doğrulama
(`pg_restore --list`). Bu ön-ek rotasyona GİRMEZ (backup-naming.helper) — geri
dönüş noktası budur. Yedek DOĞRULANMADAN migration koşulmaz.

## 4) Deploy (vardiya dışı)

```powershell
# Teks-Erp/ içinde, DEPLOY-RUNBOOK §3 sırasıyla:
git pull
npm install            # package.json değişmedi ama zararsız
npm run prisma:generate
npm run prisma:migrate # = migrate deploy → 3 migration (+ bekleyen eski sürüm varsa onlar)
pm2 restart teks-erp-backend
```

**Doğrulama (migrate deploy "başarılı" demesi YETMEZ — D-23):**

```sql
-- 18 CHECK: beklenen «18 | t»
SELECT count(*), bool_and(convalidated) FROM pg_constraint WHERE conname IN
('roll_movements_qtyIn_nonneg','roll_movements_qtyOut_nonneg','roll_movements_weightIn_nonneg',
 'roll_movements_weightOut_nonneg','roll_errors_startMeter_nonneg','sack_allocations_qty_pos',
 'subcontractor_direct_ship_allocations_qty_pos','work_order_to_order_lines_allocatedQty_nonneg',
 'subcontractor_dispatch_items_dispatchedQty_pos','subcontractor_dispatch_items_dispatchedWeight_nonneg',
 'kartela_dispatch_items_dispatchedQty_pos','kartela_dispatch_items_dispatchedWeight_nonneg',
 'kartela_receipt_items_kartelaCount_pos','swatch_stock_reductions_count_pos',
 'direct_shipments_totalQty_pos','direct_shipments_rollCount_pos','roll_returns_qty_pos',
 'work_orders_stockprod_targetItem');
-- 6 yeni index: beklenen «6»
SELECT count(*) FROM pg_indexes WHERE indexname IN
('sacks_clientToken_key','shipments_clientToken_key','route_steps_routeId_sequence_key',
 'customer_branches_customerId_code_key','users_username_lower_uq','permission_templates_name_lower_uq');
```

Sonra: `npx tsx scripts/test_db_invariants.ts` → **55/55** (canlıda güvenli tek test).

## 5) Deploy SONRASI duman

- `GET /health` — havuz metrikleri + audit sayacı normal.
- `pm2 logs teks-erp-backend --lines 50` — P2022/başlangıç hatası yok;
  `[backup] scheduler aktif` satırı var (BACKUP_DIR uyarısı GÖRÜNMEMELİ).
- `URETIM-KONTROL-LISTESI.md` duman adımları (salt-okunur olanlar).
- Mobil APK + Electron dağıtımı kullanıcının; backend doğrulanmadan başlatmasın.

## 6) Rollback

- **Kod:** `pm2 stop` + önceki sürüme checkout + restart — bu sürümün şeması eski
  kodla uyumlu (CHECK'ler eski kodun zaten ürettiği kural-içi veriyi engellemez;
  clientToken kolonları nullable). Şemayı geri almak GEREKMEZ.
- **Veri/şema felaketi:** `premigrate_` yedeğinden restore — DEPLOY-RUNBOOK §5
  (pm2 stop + pg_restore, elle; `$LASTEXITCODE` guard notuna dikkat).

## 7) Bitince

- `tutarlilik-oncesi.log` bulgularını kullanıcıyla değerlendir (özellikle §10
  Kurtar adayları — operatöre yaptırılır, elle SQL değil).
- Bu dosyanın başına "UYGULANDI: <tarih> — sonuç" satırı ekle + raporun G-4
  maddesindeki "üretim kopyasında ilk koşum" kalanını kapat.
