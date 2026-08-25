# Mobil "Yeniden Üretime Al" — Uygulama Planı (2026-08-25)

> **Durum:** ✅ **UYGULANDI** (2026-08-25, APK 2.9.6/vc53). Uçtan uca canlı kopyada ölçüldü:
> `T240826F0035` WAREHOUSE → `IE2508260003` / parti `P91` / fason çekisi `FS2508260002` →
> `AT_SUBCONTRACTOR`; sebep hem `parameters.rework` (kod `TON_TUTMADI`) hem 1. adım notu hem de
> **fason çeki talimatı** olarak yazıldı ("Yeniden üretim: Ton tutmadı"). Masaüstü ayağı aynı gün
> bitti (`ReworkRollsDialog`).
> **Kapsam:** Tabletteki Hızlı İş Emri, depodaki **bitmiş** (WAREHOUSE / A1_STOCK) topu
> okutup yeni bir iş emrine sokabilsin — tekrar boyahaneye gönderme dahil.
> **Backend:** akışın kendisi için değişiklik YOK (ölçüldü). Yalnız **sebep kataloğu** için
> yeni `ReasonPresetKind` → **1 küçük enum migration'ı** (§3.5). Yeni izin YOK. **APK gerekir.**
>
> **Kararlar (kullanıcı, 2026-08-25):** (a) ham + bitmiş aynı WO'da **serbest, rozetle** ·
> (b) hedef renk **boş gelir**, operatör seçer · (c) sebep **isteğe bağlı**, hazır metinler +
> bir serbest metin kutusu, basit · (d) **2. kalite dahil**.

---

## 0. Bugünkü durum (ölçülmüş)

| Katman | Durum | Kanıt |
|---|---|---|
| Backend `quick-start` | WAREHOUSE / A1_STOCK **kabul eder** | `workorder.service.ts:1209` `attachable = [STOCK, WAREHOUSE, A1_STOCK]`; çuval/sevkiyattaki top reddedilir; tek kumaş kuralı |
| Backend `attachRolls` | aynı | `:4358` |
| Geri dönüş | WO iptal/detach → top **eski rafına** (WAREHOUSE) döner | `test_wo_warehouse_attach` F1 (2026'dan beri yeşil) |
| Masaüstü | ✅ `Envanter → Bitmiş Depo → Yeniden Üretime Al` | 2026-08-25 |
| **Tablet** | ❌ okutmada **eliyor**: `useQuickWorkOrder.addRolls` → `if (roll.status !== 'STOCK') reject("Stokta değil")` | `useQuickWorkOrder.ts:~520` |
| **Tablet** "Listeden Seç" | ❌ yalnız ham stok: `RollPickerModal filters={{ rollScope:'RAW_STOCK', rollKind:'WOUND_ROLL' }}` | `NewWorkOrderView.tsx:~364` |
| Saha kullanımı | 980 topun 4'ü iki WO'dan geçmiş, dördü de HAM — akış **hiç kullanılmamış** (kullanılamıyordu) | canlı kopya 2026-08-25 |

Uçtan uca kanıt (masaüstü yolu, canlı kopya): `T240826F0034` WAREHOUSE → `IE2508260002` / `P90` /
`FS2508260001` → `AT_SUBCONTRACTOR`.

---

## 1. Sektör standardı — neyi kopyalıyoruz

SAP PP'de bu işin adı **Nacharbeitsauftrag / rework order**:

| SAP kuralı | Bizdeki karşılığı | Durum |
|---|---|---|
| Yeniden işleme **yeni bir üretim emridir**; bitmiş orijinal emir yeniden açılmaz | Yeni WO açılır, eski WO COMPLETED kalır | ✅ zaten böyle |
| Bitmiş mal emre **bileşen olarak tüketilir** (261), çıktı **yeni parti** ile alınır (101) | Fason kabulünde orijinal top `SUBCONTRACTOR_CONSUMED`, yeni top yeni barkod + yeni parti | ✅ zaten böyle — **kimlik değişimi standarttır** |
| Yeniden işleme **sebebi** kaydedilir (rework reason) | 1. adımın notu → fason talimatına/çekiye basılır | ➕ planda (§3.4) |
| Yeniden işlemedeki mal **satışa kapalıdır** | WAREHOUSE → IN_PRODUCTION (Bitmiş Depo'dan düşer) | ✅ zaten böyle |
| İzlenebilirlik: yeni çıktıdan eski mala | `parentReceiptId` + hareket geçmişi | ✅ zaten böyle |
| Aynı emirde **farklı kaynaklı** bileşen serbesttir | Ham + bitmiş top aynı WO'da | ⚠️ karar §5-a |

**Ölü etiket:** SAP'ta bileşen tüketildiğinde eski etiketin geçersizliği açıktır; bizde de kabulde
yeni barkod doğar. Bu yüzden onay adımında **uyarı KESİN ve meşru** — 2026-08-25'te kaldırılan genel
iptal onayından farkı: orada geçersizleşme olasılıktı, burada kesin. Engel değil bilgi.

---

## 2. Tablet UX (3 adımlı sihirbaz — mevcut yapı korunur)

### Adım 1 — Toplar
```
┌─ Toplar ─────────────────────────────────────────────┐
│ [barkod okut / yaz]                    [Listeden Ekle]│
│                                                       │
│ ✓ T240826F0034  ACTİVO BEYAZ · EKRU   50 m  330 cm    │
│     ▌BİTMİŞ DEPO▐  ← amber rozet (ham topta yok)      │
│ ✓ T250826H0012  ACTİVO BEYAZ          80 m  330 cm    │
│                                                       │
│ ⓘ 1 top bitmiş depodan alınıyor (yeniden üretim)      │
└───────────────────────────────────────────────────────┘
```
- Okutma: `WAREHOUSE` ve `A1_STOCK` **kabul**. Çuvalda/sevkiyatta olan top: **okutmada** reddet
  ("Çuvalda — önce çuvaldan çıkarın") — bugün bu backend'de 400 olarak geliyor, erken söylemek daha iyi.
- Satırda **BİTMİŞ DEPO** rozeti + rengi (ham topta renk yok, bitmişte var — göz ayırır).
- "Listeden Ekle" seçicisine üstte kapsam anahtarı: **Ham Stok | Bitmiş Depo**.
  Bitmiş: `{ status: 'WAREHOUSE,A1_STOCK', shipmentScope: 'free', rollKind: 'WOUND_ROLL', itemId? }`
  (`shipmentScope:'free'` Kartela/Paket'te zaten kullanılıyor — çuvaldakileri eler).

### Adım 2 — Üretim (değişmez)
Rota · hedef renk · en · kat · fason firma chip'leri · "Fasona Gönder" — hepsi bugünkü gibi.
Hedef renk **ön-dolmaz** (yeniden boyamada yeni renk operatörün kararı; satırda eski renk görünür).

### Adım 3 — Onay
```
┌─ Onay ───────────────────────────────────────────────┐
│ Toplar      2 top · 130 m  (1'i bitmiş depodan)       │
│ Kumaş       ACTİVO BEYAZ                              │
│ Rota        Standart Boyama                           │
│ Hedef renk  03-KREM                                   │
│ Fason       Ny Hisar · Fasona gönderilecek            │
│                                                       │
│ ⚠ 1 topun etiketi geçersizleşecek                     │
│   Fasona giden top orada açılıp birleştirilir —       │
│   kabulde YENİ barkodla döner. Eski etiketi sökün.    │
│   T240826F0034                                        │
│                                                       │
│ Neden yeniden? (isteğe bağlı)                         │
│ [ Kendin yaz…                                       ] │
│ (Ton tutmadı) (Leke / kir) (Müşteri iadesi)           │
│ (Renk değişikliği) (Kalite düşük)                     │
│                          [ İş Emrini Başlat ]         │
└───────────────────────────────────────────────────────┘
```
- Uyarı koşulu **DAR** (masaüstüyle birebir): `labelPrintedAt` dolu **ve** rotanın ilk adımı fason.
- **Sebep bloğu yalnız `reworkRolls.length > 0` iken görünür** (ham topla açılan WO'da soru yok).
  Desen, uygulamanın Fire ekranıyla AYNI (kök CLAUDE.md 2026-08-19): **serbest metin kutusu
  ÜSTTE, hazır chip'ler altında**; kutuya yazmaya başlamak "Diğer"i kendiliğinden seçer, chip'e
  dokunmak kutuyu temizler. Tek seçim. Hiçbiri seçilmeden de başlatılabilir (isteğe bağlı).
  Hazır metinler **DB kataloğundan** gelir (`useReasonPresets('WORK_ORDER_REWORK')`) → fabrika
  Ayarlar → Hazır Sebepler'den düzenler; çevrimdışı zemin `BUILTIN_*` (mevcut hook deseni).
- **Nereye yazılır (iki yer, iki iş):**
  1. Metin → 1. adımın `stepPlanning.notes`'u → fason talimatı / **çeki listesine basılır**
     (`dispatch.instruction` adım notundan dolar; `test_fason_step_note_flow` kilitliyor).
     Boyahane "ton tutmadı — yeniden boya" talimatını kâğıtta görür.
  2. Kod + metin → `WorkOrder.parameters.rework = { reasonCode, reasonText, sourceStatus: {...} }`
     (JSON kolon, **migration YOK**; `quick-start` şeması `parameters`ı zaten kabul ediyor —
     `workOrderCoreShape` spread, doğrulandı). Rapor anahtarı KOD'dur; ileride "neden 40 top
     tekrar boyandı" raporu bu alandan okur (o gün GIN index — perf kuralı 6).

---

## 3. Kod değişiklikleri (dosya bazında)

### 3.1 `mobil/src/screens/Modules/HizliIsEmri/useQuickWorkOrder.ts`
- `ScannedRoll` tipine ekle: `status: 'STOCK'|'WAREHOUSE'|'A1_STOCK'`, `colorName: string|null`,
  `labelPrintedAt: string|null`. (`getByBarcode` `include` ile döndüğü için `labelPrintedAt` zaten
  yanıtta — `inventory.service.findRollByBarcode:2257`.)
- **Saf sınıflandırıcı çıkar** (test edilebilsin): `classifyScannedRoll(roll, lockItemId): {ok:true, row} | {ok:false, reason}`
  - `CANCELLED` → mevcut teşhis paneli (değişmez)
  - `sackId || shipmentId` → `"Çuvalda/sevkiyatta — önce oradan çıkarın"`
  - `status ∉ {STOCK, WAREHOUSE, A1_STOCK}` → `"Stokta değil (<durum>)"`
  - kumaş kilidi → `"Farklı ürün"` (değişmez)
- Türetilmişler: `reworkRolls = scanned.filter(s => s.status !== 'STOCK')`,
  `labelAtRisk = firstStepDispatch.isFason ? scanned.filter(s => s.labelPrintedAt) : []`.
- Sebep durumu: `reworkReasonCode: string|null`, `reworkReasonText: string` (serbest metin).
  Gönderimde: metin (chip label'ı ya da yazılan) → 1. adımın `notes`'una (mevcut `stepNotes`
  varsa `"… | …"` ile birleşir); `parameters.rework = { reasonCode, reasonText }`.
  ⚠️ Kod uydurulmaz: serbest metin → `reasonCode: null` (sunucu tarafı türetme YOK — bu kind
  metin saklayan kind'lardan değil, kod istemciden gelir; `KIND_STORES_TEXT: false`).

### 3.2 `wizard/StepRolls.tsx`
- Satırda `status !== 'STOCK'` ise **BİTMİŞ DEPO** rozeti (amber) + `colorName`.
- Liste altında bilgi satırı: "N top bitmiş depodan alınıyor (yeniden üretim)".

### 3.3 `NewWorkOrderView.tsx` + `components/RollPickerModal.tsx`
- Picker'a `scopeTabs?: { key, label, filters }[]` prop'u (üstte SegmentedButtons — **kendi satırında,
  tam genişlik**; bkz. `segmented-buttons-row.guard.test.ts`). Hızlı İş Emri iki sekme verir:
  Ham Stok (bugünkü filtre) · Bitmiş Depo (§2 filtresi). Diğer çağıranlar prop vermez → değişmez.

### 3.4 `wizard/StepConfirm.tsx`
- "Toplar" satırına "(N'i bitmiş depodan)" eki.
- `labelAtRisk.length > 0` → amber uyarı bloğu + barkod listesi (metin masaüstüyle aynı).
- "Neden yeniden?" bloğu — yalnız `reworkRolls.length > 0` iken. Yeni ortak bileşen
  **`components/reasonPresets/ReasonPresetPicker.tsx`**: `kind` + `value` + `onChange({code,text})`;
  serbest metin üstte + chip'ler altta (Fason Kabul `CloseRemainderModal` ve Tambur fire modalındaki
  kopya-desen buraya taşınır — üç yerde aynı kalıp elle yazılıydı). Metin sınırı 200 kr.

### 3.5 Backend — akış için YOK, sebep kataloğu için KÜÇÜK
Akış: değişiklik yok. Doğrulananlar: kabul listesi, çuval/sevkiyat reddi, tek kumaş,
`dispatchFirstStep` firma şartı, idempotent `clientToken`, çevrimiçi zorunluluğu, `parameters` ve
`stepPlanning.notes`'un `quick-start` şemasından geçtiği.

Sebep kataloğu: **yeni `ReasonPresetKind.WORK_ORDER_REWORK`** — 2026-08-19 kararıyla tutarlı
("hazır sebepler koddan DB'ye; fabrika kendi diliyle düzenler"). Dokunulacak **beş kapı** (biri
eksik kalırsa liste boş gelir ya da derleme düşer — hepsi birlikte):

| # | Yer | Ne |
|---|---|---|
| 1 | `prisma/schema.prisma` + migration `ALTER TYPE "ReasonPresetKind" ADD VALUE 'WORK_ORDER_REWORK'` | emsal: `20260702121000_work_sessions` |
| 2 | `src/constants/reason-presets.ts` | `KIND_STORES_TEXT: false`, etiket "Yeniden üretim sebepleri", katalog: `TON_TUTMADI` "Ton tutmadı" · `LEKE` "Leke / kir" · `MUSTERI_IADESI` "Müşteri iadesi" · `RENK_DEGISIKLIGI` "Renk değişikliği" · `KALITE_DUSUK` "Kalite düşük" · `DIGER` "Diğer" (`requiresText`) |
| 3 | `src/services/reason-preset.service.ts` | `TextReasonKind`'a GİRMEZ (metin saklamıyor); uzlaştırma job'u yeni kind'ı otomatik getirir (boot) |
| 4 | `Electron/src/pages/ReasonPresets/service.ts` | union + `KIND_STORES_TEXT` + `KIND_TABS` ("Yeniden Üretim") — panelde sekme |
| 5 | `mobil/src/hooks/useReasonPresets.ts` | union + `builtin('WORK_ORDER_REWORK')` çevrimdışı zemini |

Bekçi `test_reason_presets` kind'ları sayıyorsa beklentisi güncellenir. ⚠️ Deploy sırası bu yüzden
**backend ÖNCE**: eski sunucu yeni kind'ı bilmez → liste boş → mobil zemine düşer (çalışır ama
fabrikanın düzenlediği liste gelmez).

---

## 4. Test planı

| Ne | Nerede | Nasıl |
|---|---|---|
| Sınıflandırıcı | `useQuickWorkOrder.classify.test.ts` (YENİ) | WAREHOUSE kabul · A1_STOCK kabul · SHIPPED red · çuvaldaki WAREHOUSE red (sebep metniyle) · farklı kumaş red · CANCELLED → teşhis |
| Onay uyarısı | `StepConfirm.test.tsx` (YENİ) | etiketli + fason rota → uyarı + barkod; iç rota → uyarı YOK; etiketsiz → YOK (masaüstü `ReworkRollsDialog.test.tsx` ikizi) |
| Picker sekmesi | `RollPickerModal.test.tsx` | `scopeTabs` verilince sekme çizilir, filtre değişir; verilmezse eski davranış |
| Sebep seçici | `ReasonPresetPicker.test.tsx` (YENİ) | chip → code+text · yazmaya başlamak "Diğer"i seçer · chip'e dokunmak kutuyu temizler · boş bırakılabilir |
| Gönderim gövdesi | `useQuickWorkOrder.payload.test.ts` (YENİ) | sebep varsa `stepPlanning[0].notes` + `parameters.rework`; yoksa ikisi de YOK; serbest metinde `reasonCode: null` |
| Katalog | `scripts/test_reason_presets.ts` (mevcut) | yeni kind katalogda + DB'de uzlaştırılmış |
| Bekçi | `segmented-buttons-row.guard.test.ts` | yeni SegmentedButtons satıra konmadı |
| Backend | `test_wo_warehouse_attach` (mevcut) + `test_dispatch_without_color` §3 | değişmeden yeşil kalmalı |
| Uçtan uca | tablet USB'de, canlı kopya DB | bitmiş top okut → Standart Boyama → Ny Hisar → başlat → `AT_SUBCONTRACTOR` + çeki; sonra WO iptal → top WAREHOUSE'a döndü mü |
| Tip | `npx tsc --noEmit` (mobil) | 0 hata |

Negatif sonda (bekçi konvansiyonu): sınıflandırıcıda WAREHOUSE'u geri elemek → kabul testi kırmızı.

---

## 5. Kararlar — ALINDI (2026-08-25)

| # | Soru | Karar | Uygulama |
|---|---|---|---|
| a | Ham + bitmiş aynı WO'da? | **Serbest, uyarıyla** | Adım-1'de BİTMİŞ DEPO / 2. KALİTE rozeti + "N top bitmiş depodan" satırı; engel yok |
| b | Hedef renk ön-dolsun mu? | **Boş gelir** | Satırda topun mevcut rengi görünür; kutu operatörün |
| c | Sebep? | **İsteğe bağlı; hazır metinler + bir serbest kutu, basit** | `WORK_ORDER_REWORK` kataloğu + `ReasonPresetPicker` (metin üstte, chip'ler altta) |
| d | 2. kalite (A1) dahil mi? | **Evet** | `A1_STOCK` kabul; rozet "2. KALİTE" |

## 6. Sıra ve deploy

1. Backend: kind + migration + katalog (§3.5, ~1 saat) → `npm test` (`test_reason_presets`)
2. Electron: `KIND_TABS` sekmesi (15 dk)
3. Mobil: §3.1–3.4 (tahmini yarım gün) → testler (§4) → `npx tsc --noEmit`
4. APK bump (ÜÇ yer: `app.json version` + `expo.android.versionCode` + `build.gradle` çifti) →
   `EXPO_PUBLIC_API_URL=http://192.168.1.250:4000/api npm run build:apk:check` → derle
5. Tablette uçtan uca (§4 son satır) — **ölçerek** (`screencap` + `uiautomator dump`)
6. Saha: **backend ÖNCE** (migration + `pm2 restart` → uzlaştırma yeni kind'ı getirir), sonra APK.
   Eski sunucu + yeni APK: akış çalışır, sebep listesi çevrimdışı zeminden gelir (fabrika düzenlemesi
   görünmez) — kırılma yok, eksik özellik.
