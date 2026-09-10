# Belge yüzeyi birleştirme (F1) — uygulama planı

> **Durum:** onaylandı, uygulanmadı. Karar tarihi 2026-09-10.
> **Bağlam:** `docs/history/CLAUDE-NOT-ARSIVI.md` → *2026-09-10 — Sevk irsaliyesi:
> liste sayfalarına kimlik şeridi + tek seferlik kâğıt boyu* (o turda üç yüzeyin
> ayrıştığı ölçüldü). Alan kuralları: `docs/kurallar/belge-etiket.md`.
> **Bu belge canlıdır**: iş bitince ya silinir ya "uygulandı" damgası + arşiv notu alır.

## Dert

Kullanıcı sözü: *"2 tane ayrı modal olması çok kafa karıştırıcı."*

Muhasebe → Sevkiyatlar ekranında aynı satırda **Fiş** ve **Belge** diye iki düğme
var, ikisi de **aynı HTML'i** gösteriyor (`renderShipmentDispatchHtml`), farkları
yalnız araç çubuğunda. Ölçüldüğünde ortaya çıkan asıl sorun bu değil: aynı
belgenin **üç** yüzeyi var ve üçü de birbirinin eksiği.

| | Sevkiyatlar → İrsaliye | Muhasebe → **Fiş** | Muhasebe → **Belge** |
|---|:--:|:--:|:--:|
| | `ShipmentDispatchNote` | `DispatchReceiptDialog` | `PrintedDocDialog` |
| Önizleme + Yazdır | ✅ | ✅ | ✅ |
| Sürüm / revize / güncel görünüm | ✅ | ❌ | ✅ |
| Baskı seçenekleri (liste seçimi, tek sayfa) | ✅ | ❌ | ❌ |
| Çuval notu / izi tiki | ✅ | ❌ | ✅ |
| Belge notu düzenleme | ✅ | ❌ | ❌ |
| İade uyarısı | ✅ | ❌ | ❌ |
| PDF Kaydet | ❌ | ❌ | ✅ |
| Excel (3 sayfa) | ❌ | ✅ | ❌ |
| Toplu top etiketi | ❌ | ✅ | ❌ |
| Tek seferlik baskı notu | ❌ | ❌ | ✅ |
| Tek seferlik A4/A5 | ✅ | ❌ | ✅ |

Hiçbirinde hepsi yok. Muhasebeci Excel için Fiş'i, sürüm için Belge'yi açmak
zorunda; sevkiyatçı PDF alamıyor.

⚠️ `ShipmentDispatchNote.tsx:186` yorumu **BAYAT**: *"PrintedDocDialog'a
SHIPMENT_DISPATCH hiç düşmüyor, o yüzden seçenekler burada"* — 2026-09-07'den
beri muhasebe ekranı tam olarak onu yapıyor (`AccountingDispatchPage.tsx:195`).
Birleştirmede bu yorum silinir.

## Hedef (kullanıcı seçimi: F1 + G1)

Tek modal, tek araç çubuğu, satırda tek düğme.

```
┌──────────────────────────────────────────────────────────────┐
│ Sevk İrsaliyesi · SVK0709260006     [v3 ▾]  [Güncel görünüm] │
├──────────────────────────────────────────────────────────────┤
│ [🖨 Yazdır ▾]  [⤓ İndir ▾]  [⚙ Baskı seçenekleri ▾]  [A4|A5] │
├──────────────────────────────────────────────────────────────┤
│  ⓘ Bu sevkiyatta 2 iade var · Belge notu: "…"      [Düzenle] │
├──────────────────────────────────────────────────────────────┤
│                      ÖNİZLEME (iframe)                        │
└──────────────────────────────────────────────────────────────┘
```

- **Yazdır ▾** — birincil; menüsünde *Top etiketlerini bas*
- **İndir ▾** — PDF Kaydet · Excel (3 sayfa)
- **Baskı seçenekleri ▾** — mevcut `DispatchPrintOptions` popover'ı + baskı notu
  + çuval notu/izi tikleri (bugün üç ayrı yerde duruyorlar)
- **v3 ▾** — sürüm listesi + Revize Et; "Güncel görünüm" yanında rozet
- **A4|A5** — `PrintPageSizeToggle` (2026-09-10'da eklendi, yerinde kalıyor)
- Bilgi şeridi (iade uyarısı, belge notu) yalnız ilgili belge türünde çizilir

## Mimari karar — SLOT, registry DEĞİL

`PrintedDocDialog` **24 çağıranı** olan jenerik bileşendir. Sevk irsaliyesine
özgü şeyleri (Excel, top etiketi, iade uyarısı, belge notu) onun içine gömmek,
`components/print/` → `pages/Operations/AccountingDispatch/` yönünde bir bağımlılık
kurardı. Yön yanlış olurdu ve jenerik bileşen bir belge türünü tanır hâle gelirdi.

**Karar:** `PrintedDocDialog` slot alır, sayfa katmanı doldurur.

```
PrintedDocDialog (jenerik, components/print/)
  + toolbarPrintMenu?: ReactNode   // "Yazdır ▾" menüsüne ek kalemler
  + toolbarDownloads?: ReactNode   // "İndir ▾" menüsüne ek kalemler
  + optionsExtras?: ReactNode      // "Baskı seçenekleri ▾" popover'ına ek
  + infoBar?: ReactNode            // önizlemenin üstündeki şerit
  + printParams?: {...}            // getHtml'e geçen ek tek-seferlik parametreler
        ↑
ShipmentDocDialog (YENİ, pages/Operations/Shipments/)
  sevkiyata özgü her şeyi kurar; SHIPMENT_DISPATCH ve SUBCONTRACTOR_DIRECT_SHIP
  ikisini de bilir (DIRECT ayrımı bugün DispatchReceiptDialog'da yaşıyor)
        ↑                              ↑
Sevkiyatlar ekranı              Muhasebe ekranı (tek düğme)
```

Silinecek: `ShipmentDispatchNote.tsx`, `DispatchReceiptDialog.tsx`.
Kalan 22 çağıran hiçbir slot geçmez → **çıktıları bayt-bayt aynı kalır**.

## Adımlar

1. **`PrintedDocDialog`u araç çubuğu kalıbına geçir** (G1). Bugün seçenekler
   dikey olarak diyalog gövdesine serpilmiş (PrintNoteField + iki checkbox +
   footer). Hepsi tek çubuğa toplanır. Slot prop'ları eklenir, hepsi opsiyonel.
   *Kapı:* 22 sade çağıranın görünümü değişir (bilinçli, tek tasarım), ama
   **davranışı** değişmez. `chequeDeliveryNote.test.ts`, `reconciliationLetter.test.ts`,
   `StockCountDetailPage.test.tsx`, `GoodsReceiptDetailSheet.test.tsx` yeşil kalmalı.
2. **`ShipmentDocDialog`u yaz** — `ShipmentDispatchNote`un içeriğini taşı:
   `DispatchPrintOptions` → `optionsExtras`; `ReturnsNotice` + `DispatchNoteEditor`
   → `infoBar`; `DocVersionBar`ın `reissueOnlyWhenReconstructed` bayrağı KORUNUR.
   `DispatchReceiptDialog`tan Excel (`buildDispatchReportSheets`) ve
   `BulkRollLabelButton` gelir; `getReport`/`getDirectReport` sorgusu yalnız
   "İndir ▾" ya da etiket açıldığında koşsun (bugün her açılışta koşuyor).
3. **Çağıranları çevir** — `ShipmentDetailHeader`, `ShipmentDetailSheet`,
   `RollsTableBody` (3 yer) + `AccountingDispatchPage`. Muhasebe satırındaki
   iki düğme **tek düğmeye** iner (`columns.tsx:225-252`).
4. **Eski iki dosyayı sil** + `shipmentDetailError.test.tsx:47`'deki
   `vi.mock("./ShipmentDispatchNote")` satırını yeni ada çevir.
5. **Bekçi** — `ShipmentDocDialog.test.tsx`: DIRECT ↔ çuval sevkiyatı doğru
   docType'ı seçiyor · Excel yalnız rapor gelince etkin · slot'suz
   `PrintedDocDialog` hiçbir sevkiyat kalemi çizmiyor (negatif sonda).

## Tuzaklar (bunlar bilinmezse iş sessizce bozulur)

- **`reissueOnlyWhenReconstructed`** yalnız sevk irsaliyesinde var: içerik sevk
  anında donduğu için normal revize aynı içeriği tekrar dondururdu. Düşürülürse
  muhasebeye anlamsız bir "Revize Et" düğmesi çıkar.
- **`allowDraft` asimetrik**: `ShipmentDispatchNote` her zaman `draft: true`
  geçiyor (PLANNED sevkiyatta canlı taslak), muhasebe "Fiş" geçmiyor. Yeni
  bileşende bunu sevkiyat durumundan türet, sabitleme.
- **DIRECT dalı**: `receiptFor.kind === "DIRECT"` → docType
  `SUBCONTRACTOR_DIRECT_SHIP` + `getDirectReport` (çuval YOK). Çuval listesi
  seçenekleri o dalda çizilmemeli.
- **Kâğıt boyu okuması**: belgenin kendi boyutu YALNIZ ezme yokken `@page`ten
  okunur (`readDocPageSize`). Taşırken bu koşulu düşürme — düşerse düğme kilitlenir.
- **Baskı iframe'i** `sandbox="allow-same-origin allow-modals"`, `allow-scripts` YOK.
- **Dosya tavanı**: tek dosya ≤300, Page ≤200 satır. `ShipmentDispatchNote` bugün
  282, `PrintedDocDialog` 224 — birleşim tek dosyaya sığmaz, bölmeyi baştan planla.

## Kapsam dışı (bilinçli)

- Sayfa numarası ("Sayfa 2/3") — Chromium normal akışta `counter(page)`
  desteklemiyor, `@page` kenar kutuları da yok. Yalnız `printToPDF` yolunda
  mümkün, o da kâğıt çıktısıyla ayrışırdı.
- Belge notu düzenleme yüzeyinin kendisi (`DispatchNoteEditor`) — olduğu gibi taşınır.
- Rezervasyon, iade akışı, sürüm semantiği — hiçbiri değişmiyor.
