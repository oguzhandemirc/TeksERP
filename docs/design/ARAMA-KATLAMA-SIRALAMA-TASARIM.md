# ARAMA · KATLAMA · SIRALAMA TASARIMI — Türkçe-duyarsız arama, tek katlama sözleşmesi, ölçekli performans

> **Durum:** F1-F4 UYGULANDI ve commit edildi (2026-08-19) — bkz. §0.2 "Uygulamada değişenler".
> F5 (canlı deploy) cumartesi (2026-08-22) veri sıfırlamasında; F6 ayrı iş.
> Aşağıdaki plan metni ORİJİNALDİR; uygulama sırasında ölçümle değişen kararlar §0.2'de listelenir. Cumartesi (2026-08-22) veri sıfırlaması;
> uygulama sıfırlama penceresinde ya da hemen sonrasında (tablolar boşken index/generated kolon bedava).
> **Kapsam:** Teks-Erp (backend + migration) · Electron · mobil. **Ön çalışma:** `b66829d5` (adlar BÜYÜK, istemci katlaması).
> **Ölçüm tabanı:** dev DB (PG 18.6, ICU en-US) + 200 bin satırlık sentetik ölçüm; canlı = PG 16.9 Windows, **C locale**.

---

## 0. Karar Özeti (önce bunu oku)

| # | Karar | Öneri | Gerekçe (kısa) |
|---|---|---|---|
| D1 | **Arama anahtarı DB'de saklanır** — her aranan metin kolonunun yanına `xFold` **GENERATED ALWAYS … STORED** kolonu + **pg_trgm GIN** index | ✅ Uygula | 200k satırda 8.461 ms → 2,6-3,3 ms (**~3200×**). Prisma `contains` düz LIKE üretir, ham SQL'e geçmeden ~40 çağrı noktası korunur. |
| D2 | **Tek katlama sözleşmesi:** `tr_fold(x) = lower(unaccent(x) COLLATE "C")` (SQL) ≡ `foldSearchText(x)` (JS, üç projede bayt-bayt aynı dosya) — **korpus testiyle** eşitliği kanıtlanır | ✅ Uygula | Bugün 5 farklı katlama var, ikisi ters yönlü. İstemci↔sunucu ayrışması (madde 12) yapısal olarak kapanır. |
| D3 | **Mükerrer anahtarı = `nameFold`** (ASCII katlamalı; "ŞAHİN" ≡ "SAHIN"), DB'de **partial UNIQUE** index | ✅ Uygula (sıfırlama bunu bedava kılar) | Bugünkü guard O(N) tam tablo okuması + JS; DB kısıtı yoktu çünkü canlıda tarihsel mükerrer vardı — cumartesi kalkıyor. |
| D4 | **Sıralama Türkçe:** ad kolonlarına kolon-düzeyi `COLLATE` (ICU `tr`), istemcide `Intl.Collator('tr')` | ✅ Uygula (ICU ön koşuluyla) | Canlı C locale'de `ORDER BY name` bayt sırası: **Ç/Ğ/İ/Ö/Ş/Ü ile başlayan her ad Z'den SONRA**. Prisma kolon collation'ını görmüyor (ölçüldü: drift yok). |
| D5 | **Depolama biçimi ayarı (büyük/küçük/ilk harf) EKLENMEZ** — ama D1 sayesinde ileride tek satırlık karar olur | ✅ Bugün ekleme | Arama/mükerrer anahtarı depolanan biçimden **ayrıldığı** için `normalizeDisplayName` sonradan "girildiği gibi" moduna çekilebilir; arama ve mükerrer etkilenmez. SAP `NAME1/MCOD1` ayrımının aynısı. |
| D6 | Terim çok kelimeliyse **kelime başına AND** (aynı yol içinde), yollar arası OR | ✅ Uygula | "şahin tekstil" ↔ "tekstil şahin" aynı sonucu versin; her kelime GIN'den beslenir, maliyet ihmal. |
| D7 | Kod alanları (`orderNumber`, `shipmentNo`, `workOrderNumber`, `batchNumber`…) katlanmaz: `normalizeScanCode(term)` + düz `contains`, büyük 4 tabloda trigram GIN | ✅ Uygula | Kodlar ASCII BÜYÜK; `mode:"insensitive"` (ILIKE) index kullanmaz. |
| D8 | `rolls` / `roll_movements` / `system_logs`'a **hiç** GIN konmaz | ✅ | Tarama doğruladı: bu tablolarda serbest metin araması YOK (barkod = eşitlik). Kaynak tüketimi kaygısı (madde 5) burada bitiyor. |

### 0.1 Kullanıcı kararları (2026-08-19)
| Soru | Karar |
|---|---|
| D3 mükerrer anahtarı ASCII katlamalı mı ("SAHIN" ≡ "ŞAHİN" → 409)? | **EVET** — `nameFold` üzerinde UNIQUE, mesaj mevcut kaydı gösterir |
| D4 ad kolonlarına tr collation? | **EVET** — ICU/libc yoksa yalnız bu madde ertelenir |
| `order_lines.customerItemName` + müşteri alias'ları BÜYÜK harfe normalize? | **EVET** — belgeye/etikete de BÜYÜK basılır; §2.2/§6.1 #3-#4 buna göre (`normalizeDisplayName` yazımda) |
| F0 canlı ön koşul | Sahadan çekilen `tekserp_saha` (2026-08-09 yedeği) incelendi: canlıda **yalnız `plpgsql`** kurulu, `unaccent`/`pg_trgm` YOK — kurulabilirliği (contrib dosyaları + ICU) yedekten görülemez. Kullanıcı kararı: **bilerek ilerle**; migration `CREATE EXTENSION`'da yüksek sesle düşer, o gün contrib kopyalanır (EDB Windows derlemesi ikisini de ve ICU'yu taşır). |

### 0.2 Uygulamada DEĞİŞEN kararlar (2026-08-19, ölçümle)

Plan yazılırken bilinmeyen üç şey uygulama sırasında ölçüldü ve üç kararı değiştirdi.
Bunlar planın "yanlış"ı değil, planın kendi ölçüm adımlarının çıktısıdır.

| # | Plandaki karar | Uygulanan | Neden değişti (ölçüm) |
|---|---|---|---|
| D2 | `tr_fold = lower(unaccent(x))` | **`unaccent` TASARIMDAN ÇIKTI.** `tr_fold = NFD → birleştirici işaretleri at → 26 harflik istisna tablosu → YALNIZ ASCII küçültme (`COLLATE "C"`) → boşluk tekleme` | `unaccent`ın sözlüğü BMP'de **2407 karakterde** saf NFD'den ayrılıyor ve JS'te taklit EDİLEMİYOR (`©`→`(c)`, `¼`→` 1/4`, `Ø`→`o`, `ß`→`ss`, Kiril/Yunan çevriyazısı). Ayrışma tehlikeli yöndeydi: "Ø"lu adı arayan 0 sonuç alırdı. Üç kazanç: JS↔SQL eşitliği **yapısal** (63.485 karakterde ölçüldü, 0 sapma) · **`unaccent` uzantısı artık GEREKMİYOR** (sahada kurulu değil → F0 riskinin yarısı düştü) · sonuç **ortamdan bağımsız** (dev ICU ↔ saha C locale aynı cevabı veriyor). Ayrıca Unicode normalizasyon **kararlılık politikası** `unaccent.rules`'un vermediği bir garanti veriyor. |
| D3 | `nameFold` üzerinde **partial UNIQUE** | **UNIQUE KONMADI**; davranış (409) uygulama katmanında, kolon indexli (O(N)→O(1)) | Canlı veride BUGÜN 12 grup / 15 fazla satır mükerrer var: `Moda Tekstil` + `MODA TEKSTİL` **ikisi de aktif**, `ACTIVO`+`ACTİVO`, … UNIQUE migration'ı **deploy anında** düşürürdü ve çözümü gerçek kayıtları birleştirmek olurdu — bu bir **iş kararı**, migration'ın işi değil. Görünürlük yüzeyi: `scripts/find_fold_duplicates.ts` (salt-okunur). Sıfırlamadan sonra tablolar boşken UNIQUE 5 satırlık risksiz bir migration. |
| §2.3 | Gölge kolon tespiti `default.name === "dbgenerated"` | **Ad sözleşmesi** (`*Fold` son eki), DB'de **iki yönlü** kilitli | Prisma 7 runtime DMMF'i alan başına yalnız `{name, kind, type}` taşıyor — "bu kolonu DB üretiyor" bilgisi çalışma anında **okunamıyor** (ölçüldü). `test_db_invariants` §9 sözleşmeyi iki yönden kilitler: her GENERATED kolon `Fold` ile biter **VE** `Fold` ile biten her kolon GENERATED'dır. |

**Ek olarak planda olmayan, uygulama sırasında ortaya çıkan iki şey:**

- **`test_search_field_config.ts` (yeni bekçi).** METİN ↔ KOD kovaları birer *string dizisi*, yani TypeScript yanlış yerleştirmeyi göremiyor. İki arıza modu da bu turda fiilen yaşandı: kod alanı metin kovasında → `Unknown argument codeFold` (500); metin alanı kod kovasında → katlama sessizce atlanır, arama Türkçe-duyarlı kalır. Bekçi 296 dosyayı TS AST ile tarar, her yolu Prisma DMMF üzerinden ilişki ilişki çözer (45 metin + 42 kod yolu), körlük zemini var, iki yönde de negatif sondayla kırmızı verdiği doğrulandı.
- **Migration'da SIRA load-bearing:** collation değişimi generated kolondan **ÖNCE** gelmek zorunda — `ERROR: cannot alter type of a column used by a generated column`. Aynı tuzak ileride de geçerli.

### 0.3 Uygulama durumu (2026-08-19)

| Faz | Commit | Durum |
|---|---|---|
| F1 — sözleşme | `ac210616` | ✅ üç projede bayt-bayt aynı modül + `test_fold_contract` (28 kontrol, 3 negatif sonda) + 5 ekranlık `toLowerCase()` regresyonu |
| F2 — migration + şema | `ecf16c22` | ✅ `20260819060000_search_fold` (31 gölge kolon · 9 GIN · 18 collation) + `test_db_invariants` 68→79 |
| F3 — backend | `22c1bb7f` | ✅ `buildTextSearch`, 39 çağrı + 14 route + 34 fixture, mükerrer indexli, 8 denetim kusuru, `test_search_field_config` |
| F4 — istemci | `07ecb051` | ✅ 16 katlama yeri + CommandPalette + `lib/collate.ts` + PickerModal + baş harfler |
| F5 — canlı deploy | — | ⏳ cumartesi. **İlk komut `CREATE EXTENSION pg_trgm`** — sahada kurulu değil; düşerse contrib dosyaları kopyalanır. |
| F6 — picker ölçeği | — | ⏳ ayrı iş (§6.2 D) |

**Ölçüm (200 bin satır, dev DB):** varyant-OR araması `Parallel Seq Scan` **583 ms** → katlanmış kolon `Bitmap Index Scan` **6,3 ms**.

**Test durumu:** backend 318/319 · Electron 712/712 · mobil 541/541.
Tek kırmızı `test_consistency` §18 ve bir **veri** bulgusudur (kod kusuru değil):
canlıda `Moda Tekstil` + `MODA TEKSTİL` iki ayrı **aktif** müşteri. `name` kolonu
Türkçe collation'a geçtiği için `lower('İ')` artık doğru çalışıyor ve kontrol
daha önce **kör olduğu** mükerreri görüyor. Çözümü: iki kaydı birleştirmek
(işletme kararı) ya da cumartesi sıfırlaması.

**Sektörde karşılığı (madde 2 sorusu):**
- **SAP:** `KNA1-NAME1` girildiği gibi saklanır; **`MCOD1`** onun büyük harfli/normalize "matchcode" gölgesidir, arama ve F4 yardımı oradan koşar. Yani *görünen değer ≠ arama anahtarı*. Bizde D1 tam bunu kurar (`name` ↔ `nameFold`).
- **Odoo:** `name` girildiği gibi; arama `unaccent(name) ILIKE unaccent(%s)` (`unaccent=True` sunucu bayrağı) + alanlarda `index='trigram'` seçeneği (pg_trgm GIN). D1+D2 birebir bu.
- **PostgreSQL resmi belge:** `unaccent` STABLE'dır; index/generated kolonda kullanmak için **IMMUTABLE sarmalayıcı** yazılır (belgede önerilen desen). Doğrulandı: sarmalayıcı + GENERATED kolon + Prisma `@default(dbgenerated())` = **drift yok**.
- **Türk ERP'leri (Logo/Netsis/Mikro):** cari unvan büyük harf pratiği yaygındır ama çoğunlukla kullanıcı alışkanlığıdır, zorlanmaz. Bizde kullanıcı kararıyla ZORLANIYOR (b66829d5) — D5 bunu geri almıyor, yalnız geri alınabilir kılıyor.

**Değişmeyen üçlü (karıştırılırsa yanlış sonuç):**

| İş | Doğru araç | Yanlış araç → belirti |
|---|---|---|
| **Arama** | ASCII katlama (ç→c, İ→i, ı→i) — `tr_fold` / `foldSearchText` | Türkçe harmanlama → "canakkale" "çanakkale"yi bulmaz |
| **Sıralama** | Türkçe harmanlama (ç≠c, ç C'den sonra) — `COLLATE tr` / `Intl.Collator('tr')` | Katlama → "Çanakkale" "Cebeci" ile "Ceyhan" arasına düşer; C locale → Z'den sonra |
| **Büyük/küçük** | Yerel-duyarlı — `toLocaleUpperCase('tr')` (ad), `toUpperCase()` (kod/barkod) | Düz `toLowerCase()` → "ŞAHİN" → "şahi̇n" (i + U+0307), hiçbir şeyle eşleşmez |

---

## 1. Bugünkü Durum — Ölçülmüş Gerçekler

### 1.1 Arama motoru (`buildTurkishSearch`, `src/utils/query-parser.ts:363`)
Terimi Türkçe **varyantlarına** açar (ç/ğ/ı/ö/ş/ü konumlarında dallanma, 4 konum × 2 aile, tavan 32) ve her yol × her varyant için `contains` üretir → tek aramada **~200 ILIKE**. Bilinen çağrı yolları: 14 `searchFields` konfigi + 8 elle `buildWhereClause` + 17 doğrudan çağrı (tam envanter: §6.1).

| Ölçüm (200 bin satır, `gumus`) | Süre | Plan |
|---|---|---|
| Bugünkü 31 dallı OR | **8.461 ms** | Seq Scan |
| `tr_fold` kolonu + trigram GIN | **2,6 ms** | Bitmap Index Scan |
| Aynı, GENERATED kolon üzerinden Prisma `contains` | **3,3 ms** | Bitmap Index Scan |

Bugün 52 toplu DB'de görünmüyor; 20-50 bin sipariş/topa çıkınca liste ekranı **saniyelerce kilitlenir** (madde 4/7).

### 1.2 Yanlış öncül: "C locale ILIKE Türkçe katlamaz"
Kodda 6+ yerde yazan bu cümle **dev DB'de yanlış** (ICU en-US: `'GÜLŞEN' ILIKE '%gülşen%'` → **true**), **canlıda doğru** (C locale). Yani aynı arama iki ortamda farklı sonuç veriyor ve `scripts/test_turkish_search_fold.ts` ILIKE'ı ASCII-only modelleyerek dev'de gerçekte olandan **daha azını** doğruluyor. İki ortamda da tek gerçek kırık **i-ailesi**: `lower('İ')` = `i`+U+0307 (2 karakter). `lower(unaccent(x))` her iki ortamda da doğru katlıyor (`ÇİSEM→cisem`, `IŞIK/ışık→isik`).

### 1.3 Deneyle kapatılan teknik belirsizlikler (dev DB, Prisma 7.7 `migrate diff`)
| Deney | Sonuç |
|---|---|
| PG `GENERATED ALWAYS AS (tr_fold(name)) STORED` + şemada `nameFold String? @default(dbgenerated())` | **Drift YOK** |
| Aynı kolon şemada düz `String?` | Drift VAR (`DROP DEFAULT` ister) — `dbgenerated()` **zorunlu** |
| Kolon-düzeyi `COLLATE "tr-x-icu"` | **Drift YOK** (Prisma collation'ı hiç görmüyor) |
| `@@index([nameFold(ops: raw("gin_trgm_ops"))], type: Gin)` + `@unique` GENERATED kolonda | **Drift YOK** — GIN ve unique şema-native tanımlanır; yalnız fonksiyon/uzantı/collation/generated-ifade datamodel dışıdır |
| `unaccent` STABLE → IMMUTABLE sarmalayıcı `tr_fold` | Çalışıyor; `lower(... COLLATE "C")` pini ŞART (aşağıda) |
| Prisma `contains` LIKE jokerlerini kaçırıyor mu? | **HAYIR** — `contains:"%"` ve `contains:"_"` 32/32 müşteri döndürdü. Bugünkü kod da etkilenir. |
| `lower('IŞIK' COLLATE "tr-x-icu")` | `ışık` — Türkçe collation altında `lower('I')`=`ı`. `tr_fold` bu yüzden `COLLATE "C"` pinler; kolonlar tr collation'a geçince fonksiyon değişmeden doğru kalır. |
| `'Çanakkale' < 'Cebeci'` | tr-x-icu: **false** (doğru) · en_US: true · C: false ama sebebi bayt sırası (Ç Z'den sonra) |

### 1.4 İstemci
`b66829d5` 7 yeri düzeltti ama **5'inde iğne hâlâ `search.toLowerCase()` ile ön-küçültülüyor** (`PermissionGrid.tsx:57`, `PermissionsCatalogPage.tsx:36`, `TemplatesPage.tsx:41`, `AccessUsersPage.tsx:82`, `StationCapabilitiesPage.tsx:57`) → operatör **"İSTASYON"** ya da **"ŞAHİN"** yazınca 0 satır (U+0307 arka kapıdan geri geldi; testler küçük harf iğne kullandığı için yeşil). Ağaçta **beş** ayrı katlama var (`search-fold.ts`, `searchFold.ts`, `foldNameForCompare`, `reportExport.slugifyFileName`, `deviceNameMatch.canon`), sunucudaki `TR_EQUIV` ise **tek yönlü** (ASCII→Türkçe: "çanakkale" yazınca "CANAKKALE" dalı ÜRETİLMİYOR). Tam liste §6.2.

---

## 2. Hedef Mimari

### 2.1 `tr_fold` — tek katlama fonksiyonu (SQL)
```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- IMMUTABLE sarmalayıcı: PG belgesindeki desen. Sözlük adı AÇIK yazılır (search_path'e bağlı kalmasın);
-- COLLATE "C" pini: kolonlar Türkçe collation'a geçince lower('I') 'ı' vermesin (ölçüldü, §1.3).
CREATE OR REPLACE FUNCTION public.tr_fold(text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT lower(public.unaccent('public.unaccent', $1) COLLATE "C") $$;
```
- Boşluk tekleme/trim **yapmaz** (arama `LIKE '%…%'` olduğu için gereksiz; mükerrer anahtarı için `normalizeDisplayName` zaten trim+tekliyor ve depolanan `name`'in kendisi normalize).
- **IMMUTABLE beyanı bir sözdür:** `unaccent.rules` PG major yükseltmesinde değişirse saklanan değerler bayatlar. Runbook'a not: yükseltme sonrası `ALTER TABLE … ALTER COLUMN xFold SET EXPRESSION AS (…)` (PG17+) ya da drop/add ile yeniden hesap. Altı Türkçe harfin kuralı yıllardır sabit; risk teorik.

### 2.2 Kolon modeli
Kural: **aranan her serbest-metin kolonu** için `<kolon>Fold` GENERATED kolonu. Ad kolonlarında ek olarak `@unique` (mükerrer, D3).

| Tablo | Yeni kolon(lar) | Index | Not |
|---|---|---|---|
| `customers` | `nameFold` | GIN trgm + **UNIQUE** | `taxNumber`/`exportCode` **arama listesinden çıkar** (kod alanı, aşağıda) |
| `items` | `nameFold` | GIN + UNIQUE | |
| `colors` | `nameFold` | GIN | UNIQUE **YOK** — renk mükerreri ayraç-duyarsız + rakam-önce (`foldColorNameForCompare`), JS guard kalır |
| `stations`, `subcontractors`, `subcontractor_categories`, `routes`, `product_recipes` | `nameFold` | GIN + UNIQUE | |
| `machines` | `nameFold` | GIN + UNIQUE `(stationId, nameFold)` | kapsamlı tekillik |
| `customer_branches` | `nameFold`, `cityFold` | GIN ×2 + UNIQUE `(customerId, nameFold)` | |
| `quality_grades`, `defect_types`, `return_reasons` | `nameFold`, `descriptionFold` | GIN ×2 + UNIQUE(name) | |
| `fabric_properties` | `nameFold`, `descriptionFold`, `categoryFold` | GIN ×3 + UNIQUE(name) | |
| `peripheral_devices` | `nameFold`, `addressFold` | GIN ×2 + UNIQUE `(nameFold) WHERE "deletedAt" IS NULL` | tombstone'lu tablo |
| `permission_templates`, `label_templates`, `traveler_card_templates`, `document_profiles` | `nameFold` | UNIQUE (partial: `deletedAt IS NULL` varsa) | **`permission_templates_name_lower_uq` (lower()) KALDIRILIR** — i-ailesi deliği var (§6.1 #9) |
| `users` | `fullNameFold` | GIN | Kişi araması; `username` ASCII, dokunulmaz |
| `order_lines` | `customerItemNameFold` | GIN | Ayrıca yazımda `normalizeDisplayName` uygulanır (bugün yalnız trim — §6.1 #3) |
| `direct_shipments` | `reasonFold` | GIN | |
| `shipments` | `plateNumberFold`, `driverNameFold`, `carrierFold` | GIN ×3 | orta yazma hacmi, kabul |
| `roll_returns` | `reasonTextFold`, `noteFold` | GIN ×2 | |
| `customer_item_aliases`, `customer_color_aliases` | `aliasFold` | GIN + UNIQUE `(customerId, itemId/colorId)` zaten var | Bugün hiç aranmıyor; alan hazır olsun (etikete basılan müşteri adı) |
| **Kod kolonları** `orders.orderNumber`, `work_orders.workOrderNumber`, `shipments.shipmentNo`, `batches.batchNumber` | — (katlanmaz) | trigram GIN **doğrudan kolona** | D7. `sacks.sackNo`, `direct_shipments.shipmentNo`, `*_dispatches.dispatchNo`, `receiptNo` küçük tablolar; ölçüp gerekirse. |
| `rolls`, `roll_movements`, `system_logs`, `traveler_cards` | — | — | D8 |

Boyut/maliyet: master-data'da ihmal; `orders.orderNumber` (200k × ~15 kar.) GIN ≈ 20-30 MB; yazma maliyeti GIN fastupdate ile tolerans içinde. `test_db_invariants.ts` envanterine **fonksiyon + uzantılar + collation + generated ifade metni** eklenir (bunlar datamodel dışıdır; GIN/unique şema-native olduğu için envantere GİRMEZ).

### 2.3 Prisma sözleşmesi
```prisma
model Customer {
  name     String  @db.VarChar(100)
  nameFold String? @unique @default(dbgenerated())      // DB üretir; UYGULAMA HİÇ YAZMAZ
  @@index([nameFold(ops: raw("gin_trgm_ops"))], type: Gin)
}
```
- `sanitizeWriteData` (`base.service.ts:515`) DMMF'te **`default.name === "dbgenerated"`** olan alanları düşürür (bugün her scalar'ı geçiriyor — istemci `nameFold` gönderirse PG "cannot insert a non-DEFAULT value" ile 500 verirdi). Aynı süzgeç `safeSortBy` ve `safeFilters`'a (F30 oracle notu, `base.service.ts:280`) — `xFold` **sıralanamaz ve filtrelenemez** (sıralama Türkçe değil, filtre bilgi sızdırır).
- Zod şemaları `xFold` kabul etmez (`.strict()` olanlar zaten reddeder; `passthrough` olanlar sanitize'a güvenir).
- Arama: `{ nameFold: { contains: foldedTerm } }` — **`mode` YOK** (düz LIKE; kolon zaten küçük ASCII). `mode:"insensitive"` ILIKE üretir ve GIN'i yine kullanır ama gereksiz.

### 2.4 Terim tarafı — `foldSearchTerm` (sunucu) ve `foldSearchText` (üç kopya)
JS spesifikasyonu (bayt-bayt aynı dosya: `Teks-Erp/src/utils/search-fold.ts`, `Electron/src/lib/search-fold.ts`, `mobil/src/utils/searchFold.ts`; bekçi md5 eşitliği doğrular — `permissions.ts` aynası emsali):
```
foldSearchText(s):
  s.normalize("NFD")                       // İ → I + U+0307, Ç → C + U+0327, é → e + U+0301 …
   .replace(/\p{M}/gu, "")                 // birleştirici işaretleri at
   .replace(/ı/g, "i")                     // ı'nın ayrışımı yok — açık
   .replace(LIGATURE_MAP)                  // æ→ae œ→oe ø→o ß→ss đ→d ł→l ð→d þ→th (unaccent.rules ile aynı küme)
   .toLowerCase()                          // ⚠️ DÜZ toLowerCase — toLocaleLowerCase('tr') I→ı yapar, tersine çevirir
foldSearchTerm(s) = foldSearchText(s).replace(/[%_\\]/g, "").trim().replace(/\s+/g, " ")   // LIKE jokerleri (§1.3)
```
- **Korpus bekçisi** (`scripts/test_fold_contract.ts`, canlı DB'ye karşı): U+0020–U+024F'in her karakteri + Türkçe kelime listesi + `"ŞAHİN".toLowerCase()` çıktısı gibi kirli girdiler → `tr_fold($1)` ile JS çıktısı **birebir eşit**; sapma varsa **isimli allowlist**'te olmalı (bugün beklenen: yok; Kiril gibi Latin-dışı harflerde `lower()` C altında dokunmaz, JS küçültür — allowlist'e gerekçeyle girer). Fold dosyasını değiştiren, korpusu geçmek zorunda.
- Çok kelimeli terim (D6): `["sahin","tekstil"]` → aynı yol için `AND [{nameFold:{contains:"sahin"}},{nameFold:{contains:"tekstil"}}]`; ilişkili `some` yolunda AND **`some`'ın içinde** kurulur (aynı satır). Yollar arası OR.
- Kod biçimli terim (`/^[A-Za-z0-9._\/-]+$/`, **rakam şartı KALKAR** — §6.1 #7): kod yollarına `normalizeScanCode(term)` ile `contains`; ad yollarına da katlanmış terimle bakılır ("AKTOS2" hem kod hem ad olabilir — bugünkü sessiz yanlış-negatif kapanır).
- İstemci: min 2 karakter (mobil Depo'daki ≥3 kalır), debounce 300 ms tek standart (`HizliSiparisScreen`, `KartelaStockPickerModal`, `FasonSevkScreen woSearch` debounce'suz — düzelt).

### 2.5 `buildTurkishSearch` → `buildTextSearch`
Aynı imza korunur (çağrı noktası churn'ü minimum): `buildTextSearch(term, paths, { code?: paths })`. Yol dönüşümü konvansiyonla: `"customer.name"` → `"customer.nameFold"`, `"lines.some.item.name"` → `"lines.some.item.nameFold"`; kod yolları dokunulmadan kalır. Varyant üretimi (`TR_EQUIV`, `turkishEquivalents`, `TR_MAX_*`) **silinir**. `where.OR` clobber riski (§6.1 #11): tek yaprak çoğu yerde OR'u gereksiz kılar; kalanlar `AND:[{OR:[…]}]` içine alınır.

### 2.6 Sıralama (D4)
```sql
-- OS'ten bağımsız isim: ICU varsa ICU, yoksa libc yedeği (aynı ada) — migration DO bloğu ile
CREATE COLLATION IF NOT EXISTS public.tr_sort (provider = icu, locale = 'tr');
ALTER TABLE customers ALTER COLUMN name TYPE varchar(100) COLLATE public.tr_sort;   -- vb. ad kolonları
```
- Kapsam: `orderBy`'da geçen ad kolonları (§6.1 §4b listesi + `searchFields`'lı 14 varlığın `name`'i). Kod kolonlarına DOKUNULMAZ (ASCII, C sırası doğru).
- Prisma görmez (§1.3) → `orderBy:{name:'asc'}` otomatik Türkçe olur; index'ler ALTER ile yeniden kurulur (boş tabloda anlık).
- **Ön koşul (canlıda doğrula):** `SELECT count(*) FROM pg_collation WHERE collprovider='i'` > 0 (dev: 883). EDB Windows derlemesi ICU taşır; `C:\Etkili-Yazilim\pgsql` zip derlemesinde **doğrulanmalı**. Yoksa yedek: Windows libc `"tr-TR"` — migration DO bloğu deneyip düşer.
- Deterministic collation (varsayılan) → `=`, `LIKE`, btree hepsi çalışır; `text_pattern_ops` gerekmiyor (prefix araması kod kolonlarında, onlar C).
- İstemci: `Intl.Collator('tr', { numeric: true })` **tek modül sabiti** (comparator içinde `localeCompare` kurmak O(n log n) collator — `PickerModal.tsx:207` notu); `sensitivity:'base'` YASAK (ç≡c yapar, A-Z indeksiyle çelişir — `PickerModal.tsx:211`).
- **SAAS-TASARIM.md:282** notu ("Türkçe büyük/küçük DB collation'a taşınmaz") büyük/küçük için doğru kalır; **sıralama** için kolon collation'ı bu belgeyle karara bağlanmış sayılır — o satıra dipnot düşülür. Tenant DB'leri aynı `tr_sort` ile doğar.

### 2.7 Mükerrer (D3)
- `assertNameNotDuplicate`: `findMany` + JS fold yerine `findFirst({ where: { nameFold: foldSearchTerm(name), …scope } })` — **indexli**, O(1). Renk hariç (bespoke fold, 63 satır, JS kalır).
- DB partial UNIQUE (tablo tablosu §2.2) = ikinci hat; P2002 → mevcut 409 metni (`error.middleware.ts:367` haritası var, `target` kolon adından `nameFold` → "ad" çevirisi eklenir).
- Anlam değişikliği **bilinçli**: "SAHIN" ↔ "ŞAHİN" artık mükerrer (aynı firmanın yazım varyantı). Mesaj mevcut kaydı gösterir; operatör gerçekten farklıysa ada ayırt edici ekler.
- Pasif kayıt politikası: bugünkü guard pasif kayıtları da sayar → UNIQUE `isActive` süzmez (aynı anlam). `deletedAt` tombstone'lu tablolarda `WHERE "deletedAt" IS NULL`.
- Vergi no asimetrisi (fason: yalnız aktif; ad: pasif dahil — §6.1 #10) → tek politika: pasif dahil, mesaj "aktifleştirin".

---

## 3. Migration ve Deploy Planı (cumartesi penceresi)

Sıra (tek migration `20260822xxxxxx_search_fold_and_collation`, en başta `SET statement_timeout = 0;`):
1. `CREATE EXTENSION IF NOT EXISTS unaccent; … pg_trgm;` — ikisi de **trusted** (PG13+), süper kullanıcı gerekmez. **Canlıda ÖNCE doğrula:** `SELECT name FROM pg_available_extensions WHERE name IN ('unaccent','pg_trgm')` (Windows zip derlemesinde `share/extension` altında olmalı; yoksa deploy DURUR — yedek plan yok, contrib kurulur).
2. `tr_fold` fonksiyonu; `tr_sort` collation (DO bloğu, ICU→libc yedeği).
3. Her tablo: `ADD COLUMN "xFold" text GENERATED ALWAYS AS (public.tr_fold("x")) STORED` (+ `permission_templates_name_lower_uq` DROP).
4. GIN + UNIQUE index'ler; ad kolonlarına `ALTER … TYPE … COLLATE public.tr_sort`.
5. `schema.prisma`: alanlar `@default(dbgenerated())` + `@@index(… type: Gin)` + `@unique`; `test_db_invariants` envanteri: fonksiyon, 2 uzantı, collation, generated ifadeleri.
- Boş tablolarda toplam süre saniyeler; **dolu tabloda koşulacaksa** her `ADD COLUMN GENERATED` tam tablo yeniden yazımı + ACCESS EXCLUSIVE → vardiya dışı (perf kuralı 14).
- Prosedür: `git add` → `db execute` → `migrate resolve` → `\d+` ile DOĞRULA (CLAUDE.md kuralı; `resolve --applied` SQL'in koştuğunu kanıtlamaz).
- **Deploy sırası:** backend ÖNCE (yeni `contains` sözleşmesi eski istemciyle uyumlu — istemci ham terim gönderiyor); Electron + APK aynı pencerede tercih (istemci katlaması + sıralama). Migration'sız backend çalışmaz (`nameFold` kolonu yok → P2022) → **backend + migration ATOMİK**.
- Yedek/restore: `pg_dump` generated kolonu ifadeyle döker, `tr_fold` fonksiyonu tablodan önce gelir; `db-copy-verify` sayımları etkilenmez. `pre-restore_` yedeği rutin.
- Rollback: `DROP COLUMN xFold` + `ALTER … COLLATE "default"` — veri kaybı yok (kolonlar türetilmiş); önceki backend sürümü.

---

## 4. Bekçiler (yeni / değişen)

| Test | Doğrular | Negatif sonda |
|---|---|---|
| `test_fold_contract.ts` (yeni) | JS `foldSearchText` ≡ SQL `tr_fold` korpus üzerinde; üç kopya md5 eşit; `foldSearchTerm` jokerleri düşürür; `"ŞAHİN".toLowerCase()` girdisi bile doğru katlanır | JS'te `toLocaleLowerCase('tr')` yapınca I→ı ile düşer; bir kopya değişince md5 düşer |
| `test_turkish_search_fold.ts` (yeniden yazılır) | Gerçek DB'de "cisem/ÇİSEM/çisem/CISEM/Çisem/çİsem" (6 yazım × 6 terim = 36) birbirini bulur; "gumusoglu"→"GÜMÜŞOĞLU"; "şahin tekstil"↔"tekstil şahin"; "AKTOS2"→"AKTOŞ2" | fold kolonu yerine `name` aranınca düşer |
| `test_search_plan.ts` (yeni, bench değil) | 5k sentetik satırla `EXPLAIN` çıktısında `Bitmap Index Scan` on `*_nameFold_idx` (Seq Scan görünürse KIRMIZI); `AND`-of-tokens planı | index düşünce düşer |
| `test_master_data_name_dup.ts` (genişler) | "SAHIN" vs "ŞAHİN" 409; DB UNIQUE'i doğrudan `$executeRaw` INSERT ile de reddeder; pasif kayıt sayılır | UNIQUE kalkınca ikinci kontrol düşer |
| `test_name_sort_turkish.ts` (yeni) | `orderBy:{name:'asc'}` → `CAM, CEBECİ, ÇAM, ÇANAKKALE, … , ZONGULDAK` (Ç Z'den sonra DEĞİL, C'den sonra); İ/I sırası; kod kolonu C sırasında kalır | collation kalkınca düşer |
| `test_base_service_fold_guard.ts` (yeni) | `nameFold` `create/update` gövdesinden düşer; `sortBy=nameFold` 400; `filter[nameFold]` yok sayılır | sanitize süzgeci kalkınca düşer |
| `test_db_invariants.ts` (genişler) | `tr_fold` IMMUTABLE + gövde metni; uzantılar; `tr_sort`; her `xFold` `attgenerated='s'` ve ifadesi `tr_fold("x")` | |
| Electron/mobil unit | `search-fold.test.ts` (7→~20), `PickerModal` sıralama + A-Z indeksi tutarlı, `CommandPalette` "kursun"→"Kurşun Sırası" | |

---

## 5. Fazlar ve Sıra

| Faz | İş | Bağımlılık | Boyut |
|---|---|---|---|
| **F0 — Karar + canlı ön koşullar** | D1-D8 onayı; canlıda `pg_available_extensions` + ICU sorgusu (sunucu oturumu, salt-okunur) | — | S |
| **F1 — Sözleşme** | `search-fold.ts` (üç kopya) + `test_fold_contract.ts` + `tr_fold` fonksiyonu; **§6.2 A** (5 `toLowerCase()` iğne regresyonu — F1'in ilk commit'i, bağımsız düzeltilebilir) | F0 | S-M |
| **F2 — Migration + şema** | §3 (kolonlar, GIN, UNIQUE, collation) + `schema.prisma` + `prisma generate` + `test_db_invariants` | F1 | M |
| **F3 — Backend** | `buildTextSearch`; 39 çağrı noktası yol dönüşümü; `sanitizeWriteData/safeSortBy/safeFilters`; `assertNameNotDuplicate` indexli; kod alanları `normalizeScanCode`; §6.1 tekil düzeltmeler (#3 #5 #6 #10 #12 #14); eski varyant kodu + `test_turkish_search_fold` yeniden | F2 | L |
| **F4 — İstemci** | Electron 9 + mobil 6 tr-lower yeri katlamaya; `MultiSelectSheet`; `CommandPalette` filter; ColorPicker çift süzme; `Intl.Collator('tr')` sabiti + `numeric:true`; PickerModal sensitivity; baş harf/İ hataları; StationLoad KURSUN; 5 katlama → 1 | F1 | M |
| **F5 — Sıfırlama penceresi** | migration canlıda; backend + Electron + APK; `test_search_plan` canlı EXPLAIN | F2-F4 | S |
| **F6 (ayrı iş, kaydedildi)** | Fetch-all picker ölçeği (§6.2 D): Electron `loadAllForPicker` 500 tavanı + ~15 sessiz `pageSize:200/500`; mobil `useTruncationWarning` kapsamı | — | M-L |

Riskler: (1) Windows PG derlemesinde uzantı/ICU yokluğu → F0'da görülür, deploy durur; (2) IMMUTABLE sözü PG major yükseltmesinde (runbook notu); (3) `foldSearchTerm` jokerleri düşürdüğü için `_` içeren ad aranamaz (bilinçli, ihmal); (4) mükerrer anlamının genişlemesi (D3) — kullanıcıya açıkça söylenir.

---

## 6. Tarama Bulguları — mimarinin çözdükleri ve tekil düzeltmeler

### 6.1 Backend (Teks-Erp)
Envanter: **14** `searchFields` konfigi (`color/item/customer/station×2/defect-type/return-reason/quality-grade/fabric-property/product-recipe/peripheral/customer-branch-list/order` route'ları + `route.service.ts:28`), **8** elle `buildWhereClause` (`workorder.service:1388`, `shipping:2101`, `accounting-export:119`, `return:654`, `subcontractor-management:117,384`, `order:617`, `inventory:1038`), **17** doğrudan `buildTurkishSearch` (`inventory:1051`, `tambur:1428/1537/1637`, `order:625/773`, `shipping:1061/2308/2893`, `subcontractor:3514`, `kartela:887/1016`, `sack-search:166/168/172`, `traveler-card:670`).

| # | Bulgu | Çözüm |
|---|---|---|
| 1 | `customers.taxNumber` / `exportCode` ve `subcontractors.taxNumber` ad varyantlarıyla (32 dal) aranıyor — sayı alanına "gülşen" varyantı | Kod yoluna taşınır (D7) |
| 2 | `description/category/city/address/reason/reasonText/note/plateNumber/driverName/carrier` büyük harfe normalize EDİLMİYOR (`upperCaseFields` hiçbir route'ta kullanılmıyor, `base.service.ts:207`) → karışık yazım varyant kapsamı dışı | Fold kolonu depolama biçiminden bağımsız (D1) — çözülür |
| 3 | `order_lines.customerItemName` yalnız trim (`customer-name.helper.ts:47`), `item.name` BÜYÜK — "aktos" birini bulur birini bulmaz | Fold ile arama çözülür; yazımda `normalizeDisplayName` de uygulanır (tutarlılık) |
| 4 | Müşteri alias'ları (`customer_item_aliases.alias`, `customer_color_aliases.alias`) hiç aranmıyor, normalize edilmiyor, mükerrer koruması yok | `aliasFold` eklenir (§2.2); arama/guard sonraki iş |
| 5 | Muhasebe export araması asimetrik: `accounting-export.service.ts:204` DirectShipment'ta düz `contains`, ekran (`shipping.service.ts:2308`) tam arama → Excel ≠ ekran | Aynı `buildTextSearch` konfigi ikisinde |
| 6 | `batch-trace.report.service.ts:102` `r2.barcode = term` — `normalizeScanCode` yok (küçük harf tarama kaçırır) | Tekil düzeltme |
| 7 | `buildCodeSearch` rakam şartı (`:417`) — rakamsız terim kod yollarına hiç bakmaz; tersine `"AKTOS2"` kod hızlı yoluna girip **Türkçe katlamayı atlar** ("aktos2" → "AKTOŞ2" bulunmaz) | §2.4: kod-biçimli terim HEM kod HEM ad yollarına gider; rakam şartı kalkar |
| 8 | `TR_MAX_FOLD_POSITIONS=4` sessiz daralma | Varyant üretimi silinir |
| 9 | `permission_templates_name_lower_uq` `lower()` üzerinde — `İşçi` vs `işçi` deliği (`20260731160000`) | `nameFold` UNIQUE ile değiştirilir; `test_db_invariants` `EXPRESSION_UNIQUES` güncellenir |
| 10 | Fason vergi no guard'ı yalnız aktifleri sayar, ad guard'ı pasifleri de | Tek politika (§2.7) |
| 11 | Her çağrı `where.OR = …` atar; başka OR eklenirse arama sessizce ezilir (`inventory.service.ts:1293/1375` uyarıları) | Tek yaprak + `AND:[{OR}]` sarımı |
| 12 | `tambur.service.ts:1537` ve `:1637` bayt-bayt aynı swatch arama bloğu | Ortak yardımcı |
| 13 | `sanitizeWriteData` her scalar'ı geçirir; `sortBy`/`filter[...]` de (F30) — fold kolonu yazılabilir/sıralanabilir/sondalanabilir olurdu | §2.3 dbgenerated süzgeci |
| 14 | `db-copy-verify.service.ts:116` "kodda 34 yer" ILIKE sayımı bayat | Yeni sayım / metin |
| 15 | Prisma `contains` `%`/`_` kaçırmıyor (ölçüldü) — bugün de "%" araması tüm tabloyu döndürür | `foldSearchTerm` jokerleri düşürür; kod yolunda `normalizeScanCode` sonrası da düşürülür |
| 16 | "C-locale ILIKE katlamaz" öncülü dev'de yanlış, canlıda doğru; `test_turkish_search_fold` ILIKE'ı yanlış modelliyor | Yorumlar + test yeniden (§4) |
| 17 | Mükerrer guard'ları O(N) tam tablo (`base.service:601`, `color.service:47`, `subcontractor-management:39`, `label-template:277/601`, `item.service:79` — item'da create başına **iki kez**) | §2.7 indexli lookup |
| 18 | `code-unique.helper.ts:133` kodda `localeCompare('tr')` (kod yerel-bağımsız kuralına aykırı, yalnız 409 mesaj sırası) | Tekil (`toUpperCase` + düz karşılaştırma) |
| 19 | JS `localeCompare('tr')` (9 yer, doğru) ↔ DB `orderBy` (14 yer, en-US/C) **ayrışıyor** — aynı liste sunucuda ve istemcide farklı sıralanır | D4 |

### 6.2 İstemci (Electron + mobil)
**A. Regresyon — hemen (F1):** 5 Electron ekranı iğneyi `search.toLowerCase()` ile ön-küçültüyor (`PermissionGrid.tsx:57`, `PermissionsCatalogPage.tsx:36`, `TemplatesPage.tsx:41`, `AccessUsersPage.tsx:82`, `StationCapabilitiesPage.tsx:57`) → büyük "İ" içeren terim 0 satır. Ham terimi `foldedIncludes`'a ver; teste BÜYÜK-İ iğne ekle.

**B. Yalnız case katlayan (ç/ğ/ş/ö/ü ASCII'ye inmiyor) — F4:**
Electron: `MultiSelectCheckboxList.tsx:53-57`, `useColorPickerData.ts:45,150`, `DevicesPage.tsx:60,66`, `ProductBalancePage.tsx:63-82`, `SackContentsReadonlyTable.tsx:18,40`, `Shipments/roll-search.ts:11,29`, `detail/OrdersModal.tsx:109`, `detail/ReturnsModal.tsx:112`, `ProductionStationsPage.tsx:139,151`.
mobil: `LabelTargetSheet.tsx:105-109`, **`MultiSelectSheet.tsx:55-60`** (PickerModal'ın ikizi, atlanmış), `FasonKabulScreen.tsx:1083`, `KartelaKabulScreen.tsx:317`, `SevkiyatGecmisiScreen.tsx:83-99`, `TartiPaketScreen.tsx:182-188`.
`CommandPalette.tsx:125-190`: cmdk varsayılan `command-score` (ASCII) — `filter` prop'una katlamalı eşleşme ("kursun" → "Kurşun Sırası").

**C. Çift süzme / kapsam tuzağı:** `useColorPickerData` — katalog listesi sunucuda, "atanmış renkler" bölümü istemcide zayıf katlamayla → aynı modalde iki farklı eşleşme. `SevkiyatGecmisiScreen:50-101` (+ `FasonKabul:1083`, `KartelaKabul:317`, `TartiPaketScreen:182`): cursor'lu liste **`search` göndermeden** bellekteki sayfaları süzüyor → 4. sayfadaki kayıt "yok" görünür. Çözüm: `search` sunucuya.

**D. Ölçek (F6, ayrı iş):** Electron `loadAllForPicker` (16 dosya) 500 üstünde **hata fırlatır**; ~15 inline `pageSize:200/300/500` (Electron `FilterBar.tsx:386/602`, `PropertyChipsField.tsx:58`, `ColorsPage`, `ItemFormDialog`… ; mobil KK1/Tambur/OrderLineSheet…) **sessizce keser**; mobil `useTruncationWarning` 9 yerde var, Electron'da eşdeğeri yok. `ReferenceSelect.tsx` 50'de sessiz kesim.

**E. Sıralama:** `PickerModal.tsx:211` `sensitivity:'base'` (ç≡c) ↔ A-Z indeksi ayrı kova (`:260`); `OrdersModal.tsx:136` + `roll-search.ts:113` `numeric:true` yok (`SIP-10 < SIP-2`); hiçbir yerde `Intl.Collator` yok. Sunucu sıralı DataTable listeleri (Customers/Stations/ReturnReasons/ProductRecipes/QualityGrades/Subcontractors `columns.tsx` `field="name"`) canlıda C sırası — istemciden düzeltilemez (D4).

**F. Diğer:** `Dashboard/StationLoad.tsx:26` `toUpperCase()` + `"KURSUN"` anahtar → "Kurşun" istasyonu akış sırasında sona düşer (fold kullan); baş harf `toUpperCase()` (`Topbar.tsx:27`, `LoginScreen.tsx:67`, `operatorColor.ts:57`, `TamburScreen.tsx:4735` — `ışık`→`I` yerine `İ`); `tab-meta.ts:59` TitleCase fallback; `reportExport.ts:157` + `deviceNameMatch.ts:21` özel katlamalar → ortak fold; `ShipmentPreviewPanel.tsx:11` sunucu mesajında "mükerrer" kelimesi arıyor; mobil `RollPickerModal.tsx:191` arama kutusu `autoCapitalize="characters"`; Electron ad alanları depolanacak BÜYÜK biçimi göstermiyor (mobil `KumasScreen.tsx:193` ipucu tek istisna) — form altına "Ad sistemde BÜYÜK harfe çevrilir" ipucu ya da onBlur önizleme.

---

## 7. Kapsam Dışı (bilinçli)
- Bulanık arama (`similarity()`, yazım hatası toleransı) — trigram altyapısı hazır olur, ürün kararı ayrı.
- Tam metin arama (`tsvector`) — kısa ad/kod alanları için gereksiz.
- Geçmiş verinin dönüştürülmesi — cumartesi sıfırlanıyor (madde 6). Sıfırlama İPTAL olursa: fold kolonları GENERATED olduğu için backfill **otomatik**; UNIQUE index'ler mevcut mükerrerlerde patlar → önce `scripts/fix_duplicate_master_data.ts`.
- Depolama biçimi ayarı (D5).
