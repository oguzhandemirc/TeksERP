# PARTİ MODELİ TASARIMI — İş Emri / Parti / Top Ayrışması

> **Durum:** 2026-07-13 tasarım → **UYGULANDI** (Batch modeli, `Roll.batchId`, `WorkOrder.workOrderNumber`
> rename, üç redye modu, K5 oto-böl, K8 araçları, K11 merge). `batchSplitId`/"dal" kaldırıldı.
>
> **⚠️ SUPERSEDED EKSEN — refakat kartı:** Bu dokümanın orijinal "kart parti başına doğar (RK
> prefix'i, per-batch)" tasarımı **2026-07-14 "kart iş emriyle doğar" redesign'ıyla GEÇERSİZDİR.**
> Güncel gerçek: refakat kartı **iş emri açılışında** doğar (`createForWorkOrder`), **bir WO = tek
> kart** (`TravelerCard.workOrderId @unique`), karekod/`cardNumber`/`barcode` = İş Emri No (İE,
> tek-kod); **parti (Batch) yeni kart ÜRETMEZ** (`createBatchTx` kart yaratmaz). **Bu redesign'ın
> etkilediği gövde bölümleri (K2, K7, §3, §4.2, §5.1/5.3/5.5/5.7, §6, §7.1/7.2, §8, §9, §10, §11,
> §12) 2026-07-14'te güncel koda göre YENİDEN YAZILDI** — artık per-batch kart ifadesi taşımazlar
> (üzeri çizili/İPTAL notları tarihsel iz için bırakıldı). Parti izlenebilirliği `Batch` +
> `Roll.batchId` ile korunur; sadece karta bağlanmaz.
>
> **Not:** Fason sevk kod prefix'i gerçekte `FS`, mal kabul `FK` (şema yorumlarında yer yer eski
> `SD-`/`SR-` geçebilir — kod `subcontractor.service.ts` `buildDailyCode("FS"|"FK")`); idempotency
> katmanı (`WorkOrder.clientToken @unique`) bu redesign sonrası eklendi.

---

## 1. Neden — Sorunun Teşhisi

Bugünkü model iki kavramı tek kimliğe sıkıştırıyor:

- `WorkOrder.batchNumber` (P+GGAAYY+NNNN) hem **iş emri numarası** hem **parti numarası** gibi davranıyor.

> ⚠️ **Parti numarası biçimi 2026-08-05'te DEĞİŞTİ (bu belge orijinal tasarımdır):** varsayılan artık `P01…P99`, P99'dan sonra körlemesine `P01`'e sarar (`batch.shortNumberEnabled`, açık). `batchNumber` üzerindeki `@unique` KALDIRILDI (migration `20260805120000_batch_short_number`) — partinin kimliği yalnız `Batch.id`'dir, yarış `pg_advisory_xact_lock(8022)` ile çözülür ve `orderBy: { batchNumber }` YASAKTIR. Aşağıdaki günlük kalıp (`P+GGAAYY+sıra`) bayrak kapalıyken üretilir. Canlı kural: `docs/kurallar/parti.md`.
- Aynı WO'nun kumaşı fasona parça parça gidince her sevk bir **"dal"** oluyor (`batchSplitId = dispatch.id`).
  "Dal" sektörel bir kavram değil — top etiketi/kesimhane dilinde karşılığı yok.

Sektör standardı hiyerarşi ve fabrika gerçeği:

| Katman | Anlamı | Sayı ilişkisi |
|---|---|---|
| **İş Emri** | İdari üretim emri (planlama birimi) | 1 WO → N parti |
| **Parti** | İzlenebilirlik/lot birimi — **üretime aynı anda giren top grubu** | 1 parti → N top |
| **Top** | Fiziksel rulo | — |

**Onaylı parti tanımı:** *"Üretime farklı anlarda giren toplar farklı partidir."* Kazan, tanımın
parçası **değil** — ama fabrika kuralı ("aynı anda giden kumaş aynı kazanda boyanır") + bu
tasarımın kısmi-sevk kuralı birlikte, bir partinin asla iki kazan görmemesini garanti eder.
Tanım ayrıca ham-kumaş lot farkını da (ton farkının ikinci kaynağı) doğal olarak yakalar ve
hiç boya görmeyen ham akışı da kapsar.

---

## 2. Onaylı Karar Defteri (2026-07-13)

| # | Karar |
|---|---|
| K1 | Hiyerarşi: **İş Emri (1) → Parti (N) → Top (N)**. Parti birinci sınıf nesne (yeni `Batch` modeli). "Dal" kavramı ve `batchSplitId` tamamen kalkar. |
| K2 | Kodlar: İş Emri **`IE+GGAAYY+NNNN`**, Parti **`P+GGAAYY+NNNN`** (bağımsız günlük sıra), Top `T+GGAAYY+H/F+NNNN` (mevcut). **Refakat Kartı'nın AYRI kodu YOK** — ~~`RK+GGAAYY+NNNN`~~ tasarımı 2026-07-14 "kart iş emriyle doğar" ile terk edildi: kart WO açılışında doğar, `cardNumber = barcode = workOrderNumber` (İE), `TravelerCard.workOrderId @unique` (`traveler-card.service.ts createForWorkOrder`). |
| K3 | Parti doğuş anı: **iş emrine top ekleme (attach) dalgası**. Her ekleme varsayılan olarak yeni parti doğurur. |
| K4 | Sonradan ekleme **seçimli**: operatör isterse HENÜZ FASONA SEVK EDİLMEMİŞ mevcut partiye ekleyebilir; sevk görmüş parti kilitli. |
| K5 | Kısmi fason sevk: **giden toplar orijinal parti numarasını taşır, geride kalanlar otomatik yeni parti olur** (tx içinde; parti asla iki kazana bölünmez). |
| K6 | Yeni parti yalnız **yeni kazan girişinde** doğar: aynı renge yeniden boyama → **aynı WO'da yeni parti**; farklı renge ayırma (boyandıktan sonra) → **yeni WO + yeni parti**; boyanmadan ayırma (kazan görmedi) → **parti no korunur**, parti yeni WO'ya taşınır. |
| K7 | ~~Refakat kartı **parti başına**~~ — bu karar 2026-07-14 redesign'ıyla GEÇERSİZ. **Fiili kurallar (uygulanan):** refakat kartı **iş emri başına** (WO açılışında doğar), `TravelerCard.workOrderId @unique`; QR/karekod değeri = `cardNumber` = `barcode` = **İş Emri No (İE)** (tek-kod, versiyonlar arası sabit). Parti no + İE no kartta **yazılı bilgi** (snapshot). Yeniden basımda **aynı satırda** `version++`, karekod aynı kalır (İE), **VOID yok**; VOID yalnız WO iptalinde gelir (VOIDED kart okutulunca red). Parti (Batch) **yeni kart üretmez**. |
| K8 | Düzeltme araçları (üçü de onaylı): **top taşı** (aynı WO içi, iki parti de sevksizken), **parti birleştir** (iki sevksiz parti), **elle parti böl** (sevksiz parti). |
| K9 | Ham (fason görmeyen) akış da partili — parti tanımı kazana bağlı olmadığından ayrım gerekmez. |
| K10 | **Bir sevk = bir parti** (§7.1). İki parti aynı araçla gidebilir ama aynı sevk kaydını paylaşamaz. |
| K11 | *(2026-07-13 ek karar)* Sevk seçimi **birden çok partiye yayılırsa sistem uyarır ve birleştirmeyi önerir**: kazana birlikte giren içerik dönüşte partilere ayrıştırılamaz → ya **birleştir** (varsayılan; en eski partinin numarası yaşar, tek sevk) ya **ayrı gönder** (parti başına ayrı sevk kaydı — yalnız boyahanede fiilen ayrı işlenecekse). Bkz. §7.2. |

---

## 3. Kod Formatı & Üretimi

Tümü mevcut `utils/code-format.ts` altyapısıyla (`dailyCodePrefix` / `buildDailyCode` /
`nextDailySeq` / `isDailyCode`) + `withBarcodeRetry` (sequence okuma closure/tx İÇİNDE — çekirdek
kontrol listesi kuralı).

| Nesne | Prefix | Üretim | Manuel giriş |
|---|---|---|---|
| İş Emri (`WorkOrder.workOrderNumber`) | `IE` | WO create'te otomatik | **Var** — bugünkü `manualBatchNumber` davranışı ad değiştirerek sürer (`manualWorkOrderNumber` + benzersizlik kontrolü) |
| Parti (`Batch.batchNumber`) | `P` | Parti doğarken otomatik | **Yok** — parti numarası pazarlık konusu değil, hep otomatik |
| Top (`Roll.barcode`) | `T` | Mevcut — değişmez (`T+GGAAYY+H/F+NNNN`, `helpers/roll-barcode.helper.ts`) | — |
| Refakat Kartı (`TravelerCard.cardNumber`/`barcode`) | **`IE` (kart ayrı kod almaz)** | **WO açılışında** otomatik (`createForWorkOrder`); `cardNumber = barcode = workOrderNumber` (bkz. §6) | — |

Mevcut `P` günlük sequence'i `work_orders`'tan `batches`'e taşınır; `IE` yeni sequence açar.

---

## 4. Veri Modeli

### 4.1 Yeni model: `Batch` (`batches`)

```prisma
model Batch {
  id          String  @id @default(uuid()) @db.Uuid
  /// Parti numarası: P + GGAAYY + NNNN (günlük sıra). Tek-kod: etikette/kartta
  /// yazılan da taranabilir referans da budur.
  batchNumber String  @unique @db.VarChar(64)
  workOrderId String  @db.Uuid

  /// Parti soy bağı — kısmi sevk kalanı / elle bölme / redye'da kaynak parti.
  /// NULL = doğrudan ekleme dalgasıyla doğan kök parti.
  splitFromId String? @db.Uuid

  workOrder     WorkOrder      @relation(fields: [workOrderId], references: [id])
  splitFrom     Batch?         @relation("BatchSplitLineage", fields: [splitFromId], references: [id])
  splitChildren Batch[]        @relation("BatchSplitLineage")
  rolls         Roll[]
  dispatches    SubcontractorDispatch[]
  // NOT: `travelerCards` ilişkisi YOK — kart iş emrine bağlı (`TravelerCard.workOrderId`),
  // partiye değil. (2026-07-14 "kart iş emriyle doğar" — plandaki per-batch kart terk edildi.)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([workOrderId])
  // Null-yoğun — migration'da partial'a çevrilir (IS NOT NULL, drift-free desen)
  @@index([splitFromId])
  @@map("batches")
}
```

**Bilinçli olarak YOK:**
- `status` kolonu — partinin durumu (hazır / fasonda / döndü / bitti) **türetilir**
  (bugünkü `getBranches` lane hesabıyla aynı desen: roll konumları + dispatch/receipt izleri).
  Denormalize durum = drift riski; parti-başına satır sayısı küçük, hesap ucuz.
- `dispatchedAt` / kilit kolonu — **"sevk gördü" tanımı:**
  `EXISTS (SELECT 1 FROM subcontractor_dispatches WHERE batch_id = X AND cancelled_at IS NULL)`.
  Sevk iptali kilidi kendiliğinden geri açar; ayrı bayrak tutulsaydı iptalde senkron sıfırlama
  gerekecekti.

### 4.2 Değişen modeller

| Model | Değişiklik |
|---|---|
| `WorkOrder` | `batchNumber` → **`workOrderNumber`** (IE kodu, `@unique`). Alanın anlamı değişiyor; tüm okuma noktaları (sipariş ekranları, raporlar, etiketler, mobil) taranıp yeni ada geçirilir. `splitFromId` (WO soy bağı) **kalır** — farklı-renk ayırmada hâlâ WO doğuyor. |
| `Roll` | `batchSplitId` **DROP** → yerine **`batchId String? @db.Uuid`** (gerçek FK → `Batch`). Partial index (`WHERE "batchId" IS NOT NULL`, migration `20260606001717` deseni). NULL = hiçbir partiye bağlı değil (serbest STOCK). Kalıtım kuralları §5.4. |
| `TravelerCard` | ~~`workOrderId` → `batchId`~~ **UYGULANMADI** (2026-07-14 redesign). Fiili şema: `workOrderId String @unique` **KALIR** (bir WO = tek kart); `batchId` kolonu **eklenmedi**. `cardNumber`/`barcode` = `workOrderNumber` (İE) — çift kolon aynı değeri tutar (tek-kod), bu projede birleştirilmez. Kart WO açılışında `createForWorkOrder` ile doğar; parti WO'ya `roll.batch → workOrder` üzerinden ilişkilenir, karta ayrı FK yok. |
| `SubcontractorDispatch` | + **`batchId String @db.Uuid`** (zorunlu FK) — **bir sevk = bir parti** (§7.1). `@@index([batchId])`. |
| `SubcontractorReceipt` | Şema değişmez — born roll'lar `batchId`'yi `receipt → dispatch.batchId`'den kalıtır. `getBranches`'teki "bir receipt birden çok sevki kapsarsa doğan toplar hepsine atfedilir" v1 bulanıklığı, sevk=parti kuralıyla kökten çözülür. |

### 4.3 Terminoloji haritası

| Eski | Yeni |
|---|---|
| "Parti No" (WO alanı, UI) | **"İş Emri No"** (`IE…`) |
| "Dal" / "Fason dalı" / lane | **"Parti"** (`P…`) |
| `Roll.batchSplitId` | `Roll.batchId` |
| `getBranches` / `BranchLanes` / "Dallar" paneli | `getBatches` / `BatchLanes` / **"Partiler"** paneli |
| "Parti ayırma" (WO doğuran) | "Farklı renge ayırma" (WO doğar) / "Yeniden boyama" (aynı WO'da parti doğar) |

---

## 5. Parti Yaşam Döngüsü

### 5.1 Doğuş — attach dalgası

Tek entegrasyon noktası: **`attachRolls()`** (`workorder.service.ts` — WO create, quickStart ve
sonradan-ekleme zaten hep buradan geçiyor). Tx içine eklenir:

1. `targetBatchId` **verilmemişse** (varsayılan): yeni `Batch` yarat (`P…` + `withBarcodeRetry`),
   bağlanan tüm toplara `batchId` yaz.
2. `targetBatchId` **verilmişse** (K4): parti bu WO'ya ait mi + **sevk görmemiş mi** doğrula
   (§4.1 kilit tanımı) → toplara o `batchId` yazılır. Sevk görmüşse 409 + Türkçe mesaj
   (*"P… fasona sevk edildi — bu partiye artık top eklenemez, yeni parti açılır"*).
3. **Kart parti doğuşuyla ÜRETİLMEZ** (2026-07-14): refakat kartı WO açılışında zaten doğmuştur (`createForWorkOrder`, İE tek-kod). Yeni parti eklenmesi karta dokunmaz — bkz. §6. `createBatchTx` yalnız `Batch` + `roll.batchId` yazar, kart yaratmaz.

Zero-attach telafisi (WO arşivleme) mevcut haliyle kalır — top yoksa parti de doğmaz.

### 5.2 Kilit kuralı

"Parti sevk gördü" = iptal edilmemiş en az bir `SubcontractorDispatch.batchId` kaydı. Kilitli
partide **yasak**: partiye top ekleme (K4), top taşı/birleştir/elle böl (K8). Kilit, sevk
iptalinde kendiliğinden açılır (dispatch soft-cancel → EXISTS false).

### 5.3 Kısmi sevkte otomatik bölünme (K5)

Fason sevki parti-bazlı kurulur (§7.2). Seçilen toplar partinin **alt kümesiyse**, sevk tx'i içinde:

1. Yeni `Batch` yarat (`splitFromId` = orijinal parti) — **kalan** toplar yeni partiye taşınır
   (`updateMany WHERE batchId = eski AND id IN (kalanlar)` + count doğrulaması — atomik claim deseni).
2. Giden toplar orijinal `batchId`/numarayı korur; `dispatch.batchId` = orijinal parti.
3. **Kart bölünmede değişmez** (2026-07-14): kart iş emri başınadır (İE), parti başına değil — hem giden hem kalan toplar aynı WO'ya ait tek kartı taşır. (Plandaki "kalana yeni kart" adımı terk edildi.)
4. UI sevk onayından ÖNCE gösterir: *"Kalan N top yeni parti olacak"* (yıkıcı-işlem-onayı
   konvansiyonunun hafif hali — burada kayıt listesi değil net sonuç bildirimi yeterli, işlem yıkıcı değil).

### 5.4 Kalıtım (bugünkü `batchSplitId` davranışının birebir devamı)

- **Fason kabul:** born roll'lar (`parentReceiptId` dolu) → `batchId` = `receipt → dispatch.batchId`.
- **Tambur kesimi:** çocuk roll'lar → `batchId` = parent'ın `batchId`'si.
- **Detach / operasyonel reset:** `batchId = null`'a çekilir (bugünkü reset'in `batchSplitId: null` satırı yeni ada taşınır).

Bir parti böylece tüm rota boyunca (fason dönüşü + tambur bölünmesi + depo dahil) tek kimlikle izlenir.

### 5.5 Redye / ayırma (K6) — "yeni parti yalnız yeni kazan girişinde"

Bugünkü `splitBranch` akışı üç yola ayrışır (üçü de mevcut `loadSplitContext` uygunluk
doğrulamasının batch-bazlı uyarlamasını kullanır):

| Senaryo | Parti | WO | Kart |
|---|---|---|---|
| **Aynı renge yeniden boyama** (`REDYE_SAME_COLOR`, ton tutmadı) | Seçilen toplar **yeni parti** (`splitFromId` izi), boyahane adımına geri sarılır | **Aynı WO** — WO çoğalmaz | **Kart değişmez** — WO aynı; kart WO başına (İE), yeni parti kart üretmez |
| **Farklı renge ayırma** (`NEW_COLOR`, boyandıktan sonra) | **Yeni parti**, yeni WO'da doğar | **Yeni WO** (`WorkOrder.splitFromId` izi — renk WO seviyesinde kaldığından zorunlu) | **Yeni WO kendi kartını alır** (`cloneWorkOrderTx → createForWorkOrder`; İE = yeni WO no); eski WO'nun kartı kendi WO'sunda kalır |
| **Boyanmadan ayırma** (`UNDYED_MOVE`, mal fasonda bekliyor, kazan görmedi) | **Parti korunur** (`batchNumber` değişmez), `batch.workOrderId` yeni WO'ya güncellenir; açık sevk yeni WO'ya taşınır | Yeni WO (`cloneWorkOrderTx`) | **Yeni WO kendi kartını alır** (yeni İE) — kart WO'ya bağlı olduğundan taşınan parti yeni WO'nun kartını taşır; eski WO boşalıp kapanırsa kartı `setWorkOrderCardStatuses` ile COMPLETED/VOID |

Eski parti (ilk iki satırda) tüm toplarını kaybederse **silinmez** — sevk/kart/operasyon izi
taşıyan boş parti tarihçedir, Partiler panelinde "→ P-YYY olarak yeniden boyandı / ayrıldı" satırı olur.

### 5.6 Boş parti temizliği

Hiç iz taşımayan boş parti (sevk yok, kart taraması yok, movement/operation izi yok — örn. yanlış
ekleme hemen geri alındı) **hard-delete edilir** — "boş çuval silme" bilinçli istisnası emsal
(root `CLAUDE.md` soft-delete kuralının istisna listesine eklenecek). İz taşıyan boş parti kalır (§5.5).

### 5.7 Düzeltme araçları (K8) — üçü de yalnız sevksiz partilerde

| Araç | Kural |
|---|---|
| **Top taşı** | Aynı WO içindeki iki parti arasında; iki parti de sevksiz. Kaynak boşalırsa §5.6. |
| **Parti birleştir** | İki sevksiz parti → **en eski (önce doğan) partinin numarası yaşar**, diğerinin topları taşınır, boşalan parti §5.6'ya düşer. **Karta dokunmaz** (2026-07-14): kart iş emri başınadır; birleşen partiler zaten aynı WO içindedir → o WO'nun tek kartı değişmeden kalır (VOID/reprint yok — `deleteIfEmptyAndTraceless` de karta dokunmaz). Audit log'a iki numara da yazılır. Sevk kurulumundaki çok-parti uyarısı (K11, §7.2) bu aracın bağlamsal tetikleyicisidir. |
| **Elle böl** | Sevksiz partiden seçilen toplar yeni partiye (`splitFromId` izi) — kısmi sevk otomatiğinin (§5.3) elle tetiklenen hali. |

Hepsi `AuditService.log()` + atomik claim (`updateMany` + count) ile.

---

## 6. Refakat Kartı — İş Emri Başına (2026-07-14 fiili model)

> **Bu bölüm 2026-07-14 "kart iş emriyle doğar" redesign'ına göre YENİDEN YAZILDI.** Planın
> "kart parti başına (RK…)" tasarımı **uygulanmadı**; aşağıdakiler `traveler-card.service.ts` +
> `schema.prisma TravelerCard` gerçeğidir. (Parti izlenebilirliği `Batch` + `Roll.batchId` ile
> korunur — sadece karta bağlanmaz.)

- **Doğum:** Kart **iş emri açılışında** (WO create tx'i içinde) otomatik yaratılır
  (`travelerCardService.createForWorkOrder`, ACTIVE, `version=1`). **Parti (Batch) doğuşu kart
  ÜRETMEZ** — `createBatchTx` yalnız `Batch` + `roll.batchId` yazar. "WO finalize'da kart üretimi"
  eski modeldi; artık açılışta doğar. Fiziksel basım (PrintedDocument) ayrı eylemdir.
- **Kimlik:** QR/karekod değeri = `cardNumber` = `barcode` = **`workOrderNumber` (İE)** — tek-kod;
  karekod versiyonlar arası **SABİT** (WO değişse de kod değişmez, sahada hep aynı karekod). Kart
  **belge** niteliğini korur (snapshot donuk): üzerinde İş Emri No (İE…), ürün/renk/rota; taşınan
  topların Parti No'ları (P…) **yazılı bilgidir** (kart tek İE'ye ait, birden çok parti taşıyabilir).
- **Invariant:** **iş emri başına en fazla 1 kart** (`TravelerCard.workOrderId @unique` — partial
  değil, sert unique). **Reprint AYNI satırda:** snapshot güncel WO'dan tazelenir + `version++`,
  **kod değişmez, VOID YOK** (ayrı REPRINTED durumu yok). VOID yalnız **WO CANCELLED** olunca gelir
  (`setWorkOrderCardStatuses` fan-out); VOIDED kart okutulursa açık red.
- **Tarama akışı:** `scan()` kartı çözer → `card.workOrder` → adım eşleşmesi (WO-seviyesi). Kartın
  taşıdığı topların partisi `roll.batch` üzerinden ayrıca izlenir; kart tek başına "hangi parti"yi
  değil "hangi iş emri"ni taşır — parti bilgisi top/scan bağlamından türetilir.
- **Adım durum makinesi WO-seviyesinde KALIR** (`WorkOrderStep` değişmez). Partiler aynı adım
  kayıtlarından farklı zamanlarda geçer; adımın "bitti mi" hesabı WO-bazlı recompute'tur.

---

## 7. Fason Akışı Değişiklikleri

### 7.1 Bir sevk = bir parti (K10 — tasarım netleştirmesi)

`SubcontractorDispatch.batchId` zorunlu tek FK. **Gerekçe:** fason dönüşünde born roll'ların
parti ataması ancak fiziksel ayrımla güvenilir olur — boyahaneye iki parti tek belge/tek koli
giderse, dönen açık kumaşın hangi partiden geldiği fiziksel olarak ayırt edilemez. Her parti
kendi sevk kaydı (`SubcontractorDispatch`, tek `batchId`) + kendi çekisiyle (fason çeki belgesi)
gider; aynı kamyonu paylaşabilirler (plaka/şoför alanları aynı doldurulur). **Not (2026-07-14):**
refakat kartı iş emri başınadır (parti başına ayrı kart yok) — grupları fiziksel ayıran, parti-bazlı
**sevk kaydı + çeki belgesidir**, kart değil. Kabul ataması yine otomatik ve kesin:
`born.batchId = dispatch.batchId`.

Aynı mantığın ikinci yüzü **K11'dir**: iki parti tek kazana girecekse ayrı tutulmaları kurgudur
(dönüşte atama fiziksel olarak imkânsız) — bu yüzden çok-parti seçiminde sistem birleştirmeyi
önerir (§7.2). Hiçbir durumda tek dispatch iki parti taşımaz.

### 7.2 Sevk kurulumu parti-öncelikli

Bugünkü top-seç modeli, parti-öncelikli akışa döner: **parti seç (veya kartını okut) → toplar
varsayılan tümü seçili → alt küme bırakılırsa §5.3 oto-böl önizlemesi → sevk**. Mobil fason-sevk
ekranında kart okutmak **iş emrini** çözer (kart = İE kimliği); parti seçimi WO'nun partileri
arasından yapılır (kart tek başına partiyi işaret etmez).

**Çok-parti seçimi (K11):** seçim 2+ partiye yayılıyorsa sevk onayından önce modal —
*"Birlikte giden kumaş aynı kazanda boyanır ve dönüşte partilere ayrıştırılamaz."* İki yol:

1. **Birleştir & tek sevk (varsayılan/önerilen):** giden toplar **en eski partinin numarası**
   altında birleşir; her partinin geride kalanı K5 gereği **kendi** yeni partisini alır (kalanlar
   birlikte kazana girmiyor → tek yeni partide toplanmaz); boşalan parti(ler) §5.6; **kart karta
   dokunulmaz** (partiler zaten aynı WO içinde → tek İE kartı; kart-VOID/reprint yok, §5.7). Ardından
   tek dispatch (K10 sağlanır).
2. **Ayrı gönder:** sistem parti başına ayrı dispatch üretir (plaka/şoför alanları kopyalanır —
   tek kamyon); parti başına **çeki** (kart değil — kart WO başınadır); fason talimatına "partiler
   ayrı işlenecek" notu önerilir. Yalnız boyahanenin fiilen ayrı işleyeceği (ayrı kazan/gün)
   biliniyorsa seçilmelidir.

### 7.3 Diğer fason işlemleri

- **Aktarım (fason→fason):** aktarım çıktısı yeni dispatch **aynı `batchId`'yi taşır** (parti
  kazan değiştirmiyor, rota içinde ilerliyor); undo simetrik.
- **Doğrudan sevk:** parti fasondan müşteriye kapanır — mevcut akış, batch üzerinden raporlanır.
- **Sevk iptali:** dispatch soft-cancel; parti kilidi kendiliğinden açılır (§5.2). Kısmi-sevk
  oto-bölünmesi **geri alınmaz** (kalanlar yeni partide kalır — geri birleştirme istenirse K8
  "parti birleştir" aracı zaten var).

### 7.4 Partiler paneli (eski Dallar)

`getBranches` → `getBatches`: lane artık **parti** (dispatch değil). Her satır: `P…` numara +
durum + konum dağılımı. Yeni durum eklenir: **HAZIR** (parti doğdu, henüz hiç sevk görmedi —
ham akışta veya sevk öncesi). Mevcut durumlar (Fasonda / Kısmi dönüş / Döndü / İptal / Doğrudan
Sevk) partinin sevklerinden türetilir. `splitFrom`/`splitChildren` izleri hem parti hem WO
seviyesinde gösterilir (§5.5 tablosundaki üç yol ayrı etiketlenir).

---

## 8. API Değişiklikleri (özet)

| Uç | Değişiklik |
|---|---|
| `POST /api/work-orders` (+quick-start) | `manualBatchNumber` → `manualWorkOrderNumber`; yanıt `workOrderNumber` (IE). Kart WO açılışında doğar (`createForWorkOrder`); attach edilen toplar için ilk parti yanıtla döner. |
| `attachRolls` **servis metodu** (HTTP `PATCH /:id/attach-rolls` **ucu 2026-06-12'de kaldırıldı** — hiçbir frontend çağırmıyordu; quick-start + seed içeriden çağırır) | Body + `targetBatchId?` (K4). Doğan/kullanılan parti döner (`createBatchTx`). |
| `GET /api/work-orders/:id/branches` | **Fiili yol hâlâ `/branches`** (controller `getBranches`) — lane=parti (§7.4). Plandaki `/batches` rename'i Electron Faz 6'ya bırakıldı (KÖPRÜ). |
| `GET /api/work-orders/:id/split-preview` + `POST /api/work-orders/:id/split` | **Fiili yollar** (doc'taki `split-branch` değil): Batch-bazlı üç yol (§5.5): `batchId` + `mode: REDYE_SAME_COLOR \| NEW_COLOR \| UNDYED_MOVE` (`workorder-split.service.ts`). |
| Fason sevk uçları | `batchId` zorunlu (`SubcontractorDispatch.batchId` NOT NULL); kısmi seçimde oto-böl sonucu yanıtta (`remainderBatch`). |
| **Yeni router `/api/batches`:** `POST /api/batches/move-rolls` / `/merge` / `POST /api/batches/:batchId/split` | K8 araçları (`batch.routes.ts` + `batch.controller`); hepsi sevksiz-guard + audit. (Not: WO-scoped değil, ayrı `/api/batches` router'ı.) |
| `GET /api/work-orders/check-batch-number` | **KÖPRÜ:** yol + query param **hâlâ `batchNumber`** (rename yapılmadı); değer artık **İş Emri No (İE)** benzersizliğini kontrol eder, yanıt `workOrderNumber` + `batchNumber` (alias) döner (`checkBatchNumber` controller). |
| Traveler card uçları (`/api/traveler-cards`, `/scan`) | Kart **`workOrderId` bağlamlı** (batchId DEĞİL); `scan()` `card.workOrder`'ı çözer. |

RBAC: yeni uç yok denecek kadar — hepsi mevcut `workorder:read/write` kapsamında; yeni permission gerekmez.

---

## 9. UI Değişiklikleri

### 9.1 Electron

| Dosya/Alan | Değişiklik |
|---|---|
| `WorkOrders/columns.tsx`, listeler | "Parti No" kolonu → "İş Emri No" (`IE…`); parti sayısı rozeti eklenebilir. |
| `WorkOrderFormView/FormPage` | `batchNumber` alanı → `workOrderNumber` (manuel İE girişi + benzersizlik kontrolü). |
| `BranchLanes.tsx` (dosya adı **hâlâ Branch...** — rename KÖPRÜ) | "Partiler" paneli (§7.4). Satır kimliği `P…`; HAZIR durumu; soy bağı satırları üç yolu ayırt eder. K8 araçları `BatchCorrectModal.tsx`'te. |
| `SplitBranchModal.tsx` | Batch-bazlı; üç mod (§5.5). |
| `FasonStepActions/FasonStepRollSelectModal` | Parti-öncelikli sevk (§7.2) + oto-böl önizlemesi. |
| Attach akışı (WO detay "top ekle") | Parti seçimi: ○ Yeni parti (varsayılan) ○ Mevcut sevksiz parti (dropdown). |
| **Yeni:** parti detay/araçlar | Top taşı / birleştir / elle böl (K8) — `PermissionGate workorder:write`. |
| `UndoTransferModal`, `DirectShipModal` | Metinler "dal" → "parti"; davranış aynı. |
| Sipariş/rapor ekranları | `batchNumber` gösterimleri taranır: WO bağlamındakiler İE'ye, top bağlamındakiler topun partisine bağlanır. |

### 9.2 Mobil

> **2026-07-14:** kart **iş emri (İE) kimliğidir**, parti kimliği değil — aşağıda "kart → parti"
> ifadeleri "kart → İE, parti WO bağlamından" olarak okunmalıdır.

- **KK1 / Kurşun-KK2 / Tambur:** kart okutma → **İE bağlamı** (adım çözümü `card.workOrder` üzerinden); adım çözümü aynı. Topların partisi `roll.batch`'ten türetilir. Ekran başlığında İE (+ ilgili top(lar)ın P'si) gösterilebilir.
- **Fason Sevk:** kart okut → **İE çözülür**; parti WO'nun partileri arasından seçilir; alt küme bırakılırsa oto-böl onayı.
- **Fason Kabul:** born roll girişi partiye bağlanır (otomatik — `dispatch.batchId`).
- Kart basım/yeniden basım akışları **WO kartını** (İE, tek-kod) basar — parti başına kart yok.

---

## 10. Etiket & Belgeler

- `config/label-fields.ts`: `batchNumber` alanı **kalır** (defaultLabel "Parti No") ama kaynağı
  değişir → **topun kendi partisi** (`roll.batch.batchNumber`; partisiz topta boş). Yeni alan:
  `workOrderNumber` ("İş Emri No"). Tüm mock payload'lar (`label.service`, `label-rawcode`,
  `sample-data`) güncellenir: `batchNumber: "P…"` + `workOrderNumber: "IE…"`.
- **Refakat kartı şablonu** (`document-render/traveler-card.html.ts`): kartın **iri kimliği İş Emri No'dur (İE)** — bu aynı zamanda `cardNumber`/`barcode`/**QR** değeridir (tek-kod, `workOrderNumber`). Parti No(lar) **yazılı bilgi** satırıdır. (Plandaki "QR = RK" geçersiz — 2026-07-14.)
- **Fason çeki** (`fason-ceki.html.ts`): parti no alanı (sevkin partisi).
- `PrintedDocument` snapshot'ları donuktur — eski basımlar eski düzeniyle kalır, yeni basımlar yeni düzeni alır (mevcut konvansiyon).

---

## 11. Migration & Geçiş

Tüm veriler test verisi (root `CLAUDE.md`) → **dönüşüm scripti YAZILMAZ.** Tek şema migration'ı
+ temiz operasyonel sıfırlama:

1. Migration: `batches` CREATE; `work_orders.batch_number` → `work_order_number` RENAME;
   `rolls.batch_split_id` DROP + `rolls.batch_id` ADD (FK, partial index); `subcontractor_dispatches.batch_id`
   ADD (NOT NULL). **`traveler_cards` ŞEMASI DEĞİŞMEDİ** — plandaki `work_order_id → batch_id` dönüşümü
   2026-07-14 redesign'ıyla İPTAL: `traveler_cards.work_order_id @unique` **korunur** (bir WO = tek kart),
   `batch_id` kolonu eklenmez. Mevcut operasyonel satırlar migration'dan ÖNCE `reset-operational` ile
   temizlenir → NOT NULL/FK'lar boş tabloya güvenle uygulanır (statement_timeout riski yok).
2. `scripts/reset-operational` güncellenir: `batches` truncate sırası (FK zinciri: dispatches → batches → work_orders; `traveler_cards` ayrı zincirde — `work_orders`'a bağlı, batch'e değil).
3. `seed*` scriptleri: IE/P üretimine ve batch yaratımına uyarlanır.
4. Doküman güncellemeleri: root `CLAUDE.md` (Üretim Akışı + Domain Kuralları "dal" cümleleri),
   `Teks-Erp/ARCHITECTURE.md`, bu dokümana referans.

---

## 12. Test Planı

**Güncellenecek mevcut scriptler:** `test_wo_branch_split`, `test_wo_branch_redye`,
`test_wo_input_attach_window`, `test_wo_input_detach_reattach`, `test_fason_parti_grouping`,
`test_fason_dispatch_picker`, `test_fason_transfer_rollids`, `test_fason_undo_transfer`,
`test_split_card_lineage`, `test_traveler_print_active_card`, `test_order_filter_batch_check`,
`test_e2e_full_flow` (+ dokunulan diğerleri derleme hatasıyla kendini gösterir).

**Yeni testler:** (kart-eksenli maddeler 2026-07-14'e göre düzeltildi — kart WO başına, parti kart üretmez)
- Attach → parti doğumu (**kart zaten WO açılışında doğdu**); `targetBatchId` ile sevksiz partiye ekleme; sevkli partiye ekleme 409.
- Kısmi sevk oto-böl: kalanlar yeni parti (**kart değişmez — WO tek kart**); giden no korur; sayı/metraj mutabakatı; eşzamanlı çift sevk yarışı (claim).
- Kalıtım: born roll `batchId` = dispatch partisi; tambur çocukları parent partisi.
- Redye üç yolu (§5.5): parti/WO sonuçları + soy bağı izleri; NEW_COLOR/UNDYED_MOVE'da **yeni WO'nun kartı** (`createForWorkOrder`).
- K8 araçları: sevksiz guard'lar, birleştirmede **karta dokunulmadığı** (WO tek kart), en-eski-numara-yaşar kuralı, boş parti temizliği (§5.6 iz var/yok ayrımı).
- K11 çok-parti sevki: birleştir yolu (en eski no yaşar, kalanlar parti-başına yeni parti, kabul ataması birleşik partiye) ve ayrı-gönder yolu (parti başına dispatch/çeki — kart WO başına).
- Kart: **WO başına tek kart** (`workOrderId @unique`, P2002→409), reprint aynı satırda `version++` (VOID yok), WO iptalinde VOIDED + VOID kart taraması reddi.

---

## 13. Kapsam Dışı / Açık Konular

- **Ham tedarikçi lot katmanı** (stok girişinde parti) — bilinçli kapsam dışı bırakıldı
  (Q&A kararı: parti WO'ya bağlı doğar). İleride ayrı "tedarikçi lotu" alanı gerekirse bağımsız eklenir.
- **Farklı WO'ların partileri** aynı fasona aynı anda giderse (sevk WO-scoped olduğundan sistem
  birleştiremez ve K11 uyarısı tetiklenemez) kazan karışması riski operasyonel talimatla yönetilir;
  WO-ötesi tespit/uyarı ileride değerlendirilir.
- Parti bazlı maliyet/performans raporları — model oturduktan sonra.
- `TravelerCard.cardNumber`/`barcode` çift kolonunun tekilleştirilmesi — bu projeye dahil değil.
- Sevkiyat/çuval domain'i (`shipping.service`) partiye **dokunmaz** — çuval içeriği top bazlı
  kalır; parti yalnız üretim izlenebilirliği. (Etikette parti no görünür, o kadar.)
