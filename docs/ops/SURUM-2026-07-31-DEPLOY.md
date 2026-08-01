# Sürüm 2026-07-31 — Deploy Reçetesi (veri bütünlüğü denetimi sürümü)

> **BU DOSYA YARIN SUNUCUDA ÇALIŞACAK CLAUDE'A NOTTUR** (Windows Server, canlı DB).
> Mac'teki oturum belleği sunucuda YOK — bağlamın tamamı bu dosya + repo.
> Genel kurallar `DEPLOY-RUNBOOK.md` + `URETIM-KONTROL-LISTESI.md`; burada yalnız
> bu sürümün migration'ları, ön-taramaları, doğrulamaları ve tuzakları var.
> Denetim arka planı: `docs/audit/VERI-BUTUNLUGU-RAPORU-2026-07-31.md`.

---

## İLK 5 DAKİKA (sunucuda oturum açar açmaz)

1. Bu dosyayı SONUNA KADAR oku; sonra `DEPLOY-RUNBOOK.md §3` (güncelleme akışı).
2. Pull'un tam geldiğini **sayıyla değil, içerikle** doğrula. (Buradaki eski "şu 7
   commit gelmiş olmalı" listesi 2026-08-01'de bayatladı: kurşun bypass işi +
   denetim düzeltmeleri aynı pencereye girdi, sayı artık tutmuyor. Bayat sayı
   "DUR" dedirtip deploy'u boş yere durdurur.) Mekanik kontrol:

   ```bash
   git status                      # temiz olmalı (untracked/modified YOK)
   npx prisma migrate status       # "Following migrations have not yet been applied"
   node scripts/check-migrations.mjs   # commit edilmemiş migration/test/script referansı YOK
   ```

   `check-migrations.mjs` GATE 5'i özellikle önemli: commit'li `package.json`'un
   çağırdığı bir dosya (ör. `tsconfig.scripts.json`, `mobil/scripts/build-apk.mjs`)
   pull'a girmemişse `npm test` / `npm run build:apk` ilk satırda ölür.
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
  (salt pg-katalog okur, **61 kontrol** — 2026-08-01'de 56'dan çıktı: envanter-DIŞI
  nesne tespiti artık 5 bölümün 5'inde de KIRMIZI veriyor, eskiden `exit 0`'lı
  sessiz bir ⚠️ idi). Deploy sonrası KOŞ.
  **`scripts/test_schema_drift.ts` de canlıda güvenlidir** (salt `migrate diff`,
  yazma yok) — deploy sonrası koş: repo şeması ile canlı DB arasında yalnız 2
  bilinen DEFERRABLE composite FK farkı kalmalı. Bu bekçi olmasaydı yukarıdaki
  `sacks_customerId_fkey` sapması bulunamazdı.
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

**APK** — güncel paket `mobil/android/app/build/outputs/apk/release/app-release.apk`.
Sürüm için `android/app/build.gradle`'daki `versionName`/`versionCode` geçerlidir;
`npm run build:apk` derleme sonunda ikisini de ekrana basar. Gömülü sunucu adresi
**`http://192.168.1.250:4000/api`** (SAHINSRV — `DEPLOY-RUNBOOK.md` "SAHADAKİ
KURULUM"). Kurmadan önce **doğrula**, tahmin etme:

```bash
cd mobil && EXPO_PUBLIC_API_URL=http://192.168.1.250:4000/api npm run build:apk:verify
```

> ⚠ **DÜZELTME (2026-08-01):** bu satırlarda daha önce `192.168.1.50` yazıyordu —
> **yanlıştı**, gerçek sunucu `.250`. Bir APK bu bayat adrese gömülü derlendi ve
> hata vermeden sahada "bağlanamıyor" oldu. Ayrıca `EXPO_PUBLIC_API_URL`
> değişikliği Gradle'ın bundle görevini geçersiz kılmadığı için env'i değiştirip
> `assembleRelease` koşmak **yetmiyor** (eski bundle yeniden paketleniyor).
> Bu yüzden APK artık yalnız `npm run build:apk` ile derlenir: önbellekleri siler,
> derler ve üretilen paketin İÇİNDEN adresi tekrar okur. Ayrıntı ve tuzaklar:
> `mobil/CLAUDE.md` → "APK derleme".

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
| **Saat dilimi düzeltmesi (O-11) — RAPOR RAKAMLARINI DEĞİŞTİRİR** | Aşağıya bak; operatöre **deploy'dan ÖNCE** söylenmeli |

Yeni permission YOK; SystemSetting değişikliği YOK.

### ⚠️ O-11 saat dilimi düzeltmesi — operatöre ÖNCEDEN söyle

Ham SQL 13 noktada `roll_movements."exitedAt"` gibi **tz'siz** kolonlara çıplak
`NOW()` yazıyor/okuyordu. PostgreSQL sunucusu `Europe/Istanbul` olduğu için bu
**yerel** saat yazıyordu, Prisma ise aynı kolona **UTC** yazıyor → tek kolonda iki
saat. Sonuç: her istasyon geçişi süresi **tam +3 saat (10800 sn) şişik**. Hata yok,
log yok, kimse görmedi. Düzeltildi (`now() AT TIME ZONE 'UTC'`); ölçüldü: düzeltme
sonrası yeni bir kapanışta `exitedAt − enteredAt = 0,04 sn` (eskiden 10800 sn).

**Operatörün göreceği şey — bu bir hata değil, düzelmedir:**

| Rapor | Deploy sonrası ne olur |
|---|---|
| İstasyon/makine **süre** raporları (ortalama işlem süresi) | Yeni hareketler **3 saat DAHA KISA** görünür. Eski hareketler şişik KALIR → geçiş döneminde rapor **karışık** (eski+yeni) olur. |
| **Top yaşlandırma** (`getRollAging`, 0-3/3-7/14-30 gün kovaları) | Toplar 3 saat **daha genç** sayılır; kova sınırındakiler bir alt kovaya kayar. |
| **Geciken siparişler** (`getLateDeliveries`) | Sipariş artık termininden **3 saat önce** değil, tam zamanında "geciken"e düşer → liste birkaç satır **kısalabilir**. |

**GEÇMİŞ VERİ BİLİNÇLİ OLARAK DÜZELTİLMEDİ** (canlı veriye dokunma kararı, kullanıcı
onaylı). Eski `roll_movements` satırları hâlâ +3 saat şişik duruyor. Yani:

> Deploy'dan sonra "süre raporu neden düştü / yaşlandırma neden değişti" sorusu
> gelirse cevap: **eski rakamlar yanlıştı, yenisi doğru.** Kıyaslama yapan bir
> operatör varsa (ör. aylık istasyon verimliliği) deploy tarihini kırılma noktası
> olarak not etsin — o tarihten öncesi ve sonrası aynı grafikte karşılaştırılamaz.

Geriye dönük düzeltme istenirse ayrı bir iş: dry-run script + kullanıcı onayı
(kök kural — toplu UPDATE bu sürümün kapsamında DEĞİL).

---

## 1) Bekleyen migration setini gör (salt-okunur)

```sql
-- psql -U <user> -d tekserp  (psql yolu: DEPLOY-RUNBOOK §0)
SELECT migration_name FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 10;
```

Bu sürümün migration'ları (dizinde var, canlıda henüz yok olmalı). **Not (2026-08-01):**
bu tablo başta ÜÇ satırdı; kurşun bypass işi, denetim düzeltmeleri ve timestamptz
dönüşümü aynı pencereye girdiği için **SEKİZ**e çıktı. Kanonik liste her zaman
`ls Teks-Erp/prisma/migrations`
+ `npx prisma migrate status` çıktısıdır — tabloya değil, ona güven.

| Migration | İçerik | Risk notu |
|---|---|---|
| `20260731120000_audit_check_hardening` | 18 CHECK (NOT VALID + VALIDATE) | **VALIDATE ihlalde DÜŞER** → §2 ön-taraması ŞART |
| `20260731120000_add_kursun_bypass_assignment` | `kursun_bypass_assignments` tablosu | Yeni tablo; kırıcı değil |
| `20260731150000_sack_shipment_client_token` | sacks+shipments `clientToken` kolon + unique | Küçük/hızlı; kırıcı değil |
| `20260731160000_lowprio_unique_hardening` | route_steps/customer_branches unique + users/permission_templates `lower()` unique | **CREATE UNIQUE ihlalde DÜŞER** → §2 ön-taraması ŞART |
| `20260731210000_kursun_bypass_machine_assignment` | bypass ataması istasyon→MAKİNE bazına | Kurşun bypass işine ait |
| `20260801020000_kursun_bypass_permission_catalog` | bypass izin satırları (`ON CONFLICT DO NOTHING`) | İdempotent; boot uzlaştırması da aynı işi yapar |
| `20260801030000_sack_customer_fk_setnull` | `sacks_customerId_fkey` → `ON DELETE SET NULL` | **Yalnız constraint tanımı** — satır okumaz/yazmaz, rewrite YOK. Canlıda aylardır `RESTRICT`'ti (şema `SET NULL` diyordu); kayıp migration'ın telafisi. Dev'de no-op. |
| `20260801040000_timestamptz_conversion` | 80 tablo / **183 kolon** `timestamp` → `timestamptz` | **⚠️ TEK AĞIR MİGRATION — TAM TABLO YENİDEN YAZIMI + ACCESS EXCLUSIVE kilit.** Bkz. §1b. |
| `20260801050000_system_log_daily_stats_tz` | `sl_day_exact` ifade istatistiği fabrika saat dilimli ifadeye taşındı | **Yalnız katalog + `ANALYZE system_logs`** — DDL yok, tabloya kilit yok, satır okumaz/yazmaz. Bkz. §1c. |

Hepsi dev'de uygulanıp doğrulandı; `migrate deploy` aynı SQL'i koşar.
Hepsinin başında `SET statement_timeout = 0` var (canlıdaki 50s limiti DDL'i kesmesin).

### 1b) `20260801040000_timestamptz_conversion` — ayrı okunacak

**Ne yapar:** tüm tarih kolonlarını saat dilimi TAŞIYAN tipe çevirir. Böylece kim yazarsa
yazsın (Prisma / ham `NOW()` / kolon DEFAULT'u) aynı mutlak an kaydedilir; 2026-08-01
gecesi `roll_movements."exitedAt"`te yaşanan "tek kolonda iki saat / +10800 sn şişme"
hata sınıfı **yapısal olarak** kapanır (öncesi yalnız disiplin bekçisiydi).

**Neden şimdi:** fabrikada henüz gerçek üretim verisi yok (tanımlar + siparişler).
Tablolar boşken her ALTER anlık; veri biriktikten sonra `roll_movements` gibi tablolarda
bu iş vardiya durdurur. **Bu pencere ilk gerçek top girdiği gün kapanır — erteleme.**

**Vardiya dışında koş** (CLAUDE.md DB kuralı 14). Canlıda tablolar boşsa saniyeler sürer.

**Ne kadar sürer — ÖLÇÜLDÜ (2026-08-01, dolu dev DB kopyası):** 183 kolonun tamamı
**≈ 2,1 sn** (aynı turda geri+ileri 384 ALTER = 4,26 sn). Dev DB'de `system_logs` 38 267
satır / 21 MB, `rolls` 15 133 satır / 12 MB idi; tek tek ALTER'lar 1–5 ms, yalnız
`system_logs`'un iki kolonu 401 ms ve 489 ms sürdü. **Maliyet satır sayısıyla doğrusal
büyür** (tam tablo yeniden yazımı): fabrikada `roll_movements` milyona çıktığında bu iş
saniyeler değil dakikalar olur ve o süre boyunca tablo ACCESS EXCLUSIVE kilitlidir —
yani vardiya durur. Bugün canlıda tablolar boş; **bu yüzden şimdi koşuluyor.**

**Uygulama SONRASI doğrulama — atlanamaz:**

```sql
-- (1) tz'siz kolon KALMAMALI → 0 dönmeli
SELECT count(*) FROM information_schema.columns
 WHERE table_schema='public' AND data_type='timestamp without time zone';
-- (2) tarih kolonları timestamptz olmalı → 192 (+3 _prisma_migrations)
SELECT count(*) FROM information_schema.columns
 WHERE table_schema='public' AND data_type='timestamp with time zone';
```

```bash
# (3) sözleşme bekçisi — DB + şema + havuz oturumu + ham SQL/ORM mutabakatı
npx tsx scripts/test_timestamptz_contract.ts
```

**⚠️ EPOCH KORUNUR — ama yalnız `USING` sayesinde.** Migration'daki her ALTER
`USING "kolon" AT TIME ZONE 'UTC'` taşır ("bu değerler UTC'dir" beyanı, çünkü Prisma UTC
yazmıştı). `USING` düşerse PG değerleri oturum saat diliminde yorumlar ve **her tarihi
3 saat kaydırır**. Dosyayı elle düzenleme. Dev'de doğrulandı: 183 kolonun
count/sum/min/max epoch parmak izi dönüşüm öncesi/sonrası birebir aynı (md5 eşit).

**⚠️ BİRLİKTE GİDEN KOD ŞART — migration'ı tek başına deploy etme.** `@prisma/adapter-pg`
timestamptz ile çalışırken oturumun UTC olduğunu **varsayar**; `src/lib/pg-session.ts` +
havuzdaki `options: "-c timezone=UTC"` olmadan Istanbul sunucusunda **okumalar +3 saat,
yazmalar −3 saat kayar** (ikisi de ölçüldü, hata/log ÇIKMAZ). Backend bu commit'le
birlikte deploy edilmezse dönüşüm faydadan çok zarar getirir.

**Geri alma — yedekten restore GEREKMEZ, ama iki şart var (2026-08-01'de ÖLÇÜLDÜ, ilk
yazılan hâli YANLIŞTI).** Ters çevirme listesi `... TYPE timestamp USING "kolon" AT TIME
ZONE 'UTC'` epoch'u korur, fakat **düz koşturulursa PATLAR**:

```
ERROR: check constraint "work_order_steps_time_order" of relation
       "work_order_steps" is violated by some row
```

**Neden (sezgiye aykırı, bir kez anla yeter):** `work_order_steps_time_order` iki tarih
kolonunu karşılaştırır — `completedAt >= startedAt`. ALTER'lar kolon kolon koştuğu için
arada **karışık tip** anı doğar: bir kolon çevrilmiş, diğeri değil. PG böyle bir
karşılaştırmada tz'siz olanı **oturumun saat diliminde** yorumlar. Istanbul (UTC+3)
oturumunda:

| Yön | Ara durumda ne olur | Sonuç |
|---|---|---|
| **İleri** (`timestamp`→`timestamptz`) | Alfabetik sırada `completedAt` önce çevrilir; henüz tz'siz olan `startedAt` 3 saat ERKEN görünür | Kısıt **daha kolay** sağlanır → **SORUNSUZ** (doğrulandı: Istanbul oturumunda ileri migration temiz koştu) |
| **Geri** (`timestamptz`→`timestamp`) | Bu kez çevrilmiş `completedAt` 3 saat ERKEN görünür | `completedAt >= startedAt` **BOZULUR** → gerçek gap'i 3 saatten kısa olan her satır kısıtı ihlal eder |

Yani **ileri yön güvenli, geri yön değil.** Geri alma gerekirse:

```sql
SET statement_timeout = 0;
SET timezone = 'UTC';   -- ⬅️ ZORUNLU. Bu satır olmadan yukarıdaki hatayı alırsın.
BEGIN;                  -- ⬅️ ZORUNLU. Yarıda patlarsa DB yarı-çevrilmiş KALMASIN.
--   ... 183 ters ALTER ...
COMMIT;
```

`SET timezone='UTC'` promosyonu kimlik dönüşümüne indirir, kısıt hiç bozulmaz. Dolu dev
DB'sinde geri+ileri tam tur koşuldu: **epoch birebir korundu** (`rolls`, `system_logs`,
`roll_movements.enteredAt/exitedAt`, `work_order_steps.completedAt`, `orders` üzerinde
count+sum karşılaştırıldı) ve DB `ROLLBACK` ile aynen bırakıldı.

> Ders daha geneldir: **iki tarih kolonunu karşılaştıran her CHECK, tip geçişlerinde
> oturum saat dilimine duyarlıdır.** Bugün böyle tek kısıt var (`work_order_steps_time_order`);
> yenisini eklersen bu bölümü güncelle.

### 1c) Gün sınırı artık AÇIK — **operatöre söylenecek DAVRANIŞ DEĞİŞİKLİĞİ**

timestamptz'ye geçince "bu olay hangi GÜNE ait" sorusu örtük olmaktan çıktı. `DATE_TRUNC`
günü **oturum** saat diliminde keser ve havuz oturumu (bilinçli olarak) UTC → gün sınırı
sessizce UTC'ye bağlanmıştı. Türkiye UTC+3 olduğu için bu, **yerel 00:00–03:00 arasındaki
her olayı bir ÖNCEKİ güne** yazıyordu — yani gece vardiyasının tam ortasını. Artık gün
`Europe/Istanbul` takvimine göre kesiliyor (`Teks-Erp/src/constants/time.ts` TEK KAYNAK).

**Sahaya söylenecek:** aşağıdaki GÜNLÜK GRAFİKLERDE gece 00:00–03:00 arasında kaydedilen
işlemler **artık doğru güne** düşüyor; eski ekran görüntüleriyle kıyaslanırsa o saat
dilimindeki hareketler bir gün ileri kaymış görünecek. **Toplamlar DEĞİŞMEZ**, yalnız
çubuklar arasındaki dağılım düzelir.

| Rapor | Etkilenen alan |
|---|---|
| Üretim → Fire & Hurda | günlük fire serisi (`daily`) |
| Envanter → Günlük Hareketler | gün × istasyon kırılımı |
| Kalite → Kurşun Uygulama Oranı | günlük seri (pay/payda ayrı ayrı kayabildiği için ORAN da düzelir) |
| Denetim → Sistem Log Özeti | günlük C/U/D serisi |

**Değişmeyenler** (mutlak pencere soruları — bilinçli): stok yaşlandırma kovaları
(3/7/14/30 gün), geciken siparişler, fason `daysOpen`, istasyon ortalama süreleri.
Dashboard "bugün" sayaçları ve belge numarası GGAAYY'si de **sahadaki sunucuda aynı
kalır** (sunucu zaten Europe/Istanbul); değişen tek şey kararın artık `TZ` env'ine değil
koda yazılmış olması.

**Doğrulama:** `npx tsx Teks-Erp/scripts/test_report_day_boundary.ts` — ayrıca bu
migration'ın gerçekten koştuğunu (yalnız `migrate resolve` etiketini değil) şu sorgu
kanıtlar:

```sql
SELECT pg_get_statisticsobjdef(oid) FROM pg_statistic_ext WHERE stxname='sl_day_exact';
-- çıktı 'Europe/Istanbul' İÇERMELİ; içermiyorsa audit raporu ~2x yavaşlar (sonuç doğru)
```

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

**2c. Genel hasar taraması:** `psql -d tekserp -f Teks-Erp/scripts/consistency-check.sql > tutarlilik-oncesi.log`
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
pm2 restart tekserp-backend
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
- `pm2 logs tekserp-backend --lines 50` — P2022/başlangıç hatası yok;
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
