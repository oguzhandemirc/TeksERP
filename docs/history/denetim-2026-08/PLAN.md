# TeksERP Backend — Derinlemesine Mühendislik Denetimi: Yürütme Planı

Tarih: 2026-08-09 · Hedef: `Teks-Erp/` (Node.js 22 + Express 5.2.1 + Prisma 7.7 + PostgreSQL 16.9)
Durum: **PLANLAMA TAMAM — denetim BAŞLAMADI.** Onay bekliyor.

Bu belge, denetimi **oturumlara bölünmüş** biçimde tarif eder. Her hücre tek oturumda biter ve
kendi promptunu taşır. Model belleği yerine `audit/FINDINGS.jsonl` defteri kullanılır.

---

## 0. Dosya haritası (sonraki oturumlar için)

| Yol | İçerik |
|---|---|
| `audit/PLAN.md` | Bu dosya. Hücre matrisi + oturum promptları |
| `audit/SCHEMA.md` | Defter şeması ve yazım kuralları |
| `audit/FINDINGS.jsonl` | Bulgu defteri (append-only, şu an BOŞ) |
| `audit/raw/_OZET.md` | Adım 1 mekanik taban özeti |
| `audit/raw/_GUARD-BASELINE.md` | 500 ucun auth/izin guard kapsaması (doğrulanmış) |
| `audit/raw/*.out` / `*.err` | Ham araç çıktıları — **context'e alma**, `grep`/`jq` ile sorgula |
| `audit/surface/01..09*.md` | Yüzey haritası (9 belge, ~3.700 satır) |
| `audit/surface/10-tamlik-elestirisi.md` | Dokuz belgenin denetimi: kapsanmayan `src/` yüzeyi, sayısal çelişkiler, kategori olgunluğu |

**Kural:** oturum başında yalnız kendi hücresinin "okunacaklar" listesini oku. Ham çıktıları ve
route envanterlerini bütün olarak context'e alma; hedefli `grep` yap.

---

## 1. Ölçüm tabanı

Tüm sayılar komut çıktısına dayanır (yöntem: `audit/raw/_OZET.md` ve her yüzey belgesinin son bölümü).

| Ölçü | Değer |
|---|---|
| `src/` TS dosyası / satır | 271 / **103.727** |
| `prisma/schema.prisma` | 3.721 satır · **85 model** · **38 enum** · 208 `@@index` |
| Migration | **154** (`migration_lock.toml` migration değildir) |
| `scripts/` (bekçi + araç) | 312 dosya / 68.884 satır · bunların **273'ü** `test_*.ts` |
| Test → gerçek DB yazımı | 273 testin **235'i** `src/lib/prisma` import ediyor · **1.539 `deleteMany`** · ortam guard'ı taşıyan test: **0** |
| **Denetim kapsamı toplamı** | ~**176.332** satır |
| Route handler | **500** (iki bağımsız yöntemle uzlaştırıldı) |
| `$transaction` gerçek çağrı | **115** (111 interactive, 2 batch-array, 2 arrow) |
| `updateMany` | 225 · bunların ~108'i sonuç sayısını denetliyor |
| Ham SQL | 65 (`$queryRawUnsafe` 1, `Prisma.raw` 2) |
| Advisory lock | 4 çağrı, 2 namespace uzayı |
| **Instance sayısı** | **1** (`exec_mode: "fork"`, `instances: 1`) |
| Commit (12 ay = tüm proje geçmişi) | 632 · ilk commit 2026-04-17 |

Brief "~200.000 satır" diyordu; ölçülen 176.332. Fark `Electron/` ve `mobil/` alt projelerinden
geliyor ve bunlar Express API denetiminin **kapsamı dışında**.

### Yüzey belgelerindeki düzeltilmiş sayılar (bu plan doğrusunu kullanır)

Yüzey haritası dokuz paralel ajanla üretildi ve ana oturumda çapraz kontrol edildi.
Üç sayısal hata bulundu ve düzeltildi. **Sonraki oturumlar aşağıdaki doğruları kullanmalı:**

| Konu | Yüzey belgesindeki değer | **Doğrusu** | Nasıl doğrulandı |
|---|---|---|---|
| Prisma enum sayısı | `01` §0: **28** | **38** | `grep -cE '^enum ' schema.prisma` (belge `06` §1.1 de 38 diyor — `01` yanlış) |
| ≥1000 satırlık servis toplamı | `01` §5.15: 40.976 / %53,2 | **42.176 / %54,7** | `find src/services -name '*.ts' -exec wc -l {} + \| awk '$1>=1000'` |
| Migration sayısı | Brief: 155 | **154** | `ls -1d prisma/migrations/*/ \| wc -l`; 155 girdinin biri `migration_lock.toml`. DB `_prisma_migrations` tablosu da 154 diyor |

Ayrıca `07` §7 "login uçları `login-lockout` middleware'i ile korunuyor" diyor — **eksik ifade**.
Ana oturumda doğrulandı: kilit yalnız `loginCard` ve `loginQuickPin`'de; klasik
`AuthController.login` (satır 86-147) `reserveLoginAttempt` **çağırmıyor**.
Bu, C1 (KIM.guvenlik) oturumunun başlangıç noktasıdır.

### Mekanik taban sonuçları

| Araç | Sonuç |
|---|---|
| `madge --circular` | **14 döngü** — 13'ü etiket/belge alt sisteminde, 1'i `workorder ↔ workorder-batch-drop` |
| `jscpd` | %**1,63** kopya (50 klon / 1.691 satır) — düşük |
| `ts-prune` | 41 gerçek ölü export |
| `depcheck` | 1 kullanılmayan devDependency |
| `npm audit` | **12 açık**: 0 critical / **4 high** / 7 moderate / 1 low; 3'ü doğrudan bağımlılık |
| `knip` | **YAPILANDIRILDI** — `Teks-Erp/knip.json` yazıldı, yeniden koştu: 0 unused file · **19 unused export** · 3 unused type. 19'un **12'si BLG'de** (madge ve jscpd ile aynı yeri işaret ediyor) |
| `eslint` | 0 bulgu — **ama yalnız 2 kural aktif** (aşağıya bak) |
| `semgrep` | 0 bulgu — **ama TS'e uygulanabilen yalnız 78 kural koştu** (aşağıya bak) |

**İki "temiz" sonucun ikisi de yanıltıcıdır ve bu planın dayanaklarındandır:**

- **ESLint** bilinçli olarak minimaldir (`eslint.config.mjs` yorumu: *"bu config bir formatter değil,
  bir guardrail"*). Aktif kural: (1) tx client üzerinde `Promise.all` yasağı, (2) route/controller'da
  `lib/prisma` import yasağı. `no-floating-promises`, `no-misused-promises`, `require-await`,
  `no-explicit-any` **kapalı**. Yani lint katmanında async disiplini yok.
- **semgrep** 561 kuraldan TS'e uygulanabilen 78'ini koştu (%100 parse, 0 hata). Doğru okuma:
  "bu 78 desende eşleşme yok", "güvenlik açığı yok" değil.

**Buna karşılık tip disiplini gerçekten güçlü ve bu skorlamada savunma olarak sayılmıştır:**
`strict: true`, tüm `src/` içinde **10 adet `any`**, **0 adet `@ts-ignore`/`@ts-expect-error`**.

### Değişim sıklığı (hata yoğunluğunun vekili) — modül bazında

Repo 4 aylık olduğu için 12 aylık pencere = tüm geçmiş. Silinmiş dosyalara giden churn (112) hariç.

| Modül | Churn | Pay | Modül | Churn | Pay |
|---|---|---|---|---|---|
| BLG | **457** | %21,9 | ENV | 133 | %6,4 |
| URE | 198 | %9,5 | SIP | 127 | %6,1 |
| CORE | 193 | %9,3 | KIM | 122 | %5,9 |
| IST | 184 | %8,8 | TAN | 108 | %5,2 |
| SEV | 174 | %8,3 | DON | 36 | %1,7 |
| FAS | 160 | %7,7 | RAP | 36 | %1,7 |
| OPS | 153 | %7,3 | | | |

En çok değişen 7 dosya: `workorder.service`(69) · `subcontractor.service`(64) ·
`inventory.service`(64) · `shipping.service`(60) · `tambur.service`(59) ·
`system-setting.service`(48) · `order.service`(48).

---

## 2. Modül tablosu

Sınıflama anlam esaslıdır ve 152 servis dosyasının tamamı atanmıştır (atanmamış yok).
`CORE`, servis dosyası olmayan altyapı katmanını (+ jenerik CRUD çekirdeği) temsil eder.

| ID | Modül | Servis satırı | Route satırı | Ctrl satırı | Ana modeller | Not |
|---|---|---|---|---|---|---|
| **BLG** | Belge / Etiket | **16.527** (61 dosya) | 2.202 | 1.446 | LabelTemplate · PrintedDocument · TravelerCard | Kod tabanının en büyük context'i; 3 alt-sistem (etiket motoru, kâğıt belge, refakat kartı); 5 render yolu |
| **URE** | Üretim / İş Emri | **11.719** (16) | 1.042 | 943 | WorkOrder · Batch · Roll | `workorder.service.ts` 6.073 satır (en büyük dosya) |
| **IST** | İstasyon (Tambur + Kurşun/KK2) | **9.783** (8) | 1.515 | 1.086 | Roll · RollMovement · WorkOrderStep · RollError | `tambur.finalize` tek fonksiyonda 377 satırlık tx |
| **FAS** | Fason + Kartela | **8.244** (4) | 1.226 | 924 | SubcontractorDispatch · Receipt · Swatch | Dosya başına 2.061 satır — en yoğun; `subcontractor.service.ts` 6.055 |
| **OPS** | Sistem / Ops | **6.889** (14) | 1.968 | 0 | SystemSetting · SystemLog | Controller katmanı YOK; `admin.routes.ts` 1.293 satır iş mantığı taşıyor |
| **CORE** | Çekirdek / HTTP katmanı | ~**6.459** | — | 112 | — | `app.ts` 462 · `middlewares/` 1.067 · `base.service` 838 · `utils/` 909 · `config/` 1.372 · `lib/` 581 · `jobs/` 646 |
| **SEV** | Sevkiyat / Çuval / İade | **6.123** (7) | 561 | 661 | Sack · Shipment · RollReturn | `shipping.service.ts` 24 `$transaction` (tek dosya rekoru) |
| **ENV** | Envanter / Top | **4.697** (5) | 865 | 595 | Roll · RollMovement | Tek dosyada 4.319 satır |
| **SIP** | Sipariş / Müşteri | **4.083** (7) | 1.343 | 101 | Order · OrderLine · Customer | |
| **KIM** | Kimlik / Yetki / Oturum | **3.218** (8) | 285 + admin.routes yarısı | 846 | User · Session · Device · Permission | |
| **TAN** | Tanım / Master Data | **2.514** (8) | 2.093 | — | Item · Color · Station | 6 model kendi servisi olmadan jenerik CRUD ile yönetiliyor |
| **RAP** | Rapor / Dashboard | **1.780** (9) | 504 | 0 | (ham SQL/aggregate) | Domain servislerini **hiç import etmiyor** → kural kopyası riski |
| **DON** | Donanım / Çevre birim | **652** (4) | 187 | 0 | PeripheralDevice · Machine | RAW TCP yazıcı; varsayılan simüle |

### Modül tablosunun söylediği üç şey

1. **Ağırlık merkezi BLG + URE + IST + FAS = 46.273 satır**, servis katmanının **%60'ı**.
2. **16 dosya ≥1000 satır ve toplamları 42.176 satır** = servis katmanının (77.067) **%54,7'si**.
   Denetim eforu dosya sayısına değil bu 16 dosyaya gitmeli.
   (Yüzey belgesi 01 §5.15 bu toplamı 40.976 / %53,2 yazıyor — **yanlış**; ana oturumda
   `find … -exec wc -l` ile yeniden ölçüldü, doğrusu 42.176 / %54,7.)
3. **`Roll` modeli 11 context'in 11'inde okunuyor/yazılıyor** (322 delegate erişimi, 86 alan,
   21 index). Top yaşam döngüsünün **tek sahibi yok** — bu, planın en kesişen riski.

---

## 3. Risk skorlaması

Beş boyut, her biri 1-5. **Mevcut savunma ters etkilidir**: tabloda savunma seviyesi yazılır,
toplam risk hesabına `(6 − savunma)` olarak girer. Toplam 5-25 arası.

Boyutların dayanakları:
- **Blast radius:** bozulursa kaybedilen (para / veri / erişim / üretim durması).
- **Değişim sıklığı:** §1'deki churn ölçümü. Eşik: ≥400→5 · 170-399→4 · 120-169→3 · 60-119→2 · <60→1.
- **Eşzamanlılık yüzeyi:** `$transaction` adedi + tx gövde uzunluğu + `updateMany` claim'leri +
  advisory lock + döngü içinde yazma + paylaşılan sayaç kilidi.
- **Mevcut savunma:** bekçi script sayısı (273 script modüle eşlendi) + tip disiplini (tüm modüllerde
  eşit ve güçlü) + validation + kodda yazılı invariant'lar.
- **Mekanik sinyal:** madge döngüleri + jscpd klon yoğunluğu + ts-prune ölü export.

**Savunma sütununun dayanağı (ölçüldü, yüzey belgesi 09):** 273 bekçi script'inin modüllere
dağılımı ve büyük servislerin "testlerde hiç adı geçmeyen public metot" oranı.
Bin servis satırı başına test yoğunluğu: KIM 7,1 · TAN/DON 5,7 · FAS 4,4 · OPS 4,1 · ENV 3,8 ·
SEV 3,6 · BLG 3,4 · URE 3,4 · SIP 2,7 · **IST 1,9** · **RAP 1,1**.
Metot kapsama açığı: `kartela` %46 · `permission-management` %42 · `label` %40 ·
`label-template` %40 · `printed-document` %40 · `shipping` %33 · `workorder` %32.

| Modül | Blast | Değişim | Eşzaman. | Savunma | Mekanik | **Risk** | Skorun gerekçesi (en belirleyici olgu) |
|---|---|---|---|---|---|---|---|
| **BLG** | 4 | 5 | 3 | 3 | 5 | **20** | 14 döngünün 13'ü burada; 32 klon ucu; 16.527 satır; churn %21,9; `label.service` metotlarının %40'ı testlerde hiç geçmiyor |
| **IST** | 4 | 4 | 5 | 3 | 3 | **19** | `finalize` 377 satır tx + döngüde 200'e kadar kesim + tx boyu tutulan global barkod sayacı kilidi; **test yoğunluğu en düşük ikinci (1,9/1000)** |
| **SEV** | 5 | 4 | 5 | 3 | 2 | **19** | 24 `$transaction` + 46 `updateMany`; para/irsaliye/fatura; `shipping` metotlarının %33'ü testsiz |
| **URE** | 4 | 4 | 5 | 4 | 4 | **19** | 6.073 satırlık tek dosya; parti no advisory lock; `withBarcodeRetry` tüm tx'i replay ediyor |
| **FAS** | 5 | 3 | 5 | 3 | 3 | **19** | 354/315/312 satırlık üç tx, üçü de belge dondurma içeriyor; mal fiziksel olarak fabrika dışında |
| **CORE** | 5 | 4 | 3 | 2 | 2 | **18** | Her istek buradan geçer; rate limit YOK; middleware sırası hiçbir testte kilitli değil; `headersSent` kontrolü 0 |
| **ENV** | 5 | 3 | 4 | 3 | 2 | **17** | Stok doğruluğu = envanter değeri; KK1 advisory guard'ında geçmiş TOCTOU hatası var |
| **OPS** | 5 | 3 | 4 | 3 | 2 | **17** | Yedek/geri yükleme/db-copy = veri kaybı yolu; `.env` git'te; offsite yedek dizini BOŞ; test paketi ortam guard'sız |
| **KIM** | 5 | 3 | 4 | 2 | 1 | **17** | Erişimin tamamı; klasik `/login`'de brute-force kilidi YOK (doğrulandı); rate limit yok; `permission-management` metotlarının %42'si testsiz |
| **SIP** | 4 | 3 | 3 | 3 | 1 | **14** | Sipariş = müşteri taahhüdü; `order.service` 2.819 satır, 6 tx |
| **TAN** | 3 | 2 | 2 | 3 | 1 | **11** | Master data guard'lı; 6 model jenerik CRUD ile, kendi servisi yok |
| **RAP** | 2 | 1 | 1 | **1** | 1 | **10** | Salt-okuma ama **domain kurallarını kopyalıyor** ve **yalnız 2 bekçisi var** (kod tabanındaki en düşük yoğunluk) |
| **DON** | 2 | 1 | 2 | 2 | 1 | **10** | Varsayılan simüle; açıkken RAW TCP hedefi veriden geliyor |

Test ölçümü BLG, IST ve SEV'in savunmasını 4'ten 3'e indirdi (metot kapsama açıkları).
Sıralama değişti ama **P0 kümesi değişmedi** — bu üç modül zaten P0 taşıyordu.

### Skorlamanın üç sürprizi (denetimin yönünü değiştiren)

1. **`instances: 1` (fork mode) doğrulandı.** Bu, dağıtık yarış riskini **düşürür** ama
   yerine iki başka riski birinci sıraya taşır: (a) tek process düşerse sistem durur —
   `res.download` + `headersSent` boşluğu tam da bu yolu açıyor; (b) 9+ modül bellek-içi durum
   tutuyor ve `instances` yanlışlıkla artırılırsa **hata vermeden yanlış davranır**.
   Bu yüzden CORE.OPS ve CORE.VER P0'a çıktı, "cluster'da yarış" temalı hücreler ise `atla` oldu.
2. **Çok kiracılılık YOK** (`tenantId`/`companyId` şemada hiç geçmiyor, doğrulandı). "Çok kiracılılık
   ve izolasyon" kategorisi bu kod tabanında **yeniden yorumlandı**: RBAC kapsamı + cihaz/oturum
   bağlama + **belgeye iç veri sızması** (müşteriye giden irsaliyede iç çuval notu gibi).
   Bu haliyle kategori boş değil, ama yalnız KIM ve BLG'de anlamlı.
3. **Tip güvenliği neredeyse her modülde çözülmüş.** 103.727 satırda 10 `any`, 0 `@ts-ignore`,
   `strict: true`. Bu kategori tek bir yerde (CORE) P2, kalan 12 modülde `atla`.
   Denetim eforunu buraya harcamak israf olur.

---

## 4. Hücre matrisi

13 modül × 9 kategori = 117 hücre. Kategoriler: **ESZ** eşzamanlılık · **MIM** mimari/SOLID ·
**GUV** güvenlik · **VER** veri/performans · **DOG** doğruluk · **API** API sözleşmesi ·
**TIP** tip güvenliği · **IZO** izolasyon · **OPS** ops/gözlemlenebilirlik.

| Modül | ESZ | MIM | GUV | VER | DOG | API | TIP | IZO | OPS |
|---|---|---|---|---|---|---|---|---|---|
| **CORE** | P1 | P2 | **P0** | **P0** | P2 | **P0** | P1 | atla | **P0** |
| **BLG** | P2 | **P0** | P1 | P1 | P1 | P2 | atla | P1 | atla |
| **URE** | **P0** | P1 | P2 | P1 | P1 | P2 | atla | atla | P2 |
| **IST** | **P0** | P2 | P2 | P1 | P1 | P2 | atla | atla | atla |
| **FAS** | **P0** | P1 | P2 | P1 | P1 | P2 | atla | atla | atla |
| **SEV** | **P0** | P2 | P2 | P1 | **P0** | P2 | atla | atla | atla |
| **ENV** | P1 | P2 | P2 | P1 | P1 | P2 | atla | atla | atla |
| **OPS** | P1 | P2 | P1 | **P0** | P2 | atla | atla | atla | P1 |
| **KIM** | P1 | atla | **P0** | P2 | P2 | P2 | atla | P1 | P2 |
| **SIP** | P2 | P2 | atla | P1 | P1 | P2 | atla | atla | atla |
| **TAN** | atla | P2 | P2 | P2 | P2 | P2 | atla | atla | atla |
| **RAP** | atla | P2 | P2 | P1 | P1 | atla | atla | atla | atla |
| **DON** | atla | atla | P1 | atla | P2 | atla | atla | atla | atla |

**Dağılım:** P0 = **12** (sınıra tam oturuyor) · P1 = **28** · P2 = **35** · atla = **42**.
Toplam 117 hücrenin tamamı atandı (satır bazında sayım doğrulandı).

### Tamlık eleştirisi sonrası yapılan üç değişiklik (§10'daki belge 10)

Onuncu ajan dokuz yüzey belgesini denetleyip **`src/`'in %21,3'ünün (118 dosya / 22.126 satır)
hiçbir belgede adının geçmediğini** ölçtü. Beş boşluğun ikisi planı değiştirdi:

1. **`CORE.API` P1 → P0.** Sebep: **controller katmanı (22 dosya / 6.714 satır) hiçbir yüzey
   belgesinde açılmadı** ve projenin kanıtlanmış en pahalı sessiz hata sınıfı orada yaşadı
   (`POST /traveler-cards/:id/print-event` controller `bind`'ı eksik → **2026-08-05'ten
   2026-08-06'ya kadar her çağrıda 500**, servis-katmanı bekçileri göremedi).
   ⚠️ **Eleştiri bir noktada bayat:** o vakadan sonra `scripts/test_controller_binds.ts`
   yazıldı (137 satır, körlük zeminli, iki bağlama konvansiyonunu da tanıyor) — yani
   **bind kuralının artık mekanik bekçisi VAR**. P0 gerekçesi bind değil, katmanın
   geri kalanının (girdi doğrulama yeri, yanıt zarfı, `DOC_PERMISSIONS`'ın handler içi çözümü)
   hiç denetlenmemiş olması.
2. **`ENV.eszamanlilik` P0 → P1.** Sebep: bu hücrenin çekirdek riski (KK1 advisory lock TOCTOU)
   **zaten bulundu, düzeltildi ve negatif sondayla doğrulanmış bir bekçiyle kilitlendi**
   (`test_kk1_duplicate_guard.ts`: 5 eşzamanlı giriş → 1 geçer + 4×409; kilit silinince 3 geçiyor).
   Beş eşzamanlılık P0'ı arasında **en iyi savunulanı** buydu. Skorlamayı sıkılaştırma kuralı
   (P0 ≤ 12) burada uygulandı.
3. **`CORE.tip-guvenligi` P2 → P1.** Sebep: tip güvenliğini yalnız `any` sayısıyla ölçmek eksikti.
   `types/express-augment.ts` `req.user`'ı **opsiyonel** yapıyor — bu, `verifyToken`'ın fail-open
   deseninin **tip tarafındaki ikizi** ve guard'sız bir handler `undefined` okurken TypeScript
   uyarmıyor. Ayrıca `bwip-js.d.ts` ve `opentype.d.ts` **elle yazılmış ambient declaration**;
   yanlışlarsa `strict: true` korumaz ve ikisi de barkod/etiket render yolunda.

**Değiştirilmeyen bir eleştiri:** belge 10 advisory lock sayısında "4 mü 6 mı" çelişkisi bildirdi.
Ana oturumda çözüldü: **4 gerçek çağrı** (`inventory:796`, `batch:125`, `session-registry:63`,
`permission-management:584`); kalan 2 eşleşme `duplicate-guard.helper` ve `batch.service`
içindeki **yorum satırları**. Bu planın §1 tablosu (4) doğrudur.

### `atla` kararlarının gerekçesi (sessizce atlamamak için)

- **TIP sütunu (12 modülde atla):** ölçüldü — 10 `any`, 0 `@ts-ignore`, `strict: true`.
  Modül bazlı tip denetimi yapacak malzeme yok. CORE'da P2 kalıyor çünkü orada üç somut kaçış var:
  `BaseService`'in `Prisma as unknown as {...}` DMMF cast'i, `types/express-augment.ts`'teki
  `no-empty-interface` disable'ı, ve `AppError.details: Record<string, unknown>`.
- **IZO sütunu (11 modülde atla):** çok kiracılılık yok; domain modüllerinde izole edilecek
  kiracı sınırı yok. Yalnız KIM (RBAC/cihaz kapsamı) ve BLG (belgeye iç veri sızması) anlamlı.
- **RAP.ESZ / TAN.ESZ / DON.ESZ:** RAP salt-okuma ve `$transaction` kullanmıyor;
  TAN'ın CRUD'u `BaseService` üzerinden ve transaction'sız (bu gerçeğin kendisi CORE.VER'in konusu);
  DON'da TCP I/O hiçbir tx içinde koşmuyor (doğrulandı).
- **BLG.OPS / IST.OPS / SEV.OPS vb.:** gözlemlenebilirlik bu kod tabanında modül bazlı değil,
  merkezî (`latency.middleware`, `/health`, `AuditService`). Hepsi CORE.OPS'ta toplanıyor.
- **DON.VER / DON.ESZ:** varsayılan simüle mod; ölçülecek gerçek yük yok.

---

## 5. P0 listesi ve neden P0 oldukları

Her hücrenin yanında onu P0 yapan **somut, ölçülmüş** olgu var. Sezgi yok.

| # | Hücre | Neden P0 | Skill | ~Dosya | ~Oturum |
|---|---|---|---|---|---|
| 1 | **CORE.GUV** | 500 ucun tamamında `verifyToken` **route başına** takılı, `router.use` ile toplu koruma YOK → yeni route'ta unutulursa uç **sessizce public** olur; bu invariant'ın **mekanik bekçisi yok**. Ayrıca `BaseService.safeFilters` allowlist'i modelin **tüm kolonları** → gizli kolon eşitlik-probe'u. Rate limit hiç yok. | express-api-audit | ~15 | 1 tam |
| 2 | **CORE.VER** | **115 transaction'ın 115'i** tek global bütçeyi paylaşıyor (`maxWait 5s`, `timeout 20s`), per-call override **hiç yok**; en uzun tx 377 satır. `roll_barcode_counters` gün+tip başına **tek satır** ve kilit tx boyunca tutuluyor → sistem genelinde top yaratmanın serileşme noktası. Her istekte auth+device için **2-3 DB round-trip**, cache yok. | express-api-audit | ~10 | 1 tam |
| 3 | **CORE.OPS** | `headersSent` kontrolü **tüm `src/` içinde 0** ve tek akış yanıtı `res.download` callback'siz (`admin.routes.ts:1225`) → aktarım ortasında hata = error handler'da `ERR_HTTP_HEADERS_SENT`; **tek process** olduğu için bu bir kullanılabilirlik riski. Bozuk JSON/413 istekleri **ne log'a ne metriğe** düşüyor. Bilinmeyen Prisma kodu → 400 + audit yok. Kapanış 5 sn ↔ tx 20 sn uyumsuz. Middleware sırası **hiçbir testte kilitli değil**. | code-review-skill | ~8 | 1 tam |
| 4 | **KIM.GUV** | **Doğrulandı:** `AuthController.login` (satır 86-147) `reserveLoginAttempt` **çağırmıyor** — klasik kullanıcı adı/şifre girişinde brute-force kilidi yok (kilit yalnız kart + hızlı-PIN'de). Rate limit yok. CORS `Access-Control-Allow-Origin: *`, origin allowlist yok. `GET /api/auth/mobile-users` kimlik doğrulamasız kullanıcı listesi döndürüyor. 1-argümanlı advisory lock uzayını `session-registry` ile `permission-management` paylaşıyor. | express-api-audit | ~12 | 1 tam |
| 5 | **OPS.VER** | **Doğrulandı:** `Teks-Erp/.env` git'te **izleniyor** (3 commit, GitHub'a push edilmiş) ve `DATABASE_URL` + `JWT_SECRET` taşıyor. `BACKUP_OFFSITE_DIR` **boş** → tüm yedekler DB ile aynı diskte. pm2 log rotasyonu yok (varsayılan). `runTool` (`pg_dump`/`pg_restore`/`psql` spawn) **timeout'suz**; asılı dump `running` bayrağını 3 saat tutar, retry yok, damga işin başında yazıldığı için o gün yedek **hiç alınmaz**. | express-api-audit | ~10 | 1 tam |
| 6 | **SEV.ESZ** | Tek dosyada **24 `$transaction` + 46 `updateMany`** (ikisi de kod tabanı rekoru). `performDispatchTx` içinde belge dondurma (`freezeForSource`) koşuyor. Storno (`undoDispatch`) `preShipStatus` snapshot'ıyla geri sarıyor. Blast radius = para. | express-api-audit | ~6 | 1 tam |
| 7 | **FAS.ESZ** | Üç dev transaction: `dispatch` **354 satır**, `executeDirectShip` **315**, `receive` **312** — üçü de belge dondurma ve/veya ham SQL içeriyor, ikisi döngüde yazma yapıyor. Mal fiziksel olarak fabrika dışında; yanlış durum = kayıp mal. | express-api-audit | ~5 | 1 tam |
| 8 | **IST.ESZ** | `tambur.finalize` **377 satırlık** tek tx; içinde `for (const seg of segments)` ile segment başına `generateRollBarcode` + 3 create → Zod tavanı **200 kesim** = en kötü 800-1200 round trip, 20 sn bütçe içinde, üstelik **global barkod sayacı kilidi elde**. | express-api-audit | ~6 | 1 tam |
| 9 | **URE.ESZ** | Parti no üretimi advisory lock (ns 8022) + `P01…P99` **sarma** (benzersizlik kaldırıldı). `withBarcodeRetry` 73 yerde ve P2002'de **tüm transaction'ı** yeniden koşuyor → yan etkilerin idempotent olup olmadığı açık soru. `workorder.service` 9 tx / 25 `updateMany` / `replace` 305 satır. | express-api-audit | ~8 | 1 tam |
| 10 | **CORE.API** | **Controller katmanı (22 dosya / 6.714 satır) hiçbir yüzey belgesinde açılmadı** — 13'ünün adı hiç geçmiyor. Projenin kanıtlanmış en pahalı sessiz hata sınıfı orada yaşadı (`print-event` bind eksikliği → 3 gün boyunca her çağrıda 500; servis bekçileri kördü). İki bağlama konvansiyonu yan yana. `DOC_PERMISSIONS` izin çözümü **handler içinde**, route'ta görünmüyor. `utils/app-error.ts` fan-in **75** — `audit.service`'in 50'sinden yüksek, yani "hub servisleri" tablosu bile eksikti. | code-review-skill | ~25 | 1 tam (dar kapsam) |
| 11 | **SEV.DOG** | "Sevk rakamı brüttür" kuralı **beş ayrı yüzeye** elle uygulanmış (fiş, liste, Excel, sevkiyat detayı, belge üreticisi) ve her biri ayrı bir saha vakasından sonra eklenmiş. Kaynak `RollReturn` geri-eklemesi, snapshot değil. Altıncı bir yüzey (`sack-search`, çuval etiketi yeniden basımı) **hâlâ canlı okuyor** ve bilinçli olarak kapsam dışı bırakılmış. | code-review-skill | ~8 | 1 tam |
| 12 | **BLG.MIM** | **14 madge döngüsünün 13'ü burada.** 16.527 satır, 61 dosya, 5 render yolu (PPLA/PPLB/ZPL/kanvas/raster). 32 jscpd klon ucu (930 satır). `helpers/` altındaki 27 dosya aslında BLG'nin motoru. `document-render/*.html.ts`'in 8'i `printed-document.service`'i doğrudan import ediyor → "saf renderer" değil. Tip sözleşmesi (`LabelPayload`) 1.985 satırlık servisin içinde yaşıyor ve 20 dosya `import type` ile ona bağlı. | code-review-skill | ~20 | 1 tam (dar kapsam) |

**P0 kategorisi dağılımı:** eşzamanlılık 4 · güvenlik 2 · veri/performans 2 · API sözleşmesi 1 ·
ops 1 · doğruluk 1 · mimari 1.

**`ENV.eszamanlilik` neden P0 DEĞİL** (tamlık eleştirisi sonrası, P0 ≤ 12 kuralı gereği):
bu hücrenin çekirdek riski olan KK1 advisory lock TOCTOU hatası **zaten yaşandı, düzeltildi ve
negatif sondayla doğrulanmış bir bekçiyle kilitlendi** (`test_kk1_duplicate_guard.ts` — 5 eşzamanlı
birebir giriş → 1 geçer + 4×409; kilit silindiğinde 3'ünün geçtiği ölçülmüş). Beş eşzamanlılık
adayı arasında **savunması ölçülebilir biçimde en güçlü olanı** buydu. P1'e indi, kapsamı korundu.

---

## 6. Oturum sırası (bağımlılığa göre)

```
FAZ A — çevre ve sözleşme (kritik yollara girmeden önce zemin)
  A1  CORE.GUV      → guard kapsaması, izin modeli. Sonraki tüm GUV hücreleri buna dayanır.
  A2  CORE.OPS      → hata yolu + gözlemlenebilirlik. Diğer hücrelerin "sessiz hata" iddialarını
                       doğrulayabilmesi için hata yolunun nasıl davrandığı önce bilinmeli.
  A3  CORE.VER      → transaction bütçesi, havuz, sayaç kilidi. TÜM ESZ hücrelerinin ön koşulu.
  A4  CORE.API      → controller katmanı + utils/ sorgu çekirdeği. A1 ve A2'den SONRA
                       (guard modelini ve hata zarfını bilmeden zarf tutarlılığı denetlenemez).

FAZ B — kritik yollar (para, mal, stok) — A3 bittikten sonra, aralarında paralel çalışabilir
  B1  SEV.ESZ       B2  FAS.ESZ       B3  IST.ESZ       B4  URE.ESZ
  B5  SEV.DOG       (B1'den sonra; brüt kuralı sevk tx'ini bilmeyi gerektirir)

FAZ C — kimlik ve altyapı güvenliği
  C1  KIM.GUV       (A1'den sonra)
  C2  OPS.VER       (bağımsız — istenirse en başta koşulabilir; `.env` bulgusu zaten kesin)

FAZ D — mimari
  D1  BLG.MIM       (bağımsız; en büyük tek oturum, dar kapsam tanımıyla korundu)

FAZ E — P1 hücreleri (28 adet), yukarıdakilerin çıktısına göre sıralanır.
       İlk sırada: ENV.ESZ (P0'dan indi, kapsamı hazır) · OPS.GUV · BLG.GUV · RAP.DOG
```

**Bağımlılık kuralı:** bir hücre, "okunacaklar" listesindeki önceki hücrelerin defter satırlarını
okumadan başlamaz (`jq` sorgusu her promptta yazılı).

---

## 7. P0 oturum kartları

Her kart: **kapsam · kapsam dışı · okunacaklar · yapıştırılacak prompt · bitiş kriteri.**
Prompt metinleri olduğu gibi yapıştırılmak üzere yazılmıştır.

### Tüm oturumlarda geçerli ortak başlık

Aşağıdaki blok her promptun başına eklenir:

```
Bu bir DENETİM oturumudur. Kod DEĞİŞTİRME — salt okuma çalış.
Kod tabanı: /Users/oad/Documents/projeler/AdnanSahin/Teks-Erp (Express 5 + Prisma 7 + PostgreSQL, PRODUCTION CANLI).

ÇIKTI: bulgularını audit/FINDINGS.jsonl dosyasına APPEND et (satır başına bir JSON).
Şema ve yazım kuralları: audit/SCHEMA.md — ÖNCE ONU OKU.
Zorunlu alanlar: id, cell, severity, category, file, line, title, evidence, failure_mode,
fix_sketch, verification, status, confidence, session, found_at.

KALİTE KURALLARI:
- `failure_mode` üretemiyorsan (somut girdi -> somut yanlış sonuç) bu bir bulgu DEĞİLDİR.
  severity: bilgi ver ya da hiç yazma. "Bu kod karışık" bulgu değildir.
- Emin değilsen confidence: supheli ver ve verification alanına "nasıl kesinleşir" yaz.
- Aynı kök nedenin N tezahürü TEK bulgudur.
- CANLI SİSTEM: fix_sketch migration veya toplu veri dokunuşu öneriyorsa prod_risk: yuksek
  zorunlu ve geri alma yolu yazılmalı. `migrate reset` / reseed / toplu DELETE bu repoda YASAK.

YAZIM: Türkçe, teknik terimler İngilizce orijinaliyle. Emoji ve LaTeX kullanma.

OTURUM BAŞINDA ZORUNLU:
  jq -r 'select(.cell=="<HUCRE>") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.
```

---

### A1 — `CORE.guvenlik`

**Kapsam:**
`src/middlewares/auth.middleware.ts` · `rbac.middleware.ts` · `login-lockout.ts` ·
`src/services/base.service.ts` (satır 239-300, 485-560) · `src/app.ts` (1-140) ·
`src/routes/**` (yalnız guard dizilimi açısından)

**Kapsam DIŞI:** kimlik doğrulama iş mantığı (token üretimi, PIN/kart doğrulaması) → C1'e ait.
Belge izinleri (`DOC_PERMISSIONS`) → BLG.guvenlik'e ait (P1).

**Okunacaklar:** `audit/raw/_GUARD-BASELINE.md` (tamamı) · `audit/surface/05-middleware-zinciri.md` §3, §6, §7.2

**Prompt:**

```
<ORTAK BAŞLIK>  cell = CORE.guvenlik

GÖREV: HTTP giriş katmanının yetkilendirme kapısını denetle.

Doğrulanmış taban (audit/raw/_GUARD-BASELINE.md): 500 route handler, 8'inde verifyToken yok
(5 login + 3 cihaz el sıkışması), 14'ünde izin guard'ı yok. router.use(verifyToken) HİÇ YOK.

1. FAIL-OPEN İDDİASI. verifyToken her route'a tek tek takılıyor. Bunun mekanik bir bekçisi yok
   (scripts/test_permission_catalog.ts "verifyToken" kelimesini hiç geçirmiyor - doğrula).
   Sorular: (a) route stack'ini gezip her katmanın auth taşıdığını doğrulayan bir bekçi YAZILABİLİR mi
   (emsal: scripts/test_document_template_permission.ts:90 route stack'i okuyor)?
   (b) Muaf listesi nasıl gerekçelendirilir? (c) Bu bir bulgu mu yoksa kabul edilmiş bir tasarım mı?
   Cevabı fix_sketch'e yaz.

2. BaseService.safeFilters ENUMERATION. base.service.ts:254-300'deki F30 yorumu diyor ki
   filter[] allowlist'i modelin TÜM kolonlarıdır, response select'inde gizli kolon bile
   eşitlik-probe edilebilir. Yorum kuralı da koyuyor: "DÜZ saklanan sır kolonlu modeli
   BaseService'e BAĞLAMA". DOĞRULA: BaseService'e bağlı modellerin TAM listesini çıkar
   (route dosyalarında `new BaseService({modelName})` ara) ve her birinde sır/hassas kolon
   var mı schema.prisma'dan kontrol et. quickPin, cardToken, passwordHash özellikle ara.
   Bulgu varsa kritik.

3. RATE LIMIT YOK. express-rate-limit benzeri paket kurulu değil (doğrulandı). Tek throttle
   login-lockout ve o da process-local bir Map. Hangi uçlar rate limit olmadan istismara açık:
   kimlik doğrulamasız olanlar (POST /api/devices/announce KAYIT YARATIYOR, GET /health),
   ve pahalı olanlar (rapor uçları, sack-search, accounting-export). Somut failure_mode yaz.

4. CORS. Access-Control-Allow-Origin: * ve origin allowlist yok (ölçüldü). Kimlik Authorization
   header'ında, cookie yok -> klasik CSRF doğrudan uygulanmıyor. Ama public login uçları
   herhangi bir web sayfasından çağrılabilir. Bu LAN-only duruşta kabul edilebilir mi?
   Kararı gerekçelendir, "CORS * kötüdür" deme.

5. requirePermission wildcard semantiği (rbac.middleware.ts:23-40): "*" tüm izinleri,
   "domain:*" tek seviyeli. matchesPermission'ın atlayabileceği bir kod biçimi var mı?
   Katalogdaki 67 izin kodunun hepsi tek kolonlu mu?

BİTİŞ KRİTERİ: 5 maddenin her biri için ya bir FINDINGS satırı ya da "risk yok" gerekçesi
yazılmış olacak. Madde 2'nin model listesi eksiksiz olacak.
```

**Bitiş kriteri:** yukarıda. Ayrıca BaseService'e bağlı model listesi `audit/surface/` altına
`11-baseservice-modeller.md` olarak yazılır (sonraki oturumlar kullanacak).

---

### A2 — `CORE.ops`

**Kapsam:** `src/middlewares/error.middleware.ts` (515 satır) · `latency.middleware.ts` ·
`src/app.ts` (`/health`, 285-387) · `src/server.ts` (graceful shutdown) · `src/lib/pool-health.ts` ·
`src/services/audit.service.ts`

**Kapsam DIŞI:** yedekleme/db-copy operasyonları → C2. Deploy prosedürü → C2.

**Okunacaklar:** `audit/surface/05-middleware-zinciri.md` §4, §5, §7.5, §8, §9 · `07-async-yuzey.md` §10

**Prompt:**

```
<ORTAK BAŞLIK>  cell = CORE.ops

GÖREV: Hata yolu ve gözlemlenebilirlik. "Sessizce yanlış davranan sistem" sınıfı.

Doğrulanmış taban: instances=1 (fork mode, pazarlık dışı invariant). Bu yüzden bu oturumda
"cluster'da bozulur" DEME - onun yerine "tek process düşerse ne olur" ve "bu invariant
kırılırsa ne SESSİZ kalır" sorularını sor.

1. headersSent BOŞLUĞU. `grep -rn headersSent src/` -> 0 sonuç (doğrulandı). Tek akış yanıtı:
   admin.routes.ts:1225 `res.download(abs, name)` (callback'siz). Aktarım ortasında hata
   olursa Express next(err) verir, errorHandler res.status(500).json() dener, başlıklar
   gönderilmiştir. SOMUT OLARAK ÖLÇ: bu durumda ne olur - Express default handler'a mı düşer,
   uncaughtException mı olur, process ölür mü? server.ts:uncaughtException -> gracefulShutdown(1).
   Tek process olduğu için bu bir kullanılabilirlik riskidir. failure_mode'u somut yaz.

2. LOG/METRİK KÖR NOKTASI. express.json (app.ts:104) morgan (107) ve latency (115)
   middleware'lerinden ÖNCE. Bozuk JSON (400) ve 1MB aşımı (413) istekleri ne erişim log'una
   ne gecikme metriğine düşüyor. latency.middleware.ts'in kendi yorumu "tüm istekler ölçülür"
   diyor - bu ifade yanlış. Ayrıca preflight OPTIONS cors'ta sonlanıyor, o da ölçülmüyor.
   Düzeltmenin maliyeti ne (middleware sırasını değiştirmek neyi bozar)?

3. BİLİNMEYEN PRISMA KODU -> 400 + AUDIT YOK. error.middleware dal 6'nın sonu: tanınmayan P****
   kodu 400 döndürüyor ve audit yazmıyor, yalnız console.error. Yani sunucu kaynaklı bir arıza
   istemci hatası gibi görünür ve /health'in auditWriteFailures sayacına düşmez. Hangi Prisma
   kodları bu dala düşüyor (P2010 raw query failed dahil)?

4. KAPANIŞ UYUMSUZLUĞU. gracefulShutdown 5 sn'de process.exit(1) zorluyor (server.ts:114),
   ama global transactionOptions.timeout 20 sn. Ayrıca spawn edilen pg_dump/pg_restore child'ları
   detached DEĞİL ve öldürülmüyor -> yetim kalıyor, runBackupJob'un catch'indeki fs.rm temizliği
   koşmuyor -> yarım .dump dosyası kalıyor. Bunun bir sonraki yedek turuna etkisi ne?

5. MIDDLEWARE SIRASI KİLİTSİZ. `grep -l "helmet\|exposedHeaders\|compression" scripts/` -> 0.
   app.ts'i import eden 9 test var, hiçbiri sıra doğrulamıyor. Bir refactor helmet'i cors'un
   arkasına ya da errorHandler'ı 404'ün önüne alırsa hiçbir kırmızı çıkmaz. Bekçi yazılabilir mi?

6. /health HER ZAMAN 200 döndürüyor (DB düşse bile, gövdede db:"DOWN" diyerek). Dış izleme
   HTTP durum koduyla DB kaybını göremez. Docker'da backend healthcheck'i de yok. Bu bilinçli mi?

7. poolAcquireTimeouts sayacı YALNIZ HTTP hata yolundan artıyor - zamanlayıcı işlerindeki havuz
   zaman aşımı görünmüyor (pool-health.ts'in kendi yorumu söylüyor). Doğrula ve etkisini yaz.

BİTİŞ KRİTERİ: 7 maddenin her biri karara bağlanmış olacak. Madde 1 için failure_mode
mutlaka somut (hangi istek, hangi anda kesinti, sonuç ne).
```

---

### A3 — `CORE.veri-performans`

**Kapsam:** `src/lib/prisma.ts` · `src/services/base.service.ts` · `helpers/roll-barcode.helper.ts` ·
`src/middlewares/auth.middleware.ts` + `device.middleware.ts` (istek başına DB maliyeti) ·
115 transaction çağrı noktasının **envanteri** (tek tek incelenmez — o iş B fazında)

**Kapsam DIŞI:** modül bazlı transaction doğruluğu → B fazı hücreleri. Index tasarımı → P1 (ENV.VER).

**Okunacaklar:** `audit/surface/06-veri-katmani.md` §2, §3.1-3.5, §7 (tamamı) · `05-middleware-zinciri.md` §9 madde 6

**Prompt:**

```
<ORTAK BAŞLIK>  cell = CORE.veri-performans

GÖREV: Veri katmanının GLOBAL yapılandırması ve maliyeti. Tek tek transaction'ların doğruluğu
BU OTURUMUN İŞİ DEĞİL (o B fazında) - burada hepsini birden etkileyen ayarlara bakılıyor.

Doğrulanmış taban: 115 gerçek $transaction, 111'i interactive. Havuz max=30,
connectionTimeout 5s, idleTimeout 600s. transactionOptions { maxWait: 5_000, timeout: 20_000 },
per-call override HİÇ YOK. isolationLevel hiçbir yerde verilmemiş -> hepsi READ COMMITTED.

İPUCU (ana oturumda bulundu): tambur.controller.ts:39-40'taki yorum kesim tavanını
"pathological girdinin 5s tx timeout'una yol açmasını önler" diye gerekçelendiriyor —
ama global timeout 20 sn (lib/prisma.ts:91). Yorum Prisma VARSAYILANINA (5s) göre yazılmış
ve ayar ezildiğinde güncellenmemiş. Yani 200'lük tavan 5 sn varsayımıyla seçilmiş, bugün
4 kat daha uzun bir bütçe var. Bu, "tavan hâlâ doğru değer mi" sorusunu doğuruyor.

1. TEK BÜTÇE, ÇOK FARKLI İŞ. 115 tx aynı 20 sn bütçesini paylaşıyor. En uzunları:
   tambur.finalize (377 satır, döngüde 200'e kadar kesim), subcontractor.dispatch (354, belge
   dondurma), executeDirectShip (315), receive (312), workorder.replace (305).
   SOR: 20 sn yeterli mi, ölçülebilir mi? P2028 (tx timeout) üretim log'unda hiç görüldü mü
   (SystemLog'da ara)? Bir tx timeout'a düşerse kullanıcı ne görüyor (error.middleware P2028 -> 503)?
   Bütçenin işe göre farklılaşmaması bir bulgu mu, yoksa "tek değer tutmak daha güvenli" mi?

2. BARKOD SAYACI SERİLEŞTİRME NOKTASI. helpers/roll-barcode.helper.ts:40 -
   INSERT ... ON CONFLICT (day,type) DO UPDATE n=n+1 RETURNING n, tablo roll_barcode_counters.
   Sayaç gün+tip başına TEK SATIR ve tx verilirse kilit TX BOYUNCA tutuluyor (kodun kendi yorumu).
   Yani tambur.finalize 377 satırlık işini yaparken sistemdeki TÜM top yaratma işlemleri bekliyor.
   ÖLÇ: kaç çağrı yolu bu sayacı tx içinde alıyor? Vardiya pikinde bu ne demek?
   fix_sketch: sayacı tx dışına almak mümkün mü (barkod boşluğu kabul edilebilir mi)?

3. HAVUZ 30 ↔ TEK PROCESS. max=30 bağlantı, tek process. 20 sn'lik uzun tx'ler havuzu tutuyor.
   connectionTimeoutMillis 5 sn = ALMA bütçesi. classifyPoolTimeout -> 503. SOR: 30 doğru sayı mı,
   PostgreSQL tarafındaki max_connections ile ilişkisi ne (runbook §6'ya bak)?

4. İSTEK BAŞINA DB MALİYETİ. verifyToken her istekte user.findUnique + session.findUnique
   (cache YOK). resolveDevice her x-device-id taşıyan istekte device.findUnique (cache YOK),
   ve bu middleware express.static'ten ÖNCE, yani statik dosya isteklerinde bile koşuyor.
   Tablet 5 saniyede bir yokluyor (listOpenCards), durum sayfası 5 sn'de bir /health.
   ÖLÇ: N istemci x 5 sn -> taban DB yükü. Cache eklenebilir mi, invalidation maliyeti ne?

5. assertNameNotDuplicate LIMIT'SİZ FINDMANY (base.service.ts:539). Her master-data
   create/update'inde tüm adayları belleğe çekip JS'te karşılaştırıyor (gerekçe: PG lower()
   Türkçe İ/ı'da hatalı - gerekçe geçerli). ÖLÇ: hangi modellerde kaç satır? Item/Color kaç kayıt?
   Bugün küçükse bulgu değil, "bilgi" olarak yaz ve eşik öner.

6. BaseService'in create/update/softDelete/hardDelete'i TRANSACTION KULLANMIYOR.
   nestedCreateFields Prisma'nın kendi nested write'ıyla atomik ama reactivate yolunda
   nested alanlar SESSİZCE atılıyor (satır 685-691). Bu bir doğruluk riski mi?

7. hardDelete P2003'ü 409'a çeviriyor ("bağlı kayıt var") AMA ilişkilerin 92'si örtük SET NULL
   (onDelete yazılmamış opsiyonel ilişki). SET NULL P2003 fırlatmaz, sessizce NULL'lar.
   Yani "bağlı kayıt varsa silinmez" güvencesi yalnız RESTRICT'li ilişkiler için geçerli.
   Roll.colorId, Roll.parentRollId, Roll.currentStepId gibi izlenebilirlik alanları etkileniyor mu?
   guarded-hard-remove.ts'in bağımlılık guard'ları bu boşluğu kapatıyor mu - TEK TEK doğrula.

BİTİŞ KRİTERİ: 7 madde karara bağlanacak. Madde 2 ve 7 için mutlaka somut failure_mode.
Bu oturum B fazının ön koşuludur: çıktısı "her ESZ oturumunun bilmesi gereken global gerçekler"
listesi olarak audit/surface/12-tx-global-gercekler.md dosyasına yazılacak.
```

---

### A4 — `CORE.API`

**Kapsam:** `src/controllers/**` (22 dosya / 6.714 satır) · `src/utils/**` (7 dosya / 909 satır:
`app-error` 63, `query-parser` 272, `cursor` 290, `code-format` 176, `barcode-retry` 41, `p2002` 38) ·
`src/types/api.types.ts` · `src/controllers/base.controller.ts`

**Kapsam DIŞI:** guard kapsaması → A1. Hata middleware'inin iç dalları → A2.
Transaction bütçesi → A3. Domain iş kuralları → B fazı.

**Okunacaklar:** `audit/surface/10-tamlik-elestirisi.md` §1.2, §1.4, §1.5, §4.6 ·
`jq 'select(.cell=="CORE.guvenlik" or .cell=="CORE.ops")' audit/FINDINGS.jsonl`

**Prompt:**

```
<ORTAK BAŞLIK>  cell = CORE.API

GÖREV: İstemciye verilen sözleşme ve onu üreten iki katman: controller'lar ve utils/ sorgu çekirdeği.

NEDEN BU HÜCRE VAR: yüzey haritasını üreten dokuz ajanın HİÇBİRİ bir controller dosyasının
İÇİNE girmedi (13 controller'ın adı hiçbir belgede geçmiyor) ve src/utils/'in 6 dosyası
yalnız kavram düzeyinde anıldı. Oysa bu projenin KANITLANMIŞ en pahalı sessiz hata sınıfı
tam burada yaşadı: POST /api/traveler-cards/:id/print-event ucunun controller bind'ı eksikti,
uç 2026-08-05'te eklendi ve 2026-08-06'ya kadar HER çağrıda 500 verdi. Üç katman birden yuttu
(istemci hatayı best-effort yutuyordu, servis bekçileri controller'ı hiç geçmiyor,
TypeScript `controller.method` referansını geçerli sayıyor).

1. BAĞLAMA (bind) KONVANSİYONU. Ölçüldü: üç konvansiyon yan yana yaşıyor —
   arrow-property (6 dosya, otomatik bağlı), prototip metodu + constructor'da açık .bind(this)
   (11 dosya), statik metot (4 dosya). ÖNEMLİ: bu sınıf için ARTIK BEKÇİ VAR —
   scripts/test_controller_binds.ts (137 satır, 2026-08-06'da tam bu vakadan sonra yazıldı,
   körlük zemini taşıyor: MIN_CLASSES_WITH_BIND=10, MIN_HANDLERS=100, MIN_ROUTE_REFS=100).
   SENİN İŞİN bind'ı yeniden aramak DEĞİL. Sor: (a) bekçinin regex tabanlı taraması üç
   konvansiyonu da tanıyor mu, yoksa dördüncü bir yazım biçimi sessizce kaçar mı?
   (b) Körlük zemini sayıları bugünkü gerçeğe göre yeterince yüksek mi?
   (c) Karışık konvansiyonu tekleştirmek maliyeti neye değer — yoksa bekçi yeterli mi?

2. YANIT ZARFI TUTARLILIĞI. types/api.types.ts ApiResponse/PaginatedResponse tanımlıyor
   (fan-in 43). ÖLÇ: 500 ucun kaçı bu zarfı kullanıyor, kaçı ham nesne dönüyor?
   Başarı yanıtlarında { success, data } tutarlı mı? Sayfalı yanıtlarda meta alanları aynı mı?
   Tutarsızlık varsa hangi istemci kodu buna göre dallanmak zorunda kalıyor?

3. DURUM KODU DİSİPLİNİ. Kaynak yaratan uçlar 201 mi 200 mü dönüyor?
   Atomik claim başarısızlığı her yerde 409 mu? Yıkıcı işlemlerde 204 mü 200 mü?
   Bunlar tek tek doğrulanmalı; sözleşme ihlali sessizdir çünkü istemci genelde yalnız
   2xx/4xx ayrımına bakar.

4. GİRDİ DOĞRULAMANIN YERİ. Ölçüldü: 140 nokta `<şema>.parse(req.body)` kullanıyor,
   asyncHandler yok, 432 catch bloğunun hepsi next(err) çağırıyor. SOR: doğrulama
   controller'da mı servis girişinde mi — ikisi karışık mı? Karışıksa hangi uçlar
   doğrulanmamış gövdeyi servise geçiriyor? Express 5'te req.body parse edilmemişse
   undefined'dır (4'te {} idi) — 140 .parse çağrısı bunu ZodError'a çeviriyor,
   ama .parse KULLANMAYAN uçlar var mı?

5. utils/query-parser.ts (272 satır, fan-in 15) — BU DOSYA HİÇ AÇILMADI ve içinde
   projenin en yeni canlı vakası yaşıyor: readIdCondition (2026-08-06 çoklu-seçim CSV kuralı).
   Kök CLAUDE.md üç arıza modunu sayıyor: uuid kolonda P2007->400, uuid olmayan string
   kolonda SESSİZ 0 satır, ön-süzgeçli alanda filtrenin SESSİZCE DÜŞMESİ (en tehlikelisi:
   boş liste değil YANLIŞ liste). DOĞRULA: elle filtre okuyan TÜM liste servisleri
   readIdCondition'dan geçiyor mu? Geçmeyen bir tane bile varsa bulgu.
   Ayrıca MAX_OFFSET=10000 guard'ı burada yaşıyor — aşıldığında ne oluyor?

6. utils/cursor.ts (290 satır, fan-in 25) — SIFIR sembol eşleşmesiyle hiç incelenmemiş.
   Keyset cursor kodlama/çözme: cursor istemciden geliyor, yani GÜVENİLMEZ GİRDİ.
   Bozuk/kurcalanmış cursor ne yapıyor (500 mü, 400 mü, sessiz yanlış sayfa mı)?
   sortNullable (nulls-last) doğru mu — union'ın iki tarafında alan adı farklı olan
   dispatchedAt/shippedAt vakası CLAUDE.md'de yazılı, o kural burada mı yaşıyor?

7. utils/app-error.ts (63 satır, FAN-IN 75). Bu, kod tabanının en çok import edilen dosyası —
   doc 01'in "hub servisleri" tablosundaki en yüksek değerden (audit.service 50) BÜYÜK,
   yani o tablo eksikti. Statik fabrikalar hangi statusCode'ları üretiyor?
   `details: Record<string, unknown>` filtresiz biçimde yanıta konuyor (A2'de işaretlendi) —
   servis katmanında details'e ne konduğunu TEK TEK doğrula: iç hata metni, SQL parçası,
   kullanıcı/kayıt kimliği sızıyor mu?

8. types/express-augment.ts: req.user ve req.device'ın İKİSİ DE OPSİYONEL.
   Bu, verifyToken'ın route başına takılmasının (fail-open) TİP TARAFINDAKİ İKİZİ:
   guard'sız bir handler req.user okursa undefined görür ve TypeScript uyarmaz.
   Kaç handler req.user'ı non-null assertion (!) ile okuyor? Bunların hepsi gerçekten
   guard'lı route'ta mı? (Bu, CORE.tip-guvenligi P1 hücresiyle kesişir — related ile bağla.)

BİTİŞ KRİTERİ: 8 madde karara bağlanacak. Madde 2 ve 3 için sayısal tablo üretilecek
(kaç uç uyumlu / kaç uç değil). Madde 5'in "geçmeyen servis" listesi eksiksiz olacak.
```

---

### B1 — `SEV.eszamanlilik`

**Kapsam:** `src/services/shipping.service.ts` (3.476) · `return.service.ts` (1.134) ·
`helpers/shipment-locks.helper.ts` · `helpers/allocation.helper.ts` · `helpers/sack-invariants.ts`

**Kapsam DIŞI:** brüt/net doğruluk kuralı → B6 (SEV.dogruluk). Muhasebe Excel'i → P1 (SEV.VER).

**Okunacaklar:** `audit/surface/12-tx-global-gercekler.md` (A3 çıktısı) ·
`06-veri-katmani.md` §3.3 satır 27/33 · `jq 'select(.cell=="CORE.veri-performans")' audit/FINDINGS.jsonl`

**Prompt:**

```
<ORTAK BAŞLIK>  cell = SEV.eszamanlilik

GÖREV: Sevkiyat/çuval/iade akışının eşzamanlılık doğruluğu. Blast radius = PARA.

Doğrulanmış taban: shipping.service.ts kod tabanının en yoğun eşzamanlılık dosyası -
24 $transaction (rekor) + 46 updateMany (rekor) + 9 atomik claim.

1. performDispatchTx (1685-1762) - sevk anı. İçinde freezeForSource (belge dondurma) koşuyor,
   yani resmi belgenin TÜM içeriğini toplayan çok-sorgulu okuma + 4 seri ayar okuması tx'in içinde.
   SOR: bu tx ne kadar sürüyor, 20 sn bütçesini zorluyor mu (çok çuvallı sevkiyatta)?
   İki eşzamanlı dispatch aynı çuvalı sevk edebilir mi - atomik claim var mı, count kontrol
   ediliyor mu? Kilit sırası nedir (shipment-locks.helper)?

2. undoDispatch (storno, 1991-2053). Roll.preShipStatus snapshot'ıyla geri sarıyor.
   freezeForSource version:1 sabitten max+1'e çevrilmiş (yeniden sevk için). SOR: storno ile
   eşzamanlı bir iade (RollReturn) çakışırsa ne olur? resolveUndoBlockReason önizleme ve
   mutasyonda AYNI yüklemi çağırıyor mu (ayrışırsa ekran "yapılabilir" der, uç 409 verir)?

3. RollReturn ile Shipment sorguları AYRI TX'LERDE. CLAUDE.md üç ayrı yerde bu tuzağı anlatıyor
   ("shipment.findUnique ile iade sorgusu ayrı sorgulardır (tx yok) - arada bir iade commit
   olursa aynı top iki kez sayılır -> canlı id kümesiyle dedup"). DOĞRULA: getShipmentById,
   listShipments.attachTotals, collectShipmentDocContent, getDispatchReport - DÖRDÜNDE DE
   dedup var mı? Biri eksikse bulgu.

4. 46 updateMany'nin kaçı durum geçişi (claim olmalı), kaçı toplu güncelleme? Sonuç sayısı
   denetlenmeyenleri listele ve her biri için "burada claim gerekir mi" kararı ver.
   order.service.ts:1722'deki kod yorumu geçmişte tam bu sınıf bir hatayı anlatıyor - emsal olarak oku.

5. Sack yaşam döngüsü: aç -> okut -> tart -> sevk. touchWarehouseSackTx guard'ı hangi yollarda
   uygulanıyor, hangilerinde bilinçli olarak uygulanmıyor (Sack.notes istisnası CLAUDE.md'de yazılı)?
   Guard'ın atlandığı bir yol yanlışlıkla mı atlıyor?

6. SackAllocation sevk anında yazılıyor (distributeSacksToLines), shippedQty dispatch'te terfi
   ediyor. İki eşzamanlı sevk aynı OrderLine'a tahsis yazarsa toplam quantity'yi aşabilir mi?

BİTİŞ KRİTERİ: 6 madde karara bağlanacak. Madde 3 dört yüzeyin dördü için de açıkça
"dedup var/yok" diyecek. Madde 4'ün listesi eksiksiz olacak.
```

---

### B2 — `FAS.eszamanlilik`

**Kapsam:** `src/services/subcontractor.service.ts` (6.055) · `kartela.service.ts` (1.522) ·
`subcontractor-management.service.ts` · `helpers/batch-dispatch-surgery.helper.ts` ·
`helpers/subcontractor-cancel.helper.ts`

**Kapsam DIŞI:** fason belgelerinin içeriği/yerleşimi → BLG. Fason kabul doğruluğu → P1 (FAS.DOG).

**Okunacaklar:** `audit/surface/12-tx-global-gercekler.md` · `06-veri-katmani.md` §3.3 satır 2/3/4/9/14/15 ·
`01-modul-haritasi.md` §5.5

**Prompt:**

```
<ORTAK BAŞLIK>  cell = FAS.eszamanlilik

GÖREV: Fason sevk/kabul/iptal akışının eşzamanlılık doğruluğu.
Blast radius = MAL FİZİKSEL OLARAK FABRİKA DIŞINDA. Yanlış durum = kayıp mal.

Doğrulanmış taban: üç dev transaction - dispatch 354 satır, executeDirectShip 315, receive 312.
dispatch ve executeDirectShip belge dondurma içeriyor; receive ve executeDirectShip ham SQL
içeriyor; receive, undoTransfer, cancelReceipt döngüde yazma yapıyor.

1. Üç dev tx'in her biri için: kaç sorgu koşuyor, kilit sırası ne, 20 sn bütçesine göre
   en kötü durum ne? receive N makbuz satırı için döngüde top yaratıyor - tavan var mı
   (Zod şemasına bak, tambur'daki 200 kesim emsali)?

2. subcontractor.service ÜRETİM DURUM MAKİNESİNE YAZIYOR (modul haritasi §5.5, ölçüldü):
   tx.workOrderStep.update x5 + updateMany x1 (satır 1043, 2046, 2067, 2689, 5439, 5463)
   ve tx.workOrder.update x3 (2059, 2704, 5479). Yani fason, ÜRETİM context'inin dışından
   iş emri adım durumunu değiştiriyor. SOR: bu yazımlar recomputeStepStatus /
   completeWorkOrderIfStepsDone ile aynı kuralı uyguluyor mu, yoksa paralel bir durum makinesi mi?
   Eşzamanlı bir tambur finalize ile çakışırsa hangi guard koruyor?

3. Fason kabulünde orijinal rulolar SUBCONTRACTOR_CONSUMED ile emekliye ayrılıyor ve makbuzdan
   yeni Roll'lar doğuyor. İki eşzamanlı kabul aynı sevki işleyebilir mi? Atomik claim var mı?
   İptal (cancelReceipt, undoTransfer) ile kabul yarışırsa?

4. batch-dispatch-surgery.helper (393 satır, SubcontractorDispatch 9 + DispatchItem 5 yazım) -
   adı "surgery" olan bir helper. Ne yapıyor, hangi invariant'ları koruyor, tx içinde mi?

5. K10 kuralı "bir sevk = bir parti" (SubcontractorDispatch.batchId NOT NULL) ve K11 çok-partili
   sevkte merge. Kısmi sevkte kalanlar YENİ parti alıyor (splitRemainder). Bu üç yolun
   eşzamanlı koşumu parti numarası sayacıyla (advisory lock ns 8022) nasıl etkileşiyor?

6. withBarcodeRetry bu dosyada kaç yerde? P2002'de TÜM tx yeniden koşuyor - yeniden koşan tx'in
   yan etkileri idempotent mi (audit çift yazımı, belge çift dondurma, parti no boşluğu)?

BİTİŞ KRİTERİ: 6 madde karara bağlanacak. Madde 2 mutlaka net cevaplanacak
("aynı kural mı, paralel makine mi").
```

---

### B3 — `IST.eszamanlilik`

**Kapsam:** `src/services/tambur.service.ts` (3.318) · `kursun-qc.service.ts` (1.656) ·
`kursun-bypass.service.ts` (2.362) · `tambur-manual.service.ts` · `tambur-undo.service.ts` ·
`helpers/kursun-bypass-eligibility.ts` · `helpers/kursun-bypass-guard.helper.ts`

**Kapsam DIŞI:** kalite kararının iş kuralı doğruluğu → P1 (IST.DOG).

**Okunacaklar:** `audit/surface/12-tx-global-gercekler.md` · `06-veri-katmani.md` §3.3 satır 1/13/18/20/21/24 ·
`jq 'select(.cell=="CORE.veri-performans")' audit/FINDINGS.jsonl` (özellikle barkod sayacı bulgusu)

**Prompt:**

```
<ORTAK BAŞLIK>  cell = IST.eszamanlilik

GÖREV: Tambur + Kurşun/KK2 istasyonlarının eşzamanlılık doğruluğu.

Doğrulanmış taban: tambur.finalize (790-1166) TEK TX'TE 377 SATIR - kod tabanının en uzun
transaction'ı. İçinde `for (const seg of segments)` döngüsünde segment başına
generateRollBarcode + tx.roll.create + tx.rollProperty.createMany + tx.rollOperation.createMany.
Zod tavanı 200 kesim (tambur.controller.ts:41). Yani en kötü durum ~800-1200 round trip,
20 sn bütçe içinde, ÜSTELİK global barkod sayacı kilidi elde tutuluyor.

1. finalize'ın en kötü durumunu ÖLÇ (200 kesim). Bütçe yetiyor mu? Yetmezse ne olur -
   P2028 -> 503, ve kısmi yazım OLMAZ (tx rollback) ama operatör 200 kesimi yeniden mi girecek?
   Barkod sayacı kilidi bu süre boyunca tutulduğu için paralel KK1 girişleri ne kadar bekliyor?
   fix_sketch: kesimi batch'lere bölmek mümkün mü, yoksa atomiklik şart mı?

2. Aynı topu iki tablet aynı anda finalize ederse? closeOpenMovementsTx'in exitedAt IS NULL
   guard'ı yeterli mi? CLAUDE.md "3 paralel okutmadan yalnız biri kapatıyor - ölçüldü" diyor,
   DOĞRULA ve hangi mekanizmanın koruduğunu yaz.

3. KURŞUN BYPASS REJİMİ. assertKursunTabletMayWrite BEŞ tablet yazma yolunu kapsıyor
   (KK2 tamamlama, hata kaydı, tablet adım kapatma, açık kumaş açma, kurşun bitirme).
   resolveBypassBlockReason tek kaynak. SOR: bu beş yolun hepsi gerçekten guard'dan geçiyor mu
   (tek tek doğrula)? Guard tx İÇİNDE mi yoksa öncesinde mi - araya giren bir atama ne olur?

4. DAĞITIMSIZ KAPANIŞ (2026-08-06). completeFromTambur atama yoksa SANAL bekleyen üretiyor
   (source: "UNASSIGNED") ve marker KURSUN_BYPASS_FINISHED:UNASSIGNED:<uuid> yazıyor.
   CLAUDE.md diyor ki "atomik claim EKLENMEDİ ve gerekmiyor - claim'in işini
   closeBypassMovementsTx'in exitedAt IS NULL guard'ı görüyor". BU İDDİAYI SINA:
   3 paralel okutmada gerçekten 1 kapanış mı oluyor? Marker ön eki uyumu
   (startsWith(KURSUN_BYPASS_MARKER_PREFIX)) hasBypassClosureOnProcessQcTx ve
   loadBypassEligibilitySignals.closedNonBypass ile tutuyor mu?

5. tambur-undo (applyFull, 133 satır, 15 tx çağrısı, döngüde yazma). Undo ile eşzamanlı
   bir ileri işlem (yeni kesim, sevk) çakışırsa? MANUAL modu softDelete'i çağırıyor
   (qtyOut=0 semantiği) - bu rescueStuckRoll'un qtyOut=qtyIn semantiğinden farklı, karışma var mı?

6. kursun-qc.finishStep (105 satır, döngüde yazma, ham SQL) ve cutOpenFabric / cutWarehouseRoll /
   finalizeWarehouseCut / finalizeOpenFabric - beşi de Roll yaratıyor. Hepsi aynı barkod
   sayacı kilidini alıyor mu? Kilit sırası tutarlı mı (ABBA deadlock riski)?

BİTİŞ KRİTERİ: 6 madde karara bağlanacak. Madde 1 için somut sayı (kaç round trip, tahmini süre).
Madde 4'teki iddia ya doğrulanacak ya çürütülecek.
```

---

### B4 — `URE.eszamanlilik`

**Kapsam:** `src/services/workorder.service.ts` (6.073) · `workorder-split.service.ts` ·
`workorder-manual-move.service.ts` · `workorder-batch-drop.service.ts` · `batch.service.ts` (975) ·
`helpers/workorder-locks.ts` · `helpers/roll-step.helper.ts` · `helpers/workorder-clone.helper.ts`

**Kapsam DIŞI:** iş emri iş kuralları (rota, hedef, kapsama) → P1 (URE.DOG).

**Okunacaklar:** `audit/surface/12-tx-global-gercekler.md` · `06-veri-katmani.md` §3.3 satır 5/7/8/11/12/16/22/25 · §4

**Prompt:**

```
<ORTAK BAŞLIK>  cell = URE.eszamanlilik

GÖREV: İş emri + parti durum makinesinin eşzamanlılık doğruluğu.

Doğrulanmış taban: workorder.service 9 $transaction / 25 updateMany; replace 305 satır,
completeWorkOrder 213, softDelete 175, attachRolls 127, detachRolls 112 - beşi de döngüde yazma
ve/veya ham SQL içeriyor. batch.service 6 tx / 12 updateMany; mergeBatches 253 satır,
moveRolls 143. Parti no üretimi pg_advisory_xact_lock(8022, 1) ile korunuyor ve kilit
generateBatchNumberTx'in İLK ifadesi (TOCTOU'ya karşı load-bearing).

1. PARTİ NO SARMASI. batchNumber @unique KALDIRILDI (migration 20260805120000). Numara
   P01..P99 arasında dönüyor ve sarma KÖRLEMESİNE (numaranın canlı bir partide olup olmadığına
   bakılmıyor - bu bilinçli bir ürün kararı). Sayaç "en son doğan kısa parti"den türetiliyor
   (createdAt DESC LIMIT 1) ve SQL regex'i ^P(0[1-9]|[1-9][0-9])$ LOAD-BEARING.
   SINA: regex gevşerse ne olur (eski günlük kod dönerse sayaç P01'e düşer ve canlı P01 dururken
   ikinci P01 doğar)? Advisory lock gerçekten ilk ifade mi? Bayrak kapalıyken (günlük kalıp)
   aynı koruma geçerli mi?

2. withBarcodeRetry (73 referans) P2002'de TÜM $transaction'ı yeniden koşuyor. Yeniden koşan
   tx'in yan etkileri idempotent mi? Özellikle: audit çift yazımı, parti no sayacı boşluğu,
   belge dondurma (freeze) çift versiyon, traveler card dirty işaretleme.
   Retry sayısı ve backoff ne? Sonsuz döngü koruması var mı?

3. WORKORDER DURUM MAKİNESİ. recomputeStepStatus + ensureWorkOrderInProgress +
   completeWorkOrderIfStepsDone. CLAUDE.md 2026-08-04 notu "giriş noktası" kuralını anlatıyor
   (aşağıdan katılan top yukarıdaki adımı bekletmemeli) ve bunun bir kez iş emirlerini
   "bir daha asla kapatılamaz" hale getirdiğini söylüyor. SINA: bu kural eşzamanlı yazımda
   da tutuyor mu? İki paralel adım kapanışı completeWorkOrderIfStepsDone'u aynı anda çağırırsa?
   Terminal guard (CANCELLED/SUPERSEDED asla COMPLETED'a dirilmez) her yolda mı?

4. helpers/workorder-locks.ts (229 satır) - kilit sırası burada tanımlı mı? Hangi yollar
   bu kilidi alıyor, hangileri almıyor? subcontractor.service da bu kilidi alıyor (modul
   haritasi §4.3: FASON -> ÜRETİM 4 value import). Kilit sırası iki context arasında tutarlı mı?

5. mergeBatches (253 satır) ve moveRolls (143) ile splitBatch/splitRemainder eşzamanlı koşarsa?
   Parti bir kez merge edilince mergedIntoId set ediliyor - bu atomik claim mi?

6. workorder-manual-move.manualMove (255 satır, 14 tx çağrısı, döngüde yazma). COMPLETED bir
   WO'yu IN_PROGRESS'e diriltiyor. Eşzamanlı bir completeWorkOrderIfStepsDone ile yarışırsa?

7. type Db = PrismaClient | Prisma.TransactionClient çift-mod helper'ları (workorder-locks,
   kursun-bypass-guard, kursun-bypass-eligibility). Çağrı yerlerinin HANGİSİ tx içinde,
   hangisi havuzdan ayrı bağlantıyla koşuyor - TEK TEK doğrula. "Tx içinde sanıyorduk ama
   değildi" sınıfı sessiz hata zemini.

BİTİŞ KRİTERİ: 7 madde karara bağlanacak. Madde 2 ve 7 mutlaka somut liste üretecek.
```

---

### (P1'e indi, kartı korunuyor) — `ENV.eszamanlilik`

> Bu hücre tamlık eleştirisi sonrası **P0'dan P1'e indi** (gerekçe §5 sonundaki not).
> Kart olduğu gibi duruyor; P1 fazının **ilk** oturumudur ve kapsamı hazırdır.

**Kapsam:** `src/services/inventory.service.ts` (4.318) · `helpers/duplicate-guard.helper.ts` ·
`helpers/roll-cancel-restore.helper.ts` · `helpers/roll-entry-station.ts`

**Kapsam DIŞI:** envanter listeleme performansı/index'ler → P1 (ENV.VER).

**Okunacaklar:** `audit/surface/12-tx-global-gercekler.md` · `06-veri-katmani.md` §3.3 satır 19, §4 · `05` yok

**Prompt:**

```
<ORTAK BAŞLIK>  cell = ENV.eszamanlilik

GÖREV: KK1 ham giriş + top yaşam döngüsü yazımlarının eşzamanlılık doğruluğu.

Doğrulanmış taban: createInitialEntry (770-905, 136 satır) tx'in İLK ifadesi
pg_advisory_xact_lock(8021, hashtext(lockKey)). BU GUARD'DA GEÇMİŞTE GERÇEK BİR TOCTOU HATASI
YAŞANDI: kilit findFirst'ten SONRA alınıyordu, mobil kuyruk Promise.all ile paralel flush ediyordu,
5 eşzamanlı giriş 46 ms içinde 5 kayıt üretti ve bayrak AÇIK olmasına rağmen hiçbiri 409 almadı.

1. SIRA INVARIANT'I. Kilit (a) findFirst'ten ÖNCE ve (b) generateRollBarcode'dan ÖNCE olmak
   ZORUNDA (ikincisi ABBA deadlock önlemi). Bu invariant sadece yorumla korunuyor - mekanik
   bir sed yok. DOĞRULA: bugün gerçekten ilk ifade mi? Bir refactor satırı kaydırırsa hangi
   test kırmızı verir (scripts/test_kk1_duplicate_guard.ts 5 eşzamanlı giriş -> 1 geçer + 4x409
   ölçüyor - bu test sıra değişikliğini yakalar mı, yoksa yalnız kilidin VARLIĞINI mı ölçüyor)?

2. Kilit anahtarı Decimal'leri DB hassasiyetine YUVARLIYOR (duplicate-guard.helper).
   Yuvarlamazsa 140.0001 ile 140.0004 ayrı kilit alır ve yarış düzeltilen yerde açık kalır.
   Yuvarlama gerçekten uygulanıyor mu, hangi alanlarda?

3. Pencere OPERATÖRÜN saatiyle ölçülüyor (Roll.clientEnteredAt), iki yönlü. Makul aralık dışı
   beyan (-36 sa / +5 dk) saklanmıyor ve sunucu saatine düşülüyor. 400 DÖNMÜYOR (bozuk RTC'li
   tablet üretimi durdurmasın). SOR: bu tercih guard'ı delik bırakıyor mu (saati kasten kaydıran
   istemci tuzağı atlayabilir mi)? clientEnteredAt'e index EKLENMEDİ, çıpa createdAt'te -
   sorgu gerçekten indexi kullanıyor mu?

4. Bayrak kk1.duplicateGuardEnabled VARSAYILAN KAPALI. Yani bugün sahada bu koruma çalışmıyor
   olabilir. Bayrak kapalıyken hangi koruma kalıyor (yalnız istemci tarafı clientToken)?
   clientToken @unique replay davranışı: iptal edilmiş topun token'ı 409 ENTRY_CANCELLED
   döndürüyor - bu dal her yolda var mı?

5. inventory.service SEVKİYAT MODELLERİNİ OKUYOR (modul haritasi §5.7):
   prisma.shipment.findMany/count/findUnique (1624, 1635, 2739, 2846) ve
   prisma.sack.groupBy/findUnique (1640, 2747, 2856). Bu okumalar SEV'in brüt kuralını
   uyguluyor mu, yoksa "dördüncü kaynak dördüncü rakam" mı? (Bu bir doğruluk sorusu ama
   eşzamanlılıkla kesişiyor: iade ile eşzamanlı okuma.)

6. rescueStuckRoll (qtyOut=qtyIn) ile softDelete (qtyOut=0) semantik ayrımı. İki yol aynı topa
   eşzamanlı uygulanabilir mi? applyRollDispositionsTx (WO kapanış dispozisyonu) ile çakışma?

BİTİŞ KRİTERİ: 6 madde karara bağlanacak. Madde 1 mutlaka "test sıra değişikliğini yakalar mı"
sorusunu cevaplayacak - yakalamıyorsa bu bir bulgudur (bekçi körlüğü).
```

---

### B5 — `SEV.dogruluk`

**Kapsam:** brüt/net kuralının **altı yüzeyi**: `getDispatchReport` · `listShipments.attachTotals` ·
`accounting-export.service.ts` · `getShipmentById` · `collectShipmentDocContent` · `sack-search.service.ts`

**Kapsam DIŞI:** sevk tx'inin eşzamanlılığı → B1. Belge yerleşimi/CSS → BLG.

**Okunacaklar:** `jq 'select(.cell=="SEV.eszamanlilik")' audit/FINDINGS.jsonl` ·
kök `CLAUDE.md`'nin 2026-08-02 / 08-03 / 08-05 brüt kuralı notları

**Prompt:**

```
<ORTAK BAŞLIK>  cell = SEV.dogruluk

GÖREV: "Sevk rakamı brüttür, iade onu geriye dönük değiştiremez" kuralının TÜM yüzeylerde
tutarlı uygulandığını doğrula. Bu kural beş kez, beş ayrı saha vakasından SONRA eklendi -
yani bu alanda tekrar eden bir hata sınıfı var.

Kök neden tek satır: RollReturn topun sackId VE shipmentId'sini NULL'lar
(return.service.ts:322-325). Her canlı sorgu bu yüzden NET okur.

DOĞRULANMASI GEREKEN ALTI YÜZEY:
  1. getDispatchReport            -> donmuş PrintedDocument.snapshot'tan okur (frozen:false ise canlı)
  2. listShipments.attachTotals   -> canlı + RollReturn geri-ekleme
  3. accounting-export.service    -> canlı + RollReturn geri-ekleme
  4. getShipmentById              -> canlı + prevSackId ile çuval bazında geri-ekleme
  5. collectShipmentDocContent    -> canlı + prevSackId geri-ekleme (reissue/lazy-init yolları için)
  6. sack-search / çuval etiketi yeniden basımı -> CLAUDE.md'ye göre HÂLÂ CANLI OKUYOR (kapsam dışı bırakılmış)

1. ALTI YÜZEYİ TEK TEK OKU ve her biri için yaz: brüt mü net mi, kaynağı ne (snapshot mı
   RollReturn mı), dedup var mı, prevSackId taşımayan eski iadeler nasıl ele alınıyor.
   Bir tablo üret. Ayrışan varsa bulgu.

2. 6. yüzey (sack-search) bilinçli olarak kapsam dışı bırakılmış. SOR: bu gerçekten zararsız mı?
   Çuval etiketi yeniden basıldığında iade edilmiş top etikette görünmüyor - operatör için
   yanlış bilgi mi, doğru bilgi mi? (Çuval fiziksel bir nesne; iade edilen top artık içinde
   değil. Belki NET burada DOĞRUDUR.) Kararı gerekçelendir.

3. totalKg DEĞİŞMEZ kuralı: iade Sack.weightKg'a dokunmuyor, o yüzden zaten brüt, geri-ekleme
   çift sayardı. Altı yüzeyin hiçbirinde kg'ye geri-ekleme yapılmadığını DOĞRULA.

4. ÇİFT SAYIM TUZAKLARI (CLAUDE.md üçünü de sayıyor): (a) sacks[].rolls ile summary ayrı
   toplanırsa; (b) shipment.findUnique ile iade sorgusu ayrı tx'lerde -> canlı id kümesiyle dedup;
   (c) sentetik satır sackId = prevSackId taşımalı. Üçünün de her yüzeyde uygulandığını doğrula.

5. RAPOR TARAFI. reports/ servisleri domain servislerini HİÇ import etmiyor (ölçüldü) ve
   ham SQL yazıyor. Sevkle ilgili rapor var mı (reports/sales, reports/customer)? Varsa
   brüt kuralını uyguluyor mu, yoksa YEDİNCİ bir kaynak mı? Bu, RAP.dogruluk hücresinin de
   girdisi olacak - bulursan related alanıyla bağla.

6. Muhasebe Excel'inde sevk satırları BRÜT, iade satırları AYRI sayfa. CLAUDE.md diyor ki
   eskiden satırlar net idi VE ayrı iade sayfası vardı -> muhasebeci "sevk - iade" yapınca
   aynı metraj İKİ KEZ düşüyordu. Bugünkü halin doğru olduğunu gerçek veriyle doğrula
   (dev DB'de iadeli bir sevkiyat bul, üç yüzeyin rakamını karşılaştır).

BİTİŞ KRİTERİ: madde 1'in altı satırlık tablosu üretilmiş olacak ve
audit/surface/13-brut-kurali-yuzeyler.md dosyasına yazılacak.
```

---

### C1 — `KIM.guvenlik`

**Kapsam:** `src/services/auth.service.ts` · `permission-management.service.ts` (1.008) ·
`session-registry.service.ts` · `device.service.ts` · `controllers/auth.controller.ts` ·
`middlewares/login-lockout.ts` · `routes/auth.routes.ts` · `routes/device.routes.ts`

**Kapsam DIŞI:** guard kapsaması (A1'de yapıldı) · izin kataloğunun içeriği/rol şablonları → P1 (KIM.IZO).

**Okunacaklar:** `audit/raw/_GUARD-BASELINE.md` · `jq 'select(.cell=="CORE.guvenlik")' audit/FINDINGS.jsonl` ·
`audit/surface/07-async-yuzey.md` §5.1 (login-lockout satırı), §7

**Prompt:**

```
<ORTAK BAŞLIK>  cell = KIM.guvenlik

GÖREV: Kimlik doğrulamanın sertliği. Blast radius = ERİŞİM (tüm sistemin kapısı).

ANA OTURUMDA DOĞRULANMIŞ BULGU (senin işin bunu genişletmek, yeniden keşfetmek değil):
AuthController.login (auth.controller.ts:86-147) reserveLoginAttempt'i ÇAĞIRMIYOR.
Çağrılar yalnız satır 163 (loginCard, 148-226) ve 242 (loginQuickPin, 227-300).
Yani klasik kullanıcı adı/şifre girişinde brute-force kilidi YOK. Rate limit de yok.

1. Bu boşluğun somut sonucu: sınırsız şifre denemesi. bcryptjs kullanılıyor (maliyet faktörü kaç?
   auth.service.ts'e bak) - bcrypt yavaşlığı tek başına yeterli bir savunma mı? Tek process
   olduğu için CPU-bound bcrypt aynı zamanda bir DoS vektörü mü (event loop bloklama)?
   İKİ AYRI failure_mode yaz: (a) hesap ele geçirme, (b) hizmet kesintisi.

2. login-lockout process-local bir Map (MAX_ENTRIES 5000), restart'ta sıfırlanıyor,
   anahtar req.ip. app.set("trust proxy") YOK (doğrulandı) -> req.ip soket IP'si.
   Fabrika ağında NAT/proxy arkasından gelen tüm tabletler aynı IP mi görünüyor?
   Öyleyse bir tabletin hatalı denemeleri diğerlerini kilitler mi (yanlış pozitif DoS)?

3. GET /api/auth/mobile-users KİMLİK DOĞRULAMASIZ kullanıcı listesi döndürüyor.
   Ne dönüyor tam olarak (id, kullanıcı adı, ad soyad, rol?)? Bu bir enumeration yüzeyi.
   Giriş ekranının gerçekten buna ihtiyacı var mı, yoksa cihaz eşleşmesi arkasına alınabilir mi?
   GET /api/auth/login-methods da aynı sınıf.

4. CİHAZ EL SIKIŞMASI. POST /api/devices/announce kimlik doğrulamasız ve bilinmeyen cihaz için
   PENDING KAYIT YARATIYOR. Rate limit yok. Somut sonuç: kayıt şişirme. Tavan var mı,
   temizlik var mı? GET /api/devices/status ve /pairing-required ne kadar bilgi veriyor?

5. ADVISORY LOCK UZAYI PAYLAŞIMI. 1-argümanlı pg_advisory_xact_lock uzayını İKİ bağımsız
   alt sistem paylaşıyor: session-registry.service.ts:63 hashtext("<userId>|<deviceType>")
   ve permission-management.service.ts:584 hashtext('perm-admin-guard').
   2-argümanlı kullanıcılar (8021, 8022) namespace'i ÖZENLE ayırmışken bu ikisi ayırmamış.
   Etkisi yanlış sonuç değil GECİKME (serileşme) - ama asimetri belgesiz.
   Bu bilinçli bir kabul mü, gözden kaçmış mı? Çakışma olasılığını hesapla.

6. SON ADMİN KORUMASI. permission-management'ta 'perm-admin-guard' kilidi son admin'in
   yetkisinin düşürülmesini engelliyor. Bu guard TÜM yolları kapsıyor mu (kullanıcı silme,
   pasifleştirme, rol şablonu uygulama, izin kaldırma, şablon silme)? Bir yol atlanırsa
   sistem yönetici olmadan kalır -> kurtarma yolu var mı?

7. JWT. auth.service.ts:35-45 JWT_SECRET < 32 karakter ise boot'ta patlıyor (iyi).
   Token ömrü ne, refresh var mı, revocation nasıl (Session tablosu jti bazlı)?
   verifyToken her istekte session.findUnique yapıyor - yani revocation anlık.
   Çıkış (logout) gerçekten session'ı öldürüyor mu?
   NOT: .env'in git'te olduğu ve JWT_SECRET'ın orada bulunduğu ANA OTURUMDA DOĞRULANDI -
   o bulgu OPS.veri-performans hücresine ait, burada TEKRAR ETME, related ile bağla.

BİTİŞ KRİTERİ: 7 madde karara bağlanacak. Madde 1 iki ayrı failure_mode üretecek.
Madde 6 için "kurtarma yolu var mı" sorusu mutlaka cevaplanacak.
```

---

### C2 — `OPS.veri-performans`

**Kapsam:** `src/services/backup.service.ts` · `backup-impact.service.ts` · `db-copy.service.ts` (931) ·
`db-copy-verify.service.ts` · `helpers/pg-tool.helper.ts` · `helpers/pg-admin-client.ts` ·
`jobs/backup-scheduler.ts` · `jobs/archive-scheduler.ts` · `ecosystem.config.js` · `.env` durumu

**Kapsam DIŞI:** `/health` içeriği ve hata yolu → A2. Deploy prosedürünün kendisi (repo dışı gerçekler).

**Okunacaklar:** `audit/surface/08-deploy-topolojisi.md` (tamamı) · `07-async-yuzey.md` §1, §6.1, §10

**Prompt:**

```
<ORTAK BAŞLIK>  cell = OPS.veri-performans

GÖREV: Veri kaybı yolları. Blast radius = VERİ (canlı fabrika verisi, geri dönüşü yok).

ANA OTURUMDA DOĞRULANMIŞ BULGU (genişlet, yeniden keşfetme):
Teks-Erp/.env GIT'TE İZLENİYOR. `git ls-files` doğruladı, 3 commit var
(en yenisi "chore(env): ... JWT secret rotasyonu"), repo GitHub'a push ediliyor
(git@github.com:oguzhandemirc/TeksERP.git). Dosya DATABASE_URL ve JWT_SECRET taşıyor.
.gitignore'da .env var ama dosya zaten index'te olduğu için kalıp ETKİSİZ.

1. Bu bulguyu FINDINGS'e yaz (severity: kritik, category: guvenlik, prod_risk: yuksek).
   fix_sketch'te ÜÇ ayrı karar olmalı: (a) git rm --cached + .gitignore doğrulama,
   (b) sahadaki JWT_SECRET repo'dakiyle AYNI MI (repodan cevaplanamaz - ŞÜPHELİ işaretle,
   doğrulama adımı yaz), (c) aynıysa secret rotasyonu + tüm oturumların geçersiz kılınması,
   (d) git geçmişinden temizleme kararı (repo public mi private mi - bu da repodan cevaplanamaz).
   Deponun görünürlüğünü VARSAYMA.

2. OFFSITE YEDEK YOK. ecosystem.config.js BACKUP_OFFSITE_DIR: "" (boş). Tüm yedekler
   BACKUP_DIR = C:/Etkili-Yazilim/backups, yani DB ile AYNI DİSKTE. Tek disk arızası =
   veri + yedek birlikte. Ayrıca gece yedeğinin sahibi bağımsız bir Windows Görev Zamanlayıcı
   görevi (BACKUP_SCHEDULE_ENABLED=false), yani backend bunu göremiyor ve /health'in
   lastBackup alanı o dosyaları görüyor mu - DOĞRULA.

3. runTool TIMEOUT'SUZ (pg-tool.helper.ts:8,44). pg_dump/pg_restore/psql spawn ediliyor,
   child asılırsa promise HİÇ SETTLE OLMUYOR. Telafi yalnız çağıran tarafta: verifyBackupFile
   Promise.race 30 sn, scheduler'da 3 saatlik watchdog - ama watchdog bayrağı bırakır,
   CHILD HÂLÂ KOŞUYOR. Ayrıca damga işin BAŞINDA yazılıyor -> başarısız yedek o gün
   TEKRAR DENENMİYOR. Somut failure_mode: asılı dump -> o gün yedek yok -> kimse fark etmiyor
   (arşiv işinin aksine yedeğin BACKUP_FAILED audit'i var - bu yolda tetikleniyor mu?).

4. db-copy.service (931 satır): CREATE DATABASE + pg_restore + iki ALTER DATABASE RENAME,
   withAdminClient(..., { statementTimeoutMs: 0 }) ile statement timeout KAPATILIYOR.
   Bu, canlı DB üzerinde en yıkıcı işlem. Guard'ları TEK TEK doğrula: hangi izin gerekiyor,
   onay akışı ne, yanlış hedefe restore edilmesi mümkün mü, "atomik claim" yorumu (satır ~403)
   tek-thread varsayımına dayanıyor - tek process olduğu için bugün doğru, ama bir script
   startCopyJob'u doğrudan çağırırsa?

5. ARŞİV İŞİ SESSİZ. archive-scheduler hatası yalnız console.error'a yazıyor, audit olayı YOK
   (yedeğin BACKUP_FAILED muadili yok). "Arşiv aylardır koşmuyor" nasıl fark edilir?
   SystemLog 6 ayda bir taşınıyor; taşınmazsa tablo ne kadar büyür (dev DB'de 51.281 satır ölçüldü)?

6. LOG ROTASYONU YOK. pm2 kendiliğinden rotate etmiyor; pm2-logrotate ayrıca kurulmalı.
   C:/Etkili-Yazilim/logs sınırsız büyüyor ve DB ile AYNI SUNUCUDA. Disk dolarsa hem backend
   hem PostgreSQL etkilenir. Bu repodan doğrulanamaz (ŞÜPHELİ) - doğrulama adımı yaz (`pm2 ls`).

7. backup-scheduler.ts:85 dueAt.setHours(hour,0,0,0) SÜREÇ SAAT DİLİMİNİ kullanıyor.
   Bu, tüm kod tabanındaki TEK setHours üretim kullanımı; diğer üç eşleşme "bu desen kaldırıldı"
   yorumu. FACTORY_TIMEZONE/factoryDayStart yardımcıları 35 yerde kullanılıyor ama burada değil.
   scripts/test_report_day_boundary.ts SQL'e bakıyor, JS setHours'u GÖRMÜYOR.
   Sahada scheduler kapalı olduğu için etki bugün sıfır - ama bayrak açılırsa sessizce
   yanlış saatte koşar. severity'yi buna göre ver.

8. TEST PAKETİ ORTAM GUARD'I OLMADAN GERÇEK DB'YE YAZIYOR. Ölçüldü (yüzey belgesi 09 §4):
   273 testin 235'i ../src/lib/prisma'yı import ediyor, testlerde 1.539 deleteMany çağrısı var
   (209 dosyada), ve NODE_ENV / "bu DB üretim mi" guard'ı taşıyan test sayısı SIFIR.
   Mock yok - test altyapısı bilinçli olarak "server'sız entegrasyon": DATABASE_URL ne
   gösteriyorsa oraya yazıyor. Kullanıcı belleğine göre dev DB gerçek fabrika verisine çekilmiş.
   SOMUT failure_mode: DATABASE_URL yanlışlıkla saha sunucusunu gösterirse `npm test`
   canlı fabrikaya 1.539 deleteMany gönderir. Tek koruma KONVANSİYON (silme kararları
   TEST-/TST- kod önekine bakıyor) - bu bir sed değil.
   fix_sketch: run-all-tests.ts başına fail-closed bir ortam guard'ı (DATABASE_URL host/db adı
   allowlist'i, ya da üretim işaretçisi varsa exit 1). Bu ürün kodu DEĞİL, test altyapısı -
   yani CANLI SİSTEM riski taşımadan düzeltilebilir. prod_risk: dusuk.
   AYRICA: clean_test_residue.ts'in kendi başlığı "koşucu 180sn'de SIGTERM gönderdiğinde
   finally bloğu HİÇ çalışmaz" diyor -> yarım koşum TEST-SINV-* toplarını envanterde
   hayalet stok olarak bırakıyor ve test_consistency §18'i kalıcı kırmızıya çeviriyor
   (gerçek bir mükerrer bulgusu bu gürültüde kaybolur). Bunu da yaz.

BİTİŞ KRİTERİ: 8 madde karara bağlanacak. Madde 1 mutlaka repo görünürlüğünü VARSAYMADAN yazılacak.
Madde 4 için guard listesi eksiksiz olacak. Madde 8 severity: kritik adayıdır.
```

---

### D1 — `BLG.mimari`

**Kapsam:** `src/services/label.service.ts` (1.984) · `label-template.service.ts` (1.325) ·
`helpers/label-*` (16 dosya) · `helpers/native-*` (2) · `helpers/raster/*` (11 dosya, 1.126) ·
`services/document-render/**` (20 dosya, 5.632) · `printed-document.service.ts` (739)

**Kapsam DIŞI:** belge İÇERİĞİNİN doğruluğu (brüt kuralı vb.) → B6. Belge izinleri → P1 (BLG.GUV).
Etiket/belge CSS yerleşimi ve punto ayarları → **denetim dışı** (ürün kararı alanı).

**Okunacaklar:** `audit/raw/madge-circular.out` (14 satır, tamamı) · `audit/surface/01-modul-haritasi.md` §3, §4.2, §5.8 ·
`audit/raw/jscpd/jscpd-report.json` (yalnız BLG dosyaları, `jq` ile süz)

**Prompt:**

```
<ORTAK BAŞLIK>  cell = BLG.mimari

GÖREV: Etiket/belge alt sisteminin modüler sınırı. Bu, kod tabanının EN BÜYÜK (16.527 satır),
EN ÇOK DEĞİŞEN (churn %21,9) ve EN ÇOK MEKANİK SİNYAL VEREN context'i.

DİKKAT - BU OTURUM BİR REFACTOR ÖNERİSİ ÜRETMEZ. 16.527 satırlık çalışan bir alt sistemi
yeniden yazmak bir denetim bulgusu değildir. Aradığın şey: bu yapının HANGİ SOMUT HATA SINIFINI
üretmeye devam edeceği. "Karmaşık" bulgu değildir; "şu değişiklik yapılırsa şu sessizce bozulur" bulgudur.

DOĞRULANMIŞ TABAN:
- madge 14 circular dependency buldu, 13'ü burada.
- AMA modül haritası ajanı Tarjan SCC ile ölçtü: RUNTIME (value) import döngüsü YOK.
  14'ün hepsi `import type` kenarlarından geliyor ve derlemede silinir.
  Yani madge'in sinyali gerçek ama TEHLİKE SEVİYESİ farklı. Bunu doğrula ve doğru oku.
- jscpd: 32 klon ucu / ~930 satır (kod tabanının en yoğunu).
- document-render/*.html.ts dosyalarının 8'i printed-document.service'i, 2'si
  system-setting.service'i DOĞRUDAN import ediyor -> "saf renderer" değil, kendi verisini çekiyor.
- system-setting.service (fan-in 33) BLG'nin render sözleşmesine bağımlı
  (doc-style, traveler-card.density/fields/sections import ediyor) -> TERS bağımlılık.

1. TİP SÖZLEŞMESİ YANLIŞ DOSYADA. LabelPayload 20 dosyanın ortak sözleşmesi ama 1.984 satırlık
   label.service.ts'in İÇİNDE yaşıyor. 8 helper `import type { LabelPayload } from "../label.service"`
   yapıyor. SOMUT RİSK: biri `import type`'ı `import`'a çevirirse GERÇEK bir runtime döngü doğar
   ve TypeScript UYARMAZ (madge uyarır ama CI'da madge koşmuyor - doğrula).
   failure_mode: ne olur (modül yükleme sırasında undefined, boot'ta mı çalışma zamanında mı)?
   fix_sketch: sözleşmeyi ayrı bir types dosyasına almak - maliyeti ne?

2. BEŞ RENDER YOLU (PPLA, PPLB, ZPL, kanvas-HTML, raster) ve TEK UYGULAMA NOKTASI iddiası:
   config/label-elements.prepareElements. CLAUDE.md diyor ki "yeni bir emitter yazarken
   expandMultilineText'i DOĞRUDAN çağırma: koşul o dilde sessizce çalışmaz".
   DOĞRULA: beş yolun BEŞİ de gerçekten prepareElements'ten geçiyor mu? Biri atlıyorsa,
   showIf koşullu elemanlar o dilde sessizce basılır -> yanlış kalite damgası.

3. FAIL-CLOSED SÖZLEŞMESİ. CLAUDE.md: "SACK şablonu çözülemezse 400 (roll/swatch'a SAPMAZ -
   label-html-landscape.helper bilinmeyen kind'ı ROLL_FINISHED'a düşürüp tire dolu top etiketi
   basardı)". DOĞRULA: bugün her LabelKind için fail-closed mu? Yeni bir LabelKind eklenirse
   (CLAUDE.md 4 literal z.enum + KINDS dizileri + PeripheralDevices tipleri elle güncellenmeli
   diyor) hangi yol sessizce yanlış etiket basar? Bu "elle güncellenmeli" listesinin
   mekanik bir bekçisi var mı?

4. helpers/ İÇİNDE 27 DOSYA ASLINDA BLG'NİN MOTORU (label-*, native-*, raster/*).
   "helpers" adı bunların denetimde atlanmasına yol açıyor. Bunlar arasında domain kuralı
   taşıyan / DB yazan var mı? (Modül haritası §3 "domain kuralı taşıyan helper" sınıfı tanımlıyor.)

5. TERS BAĞIMLILIK: system-setting.service -> document-render/*. Ayar deposu, render
   sözleşmesine bağımlı. CLAUDE.md "dört kapı birlikte güncellenmeli" kuralının kaynağı burası
   (system-setting tipi + sanitizeDocumentsConfig + printed-document.controller.docConfigSchema
   + Electron aynası). BU DÖRT KAPININ MEKANİK BEKÇİSİ VAR MI? CLAUDE.md diyor ki bir kez
   gerçekten atlandı (docConfigSchema) ve "ayar kaydedilir, gerçek baskıda görünür, ama canlı
   önizlemede GÖRÜNMEZ" sessiz hatası doğdu. Bekçi (test_fason_ceki_html §17/§18) bugün
   dört kapıyı da kapsıyor mu, yoksa ikisini mi?

6. KLON YOĞUNLUĞU. document-render/fason-ceki.html.ts (8 klon) ve fason-direct-ship.html.ts (8).
   HTML şablonlarında kopya kısmen meşrudur. Hangileri meşru (görsel şablon), hangileri
   gerçek mantık kopyası (aynı hesap iki yerde)? Yalnız ikincisi bulgudur.

BİTİŞ KRİTERİ: 6 madde karara bağlanacak. Madde 1 ve 5 mutlaka somut failure_mode üretecek.
"Bu alt sistem karmaşık" cümlesi FINDINGS'e YAZILMAYACAK.
```

---

## 8. P1 hücreleri (28) — özet

P0'lar bittikten sonra, defterin gösterdiği önceliğe göre sıralanır. Her biri **1 oturum**.

| Hücre | Odak | ~Oturum |
|---|---|---|
| **`ENV.eszamanlilik`** | **P0'dan indi, kartı §7'de hazır.** KK1 advisory lock sıra invariant'ı · `clientEnteredAt` penceresi · bayrak kapalıyken kalan koruma | 1 |
| **`CORE.tip-guvenligi`** | `req.user?`/`req.device?` opsiyonelliği = fail-open'ın tip ikizi · `bwip-js.d.ts` + `opentype.d.ts` **elle yazılmış ambient declaration** (`strict` korumaz) · `BaseService`'in `Prisma as unknown as` DMMF cast'i | 1 |
| `OPS.guvenlik` | `/health` kimlik doğrulamasız ifşası · audit payload maskelemesi yok · morgan query-string · Docker sertliği | 1 |
| `BLG.guvenlik` | `printed-document` dinamik `DOC_PERMISSIONS` — bilinmeyen `docType`'ta fail-open mu? `reissue` yazma ucu | 1 |
| `RAP.dogruluk` | 7 rapor servisi domain kurallarını **kopyalıyor** (`K18_DEAD_STATUSES`, brüt kuralı); yalnız 4 bekçi | 1 |
| `CORE.eszamanlilik` | `latency-persist` `findUnique→update` yarışı · `inFlush` kapanış flush'ını yutuyor · promise-zinciri yazma kuyrukları | 1 |
| `BLG.veri-performans` | `freezeForSource` tx içinde belge üretiyor (4 seri ayar okuması) · raster render CPU (tek process) | 1 |
| `BLG.dogruluk` | Donmuş belge ↔ canlı içerik ayrımı · `planKey` revizyon hesabı · `showIf` kalite koşulu | 1 |
| `BLG.izolasyon` | İç notun müşteri belgesine sızması (opt-in allowlist ↔ blocklist ayrımı) | 1 |
| `URE.mimari` | 6.073 satırlık dosya · `helpers/` içindeki domain servisleri · FASON'un üretim durum makinesine yazması | 1 |
| `URE.dogruluk` | "Giriş noktası" kuralı · rota hedefi ↔ iş emri hedefi çevirisi · kapanış dispozisyonu | 1 |
| `URE.veri-performans` | `Roll` 86 alan / 21 index · `producedOutputWhere` · liste sorguları | 1 |
| `IST.dogruluk` | Kalite kararı · `RollError` yaşam döngüsü · bypass uygunluk yüklemi tek kaynak mı | 1 |
| `IST.veri-performans` | `finalize`'ın sorgu sayısı · `listOpenCards` 5 sn yoklama maliyeti | 1 |
| `FAS.mimari` | 4 dosyada 8.244 satır · `subcontractor.service` 6.055 · sınır ihlalleri | 1 |
| `FAS.dogruluk` | Kabul metrajı · parti izlenebilirliği · iptal/geri alma semantiği | 1 |
| `FAS.veri-performans` | Üç dev tx'in sorgu maliyeti | 1 |
| `SEV.veri-performans` | `accounting-export` 2000 sevkiyat × çeki satırı · `sack-search` | 1 |
| `ENV.veri-performans` | `rolls` 21 index · sekme sıralamaları (`status, updatedAt`) · filtre çoklu seçim | 1 |
| `ENV.dogruluk` | `RollStatus` geçiş kuralları 11 context'te ayrı ayrı uygulanıyor | 1 |
| `SIP.veri-performans` | `order.service` 2.819 satır · `shippedQty` türetimi | 1 |
| `SIP.dogruluk` | Sipariş karşılama · `OrderLine` tahsis · durum yeniden hesabı | 1 |
| `KIM.izolasyon` | RBAC kapsamı · rol şablonu uzlaştırma · cihaz/oturum bağlama · 7 izin hiçbir kullanıcıda yok | 1 |
| `OPS.ops` | Zamanlayıcıların sessiz başarısızlığı · tek-process invariant'ının bekçisi | 1 |
| `OPS.eszamanlilik` | İki scheduler'da dağıtık kilit yok · `running`/`checking` bayrakları process-local · damga politikaları ters (biri işin başında, biri sonunda) | 1 |
| `KIM.eszamanlilik` | `session-registry` advisory lock · son-admin guard yarışı · `Session` jti yaşam döngüsü | 1 |
| `RAP.veri-performans` | 29 ham SQL aggregate · `reports/` domain servislerini hiç import etmiyor · index kullanımı | 1 |
| `DON.guvenlik` | RAW TCP hedefi veriden geliyor (SSRF-benzeri); Faz-2 canlıda açık mı | 1 |

---

## 9. Toplam oturum tahmini

| Faz | Hücre | Oturum |
|---|---|---|
| Yüzey haritası | — | **1 (TAMAMLANDI)** |
| P0 | 12 | **12** |
| P1 | 28 | **28** |
| Sentez + defter uzlaştırma | — | **2** |
| **TOPLAM** | | **~43 oturum** (yüzey dahil) |

P2 hücreleri (35) **planlanmadı**: P0+P1 bittikten sonra defterin gösterdiği desene göre
seçmeli koşulur. Hepsini koşmak ~80 oturum eder ve getirisi düşer.

**Gerçekçi asgari:** yalnız P0 = **12 oturum**, kritik yolların tamamını kapsar.

---

## 10. Kapsanmayan Alan

Brief'in kuralı gereği burada **öneri yok, gerekçeli liste var**. Kararlar kullanıcıya aittir.

### 10.1 BLOKLAYICI — brief'te adı geçen iki skill sistemde YOK

```
~/.claude/skills/express-api-audit   -> DİZİN YOK
~/.claude/skills/code-review-skill   -> DİZİN YOK
```

Doğrulama: `ls ~/.claude/skills/` beş skill gösteriyor (`find-skills`,
`generic-react-ux-designer`, `nextjs-expert`, `tailwindcss`, `ui-designer`);
`~/.agents/skills/` aynı beşi içeriyor; `find ~ -maxdepth 6 -type d -name "express-api-audit"`
ve `-name "code-review-skill"` **boş** döndü; proje `.claude/` dizininde de yok.

Bu planın "Skill" sütunu bu iki adı taşıyor çünkü brief listeyi **sabit** ilan etti ve
alternatif önermeyi yasakladı. **Karar sizin:** (a) skill'ler kurulacak/yazılacak mı,
(b) yoksa oturumlar promptlarla mı koşacak (promptlar bu belgede tam yazılı ve skill'siz
çalışacak biçimde kuruldu — yani plan skill olmadan da yürütülebilir).

### 10.2 Mekanik araçların ölçülmüş sınırları

| Araç | Sınır | Sonucu |
|---|---|---|
| **semgrep** | 561 kuralın yalnız **78'i** TypeScript'e uygulanabildi (72 ts + 6 multilang). `p/nodejs` setinin büyük kısmı JS/Express kalıplarına bakıyor. | "0 bulgu" = "bu 78 desende eşleşme yok". Güvenlik kapsaması **dar**. semgrep `semgrep login` ile daha fazla ücretsiz registry kuralı öneriyor (hesap gerektirir). |
| **knip** | ~~config yok~~ → **ÇÖZÜLDÜ (2026-08-09)**: `Teks-Erp/knip.json` yazıldı ve araç yeniden koştu. | Artık kullanılabilir: 0 unused file · 19 unused export · 3 unused type · 1 unused devDependency. Bu bir araç ekleme değil, mevcut aracın yapılandırılmasıydı. |
| **eslint** | Yalnız 2 kural aktif (bilinçli). | Lint katmanı denetime **girdi vermiyor**; async disiplini (`no-floating-promises`) ölçülmedi. |
| **madge** | `import type` ile `import` ayırmıyor. | Bildirdiği 14 döngünün hepsi tip seviyesinde (Tarjan SCC ile doğrulandı). Ham sayıya bakan bir okuma **yanlış alarm** üretir. |
| **jscpd** | Yalnız sözdizimsel kopya. | %1,63 düşük ama semantik kopya (aynı kuralın iki yerde ayrı yazılması — `reports/` vakası) **görünmez**. |
| **npm audit** | Geçişli bağımlılıkların üretim yolunda olup olmadığını söylemiyor. | 4 high'ın (`brace-expansion`, `fast-uri`, `hono`, `js-yaml`) üretim çalışma yolunda olup olmadığı **doğrulanmadı** — `hono`/`valibot` muhtemelen `@prisma/dev` üzerinden geliyor. ŞÜPHELİ. |

### 10.3 Bu araç setinin hiç ölçmediği alanlar

Aşağıdakiler için brief'in listesinde araç yok. Yeni araç **önerilmiyor**; boşluk kayda geçiriliyor.

1. **Yük / performans davranışı.** 20 sn transaction bütçesinin gerçekte ne kadar dolduğu,
   havuzun (max 30) vardiya pikinde nasıl davrandığı, barkod sayacı kilidinin beklemesi —
   hiçbiri statik analizle ölçülemez. Repoda `npm run test:load` (`scripts/load_test.ts`) var ve
   CI'da `continue-on-error: true` ile koşuyor; kapsamı bu denetimde incelenmedi.
2. **Runtime güvenlik testi (DAST).** Guard kapsaması statik olarak ölçüldü ama
   "bu uç gerçekten 401 dönüyor mu" çalıştırılarak doğrulanmadı.
3. **Bağımlılık lisans uyumu.** `npm audit` güvenlik açığına bakar, lisansa bakmaz.
4. **Veritabanı sorgu planları.** Dev DB'de `ANALYZE` koşmamış (`n_live_tup` sıfır döndü) ve
   satır sayıları üretimle örtüşmüyor (`rolls` dev'de 99, sahada binlerce). `EXPLAIN` sonuçları
   dev'de **anlamlı değil**. Index yeterliliği (223 index, `rolls`'ta 21) ancak üretim
   istatistikleriyle değerlendirilebilir.
5. **Repodan cevaplanamayan üretim gerçekleri.** Bunlar denetimde `ŞÜPHELİ` kalacak ve
   sizden bilgi istenecek: sahadaki `JWT_SECRET` repo'dakiyle aynı mı · GitHub deposu public mi ·
   `pm2-logrotate` kurulu mu · `label.nativeSendEnabled` (RAW TCP) açık mı ·
   `kk1.duplicateGuardEnabled` açık mı · üretim `SystemLog`'unda P2028/P2034 görülmüş mü.
6. **`scripts/` dizininin kendisi (68.884 satır).** Bekçilerin **doğru şeyi ölçüp ölçmediği**
   ayrı bir denetim konusudur. Bu planda yalnız "kapsama vekili" olarak sayıldı;
   bekçi körlüğü (test yeşil ama kuralı ölçmüyor) üç yerde nokta atışı sorgulanıyor
   (ENV.ESZ madde 1, A4 madde 1, D1 madde 5). Sistematik bir bekçi denetimi **planlanmadı**.
   Not: 273 bekçinin 31'i kendini "bekçi" ilan ediyor, 13'ü somut bir saha vakasına atıf yapıyor,
   **5'i "negatif sondayla kırmızı verdiği doğrulandı" yazıyor** ve 8'i körlük zemini kuruyor —
   yani kültür var, ama 273'ün 5'inde kanıt var.

### 10.5 Yüzey haritasının kendi ölçtüğü boşluklar — hangileri plana girdi

Onuncu ajan (tamlık eleştirisi) `src/`'in **%21,3'ünün (118 dosya / 22.126 satır)** hiçbir yüzey
belgesinde adının geçmediğini ölçtü. Beş boşluğun üçü artık kapsanıyor, ikisi kapsam dışı kaldı:

| Boşluk | Satır | Durum |
|---|---:|---|
| `src/utils/**` (query-parser, cursor, app-error, code-format, barcode-retry, p2002) | 909 | **A4'e girdi** (madde 5-7) |
| `src/controllers/**` (13'ünün adı hiç geçmiyor) | 6.714 | **A4'e girdi** (madde 1-4) |
| `src/types/**` (`express-augment`, `api.types`, iki ambient declaration) | 185 | **A4 madde 8 + CORE.tip-guvenligi P1** |
| `src/config/label-elements.ts` (`prepareElements`, `showIf` — beş render yolunun ortak kapısı) | 606 | **D1 madde 2'de zaten sorgulanıyor** |
| `src/config/label-icons.data.ts` + `label-kind.schema.ts` | 223 | **KAPSAM DIŞI** — veri katalogları; D1'in `LabelKind` sorusuna dolaylı girer |
| `src/lib/string-validators.ts` + `zod-locale.ts` | 194 | **KAPSAM DIŞI** — girdi doğrulama yüzeyine ait; A4 madde 4'e eklenebilir, bilinçli olarak eklenmedi (oturum şişmesin) |

Eleştirinin kategori olgunluk değerlendirmesi: eşzamanlılık **kısmi** · mimari **yeterli** ·
güvenlik **kısmi (iyi tarafta)** · veri/performans **kısmi** · doğruluk **kısmi** ·
API sözleşmesi **zayıf** · tip güvenliği **haritalanmadı** · ops **kısmi (iyi tarafta)**.
Son iki değerlendirme, `CORE.API`'nin P0'a ve `CORE.tip-guvenligi`'nin P1'e çıkmasının gerekçesidir.
7. **`Electron/` ve `mobil/` istemcileri.** Kapsam dışı (brief "Node.js / Express API" dedi).
   Ama API sözleşmesi ihlalleri iki taraflıdır: backend'in doğru olduğu bir sözleşmeyi istemci
   yanlış kullanıyorsa bu denetim onu görmez.

### 10.4 Bilinçli olarak denetim dışı bırakılanlar

- **Belge/etiket CSS yerleşimi, punto, kenar boşluğu.** Ürün kararı alanı; `CLAUDE.md` bunları
  ayrıntılı biçimde ürün gerekçeleriyle belgelemiş. Denetim bunları "yanlış" ilan edemez.
- **Türkçe hata mesajlarının metni.** Konvansiyon, kusur değil.
- **`docs/` altındaki bayat dokümanlar** (örn. `README-DOCKER.md` silinmiş bir dizini öneriyor).
  Kayda geçirildi ama denetim hücresi açılmadı.

---

## 11. Kararlar — 2026-08-09'da alındı

| # | Karar | Sonuç | Durum |
|---|---|---|---|
| 1 | Skill'ler | **Kurulacak** — `express-api-audit` + `code-review-skill` yazıldı | ✅ Tamam |
| 2 | Kapsam | **Yalnız 12 P0** (12 oturum). P1'ler defterin gösterdiği desene göre sonra değerlendirilir | ✅ Karar verildi |
| 3 | `knip.json` | **Yazıldı**, araç yeniden koştu, sonuç kullanılabilir | ✅ Tamam |
| 4 | `semgrep login` | **Hayır** — kural seti olduğu gibi kalıyor; sınırı §10.2'de yazılı ve denetim ona güvenmiyor | ✅ Karar verildi |
| 5 | Acil bulgular | **Hemen ele alınacak** | Kısmen — aşağı bak |
| 6 | Üretim gerçekleri | Sorulmadı; ilgili bulgular `ŞÜPHELİ` kalacak ve oturumlar bilgi isteyecek | Açık |

### Karar 5'in durumu

- **F-OPS-VER-002 (test paketi ortam guard'ı) — ÇÖZÜLDÜ.** `scripts/run-all-tests.ts`'e
  fail-closed `productionDbGate()` eklendi ve beş sondayla doğrulandı. Defterde
  `status: duzeltildi`. CI bozulmadı (CI host'u `localhost`).
- **F-OPS-VER-001 (`.env` git'te) — REÇETE HAZIR, UYGULANMADI.** Reçete:
  `audit/REMEDIATION-env-secret.md`. Uygulamama sebebi teknik değil operasyonel:
  çalışma ağacı şu anda **paylaşımlı** (başka bir oturum Electron Quality Scorecard
  işinde, 7 değiştirilmiş + 6 izlenmeyen dosya) ve `git rm --cached`'in ürettiği
  staged deletion o oturumun commit'ine süpürülebilir. Ağaç sakinken tek oturumda
  koşulmalı. Rotasyon kararı sahadaki secret ile repodakinin **hash karşılaştırmasına**
  bağlı; reçetede iki komut da yazılı ve değer hiçbir yere basılmıyor.

### Hâlâ açık olan tek soru

**Üretim gerçekleri** (§10.3 madde 5): sahadaki `JWT_SECRET` repo'dakiyle aynı mı ·
GitHub deposu public mi · `pm2-logrotate` kurulu mu · `label.nativeSendEnabled` açık mı ·
`kk1.duplicateGuardEnabled` açık mı · üretim `SystemLog`'unda P2028/P2034 görülmüş mü.
Bunlar repodan cevaplanamaz. Sağlanmazsa ilgili bulgular `confidence: supheli` kalır ve
`verification` alanına "nasıl kesinleşir" yazılır — denetim durmaz.
