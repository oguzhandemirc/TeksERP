# İADE — Müşteri İade Girişi (Tasarım)

> **Durum: UYGULANDI** (F1-F7 DONE; `return.service.ts` + `RollReturn`/`ReturnReason` şeması).
> Sevkiyat sonrası müşteriden geri dönen kumaş toplarının QR ile depoya alınması + izlenebilirlik.
>
> **Kilit gerçekler (gövde §1-§5 bunlara göre güncellendi):**
> - **İade nedeni ZORUNLU:** `reasonId` ve `reasonText` ikisi de boşsa 400 "İade nedeni gerekli"
>   — gerekçe: nedensiz iade kalite geri-besleme verisini değersizleştirir.
> - **Top varsayılan WAREHOUSE, kalite override ederse değişir:** `returnGradingEnabled` açık + kalite
>   override ise `QualityGrade.returnTargetStatus`'a göre FİRE→`SCRAP`, A1→`A1_STOCK`, 1.KALITE→`WAREHOUSE`
>   (feature flag default **kapalı** → kapalıyken override yok sayılır, hep WAREHOUSE). Uygulanan statü
>   `RollReturn.appliedStatus`'a snapshot'lanır (iptal guard'ı bununla çalışır).
> - **6 servis metodu:** `lookupForReturn`, `createReturn`, `listReturns`, `getReturnById`,
>   `cancelReturn`, `editReturn` (PATCH — iade defterini düzeltir; iptalde recency-guard + prevSackId null-fix).
> - **Lookup query param'la:** `GET /api/returns/lookup?barcode=` (path param değil); top yoksa 404, SHIPPED değilse 400.
> - Sevk muhasebesine DOKUNULMAZ (shippedQty/SackAllocation değişmez) kararı gövdede doğru ve korunur.

## 1. Neden bu özellik?

Sevk edilen toplar (yanlış ürün/renk/en, hasar, fazla sevkiyat, müşteri
vazgeçmesi vb. nedenlerle) geri dönebiliyor. Bunların:

1. QR ile okutularak **doğrudan Hazır Depo'ya** alınması,
2. **İade nedeni** + teslim alan personelin **notu** ile kayıt altına alınması,
3. Sipariş **otomatik açılmadan**, ama "hangi siparişten / hangi üründen / ne
   kadar iade geldi" sorusunun **geriye dönük cevaplanabilmesi** gerekiyor.

## 2. Temel kararlar (kilitli)

- **Kalite = etiket; statü varsayılan WAREHOUSE, kalite override ederse değişir.**
  İade edilen top **varsayılan olarak** Hazır Depo'ya (`RollStatus.WAREHOUSE`) iner —
  tıpkı Tambur çıktısı gibi. Ancak `returnGradingEnabled` açık + personel kalite
  override ederse top `QualityGrade.returnTargetStatus`'a iner (FİRE→`SCRAP`,
  A1→`A1_STOCK`, 1.Kalite→`WAREHOUSE`; kolon null → WAREHOUSE). Bu kolon Tambur'un
  `targetStatus`'undan KASTEN AYRIDIR (Tambur seed'i hep WAREHOUSE, dokunulmaz).
  Flag kapalıyken override yok sayılır → hep WAREHOUSE. Kalite farkı yalnız
  `Roll.qualityGrade` etiketinde yaşar; uygulanan statü `RollReturn.appliedStatus`'a
  snapshot'lanır.
- **Sevk muhasebesine DOKUNULMAZ.** İade defteri `OrderLine.shippedQty` /
  `SackAllocation`'ı değiştirmez → sipariş `COMPLETED` kalır, yeniden sevk
  kuyruğuna girmez. İzlenebilirlik tamamen ayrı `RollReturn` defterinden gelir.
- **Sipariş atfı = personel seçer.** Model fungible (top↔sipariş bağı yok); top
  yalnız geldiği sevkiyatı bilir. İade ekranında o sevkiyatın **spec'e uyan**
  siparişleri listelenir; tek aday varsa otomatik seçili gelir, yoksa boş bırakılır
  (yalnız ürün+müşteri+sevkiyat tutulur).
- **İade nedeni ZORUNLU — katalog VEYA serbest metin.** Yönetilebilir katalog
  (`ReturnReason`, admin CRUD) + serbest metin; **en az biri dolu olmalı** — ikisi de
  boşsa 400 "İade nedeni gerekli" (nedensiz iade kalite geri-besleme verisini
  değersizleştirir). Aynı zorunluluk `editReturn`'de de korunur.
- **Derecelendirme yetkisi Electron'dan açılır/kapanır** (`returnGradingEnabled`
  feature flag). Kapalıyken personel kalite **belirtemez** (buton görünmez,
  backend gönderilen override'ı yok sayar) — top çıktığı kaliteyle döner.
- **Not her zaman Tambur'a düşer.** İade notu + nedeni topu açan her ekranda
  (Tambur depo-kesim, top detayı) görünür; feature flag'den bağımsız.
- **v1 kapsam:** tüm-top iade (qty = topun mevcut metrajı). Online giriş
  (offline v1 dışı). Barkod bulunamaz / `SHIPPED` değilse → uyarı, işlem yok.

## 3. Veri modeli

### 3.1 `ReturnReason` (katalog — admin CRUD, `BaseService`)

```
id          uuid
code        String @unique  // YANLIS_URUN ...
name        String          // UI etiketi
color       String?         // rozet (opsiyonel)
sortOrder   Int @default(0)
isActive    Boolean @default(true)   // soft-delete
createdAt / updatedAt
@@index([isActive, sortOrder])
```

**Seed:** `YANLIS_URUN`, `YANLIS_RENK_EN`, `HASARLI`, `FAZLA_SEVK`,
`MUSTERI_VAZGECTI`, `DIGER`.

> Performans: küçük master-data, yalnız İade ekranı açılınca okunur, sıcak
> tablolara dokunmaz → `QualityGrade`/`Color` ile aynı, etki yok.

### 3.2 `RollReturn` (iade defteri — izlenebilirliğin omurgası; düzeltilebilir/iptal edilebilir)

```
id            uuid
rollId        String                 // iade edilen top
fromShipmentId String?               // geldiği sevkiyat (varsa)
customerId    String                 // müşteri (sevkiyattan)
orderId       String?                // personelin seçtiği sipariş (tek aday=auto, yoksa null)

// Spec snapshot — top sonradan Tambur'da kesilse bile rapor sağlam kalsın
itemId        String
colorId       String?
width         Decimal?
qty           Decimal                // iade anındaki currentQty

// Neden + not — şema nullable ama SERVİS reason'ı zorunlu tutar (reasonId||reasonText)
reasonId      String?                // ReturnReason FK
reasonText    String?                // serbest metin
note          String?                // teslim alan personel notu

qualityGradeId String?               // yalnız personel override ettiyse
receivedById  String

// İade anında topa UYGULANAN statü (WAREHOUSE/A1_STOCK/SCRAP) — iptal guard'ı bunu okur
appliedStatus RollStatus?            // null → legacy/WAREHOUSE

// İade öncesi snapshot — iptal (geri al) topu bunlarla eski haline döndürür
prevSackId         String?
prevQualityGrade   String?
prevQualityGradeId String?

// İptal (yanlış iade kabulü geri alındı) — sebeple birlikte
cancelledAt   DateTime?
cancelReason  String?
cancelledById String?

createdAt     DateTime @default(now())
updatedAt     DateTime @updatedAt    // editReturn/cancelReturn mutasyonları için

@@index([orderId])
@@index([customerId, createdAt])
@@index([itemId, colorId, width])
@@index([fromShipmentId])
@@index([rollId])
```

### 3.3 `Roll` değişikliği

**Şema değişikliği yok.** İade işlemi mevcut alanları günceller:
`SHIPPED → appliedStatus` (override yoksa `WAREHOUSE`; kalite override'ında
`returnTargetStatus` → SCRAP/A1_STOCK/WAREHOUSE), `shipmentId`/`sackId` = null,
override varsa `qualityGrade(+Id)`. İade notu Roll'a denormalize edilmez —
`RollReturn`'den (en güncel) join ile gösterilir.

### 3.4 Feature flag

`system-setting.service.ts`'e `rawWidthEnabled` deseninin aynısı:
- `SETTING_KEYS.RETURN_GRADING_ENABLED = "return.gradingEnabled"`
- `FeatureFlags.returnGradingEnabled: boolean` (default **false** — konservatif)
- `feature-flag.routes.ts` PATCH şemasına `returnGradingEnabled` eklenir
- `readReturnGradingEnabled()` reader

## 4. Akış (Mobil "İade Girişi")

1. **QR okut** → `GET /api/returns/lookup?barcode=` (query param, path değil):
   - Top yoksa → 404; `SHIPPED` değilse veya sevkiyat bağı yoksa → 400 (Türkçe mesaj).
   - Döner: top (ürün/renk/en/metraj/mevcut kalite) + sevkiyat + **aday siparişler**
     (sevkiyatın spec'e uyan, iptal-değil siparişleri) + `returnGradingEnabled`.
2. **Ekran:** sipariş seçici (tek aday otomatik) · neden seçici (katalog) · neden
   yazısı · teslim alan notu (**neden seçici VEYA neden yazısı zorunlu**) · kalite
   (flag açıksa, **varsayılan kapalı**; açılırsa QualityGrade seç).
3. **Onayla** → `POST /api/returns` → tek transaction:
   - Roll: koşullu flip `SHIPPED → appliedStatus` (override yoksa `WAREHOUSE`; kalite
     override'ında `returnTargetStatus` → SCRAP/A1_STOCK/WAREHOUSE), `shipmentId`/`sackId`
     = null; flag açık + override verildiyse `qualityGrade(+Id)` güncelle (flag kapalıysa
     override yok sayılır) — `count===0` → 409 (çift iade)
   - `RollReturn` yaz (spec snapshot + neden + not + seçilen sipariş + appliedStatus + prev-snapshot)
   - `AuditService.log`
   - **`shippedQty` / SackAllocation'a dokunulmaz** → sipariş kapalı kalır.

## 5. Backend

### 5.1 `return.service.ts` (6 metot)
- `lookupForReturn(barcode)` — top + sevkiyat + aday siparişler + flag.
- `createReturn(input, userId)` — transaction (yukarıdaki adımlar; neden zorunlu, koşullu flip).
- `listReturns(req)` — rapor (tarih/müşteri/ürün/sipariş/neden + toplam; cursor/array, `?cancelled=active|cancelled|all`).
- `getReturnById(id)` — tek iade kaydı detayı (mobil geçmiş sheet'i).
- `cancelReturn(id, reason, userId)` — geri al: top iade öncesi haline (SHIPPED + eski
  sevkiyat/çuval/kalite) döner; recency-guard + koşullu `updateMany` + prevSackId null-fix.
- `editReturn(id, input, userId)` — yalnız defter alanları (neden/not); statü/sevkiyat/kalite
  değişmez, iptal edilmiş kayıt düzeltilemez, neden zorunluluğu korunur.

### 5.2 `ReturnReason` CRUD — `BaseController` + `BaseService` (`searchFields`).

### 5.3 Controller + routes + yetki
- `/api/returns`: `GET /lookup?barcode=` · `POST /` (create) · `GET /` (list) ·
  `GET /:id` (detay) · `PATCH /:id` (düzelt) · `POST /:id/cancel` (iptal).
  `/api/return-reasons` (CRUD). Yetki: `requireAnyPermission(...)` — yazan uçlar
  `return:write`+`mobile:iade`, okuyan uçlar (`GET /`, `GET /:id`) `return:read`+`return:write`+`mobile:iade`.
- Yeni permission: `return:read`, `return:write`, mobil `mobile:iade`.
  ReturnReason CRUD `return:write` altında. **seed.ts + canlı DB INSERT.**
- `app.ts`'e route mount.

### 5.4 Tambur entegrasyonu
- `cutWarehouseRoll` lookup'ı / depo topu detayında `RollReturn` (en güncel) join
  → not + neden gösterilir.

## 6. Mobil (`mobil/`)
- Yeni modül "İade Girişi": QR tarayıcı → form (sipariş/neden/not/kalite) → onay.
  `react-native-paper` touchable'ları; `@/theme` token'ları; QR için mevcut kamera.
- `returnGradingEnabled` flag'ine göre kalite kontrolü göster/gizle.

## 7. Electron (`Electron/`) — İade Takibi
- `/operations/returns` (veya benzeri) rapor ekranı: tarih/müşteri/ürün/sipariş/neden
  filtreleri + "ne kadar iade" toplamı.
- Sipariş detayında bilgilendirici "bu siparişe gelen iadeler" satırı (sevk
  muhasebesini değiştirmez).
- Genel Ayarlar → feature flag anahtarı (`returnGradingEnabled`).
- ReturnReason için master-data CRUD ekranı.

## 8. Faz planı
- **F1 — Backend çekirdek: ✅ DONE (2026-06-04).** Şema (`ReturnReason`,
  `RollReturn` + 9 back-relation) + migration `20260604211426_add_roll_return` +
  feature flag `returnGradingEnabled` (default false) + `return.service`
  (lookup/create/list) + `ReturnReason` CRUD + `return.routes`/`return-reason.routes`
  + app.ts mount + seed (6 neden, `return:read/write`, `mobile:iade`) +
  `scripts/seed-return.ts` (canlı DB idempotent). Tambur/depo notu görünürlüğü:
  `getRollForDecision` + inventory `findRollById`/`findRollByBarcode` en güncel
  `RollReturn`'ü (not + neden + teslim alan) döndürür. tsc/eslint temiz; canlı
  smoke: lookup COMPLETED siparişi aday döndürdü, create sonrası top WAREHOUSE +
  `shippedQty` DEĞİŞMEDİ + sipariş COMPLETED kaldı (invariant geçti).
  > NOT: F1'de kalite/statü ilk başta AYRILMADI — sistem tüm kaliteyi
  > (1.KALITE/A1/FIRE) WAREHOUSE'a koyuyordu (Tambur seed'inde `targetStatus` hepsi
  > WAREHOUSE), kalite yalnız `Roll.qualityGrade` etiketindeydi; iade de bu yüzden
  > başlangıçta HEP WAREHOUSE'a iniyordu. **Bu karar sonradan revize edildi**
  > (migration `20260609203650_return_quality_shelf`): iadeye özel bir raf kolonu
  > `QualityGrade.returnTargetStatus` eklendi (Tambur `targetStatus`'undan AYRI —
  > seed: FİRE→SCRAP, A1→A1_STOCK, 1.KALITE→WAREHOUSE). Artık `returnGradingEnabled`
  > açık + personel kalite override ederse iade topu bu kolona göre iner; flag kapalı
  > veya override yoksa hâlâ WAREHOUSE (header/§2'deki güncel davranış).
- **F2 — Mobil İade Girişi: ✅ DONE (2026-06-05).** `mobil/src/screens/Modules/IadeGirisi/IadeGirisiScreen.tsx`
  (QR okut → top + aday sipariş seçici + neden seçici/serbest metin + not + flag-aware
  kalite seçici → İade Al) + `services/return.service.ts` (lookup/create/listReasons).
  Kayıt: permissions.ts (`mobile:iade` + `IadeGirisi` + MOBILE_SCREENS + moduleAccents),
  MainNavigator SCREEN_LOADERS, featureFlag.service + useFeatureFlags (`useReturnGradingEnabled`).
  tsc temiz (lint config yok). Kalite seçici yalnız returnGradingEnabled açıkken görünür.
- **F3 — Tambur/depo notu: ✅ DONE (2026-06-05).** Backend `getRollForDecision` +
  inventory `findRollById`/`findRollByBarcode` en güncel `RollReturn`'ü döndürür; Electron
  `RollDetailSheet`'e "İade Bilgisi" kartı (neden + açıklama + not + metraj + teslim alan)
  eklendi. Mobil Tambur kesim ekranı aynı veriyi `getByBarcode` ile tüketebilir.
- **F4 — Electron: ✅ DONE (2026-06-05).** İade Takibi raporu (`/operations/returns`:
  useDataTable + FilterBar müşteri/neden/tarih + toplam adet/metraj özeti) + Genel Ayarlar
  `returnGradingEnabled` toggle + İade Nedenleri CRUD (`/definitions/return-reasons`,
  Color deseni) + tile/route kayıtları. Backend cursor'a `totalEstimate` eklendi.
  Tümü typecheck temiz; endpoint'ler canlı doğrulandı (login admin/123123).
- **F5 — İade Geçmişi + sebepli İptal (geri al): ✅ DONE (2026-06-05).**
  Şema: `RollReturn += cancelledAt/cancelReason/cancelledById + prevSackId/prevQualityGrade/prevQualityGradeId`
  (receivedBy/cancelledBy named relations); migration `20260605073011_roll_return_cancel`.
  Backend: `createReturn` iade-öncesi snapshot yazar; `cancelReturn(id,reason)` topu
  iade öncesi haline (SHIPPED + eski sevkiyat/çuval/kalite) döndürür — guard: top hâlâ
  WAREHOUSE+sevkiyatsız olmalı (yoksa 409), koşullu `updateMany` ile eşzamanlı koruması;
  `getReturnById` detay; `listReturns` `?cancelled=active(default)/cancelled/all` filtresi
  (rapor/özet iptalleri SAYMAZ). Routes: `GET /api/returns/:id`, `POST /api/returns/:id/cancel`
  (sebep min 3). Mobil: `IadeGecmisiScreen` (durum tab'ları + FlashList cursor + detay
  AppModal + sebepli `ConfirmDialog` iptal), `return.service` listCursor/getById/cancel,
  İade Girişi header'ına geçmiş ikonu (`headerExtras`), nav kaydı. Canlı test: iptal →
  top SHIPPED+sevkiyat restore, defter iptal, active/cancelled filtre, çift-iptal 409,
  kısa-sebep 400, `/lookup` vs `/:id` çakışması yok. 3 proje tsc temiz.

  > İade Girişi alt barı `[Geçmiş] · [Kamera ile Okut] · [İade Al]` (geçmiş kameranın
  > solunda; header ikonu kaldırıldı).
- **F6 — Electron iade detay+iptal + sipariş iade satırı: ✅ DONE (2026-06-05).**
  İade Takibi raporunda satıra tıkla → `ReturnsDetailSheet` (detay); aktif iade + `return:write`
  ise satır-içi **sebepli iptal** (Input + destructive buton → `POST /returns/:id/cancel`).
  Sipariş detayında (`OrderDetailSheet`) "bu siparişe gelen iadeler" özet satırı
  (`returnsService.summaryForOrder`, **iptaller hariç**). Electron `ReturnRow` += cancel
  alanları. 3 proje tsc temiz; summaryForOrder iptal-hariç canlı doğrulandı (iptal edilmiş
  iadenin siparişi count:0 döndü).
- **F7 — Issue A çözümü (iade edilen top sevkiyat detayında görünür): ✅ DONE (2026-06-05).**
  Yaklaşım A (snapshot DEĞİL): `getShipmentById` += `returnedRolls` (RollReturn fromShipmentId,
  iptal hariç) + `summary.returnedCount/returnedMeters`. İade edilen top `shipmentId=null`
  olduğu için canlı `rolls`'ta yok ama sevkiyat detayı ayrı "Bu sevkiyattan iade edilenler (N)"
  bölümü + "Gönderilen toplam = mevcut + iade" gösterir. Electron `ShipmentDetailSheet` + mobil
  `ShipmentDetailView` bu bölümü çizer. İade iptal edilince top `rolls`'a döner + RollReturn
  cancelled → buradan düşer (çift sayım yok). Canlı doğrulandı (mevcut 1 + iade 1 = gönderilen 2).
  > **Kalan (mutabık ertelenen):** kısmi iade (yarım top — kesim gerektirir), mobil iade
  > offline, Electron raporunda sipariş/ürün UI filtresi + cancelled durum sekmesi, analitik
  > İade raporu (Raporlar hub'ı — sonra).
