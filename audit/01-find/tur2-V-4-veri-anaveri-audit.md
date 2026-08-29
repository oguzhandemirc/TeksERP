# TUR 2 · V-4 — VERİ MERKEZLİ DENETİM: ana veri · audit · yetki · ayarlar · sistem tabloları

**Tarih:** 2026-08-28 · **Dal/HEAD:** `adnansahin` / `ce8681d1` · **Mercek:** veri merkezli (önce ihlali VERİDE bul, sonra sebebini KODDA geriye izle)
**Veri kaynakları:** `audit/tools/sql-saha.sh` → prod kopyası `tekserp_saha_0825` (2026-08-25 kesiti, 190/195 migration) · `audit/tools/sql-dev.sh` → `adnansahin_db` (195 migration). İkisi de salt-okunur. Canlı prod'a erişim YOK.
**Kapsam (tablolar):** customers · customer_branches · customer_item_aliases · customer_color_aliases · items · colors · quality_grades · fabric_properties(+values) · subcontractors(+categories) · stations · machines · devices · users · permissions · user_permissions · permission_templates(+items) · system_settings · reason_presets · duplicate_reviews · system_logs · system_log_archives · printed_documents · label_templates(+variants, context_defaults) · traveler_card_templates · document_profiles · sessions · work_sessions · endpoint_latency_daily

---

## 0. PROD AYARLARI TABLOSU (feature-flag'lerin SAHADAKİ GERÇEK değerleri)

> Diğer denetçilerin "bu yol tetiklenir mi" olasılık tahmini bu tabloya dayanmalı.
> Kaynak: `SELECT key, value FROM system_settings` (saha, 34 satır) + satırı OLMAYAN 30 anahtar için `src/services/system-setting.service.ts` okuyucularının varsayılanı (`asBoolean` → **false**, `asNumber` → sabit).
> ⚠️ **34 satır var, katalogda 62 anahtar** — yani ayarların yarısı DB'de HİÇ YOK ve kod varsayılanıyla koşuyor. "Panelde gördüm, kapalıydı" ile "DB'de satır yok" AYNI ŞEY DEĞİLDİR: satırı olmayan üç anahtarın varsayılanı **AÇIK**tır.

### 0.1 Davranışı ENFORCE eden (backend zorlar) anahtarlar

| Anahtar | Sahadaki etkin değer | Kaynak | Kod varsayılanı | Not |
|---|---|---|---|---|
| `kk1.duplicateGuardEnabled` | **true** | DB (08-05) | false | 90 sn mükerrer tuzağı AÇIK → `POSSIBLE_DUPLICATE` yolu canlıdır |
| `tambur.overQuantityEnabled` | **true** | **satır YOK → varsayılan** | true | Aşım kesimi SERBEST → `currentQty > initialQty` yolu canlıdır (T1-044/§13 ilgili) |
| `batch.shortNumberEnabled` | **true** | **satır YOK → varsayılan** | true | Parti no `P01…P99`, sarmalı; `batches_batchNumber_key` DROP edilmiş |
| `fason.shrinkWarnEnabled` / `fason.shrinkTolerancePct` | **true / 10** | **satır YOK → varsayılan** | true / 10 | Çekme uyarısı AÇIK, tolerans %10 |
| `duplicates.fuzzyEnabled` / `…ThresholdPct` | **true / 90** | **satır YOK → varsayılan** | true / 90 | Mükerrer paneli bulanık eşleştirme AÇIK |
| `kk1.weightEntryEnabled` | false | DB (08-15) | false | kg gelirse 400 |
| `shipping.simulatedWeightEnabled` | false | satır YOK | false | Simüle kantar tartısı REDDEDİLİR |
| `device.pairingRequired` | **false** | DB (07-16) | false | Cihaz kapısı fiilen KAPALI → eşleşmemiş tablet de çalışır (T1-113'ün olasılığı yüksek) |
| `shipping.confirmationEnabled` | **false** | DB (07-16) | false | Sevk Kapısı YOK → "Sevk Et" doğrudan DISPATCHED |
| `shipping.undoDispatchSameDayOnly` | false | satır YOK | false | Storno'da tarih sınırı YOK |
| `production.kursunBypassEnabled` | **true** | DB (08-01) | false | Kurşun bypass rejimi AÇIK |
| `tambur.undoFullSameDayOnly` | false | satır YOK | false | "Tümden geri al" gün sınırı YOK |
| `tambur.shortCutA1Enabled` | **false** | satır YOK | false | Kısa-kesim→A1 kuralı sahada HİÇ çalışmıyor |

### 0.2 Oturum / kimlik ayarları — **KOD VARSAYILANININ TERSİ** (bkz. bulgu V-4-08)

| Anahtar | Saha | Kod varsayılanı | Sonuç |
|---|---|---|---|
| `auth.autoLogoutOnExpiry` | **false** | true | Token ömrü 8 saat DEĞİL, mutlak tavan **30 gün** |
| `auth.sessionDurationMinutes` | 480 | 480 | **Panelde yazar ama ETKİSİZDİR** (üstteki satır yüzünden) |
| `auth.absoluteSessionCapDays` | 30 | 30 | Fiilen kullanılan tek ömür |
| `auth.idleTimeoutMinutes` | 0 | 0 | Boşta kilit YOK |
| `auth.mobileIdleLockEnabled` | **false** | true | Tablet boşta kilidi KAPALI |
| `auth.mobileLockOnBackground` | **false** | true | Arka plana alınca kilit KAPALI |
| `workSession.idleTimeoutMinutes` | **0** | 20 | İş oturumu boşta kapanmaz |
| `auth.sameTypeSessionPolicy` | `"off"` | `"off"` | Aynı tipte sınırsız paralel oturum |
| `auth.loginMethods` | `{enabled:["list","pin"], primary:"pin"}` | — | Giriş = **kullanıcı listesinden seç + 6 haneli PIN** (T1-014'ün zemini sahada AKTİF) |
| `auth.pinLockoutEnabled` / `Attempts` / `PenaltySec` | **true / 5 / 60** | true / 5 / 60 | satır YOK → varsayılan; escalate 3, uzun ceza 15 dk (DB'de var) |

### 0.3 Diğerleri
`finance.pricingEnabled=false` · `return.gradingEnabled=false` · `kartela.measurementEnabled=false`(varsayılan) · `customers.branchesEnabled=**false**` (kod varsayılanı **true**) · `workorder.partyCodeAuto=true` · `order.defaultDeadlineDays="365"` ve `workorder.defaultPlanDurationDays="365"` (**metin tipinde** — bkz. V-4-11; kod varsayılanı 7) · `label.copies=2` · `label.defaultMedia={100×60 mm, 203 dpi, gap 2, margin 3}` · `label.nativeSendEnabled=false` · `label.mobileRasterEnabled=false` · `label.scrapGradeLabelEnabled=false`(varsayılan) · `backup.hour=3`(varsayılan) · `backup.offsiteRemote/Dir` **satır YOK** · `company.name` satır YOK → kod sabiti · `system.installationId` YOK (özellik 2026-08-26'da geldi, kesitten sonra) · damgalar: `backup.lastNightlyAt=2026-08-25T00:05`, `audit.lastArchiveAt=2026-08-16T07:55`.

**Bilinmeyen/katalog dışı anahtar YOK** (saha ve dev'de tek fark bu iki damga anahtarıdır ve ikisi de kodda literal olarak yazılır). `system_settings.key` PK → tekillik DB'de garanti. JSON değerlerinin hepsi geçerli ve beklenen tipte (2 istisna V-4-11).

---

## BULGULAR

### [V-4-01] Ad-mükerrer DB seddi dev ile saha arasında **iki yönde** eksik — sahada `items` seddini bloklayan iki satır PASİF ve HİÇ KULLANILMIYOR
| Şiddet | S2 | Kategori | B.1 / C | Öncelik | P1 | Modül | ana-veri | Kanıt seviyesi | K2 |

**Özet.** "Aynı ad iki kez girilemez" kuralının DB karşılığı `<tablo>_nameFold_key` partial unique'idir ve migration **yumuşak kapıdır** (mükerrer varsa index NOTICE ile atlanır). Ölçüldü: **sahada `items` seddi YOK ama `colors` seddi VAR; dev'de tam tersi.** Yani aynı bekçi, aynı kod yolu için iki ortamda FARKLI koruma seviyesinde koşuyor ve bunu hiçbir yerde söylemiyor. Sahada seddi kuran migration'ın atlanmasına sebep olan tek grup, **ikisi de pasif, hiçbir top/sipariş/iş emrine bağlı olmayan iki satır**dır.

**Kanıt (kod/şema).**
- `Teks-Erp/prisma/migrations/20260821150000_name_fold_unique_live/migration.sql:52-76` — yumuşak kapı (mükerrer varsa `RAISE NOTICE` + atla).
- `Teks-Erp/prisma/migrations/20260825120000_color_name_unique_live/migration.sql:73-74` — renk ikizi, aynı kalıp.
- `Teks-Erp/prisma/schema.prisma` — `Item`, `Customer`, `Subcontractor` modellerinde `@@unique([nameFold])` **BEYAN EDİLİ**; sahada `items` için karşılığı yok → şema ile DB ayrışık.
- Uygulama bekçisi `Teks-Erp/src/services/base.service.ts:729-795` (`assertNameNotDuplicate`) — check-then-act, kilitsiz (T1-007).

**Veride fiili ihlal (K2).**
```sql
-- Hangi sed kurulu?
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname='public' AND indexdef ILIKE '%UNIQUE%'
  AND (indexname ILIKE '%fold%' OR indexdef ILIKE '%tr_fold%');
-- Mükerrer gruplar
SELECT 'items' t,"nameFold",count(*) FROM items WHERE "mergedIntoId" IS NULL GROUP BY 2 HAVING count(*)>1
UNION ALL SELECT 'colors',tr_fold_color(name),count(*) FROM colors WHERE "mergedIntoId" IS NULL GROUP BY 2 HAVING count(*)>1;
```
| | saha (`tekserp_saha_0825`) | dev (`adnansahin_db`) |
|---|---|---|
| `customers_nameFold_key` | VAR | VAR |
| `subcontractors_nameFold_key` | VAR | VAR |
| `items_nameFold_key` | **YOK** | VAR |
| `colors_nameFoldColor_key` | VAR | **YOK** |
| mükerrer grup | `items`: 1 (`v-1430`) | `colors`: 1 (`beyaz`) |

Sahadaki blokaj (`items.nameFold='v-1430'`): `b5b11cfa…` kod `BGR150` ve `6a189333…` kod `MC155`, **ikisi de `isActive=false`**, `rolls=0 · order_lines=0 · work_orders=0` (her ikisi için ayrı ayrı ölçüldü).

**failure_mode.** İki operatör aynı anda "BAYRO FLAM" adıyla kumaş kaydeder; `assertNameNotDuplicate` ikisinde de "yok" der (kilit yok), DB'de `items` seddi olmadığı için ikisi de yazılır → aynı kumaş iki kodla stokta görünür, sipariş kalemleri ikiye bölünür ve karşılama raporu her ikisinde de "açık" gösterir. Aynı senaryo **renkte** dev'de tetiklenebilir, sahada tetiklenemez; kumaşta tam tersi → dev'de yeşil kalan bir yarış bekçisi sahada korumasız bir yolu ölçmüş olur.

**İş etkisi.** İki günlük temizlik işi (iki pasif satırı birleştir) yapılmadığı için 228 satırlık `items` tablosunun tamamı DB koruması olmadan yaşıyor. Prod'da `test_db_invariants §1` kalıcı KIRMIZI → "kırmızı körlüğü" (K2b H-11).

**Öneri (2. tur).** ① İki `v-1430` satırını mükerrer panelinden birleştir (kullanım 0, risk yok) → ② aynı migration dosyasını **yeniden koş** (idempotent, enforce eder) → ③ dev'de `colors` için aynısı. `[PROD'DA ÇALIŞTIRMA]` — ② ve ③ ayrı bir bakım penceresi ister; geri alma: `DROP INDEX items_nameFold_key`. ④ `EXPRESSION_UNIQUES` envanterine hangi ortamda hangi seddin kurulu olduğunu ölçen bir bekçi maddesi (bugün "kurulu mu" sorusu hiçbir yerde ölçülmüyor).
**Kabul kriteri.** `pg_indexes` çıktısı saha ve dev'de aynı 4 index'i listeler; `test_db_invariants §1` iki ortamda da yeşil.
**Efor.** 0,5 gün.
**Önceki defter.** T1-007 (ayakta, S2 — guard kilitsiz + sed eksik) · T1-066 (ayakta, S3 — enforce adımının sahibi yok) · Tur-1 çürütücü önerisi "BULGU-T1-074/db merceği" (iki yönlü ayrışma) burada kanıtlandı. **Yeni kanıt:** blokajın iki pasif ve hiç referanslanmayan satır olduğu ölçüldü.

---

### [V-4-02] Ana veriyi pasife alma **bağımlılık kontrolsüz ve önizlemesiz** — sahada 1.500 m'lik AÇIK siparişin kumaşı pasif, 200 m canlı stok pasif kumaşa bağlı
| Şiddet | S2 | Kategori | E / C | Öncelik | P1 | Modül | ana-veri | Kanıt seviyesi | K2 |

**Özet.** `DELETE /api/items/:id` (ve renk/müşteri/istasyon ikizleri) `BaseService.softDelete`'e düşer; bu fonksiyon kaydı okur, `isActive=false` yazar, audit atar — **hiçbir bağımlılık kontrolü, hiçbir önizleme, hiçbir uyarı yoktur**. Oysa proje kuralı açık: *"Yıkıcı işlemlerde detaylı onay zorunlu … backend tarafında preview endpoint döner"* (kök `CLAUDE.md`). `hardDelete` için P2003→409 sarmalayıcısı YAZILMIŞ, `softDelete` için hiçbir şey yok — yani daha SIK kullanılan yol korumasız.

**Kanıt (kod).**
- `Teks-Erp/src/services/base.service.ts:1233-1252` — `softDelete`: `findUnique` → `update({data:{isActive:false}})` → `AuditService.log`. Guard yok.
```ts
async softDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
  const oldRecord = await this.delegate.findUnique({ where: { id } });
  const updated = await this.delegate.update({ where: { id }, data: { isActive: false }, … });
```
- `Teks-Erp/src/controllers/base.controller.ts:118-125` — `remove()` doğrudan `softDelete`i çağırır, `preview` yok.
- Rotalar: `src/routes/item.routes.ts:244` · `src/routes/color.routes.ts:167` · `src/routes/customer.routes.ts:198` · `src/routes/station.routes.ts:222` — hepsi tek `requirePermission` ile `controller.remove`.
- Karşı-örnek (aynı dosyada): `base.service.ts:1256-1281` `hardDelete` P2003'ü yakalayıp 409 veriyor → ekip bu riski BİLİYOR, yalnız soft yolunu kapsamamış.

**Veride fiili ihlal (K2).** (saha)
```sql
SELECT 'pasif kumaş — açık sipariş kalemi', count(*) FROM order_lines ol
  JOIN items i ON i.id=ol."itemId" JOIN orders o ON o.id=ol."orderId"
 WHERE NOT i."isActive" AND o.status NOT IN ('COMPLETED','CANCELLED')
UNION ALL
SELECT 'pasif kumaş — canlı top', count(*) FROM rolls r JOIN items i ON i.id=r."itemId"
 WHERE NOT i."isActive" AND r.status NOT IN ('CANCELLED','SCRAP','SHIPPED','SUBCONTRACTOR_CONSUMED','KARTELA_CONSUMED');
```
| Kontrol | saha |
|---|---|
| pasif kumaş — **açık sipariş kalemi** | **1** → `SIP1208260004`, kumaş `MIKROCANVAS`/"SEFA", **1.500 m**, sipariş `APPROVED`, kumaş 2026-08-17'de pasife alınmış |
| pasif kumaş — canlı top | **2** → `T050826H0025`, `T050826H0026`, kumaş `ACTIVO`, her biri **100 m**, statü `STOCK` |
| pasif renk/müşteri/istasyon/makine — açık kayıt | 0 (temiz) |

**failure_mode.** Planlamacı 17 Ağustos'ta "SEFA" kumaşını (mükerrer temizliği sırasında) pasife alır; sistem hiçbir şey söylemez. 1.500 metrelik `SIP1208260004` siparişi hâlâ AÇIK'tır, ama iş emri formundaki kumaş seçicisi `isActive:true` süzgeciyle çalıştığı için o kumaş **listede yoktur** → siparişe iş emri açılamaz. Aynı biçimde `ACTIVO` kumaşının 200 m'lik iki topu Ham Stok'ta durur, envanter raporunda sayılır (raporlarda `items.isActive` süzgeci yok), ama üretime alınacak kumaş listesinde görünmez. Operatörün gördüğü tek şey "kumaş kayboldu"dur; sebebi hiçbir ekranda yazmaz.

**İş etkisi.** Açık siparişin üretimi sessizce bloke; envanterde "var ama seçilemez" mal. Geri dönüş kolaydır (yeniden aktifleştir) ama **teşhis** zordur — pasifleştirme anında hiçbir uyarı, sonrasında hiçbir bant yok.

**Öneri (2. tur).** `softDelete`e — `hardDelete`in P2003 dalının eşleniği olarak — model başına bir *bağımlılık sayacı* ekle (`MERGE_MAP`'teki MOVE tablolarının aynısı zaten var: `src/constants/merge-map.ts:65-230`) ve iki kademe kur: **canlı bağımlılık varsa 409 + somut liste** (proje kuralının istediği), `force:true` ile geçilebilir. Ek olarak `GET /:id/deactivate-preview` (merge önizlemesinin dar ikizi).
**Kabul kriteri.** `SIP1208260004`in kumaşını pasife alma denemesi "1 açık sipariş kalemi (1.500 m) + 0 canlı top" listesiyle 409 döner; `force` ile geçildiğinde audit satırı bu listeyi taşır.
**Efor.** 1,5 gün.
**Önceki defter.** Yok (T1-035 tombstone/hardDelete'i kapsıyor, pasifleştirmeyi DEĞİL).

---

### [V-4-03] Ana veri **birleştirmesinin** audit satırı fiziksel tablo adına yazılıyor (`items`), diğer her yol mantıksal ada (`ITEM`) — en yıkıcı işlem Denetim Raporu'nda kayboluyor; kapsam bekçisi de kör
| Şiddet | S2 | Kategori | I.3 / C | Öncelik | P1 | Modül | audit + ana-veri | Kanıt seviyesi | K2 |

**Özet.** `MasterDataMergeService` audit satırlarını `tableName: meta.table` ile yazar; `meta.table` **Prisma fiziksel tablo adıdır** (`items`, `colors`, `subcontractors`, `customers`). Sistemdeki diğer bütün yollar mantıksal adı yazar (`ITEM`, `COLOR`, `SUBCONTRACTOR`). Sonuç: 42 ilişkiyi taşıyan, kaydı mezar taşına çeviren ve **geri alınamayan** işlemin izi, o varlığın audit geçmişinde GÖRÜNMEZ. Üstelik Türkçe modül sözlüğünde de karşılığı yoktur (ham `items` basılır) ve kapsam bekçisi bunu **yapısal olarak** göremez: bekçi `tableName:` sonrası **düz literal** arar, burada değişken geçilir.

**Kanıt (kod).**
- `Teks-Erp/src/services/master-data-merge.service.ts:139-168` — `META` haritası: `table: "customers" | "items" | "colors" | "subcontractors"`.
- `…/master-data-merge.service.ts:719` ve `:740` — `AuditService.log({ …, tableName: meta.table, … })` (kaynak satırı + survivor satırı).
- Karşı-örnek: `src/services/base.service.ts:1216` `tableName: this.config.tableName` → `"ITEM"`; `src/services/subcontractor.service.ts:1395` `tableName: "SUBCONTRACTOR_DISPATCH"`.
- Türkçe sözlük: `Electron/src/lib/audit-labels.ts:28+` `TABLE_LABELS` — `ITEM`, `COLOR`, `SUBCONTRACTOR` VAR; `items`, `colors`, `subcontractors`, `customers` **YOK** (grep ile tek tek doğrulandı; buna karşılık `users`, `devices`, `permissions`, `permission_templates` VAR — çünkü onlar kodda literal olarak yazılıyor).
- Bekçinin kör noktası: `Teks-Erp/scripts/test_audit_labels.ts:117-121`
```ts
const tableLiterals = new Set([
  ...[...backendText.matchAll(/tableName:\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]!),
  … ]);
```
  → yalnız **literal**; `tableName: meta.table` bu kümeye HİÇ girmez, dolayısıyla ":130" satırındaki "her modül adının Türkçesi var" kontrolü bu dört adı hiç sormaz. **Bekçinin kör noktası hatanın kendisiyle aynı yerdedir.**

**Veride fiili ihlal (K2).** (saha)
```sql
SELECT "tableName", action, count(*) FROM system_logs
 WHERE "tableName" IN ('items','colors','subcontractors','customers') GROUP BY 1,2;
```
| tableName | action | n | tarih |
|---|---|---|---|
| `items` | UPDATE | 6 | 2026-08-25 13:22 |
| `colors` | UPDATE | 4 | 2026-08-25 13:22 |
| `subcontractors` | UPDATE | 3 | 2026-08-25 13:22 |

**13/13 birleştirmenin tamamı** bu yolla yazılmış. Aynı işlemin karar defteri (`duplicate_reviews`) ise UPPER biçimini kullanıyor (`entity='ITEM'|'COLOR'|'SUBCONTRACTOR'`, 13 satır) → **aynı olay iki tabloda iki farklı anahtarla duruyor**. Ek olarak `SELECT count(*) FILTER (WHERE "decidedById" IS NULL) FROM duplicate_reviews` → **13/13 aktörsüz** (CLI yolundan yazılmış; T1-127'nin bu modüldeki tezahürü).

**failure_mode.** Muhasebe "BGR 150 ŞEFFAF kumaşı neden kayboldu, kim sildi?" diye sorar. Denetçi Denetim Raporu'nda modül = **Kumaş / Stok Kalemi** (`ITEM`) seçer, tarih aralığını verir → **hiçbir satır çıkmaz**, çünkü birleştirme `items` adıyla yazılmıştır. Kaydın id'siyle "kayıt geçmişi" araması yapılsa bile ekranda modül adı ham `items` olarak basılır ve listede ayrı bir grup olarak durur. Sonuç: 42 ilişkinin taşındığı, geri alınamayan işlemin izi pratikte bulunamaz; bulunsa bile **kimin yaptığı** `duplicate_reviews`ta boştur.

**İş etkisi.** Ana veri birleştirmesi bu sistemdeki en yıkıcı ve en zor geri alınan işlemdir (`MERGE_MAP` 42 kural); izlenebilirliğin tam da orada kopması ISO 9001/27001 anlamında kayıt bütünlüğü açığıdır.

**Öneri (2. tur).** ① `META`ya `auditTable: "ITEM" | "COLOR" | …` alanı ekle ve `:719/:740`'te onu kullan (fiziksel ad `MERGE_MAP` MOVE satırlarında kalsın — orada doğru anahtardır). ② Geçmiş 13 satır **düzeltilmez** (toplu UPDATE kök nedeni gizler; ayrıca audit tamper trigger'ı var) — bunun yerine `TABLE_LABELS`e dört ESKİ ad eklenip "Kumaş (birleştirme, eski kayıt)" gibi etiketlenir. ③ `test_audit_labels.ts`'e `tableName:` **değişken** geçilen çağrıları da yakalayan bir kontrol: `grep -c 'tableName: [a-z]' → 0` iddiası (bugün 2 vuruş verir → kırmızı).
**Kabul kriteri.** Yeni bir birleştirme `system_logs.tableName='ITEM'` yazar; `test_audit_labels` değişken-tableName kontrolü mevcut kodda kırmızı, düzeltmeden sonra yeşil.
**Efor.** 0,5 gün.
**Önceki defter.** Yok (T1-127/T1-128 audit aktörü ve korelasyonu; modül adı ayrışması yeni).

---

### [V-4-04] Üretimde izinler **`ops-sql` ile doğrudan DB'ye** yazılmış: servis katmanının `tokenVersion++` değişmezi atlanmış, SoD-kritik `shipping:undo-dispatch` 6 kullanıcıya bu yolla verilmiş, `grantedById` boş
| Şiddet | S2 | Kategori | E (SoD) / I.3 / G | Öncelik | P1 | Modül | yetki | Kanıt seviyesi | K2 |

**Özet.** Yetkiler token'ın İÇİNDE taşınır (`req.user = payload`, DB'den yeniden okunmaz); bu yüzden `PermissionManagementService` "izin değişince `tokenVersion++`" değişmezini üç ayrı yerde uygular. Prod audit'i gösteriyor ki 2026-08-05'te **24 izin satırı bu servisten geçmeden**, `grantedVia: "ops-sql (2026-08-05 surum izinleri)"` etiketiyle doğrudan DB'ye yazılmış. Bu satırlar `grantedById` taşımıyor, audit satırlarının `userId`'si NULL ve o an **hiçbir oturum düşürülmemiş**.

**Kanıt (kod).**
- `Teks-Erp/src/middlewares/auth.middleware.ts:104` — `req.user = payload;` → yetkiler JWT'den gelir, DB'den tazelenmez.
- `Teks-Erp/src/services/auth.service.ts:261` — `const permissions = await this.getEffectivePermissions(user.id);` yalnız **giriş anında**.
- Değişmezin üç uygulama noktası: `src/services/permission-management.service.ts:218`, `:334`, `:394` — `tx.user.update({ data: { tokenVersion: { increment: 1 } } })`; `:1009-1021` yorumu bunu açıkça "invariant" diye adlandırıyor.
- Bu yolun **hiçbir** kod izi yok: `grep -rn "ops-sql" Teks-Erp/src` → 0 (script repoda değil, elle yazılmış SQL).

**Veride fiili ihlal (K2).** (saha)
```sql
SELECT "newData"->>'permissionCode' AS kod, "newData"->>'grantedVia' AS yol, count(*)
FROM system_logs WHERE "tableName"='USER_PERMISSION' GROUP BY 1,2;

SELECT count(*) FROM user_permissions WHERE "grantedById" IS NULL;   -- 24 / 353

SELECT u.username, count(*) FROM sessions s JOIN users u ON u.id=s."userId"
WHERE s."createdAt" < '2026-08-05 08:40' AND s."expiresAt" > '2026-08-05 08:40'
  AND (s."revokedAt" IS NULL OR s."revokedAt" > '2026-08-05 08:40') GROUP BY 1;
```
| İzin kodu | grantedVia | n |
|---|---|---|
| **`shipping:undo-dispatch`** | ops-sql (2026-08-05 surum izinleri) | **6** |
| `roll:history` | ops-sql (…) | 6 |
| `settings:workstation` | ops-sql (…) + tamamlama | 6 |
| `mobile:siparis` | ops-sql (…) + tamamlama | 6 |

- `user_permissions.grantedById IS NULL` = **24 / 353** — hepsi bu iki koşum.
- O anda canlı kalan, iptal EDİLMEYEN oturumlar: admin 4 · Eda 5 · Enes 3 · HamGiris 17 · Osman 8 · Samet 3 = **40 oturum**; `sessions.revokedAt` 2026-08-05 08:00-12:00 arasında yalnız **1** satır (`LOGOUT`) taşıyor → toplu iptal yapılmamış.
- Sahadaki oturum ömrü **30 gün** (bkz. §0.2) → bu pencere teorik olarak 30 gün.

**failure_mode.** Depo sorumlusu Eda'ya 5 Ağustos'ta `shipping:undo-dispatch` verilir; panel ve DB "yetki var" gösterir. Eda tabletinde/panelinde **oturumunu kapatmadığı** için token'ı eski izin listesini taşımaya devam eder: "Sevki Geri Al" tuşuna bastığında `requirePermission("shipping:undo-dispatch")` **403** verir ve hata mesajı "Bu işlem için … yetkisi gerekli" der — yani sistem, kendi kayıtlarına göre sahip olduğu bir yetkiyi reddeder. Yönetici izin ekranına bakar, yetkiyi işaretli görür, sorunu teşhis edemez. İkinci yüz: **görevler ayrılığı ihlali kimin kararıyla oluştuğu kayıtlı değildir** — `grantedById` NULL, audit `userId` NULL; ISO 27001 A.5.15/A.5.18 anlamında yetkilendirmenin sahibi yoktur.

**İş etkisi.** Sevk stornosu (mal iadesi/mali etkili) yetkisi 6 kullanıcıya kayıtsız dağıtılmış; T1-043'ün ölçtüğü "8 kullanıcının 6'sı SoD üçlüsünü taşıyor" tablosunun MEKANİZMASI budur. Ayrıca "verdim ama çalışmıyor" sınıfı destek talebi üretir.

**Öneri (2. tur).** ① `user_permissions` üzerine `grantedById NOT NULL` **koyma** (tarihsel satırlar var) ama **panelde "kaynağı bilinmeyen yetki" bandı** göster (mevcut "N yetki hiçbir kullanıcıda yok" bandının kardeşi). ② Ops yolu gerekiyorsa repoda dry-run'lı bir script olsun (`apply_merge_decisions.ts` emsali) ve **servisi çağırsın** — ham SQL 42 kurallık haritayı ve `tokenVersion` değişmezini atlar (bu, `master-data-merge` için zaten yazılı bir karar: "inceleme SQL'de, UYGULAMA MOTORDA"). ③ Tek satırlık telafi: izin değişikliğinden sonra ilgili kullanıcıların oturumlarını `revokeAllForUser` ile düşür.
**Kabul kriteri.** `SELECT count(*) FROM user_permissions WHERE "grantedById" IS NULL` panelde görünür bir sayaç; yeni ops koşumundan sonra ilgili kullanıcıların `tokenVersion`'ı artmış olur (bekçi: izin yazan her yol için `tokenVersion` deltası ölçülür).
**Efor.** 1 gün.
**Önceki defter.** T1-043 (ayakta, S3 — SoD atamada yok) mekanizması burada. T1-051 (30 günlük token) pencereyi uzatan çarpan.

---

### [V-4-05] `admin:users` **kendine** `admin:*` yazabiliyor — sahada tam bu profilde bir hesap var ve kendine-yazma yolu prod audit'inde İKİ kez kullanılmış
| Şiddet | S2 | Kategori | G / E (SoD) | Öncelik | P1 | Modül | yetki | Kanıt seviyesi | K2 |

**Özet.** `PUT /api/admin/users/:id/permissions` ve `POST /api/admin/users/:id/apply-template` uçlarının tek kapısı `requirePermission("admin:users")`. Servis tarafında `actorUserId === userId` kontrolü YOK; son-admin koruması yalnız **admin düşüren** dalda koşar, **admin YÜKSELTEN** dalda hiç koşmaz. Yani "sınırlı yönetici" kademesi (kullanıcı yönetir ama sistem ayarlarına dokunamaz) fiilen mevcut değildir: `admin:users` taşıyan herkes tek istekle `admin:*` alabilir.

**Kanıt (kod).**
- `Teks-Erp/src/routes/admin.routes.ts:406-410`
```ts
router.put(
  "/users/:id/permissions",
  verifyToken,
  requirePermission("admin:users"),
  async (req, res, next) => { … }
```
- `Teks-Erp/src/routes/admin.routes.ts:584-588` — `apply-template` aynı tek guard.
- `Teks-Erp/src/services/permission-management.service.ts:248-330` — `setUserPermissions`: yalnız kullanıcı varlığı ve izin id'lerinin geçerliliği doğrulanıyor; `:302-307`
```ts
const removesAdmin = currentHasAdmin && !targetHasAdmin;
await prisma.$transaction(async (tx) => {
  if (removesAdmin) { … assertAdminCoverageAfterChange(tx, userId, false); }
```
  → yükseltme dalında hiçbir ek kontrol yok, kendi kaydını hedeflemeyi engelleyen satır yok.

**Veride fiili ihlal (K2).** (saha)
```sql
WITH up AS (SELECT u.username, p.code FROM users u
   JOIN user_permissions x ON x."userId"=u.id JOIN permissions p ON p.id=x."permissionId"
   WHERE u."isActive" AND u."deletedAt" IS NULL)
SELECT username FROM up WHERE code='admin:users'
  AND username NOT IN (SELECT username FROM up WHERE code='admin:*');
-- → Enes   (admin:users + admin:settings taşıyor, admin:* YOK)

SELECT to_char("createdAt",'MM-DD HH24:MI'), "userId", "recordId"
FROM system_logs WHERE "tableName"='USER_PERMISSION_SET' ORDER BY 1 DESC;
-- 08-24 19:33  userId = recordId = c8c3a66d…(admin)   ← KENDİNE yazma
-- 08-06 11:48  userId = recordId = c8c3a66d…(admin)   ← KENDİNE yazma
```
- Sahadaki `admin:*` sahipleri: `admin`, `Berat`, `AhmetOnur` (3). `admin:users` sahibi ama `admin:*` olmayan: **`Enes`** (1).
- Kendine-yazma yolu prod'da **2 kez** fiilen kullanılmış (admin hesabıyla, zararsız — ama yolun canlı olduğunun kanıtı).

**failure_mode.** `Enes` hesabı (bugün `admin:users` + `admin:settings` taşıyor, `admin:*` taşımıyor) kendi kullanıcı id'siyle `PUT /api/admin/users/<kendi-id>/permissions` çağırır ve gövdeye `admin:*` izninin id'sini ekler. İstek 200 döner, `USER_PERMISSION_SET` audit satırı yazılır (aktör = kendisi), `tokenVersion++` ile yeniden giriş yapar ve artık **tam yetkilidir** — yedek/geri yükleme, DB kopyası, kullanıcı PIN'lerini okuma (T1-013) dahil. Hiçbir ikinci onay, hiçbir alarm yoktur.

**İş etkisi.** Yetki modelinin ilan ettiği kademeler (26 rol şablonu, kategori ayrımı, SoD üçlüsü) `admin:users` taşıyan hesaplar için anlamsızdır; bu, T1-013 (PIN okuma) ve T1-043 (SoD) bulgularının etki hesabını yukarı çeker.

**Öneri (2. tur).** ① `setUserPermissions`/`applyTemplate` içinde `actorUserId === userId` **ve** hedef izin kümesi aktörün kümesini genişletiyorsa → 409 (`SELF_ESCALATION`); ② "yükseltme" dalına da `acquireAdminGuardLock` + audit'te `escalation: true` işareti; ③ `admin:*` verme yetkisini ayrı bir izne (`admin:grant-admin`) ayırmak, ①-②'den sonra opsiyonel.
**Kabul kriteri.** Bekçi: `admin:users` taşıyan sahte bir aktör kendi id'sine `admin:*` yazmayı dener → 409; başkasına yazmayı dener → 200 (davranış korunur).
**Efor.** 0,5 gün.
**Önceki defter.** T1-013 (ayakta, S2) — Tur-1 çürütücüleri bunu "AYRI ve daha ağır" diye işaret etmişti (`BULGU-T1-013` ve `BULGU-T1-054` kaynaklı iki öneri); burada saha verisiyle (Enes + iki self-target audit satırı) kanıtlandı.

---

### [V-4-06] Kod (stok kodu) tekilliği yalnız uygulamada yaşıyor; DB kısıtı **harf duyarlı** — sahada 8 çakışma grubu, biri iki tarafı da AKTİF ve gerçek stok taşıyor
| Şiddet | S3 | Kategori | B.1 / C | Öncelik | P2 | Modül | ana-veri | Kanıt seviyesi | K2 |

**Özet.** Bu sistemde kod KİMLİKTİR (etikete basılır, belgede görünür, dış eşleşmede kullanılır). Uygulama 2026-08-15'te katlanmış (harf-duyarsız) tekilliğe geçirildi ve advisory kilitle korundu; **DB tarafı geride kaldı**: `items_code_key` düz `btree(code)`, yani `SANTUK` ile `santuk` iki ayrı satır olabiliyor. Kararın kendisi bilinçli ve yazılı (tarihsel satırlar patlamasın diye) ama **sedin kurulacağı gün, sahibi ve tetiği yok** ve bugün sahada bir çift **iki tarafı da aktif** hâlde duruyor.

**Kanıt (kod/şema).**
- `Teks-Erp/src/services/helpers/code-unique.helper.ts:1-38` — başlıkta karar yazılı: *"DB unique kısıtı … EKLENMEZ — bugün 9 satır ihlal ediyor"*; `:57` `CODE_UNIQUE_LOCK_NS = 8026`; `:80` kilit koruduğu okumadan önce (sıra doğru).
- `prisma/schema.prisma` `model Item` → `code String @unique` (harf duyarlı).
- DB (saha ve dev, aynı): `items_code_key | CREATE UNIQUE INDEX items_code_key ON public.items USING btree (code)` — `upper(code)`/`fold` yok.

**Veride fiili ihlal (K2).** (saha)
```sql
SELECT lower(code), count(*), string_agg(code||'/'||name||'/act='||"isActive", ' ++ ')
FROM items GROUP BY lower(code) HAVING count(*)>1;
```
| katlanmış kod | satırlar | durum |
|---|---|---|
| `santuk` | `SANTUK`/BORANCIK (aktif, **4 top · 3 sipariş kalemi**) ++ `santuk`/ŞANTUK (**aktif**, kullanımsız) | **İKİ TARAF DA AKTİF** |
| `sefa` | `SEFA`/MIKROCANVAS (tombstone) ++ `sefa`/MİKRO CANVAS (aktif, 91 top) | biri mezar taşı |
| `bayroflam` | `BAYROFLAM`/BAYRO FLAM (aktif, 209 top) ++ `bayroflam`/FLAM (tombstone) | biri mezar taşı |
| `bgr150seffaf`, `oslo`, `activo` | biri aktif, biri tombstone | — |
| `mc155` | `MC155`/V-1430 ++ `mc155`/V-1429 ++ `Mc155`/V-1431 — **üçü de pasif, hiçbiri mezar taşı değil** | 3 ayrı kumaş, tek kod |
| `bgr150` | `BGR150`/V-1430 ++ `bgr150`/BGR150 — ikisi de pasif | (V-4-01'in blokaj çifti) |

Toplam **8 grup / 9 fazla satır** — helper başlığındaki 2026-08-15 ölçümüyle **birebir aynı**, yani 13 gün içinde hiç azalmamış. Müşteri/renk/fasoncu/makine/istasyon kodlarında çakışma **0** (o modellerde kod `autoCode` ile üretiliyor — yapısal olarak kapalı).

**failure_mode.** Depo görevlisi çeki listesinde `SANTUK` kodunu okur ve panelde arar; arama iki satır döndürür (`BORANCIK` ve `ŞANTUK`), ikisi de aktiftir ve hangisinin elindeki mal olduğunu kod söylemez. İçe aktarımda ise daha sessizdir: `import.service` anahtarı `toLocaleUpperCase("tr-TR")` ile katlar (T1-087) → `santuk` satırı `SANTUK` kaydına yazılır ve **yanlış kumaşın** stok/sipariş satırı büyür; hata hiçbir yerde görünmez çünkü kod "eşleşmiştir".

**İş etkisi.** Bugün fiili zarar sınırlı (`santuk`/ŞANTUK kullanımsız), ama sed kurulmadığı sürece her yeni harf-varyantı aynı riski taşır ve içe aktarım yolu bunu sessizce yanlış kayda yazar.

**Öneri (2. tur).** ① 7 tarihsel grubu mükerrer panelinden birleştir/pasifleştir (5'i zaten tombstone içeriyor, 2'si tamamen kullanımsız) → ② `CREATE UNIQUE INDEX items_code_fold_key ON items(upper(code)) WHERE "mergedIntoId" IS NULL` (V-4-01 ile aynı bakım penceresi) ve `EXPRESSION_UNIQUES` envanterine yaz. `[PROD'DA ÇALIŞTIRMA]` — geri alma `DROP INDEX`.
**Kabul kriteri.** `SELECT count(*) FROM (SELECT lower(code) FROM items GROUP BY 1 HAVING count(*)>1) x` = 0; `test_db_invariants` yeni index'i envanterinde görüyor.
**Efor.** 1 gün (temizlik dahil).
**Önceki defter.** T1-087 (ayakta, S3 — içe aktarım katlaması) bu verinin tüketicisi; kısıt tarafı yeni.

---

### [V-4-07] Top statü değişimlerinin **%22'si** kayıt-düzeyi audit satırı bırakmıyor — "bu topa ne oldu" sorusu Denetim Raporu'ndan cevaplanamıyor
| Şiddet | S3 | Kategori | I.3 | Öncelik | P2 | Modül | audit | Kanıt seviyesi | K2 |

**Özet.** `rolls.statusChangedAt` trigger ile yazılır (40+ çağrı noktası olduğu için uygulamaya güvenilmiyor — doğru karar). Audit ise **işlem düzeyinde** yazılıyor: fason kabulünde `SUBCONTRACTOR_RECEIPT`, sevkte `SHIPMENT` recordId'siyle. Sonuç: topun kendi kimliğiyle audit araması yapıldığında statü geçişlerinin beşte biri **yok**tur. `SystemLogService` `recordId` filtresini ("kayıt geçmişi") destekliyor, yani bu sorgu gerçekten kullanılan bir yüzeydir.

**Kanıt (kod).**
- `Teks-Erp/prisma/migrations/20260809090000_roll_production_timestamps/migration.sql:79-86` — `roll_stamp_production_timestamps()` trigger'ı `statusChangedAt`i yazar.
- `Teks-Erp/src/services/system-log.service.ts:111` ve `:139-152` — `if (params.recordId) where.recordId = params.recordId;` + `RECORD_HISTORY_SELECT` → "kayıt geçmişi" yüzeyi.
- Sevk yolu topa değil sevkiyata log yazar: `src/services/shipping.service.ts` audit çağrıları `tableName:"SHIPMENT"`; fason kabul `src/services/subcontractor.service.ts:3238` `tableName:"SUBCONTRACTOR_RECEIPT"`.

**Veride fiili ihlal (K2).** (saha)
```sql
WITH r AS (SELECT id,status,"statusChangedAt","entrySource" FROM rolls
           WHERE "statusChangedAt" IS NOT NULL AND "statusChangedAt" >= '2026-07-16 13:00')
SELECT count(*) FROM r                                            -- 2392
UNION ALL
SELECT count(*) FROM r WHERE NOT EXISTS (
  SELECT 1 FROM system_logs l WHERE l."recordId"=r.id::text
    AND l."createdAt" BETWEEN r."statusChangedAt"-interval '120 s'
                          AND r."statusChangedAt"+interval '120 s'); -- 535
```
**535 / 2.392 = %22,4.** Kova dağılımı:
| statü | entrySource | n |
|---|---|---|
| `SUBCONTRACTOR_CONSUMED` | SUPPLIER_RECEIPT | **335** |
| `SHIPPED` | TAMBUR_SPLIT | **140** |
| `WAREHOUSE` | TAMBUR_SPLIT | 34 |
| `CANCELLED` | TAMBUR_SPLIT | 18 |
| `IN_PRODUCTION` | SUBCONTRACTOR_RETURN | 8 |

Ayrıca: **hiç audit satırı olmayan top = 55 / 2.431** (K10'un ölçümüyle birebir aynı).

**failure_mode.** Müşteri "bu topu size gönderdik, sizde iade görünmüyor" der. Denetçi topun barkodunu bulur, id'siyle kayıt geçmişini açar: liste `CREATE` (ham giriş) ve `LABEL_PRINT_EVENT` satırlarıyla biter — **`SHIPPED` geçişinin satırı yoktur**. Denetçi "bu top hiç sevk edilmemiş" sonucuna varır; gerçek iz sevkiyat kaydının altındadır ve topla arasındaki bağ audit'te değil `sack_allocations` içindedir. Aynı şey fasona giden 335 topta da geçerli (`SUBCONTRACTOR_CONSUMED` = topun emekli edilmesi).

**İş etkisi.** Kayıt geçmişi yüzeyi eksiksiz sanılıyor; uyuşmazlık çözümünde yanlış sonuç üretir. Domain defterleri (`roll_operations` 1.586, `roll_movements` 1.107) izi taşıyor — yani veri KAYIP DEĞİL, **audit yüzeyi eksik**; bu, düzeltmeyi ucuzlatır.

**Öneri (2. tur).** `AuditService.logMany` ile statü değiştiren toplu yollara (fason kabul, sevk, tambur kesim çocukları) **recordId = roll.id** taşıyan hafif bir satır ekle (`action:"STATUS"`, `newData:{from,to,via:<işlem no>}`). Alternatif ve daha ucuzu: "kayıt geçmişi" ekranı topu sorgularken `roll_operations`+`roll_movements`'ı da birleştirsin ve bunu ekranda söylesin.
**Kabul kriteri.** Sevk edilen bir topun id'siyle kayıt geçmişi çağrıldığında `SHIPPED` geçişi görünür; bekçi: rastgele 20 SHIPPED top için ±120 sn içinde satır bulunur.
**Efor.** 1 gün.
**Önceki defter.** K10 haritasının "audit kayıt-düzeyi boşluğu 55/2.391 top" notunun ölçülmüş ve genişletilmiş hâli (55 = hiç satırı olmayan; 535 = geçişi olmayan). T1-127/T1-128 komşu ama farklı (aktör/korelasyon).

---

### [V-4-08] Sahadaki oturum/kilit ayarlarının **tamamı kod varsayılanının tersine** kapatılmış; panelde yazan 8 saatlik oturum ömrü ETKİSİZ
| Şiddet | S3 | Kategori | G / E | Öncelik | P2 | Modül | ayarlar | Kanıt seviyesi | K2 |

**Özet.** Kod tarafındaki güvenli varsayılanlar (otomatik çıkış AÇIK, mobil boşta kilit AÇIK, arka planda kilit AÇIK, iş oturumu boşta zaman aşımı 20 dk) sahada **tek tek kapatılmış**. Bunun iki sonucu var: (a) her oturum 8 saat değil **30 gün** yaşıyor ve panelde görünen "Oturum süresi: 480 dakika" alanı hiçbir şey yapmıyor; (b) bir denetim, kodun varsayılanlarına bakarak "koruma açık" sonucuna varırsa yanılır. Ayarların hiçbiri "bu alan şu an etkisiz" demiyor.

**Kanıt (kod).**
- `Teks-Erp/src/services/auth.service.ts:283-305`
```ts
const timeoutEnabled = await readAutoLogoutOnExpiry();   // saha: false
…
if (timeoutEnabled) { effectiveExpiresAt = now + sessionMinutes*60_000; }
else if (capDays > 0) { effectiveExpiresAt = now + capDays*86_400_000; }  // ← saha bu dal
```
- Varsayılanlar: `src/services/system-setting.service.ts:385` `DEFAULT_AUTO_LOGOUT_ON_EXPIRY = true` · `:387` `DEFAULT_MOBILE_IDLE_LOCK_ENABLED = true` · `:394` `DEFAULT_MOBILE_LOCK_ON_BACKGROUND = true` · `:376` `DEFAULT_WORK_SESSION_IDLE_MINUTES = 20`.

**Veride fiili ihlal (K2).** (saha)
```sql
SELECT key, value FROM system_settings WHERE key LIKE 'auth.%' OR key LIKE 'workSession.%';
SELECT round(avg(EXTRACT(EPOCH FROM ("expiresAt"-"createdAt"))/86400)::numeric,2) FROM sessions;
```
| Anahtar | saha | kod varsayılanı |
|---|---|---|
| `auth.autoLogoutOnExpiry` | **false** | true |
| `auth.mobileIdleLockEnabled` | **false** | true |
| `auth.mobileLockOnBackground` | **false** | true |
| `workSession.idleTimeoutMinutes` | **0** | 20 |
| `auth.idleTimeoutMinutes` | 0 | 0 |
| `auth.sessionDurationMinutes` | 480 (**etkisiz**) | 480 |

- `sessions` (214 satır) **ortalama ömür = 30,00 gün** — istisnasız hepsi mutlak tavandan doğmuş, hiçbiri 8 saatlik ömürle doğmamış.
- `expiresAt` aralığı: 2026-08-15 → 2026-09-24; `revokedAt IS NULL AND expiresAt <= now()` = **10** (K5 §2.1'in ölçümü doğrulandı).
- Cihaz kapısı da kapalı: `device.pairingRequired=false`, buna karşılık **28 cihazın 28'i APPROVED** ve **hiçbirinin `machineId`'si yok** (üretim atfı prod'da her yerde NULL).

**failure_mode.** Yönetici Ayarlar → Oturum ekranında "Oturum süresi 480 dakika" görür ve "token 8 saatte ölüyor" varsayar. Gerçekte `auth.autoLogoutOnExpiry=false` olduğu için `issueToken` `capDays` dalına düşer ve token **30 gün** geçerli imzalanır; kopyalanan/çalınan bir token bir ay boyunca çalışır, tablet boşta kilitlenmez, arka plana alınınca da kilitlenmez. Aynı yanılgıyı bir denetim de yapar: kod varsayılanlarına bakan biri dört koruma da açık sanır.

**İş etkisi.** Kimlik yüzeyinin tamamı (PIN + liste ile giriş, 30 gün token, sınırsız paralel oturum, cihaz kapısı kapalı) en gevşek konfigürasyonda; T1-014 ve T1-051'in olasılık tarafı bu tabloyla **yüksek**tir.

**Öneri (2. tur).** ① Panelde "bu alan şu an etkisiz" rozeti: `autoLogoutOnExpiry` kapalıyken `sessionDurationMinutes` alanı gri + açıklama. ② `GET /api/admin/health`e "varsayılandan sapan güvenlik ayarları" sayacı (bugün sapmayı gösteren tek yüzey ayarların kendisi). ③ Ayarları **değiştirme** kararı fabrikanındır — bulgu, sapmanın görünmez olmasıdır.
**Kabul kriteri.** Panel, etkisiz alanı etkisiz gösterir; sağlık ucu "4 güvenlik ayarı varsayılandan sapmış" der.
**Efor.** 0,5 gün.
**Önceki defter.** T1-051 (ayakta, S2 — 30 gün token) · T1-014 (ayakta, S1 — PIN) · T1-113 (cihaz kapısı). **Yeni:** sapmanın ölçülmüş tam listesi + "panelde yazan değer etkisiz" tespiti.

---

### [V-4-09] Bekçi fixture'ları ve elle uçtan-uca doğrulama **prod anlık görüntüsü üzerinde** koşmuş; `productionDbGate` "yerel = güvenli" varsayıyor — canlıda hâlâ AKTİF bir TEST makinesi 4 topa damga vurmuş
| Şiddet | S3 | Kategori | K.5 / J / I.6 | Öncelik | P2 | Modül | test-veri hijyeni | Kanıt seviyesi | K2 |

**Özet.** Test paketinin üretim koruması **ana bilgisayara** bakıyor: hedef `localhost` ise "yerel ✅" deyip geçiyor. Bu projenin yerleşik pratiği ise prod yedeğini yerelde ayrı bir DB'ye geri yüklemektir (`tekserp_saha_0825`, `adnansahin_db`) — yani "yerel" ile "güvenli" bu kurulumda aynı şey DEĞİL. Denetimin kanıt tabanı olan prod kopyasında, kesit alındıktan sonra koşmuş fixture'ların ve elle bir uçtan-uca doğrulamanın izleri duruyor. Ayrıca **canlı prod tarafında** da test artığı ana veri yaşıyor ve üretim atfına giriyor.

**Kanıt (kod).**
- `Teks-Erp/scripts/run-all-tests.ts:102-150` — `productionDbGate()`:
```ts
const YEREL = new Set(["localhost","127.0.0.1","::1","0.0.0.0"]);
if (YEREL.has(host)) { console.log(`→ Hedef DB: ${dbName} @ ${host} (yerel) ✅`); return; }
```
  DB **ADI** hiç sorgulanmıyor (`tekserp_saha_0825` de `adnansahin_db` de aynı yeşili alır) ve kapı yalnız **koşucudadır** — tek dosya koşumunda ve elle akışlarda hiç çalışmaz (K11 HOTSPOT-7).

**Veride fiili ihlal (K2).**
① Prod kopyasında, son GERÇEK üretim kaydından (`max(rolls."createdAt") = 2026-08-24 22:11`) sonra:
```sql
SELECT count(*) FROM system_logs WHERE "createdAt" >= '2026-08-25 13:15';           -- 63
SELECT count(*) FROM system_logs WHERE "createdAt" BETWEEN '2026-08-25 13:23' AND '2026-08-25 13:26'; -- 39
SELECT count(*) FROM work_orders WHERE "createdAt" >= '2026-08-25 13:00';           -- 2
```
- **63** audit satırı restore sonrası yazılmış: 13 tanesi birleştirme (`items`/`colors`/`subcontractors` UPDATE), **39** tanesi ad-mükerrer bekçisinin fixture'ları (`CREATE COLOR/ITEM/STATION/MACHINE/CUSTOMER/CUSTOMER_BRANCH/SUBCONTRACTOR…`, hepsi `userId=NULL`).
- Fixture ana verisi temizlenmiş (08-25 13:00 sonrası `colors/items/stations/machines/customers/subcontractors` = 0 yeni satır) ama **operasyonel kayıtlar TEMİZLENMEMİŞ**: `IE2508260003` (13:44) ve `IE2508260004` (13:54) hâlâ **IN_PROGRESS**; `FS2508260002` (70 m) ve `FS2508260003` (325 m) fason sevkleri **iptal edilmemiş**; iki top (`T240826F0031` 325 m, `T240826F0035` 70 m) **`AT_SUBCONTRACTOR`** statüsünde duruyor.
- ⚠️ Bu satırların prod'un kendisinde mi yoksa yalnız kopyada mı olduğu bu kopyadan **ayırt edilemez** (`[VARSAYIM]`): 13:54 kaydı gerçek bir kullanıcı ve `192.168.1.99` IP'si taşıyor, 13:44 kaydı taşımıyor.

② **Prod tarafında** (kesitten önce, gerçek kullanımda) test artığı ana veri:
```sql
SELECT m.code, m.name, m."isActive",
  (SELECT count(*) FROM work_sessions w WHERE w."machineId"=m.id) oturum,
  (SELECT count(*) FROM rolls r WHERE r."createdMachineId"=m.id) top FROM machines m;
```
| makine | aktif | iş oturumu | damgaladığı top |
|---|---|---|---|
| `MAK0608260001` **TAMBUR -TEST** | **true** | 8 | **4** |
| `MAK0508260001` Test-Makine-1 | false | 5 | 10 |

**failure_mode.** ① Denetim/analiz tarafı: `tekserp_saha_0825` üzerinde "ardışık yaratım aralığı" ya da "kim ne zaman ne yaptı" ölçen HER sorgu, 08-25 13:15-13:54 penceresindeki 63 sentetik satırı gerçek trafik sanar (bu tur içinde de bir kez yaşandı; Tur-1 çürütücüsü aynı tuzağı bildirmişti). ② Operasyon tarafı: `TAMBUR -TEST` makinesi **aktif** olduğu için operatör listesinde görünür; makine bazlı üretim raporunda ayrı bir satır olarak çıkar ve 4 gerçek topun üretim atfı bu makineye yazılıdır. ③ 395 metrelik iki top "fasonda" görünüyor ama fiziksel olarak depoda — fason karnesi ve açık sevk listesi bu iki kaydı bekleyen iş sayar.

**İş etkisi.** Kanıt tabanının kirliliği bütün denetimi etkiler (bu raporun K2 ölçümleri dahil); üretim tarafında ise iki açık fason sevki ve aktif bir test makinesi.

**Öneri (2. tur).** ① `productionDbGate`e **DB ADI** kontrolü ekle: ad `saha|prod|_restore_|_old_|copy` içeriyorsa fail-closed (yerel olsa bile), kaçış anahtarı ayrı. ② Elle uçtan-uca doğrulama için repoda bir "tur sonrası temizlik" reçetesi: açılan WO'yu iptal + fason sevkini storno + topları eski statüye. ③ `TAMBUR -TEST` makinesini pasife al (4 topun atfı tarihsel olgudur, DEĞİŞTİRİLMEZ). ④ Kopya DB'lerde `ALTER DATABASE … SET teks.readonly` gibi bir işaret yerine, en azından `system_settings`e `system.isCopy=true` damgası (restore yolunda yazılır) ve boot'ta banner.
**Kabul kriteri.** `DATABASE_URL` `tekserp_saha_0825`i gösterirken `npx tsx scripts/run-all-tests.ts` **durur**; canlıda aktif test makinesi kalmaz.
**Efor.** 1 gün.
**Önceki defter.** T1-070 (ayakta, S3 — dev'de 480 TST-WHA WO) komşu; kapı tarafı ve prod kopyası tarafı yeni. Tur-1 çürütücü notu ("BULGU-T1-007 / topoloji merceği") burada ölçülerek doğrulandı.

---

### [V-4-10] Bekçilerin koştuğu dev DB'si ana veride sahayla ayrışıyor — 72 kullanıcının 46'sı test artığı, 8 "admin" (sahada 3), 3 kodsuz izin şablonu
| Şiddet | S3 | Kategori | K.5 | Öncelik | P3 | Modül | test-veri hijyeni + yetki | Kanıt seviyesi | K2 |

**Özet.** Yetki bekçilerinin çoğu **paylaşılan dev DB'sine karşı** koşuyor. O DB'deki ana veri, sahadakinden nicel olarak çok farklı ve fark tam da bekçilerin ölçtüğü değişkenlerde: "sistemde kaç admin var" (son-admin koruması), "kaç izin şablonu var" (uzlaştırma), "kaç kullanıcı var" (toplu izin yolları). Bu, "dev'de yeşil" ile "sahada doğru" arasındaki bağı zayıflatır.

**Kanıt (kod).** `Teks-Erp/scripts/run-all-tests.ts:174` — tek koruma `productionDbGate()` (V-4-09); temizlik `scripts/clean_test_residue.ts` 5 önek tanıyor, `TEST-IMP-PERM-*` ve `TEST PM Şablon *` bunlardan değil.

**Veride fiili ihlal (K2).**
| Ölçüm | saha | dev |
|---|---|---|
| `users` | 9 | **72** (46'sı `^(test\|tst\|imp\|perm\|fx\|seed\|dup)` deseninde; 66'sı **aktif**) |
| `admin:*` taşıyan **aktif** kullanıcı | **3** | **8** (2'si `TEST…`/`probe_…`) |
| `admin:users` taşıyan aktif | 1+3 | 7 |
| `permission_templates` | 26 (katalogla **birebir**) | **29** → fazlası: `(kodsuz) TEST PM Şablon 1785980919041/…070801/…091611` |
| `customers` / `colors` / `stations` | 27 / 83 / 6 | 126 / 146 / 15 |
| `duplicate_reviews` | 13 | 130 |
| `sessions` | 214 | 1.225 |
| `system_logs` | 10.485 | 153.424 |

**failure_mode.** `assertAdminCoverageAfterChange` ("son yöneticiyi düşürme") bekçisi dev'de koşar: orada 8 aktif admin vardır, dolayısıyla "son admin" durumunu kurmak için 7 hesabı düşürmek gerekir ve testin kurduğu senaryo gerçek kapıyı hiç tetiklemeyebilir. Sahada aynı koruma 3 admin üzerinde çalışır ve V-4-04'te görüldüğü gibi bu hesaplardan biri kendini yükseltebilir. Aynı biçimde izin-şablonu uzlaştırıcısının "fazla şablon" davranışı dev'de 3 kodsuz satırla, sahada 0 ile ölçülür.

**İş etkisi.** Yetki bekçilerinin verdiği güvence, sahadaki asıl zeminde doğrulanmamış oluyor.
**Öneri (2. tur).** ① `clean_test_residue.ts`e `TEST-IMP-PERM`, `TEST PM Şablon`, `probe_` öneklerini ekle; ② izin bekçileri kendi fixture kullanıcılarını **damgalı** açsın ve sonunda silsin (ad-mükerrer bekçilerinde bu zaten yapıldı); ③ son-admin bekçisi "sistemde N admin var" **varsayımını** kendi kursun (fixture'la izole).
**Kabul kriteri.** `SELECT count(*) FROM users WHERE username ~ '^(TEST|probe_)'` dev'de 0; son-admin bekçisi izole fixture ile koşar.
**Efor.** 0,5 gün.
**Önceki defter.** T1-070 (ayakta, S3) — aynı sınıf, farklı tablolar (kullanıcı/izin/şablon).

---

### [V-4-11] Tipsiz `PUT /api/admin/settings/:key` yolu sahada fiilen kullanılmış — iki sayısal ayar DB'de **metin** olarak duruyor
| Şiddet | S4 | Kategori | F / C | Öncelik | P3 | Modül | ayarlar | Kanıt seviyesi | K2 |

**Özet.** Ham ayar yazma ucu anahtar allowlist'i ve tip doğrulaması olmadan yazıyor (T1-050). Bu turda **yolun kullanıldığı ve DB'de tip sapması bıraktığı** ölçüldü: `order.defaultDeadlineDays` ve `workorder.defaultPlanDurationDays` JSON **string** (`"365"`), oysa aynı ayarlar tipli yoldan yazıldığında sayı oluyor (`label.copies = 2`).

**Kanıt (kod).**
- `Teks-Erp/src/routes/admin.routes.ts:1081-1084, 1144-1168` — allowlist/tip kontrolü yok (T1-050).
- Kurtaran şey okuyucu: `src/services/system-setting.service.ts:39-47` `asNumber` string'i `parseFloat` ile çözer → **bugün zararsız**. Ama `:49-53` `asBoolean` yalnız `"true"` metnini kabul eder:
```ts
function asBoolean(value) { if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true"; return false; }
```
  → aynı uçtan `{"value":"1"}` yazılan bir bayrak **sessizce KAPALI** okunur.

**Veride fiili ihlal (K2).** (saha)
```sql
SELECT key, jsonb_typeof(value), value FROM system_settings WHERE jsonb_typeof(value)='string';
SELECT "createdAt","userId","newData" FROM system_logs
 WHERE "tableName"='SYSTEM_SETTING' AND "recordId" IN
 ('order.defaultDeadlineDays','workorder.defaultPlanDurationDays') ORDER BY 1;
```
- `order.defaultDeadlineDays = "365"` (string) · `workorder.defaultPlanDurationDays = "365"` (string) — 34 satırın 2'si.
- Audit izi: 07-20 16:20 `{"value":"45"}` (Eda), 08-01 13:13 `{"value":"365"}` ×2 (admin) → yol **üç kez** kullanılmış. Aynı gün tipli yoldan yazılan `label.copies` sayı olarak duruyor (`{"value":2}`).

**failure_mode.** Yönetici ileride aynı ham uçtan `kk1.duplicateGuardEnabled` gibi bir bayrağı `{"value":"1"}` diye yazar (JSON'da tırnak koymak yaygın hata). `asBoolean` bunu **false** okur; panel de aynı okuyucudan beslendiği için "kapalı" gösterir, kullanıcı "açtım ama açılmıyor" der ve hiçbir hata mesajı yoktur.

**İş etkisi.** Bugün gerçekleşmiş zarar yok; yolun kullanıldığı ve tip sapması ürettiği kanıtlandı.
**Öneri (2. tur).** Ham uca **anahtar allowlist'i + anahtar başına tip şeması** (feature-flags yolundaki doğrulamaların aynısı); bilinmeyen anahtar 400.
**Kabul kriteri.** `PUT /api/admin/settings/order.defaultDeadlineDays` gövdesi `"365"` iken 400 döner; `365` iken 200.
**Efor.** 0,5 gün.
**Önceki defter.** T1-050 (ayakta, S3). **Yeni kanıt:** yolun sahada 3 kez kullanıldığı ve 2 satırın hâlâ metin tipinde durduğu.

---

### [V-4-12] `mobile:kk1-yari-mamul` izni **hiçbir kullanıcıya atanmamış** — uzlaştırma izni getirir, atamaz; ekran yalnız `mobile:*` taşıyan tek hesaptan açılabiliyor
| Şiddet | S4 | Kategori | E / G | Öncelik | P4 | Modül | yetki | Kanıt seviyesi | K2 |

**Özet.** İzin kataloğu koda taşınmış ve boot uzlaştırması izni DB'ye getiriyor — **ama kimseye atamıyor** (yazılı ve bilinçli karar). Sahada 70 iznin **1'i** hiçbir aktif kullanıcıda yok: `mobile:kk1-yari-mamul`. Wildcard sayesinde yalnız `mobile:*` taşıyan tek hesap (`admin`) ekrana ulaşabiliyor; `admin:*` taşıyan diğer iki yönetici (`Berat`, `AhmetOnur`) **ulaşamıyor** çünkü wildcard alan başınadır.

**Kanıt (kod).** `Teks-Erp/src/middlewares/rbac.middleware.ts:35-47` — `matchesPermission`: `"*"` global, aksi hâlde yalnız `<alan>:*`. `admin:*` mobil izni kapsamaz.

**Veride fiili ihlal (K2).** (saha)
```sql
SELECT p.code FROM permissions p WHERE NOT EXISTS (
  SELECT 1 FROM user_permissions up JOIN users u ON u.id=up."userId"
   WHERE up."permissionId"=p.id AND u."isActive" AND u."deletedAt" IS NULL);
-- → mobile:kk1-yari-mamul   (tek satır)
SELECT u.username FROM users u JOIN user_permissions x ON x."userId"=u.id
  JOIN permissions p ON p.id=x."permissionId" WHERE p.code='mobile:*';  -- → admin
```
Ayrıca `permissions` tablosu ile `src/constants/permission-catalog.ts` **70/70 birebir** (iki yönlü diff boş) — katalog aynası sağlam, eksik olan yalnız **atama**.

**failure_mode.** "Yarı Mamul KK1" ekranı sahada hiçbir operatörde açılmaz; ilgili paketin ürettiği veri prod'da **0 satır**dır (`entrySource='SEMI_FINISHED'` kaydı yok). Tek görünürlük panelin "N yetki hiçbir kullanıcıda yok" bandıdır ve o da bir uyarı değil bilgi satırıdır.

**İş etkisi.** Yazılmış bir özellik sahada hiç kullanılmıyor; bu, kök `CLAUDE.md`'nin 2026-08-26 notunda zaten "paketin üç ucu birden açık kaldı (rota yok · izin 0 kullanıcıda · masaüstü çıkışı yok)" diye kayıtlı — bulgu, **kapanmadığının** ölçülmesidir.
**Öneri (2. tur).** İlgili operatör rol şablonuna (`MOBILE_KK1`) izni ekle ve şablonu uygula; ya da özellik bilinçli olarak ertelenmişse bandın metni "atanmayı bekliyor (N gün)" olsun.
**Kabul kriteri.** `mobile:kk1-yari-mamul` en az bir aktif operatörde; ya da paneldeki bant yaşı gösterir.
**Efor.** 0,25 gün.
**Önceki defter.** Yok (kök `CLAUDE.md` 2026-08-26 notunun ölçülmüş devamı).

---

## Uygulanan kontrol listesi

| Madde (görev metni) | Durum |
|---|---|
| nameFold mükerrerleri (tombstone süzgeçli), saha'da partial unique VAR MI / kaç grup | **uygulandı** → V-4-01 (saha: `items` sed YOK + 1 grup; dev: `colors` sed YOK + 1 grup; `customers`/`subcontractors` temiz) |
| code tekilliği (STK-… sayaç boşluğu / mükerrer) | **uygulandı** → STK-000001…000019 **boşluksuz** (19/19); harf-katlanmış kod mükerreri 8 grup → V-4-06; müşteri/renk/fasoncu/makine/istasyon 0 |
| `mergedIntoId` zinciri (tombstone'a merge, döngü) | **uygulandı, ihlal 0** → saha 13 tombstone / dev 80; zincir 0, döngü 0, canlı satırdan tombstone'a referans 0, aktif tombstone 0 |
| isActive=false ama referanslanan ana veri | **uygulandı** → V-4-02 (1 açık sipariş kalemi + 2 canlı top); renk/müşteri/istasyon/makine 0 |
| quality_grades: sortOrder, targetStatus (FİRE→SCRAP) | **uygulandı, ihlal 0** → 1.KALITE(10, WAREHOUSE) · A1(20, WAREHOUSE) · FIRE(30, **SCRAP**, `skipLabel=true`); saha ve dev birebir |
| reason_presets: code tekilliği per kind, legacyTexts, son aktif satır gizli | **uygulandı, ihlal 0** → `reason_presets_kind_code_key` VAR; 29 satırın 29'u `isSystem=true` ve aktif; `legacyTexts` hepsi boş (fabrika hiç ad düzenlememiş — 2026-08-26 TTL hatasının saha etkisi bu yüzden 0) |
| permissions: katalog↔DB aynası (eksik/fazla kod) | **uygulandı, ihlal 0** → 70/70 birebir |
| "N yetki hiçbir kullanıcıda yok" | **uygulandı** → 1 (`mobile:kk1-yari-mamul`) → V-4-12 |
| SoD üçlüsü hangi kullanıcılarda | **uygulandı** → `shipping:write`+`shipping:undo-dispatch`+`roll:manual-adjust`(+`invoice`) üçlüsünü **6 aktif kullanıcı** taşıyor (admin, AhmetOnur, Berat, Eda, Enes, Samet); mekanizması → V-4-04 |
| admin dışı kullanıcıların şifre hash biçimi | **uygulandı, ihlal 0** → 9 kullanıcının 9'u `$2b$10$` (bcrypt, maliyet 10); düz/zayıf hash yok |
| pasif kullanıcı aktif oturum | **uygulandı, ihlal 0** → 0; ama `revokedAt IS NULL AND expiresAt<=now()` = **10** (K5 §2.1 doğrulandı) |
| devices: onaysız cihaz + son görülme; eşleştirme tekilliği | **uygulandı** → 28/28 **APPROVED**, 28/28 aktif, **28/28 `machineId=NULL`**; `deviceId` unique; 8 cihaz 20+ gündür görülmemiş ama pasifleştirilmemiş (`device.pairingRequired=false` olduğu için kapı zaten uygulanmıyor — T1-113) |
| system_settings: anahtar tekilliği, JSON geçerliliği, bilinmeyen anahtar | **uygulandı** → `key` PK; 4 JSON nesnesi geçerli; bilinmeyen anahtar **0**; tip sapması 2 → V-4-11 |
| feature-flag gerçek değerleri (PROD AYARLARI TABLOSU) | **uygulandı** → §0 |
| AUDIT: tablo başına kayıt | **uygulandı** → 51 farklı `tableName`; ilk 5: ROLL 4.287 · LABEL_PRINT_EVENT 2.557 · WORK_ORDER 454 · ITEM 398 · AUTH 346 |
| AUDIT: kullanıcı FK RESTRICT mi | **uygulandı** → **HAYIR**, `system_logs_userId_fkey … ON DELETE SET NULL` (T1-034 doğrulandı); tamper trigger `system_logs_block_tamper` mevcut ve `tgenabled='O'`, `teks.audit_guard` kopyada BOŞ |
| AUDIT: userId NULL oranı | **uygulandı** → **408 / 10.485 = %3,9**; script/iş yolları: `USER_PERMISSION` 24/24 · `permissions` 6/6 · `items/colors/subcontractors` 13/13 · `SYSTEM` 67/93 |
| AUDIT: event türleri | **uygulandı** → CRUD + `LOGIN_SUCCESS/FAILED`, `STARTUP`, `PERMISSION_CATALOG_RECONCILED`, `ROLE_TEMPLATE_CATALOG_RECONCILED`, `USER_PERMISSION_SET`, `BACKUP_*`, `LABEL_PRINTED` |
| AUDIT: 'hayalet' geçişler (statusChangedAt var, audit yok) | **uygulandı** → **535 / 2.392 (%22,4)** → V-4-07 |
| AUDIT: kişisel veri (telefon/VKN/e-posta diff'te) | **uygulandı** → 40 satır (`CUSTOMER` 33 · `SUBCONTRACTOR` 7) `taxNumber/email/contactPerson` taşıyor; **PIN/şifre/kart kodu sızıntısı 0** (T1-119 doğrulandı) |
| archive: en eski system_logs tarihi (6 ay arşivi çalışıyor mu) | **uygulandı** → en eski `2026-07-16 12:50`; sistem 2026-07-16'da kurulmuş (rolls/orders/users hepsi o tarihte başlıyor) → **40 günlük veri, 6 aylık eşiğe daha ulaşılmadı**; `system_log_archives`in 0 olması BEKLENEN (T1-121'in "hiç satır taşımadı" ifadesi bugün için bir kusur değil — bkz. Sınır ötesi) |
| printed_documents / label_templates: default tekilliği, boş şablon | **uygulandı** → `label_templates_one_default_per_kind` (partial) VAR, 4 kind'ın 4'ünde tek varsayılan; `traveler_card_templates_isDefault_key` (partial) VAR, tablo boş; `printed_documents_docType_sourceId_version_key` VAR, **aynı kaynakta birden çok ACTIVE = 0**; `label_context_defaults` 3 kind için var ve üçü de `isDefault` ile **AYNI** şablonu gösteriyor, **SWATCH satırı YOK** (T1-096 doğrulandı); "sürüm boşluğu" 2 kart → incelendi, kusur DEĞİL (v1 hiç basılmamış, sürüm baskıyı değil revizyonu sayar) |
| latency/persist tabloları büyüklük | **uygulandı** → `endpoint_latency_daily` 3.117 satır / 1,3 MB / 38 gün; `RETENTION_DAYS=90` + `deleteMany` (`latency-persist.service.ts:34,171-173`) → sınırlı büyüme, kusur yok. En büyük tablo `system_logs` 6,6 MB |
| Tur-1 çürütücü önerilerinin alanıma düşenleri | **işlendi** → `admin:users` self-escalation (V-4-05) · fold seddi iki yönlü ayrışma (V-4-01) · prod kopyası kanıt hijyeni (V-4-09). `createUser` `quickPin/cardToken` sessiz düşüşü (`permission-management.service.ts:529,532`) → **ele alındı, bulgu yazılmadı**: sahada 8 kullanıcının 8'inde `quickPin` DOLU, `cardToken` 9/9 boş ama kart girişi `auth.loginMethods`ta zaten kapalı → veride tezahür yok, K0'da kalıyor (Tur-1'in `L` alanına ait) |
| fabric_properties(+values) istasyon bağı | **uygulandı, ihlal 0** → 10 özelliğin 10'unda tam 1 istasyon bağı; bağsız özellik yok; `KURSUN` AUTO, kalan 9 OPTIONAL |
| customer_branches / aliases | **uygulandı** → `customer_branches` 0 satır (`customers.branchesEnabled=false`); `customer_item_aliases` 54, `customer_color_aliases` 2; `aliasFold` sapması 0 |
| stations / machines | **uygulandı** → 6 istasyon (hepsi aktif, `SEVK_1` dahil); 6 makine, 5'i aktif — biri **TEST** (V-4-09) |
| duplicate_reviews | **uygulandı** → 13 satır, hepsi `MERGED`, **13/13 `decidedById` NULL** (V-4-03'e dahil edildi); bugün hâlâ kesin-ad adayı: `items` 1 grup, müşteri VKN 0 |
| nameFold kolonlarının tazeliği (ad değişince fold bayat kaldı mı) | **uygulandı, ihlal 0** → 17 tablo × `nameFold IS DISTINCT FROM tr_fold(name)` → hepsi **0** |
| user_permissions / sessions yetim satır | **uygulandı, ihlal 0** → 0/0/0; `sessions.deviceId` bilinmeyen cihaz 0 |
| permission_templates ↔ role-template-catalog | **uygulandı** → 26/26 kod birebir; `list` modlu şablonların izin kümeleri de birebir. `ADMIN_FULL` ve `MOBILE_*` hesaplanan modlarda olduğu için mekanik diff yapılmadı (**kısmi**) |
| Prod kopyasında olmayan alanlar | **kapsam dışı — sebep:** kopya 190/195 migration taşıyor; `order_lines.cancelledAt`, `orders.cancelReason`, `ReasonPresetKind.ORDER_CANCEL` ve 2026-08-26+ ayarları (`system.installationId`) bu kesitte YOK → o alanların saha ölçümü **deploy sonrasına** bırakıldı |
| Repro (K3) | **kapsam dışı — sebep:** V-4 alanı yarış bulgusu üretmedi; tüm bulgular K2 (veride fiili ihlal) düzeyinde kanıtlı. D-A/D-B dışındaki alanlardan repro istenmiyor |

---

## Doğru yapılanlar (korunması gereken kalıplar)

1. **`nameFold` kolonları veriyle %100 tutarlı.** 17 tabloda `nameFold IS DISTINCT FROM tr_fold(name)` sorgusu **0** döndü — yani ad her düzenlendiğinde katlanmış kopya da yazılıyor ve JS↔SQL katlaması BMP genelinde uyuşuyor (`test_fold_contract §2b`'nin ölçtüğü sözleşme veride de tutuyor). Bu, arama/mükerrer/sed altyapısının tamamının dayandığı zemin.
2. **Birleştirme motoru veri düzeyinde kusursuz çalışmış.** 13 birleştirmede zincir 0, döngü 0, kendine-merge 0, aktif kalmış tombstone 0, canlı satırdan tombstone'a referans 0 (rolls/order_lines/work_orders/dispatches için ayrı ayrı ölçüldü). 42 kurallık `MERGE_MAP` ilişki taşıması işini yapıyor. (Kusur yalnız audit'in **adında** — V-4-03.)
3. **İzin ve rol şablonu katalogları koddan DB'ye birebir yansımış.** 70/70 izin kodu, 26/26 şablon kodu, `list` modlu şablonların izin kümeleri — hiçbirinde drift yok. "Katalog koda, atama panele" ayrımı çalışıyor.
4. **Kilit/sayaç disiplini kodda doğru sırayla yazılmış.** `code-unique.helper.ts:80` advisory kilidi korunan okumadan ÖNCE alıyor ve namespace envanteri (8021-8026) dosyada tutuluyor — "grep pg_advisory → koruma var" tuzağına düşmeyen ender kalıplardan.
5. **Audit gürültü kontrolü bilinçli.** `base.service.ts:1214` — değişiklik yoksa audit satırı YAZILMIYOR ("Kaydet'e bastı ama hiçbir şey değiştirmedi bir DENETİM OLAYI DEĞİLDİR"); ölçüldü: `LABEL_TEMPLATE` 94 satırda kalmış, eskiden 4.813'tü.
6. **Şifre saklama ve sızıntı hijyeni.** 9/9 kullanıcı bcrypt `$2b$10$`; audit'te `quickPin/passwordHash/cardToken/password` anahtarı taşıyan **0** satır.
7. **Retention gerçekten yazılmış.** `endpoint_latency_daily` 90 günlük `deleteMany` ile budanıyor ve damga başarıdan SONRA işaretleniyor (`latency-persist.service.ts:171-173`) — "damgayı başta yaz" tuzağına düşülmemiş.
8. **Partial unique'lerin doğru kullanımı.** `label_templates_one_default_per_kind`, `traveler_card_templates_isDefault_key (WHERE isDefault=true)`, `label_template_variants_one_primary`, `<tablo>_nameFold_key (WHERE mergedIntoId IS NULL)` — hepsi "düz unique olsaydı sistemde toplam tek satır tutulabilirdi" tuzağını kapatıyor.

---

## Sınır ötesi notlar

| Hedef alan | Gözlem |
|---|---|
| **J / I (yedek-arşiv)** | **T1-121'in ("system_log_archives hiçbir zaman gerçek satır taşımadı") DÜZELTİLMESİ:** sistem **2026-07-16'da kurulmuş** (`rolls`, `orders`, `users`, `system_logs` minimum tarihleri aynı gün) → kesit alındığında veri **40 günlük**tü, arşiv eşiği ise ay cinsinden (`archiveOlderThan(monthsToKeep)`). Arşivin boş olması bugün BEKLENEN durumdur; bulgu "arşiv çalışmıyor" değil, "arşiv yolu hiç koşulmadığı için ilk koşumda ne olacağı bilinmiyor" biçiminde daraltılmalı. `audit.lastArchiveAt=2026-08-16` damgası işin **koştuğunu** ama taşıyacak satır bulamadığını gösteriyor. |
| **A / E (workorder)** | Tur-1 çürütücüsünün `updateTargetProperties` FLAG silme önerisi veride doğrulanıyor: `roll_properties` 2.256 satırın **1.149'u** `KURSUN` (istasyondan AUTO gelen), yani WO hedef listesinde olmayan FLAG kümesi gerçekten büyük. Kod tarafı `workorder.service.ts:5700-5713`. Ölçümü buraya yazıyorum, bulgusu A/E alanının. |
| **G (güvenlik)** | `auth.loginMethods = {enabled:["list","pin"], primary:"pin"}` — sahada giriş = **kullanıcı listesinden seç + 6 haneli PIN**; 9 kullanıcının 8'inde PIN dolu, 3'ü yönetici. T1-014'ün olasılık tarafı bu değerle **yüksek**. Ayrıca `device.pairingRequired=false` → T1-113'ün cihaz kapısı hiç uygulanmıyor. |
| **G** | 28 cihazın 28'i APPROVED ve **hiçbirinin makine ataması yok** → `req.device.machineId` üretim atfı prod'da her yerde NULL (K5 H15 doğrulandı, veriyle). |
| **H (performans)** | En büyük tablo `system_logs` 6,6 MB / 10.485 satır; `rolls` 2,7 MB / 2.431. T1-056'nın "2.431 satırlık tabloda 5-10 sn kuyruk" ölçümü tablo boyutuyla değil sorgu şekliyle ilgili — veri tarafında darlık yok. |
| **J (migration)** | Prod kopyasında `ReasonPresetKind` enum'u **`WORK_ORDER_REWORK` içeriyor ve 6 katalog satırı var (2026-08-25 13:49)**, ama `20260825140000_reason_preset_rework_kind` `_prisma_migrations`'ta YOK. Bu satırlar restore sonrası penceresinde doğduğu için **prod'un kendisi hakkında sonuç çıkarılamaz** (V-4-09). İyi haber: o migration `ADD VALUE **IF NOT EXISTS**` kullanıyor → yeniden koşumda düşmez (T1-065'in "10 dosyada IF NOT EXISTS yok" listesinde bu dosya yok). |
| **K (test)** | `test_audit_labels.ts:117-121` yalnız literal `tableName:` tarıyor → değişken geçilen çağrılar kapsam dışı (V-4-03). Aynı kalıbın başka örnekleri olabilir: `grep -rn 'tableName: [a-z]' Teks-Erp/src` → 2 vuruş (ikisi de merge servisi). |
| **C (veri modeli)** | `system_logs.tableName` bir **enum değil serbest metin** ve iki adlandırma düzeni yan yana yaşıyor (UPPER mantıksal ad + lowercase fiziksel ad). Tip düzeyinde zorlanmadığı için V-4-03 sınıfı hata tekrar doğabilir. |
| **E (iş kuralı)** | `quality_grades` 3 satır: `A1.targetStatus = WAREHOUSE` (A1_STOCK DEĞİL). Rapor tarafında "2. kalite" ayrımının `RollStatus.A1_STOCK`tan mı `qualityGrade.code`dan mı türetildiği iki farklı cevap verebilir (T1-082'nin komşusu). |

---

## KAPSANMAYAN / ERİŞİLEMEYEN

1. **Canlı prod DB'sine erişim yok.** Bütün K2 ölçümleri 2026-08-25 kesitinden; kesit **190/195 migration** taşıyor. Son 5 migration'ın getirdiği kolonlar (`order_lines.cancelledAt`, `orders.cancelReason`, `ReasonPresetKind.ORDER_CANCEL`, `orders` yeni index) ve 2026-08-26+ özellikleri (`system.installationId`, mobil OTA tabloları) bu kopyada **YOK** → bu alanların saha ölçümü deploy sonrasına bırakıldı.
2. **Kopyanın kirliliği (V-4-09).** 2026-08-25 13:15-13:54 penceresindeki 63 audit satırı, 13 birleştirme ve 2 iş emri/2 fason sevki restore SONRASI oluşmuş olabilir; hangisinin prod'da da var olduğu bu kopyadan **ayırt edilemez**. Bu yüzden tarih/aktör bazlı bütün ölçümlerimde eşik `< 2026-08-25 13:00` tutuldu ve aksi belirtilen yerlerde `[VARSAYIM]` yazıldı.
3. **`teks.audit_guard` prod değeri ölçülemez.** Kopyada `current_setting('teks.audit_guard',true)` boş; `ALTER DATABASE … SET` ayarları restore ile taşınmıyor. Trigger'ın kendisi mevcut ve etkin (`tgenabled='O'`). (T1-034 ile aynı sınır.)
4. **PIN/kart kodu içerikleri okunmadı** (brief kuralı: sır/kişisel veri rapora girmez). Yalnız "dolu/boş" sayıldı; PIN uzayının gerçekte ne kadar dolu olduğu (çakışma yakınlığı) ölçülmedi.
5. **`ADMIN_FULL` ve `MOBILE_*` şablonlarının izin kümeleri mekanik olarak diff'lenmedi** — bu şablonlar `mode` ile hesaplanıyor (`all`/wildcard), kod tarafında düz liste yok. `list` modlu 7 WEB şablonu birebir doğrulandı.
6. **Electron/mobil istemci tarafı denetlenmedi** (salt-okunur backend denetimi); yalnız `Electron/src/lib/audit-labels.ts` **ayna** olduğu için V-4-03'te kanıt olarak okundu.
7. **Repro (K3) yapılmadı** — V-4 alanı yarış bulgusu üretmedi; sözleşme gereği repro yalnız D-A/D-B alanlarından isteniyor.
