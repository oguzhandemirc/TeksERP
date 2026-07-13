# PARTİ MODELİ TASARIMI — İş Emri / Parti / Top Ayrışması

> **Durum:** 2026-07-13 — tasarım soru-cevap oturumuyla ONAYLANDI, kod yazımı başlamadı.
> **Supersedes:** "İş emri = parti" varsayımı (`WorkOrder.batchNumber` = P kodu) ve "dal"
> (`Roll.batchSplitId` = dispatch lane) kavramı. Bu doküman uygulandığında root `CLAUDE.md`,
> `Teks-Erp/ARCHITECTURE.md` ve ilgili UI metinleri güncellenmelidir.

---

## 1. Neden — Sorunun Teşhisi

Bugünkü model iki kavramı tek kimliğe sıkıştırıyor:

- `WorkOrder.batchNumber` (P+GGAAYY+NNNN) hem **iş emri numarası** hem **parti numarası** gibi davranıyor.
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
| K2 | Kodlar: İş Emri **`IE+GGAAYY+NNNN`**, Parti **`P+GGAAYY+NNNN`** (bağımsız günlük sıra), Top `T+GGAAYY+H/F+NNNN` (mevcut), Refakat Kartı `RK+GGAAYY+NNNN` (mevcut). |
| K3 | Parti doğuş anı: **iş emrine top ekleme (attach) dalgası**. Her ekleme varsayılan olarak yeni parti doğurur. |
| K4 | Sonradan ekleme **seçimli**: operatör isterse HENÜZ FASONA SEVK EDİLMEMİŞ mevcut partiye ekleyebilir; sevk görmüş parti kilitli. |
| K5 | Kısmi fason sevk: **giden toplar orijinal parti numarasını taşır, geride kalanlar otomatik yeni parti olur** (tx içinde; parti asla iki kazana bölünmez). |
| K6 | Yeni parti yalnız **yeni kazan girişinde** doğar: aynı renge yeniden boyama → **aynı WO'da yeni parti**; farklı renge ayırma (boyandıktan sonra) → **yeni WO + yeni parti**; boyanmadan ayırma (kazan görmedi) → **parti no korunur**, parti yeni WO'ya taşınır. |
| K7 | Refakat kartı **parti başına** (bugün WO başına). Kart kimliği `RK…` kalır: QR değeri = kart no (tek-kod); parti no + İE no kartta **yazılı bilgi**. Yeniden basımda eski kart VOID → okutulunca red. |
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
| Top (`Roll.barcode`) | `T` | Mevcut — değişmez | — |
| Refakat Kartı (`TravelerCard.cardNumber`) | `RK` | Parti doğarken otomatik (bkz. §6) | — |

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
  travelerCards TravelerCard[]
  dispatches    SubcontractorDispatch[]

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
| `TravelerCard` | `workOrderId` → **`batchId`** (kart partiye bağlanır; WO'ya `batch.workOrder` üzerinden ulaşılır — çift FK tutulmaz, K6'daki WO-taşınma senaryosunda drift olmasın). Partial unique `one-ACTIVE-per-batch`'e döner (migration `20260623110000` deseni). `cardNumber`/`barcode` çift kolonu aynı değeri tutmaya devam eder (tek-kod) — bu projede birleştirilmez. |
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
3. Yeni parti doğduysa refakat kartı da doğar (§6).

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
3. Kalan yeni partiye **yeni refakat kartı** doğar; orijinal kart giden grupla fasona gider.
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
| **Aynı renge yeniden boyama** (ton tutmadı) | Seçilen toplar **yeni parti** (`splitFromId` izi), boyahane adımına geri sarılır | **Aynı WO** — WO çoğalmaz | Yeni partiye yeni kart |
| **Farklı renge ayırma** (boyandıktan sonra) | **Yeni parti**, yeni WO'da doğar | **Yeni WO** (`WorkOrder.splitFromId` izi — renk WO seviyesinde kaldığından zorunlu) | Yeni kart |
| **Boyanmadan ayırma** (mal fasonda bekliyor, kazan görmedi) | **Parti korunur** (`batchNumber` değişmez), `batch.workOrderId` yeni WO'ya güncellenir; açık sevk bugünkü gibi yeni WO'ya taşınır | Yeni WO | **Zorunlu reprint** — karttaki yazılı İE bayatladı; eski kart VOID |

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
| **Parti birleştir** | İki sevksiz parti → **en eski (önce doğan) partinin numarası yaşar**, diğerinin topları taşınır, boşalan parti §5.6'ya düşer (iz yoksa silinir; kartı VOID). Hedef partinin kartı da içerik değiştiği için yeniden basılır (VOID + `version++`). Audit log'a iki numara da yazılır. Sevk kurulumundaki çok-parti uyarısı (K11, §7.2) bu aracın bağlamsal tetikleyicisidir. |
| **Elle böl** | Sevksiz partiden seçilen toplar yeni partiye (`splitFromId` izi) — kısmi sevk otomatiğinin (§5.3) elle tetiklenen hali. |

Hepsi `AuditService.log()` + atomik claim (`updateMany` + count) ile.

---

## 6. Refakat Kartı — Parti Başına

- **Doğum:** Parti doğduğunda kart kaydı otomatik yaratılır (ACTIVE, `RK…`). Fiziksel basım
  bugünkü print akışıyla (PrintedDocument) ayrı eylem olarak kalır. Bugünkü "WO finalize'da kart
  üretimi" kalkar — ilk partinin kartı zaten WO create + attach anında doğar.
- **Kimlik (K7):** QR değeri = `cardNumber` = `barcode` (`RK…`, tek-kod). Kart **belge**
  niteliğini korur (snapshot donuk): üzerinde iri **Parti No (P…)**, İş Emri No (IE…),
  ürün/renk/rota/metraj.
- **Invariant:** parti başına en fazla 1 ACTIVE kart (partial unique, migration deseni mevcut).
  Reprint: `version++`, eski VOID; VOID kart okutulursa mevcut davranış — açık red.
- **Tarama akışı mekanik olarak değişmez:** `scan()` kartı çözer → artık `card.batch` →
  `batch.workOrder` → adım eşleşmesi aynı. Kazanım: istasyonda okutulan kart artık hangi
  **partinin** geldiğini söyler ("1. parti Kurşun'da, 2. boyahanede" fiziken de tutarlı).
- **Adım durum makinesi WO-seviyesinde KALIR** (`WorkOrderStep` değişmez). Partiler aynı adım
  kayıtlarından farklı zamanlarda geçer; adımın "bitti mi" hesabı bugünkü dal-sonrası yeniden
  hesap mantığının batch-bazlısı.

---

## 7. Fason Akışı Değişiklikleri

### 7.1 Bir sevk = bir parti (K10 — tasarım netleştirmesi)

`SubcontractorDispatch.batchId` zorunlu tek FK. **Gerekçe:** fason dönüşünde born roll'ların
parti ataması ancak fiziksel ayrımla güvenilir olur — boyahaneye iki parti tek belge/tek koli
giderse, dönen açık kumaşın hangi partiden geldiği fiziksel olarak ayırt edilemez. Her parti
kendi sevk kaydı + kendi refakat kartı + kendi çekisiyle gider; aynı kamyonu paylaşabilirler
(plaka/şoför alanları aynı doldurulur). Boyahane kartlar üzerinden grupları ayrı tutar → kabul
ataması otomatik ve kesin: `born.batchId = dispatch.batchId`.

Aynı mantığın ikinci yüzü **K11'dir**: iki parti tek kazana girecekse ayrı tutulmaları kurgudur
(dönüşte atama fiziksel olarak imkânsız) — bu yüzden çok-parti seçiminde sistem birleştirmeyi
önerir (§7.2). Hiçbir durumda tek dispatch iki parti taşımaz.

### 7.2 Sevk kurulumu parti-öncelikli

Bugünkü top-seç modeli, parti-öncelikli akışa döner: **parti seç (veya kartını okut) → toplar
varsayılan tümü seçili → alt küme bırakılırsa §5.3 oto-böl önizlemesi → sevk**. Mobil fason-sevk
ekranında kart okutmak partiyi otomatik seçer (kart artık partinin kimliği).

**Çok-parti seçimi (K11):** seçim 2+ partiye yayılıyorsa sevk onayından önce modal —
*"Birlikte giden kumaş aynı kazanda boyanır ve dönüşte partilere ayrıştırılamaz."* İki yol:

1. **Birleştir & tek sevk (varsayılan/önerilen):** giden toplar **en eski partinin numarası**
   altında birleşir; her partinin geride kalanı K5 gereği **kendi** yeni partisini alır (kalanlar
   birlikte kazana girmiyor → tek yeni partide toplanmaz); boşalan parti(ler) §5.6; kartlar §5.7
   birleştirme kuralı (kaynak VOID, hedef reprint). Ardından tek dispatch (K10 sağlanır).
2. **Ayrı gönder:** sistem parti başına ayrı dispatch üretir (plaka/şoför alanları kopyalanır —
   tek kamyon); parti başına çeki + kart; fason talimatına "partiler ayrı işlenecek" notu önerilir.
   Yalnız boyahanenin fiilen ayrı işleyeceği (ayrı kazan/gün) biliniyorsa seçilmelidir.

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
| `POST /api/work-orders` (+quick-start) | `manualBatchNumber` → `manualWorkOrderNumber`; yanıt `workOrderNumber` (IE). Attach edilen toplar için ilk parti + kart yanıtla döner. |
| `POST /api/work-orders/:id/attach-rolls` | Body + `targetBatchId?` (K4). Yanıtta doğan/kullanılan parti. |
| `GET /api/work-orders/:id/branches` | → `/batches` — lane=parti (§7.4). |
| `POST /api/work-orders/:id/split-branch` (+preview) | Batch-bazlı üç yol (§5.5): `batchId` + `mode: REDYE_SAME_COLOR \| NEW_COLOR \| UNDYED_MOVE`. |
| Fason sevk uçları | `batchId` zorunlu; kısmi seçimde oto-böl sonucu yanıtta (`remainderBatch`). |
| **Yeni:** `POST /api/work-orders/:id/batches/:batchId/move-rolls` / `merge` / `split` | K8 araçları; hepsi sevksiz-guard + audit. |
| `GET /api/work-orders/check-batch-number` | → `check-work-order-number` (IE benzersizliği). |
| Traveler card uçları | Kart artık `batchId` bağlamlı; scan yanıtına parti bilgisi eklenir. |

RBAC: yeni uç yok denecek kadar — hepsi mevcut `workorder:read/write` kapsamında; yeni permission gerekmez.

---

## 9. UI Değişiklikleri

### 9.1 Electron

| Dosya/Alan | Değişiklik |
|---|---|
| `WorkOrders/columns.tsx`, listeler | "Parti No" kolonu → "İş Emri No" (`IE…`); parti sayısı rozeti eklenebilir. |
| `WorkOrderFormView/FormPage` | `batchNumber` alanı → `workOrderNumber` (manuel İE girişi + benzersizlik kontrolü). |
| `BranchLanes.tsx` → `BatchLanes.tsx` | "Partiler" paneli (§7.4). Satır kimliği `P…`; HAZIR durumu; soy bağı satırları üç yolu ayırt eder. |
| `SplitBranchModal.tsx` | Batch-bazlı; üç mod (§5.5). |
| `FasonStepActions/FasonStepRollSelectModal` | Parti-öncelikli sevk (§7.2) + oto-böl önizlemesi. |
| Attach akışı (WO detay "top ekle") | Parti seçimi: ○ Yeni parti (varsayılan) ○ Mevcut sevksiz parti (dropdown). |
| **Yeni:** parti detay/araçlar | Top taşı / birleştir / elle böl (K8) — `PermissionGate workorder:write`. |
| `UndoTransferModal`, `DirectShipModal` | Metinler "dal" → "parti"; davranış aynı. |
| Sipariş/rapor ekranları | `batchNumber` gösterimleri taranır: WO bağlamındakiler İE'ye, top bağlamındakiler topun partisine bağlanır. |

### 9.2 Mobil

- **KK1 / Kurşun-KK2 / Tambur:** kart okutma → parti bağlamı; adım çözümü aynı. Ekran başlığında İE + P birlikte.
- **Fason Sevk:** kart okut → parti otomatik seçili; alt küme bırakılırsa oto-böl onayı.
- **Fason Kabul:** born roll girişi partiye bağlanır (otomatik — sevkin partisi).
- Kart basım/yeniden basım akışları parti kartını basar.

---

## 10. Etiket & Belgeler

- `config/label-fields.ts`: `batchNumber` alanı **kalır** (defaultLabel "Parti No") ama kaynağı
  değişir → **topun kendi partisi** (`roll.batch.batchNumber`; partisiz topta boş). Yeni alan:
  `workOrderNumber` ("İş Emri No"). Tüm mock payload'lar (`label.service`, `label-rawcode`,
  `sample-data`) güncellenir: `batchNumber: "P…"` + `workOrderNumber: "IE…"`.
- **Refakat kartı şablonu** (`traveler-card.html.ts`): iri Parti No + İş Emri No satırı; QR = RK (değişmez).
- **Fason çeki** (`fason-ceki.html.ts`): parti no alanı (sevkin partisi).
- `PrintedDocument` snapshot'ları donuktur — eski basımlar eski düzeniyle kalır, yeni basımlar yeni düzeni alır (mevcut konvansiyon).

---

## 11. Migration & Geçiş

Tüm veriler test verisi (root `CLAUDE.md`) → **dönüşüm scripti YAZILMAZ.** Tek şema migration'ı
+ temiz operasyonel sıfırlama:

1. Migration: `batches` CREATE; `work_orders.batch_number` → `work_order_number` RENAME;
   `rolls.batch_split_id` DROP + `rolls.batch_id` ADD (FK, partial index); `traveler_cards.work_order_id`
   → `batch_id` (FK + one-ACTIVE-per-batch partial unique); `subcontractor_dispatches.batch_id` ADD (NOT NULL).
   Mevcut operasyonel satırlar migration'dan ÖNCE `reset-operational` ile temizlenir → NOT NULL/FK'lar
   boş tabloya güvenle uygulanır (statement_timeout riski yok).
2. `scripts/reset-operational` güncellenir: `batches` truncate sırası (FK zinciri: cards/dispatches → batches → work_orders).
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

**Yeni testler:**
- Attach → parti + kart doğumu; `targetBatchId` ile sevksiz partiye ekleme; sevkli partiye ekleme 409.
- Kısmi sevk oto-böl: kalanlar yeni parti + yeni kart; giden no korur; sayı/metraj mutabakatı; eşzamanlı çift sevk yarışı (claim).
- Kalıtım: born roll `batchId` = dispatch partisi; tambur çocukları parent partisi.
- Redye üç yolu (§5.5): parti/WO/kart sonuçları + soy bağı izleri.
- K8 araçları: sevksiz guard'lar, birleştirmede kart VOID + hedef reprint, en-eski-numara-yaşar kuralı, boş parti temizliği (§5.6 iz var/yok ayrımı).
- K11 çok-parti sevki: birleştir yolu (en eski no yaşar, kalanlar parti-başına yeni parti, kabul ataması birleşik partiye) ve ayrı-gönder yolu (parti başına dispatch/çeki/kart).
- Kart: parti başına tek ACTIVE (P2002→409), VOID kart taraması reddi, WO-taşınmada reprint zorunluluğu.

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
