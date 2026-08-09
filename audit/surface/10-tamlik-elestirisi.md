# 10 — Tamlık Eleştirisi (completeness critic)

> Bu belge **bulgu raporu değildir**. 01–09 numaralı dokuz yüzey haritasının üstüne bakar ve
> tek bir soruyu yanıtlar: *denetim planı kurulmadan önce ne EKSİK kaldı?*
>
> Kod tabanı: `/Users/oad/Documents/projeler/AdnanSahin/Teks-Erp` · branch `main` · HEAD `ef49bbc3`
> Tarih: 2026-08-09 · Salt-okuma. Hiçbir kod dosyası değiştirilmedi.
> Her sayı §7'deki komuta dayanır; dayanmayanlar **tahmin** ya da **ŞÜPHELİ** işaretlidir.

---

## 0. Yöntem ve güven seviyeleri

Üç ölçüm yapıldı:

1. **Kapsama taraması** — dokuz `.md` dosyası tek metne birleştirildi (`cat 0*.md`), `src/` altındaki
   271 TS dosyasının her biri için (a) tam dosya adı (`x.ts`), (b) uzantısız kök (`x`), (c) yol parçası
   (`utils/query-parser`), (d) dosyanın `export` ettiği semboller ayrı ayrı arandı.
   ⚠️ (b) ve (d) **fazla iyimserdir** (kelime olarak geçen "cursor", "presence" gibi terimler eşleşir),
   bu yüzden aşağıdaki "hiç dokunulmamış" listeleri (a)+(c)+(d)'nin **elle doğrulanmış** kesişimidir.
2. **Bağımsız sayım** — route, model, enum, izin, tx, tip, sorgu metrikleri sıfırdan yeniden ölçüldü ki
   dokuz belgenin sayıları çapraz doğrulanabilsin.
3. **Kod sondası** — çok kiracılılık sorusu (madde 5) varsayımla değil şema + servis okumasıyla yanıtlandı.

---

## 1. Dokuz haritanın HİÇ dokunmadığı `src/` yüzeyi

### 1.1 Kapsama tablosu (dizin bazında)

| Dizin | Dosya | Satır | Adı hiç geçmeyen dosya | Değerlendirme |
|---|---:|---:|---|---|
| `src/routes/` | 54 | 13.791 | **0** | Tam kapsandı (02/03/04) |
| `src/services/` | 152 | 77.067 | 39 (6.576 satır) | Dosya adıyla değil ama **context + bağımlılık grafiğiyle** 152/152 kapsandı (01). Adı geçmeyenler çoğunlukla `document-render/*.html.ts` ve `helpers/label-*`/`raster/*` — sınıf olarak haritalandılar |
| `src/jobs/` | 4 | 646 | 0 | Tam kapsandı (07, dördü de satır satır) |
| `src/middlewares/` | 7 | 1.067 | 0 | Tam kapsandı (05, yedisi de okundu) |
| `src/constants/` | 4 | 745 | 0 (ama 2'si yalnız sembolüyle) | Kısmi — aşağı bak |
| `src/lib/` | 7 | 581 | **2** (194 satır) | `string-validators.ts` (175) + `zod-locale.ts` (19) hiç geçmiyor |
| `src/config/` | 8 | 1.372 | **3** (829 satır) | `label-elements.ts` (606) · `label-icons.data.ts` (169) · `label-kind.schema.ts` (54) |
| `src/utils/` | 7 | 909 | **5** (590 satır) | Yalnız kavram düzeyinde değinildi; **hiçbiri dosya olarak açılmadı** |
| `src/types/` | 4 | 185 | **4** (185 satır) | Tamamı kapsam dışı |
| `src/controllers/` | 22 | 6.714 | **13** (2.854 satır) | Katman **sayıldı** ama içine **hiç girilmedi** |

Toplam: tam dosya adı hiçbir belgede geçmeyen **118 dosya / 22.126 satır** (`src/`'in %21,3'ü).
Bu sayı üst sınırdır — bir kısmı (özellikle `services/` altındakiler) sınıf/context olarak
haritalanmış durumda. Aşağıdaki beş boşluk ise **hiçbir belgede hiçbir düzeyde** analiz edilmemiştir.

### 1.2 Boşluk A — `src/utils/` : paylaşımlı sorgu ve hata çekirdeği (KESİN)

Fan-in ölçümü (`src/` içinde kaç dosya import ediyor):

| Dosya | Satır | Fan-in | Dokuz belgede |
|---|---:|---:|---|
| `utils/app-error.ts` | 63 | **75** | `AppError` **kullanımı** 3 belgede geçiyor; **sınıfın kendisi** (statik fabrikalar, `details` tipi, `statusCode` seti) hiç açılmadı |
| `utils/query-parser.ts` | 272 | 15 | `parseQueryParams`/`applyDateRange`/`isCursorRequested` doc 06'da **tek bir boru hattı satırında** anılıyor. `readIdCondition`, `readFilterList`, `buildWhereClause`, `buildTurkishSearch`, `buildOrderByClause` — **hiçbiri geçmiyor** |
| `utils/cursor.ts` | 290 | 25 | Sıfır sembol eşleşmesi (`encodeCursor`, `decodeCursor`, `cursorWhere`, `buildNextCursor`, `DynamicCursor` — hiçbiri) |
| `utils/code-format.ts` | 176 | 17 | Sıfır |
| `utils/barcode-retry.ts` | 41 | 14 | `withBarcodeRetry` doc 06'da 1 kez anılıyor; dosya açılmadı |
| `utils/p2002.ts` | 38 | 6 | Sıfır |

**Neden önemli:** kök `CLAUDE.md`'nin en yeni iki canlı vakası tam bu dosyaların içinde yaşıyor:
`readIdCondition` (2026-08-06 çoklu-seçim CSV kuralı — *"ham CSV'nin üç arıza modu: 400 / sessiz 0 satır /
sessizce düşen filtre"*) ve `cursor.ts`'in `sortNullable`'ı (2026-08-02 `dispatchedAt` nulls-last).
Doc 06 `safeSortBy`/`safeFilters`/`sanitizeWriteData` üçlüsünü **`base.service` tarafından** iyi anlattı
ama o guard'ların çıktısını **tüketen** `buildWhereClause` incelenmedi. Ayrıca `MAX_OFFSET=10000`
guard'ı `query-parser.ts`'te yaşıyor (`Teks-Erp/CLAUDE.md` perf kuralı 5) ve hiçbir belgede geçmiyor.

**Denetim için:** bu altı dosya birlikte **909 satır** ve 500 ucun neredeyse hepsinin sorgu/hata
yolundan geçiyor. Fan-in'leri (`app-error` 75) doc 01'in "hub servisleri" tablosundaki en yüksek
değerden (`audit.service` 50) **daha büyük** — yani o tablo eksik.

### 1.3 Boşluk B — `src/config/label-elements.ts` (606 satır, fan-in 9) (KESİN)

`prepareElements` ve `showIf` (kök `CLAUDE.md` 2026-08-02 notunun *tek uygulama noktası*, beş render
yolunun ortak kapısı) hiçbir belgede geçmiyor. Doc 01 etiket motorunu "5 render yolu" olarak
haritaladı ama o beş yolun **ortak koşul katmanını** hiç görmedi. Aynı dizindeki
`label-kind.schema.ts` (54) ve `label-icons.data.ts` (169) da kapsam dışı.

`src/config/` toplam 1.372 satır ve dokuz belgede yalnız `swagger.ts` (66 satır) analiz edilmiş.

### 1.4 Boşluk C — controller katmanı (22 dosya / 6.714 satır) (KESİN)

Doc 01 controller **satır sayılarını** context bazında verdi; doc 02/03/04 route→controller
metodunu isimle takip etti. Ama **hiçbir belge bir controller dosyasının içine girmedi.**
Ne dosya adı ne sınıf adı geçmeyen 7 controller: `batch` (103) · `customer-alias` (101) ·
`device` (180) · `printed-document` (253) · `return` (125) · `subcontractor-management` (140) ·
`work-session` (138).

Bu, keyfî bir eksik değil — **projenin bilinen en pahalı sessiz hata sınıfı tam burada yaşıyor.**
Kök bellek ve `ef49bbc3` commit'i, `POST /api/traveler-cards/:id/print-event` ucunun controller
`bind`'ı eksik olduğu için **2026-08-05'ten beri her çağrıda 500 verdiğini** ve servis-katmanı
bekçilerinin bunu **göremediğini** yazıyor. Doc 03 bunu madde 9'da işaret etti ama
*"bu envanterde yapılmadı"* diyerek açıkta bıraktı.

Ölçtüm: **iki farklı bağlama konvansiyonu yan yana yaşıyor.**

| Konvansiyon | Dosya | Örnek |
|---|---:|---|
| Arrow-property (otomatik bağlı) | 6 | `shipping` (45 metot), `label` (25), `label-template` (24), `customer-alias` (7), `work-session`, `return`, `subcontractor-management` (karışık) |
| Prototip metodu + constructor'da açık `.bind(this)` | 11 | `workorder` (32 bind), `inventory` (23), `subcontractor` (22), `tambur` (19), `kartela` (13), `kursun-qc` (12), `traveler-card` (10)… |
| Statik metot (`this` yok) | 4 | `auth`, `device`, `user-preference`, (kısmen `work-session`) |

Bugün bağlanmamış prototip metodu **bulunamadı** (heuristik tarama, §7-M9) — yani bu bir bulgu
değil bir **kırılganlık**: iki konvansiyon karışık, mekanik bekçi yok ve hata sınıfı zaten bir kez
sahada aylarca yaşadı.

### 1.5 Boşluk D — `src/types/` (4 dosya / 185 satır, tamamı kapsam dışı) (KESİN)

- `types/express-augment.ts` (33) — `Request.user?` ve `Request.device?` augmentation'ı. **İkisi de
  opsiyonel.** `verifyToken` route başına takıldığı için (doc 05 §3.1, fail-open desen) `req.user`'ı
  guard'sız bir handler'da okuyan kod `undefined` görür; TypeScript uyarmaz çünkü tip zaten
  opsiyonel. Bu, doc 05'in "fail-open" işaretinin **tip tarafındaki ikizi** ve hiç incelenmedi.
- `types/api.types.ts` (54, fan-in 43) — `ApiResponse`/`PaginatedResponse`/`QueryParams`/`JwtPayload`.
  Semboller doc 06'da geçiyor ama sözleşmenin kendisi (zarf tutarlılığı) ölçülmedi.
- `types/bwip-js.d.ts` (54) ve `types/opentype.d.ts` (44) — **elle yazılmış ambient declaration**.
  Bunlar iki dış kütüphanenin tip sözleşmesini *bizim* beyan ettiğimiz yerlerdir; yanlışsa
  `strict: true` bile korumaz. Hiçbir belgede geçmiyor.

### 1.6 Boşluk E — `src/lib/string-validators.ts` (175 satır) ve `lib/zod-locale.ts` (19) (KESİN)

Doc 06 ve 08 `lib/prisma`, `lib/pool-health`, `lib/presence`, `lib/disk-metrics`, `lib/pg-session`'ı
kapsadı. Kalan ikisi hiç geçmiyor. `string-validators` adı ve boyutu itibarıyla girdi doğrulama
yüzeyine ait; `zod-locale` Zod'un Türkçe hata mesajlarını kuruyor (proje kuralı: *"Validation hata
mesajları Türkçe"*). İkisi de "doğrulama sözleşmesi" denetiminin doğal parçası.

### 1.7 Yanlış alarm olmasın — bunlar kapsandı

`src/app.ts` (462) ve `src/server.ts` (188) doc 05 ve 08'de **tam okundu**.
`src/middlewares/` 7/7, `src/jobs/` 4/4, `src/routes/` 54/54 kapsandı.
`constants/time.ts`, `constants/document-design.ts`, `constants/permission-catalog.ts`,
`constants/role-template-catalog.ts` — dördü de sembol düzeyinde anıldı (`factoryDaySql`,
`DOCUMENT_DESIGN_READ`, `PERMISSION_CATALOG`, `ROLE_TEMPLATE_CATALOG`); dosya olarak açılmamış
olmaları kabul edilebilir çünkü davranışları 07 ve 03/04'te anlatıldı.

---

## 2. Çelişkiler ve sayısal tutarsızlıklar

### 2.1 KESİN ÇELİŞKİ — enum sayısı: 28 mi 38 mi

| Belge | İddia |
|---|---|
| `01-modul-haritasi.md:24` | `3.721 satır, 85 model, **28 enum**` |
| `06-veri-katmani.md:1.1` | `enum **38**` |

**Ölçüm:** `grep -c '^enum ' prisma/schema.prisma` → **38**. Doc 06 doğru, doc 01 yanlış.
Doc 01'in kaynak kolonu bu satır için `grep -c '^model '` yazıyor — yani enum sayımı hiç
koşulmamış, elle yazılmış. Kök `Teks-Erp/CLAUDE.md` de "~35 enum" diyor (yaklaşık, sorun değil).

**Neden önemli:** doc 01 §0 tablosu diğer sekiz belgenin "temel sayımlar" referansı. Bir hücresi
elle yazılmışsa aynı tablodaki diğer hücrelere de körü körüne güvenilemez (aşağıya bak).

### 2.2 KESİN — doc 01 §2'de sistematik +1 sapması

| Dosya | Doc 01 §2 | Gerçek (`wc -l`) | Doc 01 §5.15 |
|---|---:|---:|---:|
| `base.service.ts` | 838 | **837** | — |
| `workorder.service.ts` | 6.074 | **6.073** | 6.073 ✅ |
| `subcontractor.service.ts` | 6.056 | **6.055** | 6.055 ✅ |

Aynı belgenin §2'si ile §5.15'i **birbirinden 1 farklı**. Zararsız (muhtemelen "son satır" sayımı
farkı) ama denetim bu dosyalarda satır numarası referansı kurarken kafa karıştırır. Doc 06'nın
837'si doğru.

### 2.3 KESİN — advisory lock: "4 çağrı noktası" ↔ "6 kullanım"

| Belge | İddia |
|---|---|
| `06-veri-katmani.md:265` | **4 çağrı noktası**, 2 farklı anahtar uzayı |
| `07-async-yuzey.md:67` | *"Kod tabanında **6** `pg_advisory_xact_lock` kullanımı var"* |

**Ölçüm:** `grep -rn pg_advisory src` → **7 satır**, bunların **4'ü gerçek çağrı**
(`inventory.service`, `batch.service`, `session-registry.service`, `permission-management.service`),
3'ü **yorum satırı** (`batch.service` ×1, `duplicate-guard.helper` ×2). Doc 06 doğru; doc 07 grep
satırını çağrı sanmış. Doc 07 kendi listesinde `duplicate-guard.helper`'ı "+ tanımı" diye parantez
içine aldığı için tamamen yanlış değil ama **sayı yanlış**.

Bu, doc 07'nin ana tezini (*"hiçbir scheduler'da advisory lock yok"*) etkilemiyor — o tez doğru.

### 2.4 KESİN — "155 migration" sorusu üç belgede üç kez, biri çözümsüz bırakılmış

Doc 01, 06 ve 08 kesin cevabı verdi: **154 migration dizini** + `migration_lock.toml` = 155 girdi;
DB `_prisma_migrations` da 154 satır (doc 06 psql ile doğruladı). Doc 05 §10 ise aynı farkı
*"**ŞÜPHELİ**, sayım kriteri farkı olabilir"* diye açık bıraktı. Çelişki değil, **kapatılmamış
bir belirsizlik** — denetim planında "154" kesin sayı olarak kullanılabilir.

### 2.5 KESİN — "guard'sız uç" sayısı: 22 (doc 05) ↔ 23 (`CLAUDE.md`) ve gruplar toplanmıyor

- Doc 05 §3.1: *"Statik izin guard'ı taşımayan **22** route"*, ve alt kırılımı veriyor.
- Kök `CLAUDE.md`: *"496 uçtan 473'ü izin guard'lı — guard'sız **23**"*.
- Doc 02 (Grup A): izin guard'ı olmayan **0**.
- Doc 03 (Grup B): permission guard'ı olmayan **2** (feature-flag `GET /` ve `GET /documents-logo`).
- Doc 04 (Grup C): auth var + RBAC yok **7**; auth yok **8**.

**Bağımsız ölçümüm** (guard alias'ları çözülerek, §7-M4): auth'suz **8** (doc 04 ve doc 05 ile birebir),
statik izin guard'ı olmayan **15** — `auth.routes` self-servis 4 (`/me`, `/logout`, `/preferences` ×2) +
`currency` 1 + `document-profile` 2 + `feature-flag` **3** (doc 03 ikisini saymış, `PATCH /` de
`flagWriteGuard` ile **dinamik** kapılı, statik değil) + `printed-document` 5.
8 + 15 = **23** — yani `CLAUDE.md`'nin 23'ü, doc 05'in 22'sinden daha doğru;
doc 05 `feature-flag` `PATCH /`'i atlamış görünüyor (**ŞÜPHELİ**: doc 05 onu "dinamik guard" sayıp
listeden çıkarmış olabilir, gerekçesi yazılı değil).

Grup toplamı da tutmuyor: 0 + 2 + 7 = 9 ≠ 15. Fark, Grup C'nin `auth.routes` self-servis dörtlüsünü
saymamış olmasından geliyor (doc 04 onları "auth var, RBAC yok" saymadı). **Üç belge aynı şeyi
farklı tanımlarla sayıyor** — denetim planı **tek bir tanım** seçmeli.

### 2.6 KESİN — toplam uç sayısı: 500 (üç envanter) ↔ 496 (`CLAUDE.md`)

Bağımsız sayımım **500** (§7-M3) ve dokuz belgenin grupları buna tam denk geliyor:
A 141 + B 165 + C 194 = **500**. Doc 05'in kendi bağımsız script'i de 500 buldu.

Kök `CLAUDE.md`'nin "496" rakamı **aynı commit'te (`8fee03b8`) yazılmış** ve o commit'te de kod
500 uç taşıyor (git ile üç commit'te ölçtüm: `8fee03b8`, `ef49bbc3`, `HEAD` → hepsi 500).
Yani **4 uçluk fark kod kayması değil, sayım yöntemi farkıdır.** Sebep doğrulanmadı (**ŞÜPHELİ**),
ama en olası aday §2.7'de:

### 2.7 Uyarı — `...guard` yayılımı mekanik tarayıcıları yanıltıyor (doğrulandı)

`src/routes/reports/` altındaki 7 dosya izinleri şöyle bağlıyor:

```ts
const guard = [verifyToken, requirePermission("report:inventory")];
router.get("/roll-aging", ...guard, handler);
```

Kendi ilk tarayıcım bu **20 ucu** "auth yok" diye raporladı; alias çözümü eklenince düzeldi.
Doc 04 bu tuzağı madde 14'te açıkça yazmış (*"bu raporda 20 uç bu yüzden ilk taramada auth yok
göründü"*) — yani tuzak biliniyor. Denetim planı, izinle ilgili **her** sayıyı bu deseni çözen
bir tarayıcıyla yeniden üretmeli; aksi halde "N uç korumasız" tipi bir bulgu %100 yanlış pozitif olur.

### 2.8 Kavramsal gerilim — "queue yok" ↔ "yazma kuyrukları var"

Doc 07 §0 kesin bir ifadeyle başlıyor: *"queue yok, Redis yok, WebSocket/SSE yok"*. Aynı belge §11
madde 10'da *"Promise-zinciri yazma kuyrukları (`copyRecordsWriteQueue`, `documentsLogoWriteQueue`) —
tek process dışında lost-update"* diyor. Çelişki değil (biri **altyapı** kuyruğu, diğeri **süreç içi
serileştirme** zinciri) ama okuyucuyu yanıltabilir: denetim "queue yok" cümlesini görüp
süreç-içi serileştirme yüzeyini atlarsa, doc 07'nin kendi 10. maddesi ölü kalır.
**Öneri:** plan bu ikisini iki ayrı satır olarak taşısın.

---

## 3. Route envanteri toplamı — bağımsız doğrulama

| Ölçüm | Değer | Durum |
|---|---:|---|
| `src/routes/**` toplam route bildirimi | **500** | ✅ A(141)+B(165)+C(194) ile birebir |
| İç içe `router.use` mount | 12 (`customer` 4 + `reports` 7 + `workorder` 1) | ✅ doc 03/04 ile uyumlu |
| `app.use("/api/...")` router mount | **46** (+1 tanesi `/api` JSON-404 handler'ı) | ✅ doc 05 doğru (47 grep satırından 1'i handler) |
| `verifyToken` taşımayan uç | **8** (auth 5 + device 3) | ✅ doc 04 ve doc 05 ile birebir |
| İzin kataloğu kod sayısı | **67** (`category:` satırı 68 − 1 yorum) | ✅ `CLAUDE.md` ile uyumlu |
| Prisma model / enum | **85 / 38** | ⚠️ doc 01'in enum sayısı yanlış (§2.1) |
| `@openapi` bloğu | **414** | ❗ 500 uçta ~86 uç dokümansız — **hiçbir belge bunu ölçmedi** |

Sonuç: **route envanteri tamdır ve iç tutarlılığı doğrulanmıştır.** Sorunlu olan tek sayı
`CLAUDE.md`'nin 496'sı (§2.6) ve o da denetim planına değil, `CLAUDE.md` bakımına ait bir not.

---

## 4. Denetim kategorisi olgunluk matrisi

Her satır: haritalama yeterli mi + **somut olarak ne eksik**.

### 4.1 Eşzamanlılık (concurrency) — **KISMİ**

Güçlü: 115 transaction envanteri, global 20 s bütçe, atomik claim deseni, 4 advisory lock,
tek-process invariant, scheduler yeniden-giriş guard'ları, `db-copy` bellek-içi bayrağı,
`latency-persist` findUnique→update yarışı (06 ve 07 birlikte iyi iş çıkarmış).

Eksik:
1. **`updateMany` sınıflandırması yapılmadı.** Doc 06 kendi kabul ediyor: 225 çağrının
   ~117'sinde sonuç sayısı denetlenmiyor; hangisi "durum geçişi = claim olmalı", hangisi
   "toplu güncelleme = meşru" ayrımı yok. Bu, `CLAUDE.md`'nin *"`findUnique→if→update` YASAK"*
   kuralının **ölçülmemiş** yüzü.
2. **Transaction DIŞI read-modify-write taraması hiç yapılmadı.** KK1 mükerrer-top vakası
   (2026-08-05) tam bu sınıftı: guard sorgusu tx dışındaydı, insert ayrı tx'teydi.
3. **`Promise.all` 75 kullanım** — ESLint kuralı yalnız `Promise.all([tx.*])` desenini
   yakalıyor (isim tabanlı, doc 06 madde 6). Tx **dışındaki** paralel yazmalar taranmadı.
4. **Cursor pagination + eşzamanlı yazma** (`utils/cursor.ts`, 25 fan-in) hiç ele alınmadı —
   kaydırma penceresi altında kayıt atlama/tekrarlama sınıfı.
5. **`x-device-id`** çözümü `verifyToken`'dan **önce** koşuyor ve `touchDevice` bellek-içi
   presence yazıyor; eşzamanlı istek altında presence tutarlılığı ölçülmedi.

### 4.2 Mimari / SOLID — **YETERLİ** (dokuzun en güçlü tarafı)

Doc 01 context haritası, SCC döngü analizi, fan-in ölçümü, katman ihlali sayımı ve 15 maddelik
sınır bulanıklığı listesiyle bu kategoriyi büyük ölçüde kapatıyor.

Eksik:
1. **Controller katmanının içi** (§1.4) — 6.714 satır, katman sözleşmesinin uygulandığı yer.
2. **Hub tablosu eksik**: doc 01 fan-in tablosunun en yükseği `audit.service` 50. Ölçtüm:
   `constants/time` **69**, `utils/app-error` **75**, `types/api.types` **43**. Yani sistemin
   gerçek merkezî bağımlılıkları o tabloda **yok** — çünkü tablo yalnız `services/` içini saydı.
3. **`document-render/*.html.ts`'nin `printed-document.service`'i import etmesi** (doc 01 §3'te
   işaret edildi) sayı verilmiş ama hangi 8 dosya olduğu listelenmemiş.

### 4.3 Güvenlik — **KISMİ (iyi tarafta)**

Güçlü: auth zinciri + fail-open desen tespiti, RBAC wildcard semantiği, CORS `*` ölçümü,
helmet başlıklarının **gerçekten üretilen** listesi, rate-limit yokluğu, `login-lockout`'un
klasik login'i kapsamaması, path traversal doğrulaması (backup), SQL injection taraması
(`$queryRawUnsafe` tek kullanım + 2 `Prisma.raw`), public uçlar, `.env` git'te, `/health` ifşası,
audit maskesizliği.

Eksik — **beşi de ölçülebilir**:
1. **Zod sözleşmesi taranmadı.** Ölçüm: `z.object(` **178**, `z.strictObject(` **1**,
   `passthrough/catchall` **2**. Zod v4'te `z.object()` bilinmeyen anahtarı **hata vermeden
   düşürür**. Kök `CLAUDE.md` bu sınıfın **iki canlı vakasını** anlatıyor
   (mobil `foldType` sessizce silindi; `docConfigSchema` yeni ayar anahtarını yuttu → "önizleme =
   gerçek baskı" sözleşmesi bozuldu). Dokuz belgeden yalnız doc 03 `strictObject` kelimesini bir
   kez geçiriyor (feature-flag için). **Bu, denetimin en yüksek getirili tek taraması olabilir.**
2. **Şablon motoru güvenliği** — `sanitizeTemplateHtml` (5 kullanım) yalnız doc 04'te bir kez
   adı geçiyor; `RAW_HTML` refakat kartı modu ve `config/label-elements.ts` (606 satır) hiç
   açılmadı. Baskı iframe'i sandbox'ı Electron tarafında; backend tarafındaki iki katmanlı
   sanitizasyonun **render yolunda da** koştuğu doğrulanmadı.
3. **Kimlik yapılandırması**: HS256 sabitlenmiş (`auth.service.ts:388` — iyi), bcrypt cost 10,
   `expiresIn` **`SystemSetting`'ten canlı okunuyor**. Ayarın alt/üst sınırı ve kötü değerin
   etkisi denetlenmedi.
4. **Düz saklanan sırlar**: `User.quickPin` ve `User.cardToken` **düz metin** (ölçüldü:
   `getUserCredentials` doğrudan döndürüyor) ve `GET /api/admin/users/:id/credentials` bunları
   servis ediyor (doc 02 "hassas" diye işaretledi — doğru). Doc 06 `BaseService.safeFilters`'ın
   *"modelin TÜM kolonlarını filtrelenebilir yaptığı"* ve bunun sır kolonu olan modellerde
   enumerasyon oracle'ı üreteceği uyarısını yaptı ama **doğrulamayı açık bıraktı**.
   Ben kapattım: BaseService'e bağlı **14 model** var
   (`color · customer · customerBranch · defectType · fabricProperty · item · machine · order ·
   peripheralDevice · productRecipe · qualityGrade · returnReason · route · station`) —
   `user` ve `device` **bu listede yok**. Yani bugün somut risk yok; denetim listeyi
   `peripheralDevice` (cihaz kimlik/adres alanları) için gözden geçirmeli.
5. **`x-device-id` imzasız bir istemci başlığı** ve `req.device.machineId` **üretim atfı**
   (`RollMovement.machineId`) için kullanılıyor (56 + 21 kullanım). Bir cihazın başka bir
   cihazın kimliğini taklit etmesinin sonucu hiçbir belgede değerlendirilmedi.

### 4.4 Veri / performans — **KISMİ**

Güçlü: index/FK/constraint envanteri ve **şema ↔ DB tam mutabakatı** (doc 06 §1.3 — çok değerli),
tx bütçesi, barkod sayacı serileşmesi, `assertNameNotDuplicate` LIMIT'siz taraması, ham SQL
dağılımı, `/health` yoklama yükü işareti.

Eksik — dördü de sayısal, hiçbiri ölçülmemiş:
1. **Sınırsız sorgu yüzeyi**: `.findMany(` **427** kullanım, `take:` yalnız **106**.
   Hangi liste uçlarının tavanı yok, hangileri cursor'a bağlı — sınıflandırılmadı.
2. **N+1**: `src/` içinde 454 `for`/`while` bloğu var; döngü içinde Prisma çağrısı yapan
   yollar hiç taranmadı. `role-template-catalog.job` için doc 07 bunu (küçük ölçekte) fark etti
   ama istek yolunda hiç bakılmadı.
3. **Over-fetch**: `include:` **275** kullanım ↔ `select:` 1.912. Perf kuralı 7
   (*"`include` yerine `select`"*) ihlallerinin listesi yok.
4. **Auth hot-path maliyeti**: `verifyToken` istek başına `user.findUnique` + `session.findUnique`
   (cache yok), `resolveDevice` +1 sorgu. 500 uç × tablet yoklaması (5 sn) çarpanı doc 03 ve 05'te
   **işaret edildi ama ölçülmedi**.

### 4.5 Doğruluk (correctness) — **KISMİ**

Güçlü: doc 09'un test kapsam haritası (273 test / 5.223 assertion / servis kapsamı %87 / HTTP
kapsamı %3,7) çok iyi; doc 06'nın claim ve tx analizi; doc 01 §5.9'un "rapor katmanı kural
kopyalıyor" tespiti.

Eksik:
1. **Zod şemalarının alan-alan içeriği** — doc 04 kendi kapsam dışına yazdı; §4.3-1 ile aynı taban.
2. **Kural kopyası sayımı yapılmadı.** Doc 01 §5.9 `reports/`'un domain servislerini hiç import
   etmediğini gösterdi ama **hangi kuralın kaç kopyası** olduğu sayılmadı
   (`K18_DEAD_STATUSES`, brüt/net iade kuralı, `producedOutputWhere`, `factoryDaySql`).
   Bu, `CLAUDE.md`'nin en çok tekrarlanan uyarısı (*"dördüncü kaynak dördüncü rakam"*).
3. **Decimal aritmetiği**: şemada 44 `@db.Decimal` alan var; JS `number`'a düşürüldüğü noktalar
   (`CLAUDE.md` kontrol listesi maddesi) hiçbir belgede taranmadı.
4. **`utils/code-format.ts`** (176 satır, "tek kod" kuralı + `isDailyCode` + dolgu kararları)
   hiç açılmadı — oysa parti no biçimi/dolgusu `CLAUDE.md`'de iki ayrı notta ısırmış konu.

### 4.6 API sözleşmesi — **ZAYIF**

Güçlü: 02/03/04'ün *yan etki · idempotent · clientToken · izin zinciri* kolonlu envanteri
gerçekten iyi ve nadir bir kalitede.

Eksik:
1. **OpenAPI ↔ gerçek zincir mutabakatı yok** ve doc 04 bunu açıkça kapsam dışı bıraktı.
   Ölçüm: **414 `@openapi` bloğu / 500 uç** → ~86 uç dokümansız (**ŞÜPHELİ**: bir blok birden
   fazla ucu belgeliyor olabilir, o yüzden fark daha büyük de olabilir).
2. **Yanıt zarfı tutarlılığı ölçülmedi.** `ApiResponse` yalnız 40/152 serviste geçiyor;
   `res.status(200)` 346 ↔ `res.json(` 35 ↔ `res.setHeader(` 32 ↔ `res.download(` 1 →
   zarf dışına çıkan (HTML/dosya/akış) uçların listesi yok.
3. **Hata `code` sözleşmesi envantersiz.** İstemciler `code` ile karar veriyor
   (`DEVICE_INACTIVE`, `BATCH_REQUIRED`, `POSSIBLE_DUPLICATE`, `ENTRY_CANCELLED`,
   `WORK_SESSION_REQUIRED`, `SESSION_EXISTS`…) ama hiçbir belge kod listesini çıkarmadı.
   Doc 05 madde 9 `AppError.details`'in filtresizliğini işaret etti, listelemedi.
4. **`clientToken` kapsaması parçalı** — doc 02 Grup A'da 8 uç saydı, doc 03 eksik olanları
   listeledi, ama **birleşik envanter yok** (hangi kayıt-yaratan uç korumalı, hangisi değil).

### 4.7 Tip güvenliği — **HAYIR (haritalanmadı)**

Dokuz belgede bu kategoriye ait tek analiz doc 09'un R11 maddesi
(*"`parserOptions.project` yok → `no-floating-promises` açılamaz"*) ve tsc geçidi anlatımı.
İkisi de değerli ama tip güvenliği yüzeyinin kendisi hiç ölçülmedi. Ben ölçtüm:

| Ölçüm | Değer | Yorum |
|---|---:|---|
| `tsconfig.json` `strict` | **true** | İyi |
| Tip annotation olarak `any` | **0** | `CLAUDE.md` kuralı fiilen tutuyor (`src` genelinde "any" kelimesi yalnız 7 kez ve hepsi yorum/metin) |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | **0** | İyi |
| `as unknown as` | **73** | Yoğunlaşma: `system-setting` 10 · `label-template` 10 · `traveler-card` 5 · `shipping` 5 · `printed-document` 4 · `base.service` 3 |
| `z.any()` | 2 | Doc 03 birini (`documentsConfig`) işaret etti |
| Şemada `Json` alan | **20** | 73 cast'in çoğunun kaynağı (snapshot/config/fields/elements) |
| `eslint-disable` içeren dosya | 4 | |

**Denetim hedefi net:** tip güvenliği bu kod tabanında `any` ile değil **`Json` sınırında**
kaybediliyor — 20 Json kolonu ve 73 `as unknown as` cast'i, derleyicinin hiçbir şey doğrulamadığı
73 noktadır ve bunların çoğu belge/etiket snapshot'larıdır (yani **donmuş resmi belgeler**).
`base.service.ts`'teki `Prisma.dmmf` cast'ini doc 06 doğru işaret etti; kalan 70'i kimse saymadı.

Ayrıca `types/express-augment.ts`'in `user?`/`device?` opsiyonelliği (§1.5) tip tarafındaki
fail-open desendir ve hiç değerlendirilmedi.

### 4.8 Çok kiracılılık ve izolasyon — **kategori yanlış çerçevelenmiş** (bkz. §5)

### 4.9 Ops / gözlemlenebilirlik — **KISMİ (iyi tarafta)**

Güçlü: doc 07 + 08 birlikte scheduler'lar, graceful shutdown, tek-process invariant,
`/health` içeriği, pm2 yapılandırması, CI, `.env` durumu, hassas veri log taraması, yedek/arşiv
politikaları — hepsi ölçülmüş ve gerekçelendirilmiş. Bu iki belge planın omurgası olabilir.

Eksik — üçü de **yokluk** tespiti ve **hiçbir belgede geçmiyor**:
1. **Correlation / request ID YOK.** Ölçüm: `request-id|correlation|traceId|x-request-id`
   → `src/` genelinde **0 eşleşme**. 500 uçlu, tek-process, `morgan combined` bir sistemde bir
   HTTP log satırını `SystemLog` audit satırına ya da bir `console.error`'a bağlamanın yolu yok.
   Doc 05 §7.5 "bozuk gövde hiçbir log/metriğe düşmüyor" tespitini yaptı — bu onun genel hâli.
2. **Yapılandırılmış log YOK.** `pino|winston|bunyan|log4js` → 0. Üretim gözlemi
   **78 `console.*` çağrısı** + morgan metnine dayanıyor. Doc 08 78'i saydı ama sonucu
   ("log yapılandırılmamış, makine tarafından ayrıştırılamaz") çıkarmadı.
3. **Dış izleme/alarm yüzeyi YOK.** `opentelemetry|prom-client|prometheus|statsd|sentry` → 0.
   İç çözümler var (`EndpointLatencyDaily`, `/health`, `SystemLog`) ama dışarı **push** eden
   hiçbir şey yok → doc 07'nin "arşiv işi sessizce çalışmıyor olabilir" ve doc 08'in
   "backend healthcheck yok" maddeleri bu boşluğun semptomları.

---

## 5. "Çok kiracılılık ve izolasyon" bu projede anlamlı mı?

**Klasik anlamıyla HAYIR — ve bu varsayım değil, ölçüm.**

| Sonda | Sonuç |
|---|---|
| `Tenant` / `Organization` / `Company` / `Firm` / `Site` / `Plant` / `Factory` modeli | **0** (`grep -nE '^model (Tenant\|Organization\|...)' prisma/schema.prisma`) |
| `tenantId` / `companyId` / `organizationId` / `orgId` / `siteId` / `plantId` / `factoryId` alanı | **0** |
| `User` modelinde kapsam alanı (`customerId`/`branchId`/`stationId`/`department`) | **0** — kullanıcı hiçbir müşteriye/şubeye/istasyona bağlanamıyor |
| İzin kataloğunda dış-taraf/portal izni | **0** (67 iznin kategorileri yalnız `web` 46 · `mobile` 18 · `admin` 3) |
| Sorgularda `where: { userId: req.user.userId }` deseni | **0** doğrudan eşleşme (kişisel veri yok) |

`branchId` şemada **4 modelde** var (`Order`, `Shipment`, `DirectShipment`, `Sack`) ama bu
**müşterinin şubesidir** — iç kiracı değil, bir sipariş/sevkiyat hedefidir.
Tek fabrika, tek kiracı, tek veri kümesi; ayrım **yalnız RBAC** ile yapılıyor.

**Ama kategoriyi silme — yeniden çerçevele.** Bu domende "izolasyon" dört gerçek eksende var
ve dördü de denetlenebilir:

### (a) Müşteriler arası bağlam sızıntısı — **denetlenmeli, bugün desen tutarlı görünüyor**

`/api/customers/:customerId/...` altında **4 nested router** var
(`branches`, `aliases`, `template-routes`, `standalone-labels` — `customer.routes.ts:35-41`).
Klasik IDOR sorusu: alt kaydın gerçekten o müşteriye ait olduğu doğrulanıyor mu?
Ölçtüm — **bugün üç desen de doğru**:

- `customer-branch.service.ts:154,210` → `findFirst({ where: { id, customerId } })`
  ve kodda **gerekçesi yazılı** (*"Y başka müşterinin şubesiyse 404"*).
- `customer-alias.service` → composite unique (`customerId_itemId`, `customerId_colorId`) —
  yapısal olarak kapsamlı.
- `customer-template-route` / `customer-standalone-label` → `where: { customerId }` + önce
  `customer.findUnique` doğrulaması.

Denetimin işi bu tutarlılığı **mekanik** doğrulamak (bekçi yok) ve daha yüksek etkili ikinci
yüzeye bakmak: **müşteriye özel etiket/belge yönlendirmesi**
(`CustomerTemplateRoute`, `CustomerStandaloneLabel`, "farklı müşteri için bas").
Yanlış eşleşmenin sonucu bir 403 değil, **A müşterisinin adıyla B'nin malının etiketlenmesidir** —
bu domende çok kiracılılığın gerçek karşılığı budur.

### (b) Dışarı çıkan belgede iç bilgi sızması — **gerçek ve zaten yaşanmış sınıf**

Fason firmalar ve müşteriler sisteme **girmiyor**, ama **belge alıyor** (fason çeki, kabul makbuzu,
sevk irsaliyesi, çuval etiketi). `CLAUDE.md`'nin `Sack.notes` kararı tam bu sınıftır:
*"blocklist yeni kolonu varsayılan GÖRÜNÜR doğurur ve iç not müşteriye giden irsaliyeye sızar"* →
çözüm `DocCol.defaultHidden` allowlist'i. Denetim hedefi: `DocumentConfig` bölüm/kolon
görünürlüğünde **blocklist ↔ allowlist** karışımı başka nerede var. Dokuz belgeden yalnız doc 04
(madde 1) bu civara dokundu, o da izin hizası açısından.

### (c) Cihaz / oturum izolasyonu — **haritalanmadı**

`resolveDevice` (`device.middleware.ts`) `x-device-id` başlığını **auth'tan önce**, imza/doğrulama
olmadan çözüyor; `req.device` 56 yerde, `device.machineId` 21 yerde okunuyor ve
`RollMovement.machineId` üretim atfını buradan alıyor. Varsayılan (`pairingRequired = false`)
**fail-open**: bilinmeyen cihaz bloklanmaz, yalnız `req.device` boş kalır (kodda gerekçeli).
`POST /api/devices/announce` **auth'suz kayıt yaratıyor** (doc 04 ve 07 işaret etti).
Denetim sorusu: bir cihazın başka bir cihazın `deviceId`'sini göndermesi hangi kayıtları
yanlışlar, ve `WorkSession` zorunluluğu (yalnız TABLET/PHONE) bununla nasıl etkileşir.

### (d) Kullanıcı kendi verisi — **küçük ve bugün doğru**

`UserPreference` `getMine`/`updateMine` ile `userId`'den çözülüyor (servis `userId` parametreli).
`WorkSession` `force-close` başkasının oturumunu kapatıyor ve tek kapısı `admin:settings`
(doc 04 madde 13 asimetriyi işaret etti). Sistemde kişisel veri olmadığı için "kendi kaydım"
filtresi gerekmiyor — bu doğru bir tasarım kararı, boşluk değil.

**Öneri:** denetim planında bu kategori **"Taraf izolasyonu ve bağlam sızıntısı"** adıyla dursun,
"çok kiracılılık" adıyla değil. Aksi halde kategori "N/A" diye kapatılır ve (a)+(b)+(c) hiç
bakılmadan geçer — oysa (b) bu projede **kanıtlanmış** bir hata sınıfıdır.

---

## 6. Denetim planına eklenmesi gereken sondalar (öncelik sırasıyla)

Her madde: *ne bakılacak · neden · nasıl ölçülür*.

| # | Sonda | Gerekçe | Ölçüm |
|---|---|---|---|
| 1 | **Zod `z.object` sessiz anahtar düşürme taraması** (178 şema) | Kök `CLAUDE.md`'de **iki kanıtlanmış canlı vaka**; hiçbir yüzey haritası saymadı | Her request şeması için: istemci sözleşmesindeki anahtar kümesi ⊆ şema anahtarları mı; `strictObject`'e geçmenin kırdığı yer var mı |
| 2 | **`src/utils/` altı dosya** (909 satır, fan-in 75/25/17/15/14/6) | `buildWhereClause`/`readIdCondition`/`cursor` — filtre, sıralama, sayfalama ve hata sözleşmesinin tamamı burada; **hiç açılmadı** | Dosya dosya okuma + `MAX_OFFSET`, `sortNullable`, CSV `in` dönüşümü, `AppError.details` tipinin uçtaki karşılığı |
| 3 | **Controller katmanı** (22 dosya / 6.714 satır) | `print-event` 500 vakası bu katmanda aylarca yaşadı; iki bağlama konvansiyonu yan yana, bekçi yok | Her controller metodunun route'tan gerçekten çağrılabildiğini doğrulayan mekanik kontrol (route stack + `bind`/arrow) |
| 4 | **Kural kopyası envanteri** (`reports/` + `accounting-export` + liste yüzeyleri) | Doc 01 §5.9 izolasyonu gösterdi, kopya **sayılmadı**; `CLAUDE.md`'nin en sık tekrarlanan hata sınıfı | `K18_DEAD_STATUSES`, brüt iade geri-eklemesi, `producedOutputWhere`, `factoryDaySql` için kaç bağımsız uygulama var |
| 5 | **`updateMany` claim/toplu ayrımı** (~117 denetimsiz çağrı) | Doc 06 açık bıraktı; `CLAUDE.md` atomik claim'i **zorunlu** kılıyor | Her `updateMany`'i "durum geçişi mi" diye sınıfla; geçişse `count===0 → 409` var mı |
| 6 | **Sınırsız sorgu + N+1 taraması** (427 `findMany` / 106 `take:` / 454 döngü) | Üretim yüzbinlerce satıra çıkacak (perf kuralı 5 ve 9) | Tavanı olmayan liste uçları; döngü içinde Prisma çağrısı yapan yollar |
| 7 | **`as unknown as` + `Json` sınırı** (73 cast / 20 Json kolonu) | Tip güvenliği burada kayboluyor; cast'lerin çoğu **donmuş resmi belge** snapshot'ında | Her cast için: okunan JSON'un şeması runtime'da doğrulanıyor mu, yoksa yalnız derleyici mi susturuluyor |
| 8 | **OpenAPI ↔ gerçek zincir mutabakatı** (414 blok / 500 uç) | Doc 04 kapsam dışı bıraktı; belgesiz uç = sözleşmesiz uç | Uç başına: `@openapi` var mı, `security`/izin yazılanla route zinciri aynı mı |
| 9 | **Correlation-ID / yapılandırılmış log yokluğu** | 0 eşleşme; bir hatayı log'dan audit'e bağlamak imkânsız | Karar: eklenecek mi; eklenmeyecekse hangi teşhis yolu belgelenecek |
| 10 | **Taraf izolasyonu** (§5-a/b/c) | (b) kanıtlanmış hata sınıfı, (c) imzasız `x-device-id` | Nested `:customerId` route'larında kapsam guard'ı bekçisi; `DocumentConfig` blocklist/allowlist karışımı; cihaz taklidi senaryosu |
| 11 | **`config/label-elements.ts`** (606 satır, 5 render yolunun ortak kapısı) | `showIf`/`prepareElements` — fail-closed koşul mantığı; hiç açılmadı | Beş emitter'ın gerçekten `prepareElements`'ten geçtiği; `expandMultilineText`'i doğrudan çağıran yeni yol var mı |
| 12 | **`src/types/` (185 satır)** | `req.user?` opsiyonelliği = fail-open'ın tip ikizi; 2 elle yazılmış ambient `.d.ts` | Guard'sız handler'da `req.user` okuyan kod var mı; `.d.ts`'ler gerçek kütüphane API'siyle uyumlu mu |
| 13 | **`lib/string-validators.ts` (175) + `lib/zod-locale.ts`** | Girdi doğrulama ve Türkçe hata mesajı sözleşmesi; hiç geçmiyor | Doğrudan okuma |
| 14 | **İzin/uç sayımının tek tanıma oturtulması** (§2.5) | Üç belge üç farklı tanımla sayıyor; `CLAUDE.md` dördüncü | `...guard` yayılımını çözen tek tarayıcı; "auth'suz" / "statik izinsiz" / "dinamik izinli" üç ayrı kova |

**Plan hijyeni notu:** doc 01'in §0 tablosundaki enum sayısı yanlış (§2.1) ve §2'deki üç satır
sayısı +1 sapmalı (§2.2). Plan bu tablodan sayı alıntılıyorsa önce düzeltilmeli.

---

## 7. Ölçüm dökümü

Tümü `Teks-Erp/` kökünden, salt-okuma.

| # | İddia | Komut / yöntem |
|---|---|---|
| M1 | 118 dosya / 22.126 satır tam adıyla geçmiyor; dizin kırılımı | `cat audit/surface/0*.md` tek metne alınıp `find src -name '*.ts'` üzerinde `grep -qF <basename>` |
| M2 | Sembol düzeyi kapsama (utils/lib/config/types/constants) | Her dosyanın `^export (const\|function\|class\|interface\|type)` sembolleri çıkarılıp tek tek `grep -lF` ile dokuz belgede arandı; sonuçlar elle doğrulandı |
| M3 | 500 route bildirimi; A/B/C = 141/165/194 | `grep -rhoE "^\s*(router\|[a-zA-Z]+Router)\.(get\|post\|put\|patch\|delete)\(" src/routes` ve dosya bazlı `grep -rcE` |
| M4 | Auth'suz 8, statik izinsiz 15 | Node betiği: parantez-dengeli route ifadesi çıkarımı + dosya içi `const <ALIAS> = [...requirePermission...]` alias çözümü |
| M5 | 46 API mount (+1 `/api` 404 handler) | `grep -n '^app.use("/api' src/app.ts` → 47 satır, 450. satır handler |
| M6 | 85 model / 38 enum / 154 migration | `grep -c '^model '`, `grep -c '^enum '`, `ls -1d prisma/migrations/*/ \| wc -l` |
| M7 | 4 gerçek advisory lock çağrısı (7 grep satırı) | `grep -rn pg_advisory src --include='*.ts'` + satırların yorum/kod ayrımı |
| M8 | 496 rakamı kod kayması değil | `git grep -hoE "router\.(get\|...)\(" <commit> -- 'Teks-Erp/src/routes/**'` üç commit'te (`8fee03b8`, `ef49bbc3`, `HEAD`) → hepsi 500; `git log -S"496 uçtan" -- CLAUDE.md` → `8fee03b8` |
| M9 | Controller bind durumu | Node betiği: `^\s{2}(async )?<ad>\(req` prototip metotları ↔ `this.X = this.X.bind(this)` eşleşmesi. **Heuristik** — statik metotlar ve arrow-property'ler ayrı sayıldı |
| M10 | `z.object` 178 / `strictObject` 1 / `z.any()` 2 / passthrough-catchall 2 | `grep -rho 'z\.object(' src \| wc -l` vb. |
| M11 | `any` 0, `@ts-ignore` 0, `as unknown as` 73, `strict: true` | `grep -rnE ":\s*any[\[\]>,)? ]\|as any\|<any>" src` (0 eşleşme) · `grep -rc 'as unknown as' src` · `cat tsconfig.json` |
| M12 | `findMany` 427 / `take:` 106 / `include:` 275 / `select:` 1.912 / `Promise.all` 75 / döngü 454 | `grep -rho` sayımları |
| M13 | 414 `@openapi`; `res.status` dağılımı; `res.download` 1 | `grep -rho '@openapi' src \| wc -l`; `grep -rhoE "res\.status\([0-9]{3}\)" \| sort \| uniq -c` |
| M14 | Correlation-ID 0 · pino/winston 0 · OTEL/prom/sentry 0 · console.* 78 | `grep -rniE 'request-?id\|correlation\|traceId\|x-request-id' src` vb. |
| M15 | Tenant alanı/modeli 0; `branchId` 4 modelde; `User`'da kapsam alanı yok | `grep -nE '^model (Tenant\|Organization\|Company\|Firm\|Site\|Plant\|Factory)'`; `awk '/^model User \{/,/^\}/'` |
| M16 | Nested müşteri route'larında kapsam guard'ı var | `grep -n customerId src/services/customer-branch.service.ts` (satır 154, 210 `findFirst({id, customerId})`), `customer-alias.service` composite key, `customer-template-route`/`customer-standalone-label` `where:{customerId}` |
| M17 | BaseService'e bağlı 14 model | `grep -rhoE 'modelName: "[a-zA-Z]+"' src \| sort -u` |
| M18 | İzin kataloğu 67 | `grep -c "category:" src/constants/permission-catalog.ts` = 68, biri yorum satırı |
| M19 | 20 rapor ucu `...guard` yayılımı kullanıyor | `grep -n "guard" src/routes/reports/*.ts` |
| M20 | Fan-in ölçümleri (`app-error` 75, `time` 69, `cursor` 25…) | Dosya kökü adıyla `grep -rl` (kendisi hariç) |
| M21 | quickPin/cardToken düz metin | `src/services/auth.service.ts:235-247` (`getUserCredentials` doğrudan `quickPin`/`cardToken` döndürüyor) |
| M22 | Giden HTTP çağrısı yok; `net`/`child_process` 1'er dosya | `grep -rniE '\b(fetch\|axios\|https?\.request\|node-fetch\|undici)\b' src` → 16 eşleşme, **hepsi yorum**; `grep -rn 'from "net"\|from "child_process"' src` → `device-transport.ts`, `pg-tool.helper.ts` |
