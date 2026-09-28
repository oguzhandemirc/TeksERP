# Müşteri + Kumaş + Renk Adı (kumaşa özel müşteri renk adı)

> Durum: KARARLI r3 + §12 API sözleşmesi, 2026-09-28. İki eleştiri turu uygulandı. Kritik atıflar okunarak yeniden doğrulandı. Sınıf: [ÇEKİRDEK] (çözücü, donma, tek boğaz) ve [PROFİL] (hangi carinin kumaşa özel ad kullandığı veriyle belirlenir).
> Yollar `Teks-Erp/` altına görelidir; `helpers/` = `src/services/helpers/`. `Electron/…` ve `mobil/…` monorepo köküne görelidir. Bu belgedeki "kumaş" kodda `Item`, yani `itemId`'dir.

## 1. Sorun

Bugün müşteriye özel renk adı yalnız müşteri × renk çiftine bağlanabiliyor: `CustomerColorAlias`, `@@unique([customerId, colorId])` (`prisma/schema.prisma:7620-7661`).

Sahadan örnek: A carisi X ve Y kumaşlarını alıyor ve ikisinin rengi bizde "Ekru". Müşteri X'teki Ekru'ya "ABC", Y'dekine "CBA" diyor. Bu fark ana veride tutulamıyor.

Sipariş satırındaki tek seferlik ad (`OrderLine.customerColorName`) satır `itemId` taşıdığı için doğası gereği kumaşa özeldir. Ama irsaliye bu adı kumaştan bağımsız birleştiriyor.

**Bugünkü hata (yeni tasarımdan bağımsız):** `helpers/shipment-customer-name.helper.ts:133,144-145,160-163`
- Satır adı haritası (`colorByColor`) yalnız `colorId` ile anahtarlı ve `colorName(colorId)` `itemId` almıyor (:46).
- Kumaş adında dar kademe (`itemByPair`) ile geniş kademe (`itemByItem`) bilinçli olarak ayrılmış (:31-34). Renkte YALNIZ geniş kademe var.
- Sonuç: sevkiyattaki HERHANGİ bir kumaşın satırında girilen renk adı, aynı renkteki bütün kumaşlara basılıyor. Sıra tahsisli satır önce → `createdAt` → `id` (:124-129).
  - (i) X/Ekru satırında "ABC", Y/Ekru satırında "CBA" varsa irsaliye, çeki ve Excel ikisine de "ABC" basar. Y topunun etiketi ise kendi satırından "CBA" basar (`label.service.ts:340`). Bu, `docs/kurallar/belge-etiket.md:19` [ÇEKİRDEK] ("zincir etiketle aynı") kuralının ihlalidir.
  - (ii) X/Ekru satırında "ABC" varsa ve Y'nin satır adı yoksa Y de "ABC" basar. Bu **geniş kademedir**; bugün beyansız çalışıyor.

**Sorunu büyüten ikinci mekanizma, otomatik terfi.** `order.service.ts:739-813` (`promoteCustomerAliases`) satırda girilen İLK renk adını (renk başına, kumaştan bağımsız; :760-761) genel müşteri × renk adına yazar. Bunu yalnız o müşteri × renk için hiç satır yoksa yapar (:785-793, :808-811).

**Kapsam:**
- Yalnız RENK adı ve yalnız **`SHIPMENT_DISPATCH` (irsaliye + çeki), etiket, sipariş/sevkiyat/çuval ekranları.** Kumaş adı zaten müşteri × kumaş düzeyindedir (`CustomerItemAlias`).
- Fasondan doğrudan sevk irsaliyesi müşteri renk adı basmıyor (`subcontractor.service.ts:7384-7460`, yalnız `color.name`). Fatura taslağı bizdeki adı basıyor (`helpers/shipment-auto-draft.helper.ts:212`). İkisi de kapsam dışıdır ve değişmez.

## 2. Sektör standardı

- **SAP SD, CMIR (VD51, KNMT):** anahtar satış org + kanal + müşteri + malzeme. `KDMAT`/`POSTX` sipariş satırına (VBAP) kopyalanır, teslimata (LIPS) ve faturaya (VBRP) geçer. Form değeri belgeden okur.
- **SAP Retail/Fashion:** CMIR varyant artikele (renk-beden) açılır. AFS'te grid düzeyinde J3AC/VB11 kullanılır. Kaynak topluluk içeriğidir, resmî yardım değildir.
- **D365 SCM "External item description":** müşteri kartından girilir, renk/beden boyutu taşır.
- **Business Central Item References:** ürün + **varyant** + müşteri. Satıra kopyalanır ve belgede donar.
- **Oracle EBS Customer Items:** özelden genele fallback (Adres → Adres Kategorisi → Müşteri).
- **Tekstil ERP'leri (Datatex, Canias, Nebim, BlueCherry):** alan düzeyindeki belgeleri açık değil. "Cari + artikel + renk" anahtarı bir ÇIKARIMDIR, satıcı belgesiyle doğrulanmadı.

Bizdeki karşılığı: ana veride özelden genele çözülen karşılık kaydı, belgede doğuşta donan kopya (`PrintedDocument.snapshot`, §6).

## 3. Master veri kapıları (`docs/standart/MASTER-VERI-TASARIMI.md`)

- **MV-01 · Kimlik mi, rol mü?** Yeni satır bir KİMLİK değil. Customer · Item · Color kesişimine bağlı bir **ad eşlemesidir**, kendi yaşam döngüsü yok. Yeni enum açılmıyor. Renk hâlâ tek `Color` satırıdır.
- **MV-02 · Finans kimliği:** para, fiyat ya da cari bağı yok. Uygulanmaz.
- **MV-03 · Operasyon verisi:** satır yapılandırmadır. Top, çuval, sevk ve belge bu satıra FK ile bağlanmaz. Belgeye adın kendisi gider ve snapshot'ta donar (§6).
- **MV-04 · Kod/ad tekilliği:** tekillik anahtar üçlüsündedir: `@@unique([customerId, itemId, colorId])`. Ad metninde tekillik yok, kardeşlerle aynı. **Arama:** kumaşa özel ad genel aramada BULUNMAZ. Arama bugün yalnız `customerAliases.some.alias` yolundan yapılıyor (`src/routes/color.routes.ts:20`, `src/routes/item.routes.ts:21`). Bu yüzden `aliasFold` kolonu ve indeksleri açılmaz (§4). Gerekirse ayrı dilimde eklenir.
- **MV-05 · Geriye dönüklük:** eski istemcinin ne yapacağı §7'de. `CustomerColorAlias` ve uçlarının anlamı DEĞİŞMEZ; yeni tablo yalnız ekler. Kaldırılacak türetilmiş alan yok.
- **MV-06 · Canlı referans / arşiv:** ad satırı ana verinin canlı referansı SAYILMAZ; kumaşı ya da rengi pasife almayı engellemez. Pasif kartın ad satırı kalır.
  - **Yazma kapıları kardeşle simetriktir** (`customer-alias.service.ts:255-273`): `assertCustomer` (aktif), `assertItemUsable(prisma, itemId, "DEFINITION")`, `assertColor` (aktif).
  - Sonuç: "Tükenene kadar" ya da Pasif kumaşa YENİ kumaşa özel ad eklenemez (Soru 5).

## 4. Model

### Seçenekler

**(a) `CustomerColorAlias`'a nullable `itemId` + iki partial unique. Reddedildi:**
- `assigned` münhasırlığı kumaşa bölünür (`helpers/color-assignment.helper.ts:23-66`).
- Birleştirme çakışma SQL'i NULL'u eşit saymaz (`master-data-merge.service.ts:952-993`).
- MERGE_FIELDS SQL'i kolon adlarını sabit taşır (:1044-1073).
- `deletePivot`'un `assigned:false` dalı karışır (`import-revert.branches.ts:159-176`).
- Eski panelin `(customerId, colorId)` uçları belirsizleşir.
- İçe aktarma şablonu kırılır.

**(b) Ayrı tablo `CustomerItemColorAlias`. SEÇİLEN:**
- Alanlar: `customerId`, `itemId`, `colorId`, `alias` (dördü de NOT NULL; partial unique gerekmez).
- Künye: `createdById`/`updatedById`, `createdAt`/`updatedAt` `@db.Timestamptz`, UUID'ler `@db.Uuid`.
- İndeksler: `@@unique([customerId, itemId, colorId])`, `@@index([itemId])`, `@@index([colorId])`.
- **`aliasFold` YOK.** Okuyucusu olmayan kolon olurdu. Ayrıca kardeş tablolardaki `GENERATED ALWAYS … STORED` kolon, birleştirmeyi geri almada risk taşıyor (aşağıda "Birleştirme").
- Ad, kardeşler gibi `normalizeDisplayName` ile BÜYÜK harfe çevrilerek saklanır (`customer-alias.service.ts:137-141`). Boş ad 400 döner.

Sektör haritacısının "üç düzey tek tablo" önerisi reddedildi: iki canlı tablonun göçünü ister ve NULL eşitliği sorununu çoğaltır.

### Etki listesi (hepsi D1)

**Birleştirme:**
- Üç haritaya `CONFLICT` satırı eklenir: `uniqueOn ['customerId','itemId','colorId']`, politika `SKIP` (hayatta kalan kaydın adı kazanır; `CustomerItemAlias` emsali). Yerler: `src/constants/merge-map.customer.ts:47-59`, `merge-map.item.ts:64-73`, `merge-map.color.ts:43-52`.
- **Gölgeleme uyarısı:** taşınan kumaşa özel satır, hayatta kalanın GENEL adını o kumaşta gölgeliyorsa çıktı sessizce değişir. Örnek: A2→A, A2'nin (X, Ekru)="P" satırı taşınır ve A'nın X etiketi "ABC"den "P"ye döner. Birleştirme önizlemesi bu satırları kayıt başına listeler. Gerekçe haritanın `why` alanına yazılır.
- **Kaynaklar arası çakışma:** çakışma yüklemi yalnız hayatta kalan kayda bakıyor (`master-data-merge.service.ts:958-962`). İki kaynakta aynı (kumaş, renk) varsa ikinci UPDATE P2002 verebilir. DOĞRULANMADI; `test_master_data_merge_conflicts`'e çok kaynaklı fikstür eklenir.
- **Geri alma:** yeni tabloda üretilmiş kolon olmadığı için `restoreDeletedRowsTx` / `restoreSnapshotRowsTx` (`helpers/merge-ledger.helper.ts:162-203`) jenerik çalışmalı. Bu, `test_master_data_merge_revert`'e yeni tablo fikstürüyle ÖLÇÜLÜR (birleştir → geri al).
- **Kardeş tablolarda geri alma (D6, karar 7) — ÖLÇÜLDÜ, KIRMIZIYDI, düzeltildi (§15):**
  - Kardeş iki alias tablosunun `aliasFold`'u `GENERATED ALWAYS … STORED` (`prisma/migrations/20260819140000_alias_search/migration.sql:24-25`).
  - Ledger satırları `to_jsonb(s.*)` ile yakalıyor ve `INSERT … SELECT *` ile geri yazıyordu: PG `428C9 cannot insert a non-DEFAULT value into column "aliasFold"` ile bütün geri almayı düşürdü (`test_master_data_merge_revert §9c`, düzeltmeden önce kırmızı).

**Künye:**
- `src/services/record-info.service.ts:96-97` (+ routes allowlist)
- `scripts/backfill-record-provenance.ts:44,118`
- bekçi `test_record_provenance`

**Audit:**
- Muafiyet yok; servis `AuditService.log()` yazar.
- Panel tablo etiketi `Electron/src/lib/audit-labels.ts:44` (D2).

**Hard delete:**
- `docs/kurallar/defter.md` ③b listesine model adı eklenir.
- `test_hard_delete_guard_coverage` `EXPECTED`'e YALNIZ şu ikisi yazılır:
  - `Customer <- CustomerItemColorAlias.customer : Cascade`
  - `Item <- CustomerItemColorAlias.item : Cascade`
- Renk bu taramanın dışında, çünkü kalıcı silme ucu yok (:148-155). Color FK'sı kardeşlerle simetrik olarak Cascade olur ama beyana YAZILMAZ; yazılırsa "bayat satır" kontrolü düşer.

**Scriptler:**
- `scripts/fix_duplicate_master_data.ts:61` renk referans sayımına yeni tablo eklenir. Sayılmazsa Cascade kumaşa özel adları sessizce siler.
- `scripts/reset-operational.ts:92` korunan tablolar listesine eklenir.

**İçe aktarma:** D5 (karar 6; uygulama notları §14). Mevcut iki şablonun sütunları DEĞİŞMEZ.

### Defter mi, yapılandırma mı

Yanlışlanabilir sonda: satır silindiğinde raporlanan hiçbir sayı değişmez; basılmış belgeler snapshot'ta donmuştur. ⇒ **③b saf yapılandırma pivotu.**
- `defter.md:59` "değişikliğin kendisi karar defterine yazılır" diyor. Alias pivotlarında bu karar satırı BUGÜN audit'tir (kardeşler, `customer-alias.service.ts:151-158`). Yeni tablo aynı durumu devralır.
- Bu, "audit yalnız ayak izi" kuralıyla gerilimli bir **beyanlı borçtur**: bilgi yalnız insana gösterilir, iş kararına girmez. Arşive borç notu düşülür.
- `isActive` ve `clientToken` yok: PUT idempotenttir, kardeşler de taşımıyor.

### Eşzamanlılık

- **Yazma:** tek `upsert`, P2002 → 409 "tekrar deneyin". Audit'in `oldData`'sı için önceden yapılan `findUnique` en iyi çabadır ve bayat olabilir; audit ayak izidir, karar girdisi değildir.
- **Silme:** `delete({ where: { customerId_itemId_colorId } })`, P2025 → 404. Atomik çalışır ve silinen satırı döndürür; audit bu satırdan yazılır. Kardeşteki `findUnique→if→delete` deseni (`customer-alias.service.ts:171-199`) emsal ALINMAZ.
- Advisory kilit gerekmez.

### Migration

- `migrate dev --create-only` oturumun kendi `tekserp_<oturum>_test` DB'sine karşı ve açık `DATABASE_URL` ile koşulur; ana ağacın `.env`i (`tekserp_fabrika_0923`) ASLA kullanılmaz. `DropForeignKey` satırları silinir.
- Migration yalnız ekler; üretilmiş kolon olmadığı için elle SQL gerekmez.

## 5. Tek çözücü

### Zincir

"Mevcut veri aynen çalışır" şartı sipariş satırı adının ana verinin üstünde kalmasını zorunlu kılar. "Kumaşa özel ad girilmedikçe çıktı değişmez" şartı da bugünkü geniş kademenin korunmasını zorunlu kılar.

**İrsaliye / çeki / Excel / sevkiyat ekranı** (sevkiyat kapsamında satır kümesi var):
1. sipariş satırı adı, **aynı kumaş + renk** (yeni dar kademe; sıra bugünküyle aynı)
2. **kumaşa özel** (müşteri + kumaş + renk)
3. sipariş satırı adı, **aynı renk, başka kumaş** (bugünkü geniş kademe, artık beyanlı)
4. **genel** (`CustomerColorAlias`)
5. bizdeki ad; ayrık kipte hücre boş kalır (`shipping.service.ts:5683-5687`)

**Etiket, önizleme, açık sipariş, sipariş detayı** (tek satır bağlamı): hedef satırın adı → kumaşa özel → genel → bizdeki.

**Çuval içeriği ve dökümü** (`musteriAdiCozucu`, sipariş satırı adını bugün okumuyor; mevcut borç, DEĞİŞMEZ): kumaşa özel → genel → null.

Kumaşa özel satır yokken 5 kademe bugünkü 3 kademeyle (satır adı-herhangi → genel → bizdeki) **tek bir durum dışında** aynı çıktıyı verir. O durum: aynı sevkte aynı renkte iki kumaşın satırında FARKLI ad var (§1-i). Bu durumda 1. kademe o kumaşın kendi satır adını seçer ve irsaliye etiketle hizalanır. Karar Soru 3'te.

Kalite politikası (`namePolicy.skips`, `shipping.service.ts:5641`) adı çözmeden düşürmeye devam eder.

### Modül (`helpers/customer-name.helper.ts`, tek modül)

```ts
export type ColorNameScope = 'ITEM' | 'CUSTOMER';
export interface CustomerColorIndex {
  /** Ana veri kademesi: kumaşa özel → genel; ikisi de yoksa null. */
  master(customerId: string, itemId: string, colorId: string | null):
    { alias: string; scope: ColorNameScope } | null;
}
/** Çok müşterili, N+1'siz: iki findMany (customerId IN · itemId IN · colorId IN). */
export async function loadCustomerColorIndex(
  db: PrismaClient | Tx,
  keys: { customerIds: string[]; itemIds: string[]; colorIds: string[] },
): Promise<CustomerColorIndex>;
/** Saf: irsaliye kademe sırası (1–4); DB'siz, birim testli. */
export function pickShipmentColorName(a: {
  pairOverride: string | null; wideOverride: string | null;
  master: { alias: string; scope: ColorNameScope } | null;
}): { ad: string | null; scope: ColorNameScope | null };
```

- Tek-satır yüzeyleri mevcut `resolveName(override, master?.alias, bizdeki)` fonksiyonunu kullanır (:30-42). `NameSource` birliği (`OVERRIDE | MASTER | DEFAULT`, :20) DEĞİŞMEZ. Kademe bilgisi yalnız isteğe bağlı `colorNameScope: 'ITEM' | 'CUSTOMER' | null` alanıyla taşınır. İkinci bir kaynak birliği açılmaz.
- `batchLoadAliases` / `batchLoadAliasesMulti` indeksin ince sarmalayıcısı olur.
- Tx içinde `Promise.all` yok. Tx dışındaki `Promise.all` (`helpers/sack-content-mismatch.helper.ts:161`) korunabilir.

### Yeni AST bekçisi `test_musteri_adi_tek_cozucu`

- **Kapsam:** `src/`.
- **Üç kanal taranır:**
  1. model delegesi okuması: `customerColorAlias.*` ve `customerItemColorAlias.*` (`find*`, `count`)
  2. `include`/`select`/`where` içinde ilişki alan adları: Customer ve Color tarafındaki alias ilişkileri (`schema.prisma:3444`, :7335) ve yeni ilişkiler
  3. dizge içinde tablo adı: `customer_color_aliases`, `customer_item_color_aliases`
- **Beyan anahtarı dosya + FONKSİYON adıdır, satır numarası DEĞİL.** Ad-DIŞI okuyucu sınıfları:
  - `assigned` münhasırlığı: `color-assignment.helper`
  - renk formu: `color.service`
  - CRUD fonksiyonları: `customer-alias.service` (`lookupAlias` HARİÇ; o indekse geçer)
  - dışa aktarım: import adapter
  - terfi varlık kontrolü: `order.service#promoteCustomerAliases`
  - birleştirme haritaları (tablo adı)
  - arama alanı `customerAliases.some.alias` (ad seçmez)
- **İki yönlüdür:** beyansız okuma kırmızı verir, ölü beyan kırmızı verir.
- **Sondalar:**
  - negatif: `label.service`'e doğrudan `customerColorAlias.findUnique` geri eklenir → kırmızı
  - negatif: `sack-content-mismatch.helper` kendi `findMany`'sine döndürülür → kırmızı
  - pozitif: beyanlı bir okuyucu kaldırılır → ölü beyan kırmızısı

### Çağrı noktaları (hepsi D1; hepsinde `itemId` elde)

| # | Yer | Değişiklik |
|---|---|---|
| 1 | `helpers/shipment-customer-name.helper.ts:44-46,133,144-145,160-163` | `colorName(itemId, colorId)`. Satır adı iki haritada tutulur: `itemId\|colorId` (dar) ve `colorId` (geniş). Seçimi `pickShipmentColorName` yapar. Başlığa "renkte geniş kademe neden 3. sırada" cümlesi eklenir. |
| 2 | `shipping.service.ts:5672,:5722` (`collectShipmentDocContent`) | çağrı imzası |
| 3 | `shipping.service.ts:4833-4863` (`getShipmentById`) | indeks + `colorNameScope` |
| 4 | `shipping.service.ts:5419-5443` (`listOpenOrdersWithCoverage`) | indeks |
| 5 | `label.service.ts:364-394` (`getRollLabel`; `:386` findUnique) | kopya sorgu kalkar |
| 6 | `label.service.ts:1340-1345` (toplu etiket) | müşteri başına döngü yerine TEK çok müşterili yükleme; `test_bulk_label_batched` bayt eşitliği |
| 7 | `label.service.ts:557-572` (`previewCustomerNames`, `:566` findUnique) | kopya sorgu kalkar; `colorNameScope` eklenir |
| 8 | `sack-search.service.ts:562-576` (`musteriAdiCozucu`; `:1096`, `:1323-1326`) | kumaşa özel kademe. Çuval başına await edilen döngü (bugün çuval başına 2 sorgu) çuvalların müşteri kümesiyle TEK yüklemeye iner. |
| 9 | `helpers/sack-content-mismatch.helper.ts:161-205,262-268` | kendi `findMany`'si kalkar, indeks kullanılır. `identityFor` renk adını `(customerId, itemId, colorId)` ile çözer. |
| 10 | `customer-alias.service.ts:220-245` (`lookupAlias` → `/aliases/suggest`) | `colorAlias` alanında önce kumaşa özel ad denenir; sözleşme aynı kalır |
| 11 | `order.service.ts:739-813` (terfi, yazar) | aynı müşteri + kumaş + renk için kumaşa özel satır varsa genel ada terfi YAPILMAZ (Soru 2) |
| 12 | sipariş detay ucu (order getById; satır D1'de tespit edilir) | satıra `resolvedCustomerColorName` + `colorNameScope` eklenir. **İzin:** çağıranda `customer-alias:read` yoksa alan yalnız satır adını taşır, ana veri kademesini TAŞIMAZ. Bu, `Electron/src/pages/Operations/Orders/OrderDetailSheet.tsx:124-128`'deki bugünkü davranışı korur. |
| — | ad çözmeyenler, DOKUNULMAZ: `label.service.ts:1470-1472` (kartela, müşterisiz `resolveName(null,null,…)`) · `helpers/shipment-auto-draft.helper.ts:320`, `helpers/order-status.helper.ts:264` (yalnız `customerItemName`) · yalnız satır adı okuyanlar `order.service.ts:1402,1499`, `return.service.ts:208-209` | bekçi beyanında "ad çözmez" / "yalnız satır adı" |

## 6. Donma

**İrsaliye/çeki:**
- Ad `PrintedDocument.snapshot`'a donar. Sevk anında `performDispatchTx` bunu yapar (`shipping.service.ts:3604`: `products[].customerName/customerColorOnly`, `cekiRows[].customerVaryant`).
- PDF ve belge Excel'i aynı snapshot'tan ve aynı `renderShipmentDispatchTables`'dan türer (`printed-document.service.ts:715-731`).
- Muhasebe Excel'i (`Electron/src/pages/Operations/AccountingDispatch/accounting-export.ts:230-243,280-292`) ayrı kurulmuş bir kolon listesidir. Kendi `customerNameOr` ve rejim/ayrık kip mantığı var, ama değeri snapshot'tan okur ve **kademe seçmez**. Zincir bu yüzden güvenli.

**Rejim ayarları** (`docItemNameMode`, `docCekiNameMode`, `docProductColorSplit`) etkilenmez.

**Yeni kademe yalnız snapshot KURULURKEN çalışır.** Mevcut sözleşme "yeniden basım = bugünkü doğruyu yeniden dondur" (`shipping.service.ts:5625-5629`). Snapshot dört yolla kurulur:
1. yeni sevk
2. reissue
3. sevk sonrası sipariş kümesi değişimi (`:3036`)
4. lazy-init ve `getDispatchReport` canlı yedeği (`:5205-5207`)

Sürüm notunda söylenir.

**CANLI yüzeyler (beyan):**
- `getShipmentById` ve çuval içeriği/dökümü canlı çözer. Döküm Excel'i: `Electron/…/sackDump/dumpModel.ts:74`.
- Sevk edilmiş sevkiyatta ekran yeni adı, donmuş irsaliye eski adı gösterir. Genel ad değiştiğinde bugün de böyledir; kumaşa özel giriş bunu yaygınlaştırır. Bu dilimde değiştirilmez.

**Etiket:**
- `Roll.lastLabelSnapshot` yalnız kanıttır; yeniden basım canlı çözer. Ad değişikliği `labelDirty` işaretlemez (bugün de işaretlemiyor).
- **Uyuşmazlık sinyali bu farkı GÖSTERMEZ.** `sack-content-mismatch` aynı müşteriye basılmış topu hiç değerlendirmez (:294) ve iki CANLI kimliği karşılaştırır, etiket snapshot'ını değil (:280-286).
- Bugün farkı gösteren tek yer çuval içeriğinin "etikette yazan" sütunudur (`sack-search.service.ts:1087-1110`). "Etiket adı ≠ bugünkü ad" sinyali bu tasarımın kapsamında değildir.

### Ölçü: "kumaşa özel ad girilmedikçe hiçbir çıktı değişmez"

- `test_sevk_belge_altin` DB'siz ve yalnız renderer'ı ölçüyor (:2, :44-46). `test_shipment_doc_customer_name §1` yalnız "bizdeki" rejimini ölçüyor (:178-213). İkisi de çözücüyü KOŞMAZ, bu yüzden vaadin ölçüsü olamaz. Renderer bekçisi olarak kalırlar.
- **Yeni DB'li altın sondası:** `test_shipment_doc_customer_name §0`, oturumun `_test` DB'sinde.
  - Fikstür: genel ad + satır adı + aynı renkte üç kumaş (X satır adı "ABC"; Y satır adsız; Z'nin sevkte satırı yok). Kumaşa özel satır YOK.
  - Yakalananlar:
    - `collectShipmentDocContent` / donma snapshot JSON'u
    - `getRollLabel`
    - `previewCustomerNames`
    - `getShipmentById`
    - açık sipariş kapsaması
    - çuval içeriği + döküm
    - uyuşmazlık sinyalleri
    - `/aliases/suggest`
  - Altın, D1'in İLK commit'inde **bugünkü kodla** yazılır. D1 sonunda bayt eşitliği şarttır. Tek istisna Soru 3'e bağlı §1-i fikstürüdür ve ayrı bölümde ölçülür.
  - Negatif sondalar: indeks genel adı yutarsa → altın kırmızı; geniş kademe düşürülürse → Y/Z satırı kırmızı.
- **§11 üçlü:**
  - Kumaşa özel ad eklenince etiket = önizleme = irsaliye = çeki = belge Excel'i aynı adı verir.
  - Donmuş belge aynı kalır, reissue yeni adı alır (`test_shipment_doc_freeze_timing §3`).
  - Negatif sonda: indeks kumaşa özeli atlarsa → kırmızı.
- **§12 (#1-i):** düzeltmeden önce KIRMIZI, sonra yeşil (ısırık ölçümü).
- `test_sevk_belge_excel_esit`'in muhasebe Excel yolunu ölçtüğü DOĞRULANMADI. D1'de okunur; ölçmüyorsa kapsam notu yazılır.

## 7. Eski istemci (panel 1.3.3 · tablet 1.0.8)

Sözleşme yalnız EKLER:
- yeni tablo
- `GET/PUT/DELETE /api/customers/:id/item-color-aliases[/:itemId/:colorId]` ve `GET /api/items/:itemId/customer-color-aliases` (izin `customer-alias:read|write`, yeni izin kodu yok)
- yanıtlarda isteğe bağlı `colorNameScope` ve `resolvedCustomerColorName` (tam liste §12.4)

Enum, alan adı ve zorunlu parametre değişmez. İstemcilerde `.strict()` yanıt ayrıştırması yok ⇒ **minVersion gerekmez.**

**Tablet 1.0.8, SIZINTI riski:**
- `mobil/src/screens/Modules/Tambur/LabelNamePreview.tsx:83` düzenleme alanını çözülmüş adla doldurur; bu ad kumaşa özel ad olabilir.
- :111-112'de "kalıcı" kaydet, renk alanı doluysa `setCustomerColorAlias(customerId, colorId, …)` çağrısını KOŞULSUZ yapar. Operatör yalnız kumaş adını düzeltse bile renk yazılır.
- Sonuç: X'in "ABC"si GENEL ada yazılır ve kumaşa özel adı olmayan bütün kumaşlarda sessizce çıktı olur.
- Eski tablet `warnings` okumadığı ve PUT hangi kumaşa bakıldığını bilmediği için backend uyarısı çözüm DEĞİLDİR.
- **Kapı:** D4 bütün aktif tabletlere ulaşana kadar kumaşa özel ad girilemez, dolayısıyla eski tablette sızdırılacak kumaşa özel ad oluşmaz. Dağılım `Session.clientVersion`'dan ölçülür (`schema.prisma:666`; gözlemdir, sunucu kapısı değil — kaldırma kararını İNSAN verir). Sürüm notunda yazılır.
- **Kapının iki giriş yolu var ve ikisi de kapalı doğar:**
  - **D2** (panel giriş ekranı): üretim kanalına (adnansahin) ancak D4 yayılımı ölçüldükten sonra TERFİ eder (yayın kapısı).
  - **D5** (içe aktarma şablonu): backend ile gelir ve panel şablon listesini `/api/import/entities`ten dinamik okuduğu için ESKİ panelde (1.3.3) de görünürdü. Bu yüzden adaptör `releaseGate` taşır: şablon listede görünmez, HTTP uçları 403 `IMPORT_ENTITY_GATED` döner (`import-registry#getImportAdapterForRequest`, tek boğaz; `test_import_framework §14`). Kapı, D4 yayılımı ölçülünce ayrı bir commit'le `releaseGate` alanı silinerek (ve §14'ün ilk kontrolü güncellenerek) kalkar; o commit'in backend yayını D2 terfisiyle aynı pencerededir.
  - PUT/DELETE uçları (§12.2) istemcisiz bir giriş değildir: 1.3.3 paneli ve 1.0.8 tableti onları çağırmaz.

**Tablet ekranları:** tablet adı kendisi çözmüyor (`LabelNamePreview.tsx:13-17`, `TartiPaketScreen.tsx:233-234`). Etiket, önizleme, sevkiyat ve paketleme yeni adı kod değişmeden gösterir.

**Panel 1.3.3:**
- Etiket, irsaliye, sevkiyat ekranı ve öneri formu doğru adı gösterir.
- `OrderLineAliasFields` öneriyi yalnız placeholder olarak gösterir (:94,:107).
- Sipariş detayı (`OrderDetailSheet.tsx:123-155`) adı istemcide çözer. Güncellenmemiş PC'de kumaşa özel adı olan satırda GENEL adı gösterir; panel güncellenene kadar böyle kalır.

**Sıra:** backend (D5 şablonu kapalı) → panel ve tablet (önce testfabrika, sonra adnansahin) → D4'ün yayıldığı ölçülür → D2 üretime terfi eder + D5 kapısı kalkar (backend commit'i) → saha verisi girilir.

## 8. Bayrak

**Gerekmez.** Yeni davranışı veri tetikler: kumaşa özel satır yoksa 2. kademe boş kalır ve zincir bugünkünün aynısıdır. "Varsayılan = bugünkü davranış" cümlesinin ölçüsü §6'daki **DB'li altın sondasıdır**, `test_sevk_belge_altin` değildir. Bayrak ikinci bir sessiz kapı ve "dört kapı" reçetesi doğurur, karşılığında bir şey kazandırmaz.

**Tek istisna §1-i'dir** (aynı sevk + aynı renk + iki kumaşta FARKLI satır adı). 1. kademe irsaliyeyi etiketle hizalar; ihlal edilen [ÇEKİRDEK] kuralı onarır. §1-ii'deki geniş kademe 3. sırada korunur, yani satır adı olmayan kumaşın çıktısı değişmez. Karar Soru 3'te.

## 9. Dilimler

| Dilim | İçerik | Bağımlılık | Bekçiler | Paralel |
|---|---|---|---|---|
| **D1 backend** | İLK commit: §6 DB'li altın (bugünkü kod). Sonra: migration (ekleyen, `--create-only`, `_test` DB) · `schema.prisma` · `customer-name.helper.ts` (indeks + `pickShipmentColorName`) · §5 #1–#12 · yeni servis/route/controller (Zod, `normalizeDisplayName`, üç yazma kapısı, `delete`+P2025) · merge-map ×3 (+ gölgeleme önizlemesi) · `record-info` · `backfill-record-provenance` · `fix_duplicate_master_data` · `reset-operational` · `defter.md` ③b + borç notu · `belge-etiket.md:19` kural satırı + arşiv notu | — (İLK) | schema_drift · db_invariants · timestamptz_contract · migration_hygiene · merge_fk_coverage · merge_conflicts (+çok kaynak) · merge_revert (+yeni tablo) · hard_delete_guard_coverage · audit_muafiyeti · record_provenance · name_normalization · shipment_doc_customer_name (§0 altın, §11, §12) · shipment_doc_freeze_timing · sevk_belge_altin · sevk_belge_excel_esit · bulk_label_batched · sack_contents_uc_ad · sack_mismatch (+kumaş farkı) · order_alias_promote (+kumaşa özel varken genele terfi yok) · quality_skip_customer_name · test_helpers · **yeni** test_musteri_adi_tek_cozucu (3 sonda) · tam paket | — |
| **D2 panel** | Kumaş kartında yeni `Items/ItemCustomerColorAliasesPanel.tsx` (karar 1, §12.5) · `CustomerColorAliasesPanel.tsx`: isteğe bağlı "Kumaş" ayağı; seçim ItemPickerModal → ColorPickerModal(customerId, allowedColorIds). Listede "yalnız X kumaşında" alt satırları; silme onayında zincir anlatılır. · `aliasService.ts` · `OrderDetailSheet.tsx` backend alanını okur (alan yoksa eski mantık) · `audit-labels.ts:44` · **ZORUNLU:** birleştirme önizlemesi `MergePreview.shadowing` tablosunu kayıt başına çizer (§15) | D1 sözleşmesi donduktan sonra; **üretime terfi D4'ün yayılmasından sonra** | vitest (`OrderDetailSheet`'te `colorAliasMap` kalmamalı) · tsc/eslint | D4 ile paralel |
| **D4 tablet (OTA)** | `LabelNamePreview.tsx:94-114`: "kalıcı" düzeltme o anda KAZANAN kademeyi günceller (`colorNameScope='ITEM'` → kumaşa özel PUT, aksi hâlde genel). Yalnız DEĞİŞEN alan yazılır. Yeni kumaşa özel ad yaratmak yalnız panelden. · `mobil/src/services/label.service.ts` yeni PUT · `colorNameScope` rozeti (bilinmeyen değer = müşteri adı) | D1 | jest · test_mobil_enum_aynasi | D2 ile paralel |
| **D3 uçtan uca** | Ek kod YOK. Gerçek panel (d9) ve gerçek tablet (d5), ekran görüntüsü + DB okuması. Beklenti: etiket = önizleme = irsaliye PDF = belge Excel'i = muhasebe Excel'i. Çuval içeriği yalnız ana veri kademesiyle ölçülür (satır adı okumaz). Sevk edilmiş sevkiyatın ekranı canlıdır (§6 beyanı). §10'daki bilinen sınırlar kırmızı sayılmaz. | D1 + D2 + D4 | e2e | — |
| **D5 içe aktarma (sonra)** | `customer-alias.adapter.ts` 3. adaptör, anahtar `CARİ\|ÜRÜN\|RENK` (`parseAliasKey` genelleşir) · `import-registry.ts` · `import-revert.service.ts` DELETE_PIVOT. Geri almada claim'e `alias` değeri de girer (`defter.md:60`; bugünkü `deletePivot` koymuyor, `import-revert.branches.ts:159-176`). | D1 | test_import_framework · test_import_permissions · test_import_revert (sabit 17→18, pivot 2→3; bugün alias geri yazımı DB fikstürüyle koşulmuyor, :19,:309 → DB fikstürü eklenir) + çapraz defter sıralı fikstürü (içe aktar → birleştir/SKIP → içe aktarmayı geri al → birleştirmeyi geri al) | bağımsız |

## 10. Bilinen sınırlar (bu dilimde değişmez, beyanlı)

- **Etiket:** override'ı hedef sipariş satırından alıyor ve satırın kumaşının topla eşleşip eşleşmediğine bakmıyor (`label.service.ts:318-341`).
  - Y topu X satırının bağlamıyla basılırsa etiket X'in adını gösterir.
  - Top L1 satırıyla etiketlenip L2'ye tahsis edildiyse (aynı kumaş + renk, farklı satır adı) etiket ile irsaliye ayrışır (`shipment-customer-name.helper.ts:124-129`).
- **Önizleme:** `previewCustomerNames` kalite politikasını uygulamıyor (`label.service.ts:500-590`; politika yalnız :402'de). Mevcut borç.
- **Çuval içeriği:** çözücü satır adını okumuyor (`sack-search.service.ts:562-576`). Mevcut borç.
- **Arama:** kumaşa özel ad genel aramada bulunmaz (§3 MV-04).
- **Sevkiyat ekranı:** sevk edilmiş sevkiyatta ekran/çuval dökümü canlı, irsaliye donmuştur (§6).

## 11. Kararlar (1e, 2026-09-28 — kullanıcı soru turunu atlatıp karar yetkisini devretti; ölçüt: sektör standardı, kalıcı çözüm, kapsam daraltılmaz)

Her karar dört ölçütle (sektör · profesyonel mi · yıkıcı mı · geriye uyumlu mu) verildi.

1. **Giriş noktası: cari kartı VE kumaş (ürün) kartı.** Cari kartındaki "Müşterideki Renk Adları" sekmesine isteğe bağlı "Kumaş" seçimi; kumaş kartına "Müşteri Renk Adları" sekmesi (o kumaş için bütün müşterilerin kumaşa özel adları). İki ekran AYNI uçlara yazar, ayrı yazma yolu yok. Sektör: D365 "External item description" müşteri kartından, Business Central "Item References" ürün kartından girilir; ikisi de aynı kayda iner. Yıkıcı değil, yalnız ekler.
2. **Terfi:** bugünkü gibi (yalnız o müşteri × renk için hiç kayıt yoksa genel ada); o müşteri + kumaş + renk için kumaşa özel ad varsa genele terfi YAPILMAZ; kumaşa özel ad yalnız elle (panel iki ekran + içe aktarma) girilir. Sektör: SAP CMIR elle bakılan ana veridir, belge ana veriyi yazmaz; otomatik terfi mevcut kolaylık olarak korunur.
3. **Aynı sevk + aynı renk + iki kumaşta FARKLI satır adı (§1-i): (a)** — her kumaş kendi satır adını alır, irsaliye etiketle hizalanır; satır adı olmayan kumaş bugünkü geniş kademeyi korur. [ÇEKİRDEK] "zincir etiketle aynı" ihlalini onarır; kumaşa özel ad girilmeden değişen TEK çıktıdır, sürüm notunda yazılır.
4. **"Bu kumaşta müşteri renk adı basma" seçeneği:** bu turda yok (istenmedi); saha isterse ekleyen alanla gelir.
5. **"Tükenene kadar"/Pasif kumaşa yeni kumaşa özel ad:** hayır — kardeş `CustomerItemAlias` kapısıyla simetrik (`assertItemUsable … "DEFINITION"`).
6. **İçe aktarma (D5) BU TURDA** yapılır (kapsam daraltılmaz): üçüncü adaptör, anahtar `CARİ|ÜRÜN|RENK`, geri alma claim'i `alias` değerini de taşır.
7. **Kardeş alias tablolarında birleştirmeyi geri alma (GENERATED `aliasFold`) şüphesi** bu turda SONDAYLA ölçülür (D6); kırmızıysa aynı turda düzeltilir, çünkü yeni tablo aynı birleştirme defterinden geçer.
8. **③b "karar defteri = audit" gerilimi:** kardeşlerle aynı beyanlı borç olarak kalır (arşive borç notu); ayrı karar tablosu açılmaz — üç alias tablosu için tek seferde çözülmesi gereken ayrı iş.


## 12. API sözleşmesi (D1 dondurur; D2, D4, D5 buna yazar)

Kardeş uçlar `src/routes/customer-alias.routes.ts` + `src/controllers/customer-alias.controller.ts` + `src/services/customer-alias.service.ts` birebir aynalanır: aynı zarf (`{ success, data }`), aynı Zod gövdesi, aynı izinler, aynı yazma kapıları. Yeni izin kodu, yeni modül kapısı, yeni bayrak YOK. Yeni tablo `BaseController`'a BAĞLANMAZ; tek yazma yolu aşağıdaki PUT/DELETE'tir (skaler kolon yazılabilirliği sorusu bu yüzden doğmaz).

### 12.1 Ortak tipler (backend `src/types/customer-alias.types.ts` ya da servis dosyası; istemciler aynalar)

```ts
/** Ana veri kademesinin hangi tablodan geldiği. `NameSource` (OVERRIDE|MASTER|DEFAULT) DEĞİŞMEZ. */
export type ColorNameScope = 'ITEM' | 'CUSTOMER';

/** Satır — Prisma `CustomerItemColorAlias` skalerleri (kardeşler gibi tam satır döner). */
export interface CustomerItemColorAliasRow {
  id: string;            // uuid
  customerId: string;    // uuid
  itemId: string;        // uuid
  colorId: string;       // uuid
  alias: string;         // normalizeDisplayName ile BÜYÜK; boş olamaz (NOT NULL)
  createdAt: string;     // ISO, timestamptz
  updatedAt: string;
  createdById: string | null;
  updatedById: string | null;
}

export interface ItemSummary     { id: string; code: string; name: string; lifecycleStatus: 'ACTIVE' | 'PHASE_OUT' | 'ARCHIVED' }
export interface ColorSummary    { id: string; code: string; name: string; hex: string | null; isActive: boolean } // kardeş listColorAliases ile aynı select
export interface CustomerSummary { id: string; code: string; name: string; isActive: boolean }
```

Kardeşten iki fark, ikisi de bilinçli: `alias` NOT NULL (yeni tabloda `assigned` yok, satır yalnız ad taşır) ve `aliasFold` YOK (§4).

### 12.2 Uçlar

| # | Yöntem · yol | İzin (`verifyToken` + ) | Gövde / sorgu | 200 yanıtı |
|---|---|---|---|---|
| A | `GET /api/customers/:customerId/item-color-aliases` | `requirePermission("customer-alias:read")` | — | `ApiResponse<(CustomerItemColorAliasRow & { item: ItemSummary; color: ColorSummary })[]>` |
| B | `GET /api/items/:itemId/customer-color-aliases` | `requirePermission("customer-alias:read")` | — | `ApiResponse<(CustomerItemColorAliasRow & { customer: CustomerSummary; color: ColorSummary })[]>` |
| C | `PUT /api/customers/:customerId/item-color-aliases/:itemId/:colorId` | `requirePermission("customer-alias:write")` | `{ alias: string }` | `ApiResponse<CustomerItemColorAliasRow>` |
| D | `DELETE /api/customers/:customerId/item-color-aliases/:itemId/:colorId` | `requirePermission("customer-alias:write")` | — | `ApiResponse<{ deleted: true }>` |

- **A, C, D** `customer-alias.routes.ts`'e eklenir (mount `/api/customers/:customerId`, `mergeParams`; `customer.routes.ts:76` değişmez). Controller: `listItemColorAliases`, `upsertItemColorAlias`, `deleteItemColorAlias`.
- **B** `item.routes.ts`'e eklenir: `router.get("/:id/customer-color-aliases", verifyToken, requirePermission("customer-alias:read"), aliasController.listItemColorAliasesByItem)` (dosyadaki kardeşler `:id` adını kullanır; yayımlanan yol aynıdır). Karar 1'in "kumaş kartı" girişi budur; yazma yine C/D'den geçer, ikinci yazma yolu YOK.
- **Sıralama** (A ve B): `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]` (kardeş `createdAt desc` + eşitlik bozucu). Gruplama (kumaşa göre A, müşteriye göre B) istemcidedir.
- **Sayfalama yok** (kardeşlerde de yok; satır sayısı müşteri × kumaş × renk ile sınırlı yapılandırma).
- **Swagger** `@openapi` bloğu her uca yazılır (`RECETELER.md` § route adım 14).
- **Ekran kataloğu:** `src/constants/screen-catalog.ts:185` `definitions/items` satırının `capabilities`'ine `"customer-alias:read"`, `"customer-alias:write"` eklenir (ekran artık bu izinleri kullanıyor; `test_screen_catalog` ölçer).

**Servis imzaları** (`CustomerAliasService`, aktör son parametre):

```ts
listItemColorAliases(customerId: string): Promise<ApiResponse<(CustomerItemColorAliasRow & { item: ItemSummary; color: ColorSummary })[]>>;
listItemColorAliasesByItem(itemId: string): Promise<ApiResponse<(CustomerItemColorAliasRow & { customer: CustomerSummary; color: ColorSummary })[]>>;
upsertItemColorAlias(customerId: string, itemId: string, colorId: string, alias: string, userId?: string): Promise<ApiResponse<CustomerItemColorAliasRow>>;
deleteItemColorAlias(customerId: string, itemId: string, colorId: string, userId?: string): Promise<ApiResponse<{ deleted: true }>>;
```

**Doğrulama sırası.** Kapı sırası kardeşle aynıdır; hata veren ilk kapı döner.

- **A:** `assertCustomer(customerId)`. Kardeş listeler gibi pasif müşteride 400 döner.
- **B:** yalnız varlık kontrolü, `item.findUnique` → yoksa 404. Pasif ya da "Tükenene kadar" kumaşın satırları LİSTELENİR; yeni satır eklenemez ama mevcut satırlar okunur ve silinir.
- **C:**
  1. Üç yol parametresi `assertValidUuid`'den geçer. Kardeş bunu yapmıyor; yeni uçta açıkça 400 döner.
  2. Zod `aliasSchema` (kardeşle aynı şema; `min(1)`, `max(200)`).
  3. `assertCustomer`
  4. `assertItemUsable(prisma, itemId, "DEFINITION")`
  5. `assertColor`
  6. `normalizeDisplayName(alias)`; sonuç boşsa 400.
  7. `upsert` (`where: { customerId_itemId_colorId }`).
  8. `AuditService.log` (tx dışında, best-effort).
- **D:**
  1. `assertValidUuid` ×3.
  2. `prisma.customerItemColorAlias.delete({ where: { customerId_itemId_colorId } })`. Silinen satır audit'e yazılır.
  - Müşteri, kumaş ve renk kapısı YOK. Pasif karttaki adı temizlemek serbesttir (kardeş `deleteItemAlias` de kapı koymuyor).
- Backend renk ↔ kumaş izin listesini (`allowedColors`) DENETLEMEZ. Renk bir kısıt değil reçetedir (`docs/kurallar/rota-renk.md`); süzme istemcide `ColorPickerModal allowedColorIds` ile yapılır. Kardeş `upsertColorAlias` de denetlemiyor.

**Audit:** `tableName: "CUSTOMER_ITEM_COLOR_ALIAS"`.
- C: `action: existing ? "UPDATE" : "CREATE"`, `oldData: existing ? { alias } : null`, `newData: { customerId, itemId, colorId, alias }`. `existing`, upsert'ten önce en iyi çabayla okunur (§4 Eşzamanlılık).
- D: `action: "DELETE"`, `oldData: { customerId, itemId, colorId, alias }`. Bu değer `delete`'in döndürdüğü satırdan alınır.
- Panel etiketi: `Electron/src/lib/audit-labels.ts`'e `CUSTOMER_ITEM_COLOR_ALIAS: "Müşteri Kumaşa Özel Renk Adı"` (D2).

### 12.3 Hatalar (`details.code` altında; `body.code` okunmaz)

| HTTP | Durum | `message` (TR) | `details.code` |
|---|---|---|---|
| 400 | Zod (gövde yok / `alias` boş / > 200) | `"Validasyon hatası"` + `errors: [{ field: "alias", message: "Alias boş olamaz" \| "Alias 200 karakteri aşamaz" }]` | — (Zod dalı `details` taşımaz; kardeşle aynı) |
| 400 | `normalizeDisplayName` sonrası boş | `"Alias boş olamaz"` | — (kardeşle aynı) |
| 400 | yol parametresi UUID değil | `"Geçersiz UUID formatı: '<param>' parametresi ('…')"` | — (`assertValidUuid`) |
| 404 | müşteri yok (A, C) | `"Müşteri bulunamadı"` | — |
| 400 | müşteri pasif (A, C) | `"Müşteri pasif durumda"` | — |
| 404 | kumaş yok (B) | `"Ürün bulunamadı"` | — |
| 400 | kumaş yok (C, `assertItemUsable`) | `"Kalem bulunamadı."` | `ITEM_NOT_FOUND` |
| 409 | kumaş birleştirilmiş (C) | `"\"X\" kartı \"Y\" ile birleştirildi. …"` | `ITEM_MERGED` (+ `survivorName`) |
| 409 | kumaş Pasif (C) | `"\"X\" kumaş pasif durumda — …"` | `ITEM_INACTIVE` |
| 409 | kumaş "Tükenene kadar" (C; karar 5) | `"\"X\" kumaş 'Tükenene kadar' modunda — karta yeni tanım (…müşteri adı…) eklenemez."` | `ITEM_PHASE_OUT` |
| 404 | renk yok (C) | `"Renk bulunamadı"` | — |
| 400 | renk pasif (C) | `"Renk pasif durumda"` | — |
| 404 | silinecek satır yok (D; P2025 serviste yakalanır) | `"Kumaşa özel renk adı bulunamadı"` | `ITEM_COLOR_ALIAS_NOT_FOUND` |
| 409 | eşzamanlı ilk yazım yarışı (C; `upsert` P2002, serviste yakalanır) | `"Aynı ad aynı anda başka bir yerden yazıldı — tekrar deneyin."` | `ITEM_COLOR_ALIAS_CONFLICT` |
| 409 | PG 40P01/40001 | `"İşlem çakışması — lütfen tekrar deneyin."` | — (error.middleware) |
| 403 | izin yok | `"Bu işlem için 'customer-alias:read\|write' yetkisi gerekli."` | `PERMISSION_DENIED` (+ `required`) |
| 401 | token yok/geçersiz | — | — |

Yalnız iki yeni kod doğar: `ITEM_COLOR_ALIAS_NOT_FOUND` ve `ITEM_COLOR_ALIAS_CONFLICT`. Bu iki durum yeni uca özgüdür ve kardeşin kodsuz karşılıkları yerine kodlu doğar. Kardeş uçlara kod EKLENMEZ, çünkü bu dilimin sözleşmesi değildir.
- P2002 ve P2025 serviste yakalanıp `AppError`'a çevrilir. Middleware'e düşseler "Bu 'field' değeri zaten mevcut" / "Kayıt bulunamadı." gibi kodsuz, genel mesajlar dönerdi.
- PUT idempotenttir: aynı gövde iki kez gönderilirse ikisi de 200 döner. `clientToken` YOK (§4).

### 12.4 Mevcut yanıtlara EKLENEN isteğe bağlı alanlar

**`colorNameScope: ColorNameScope | null` alanının anlamı (her yüzeyde aynı):**
- `'ITEM'`: renk adı yalnız o kumaşa özel ana veri satırından (`CustomerItemColorAlias`) geldiyse.
- `'CUSTOMER'`: renk adı genel müşteri × renk satırından (`CustomerColorAlias`) geldiyse.
- `null`: diğer her durumda. Yani ad sipariş satırından geldiyse (`OVERRIDE`), bizdeki ad kullanıldıysa (`DEFAULT`), top/satır renksizse, müşteri yoksa ya da kalite politikası adı düşürdüyse.
- Alan yalnız ana veri kademesi KAZANDIĞINDA dolar. `NameSource` birliği değişmez. `colorNameSource` taşıyan yüzeylerde (name-preview, rolls/:id) `colorNameSource === 'MASTER'` ⇔ `colorNameScope !== null`; `colorNameSource` taşımayan satır projeksiyonlarında (shipments/:id, open-orders, orders/:id) `colorNameScope !== null` ⇒ `customerColorName`/`resolvedCustomerColorName` ana veriden gelmiştir (bekçi: `test_shipment_doc_customer_name` §11 ikisini de ölçer).
- **Eski istemci alanı yok sayar.** Yeni istemcide alan yoksa (eski backend) değer `null` kabul edilir. Bilinmeyen bir değer gelirse rozet genel "müşteri adı" olarak gösterilir.

| Uç | Servis | JSON yolu | Eklenen | Not |
|---|---|---|---|---|
| `GET /api/labels/name-preview` | `LabelService.previewCustomerNames` (`label.service.ts:~500-590`) | `data.colorNameScope` | `colorNameScope` | Tek-satır zinciri: hedef satır adı → kumaşa özel → genel → bizdeki. `:566`'daki kopya `findUnique` kalkar, indeks kullanılır (#7). |
| `GET /api/labels/rolls/:id` (+ aynı `LabelPayload`'u JSON dönen her uç) | `LabelService.getRollLabel` (`label.service.ts:~290-470`) | `data.colorNameScope` | `LabelPayload.colorNameScope?: ColorNameScope \| null` (`src/types/label.types.ts:34`) | `:386` kopya sorgusu kalkar (#5). Kalite politikası adı düşürürse `null`. Toplu yol (`preloaded`, #6) aynı alanı üretir. HTML/native/ppla çıktıları metin olduğu için değişmez. |
| `GET /api/shipping/shipments/:id` | `ShippingService.getShipmentById` (`shipping.service.ts:~4833-4863`) | `data.orders[].lines[].colorNameScope` | `colorNameScope` | `customerColorName` artık satır adı → kumaşa özel (`customerId, l.itemId, l.colorId`) → genel ile çözülür. Hâlâ `DEFAULT` → `null` kuralı geçerlidir. İzin DEĞİŞMEZ (`READ` = `shipping:read\|write`, `mobile:tarti-paket`, `mobile:sevkiyat`), bugün de ana veri adını taşıyor. |
| `GET /api/shipping/open-orders` | `ShippingService.listOpenOrdersWithCoverage` (`shipping.service.ts:~5419-5443`) | `data[].order` yanında `data[].lines[].colorNameScope` | `colorNameScope` | `getShipmentById` ile AYNI projeksiyon (kod yorumu "AYNI kademe" diyor). Ayrışmasın diye birlikte değişir (#4). |
| `GET /api/orders/:id` | `OrderService.findById` (`order.service.ts:1814`) | `data.lines[].resolvedCustomerColorName`, `data.lines[].colorNameScope` | ikisi de YENİ alan | Aşağıda ayrıca. |

**Sipariş detayı (#12), izne bağlı:**
- `resolvedCustomerColorName: string | null` şöyle çözülür: `line.customerColorName` → kumaşa özel → genel → yoksa `null`. `DEFAULT`'a düşerse `null` döner, bizdeki ad dönmez; `getShipmentById` sözleşmesiyle aynıdır.
- Çağıranda `customer-alias:read` YOKSA:
  - `resolvedCustomerColorName = line.customerColorName` (yalnız satır adı)
  - `colorNameScope = null`
  - Ana veri kademesi TAŞINMAZ. Bu, `OrderDetailSheet.tsx:124-128`'deki bugünkü davranıştır.
- Uygulama:
  - Servis imzası `findById(id: string, opts?: { canReadCustomerAliases?: boolean })` olur. Varsayılan `false`, yani fail-closed.
  - `order.routes.ts:604`'teki `controller.findById` yerine ince bir handler gelir. Handler `matchesPermission(req.user.permissions, "customer-alias:read")` sonucunu geçirir.
  - `BaseController` başka bir çağıranı (örn. iç kullanım) izinsiz varsayar.
  - Yükleme tek `loadCustomerColorIndex` çağrısıdır: müşteri tek, kumaş ve renk kümesi satırlardan. Satır başına sorgu atılmaz.
- `customerColorName` (satır kolonu) DEĞİŞMEZ; yine ham satır adıdır.
- Kumaş adı için karşılık alanı (`resolvedCustomerItemName`) bu dilimde AÇILMAZ. Kumaş adı zaten müşteri × kumaş düzeyindedir ve panel onu çözmeye devam eder (D2 yalnız `colorAliasMap`'i kaldırır).

**Değişmeyen sözleşmeler (beyan):**
- `GET /api/customers/:customerId/aliases/suggest`: yanıt yine `{ itemAlias, colorAlias }`. `colorAlias` önce kumaşa özel satırdan, sonra genelden dolar (#10). Kademe alanı eklenmez; öneri yalnız placeholder'dır.
- Kardeş uçlar (`item-aliases`, `color-aliases`): anlam, gövde ve yanıt aynen kalır. `PUT color-aliases` kumaşı bilmez ve genel adı yazar (§7).
- Çuval içeriği / döküm uçları: yanıt şekli aynı kalır, yalnız değer kumaşa özel kademeyi de görür (#8).
- İrsaliye/çeki: snapshot şekli aynı kalır (`products[].customerName/customerColorOnly`, `cekiRows[].customerVaryant`), yalnız değer 5 kademeli zincirden gelir (§5, §6).

### 12.5 Panel (D2): `Electron/src/pages/Customers/aliasService.ts`'e eklenecekler

```ts
import type { ItemLifecycleStatus } from "@/lib/item-lifecycle";

export type ColorNameScope = "ITEM" | "CUSTOMER";

export interface CustomerItemColorAlias {
  id: string;
  customerId: string;
  itemId: string;
  colorId: string;
  /** Müşterinin BU kumaştaki renk adı — zorunlu (satır yalnız ad taşır). */
  alias: string;
  createdAt: string;
  updatedAt: string;
  item?: { id: string; code: string; name: string; lifecycleStatus: ItemLifecycleStatus };
  color?: { id: string; code: string; name: string; hex: string | null; isActive: boolean };
  customer?: { id: string; code: string; name: string; isActive: boolean };
}

// customerAliasService nesnesine:
listItemColorAliases: (customerId: string): Promise<ApiResponse<CustomerItemColorAlias[]>> =>
  apiClient.get<ApiResponse<CustomerItemColorAlias[]>>(`/api/customers/${customerId}/item-color-aliases`).then((r) => r.data),

listItemColorAliasesByItem: (itemId: string): Promise<ApiResponse<CustomerItemColorAlias[]>> =>
  apiClient.get<ApiResponse<CustomerItemColorAlias[]>>(`/api/items/${itemId}/customer-color-aliases`).then((r) => r.data),

upsertItemColorAlias: (customerId: string, itemId: string, colorId: string, alias: string): Promise<ApiResponse<CustomerItemColorAlias>> =>
  apiClient.put<ApiResponse<CustomerItemColorAlias>>(`/api/customers/${customerId}/item-color-aliases/${itemId}/${colorId}`, { alias }).then((r) => r.data),

deleteItemColorAlias: (customerId: string, itemId: string, colorId: string): Promise<ApiResponse<{ deleted: true }>> =>
  apiClient.delete<ApiResponse<{ deleted: true }>>(`/api/customers/${customerId}/item-color-aliases/${itemId}/${colorId}`).then((r) => r.data),
```

- **Sorgu anahtarları:** `["customer-item-color-aliases", customerId]` (cari kartı) ve `["item-customer-color-aliases", itemId]` (kumaş kartı).
  - İki ekran aynı satırlara yazar. Bu yüzden her PUT/DELETE İKİ öneki de geçersiz kılar: `invalidateQueries({ queryKey: ["customer-item-color-aliases"] })` ve `invalidateQueries({ queryKey: ["item-customer-color-aliases"] })`.
- **Giriş noktaları (karar 1):**
  - `CustomerColorAliasesPanel.tsx`'e isteğe bağlı "Kumaş" ayağı eklenir (§9 D2).
  - Kumaş kartı için yeni bileşen `ItemCustomerColorAliasesPanel.tsx` açılır (`Electron/src/pages/Items/` altında). Yalnız düzenleme kipinde (`ItemFormDialog.tsx`, `isEdit`) görünür. Seçim sırası: müşteri seçici → `ColorPickerModal({ customerId, allowedColorIds: item.allowedColors })`. `ItemFormDialog` bugün sekmesiz; sekme yapısı `CustomerFormDialog.tsx:335-342` emsaliyle kurulur.
  - Yazma düğmeleri `<PermissionGate permission="customer-alias:write">` içindedir (kardeş panel emsali). Bölüm `customer-alias:read` yoksa hiç çizilmez.
- **Tip aynaları (yalnız ekleme):**
  - `Electron/src/pages/Operations/Shipments/types.ts:115` `ShipmentDetailLine`
  - `Electron/src/pages/Operations/SackContentEdit/types.ts:459` `OpenOrderLine`
  - Bu ikisine `colorNameScope?: ColorNameScope | null` eklenir.
  - `Electron/src/pages/Operations/Orders/types.ts` `OrderLine`'a `resolvedCustomerColorName?: string | null`, `colorNameScope?: ColorNameScope | null` eklenir.
  - `Electron/src/services/labelService.ts` `LabelPayload`'a `colorNameScope?: ColorNameScope | null` eklenir.
- **`OrderDetailSheet.tsx`:** renk adını `line.resolvedCustomerColorName`'den okur. Alan `undefined` ise (eski backend) bugünkü `colorAliasMap` yoluna düşer. Yeni backend'le `colorAliasesQuery` KALKAR; vitest bunu ölçer (§9).

### 12.6 Tablet (D4, OTA)

- **Çağrılan uç:** `LabelNamePreview.tsx` yalnız `GET /labels/name-preview?rollId=…[&orderLineId=…][&customerId=…]` çağırır (`mobil/src/services/label.service.ts:237`).
  - `LabelNamePreview` tipine (`label.service.ts:11`) `colorNameScope?: ColorNameScope | null` eklenir.
  - `mobil/src/types/models.ts` `LabelPayload`'a (`:1311` civarı) aynı alan eklenir.
- **Yeni istemci fonksiyonu** (`mobil/src/services/label.service.ts`; tabanda `/api` önekli `apiClient`, kardeşlerle aynı biçim):

```ts
setCustomerItemColorAlias: (
  customerId: string,
  itemId: string,
  colorId: string,
  alias: string,
): Promise<ApiResponse<unknown>> =>
  apiClient
    .put<ApiResponse<unknown>>(`/customers/${customerId}/item-color-aliases/${itemId}/${colorId}`, { alias })
    .then((r) => r.data),
```

- **"Kalıcı" kaydetme kuralı** (`LabelNamePreview.tsx:94-114` yerine):
  - Yalnız DEĞİŞEN alan yazılır: `nextItem !== p.itemName` ve `nextColor !== (p.colorName ?? '')`. Boş değer yine gönderilmez.
  - Renk değiştiyse ve `p.colorId` doluysa:
    - `p.colorNameScope === 'ITEM'` → `setCustomerItemColorAlias(p.customerId, p.itemId, p.colorId, nextColor)`. Kazanan kademe güncellenir; X'in adı genele sızmaz.
    - aksi hâlde (`'CUSTOMER'`, `null` ya da alan yok) → `setCustomerColorAlias(p.customerId, p.colorId, nextColor)`. Bu bugünkü davranıştır.
  - Tablette YENİ kumaşa özel ad YARATILMAZ. `ITEM` dalı yalnız zaten var olan satırı günceller, yeni satır panelden girilir (§9 D4).
  - Hata: `details.code === 'ITEM_PHASE_OUT' | 'ITEM_INACTIVE'` → toast mesajı olduğu gibi gösterilir. Kumaşa özel ad pasif kumaşta güncellenemez; bu kardeş `item-aliases` PUT'uyla aynı kapıdır.
  - `onSuccess` geçersiz kılmaları aynı kalır: `['label','name-preview']` ve `['label','roll']`.
- **Rozet:** `sourceLabel` şöyle döner:
  - `MASTER` + `colorNameScope === 'ITEM'` → `"müşteri adı · bu kumaşa özel"`
  - `MASTER` ve diğer her değer (bilinmeyen dahil) → `"müşteri adı"`
  - Rozet renk satırı için ayrı hesaplanır; kumaş satırı bugünkü gibi kalır.
- **İzin:** kalıcı seçenek yine yalnız `customer-alias:write` ile çizilir (`canPermanent`). Yeni izin yoktur.
- **Eski tablet (1.0.8):** yeni alanı okumaz ve her zaman genel ada yazar (§7 sızıntı). Kapı §7'deki terfi sırasıdır; sözleşmeyle çözülmez.

### 12.7 Bekçi bağları (bu bölümün ölçüsü)

- **`test_route_auth_coverage` · `test_route_mount_reachability` · `test_swagger_spec` · `test_screen_catalog` · `test_permission_catalog`:** A–D ve `definitions/items` capabilities (route reçetesi §15).
- **`test_shipment_doc_customer_name`:**
  - §0 altın: kumaşa özel satır yokken 12.4'teki her yanıt ALANI bugünküyle bayt-eşittir. Yeni `colorNameScope` alanı karşılaştırmadan önce çıkarılır, ayrıca `null`/`'CUSTOMER'` olarak doğrulanır.
  - §11: 12.4'teki eşdeğerlik (iki yüzey sınıfı); ITEM satırı eklenince name-preview = rolls/:id = shipments/:id = open-orders = orders/:id aynı adı ve `'ITEM'`i verir.
- **Sipariş detayı izin dalı:** `customer-alias:read`'siz kullanıcıda `resolvedCustomerColorName === line.customerColorName` ve `colorNameScope === null` olmalı. Negatif sonda: izin kontrolü kaldırılınca kırmızı.
- **C/D hata tablosu:**
  - `ITEM_PHASE_OUT` / `ITEM_INACTIVE` / `ITEM_MERGED` / `ITEM_COLOR_ALIAS_NOT_FOUND` / 400 UUID.
  - Yarış `ITEM_COLOR_ALIAS_CONFLICT`: iki eşzamanlı ilk PUT'tan biri 200, diğeri 200 ya da 409 almalı, 500 ASLA.

## 13. D1 uygulama notları (sapmalar ve ölçülenler, 2026-09-28)

D1 backend bu belgeye göre indi; aşağıdakiler belgeden bilinçli sapmalar ya da "DOĞRULANMADI" diye bırakılmış maddelerin ölçüm sonucudur.

- **Servis imzası (§12.2):** `upsertItemColorAlias(key: { customerId, itemId, colorId }, alias, userId?)` ve `deleteItemColorAlias(key, userId?)`. Beş konumsal parametre `max-params` (4) lint tavanını yükseltirdi. HTTP sözleşmesi (yol, gövde, yanıt, hata tablosu) AYNEN.
- **Dosya yerleşimi:** gövde `src/services/customer-item-color-alias.service.ts`te; `CustomerAliasService`in dört metodu oraya delege eder (kardeş servis 300 satır tavanına dayanıyordu). Kardeşin yerel `assertCustomer`/`assertColor` kapıları `helpers/customer-alias-gates.helper.ts`e taşındı; iki servis aynı kapıyı çağırır.
- **Künye:** upsert'in `update` dalı `updatedById`yi de yazar (kardeş yazmıyor; künye kolonu "son değiştiren"i taşır).
- **Terfi (#11, karar 2):** kural satır düzeyinde uygulanır — (kumaş, renk) çiftinde kumaşa özel ad olan satır terfi ADAYI olmaz; aynı renkte kumaşa özel adı OLMAYAN başka kumaşın satırı bugünkü gibi terfi eder. Varlık okuması ayrı fonksiyonda (`order.service#kumasaOzelRenkCiftleri`), bekçide TERFİ sınıfıyla beyanlı.
- **Sipariş detayı (#12):** ince handler dışa açık (`order.routes#orderDetailHandler`) — izin dalı sunucusuz ölçülür (`test_shipment_doc_customer_name §11`, sonda: izin `true`ya çevrilince kırmızı).
- **Künye route allowlist:** `record-info.routes` `TABLE_PERMISSIONS`e `CUSTOMER_ITEM_COLOR_ALIAS: "customer-alias:read"` eklendi (kardeş iki tablo orada yok; bu dilimde dokunulmadı).
- **fix_duplicate_master_data:** yeni tablo renk sayımına EK OLARAK kumaş sayımına da girdi (FK iki yönde de Cascade).
- **Birleştirme — kaynaklar arası çakışma (§4, "DOĞRULANMADI"):** sondayla DOĞRULANDI: iki kaynakta aynı (kumaş, renk) varken birleştirme P2002 ile düşüyordu (kardeş `CustomerItemAlias` dahil bütün SKIP/UNION tablolarında). Düzeltme jenerik: SKIP · UNION · UNION_COMPOSITE_PK kaynak BAŞINA çözülür (önceki kaynağın taşınmış satırı survivor'da sayılır) ve kaynaklar arası çakışma önizlemede görünür. MERGE_FIELDS · EMPTY_MEANS_ALL · BLOCK denetim turunda kapandı (§15). Çakışma yüklemi sayım, önizleme VE çözücüde (`resolveConflictTx`) tek parçadır (`conflictPredicateSql`); ilk sürümde çözücü kendi survivor-taraflı kopyasını taşıyordu ve yalnız tek elemanlı çağrıyla eşdeğerdi (§15).
- **Birleştirme geri alma (§4):** jenerik fotoğraflı geri yazım yeni tabloda çalışıyor — `test_master_data_merge_revert §8` çok kaynaklı birleştir → geri al; dört satır id + anahtar + ad + tarih BİREBİR döner.
- **Gölgeleme önizlemesi:** `MergePreview.shadowing: { customer, item, color, alias, before }[]` (yeni alan; panel D2'de çizer) + uyarı satırı. Liste, taşınınca survivor'ın o kumaşta bugün basılan ana veri adını DEĞİŞTİRECEK her satırı verir — survivor'da genel ad yoksa da (`before: null` = bizim adımız).
- **Donma (§6 §11 üçlüsü):** "donmuş belge aynı kalır, reissue yeni adı alır" `test_shipment_doc_customer_name §11`de ölçüldü (freeze_timing'e ek bölüm açılmadı; `test_shipment_doc_freeze_timing` değişmeden yeşil).
- **`test_sevk_belge_excel_esit` (§6):** muhasebe Excel yolunu ÖLÇMÜYOR — kapsam notu bekçi başlığına yazıldı.
- **P2002 yakalaması (§12.3):** eşzamanlı ilk PUT yarışında Prisma upsert'i tek ifadede (ON CONFLICT) koşuyor; 5 tur × 3 eşzamanlı ilk PUT'ta P2002 doğmadı. Yakalama savunma olarak duruyor; sondası SESSİZ (bekçi başlığında beyanlı), sözleşmenin sonucu ("500 ASLA") ölçülüyor.


## 14. D5 uygulama notları (içe aktarma, 2026-09-28)

- **Dosya yerleşimi (sapma):** üçüncü adaptör ayrı dosyada — `src/services/import/adapters/customer-item-color-alias.adapter.ts` (entity `customerItemColorAlias`, şablon "Müşteri Kumaşa Özel Renk Adları"). `customer-alias.adapter.ts` zaten 300 satır tavanının üstündeydi; ortak parçalar (`parseAliasKey`, `validateAliasRow`, `loadCustomers`, `guardDuplicateTarget`, `applyAliasNormalization`, `targetIdField`, `KEY_SEP`) oradan dışa açıldı. Mevcut iki şablonun sütunları DEĞİŞMEDİ (`test_import_framework §13`).
- **Anahtar:** `parseAliasKey(raw, arity)` — ilk `arity-1` ayraç böler, son parça kalan metnin tamamı (iki parçalıda bugünkü "ilk `|` böler" davranışı korunur); boş parça `null`. Anahtar sütunu `maxLen` 120 (defter `ImportRunLine.keyValue` VarChar(120); üç kod en çok 32'şer). Çözülen id'ler `__itemId`/`__colorId` (eski ortak `__targetId` kalktı; iç alan).
- **Kumaş kapısı önizlemede:** `assertItemUsable(…, "DEFINITION")` `validateRow`da da sorulur, YALNIZ yazılacak (CREATE/UPDATE) satırda — "Tükenene kadar"/Pasif kumaşa yazılacak satır önizlemede hata alır, yazma anında 409 verip koşumu yarıda DURDURMAZ; değişmeyen (SKIP) satır servise hiç ulaşmadığı için sorulmaz (§15). Kardeş `customerItemAlias` adaptörüne bu dilimde eklenmedi.
- **Geri sarma claim'i (karar 6, `defter.md:60`):** jenerik mekanizma — `ImportAdapter.createdClaim(row)` CREATE satırının yazdığı kolonları (anahtar id'leri + normalize ad) verir, motor bunu `changedFields`e `{from:null,to}` olarak dondurur, `deletePivot` `deleteMany({id, …claim})` yazar, önizleme aynı claim'i okur (`pivotClaimOf` / `pivotClaimDrift`). ÜÇ alias adaptörü de beyan eder. Claim'e alias'ın yanında ANAHTAR kolonları da girer (tasarım yalnız alias diyordu): birleştirmeyle başka cariye taşınan satır, adı aynı olsa da o cariye aittir ve silinmez (§9 çapraz defter fikstürü).
- **Eski defter satırı (sapma, fail-closed):** D5'ten önce yazılmış alias CREATE satırı claim değerini TAŞIMAZ; geri sarma onu artık SİLMEZ, gerekçeyle atlar (önceden yalnız `id` ile siliyordu). "Sonradan değişti mi" sorusu sorulamaz; `updatedAt ≤ defter anı` alternatifi uygulama saati (Prisma `@updatedAt`) ile DB saatini (`now()`) karıştırdığı için reddedildi. Satır gerekirse panelden kaldırılır.
- **Preview `fields`:** CREATE satırında `changedFields` artık claim taşıdığı için önizleme CREATE satırının alan listesini boş basar (bugünkü çıktı korunur).
- **Panel:** içe aktarım ekranı (`DataImportPage`) varlık listesini `/api/import/entities`ten okur — yeni şablon panel değişikliği OLMADAN görünür; geri sarma diyaloğu da jenerik. ⚠️ Tam da bu yüzden şablon AÇILIŞ KAPISIYLA doğar (§7, §15): kapı kalkana kadar listede yoktur.
- **Dışa aktarım:** `exportRows` üçlü anahtarla satırlaştırır; dışa aktarılan dosya geri yüklenince her satır SKIP (`test_import_revert §8f`). Şablon örneğinde seri kodu yazılmaz (`test_bayat_kod_literali` tabanı).
- **Bekçiler:** `test_import_revert` 66/0 (sabit 17→18, pivot 2→3; §8 DB fikstürü: CREATE claim · UPDATE geri dönüş · üçüncü taraf değişikliği atlanır · eski satır · önizleme kapıları · round-trip; §9 içe aktar → birleştir/SKIP → geri sar (ikisi atlanır) → birleştirmeyi geri al (0 atlama) → yeniden geri sar (ikisi silinir)) · `test_import_framework` 57/0 · `test_import_permissions` 10/0 · `test_musteri_adi_tek_cozucu` 11/0 (yeni dosyanın iki okuyucusu DISA_AKTARIM beyanında).


## 15. Denetim turu düzeltmeleri (2026-09-28)

- **Birleştirme — kaynaklar arası çakışma her politikada:** önceki kaynakla aynı anahtar artık HER politikada çakışmadır (`conflictPredicateSql`). MERGE_FIELDS kaynak BAŞINA çözülür (survivor satırı — önceki kaynaktan taşınmış olan dahil — sırayla zenginleşir: `assigned` OR, `alias` ilk dolu). EMPTY_MEANS_ALL tek geçişte kalır ("survivor boş mu" kararı taşımadan ÖNCE verilir) ve sonraki kaynağın aynı satırını siler. BLOCK kaynaklar arası çakışmada önizlemede engel, işlemde 409 verir (önceden P2002). Ölçü: `test_master_data_merge_conflicts ⑦` (negatif sonda: eski yüklem → altı kırmızı).
- **Geri almada zenginleşme fotoğrafı:** survivor satırının fotoğrafı yalnız İLK zenginleşmeden önce alınır (ikinci fotoğraf ara hâli geri getirirdi) ve fotoğraftan geri yazım taşınan kolonu (`customerId`/`colorId`) YAZMAZ — önceki kaynaktan taşınıp zenginleşen satırın sahibini MOVED kalemi geri yazar, iki kalem sırasız uygulansa da aynı sonucu verir. Ölçü: `test_master_data_merge_revert §9d` (iki negatif sonda: fotoğraf tekilliği kaldırılınca ve taşınan kolon yazılınca kırmızı).
- **D6 (karar 7):** geri yazım GENERATED kolonları dışlar (`pg_attribute.attgenerated`); `INSERT` ve `UPDATE` açık kolon listesiyle koşar. Ölçü: `test_master_data_merge_revert §9` — kardeş iki tablo + çok kaynak + çift zenginleşme, dokuz satır id/anahtar/ad/atama/tarih BİREBİR döner. Karar 7'nin durumu: KAPANDI.
- **Gölgeleme önizlemesi:** kaynaklar arası aynı anahtarda yalnız TAŞINACAK satır (kaynak sırasında ilk) listelenir; üç haritanın `why` metni "kaynak sırasında İLK gelen kazanır" der. Ölçü: `test_master_data_merge_conflicts ⑥` (negatif sonda: tekilleştirme kaldırılınca kırmızı). Panelin `shadowing` tablosunu çizmesi D2'nin ZORUNLU maddesidir: çizilene kadar "etkilenen HER kaydı listeler" yalnız sayılı uyarıyla karşılanır.
- **İçe aktarma — değişmeyen satırda kumaş kapısı:** ilk sürüm kapıyı satırın eylemine bakmadan uyguluyordu; kumaşı sonradan "Tükenene kadar"a alınan mevcut satır dışa aktar → geri yükle turunda hata alıyor ve varsayılan `abort` ile HİÇBİR satır yazılmıyordu. Kapı artık yalnız CREATE/UPDATE'te. Ölçü: `test_import_revert §8g` (negatif sonda: koşulsuz kapı → kırmızı).
- **İçe aktarma — AD ile çözülen anahtar (üç alias şablonu):** `findExisting` yalnız KOD eşler, doğrulama (`resolveReference`) ise koda bulamayınca tekil ADA düşer. Ad anahtarlı satır mevcut eşlemeye düşerse CREATE diye deftere geçer ve geri sarma içe aktarmadan ÖNCE var olan satırı fiziksel olarak silerdi (claim yalnız "yazdığım değer yerinde mi"yi sorar, "satırı ben mi doğurdum"u soramaz). Ortak `validateAliasRow` artık ad ile çözülen CREATE satırında eşlemenin varlığını sorar (`aliasPivotExists`) ve varsa satırı hata ile durdurur ("anahtarı KOD ile yazın"); ad anahtarlı YENİ eşleme uyarılı CREATE kalır. Ölçü: `test_import_revert §8h` (kumaşa özel + kardeş kumaş adı şablonu; negatif sonda: kapı kapalı → ❌2).
- **Tek çözücü bekçisi — takma ad kanalı:** `test_musteri_adi_tek_cozucu` ① kanalı yazma çağrısı dışındaki HER delege erişimini okuma sayar (`const d = prisma.customerItemColorAlias; d.findMany(…)` artık beyansız kırmızı); künye (`record-info`) `KUNYE` sınıfıyla beyanlı, `aliasPivotExists` `DISA_AKTARIM` sınıfıyla.
- **İçe aktarma — §7 kapısının ikinci giriş yolu (KRİTİK):** D5 şablonu eski panelde de görünür olduğu için §7'deki "D4 yayılmadan kumaşa özel ad girilemez" kapısını deliyordu (muhasebe Excel'le kumaşa özel ad girer → 1.0.8 tablette "kalıcı" kayıt o adı GENEL ada yazar → müşterinin kumaşa özel adı olmayan bütün kumaşları sessizce o adı basar). Adaptör `releaseGate` ile KAPALI doğar; kaldırma sırası §7'de. Sürüm notuna girecek cümle (taslak, 1e onaylar): *"Kumaşa özel müşteri renk adı içe aktarma şablonu bu sürümde gelir ama kapalıdır; bütün tabletler güncellendikten sonra açılır."* Ölçü: `test_import_framework §14` (negatif sonda: liste süzmesi ve tek boğaz kaldırılınca ❌3).
- **Toplu etiket (#6) kumaşa özel kademede ölçülüyor:** `test_bulk_label_batched` iki müşterili fikstür taşır (ikincisinde (X, renk) kumaşa özel + genel ad, aynı renkte ikinci kumaş); toplu = tekil (bayt) ve tekilde X'te `ITEM`, ikinci kumaşta `CUSTOMER` kademesi. Negatif sonda: toplu yolda kumaşa özel kademe atlanınca ❌3 (HTML + native bayt eşitliği + ad).
